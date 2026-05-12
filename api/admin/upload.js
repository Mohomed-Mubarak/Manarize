/* ============================================================
   ZENMARKET — Admin Image Upload API  (Vercel Serverless)
   ============================================================
   Endpoint: POST /api/admin/upload
   Accepts:  multipart/form-data  { file, productId }
             OR application/json  { base64, filename, contentType, productId }

   Why server-side?
     The browser admin session is NOT a Supabase native auth session
     (it uses custom localStorage auth). Direct client-side uploads
     are blocked by Supabase RLS because the browser has no Supabase JWT.
     This endpoint uses the SERVICE ROLE KEY which bypasses RLS entirely.

   Security:
     - Requires X-Admin-Token header (same as all /api/admin/* routes)
     - File validated: type + size enforced server-side
     - Path scoped to  products/{productId}/  to prevent path traversal
   ============================================================ */

const { createClient } = require('@supabase/supabase-js');
const { verifyAdminRequest }  = require('./_auth');
const { checkAdminRateLimit } = require('./_ratelimit');

// ── Vercel runtime config ─────────────────────────────────────────
// CRITICAL: disable Vercel's automatic body parser so readBody() can
// read the raw stream. Without this, Vercel consumes the stream before
// the handler runs, readBody() returns an empty buffer, and large
// base64 payloads also exceed Vercel's default 1 MB JSON parse limit
// — causing the request to fail with HTTP 405 before reaching any
// handler logic.
//
// NOTE: config MUST be attached to the handler function AFTER it is
// defined (see bottom of file). Setting module.exports.config here
// then reassigning module.exports = handler below destroys the config.
// The correct pattern is:  handler.config = {...}; module.exports = handler;

const BUCKET          = 'product-images';
const MAX_SIZE_BYTES  = 5 * 1024 * 1024;   // 5 MB
const ALLOWED_TYPES   = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];

// ── Supabase admin client — module-level singleton ───────────────
// Reused across warm Vercel invocations (Node.js module cache).
let _adminClient = null;
function getAdminClient() {
  if (_adminClient) return _adminClient;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
  _adminClient = createClient(url, key, {
    auth:   { persistSession: false },
    db:     { schema: 'public' },
    global: { headers: { 'x-application-name': 'manarize-upload' } },
  });
  return _adminClient;
}


// ── CORS ─────────────────────────────────────────────────────────
function cors(res) {
  const __origin = process.env.SITE_URL || null; if (__origin) res.setHeader('Access-Control-Allow-Origin', __origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token');
}

// ── Read raw body as Buffer ───────────────────────────────────────
// M-1 FIX: Reject early via Content-Length header before buffering,
// then enforce with a streaming byte-counter to catch missing/spoofed headers.
function readBody(req, maxBytes) {
  // Fast-path: reject immediately if Content-Length header exceeds limit
  const contentLength = parseInt(req.headers['content-length'] || '0', 10);
  if (contentLength > maxBytes) {
    return Promise.reject(Object.assign(
      new Error(`Payload too large: Content-Length ${contentLength} > ${maxBytes}`),
      { statusCode: 413 }
    ));
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let received = 0;
    req.on('data', chunk => {
      received += chunk.length;
      if (received > maxBytes) {
        req.destroy();
        return reject(Object.assign(
          new Error(`Payload too large: stream exceeded ${maxBytes} bytes`),
          { statusCode: 413 }
        ));
      }
      chunks.push(chunk);
    });
    req.on('end',  ()  => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ── Safe filename ─────────────────────────────────────────────────
function safeName(original) {
  const ext   = (original.match(/\.([a-z0-9]+)$/i) || [])[1] || 'jpg';
  const base  = original
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9]/gi, '-')
    .toLowerCase()
    .slice(0, 40);
  return `${Date.now()}-${base}.${ext}`;
}

// ── Parse multipart/form-data (minimal, no deps) ─────────────────
function parseMultipart(buffer, boundary) {
  const boundaryBuf = Buffer.from(`--${boundary}`);
  const parts       = [];
  let   start       = 0;

  while (start < buffer.length) {
    const bStart = buffer.indexOf(boundaryBuf, start);
    if (bStart === -1) break;

    const headerStart = bStart + boundaryBuf.length + 2;  // skip \r\n
    const headerEnd   = buffer.indexOf(Buffer.from('\r\n\r\n'), headerStart);
    if (headerEnd === -1) break;

    const headers   = buffer.slice(headerStart, headerEnd).toString();
    const dataStart = headerEnd + 4;
    const nextBound = buffer.indexOf(boundaryBuf, dataStart);
    const dataEnd   = nextBound === -1 ? buffer.length : nextBound - 2;  // strip \r\n before next boundary

    const data = buffer.slice(dataStart, dataEnd);

    const nameMatch     = headers.match(/name="([^"]+)"/);
    const filenameMatch = headers.match(/filename="([^"]+)"/);
    const ctMatch       = headers.match(/Content-Type:\s*([^\r\n]+)/i);

    parts.push({
      name:        nameMatch     ? nameMatch[1]     : null,
      filename:    filenameMatch ? filenameMatch[1] : null,
      contentType: ctMatch       ? ctMatch[1].trim(): 'application/octet-stream',
      data,
    });

    start = nextBound === -1 ? buffer.length : nextBound;
  }

  return parts;
}


// ── Magic-byte verification ────────────────────────────────────
// Client-supplied MIME type can be spoofed; inspect the actual
// file bytes to confirm the format before storing.
const MAGIC_SIGNATURES = [
  { mime: 'image/jpeg',  bytes: [0xFF, 0xD8, 0xFF],               offset: 0 },
  { mime: 'image/png',   bytes: [0x89, 0x50, 0x4E, 0x47],         offset: 0 },
  { mime: 'image/gif',   bytes: [0x47, 0x49, 0x46, 0x38],         offset: 0 },
  { mime: 'image/avif',  bytes: [0x66, 0x74, 0x79, 0x70],         offset: 4 },
  { mime: 'image/webp',  bytes: [0x57, 0x45, 0x42, 0x50],         offset: 8 },
];

function detectMimeFromBytes(buf) {
  for (const sig of MAGIC_SIGNATURES) {
    if (buf.length < sig.offset + sig.bytes.length) continue;
    const match = sig.bytes.every((b, i) => buf[sig.offset + i] === b);
    if (match) return sig.mime;
  }
  return null;
}

function verifyMagicBytes(buf, declaredMime) {
  const detected = detectMimeFromBytes(buf);
  if (!detected) return false;                 // unknown / unsupported format
  if (detected !== declaredMime) return false; // MIME header was spoofed
  return true;
}
// ── Main handler ─────────────────────────────────────────────────
async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  const { limited: _rl } = await checkAdminRateLimit(req, res, 'write');
  if (_rl) return;
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });
  if (!isAuthorised(req))       return res.status(401).json({ error: 'Unauthorised' });

  try {
    const supabase    = getAdminClient();
    const rawBody     = await readBody(req, MAX_SIZE_BYTES);
    const contentType = req.headers['content-type'] || '';

    let fileBuffer, filename, mimeType, productId;

    // ── Branch A: JSON base64 payload ────────────────────────────
    if (contentType.includes('application/json')) {
      const payload = JSON.parse(rawBody.toString());
      if (!payload.base64 || !payload.filename || !payload.contentType) {
        return res.status(400).json({ error: 'base64, filename and contentType are required' });
      }
      fileBuffer  = Buffer.from(payload.base64, 'base64');
      filename    = payload.filename;
      mimeType    = payload.contentType;
      productId   = payload.productId || 'new';

    // ── Branch B: multipart/form-data ─────────────────────────────
    } else if (contentType.includes('multipart/form-data')) {
      const boundaryMatch = contentType.match(/boundary=([^\s;]+)/);
      if (!boundaryMatch) return res.status(400).json({ error: 'Missing multipart boundary' });

      const parts = parseMultipart(rawBody, boundaryMatch[1]);
      const filePart = parts.find(p => p.filename) || parts.find(p => p.name === 'file');
      const idPart   = parts.find(p => p.name === 'productId');

      if (!filePart) return res.status(400).json({ error: 'No file found in request' });

      fileBuffer  = filePart.data;
      filename    = filePart.filename;
      mimeType    = filePart.contentType;
      productId   = idPart ? idPart.data.toString().trim() : 'new';

    } else {
      return res.status(415).json({ error: 'Unsupported Content-Type. Use application/json or multipart/form-data' });
    }

    // ── Validate ──────────────────────────────────────────────────
    if (!ALLOWED_TYPES.includes(mimeType)) {
      return res.status(400).json({ error: `Unsupported file type: ${mimeType}` });
    }
    if (fileBuffer.length > MAX_SIZE_BYTES) {
      return res.status(400).json({ error: `File exceeds 5 MB limit (${(fileBuffer.length / 1024 / 1024).toFixed(1)} MB)` });
    }
    // Magic-byte check: reject if actual bytes don't match declared MIME
    if (!verifyMagicBytes(fileBuffer, mimeType)) {
      console.warn('[Upload API] Magic-byte mismatch — declared:', mimeType);
      return res.status(400).json({ error: 'File content does not match declared type' });
    }

    // ── Upload via service role (bypasses RLS) ────────────────────
    const folder = productId === 'blog' ? 'blog' : `products/${productId}`;
    const path = `${folder}/${safeName(filename)}`;

    const { data, error } = await supabase.storage
      .from(BUCKET)
      .upload(path, fileBuffer, {
        contentType:  mimeType,
        cacheControl: '31536000',
        upsert:       false,
      });

    if (error) throw new Error(error.message);

    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(data.path);

    return res.status(200).json({ url: urlData.publicUrl, path: data.path });

  } catch (err) {
    console.error('[Upload API]', err.message);
    const status = err.statusCode === 413 ? 413 : 500;
    const msg    = status === 413 ? 'File too large' : 'Upload failed. Please try again.';
    return res.status(status).json({ error: msg });
  }
}

// MUST be set on the function AFTER it is defined.
// Setting module.exports.config before module.exports = handler
// overwrites the config — Vercel never sees bodyParser:false and
// the 1 MB default limit causes HTTP 405 on base64 image uploads.
handler.config = {
  api: {
    bodyParser: false,    // let readBody() handle the raw stream
    responseLimit: false, // no artificial cap on response size
  },
};

module.exports = handler;

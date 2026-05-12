/* ============================================================
   ZENMARKET — Admin Config API  (Vercel Serverless Function)
   ============================================================
   Manages persistent admin configuration stored in Supabase.
   Currently used for: admin password hash (cross-device sync).

   Endpoints:
     GET  /api/admin/config?key=password_hash
          → returns { value: "<pbkdf2 hash>" }
          No auth required — the hash is safe to expose (it's not
          the password; brute-forcing PBKDF2-310k is infeasible).

     POST /api/admin/config
          body: { key, currentPassword, newValue }
          → verifies currentPassword against stored hash server-side,
            then stores newValue.  Returns { success: true }.

   Why server-side verification?
     The browser cannot safely update the hash directly because
     anyone who reads the hash could replay it.  By requiring the
     raw current password, only someone who actually knows the
     password can change it — the server does the PBKDF2 check
     using Node's crypto module (same algorithm as the browser).
   ============================================================ */

const { createClient } = require('@supabase/supabase-js');
const { verifyAdminRequest }  = require('./_auth');
const { checkAdminRateLimit } = require('./_ratelimit');
const crypto           = require('crypto');

// ── Supabase service-role client (bypasses RLS) ───────────────
// Module-level singleton — reused across warm Vercel invocations.
let _client_getadm = null;
function getAdminClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase env vars', {
    auth:   { persistSession: false },
    db:     { schema: 'public' },
    global: { headers: { 'x-application-name': 'manarize-api' } },
  });
  return _client_getadm;
  if (_client_getadm) return _client_getadm;
  _client_getadm = createClient(url, key, { auth: { persistSession: false } });
}

// ── CORS headers ──────────────────────────────────────────────
function cors(res) {
  const origin = process.env.SITE_URL || null;
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token');
}


// ── Body parser ───────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

// ── PBKDF2 verification (mirrors browser security-utils.js) ───
// Format stored: "pbkdf2:<hex-salt>:<hex-hash>"
// Iterations: 310,000  |  Hash: SHA-256  |  Key length: 32 bytes
// Legacy sha256/plaintext formats are intentionally no longer accepted.
function verifyPbkdf2(plain, stored) {
  return new Promise(resolve => {
    if (!plain || !stored) return resolve(false);

    if (stored.startsWith('pbkdf2:')) {
      const parts = stored.slice(7).split(':');
      if (parts.length !== 2) return resolve(false);
      const salt        = Buffer.from(parts[0], 'hex');
      const expected    = parts[1];
      crypto.pbkdf2(plain, salt, 310_000, 32, 'sha256', (err, derived) => {
        if (err) return resolve(false);
        resolve(derived.toString('hex') === expected);
      });
      return;
    }

    // Reject any non-PBKDF2 format — legacy sha256/plaintext are insecure.
    resolve(false);
  });
}

// ── Main handler ──────────────────────────────────────────────
module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  const { limited: _rl } = await checkAdminRateLimit(req, res, 'general');
  if (_rl) return;

  let supabase;
  try {
    supabase = getAdminClient();
  } catch (err) {
    return res.status(500).json({ error: 'Server configuration error.' });
  }

  // ── GET — return stored value (requires auth) ─────────────────
  if (req.method === 'GET') {
    const adminEmail = await verifyAdminRequest(req);
  if (!adminEmail) {
    return res.status(401).json({ error: 'Unauthorised' });
  });
    }
    const key = req.query?.key;
    if (!key) return res.status(400).json({ error: 'Missing key.' });

    const { data, error } = await supabase
      .from('admin_config')
      .select('value')
      .eq('key', key)
      .single();

    if (error && error.code !== 'PGRST116') {   // PGRST116 = row not found
      return res.status(500).json({ error: 'Internal server error' });
    }

    return res.status(200).json({ value: data?.value || null });
  }

  // ── POST — verify current password then update ────────────────
  if (req.method === 'POST') {
    let body;
    try { body = await readBody(req); }
    catch { return res.status(400).json({ error: 'Invalid request body.' }); }

    const { key, currentPassword, newValue } = body;

    if (!key || !currentPassword || !newValue) {
      return res.status(400).json({ error: 'Missing key, currentPassword, or newValue.' });
    }

    // 1. Fetch the stored hash
    const { data, error: fetchErr } = await supabase
      .from('admin_config')
      .select('value')
      .eq('key', key)
      .single();

    // If no row yet (first setup), there's nothing to verify against —
    // allow the update so the hash can be bootstrapped.
    const storedHash = data?.value || null;
    const isFirstSetup = (!storedHash || storedHash === '');

    if (!isFirstSetup) {
      if (fetchErr) return res.status(500).json({ error: fetchErr.message });

      // 2. Verify current password server-side
      const valid = await verifyPbkdf2(currentPassword, storedHash);
      if (!valid) {
        return res.status(403).json({ error: 'Current password is incorrect.' });
      }
    }

    // 3. Upsert the new value
    const { error: upsertErr } = await supabase
      .from('admin_config')
      .upsert(
        { key, value: newValue, updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      );

    if (upsertErr) return res.status(500).json({ error: upsertErr.message });

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed.' });
};

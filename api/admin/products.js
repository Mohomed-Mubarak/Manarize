/* ============================================================
   ZENMARKET — Admin Products API  (Vercel Serverless Function)
   ============================================================
   Endpoint: /api/admin/products
     GET    → list all products (including inactive)
     POST   → create product
     PUT    → update product  (?id=xxx)
     DELETE → delete product  (?id=xxx)

   SECURITY:
     - Requires X-Admin-Token header matching ADMIN_API_TOKEN env var
     - Uses Supabase service role key — bypasses RLS for admin ops
     - Rate-limited by Vercel Edge Network + Cloudflare
   ============================================================ */

const { createClient } = require('@supabase/supabase-js');
const { verifyAdminRequest }  = require('./_auth');
const { checkAdminRateLimit } = require('./_ratelimit');
const { validate, checkBodySize } = require('../_validate');

// Module-level singleton — reused across warm Vercel invocations.
// Node.js module cache keeps this alive between requests on the same instance.
let _adminClient = null;
function getAdminClient() {
  if (_adminClient) return _adminClient;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase env vars');
  _adminClient = createClient(url, key, {
    auth: { persistSession: false },
    db:   { schema: 'public' },
    global: { headers: { 'x-application-name': 'manarize-admin' } },
  });
  return _adminClient;
}

async function readJson(req) {
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

// ── CORS headers ─────────────────────────────────────────────────
function cors(res) {
  const __origin = process.env.SITE_URL || null; if (__origin) res.setHeader('Access-Control-Allow-Origin', __origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token');
}

module.exports = async function handler(req, res) {
  cors(res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  const { limited: _rl } = await checkAdminRateLimit(req, res, 'general');
  if (_rl) return;

  const adminEmail = await verifyAdminRequest(req);
  if (!adminEmail) {
    return res.status(401).json({ error: 'Unauthorised' });
  });
  }

  const supabase = getAdminClient();
  const { id }   = req.query;

  try {
    // ── GET — list all products ──────────────────────────────────
    if (req.method === 'GET') {
      const { page = '1', limit = '50', search = '', category = '' } = req.query;
      const from = (parseInt(page) - 1) * parseInt(limit);
      const to   = from + parseInt(limit) - 1;

      let query = supabase
        .from('products')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, to);

      if (search) query = query.ilike('name', `%${search}%`);
      if (category) query = query.eq('category_slug', category);

      const { data, error, count } = await query;
      if (error) throw error;

      return res.status(200).json({ data, count, page: parseInt(page), limit: parseInt(limit) });
    }

    // ── POST — create product ────────────────────────────────────
    if (req.method === 'POST') {
      const sizeErr = checkBodySize(req);
      if (sizeErr) return res.status(413).json({ error: sizeErr });
      const raw = await readJson(req);

      const PRODUCT_SCHEMA = {
        name:        { type: 'string',  required: true,  max: 512  },
        price:       { type: 'number',  required: true,  min: 0    },
        slug:        { type: 'string',  required: false, max: 256  },
        category:    { type: 'string',  required: false, max: 128  },
        description: { type: 'string',  required: false, max: 5000 },
        stock:       { type: 'number',  required: false, min: 0    },
        active:      { type: 'boolean', required: false             },
        images:      { type: 'array',   required: false, max: 20   },
        tags:        { type: 'array',   required: false, max: 50   },
      };
      const { body, error: validErr } = validate(raw, PRODUCT_SCHEMA);
      if (validErr) return res.status(400).json({ error: validErr });

      // Generate slug if not provided
      if (!body.slug) {
        body.slug = body.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');
      }

      body.id         = raw.id || `prod-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      body.created_at = new Date().toISOString();
      body.updated_at = new Date().toISOString();

      const { data, error } = await supabase
        .from('products')
        .insert(body)
        .select()
        .single();

      if (error) throw error;
      return res.status(201).json({ data });
    }

    // ── PUT — update product ─────────────────────────────────────
    if (req.method === 'PUT') {
      if (!id) return res.status(400).json({ error: 'Missing product id' });
      const sizeErr = checkBodySize(req);
      if (sizeErr) return res.status(413).json({ error: sizeErr });
      const body = await readJson(req);
      body.updated_at = new Date().toISOString();

      const { data, error } = await supabase
        .from('products')
        .update(body)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return res.status(200).json({ data });
    }

    // ── DELETE — soft delete (set active=false) ──────────────────
    if (req.method === 'DELETE') {
      if (!id) return res.status(400).json({ error: 'Missing product id' });

      const { error } = await supabase
        .from('products')
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;
      return res.status(200).json({ deleted: id });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('[Admin Products API]', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

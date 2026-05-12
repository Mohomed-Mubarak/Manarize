/* ============================================================
   ZENMARKET — Admin Reviews API  (Vercel Serverless Function)
   ============================================================
   Endpoint: /api/admin/reviews
     GET    → list reviews  (?status=pending&page=1)
     PUT    → approve or reject a review  (?id=xxx)
     DELETE → delete a review  (?id=xxx)
   ============================================================ */

const { createClient } = require('@supabase/supabase-js');
const { verifyAdminRequest }  = require('./_auth');
const { checkAdminRateLimit } = require('./_ratelimit');

// Module-level singleton — reused across warm Vercel invocations.
let _client_getadm = null;
function getAdminClient() {
  if (_client_getadm) return _client_getadm;
  _client_getadm = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  , {
    auth:   { persistSession: false },
    db:     { schema: 'public' },
    global: { headers: { 'x-application-name': 'manarize-api' } },
  });
  return _client_getadm;
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

function cors(res) {
  const __origin = process.env.SITE_URL || null; if (__origin) res.setHeader('Access-Control-Allow-Origin', __origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, DELETE, OPTIONS');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token');
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  const { limited: _rl } = await checkAdminRateLimit(req, res, 'general');
  if (_rl) return;
  if (!isAuthorised(req)) return res.status(401).json({ error: 'Unauthorised' });

  const supabase = getAdminClient();
  const { id } = req.query;

  try {
    if (req.method === 'GET') {
      const { page = '1', limit = '20', status = 'pending' } = req.query;
      const from = (parseInt(page) - 1) * parseInt(limit);
      const to   = from + parseInt(limit) - 1;

      let q = supabase
        .from('reviews')
        .select('*, products(name, slug)', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, to);

      if (status === 'pending')  q = q.eq('approved', false).eq('rejected', false);
      if (status === 'approved') q = q.eq('approved', true);
      if (status === 'rejected') q = q.eq('rejected', true);

      const { data, error, count } = await q;
      if (error) throw error;
      return res.status(200).json({ data, count, page: parseInt(page), limit: parseInt(limit) });
    }

    if (req.method === 'PUT') {
      if (!id) return res.status(400).json({ error: 'Missing review id' });
      const { action } = await readJson(req);

      if (!['approve', 'reject'].includes(action)) {
        return res.status(400).json({ error: 'action must be "approve" or "reject"' });
      }

      const update = action === 'approve'
        ? { approved: true,  rejected: false }
        : { approved: false, rejected: true  };

      const { data, error } = await supabase
        .from('reviews')
        .update(update)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      // If approving, update product average rating
      if (action === 'approve') {
        await supabase.rpc('refresh_product_rating', { p_product_id: data.product_id });
      }

      return res.status(200).json({ data });
    }

    if (req.method === 'DELETE') {
      if (!id) return res.status(400).json({ error: 'Missing review id' });
      const { error } = await supabase.from('reviews').delete().eq('id', id);
      if (error) throw error;
      return res.status(200).json({ deleted: id });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('[Admin Reviews API]', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/* ============================================================
   ZENMARKET — Admin Newsletter Subscribers API
   GET    /api/admin/newsletter   → list all subscribers
   DELETE /api/admin/newsletter?email=<email>  → unsubscribe
   ============================================================ */
const { createClient } = require('@supabase/supabase-js');
const { verifyAdminRequest } = require('./_auth');
const { checkAdminRateLimit } = require('./_ratelimit');

let _client = null;
function getClient() {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase env vars');
  _client = createClient(url, key, { auth: { persistSession: false } });
  return _client;
}

function cors(res) {
  const origin = process.env.SITE_URL || null;
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token');
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const { limited } = await checkAdminRateLimit(req, res, 'general');
  if (limited) return;

  const adminEmail = await verifyAdminRequest(req);
  if (!adminEmail) return res.status(401).json({ error: 'Unauthorised' });

  const sb = getClient();

  // ── GET: list all subscribers ───────────────────────────────
  if (req.method === 'GET') {
    const { data, error } = await sb
      .from('newsletter_subscribers')
      .select('*')
      .order('subscribed_at', { ascending: false });

    if (error) {
      console.error('[Newsletter] GET failed:', error.message);
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ subscribers: data || [] });
  }

  // ── DELETE: remove a subscriber ─────────────────────────────
  if (req.method === 'DELETE') {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: 'Missing email' });

    const { error } = await sb
      .from('newsletter_subscribers')
      .delete()
      .eq('email', decodeURIComponent(email));

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ deleted: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};

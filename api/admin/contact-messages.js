/* ============================================================
   ZENMARKET — Admin Contact Messages API
   GET    /api/admin/contact-messages          → list all
   PUT    /api/admin/contact-messages?id=<id>  → mark read
   DELETE /api/admin/contact-messages?id=<id>  → delete one
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token');
}

async function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const { limited } = await checkAdminRateLimit(req, res, 'general');
  if (limited) return;

  const adminEmail = await verifyAdminRequest(req);
  if (!adminEmail) return res.status(401).json({ error: 'Unauthorised' });

  const sb = getClient();

  // ── GET: list all messages ──────────────────────────────────
  if (req.method === 'GET') {
    const { data, error } = await sb
      .from('contact_messages')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[ContactMessages] GET failed:', error.message);
      return res.status(500).json({ error: error.message });
    }

    const messages = (data || []).map(r => ({
      id:        r.id,
      firstName: r.first_name || '',
      lastName:  r.last_name  || '',
      email:     r.email      || '',
      phone:     r.phone      || '',
      subject:   r.subject    || '',
      message:   r.message    || '',
      read:      r.read       || false,
      createdAt: r.created_at,
    }));

    return res.status(200).json({ messages });
  }

  // ── PUT: mark a message as read ─────────────────────────────
  if (req.method === 'PUT') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Missing id' });

    const { error } = await sb
      .from('contact_messages')
      .update({ read: true })
      .eq('id', id);

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  // ── DELETE: remove a message ────────────────────────────────
  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Missing id' });

    const { error } = await sb
      .from('contact_messages')
      .delete()
      .eq('id', id);

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ deleted: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};

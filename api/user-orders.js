/* ============================================================
   USER ORDERS API  — GET /api/user-orders
   Returns orders belonging to the authenticated user.
   Uses service-role key so RLS is bypassed server-side.
   Identity verified via Supabase JWT in Authorization header.
   ============================================================ */
const { createClient } = require('@supabase/supabase-js');

let _serviceClient = null;
function getServiceClient() {
  if (_serviceClient) return _serviceClient;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  _serviceClient = createClient(url, key, { auth: { persistSession: false } });
  return _serviceClient;
}

module.exports = async function handler(req, res) {
  const origin = process.env.SITE_URL || null;
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // ── Verify caller identity via Supabase JWT ───────────────────
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing authorization token' });

  try {
    const sb = getServiceClient();

    // Verify JWT — getUser() validates signature against Supabase's JWT secret
    const { data: { user }, error: authErr } = await sb.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ error: 'Invalid or expired token' });

    // Fetch all orders matching this user's ID or email (covers older orders)
    const byIdPromise = sb
      .from('orders')
      .select('*')
      .eq('customer_id', user.id)
      .order('created_at', { ascending: false });

    const byEmailPromise = user.email
      ? sb.from('orders').select('*').eq('customer_email', user.email).order('created_at', { ascending: false })
      : Promise.resolve({ data: [] });

    const [{ data: byId }, { data: byEmail }] = await Promise.all([byIdPromise, byEmailPromise]);

    // Merge + deduplicate by id
    const seen = new Set();
    const orders = [];
    for (const row of [...(byId || []), ...(byEmail || [])]) {
      if (!seen.has(row.id)) { seen.add(row.id); orders.push(row); }
    }
    orders.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    return res.status(200).json({ orders });
  } catch (err) {
    console.error('[user-orders]', err.message);
    return res.status(500).json({ error: 'Could not fetch orders' });
  }
};

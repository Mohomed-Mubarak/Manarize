/* ============================================================
   ZENMARKET — Admin Orders API  (Vercel Serverless Function)
   ============================================================
   Endpoint: /api/admin/orders
     GET    → list orders  (?status=pending&page=1&limit=20)
     PUT    → update order status / payment  (?id=xxx)

   Uses Supabase service role — bypasses RLS so admin can view
   all customer orders regardless of auth.uid().
   ============================================================ */

const { createClient } = require('@supabase/supabase-js');
const { verifyAdminRequest }  = require('./_auth');
const { checkAdminRateLimit } = require('./_ratelimit');

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

function cors(res) {
  const __origin = process.env.SITE_URL || null; if (__origin) res.setHeader('Access-Control-Allow-Origin', __origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, DELETE, OPTIONS');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token');
}

// Valid order statuses
const VALID_STATUSES = [
  'pending', 'processing', 'confirmed', 'packed',
  'shipped', 'delivered', 'cancelled', 'refunded',
];

const VALID_PAYMENT_STATUSES = ['pending', 'paid', 'failed', 'refunded', 'cancelled'];

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  const { limited: _rl } = await checkAdminRateLimit(req, res, 'general');
  if (_rl) return;

  const adminEmail = await verifyAdminRequest(req);
  if (!adminEmail) {
    return res.status(401).json({ error: 'Unauthorised' });
  }

  const supabase = getAdminClient();
  const { id }   = req.query;

  try {
    // ── GET — list orders ────────────────────────────────────────
    if (req.method === 'GET') {
      const {
        page           = '1',
        limit          = '20',
        status         = '',
        payment_status = '',
        search         = '',
        from_date      = '',
        to_date        = '',
      } = req.query;

      const from = (parseInt(page) - 1) * parseInt(limit);
      const to   = from + parseInt(limit) - 1;

      let query = supabase
        .from('orders')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, to);

      if (status)         query = query.eq('status', status);
      if (payment_status) query = query.eq('payment_status', payment_status);
      if (from_date)      query = query.gte('created_at', from_date);
      if (to_date)        query = query.lte('created_at', to_date);
      if (search) {
        // Search by customer name, email, or order id
        query = query.or(
          `customer_name.ilike.%${search}%,customer_email.ilike.%${search}%,id.eq.${search}`
        );
      }

      const { data, error, count } = await query;
      if (error) throw error;

      // Aggregate totals
      const { data: totals } = await supabase
        .from('orders')
        .select('total, status')
        .eq('payment_status', 'paid');

      const paidTotal = (totals || []).reduce((s, o) => s + (o.total || 0), 0);

      return res.status(200).json({
        data,
        count,
        page:     parseInt(page),
        limit:    parseInt(limit),
        paidTotal,
      });
    }

    // ── PUT — update order ───────────────────────────────────────
    if (req.method === 'PUT') {
      if (!id) return res.status(400).json({ error: 'Missing order id' });
      const body = await readJson(req);

      const update = { updated_at: new Date().toISOString() };

      if (body.status) {
        if (!VALID_STATUSES.includes(body.status)) {
          return res.status(400).json({ error: `Invalid status: ${body.status}` });
        }
        update.status = body.status;
      }

      if (body.payment_status) {
        if (!VALID_PAYMENT_STATUSES.includes(body.payment_status)) {
          return res.status(400).json({ error: `Invalid payment_status: ${body.payment_status}` });
        }
        update.payment_status = body.payment_status;
      }

      if (body.bank_ref)     update.bank_ref     = body.bank_ref;
      if (body.payment_slip) update.payment_slip = body.payment_slip;
      if (body.notes !== undefined) update.notes = body.notes;

      const { data, error } = await supabase
        .from('orders')
        .update(update)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      console.log(`[Admin Orders] Updated order ${id}: ${JSON.stringify(update)}`);
      return res.status(200).json({ data });
    }

    // ── DELETE — delete order(s) ────────────────────────────────
    if (req.method === 'DELETE') {
      // Single: DELETE /api/admin/orders?id=xxx
      // Bulk:   DELETE /api/admin/orders  body: { ids: ['a','b',...] }
      if (id) {
        const { error } = await supabase.from('orders').delete().eq('id', id);
        if (error) throw error;
        console.log(`[Admin Orders] Deleted order ${id}`);
        return res.status(200).json({ deleted: [id] });
      }

      const body = await readJson(req);
      const ids  = Array.isArray(body.ids) ? body.ids.filter(x => typeof x === 'string') : [];
      if (!ids.length) return res.status(400).json({ error: 'Missing id or ids array' });

      const { error } = await supabase.from('orders').delete().in('id', ids);
      if (error) throw error;
      console.log(`[Admin Orders] Deleted ${ids.length} orders`);
      return res.status(200).json({ deleted: ids });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('[Admin Orders API]', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/* ============================================================
   ZENMARKET — Admin Users API  (Vercel Serverless Function)
   ============================================================
   Endpoint: /api/admin/users
     DELETE ?id=<uuid>  → hard-delete user from auth.users
                          (profiles row is removed automatically
                           via ON DELETE CASCADE)

   Why a serverless function?
     auth.admin.deleteUser() requires the SERVICE ROLE KEY which
     must NEVER be sent to the browser. The browser-side admin
     pages call this endpoint with the X-Admin-Token header;
     the actual Supabase auth deletion happens server-side only.
   ============================================================ */

const { createClient } = require('@supabase/supabase-js');
const { verifyAdminRequest } = require('./_auth');
const { checkAdminRateLimit } = require('./_ratelimit');
const crypto = require('crypto');

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


function cors(res) {
  const __origin = process.env.SITE_URL || null; if (__origin) res.setHeader('Access-Control-Allow-Origin', __origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token');
}

async function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  const { limited: _rl } = await checkAdminRateLimit(req, res, 'general');
  if (_rl) return;

  const adminEmail = await verifyAdminRequest(req);
  if (!adminEmail) {
    return res.status(401).json({ error: 'Unauthorised' });
  }

  // ── GET: list all users ─────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const supabase = getAdminClient();

      const [profilesRes, ordersRes] = await Promise.all([
        supabase.from('profiles').select('*').order('created_at', { ascending: false }),
        supabase.from('orders').select('customer_id, total'),
      ]);

      if (profilesRes.error) {
        console.error('[Admin Users] profiles fetch failed:', profilesRes.error.message);
        return res.status(500).json({ error: 'Internal server error' });
      }

      const orderStats = {};
      for (const order of (ordersRes.data || [])) {
        const cid = order.customer_id;
        if (!cid) continue;
        if (!orderStats[cid]) orderStats[cid] = { count: 0, spent: 0 };
        orderStats[cid].count++;
        orderStats[cid].spent += Number(order.total) || 0;
      }

      const users = (profilesRes.data || []).map(row => {
        const stats = orderStats[row.id] || { count: 0, spent: 0 };
        return {
          id:         row.id,
          name:       row.name || row.email?.split('@')[0] || 'Unknown',
          email:      row.email || '—',
          phone:      row.phone || '',
          role:       row.role  || 'customer',
          active:     row.active !== false,
          orders:     stats.count,
          totalSpent: stats.spent,
          createdAt:  row.created_at,
          updatedAt:  row.updated_at,
        };
      });

      return res.status(200).json({ users });
    } catch (err) {
      console.error('[Admin Users] Unexpected error:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  // ── POST: create a new user ─────────────────────────────────
  if (req.method === 'POST') {
    try {
      const { name, email, phone, role, password } = await readJson(req);

      if (!name || !email) {
        return res.status(400).json({ error: 'name and email are required' });
      }
      if (!password || password.length < 8) {
        return res.status(400).json({ error: 'password must be at least 8 characters' });
      }

      const supabase = getAdminClient();

      // 1. Create the auth user with a confirmed email and the supplied password.
      const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name, phone: phone || '' },
      });

      if (authError) {
        console.error('[Admin Users] auth.admin.createUser failed:', authError.message);
        return res.status(400).json({ error: authError.message });
      }

      const uid = authData.user.id;

      // 2. Upsert the profile with admin-supplied fields (role, phone, name).
      //    Using upsert (not update) so the row is created if the trigger
      //    hasn't fired yet — update silently matches 0 rows and does nothing.
      const { error: profError } = await supabase
        .from('profiles')
        .upsert({
          id:         uid,
          name:       name,
          phone:      phone || '',
          role:       role || 'customer',
          email:      email,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'id' });

      if (profError) {
        console.error('[Admin Users] profile update failed:', profError.message);
        // Non-fatal — user was created; just return a warning
        return res.status(207).json({
          warning: 'User created but profile update failed: ' + profError.message,
          user: { id: uid, name, email, phone, role: role || 'customer' },
        });
      }

      console.log(`[Admin Users] Created user ${uid} (${email})`);
      return res.status(201).json({
        user: { id: uid, name, email, phone: phone || '', role: role || 'customer' },
      });

    } catch (err) {
      console.error('[Admin Users] Unexpected error:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  // ── PUT: update user profile (role, name, phone, active) ────
  if (req.method === 'PUT') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Missing user id' });
    try {
      const body = await readJson(req);
      const supabase = getAdminClient();

      // Build the fields to update
      const update = { id, updated_at: new Date().toISOString() };
      if (body.name   !== undefined) update.name   = String(body.name).slice(0, 256);
      if (body.phone  !== undefined) update.phone  = String(body.phone).slice(0, 64);
      if (body.role   !== undefined) update.role   = ['customer', 'admin'].includes(body.role) ? body.role : 'customer';
      if (body.active !== undefined) update.active = !!body.active;

      // Use upsert instead of update so the profile is created if it doesn't
      // exist yet (e.g. the auth trigger hasn't fired). The service-role key
      // bypasses RLS, so this is safe to do server-side only.
      const { data, error } = await supabase
        .from('profiles')
        .upsert(update, { onConflict: 'id' })
        .select()
        .single();

      if (error) {
        // Return the real Supabase error so the client can display it clearly.
        // This is safe here because the endpoint is protected by admin auth.
        console.error('[Admin Users] PUT failed:', error.message);
        return res.status(500).json({ error: error.message });
      }

      console.log(`[Admin Users] Updated user ${id}`);
      return res.status(200).json({ user: data });
    } catch (err) {
      console.error('[Admin Users] PUT error:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── DELETE: remove a user ───────────────────────────────────
  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) {
      return res.status(400).json({ error: 'Missing user id' });
    }

    try {
      const supabase = getAdminClient();

      // auth.admin.deleteUser removes the row from auth.users.
      // The profiles table has ON DELETE CASCADE, so the profile
      // row is automatically removed — no second query needed.
      const { error } = await supabase.auth.admin.deleteUser(id);

      if (error) {
        console.error('[Admin Users] auth.admin.deleteUser failed:', error.message);
        return res.status(500).json({ error: 'Internal server error' });
      }

      console.log(`[Admin Users] Deleted auth user ${id}`);
      return res.status(200).json({ deleted: true, id });

    } catch (err) {
      console.error('[Admin Users] Unexpected error:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};

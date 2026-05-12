'use strict';
/**
 * GET /api/auth/profile
 *
 * Accepts: Authorization: Bearer <supabase_access_token>
 * Returns: { profile: { id, role, name, email, active } } | { error }
 *
 * Uses the service-role key server-side to bypass RLS.
 * This avoids the client hitting infinite-recursion RLS policies.
 */

const { createClient } = require('@supabase/supabase-js');

let _svc = null;
function getSvc() {
  if (_svc) return _svc;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  _svc = createClient(url, key, { auth: { persistSession: false } });
  return _svc;
}

module.exports = async function handler(req, res) {
  const origin = process.env.SITE_URL || null;
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET')    return res.status(405).json({ error: 'Method not allowed' });

  const auth  = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;

  if (!token) return res.status(401).json({ error: 'Missing authorization token' });

  try {
    const svc = getSvc();

    // Verify JWT — getUser validates against Supabase's JWT secret
    const { data: { user }, error: authErr } = await svc.auth.getUser(token);
    if (authErr || !user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Fetch profile using service-role (bypasses RLS)
    const { data: profile, error: dbErr } = await svc
      .from('profiles')
      .select('id, role, name, email, active')
      .eq('id', user.id)
      .single();

    if (dbErr) {
      // Profile row missing — return defaults
      return res.status(200).json({
        profile: {
          id:     user.id,
          role:   'customer',
          name:   user.user_metadata?.name || user.email?.split('@')[0] || '',
          email:  user.email || '',
          active: true,
        },
      });
    }

    return res.status(200).json({ profile });

  } catch (err) {
    console.error('[api/auth/profile]', err.message);
    return res.status(500).json({ error: 'Could not fetch profile' });
  }
};

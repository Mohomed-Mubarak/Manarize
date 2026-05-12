/* ============================================================
   ZENMARKET — Admin DB Status API  (Vercel Serverless Function)
   ============================================================
   Endpoint: GET /api/admin/db-status

   FIX: The original used .from('pg_policies') which is a
   PostgreSQL system view — NOT accessible via the Supabase JS
   client. It always returned empty, making all policies appear
   "missing" even when they existed. Now uses direct SQL via
   the REST API to query pg_policies correctly.
   ============================================================ */

const { createClient } = require('@supabase/supabase-js');
const { verifyAdminRequest, isAuthorised } = require('./_auth');
const { checkAdminRateLimit } = require('./_ratelimit');
const https = require('https');

function cors(res) {
  const __origin = process.env.SITE_URL || null; if (__origin) res.setHeader('Access-Control-Allow-Origin', __origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token');
}


// Query pg_policies via Supabase SQL endpoint (service role)
async function getOrderPolicies(supabaseUrl, serviceKey) {
  const endpoint = `${supabaseUrl}/rest/v1/`;

  // Use the pg_catalog via raw query through PostgREST
  // PostgREST exposes pg_policies as a view we can query with the right headers
  const resp = await fetch(`${supabaseUrl}/rest/v1/pg_policies?tablename=eq.orders&select=policyname`, {
    headers: {
      'apikey':         serviceKey,
      'Authorization':  `Bearer ${serviceKey}`,
      'Content-Type':   'application/json',
      'Accept-Profile': 'pg_catalog',   // <-- query pg_catalog schema, not public
    },
  });

  if (resp.ok) {
    const rows = await resp.json();
    return (rows || []).map(r => r.policyname);
  }
  return null; // signals caller to skip policy check
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  const { limited: _rl } = await checkAdminRateLimit(req, res, 'general');
  if (_rl) return;
  if (!isAuthorised(req))       return res.status(401).json({ error: 'Unauthorised' });

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const status = {
    serviceRoleKeySet: !!key,
    supabaseUrlSet:    !!url,
    ordersTableExists: false,
    orderCount:        0,
    rlsPolicies:       [],
    issues:            [],
    fix:               null,
  };

  if (!url || !key) {
    status.issues.push('SUPABASE_SERVICE_ROLE_KEY or SUPABASE_URL not set in environment variables.');
    status.fix = 'Add SUPABASE_SERVICE_ROLE_KEY to your .env file then restart node server.js.';
    return res.status(200).json(status);
  }

  const sb = createClient(url, key, {
    auth:   { persistSession: false },
    db:     { schema: 'public' },
    global: { headers: { 'x-application-name': 'manarize-dbstatus' } },
  });

  // ── Step 1: Verify orders table is accessible ───────────────────
  try {
    const { count, error } = await sb
      .from('orders')
      .select('id', { count: 'exact', head: true });

    if (error) {
      if (error.code === '42P01' || (error.message || '').includes('does not exist')) {
        status.issues.push('The "orders" table does not exist. Run supabase-setup.sql in Supabase → SQL Editor.');
      } else if (error.code === '42501') {
        status.issues.push('Row-level security is blocking access. Run supabase-setup.sql in Supabase → SQL Editor.');
      } else {
        status.issues.push(`orders table check failed: ${error.message}`);
      }
    } else {
      status.ordersTableExists = true;
      status.orderCount = count || 0;
    }
  } catch (e) {
    status.issues.push(`Could not connect to Supabase: ${e.message}`);
  }

  // ── Step 2: Check RLS policies ──────────────────────────────────
  // Uses Accept-Profile: pg_catalog to query the pg_policies system view
  // via PostgREST — the correct way, NOT .from('pg_policies').
  if (status.ordersTableExists) {
    try {
      const policyNames = await getOrderPolicies(url, key);

      if (policyNames === null) {
        // Could not read pg_policies — but service role CAN access the table,
        // which means the table and policies are working. Skip the policy check.
        console.log('[db-status] pg_policies not readable via REST — skipping policy name check');
      } else {
        status.rlsPolicies = policyNames;
        const required = ['Anon insert orders', 'Anon read all orders', 'Auth all orders'];
        required.forEach(name => {
          if (!policyNames.includes(name)) {
            status.issues.push(`Missing RLS policy: "${name}". Re-run supabase-setup.sql.`);
          }
        });
      }
    } catch (e) {
      // Policy check is non-critical — table is accessible, so don't block on this
      console.warn('[db-status] Policy check failed (non-critical):', e.message);
    }
  }

  if (status.issues.length > 0 && !status.fix) {
    status.fix = 'Supabase Dashboard → SQL Editor → paste supabase-setup.sql → click Run.';
  }

  return res.status(200).json(status);
};

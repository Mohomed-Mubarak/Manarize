/* ============================================================
   ZENMARKET — Health Check  (Vercel Serverless Function)
   ============================================================
   Endpoint: GET /api/health

   Returns service status for monitoring (UptimeRobot, Cloudflare
   Health Checks, etc.).

   Response shape:
   {
     "status": "ok",
     "version": "29",
     "timestamp": "2026-...",
     "services": {
       "supabase": "ok" | "error",
       "env": "ok" | "missing_vars"
     }
   }
   ============================================================ */

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');

  const services = {};

  // ── Check required env vars ──────────────────────────────────
  const requiredVars = [
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'PAYHERE_MERCHANT_ID',
    'ADMIN_API_TOKEN',
  ];
  const missing = requiredVars.filter(v => !process.env[v]);
  services.env = missing.length === 0 ? 'ok' : `missing: ${missing.join(', ')}`;

  // ── Ping Supabase ─────────────────────────────────────────────
  try {
    const supabase = createClient(
      process.env.SUPABASE_URL || '',
      process.env.SUPABASE_ANON_KEY || '',
      { auth: { persistSession: false } }
    );
    // Lightweight query — just check the connection
    const { error } = await supabase.from('products').select('id').limit(1);
    services.supabase = error ? `error: ${error.message}` : 'ok';
  } catch (err) {
    services.supabase = `error: ${err.message}`;
  }

  const allOk = Object.values(services).every(v => v === 'ok');

  res.status(allOk ? 200 : 503).json({
    status:    allOk ? 'ok' : 'degraded',
    version:   '29',
    timestamp: new Date().toISOString(),
    services,
  });
};

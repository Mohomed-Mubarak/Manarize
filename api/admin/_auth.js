/* ============================================================
   ZENMARKET — Shared Admin Auth Utilities  (Server-side only)
   ============================================================
   Verifies admin identity from incoming requests.

   Accepts two token types in X-Admin-Token header:
     1. HMAC-signed session token  (issued by /api/admin/auth)
     2. Supabase JWT access token  (issued after magic-link login)

   Usage:
     const { isAuthorised, verifyAdminRequest } = require('./_auth');
     if (!isAuthorised(req)) return res.status(401).json({ error: 'Unauthorised' });
   ============================================================ */

const crypto                = require('crypto');
const { createClient }      = require('@supabase/supabase-js');

// ── HMAC token helpers ────────────────────────────────────────────
// Token format: "<timestamp>.<email_b64>.<hmac_hex>"
const TOKEN_EXPIRY_MS = 8 * 60 * 60 * 1000; // 8 hours

function issueHmacToken(email) {
  const secret = process.env.ADMIN_API_TOKEN;
  if (!secret) throw new Error('ADMIN_API_TOKEN not set');
  const ts     = Date.now().toString();
  const emailB = Buffer.from(email).toString('base64url');
  const payload = `${ts}.${emailB}`;
  const sig     = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function verifyHmacToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [ts, emailB, sig] = parts;
  const secret = process.env.ADMIN_API_TOKEN;
  if (!secret) return null;

  // Timing-safe signature check
  const payload  = `${ts}.${emailB}`;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const bufSig  = Buffer.from(sig,      'hex');
  const bufExp  = Buffer.from(expected, 'hex');
  if (bufSig.length !== bufExp.length) return null;
  if (!crypto.timingSafeEqual(bufSig, bufExp)) return null;

  // Expiry check
  if (Date.now() - parseInt(ts, 10) > TOKEN_EXPIRY_MS) return null;

  try { return Buffer.from(emailB, 'base64url').toString('utf8'); }
  catch { return null; }
}

// ── Supabase JWT verification ─────────────────────────────────────
async function verifySupabaseToken(token) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  try {
    const sb = createClient(url, key, { auth: { persistSession: false } });
    const { data: { user }, error } = await sb.auth.getUser(token);
    if (error || !user) return null;

    // Verify role = 'admin' in profiles table
    const { data: profile } = await sb
      .from('profiles')
      .select('role, active')
      .eq('id', user.id)
      .single();

    if (!profile || profile.role !== 'admin' || profile.active === false) return null;
    return user.email;
  } catch { return null; }
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Synchronous check: verifies HMAC token only.
 * Use for most admin endpoints (fast, no DB call).
 */
function isAuthorised(req) {
  const token = req.headers['x-admin-token'] || '';
  return !!verifyHmacToken(token);
}

/**
 * Async check: verifies HMAC token OR Supabase JWT.
 * Use when you need the admin's email or Supabase-based auth.
 * Returns admin email string on success, null on failure.
 */
async function verifyAdminRequest(req) {
  const token = req.headers['x-admin-token'] || '';
  if (!token) return null;

  // 1. Try HMAC token (fast, no DB)
  const hmacEmail = verifyHmacToken(token);
  if (hmacEmail) return hmacEmail;

  // 2. Try Supabase JWT (async, DB call)
  const jwtEmail = await verifySupabaseToken(token);
  if (jwtEmail) return jwtEmail;

  return null;
}

module.exports = { issueHmacToken, verifyHmacToken, isAuthorised, verifyAdminRequest };

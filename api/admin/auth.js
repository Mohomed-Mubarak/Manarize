/* ============================================================
   ZENMARKET — Admin Auth Endpoint  (Vercel Serverless)
   ============================================================
   Endpoint: POST /api/admin/auth
   Body:     { email, password }
   Returns:  { token: "<hmac_signed_token>" }  |  { error: string }

   Verifies the legacy env-admin password server-side and issues
   a time-limited HMAC-signed session token.

   This fixes HIGH-1: admin API token was never sent to the browser.
   The browser now exchanges credentials for a scoped session token.

   Also fixes CRIT-3: server-side brute-force tracking by IP.
   ============================================================ */

const crypto              = require('crypto');
const { createClient }    = require('@supabase/supabase-js');
const { issueHmacToken }  = require('./_auth');

// ── Server-side brute-force tracking (H-1 FIX: persistent via Supabase) ─
// Keys: "auth:ip:<ip>" and "auth:email:<email>"
// Uses Supabase rate_limits table — survives Vercel cold starts.
const { createRateLimiter } = require('../_ratelimit');

const BF_MAX_ATTEMPTS = 5;
const BF_WINDOW_MS    = 15 * 60 * 1000; // 15-minute window
const BF_LOCKOUT_MS   = 15 * 60 * 1000; // 15-minute lockout after max attempts

let _rl = null;
function getRateLimiter() {
  if (!_rl) {
    _rl = createRateLimiter(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
  }
  return _rl;
}

async function _isLockedOut(key) {
  try {
    const { limited } = await getRateLimiter().check(key, {
      max:       BF_MAX_ATTEMPTS,
      windowMs:  BF_WINDOW_MS,
      lockoutMs: BF_LOCKOUT_MS,
    });
    return limited;
  } catch (err) {
    // Fail CLOSED on limiter errors for the auth endpoint.
    // Better to block a login attempt than expose brute-force during an outage.
    console.error('[admin/auth] rate-limiter unavailable — failing closed:', err.message);
    return true;
  }
}

// Record failure = call check (it auto-increments count)
async function _recordFailure(key) {
  await getRateLimiter().check(key, {
    max:       BF_MAX_ATTEMPTS,
    windowMs:  BF_WINDOW_MS,
    lockoutMs: BF_LOCKOUT_MS,
  });
}

// Clear by inserting a reset entry — handled by window expiry naturally.
// We use a no-op here; the window will expire on its own.
async function _clearBf(_key) { /* window-based expiry in Supabase */ }

// ── PBKDF2 password verify (mirrors security-utils.js) ───────────
const PBKDF2_PREFIX = 'pbkdf2:';
const PBKDF2_ITERS  = 310_000;

async function verifyPbkdf2(plain, stored) {
  if (!plain || !stored) return false;
  if (!stored.startsWith(PBKDF2_PREFIX)) return false;
  const parts = stored.slice(PBKDF2_PREFIX.length).split(':');
  if (parts.length !== 2) return false;
  const saltHex = parts[0];
  const hashHex = parts[1];
  const salt    = Buffer.from(saltHex, 'hex');
  const derived = await new Promise((resolve, reject) =>
    crypto.pbkdf2(plain, salt, PBKDF2_ITERS, 32, 'sha256', (err, key) =>
      err ? reject(err) : resolve(key)
    )
  );
  const expected = Buffer.from(hashHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
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

module.exports = async function handler(req, res) {
  const origin = process.env.SITE_URL || null;
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const ip = (req.headers['x-forwarded-for'] || '127.0.0.1').split(',')[0].trim();

  let body;
  try { body = await readJson(req); }
  catch { return res.status(400).json({ error: 'Invalid request body' }); }

  const email          = typeof body.email          === 'string' ? body.email.trim().toLowerCase() : '';
  const password       = typeof body.password       === 'string' ? body.password : '';
  const supabaseToken  = typeof body.supabaseToken  === 'string' ? body.supabaseToken  : '';

  // ── Token-exchange path (magic-link admins) ───────────────────
  // If a Supabase JWT is provided instead of email+password,
  // verify it with the service role key and issue an HMAC token.
  if (supabaseToken) {
    const sbUrl = process.env.SUPABASE_URL;
    const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!sbUrl || !sbKey) {
      return res.status(503).json({ error: 'Authentication service not configured' });
    }
    try {
      const sb = createClient(sbUrl, sbKey, { auth: { persistSession: false } });
      const { data: { user }, error: userErr } = await sb.auth.getUser(supabaseToken);
      if (userErr || !user) {
        return res.status(401).json({ error: 'Invalid or expired session' });
      }
      const { data: profile } = await sb
        .from('profiles')
        .select('role, active')
        .eq('id', user.id)
        .single();
      if (!profile || profile.role !== 'admin' || profile.active === false) {
        return res.status(401).json({ error: 'Access denied' });
      }
      const token = issueHmacToken(user.email);
      return res.status(200).json({ token });
    } catch (err) {
      console.error('[admin/auth] token-exchange error:', err.message);
      return res.status(500).json({ error: 'Authentication service error' });
    }
  }

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  // ── Rate limit check ──────────────────────────────────────────
  const ipKey    = `ip:${ip}`;
  const emailKey = `email:${email}`;

  if ((await _isLockedOut(ipKey)) || (await _isLockedOut(emailKey))) {
    return res.status(429).json({ error: 'Too many failed attempts. Try again in 15 minutes.' });
  }

  const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase();
  let verified = false;

  // ── A) Env-admin (legacy) ─────────────────────────────────────
  if (email === adminEmail) {
    const storedHash = process.env.ADMIN_PASSWORD_HASH || '';
    if (!storedHash) {
      // Env var not set — fail securely
      console.error('[admin/auth] ADMIN_PASSWORD_HASH env var not set');
      return res.status(503).json({ error: 'Admin authentication not configured' });
    }
    verified = await verifyPbkdf2(password, storedHash);

    if (!verified) {
      await _recordFailure(ipKey);
      await _recordFailure(emailKey);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    await _clearBf(ipKey);
    await _clearBf(emailKey);

    try {
      const token = issueHmacToken(email);
      return res.status(200).json({ token });
    } catch (err) {
      console.error('[admin/auth] issueHmacToken error:', err.message);
      return res.status(500).json({ error: 'Failed to issue session token' });
    }
  }

  // ── B) Supabase multi-admin ───────────────────────────────────
  const sbUrl = process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!sbUrl || !sbKey) {
    await _recordFailure(ipKey);
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  try {
    const sb = createClient(sbUrl, sbKey, { auth: { persistSession: false } });
    // Use Supabase Auth to verify credentials
    const anonKey = process.env.SUPABASE_ANON_KEY || '';
    if (!anonKey) {
      await _recordFailure(ipKey);
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const sbAnon = createClient(sbUrl, anonKey, { auth: { persistSession: false } });
    const { data: authData, error: authErr } = await sbAnon.auth.signInWithPassword({ email, password });

    if (authErr || !authData?.user) {
      await _recordFailure(ipKey);
      await _recordFailure(emailKey);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Verify admin role
    const { data: profile } = await sb
      .from('profiles')
      .select('role, active')
      .eq('id', authData.user.id)
      .single();

    // Sign out the anon session (we're doing server-side verification)
    await sbAnon.auth.signOut();

    if (!profile || profile.role !== 'admin' || profile.active === false) {
      await _recordFailure(ipKey);
      await _recordFailure(emailKey);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    await _clearBf(ipKey);
    await _clearBf(emailKey);

    // For Supabase admins, issue our HMAC token (not the Supabase JWT)
    // The magic-link flow handles Supabase JWT on the client side
    const token = issueHmacToken(email);
    return res.status(200).json({ token });

  } catch (err) {
    console.error('[admin/auth] Supabase verify error:', err.message);
    return res.status(500).json({ error: 'Authentication service error' });
  }
};

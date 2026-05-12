/* ============================================================
   ZENMARKET — Admin Rate Limiter
   ============================================================
   Wraps the shared rate limiter with admin-specific limits.

   Limits (per IP):
     - General admin endpoints: 120 req / minute
     - Auth endpoint (login):   10 req / minute, 15 min lockout
     - Write endpoints (POST/PUT/DELETE): 30 req / minute

   Usage:
     const { checkAdminRateLimit } = require('./_ratelimit');
     const { limited } = await checkAdminRateLimit(req, res, 'general');
     if (limited) return;   // response already sent
   ============================================================ */

const { createRateLimiter } = require('../_ratelimit');

const rl = createRateLimiter(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const POLICIES = {
  auth:    { max: 10,  windowMs: 60_000, lockoutMs: 15 * 60_000 },
  write:   { max: 30,  windowMs: 60_000 },
  general: { max: 120, windowMs: 60_000 },
};

function getIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

/**
 * Check rate limit for an admin request.
 * Sends 429 and returns { limited: true } if exceeded.
 * Returns { limited: false } when the request may proceed.
 *
 * @param {object} req   - Node HTTP request
 * @param {object} res   - Node HTTP response
 * @param {'auth'|'write'|'general'} type - policy key
 */
async function checkAdminRateLimit(req, res, type = 'general') {
  const policy = POLICIES[type] || POLICIES.general;
  const ip     = getIp(req);
  const key    = `admin:${type}:${ip}`;

  try {
    const { limited } = await rl.check(key, policy);
    if (limited) {
      res.setHeader('Retry-After', '60');
      res.status(429).json({ error: 'Too many requests — please wait before retrying.' });
      return { limited: true };
    }
  } catch (err) {
    // Fail-open: log but don't block legitimate admins on limiter errors
    console.warn('[admin-ratelimit] limiter error (fail-open):', err.message);
  }

  return { limited: false };
}

module.exports = { checkAdminRateLimit };

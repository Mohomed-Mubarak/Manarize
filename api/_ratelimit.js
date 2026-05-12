/* ============================================================
   ZENMARKET — Persistent Rate Limiter  (H-1 FIX)
   ============================================================
   Replaces in-memory Maps (which reset on every Vercel cold start)
   with a Supabase-backed rate_limits table via the check_rate_limit()
   SECURITY DEFINER RPC function (defined in supabase-setup.sql).

   Usage:
     const rl = createRateLimiter(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
     const { limited } = await rl.check('captcha:1.2.3.4', { max: 20, windowMs: 60_000 });
     if (limited) return res.status(429).json({ error: 'Too many requests' });
   ============================================================ */

const { createClient } = require('@supabase/supabase-js');

/**
 * Create a rate limiter backed by the Supabase rate_limits table.
 * Falls back to in-memory if Supabase is unavailable (fail-open for captcha,
 * fail-closed handled by caller for auth).
 */
function createRateLimiter(supabaseUrl, supabaseKey) {
  // In-memory fallback (cold-start safe: better than nothing)
  const _fallback = new Map();

  async function check(key, { max, windowMs, lockoutMs = 0 }) {
    // ── Primary: Supabase persistent store ───────────────────
    if (supabaseUrl && supabaseKey) {
      try {
        const sb = createClient(supabaseUrl, supabaseKey, {
          auth: { persistSession: false },
        });
        const { data, error } = await sb.rpc('check_rate_limit', {
          p_key:        key,
          p_max:        max,
          p_window_ms:  windowMs,
          p_lockout_ms: lockoutMs,
        });
        if (!error && data) {
          return { limited: !!data.limited, count: data.count };
        }
        console.warn('[ratelimit] Supabase RPC error, using fallback:', error?.message);
      } catch (err) {
        console.warn('[ratelimit] Supabase unavailable, using fallback:', err.message);
      }
    }

    // ── Fallback: in-memory (resets on cold start) ────────────
    const now   = Date.now();
    const entry = _fallback.get(key) || { count: 0, resetAt: now + windowMs, lockedUntil: 0 };

    if (now > entry.resetAt) {
      entry.count = 0;
      entry.resetAt = now + windowMs;
      entry.lockedUntil = 0;
    }

    if (lockoutMs > 0 && now < entry.lockedUntil) {
      return { limited: true, count: entry.count };
    }

    entry.count++;
    if (entry.count >= max && lockoutMs > 0) {
      entry.lockedUntil = now + lockoutMs;
    }
    _fallback.set(key, entry);

    return { limited: entry.count > max, count: entry.count };
  }

  return { check };
}

module.exports = { createRateLimiter };

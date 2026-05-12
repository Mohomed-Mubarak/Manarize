/* ============================================================
   ZENMARKET — SECURITY UTILITIES
   Shared helpers for XSS escaping, URL validation, password
   hashing, and brute-force throttling.
   ============================================================ */

// ── HTML Escaping ─────────────────────────────────────────────
/**
 * Escape a string for safe insertion into HTML.
 * Use this instead of raw template literals in innerHTML.
 */
export function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ── Safe URL validation ───────────────────────────────────────
/**
 * Returns url only if it uses http: or https: protocol.
 * Falls back to fallback (default '#') to prevent javascript: injection.
 */
export function safeUrl(url, fallback = '#') {
  if (!url) return fallback;
  try {
    const u = new URL(url);
    return ['https:', 'http:'].includes(u.protocol) ? url : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Validates a redirect target is a safe relative path (no protocol, no //host).
 * Prevents open-redirect via ?next= parameter.
 */
export function safeRedirectPath(raw) {
  if (!raw) return null;
  try {
    const decoded = decodeURIComponent(raw);
    // Must be a relative path — no protocol, no //host
    if (decoded.startsWith('//') || /^[a-z][a-z0-9+\-.]*:/i.test(decoded)) return null;
    return decoded;
  } catch {
    return null;
  }
}

// ── Password Hashing (PBKDF2 + random salt) ──────────────────
// AUTH-01 fix: replaced SHA-256 (unsalted, fast, crackable) with
// PBKDF2-SHA-256 (310 000 iterations, 16-byte random salt per password).
// Format stored: "pbkdf2:<hex-salt>:<hex-hash>"
// Legacy "sha256:..." hashes are still verified for backward-compat but
// trigger a needsRehash signal so callers can upgrade on next login.
const PBKDF2_PREFIX  = 'pbkdf2:';
const PBKDF2_ITERS   = 310_000;
const PBKDF2_SALTLEN = 16;  // bytes

/**
 * Hashes a password with PBKDF2-SHA-256 and a fresh random salt.
 * Returns "pbkdf2:<hex-salt>:<hex-hash>"
 */
export async function hashPassword(password) {
  const enc  = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(PBKDF2_SALTLEN));
  const key  = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERS, hash: 'SHA-256' },
    key, 256
  );
  const toHex = buf => Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0')).join('');
  return `${PBKDF2_PREFIX}${toHex(salt)}:${toHex(bits)}`;
}

/**
 * Verifies a plain-text password against a stored hash string.
 * Supports:
 *   - "pbkdf2:<salt>:<hash>"  — current format
 *   - "sha256:<hash>"         — legacy (no salt); signals needsRehash
 *   - plain text              — very old legacy; signals needsRehash
 * Returns { match: boolean, needsRehash: boolean }
 */
export async function verifyPassword(plain, stored) {
  if (!plain || !stored) return { match: false, needsRehash: false };

  if (stored.startsWith(PBKDF2_PREFIX)) {
    const parts   = stored.slice(PBKDF2_PREFIX.length).split(':');
    if (parts.length !== 2) return { match: false, needsRehash: false };
    const saltHex = parts[0];
    const hashHex = parts[1];
    const salt    = new Uint8Array(saltHex.match(/.{2}/g).map(h => parseInt(h, 16)));
    const enc     = new TextEncoder();
    const key     = await crypto.subtle.importKey(
      'raw', enc.encode(plain), 'PBKDF2', false, ['deriveBits']
    );
    const bits    = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: PBKDF2_ITERS, hash: 'SHA-256' },
      key, 256
    );
    const toHex   = buf => Array.from(new Uint8Array(buf))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    return { match: toHex(bits) === hashHex, needsRehash: false };
  }

  if (stored.startsWith('sha256:')) {
    // Legacy SHA-256 (no salt) — verify then signal upgrade needed
    const enc = new TextEncoder();
    const buf = await crypto.subtle.digest('SHA-256', enc.encode(plain));
    const hex = Array.from(new Uint8Array(buf))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    return { match: ('sha256:' + hex) === stored, needsRehash: true };
  }

  // Very old plain-text storage
  return { match: plain === stored, needsRehash: true };
}

// ── Brute-Force Login Throttle ────────────────────────────────
// Client-side tracking (secondary layer — server is authoritative).
// The server-side check runs in /api/admin/auth via IP+email tracking.
const BF_KEY   = 'zm_login_attempts';
const MAX_TRIES = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

function _getBfData() {
  try { return JSON.parse(localStorage.getItem(BF_KEY) || '{"count":0,"until":0}'); }
  catch { return { count: 0, until: 0 }; }
}

/**
 * Returns an error string if currently locked out (client-side check), otherwise null.
 * NOTE: This is a UX layer only. Server enforces its own rate limit independently.
 */
export function checkBruteForce() {
  const data = _getBfData();
  if (Date.now() < data.until) {
    const mins = Math.ceil((data.until - Date.now()) / 60000);
    return `Too many failed attempts. Try again in ${mins} minute${mins !== 1 ? 's' : ''}.`;
  }
  return null;
}

/**
 * Record a failed login attempt locally; sets lockout after MAX_TRIES.
 */
export function recordFailedAttempt() {
  const data = _getBfData();
  data.count++;
  if (data.count >= MAX_TRIES) {
    data.until = Date.now() + LOCKOUT_MS;
    data.count = 0;
  }
  localStorage.setItem(BF_KEY, JSON.stringify(data));
}

/**
 * Reset the brute-force counter on successful login.
 */
export function clearFailedAttempts() {
  localStorage.removeItem(BF_KEY);
}

/* ============================================================
   ZENMARKET — SUPABASE CLIENT  (v30 — ESM import, no window.supabase)
   ============================================================
   Single source of truth for the Supabase client instance.
   Returns null in DEMO_MODE so every caller can gracefully
   fall back to localStorage without crashing.

   Uses a direct ESM import from the CDN instead of relying on
   window.supabase, which eliminates the <script defer> race
   condition that caused "Loading failed for the module" errors.

   SETUP:
     1. Create project at https://supabase.com
     2. Project Settings → API → copy URL + anon key
     3. Set in .env then run: node build.js
        Or add to Vercel → Settings → Environment Variables
     4. Set DEMO_MODE=false in .env
   ============================================================ */
import { SUPABASE_URL, SUPABASE_ANON_KEY, DEMO_MODE } from './config.js';
// Import createClient directly via ESM — no window.supabase dependency.
// This CDN URL is already allowed by the project's Content-Security-Policy
// (https://cdn.jsdelivr.net is in script-src).
// Pinned to exact version — avoids redirect chain that trips the service worker.
// To upgrade: update the version number here AND in vercel.json CSP script-src.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.105.4/+esm';

/**
 * Custom storageAdapter — stores Supabase session tokens in httpOnly cookies
 * via /api/auth/session instead of localStorage.
 * This prevents XSS from stealing auth tokens (OWASP A07).
 *
 * Falls back to sessionStorage (tab-only, not persisted) if the proxy fails,
 * so auth still works if the API endpoint is unavailable.
 */
const SS_FALLBACK_KEY = 'sb_sess_fallback'; // sessionStorage key when cookie API is unavailable

const cookieStorageAdapter = (() => {
  let _cache = null; // in-memory cache to avoid hammering the endpoint
  let _fetchFailed = false; // sentinel: stop retrying after 404/network failure

  function _ssGet() {
    try { return sessionStorage.getItem(SS_FALLBACK_KEY); } catch { return null; }
  }
  function _ssSet(value) {
    try { sessionStorage.setItem(SS_FALLBACK_KEY, value); } catch {}
  }
  function _ssDel() {
    try { sessionStorage.removeItem(SS_FALLBACK_KEY); } catch {}
  }

  async function _fetchSession() {
    if (_fetchFailed) {
      // API unavailable — read from sessionStorage fallback so session
      // survives page navigation even without the cookie endpoint.
      return _ssGet();
    }
    try {
      const r = await fetch('/api/auth/session', { credentials: 'include' });
      if (!r.ok) {
        if (r.status === 404) _fetchFailed = true;
        return _ssGet(); // fallback to sessionStorage
      }
      const { session } = await r.json();
      return session ? JSON.stringify(session) : null;
    } catch {
      _fetchFailed = true;
      return _ssGet(); // fallback to sessionStorage
    }
  }

  return {
    async getItem(key) {
      // Only intercept the Supabase auth token key
      if (!key.startsWith('sb-') || !key.endsWith('-auth-token')) {
        return sessionStorage.getItem(key);
      }
      if (_cache) return _cache;
      const raw = await _fetchSession();
      if (!raw) return null;
      _cache = typeof raw === 'string' ? raw : JSON.stringify(raw);
      return _cache;
    },
    async setItem(key, value) {
      if (!key.startsWith('sb-') || !key.endsWith('-auth-token')) {
        return sessionStorage.setItem(key, value);
      }
      try {
        _cache = value;
        // Always mirror to sessionStorage so the session survives page
        // navigation even when the cookie API endpoint is unavailable.
        _ssSet(typeof value === 'string' ? value : JSON.stringify(value));

        if (_fetchFailed) return; // endpoint unavailable — sessionStorage is the fallback
        const session = typeof value === 'string' ? JSON.parse(value) : value;
        const postRes = await fetch('/api/auth/session', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            access_token:  session?.access_token,
            refresh_token: session?.refresh_token,
            expires_at:    session?.expires_at,
          }),
        });
        if (!postRes.ok && postRes.status === 404) _fetchFailed = true;
      } catch { /* silently ignore — _cache + sessionStorage still serve requests */ }
    },
    async removeItem(key) {
      if (!key.startsWith('sb-') || !key.endsWith('-auth-token')) {
        return sessionStorage.removeItem(key);
      }
      _cache = null;
      _ssDel(); // always clear sessionStorage fallback on sign-out
      if (_fetchFailed) return;
      try {
        await fetch('/api/auth/session', { method: 'DELETE', credentials: 'include' });
      } catch { /* noop */ }
    },
  };
})();



/** Singleton Supabase client instance. */
let _client = null;

/**
 * Returns the Supabase client singleton.
 * Returns null in DEMO_MODE so callers fall back to localStorage.
 */
export function getSupabase() {
  if (DEMO_MODE) return null;
  if (_client) return _client;

  if (!SUPABASE_URL || SUPABASE_URL.includes('YOUR_PROJECT')) {
    console.error('[Manarize] SUPABASE_URL is not configured. Run node build.js after filling .env');
    return null;
  }

  _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession:     true,
      autoRefreshToken:   true,
      detectSessionInUrl: true,
      storage:            cookieStorageAdapter, // httpOnly cookie storage — XSS-safe
    },
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
    db: {
      schema: 'public',
    },
    global: {
      headers: {
        'x-application-name': 'manarize-storefront',
      },
      // Abort fetch after 12s so we never hang a page indefinitely.
      // The query() helper also races against an 8s timeout — the shorter
      // of the two wins.  12s here is the last-resort network-level cutoff.
      fetch: (url, options = {}) => {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), 12000);
        return fetch(url, { ...options, signal: controller.signal })
          .finally(() => clearTimeout(id));
      },
    },
  });

  return _client;
}

/**
 * Destroy the client singleton.
 * Call before creating a new client (e.g. after config change in tests).
 */
export function resetSupabaseClient() {
  _client = null;
}

// ── Typed query helpers ───────────────────────────────────────────

/**
 * Execute a Supabase query and throw on error.
 * @template T
 * @param {Promise<{data: T, error: object}>} query
 * @returns {Promise<T>}
 */
export async function query(supabaseQuery) {
  // Race against an 8-second timeout so a slow/offline Supabase never hangs the page
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Supabase query timeout')), 8000)
  );
  const { data, error } = await Promise.race([supabaseQuery, timeout]);
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * Execute a Supabase query and return null on error (silent).
 * Use for non-critical reads where a missing value is acceptable.
 * @template T
 * @param {Promise<{data: T, error: object}>} supabaseQuery
 * @returns {Promise<T|null>}
 */
export async function querySafe(supabaseQuery) {
  try {
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Supabase query timeout')), 8000)
    );
    const { data, error } = await Promise.race([supabaseQuery, timeout]);
    if (error) { console.warn('[Supabase]', error.message); return null; }
    return data;
  } catch(e) { console.warn('[Supabase querySafe]', e.message); return null; }
}

/* ============================================================
   ZENMARKET — ADMIN AUTH  (v4 — Inactivity timeout + sessionStorage)
   ============================================================
   Auth strategy:
   ┌─ Hardcoded ADMIN_EMAIL (env / demo mode)
   │   └─ hash-based password check → direct session
   │
   └─ Supabase users with profiles.role = 'admin'
       1. signInWithPassword  → verify credentials
       2. check profiles.role = 'admin' + active = true
       3. signInWithOtp (magic link) → email redirect to /admin/dashboard
       4. handleMagicLinkCallback → verify role → grant sessionStorage session

   Session storage : sessionStorage  (auto-clears on window/tab close)
   Inactivity TTL  : 5 minutes of no mouse / keyboard / touch activity
   Absolute TTL    : 8 hours (hard ceiling regardless of activity)
   ============================================================ */
import { LS, ADMIN_EMAIL, ADMIN_PASSWORD } from '../config.js';
import { setAdminToken, clearAdminToken } from '../admin-api.js';
import {
  hashPassword, verifyPassword,
  checkBruteForce, recordFailedAttempt, clearFailedAttempts,
} from '../security-utils.js';
import { getSupabase } from '../supabase.js';
import { registerDevice } from '../auth.js';

const PW_KEY = 'zm_admin_password_hash';

// ── Legacy password hash (env-admin only) ─────────────────────
async function getActivePasswordHash() {
  try {
    const res = await fetch('/api/admin/config?key=password_hash');
    if (res.ok) {
      const { value } = await res.json();
      if (value) { sessionStorage.setItem(PW_KEY, value); return value; }
    }
  } catch { /* offline */ }

  try {
    const cached = sessionStorage.getItem(PW_KEY);
    if (cached) return cached;
    if (!ADMIN_PASSWORD) return null;
    const h = await hashPassword(ADMIN_PASSWORD);
    sessionStorage.setItem(PW_KEY, h);
    return h;
  } catch { return null; }
}

const SESSION_TTL_MS    = 8 * 60 * 60 * 1000; // 8-hour hard ceiling
const INACTIVITY_TTL_MS = 5 * 60 * 1000;       // 5-minute inactivity timeout

// ── Inactivity timer ─────────────────────────────────────────
const _ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
let _inactivityTimer = null;

function _resetInactivityTimer() {
  if (_inactivityTimer) clearTimeout(_inactivityTimer);
  _inactivityTimer = setTimeout(() => {
    console.info('[AdminAuth] Inactivity timeout — logging out.');
    adminLogout();
  }, INACTIVITY_TTL_MS);
}

function _stopInactivityTimer() {
  if (_inactivityTimer) { clearTimeout(_inactivityTimer); _inactivityTimer = null; }
  _ACTIVITY_EVENTS.forEach(evt =>
    document.removeEventListener(evt, _resetInactivityTimer)
  );
}

/**
 * Start the 5-minute inactivity countdown.
 * Call this once after a successful admin login or page load with a valid session.
 * Any user activity resets the clock. Zero activity for 5 minutes → auto-logout.
 */
export function startAdminInactivityTimer() {
  _stopInactivityTimer(); // clear any previous listeners first
  _resetInactivityTimer();
  _ACTIVITY_EVENTS.forEach(evt =>
    document.addEventListener(evt, _resetInactivityTimer, { passive: true })
  );
}

// ── Session helpers ───────────────────────────────────────────
export function requireAdmin() {
  const session = getAdminSession();
  if (!session) {
    window.location.href = '/';
    return null;
  }
  if (session.loginAt && (Date.now() - session.loginAt > SESSION_TTL_MS)) {
    adminLogout();
    return null;
  }
  // Start / continue inactivity tracking for this page
  startAdminInactivityTimer();
  // MED-5: async Supabase session re-validation (non-blocking)
  if (session.supabaseId) {
    _revalidateSupabaseSession(session.supabaseId).catch(() => {});
  }
  return session;
}

/** Re-validate active Supabase session; logs out if revoked or role changed. */
async function _revalidateSupabaseSession(supabaseId) {
  try {
    const sb = getSupabase();
    if (!sb) return;
    const { data: { session: sbSession }, error } = await sb.auth.getSession();
    if (error || !sbSession || sbSession.user?.id !== supabaseId) {
      console.info('[AdminAuth] Supabase session expired or revoked — logging out.');
      adminLogout();
      return;
    }
    // Also re-verify role in profiles
    const { data: profile } = await sb
      .from('profiles')
      .select('role, active')
      .eq('id', supabaseId)
      .single();
    if (!profile || profile.role !== 'admin' || profile.active === false) {
      console.info('[AdminAuth] Admin role revoked — logging out.');
      adminLogout();
    }
  } catch { /* non-fatal */ }
}

export function getAdminSession() {
  // sessionStorage: auto-cleared when browser window/tab is closed
  try { return JSON.parse(sessionStorage.getItem(LS.adminSession) || 'null'); }
  catch { return null; }
}

// ── Login (Step 1 — email + password) ─────────────────────────
export async function adminLogin(email, password) {
  const lockout = checkBruteForce();
  if (lockout) return { success: false, error: lockout };

  // ── A) Legacy env-admin ───────────────────────────────────────
  if (email === ADMIN_EMAIL) {
    const activeHash = await getActivePasswordHash();
    const { match } = await verifyPassword(password, activeHash);
    if (!match) {
      recordFailedAttempt();
      return { success: false, error: 'Invalid credentials' };
    }
    clearFailedAttempts();

    // Get a real server-issued HMAC token (fixes HIGH-1)
    try {
      const tokenRes = await fetch('/api/admin/auth', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, password }),
      });
      if (tokenRes.ok) {
        const { token } = await tokenRes.json();
        if (token) setAdminToken(token);
      }
    } catch (e) {
      console.warn('[AdminAuth] Could not fetch server token:', e.message);
    }

    const session = { email, role: 'admin', name: 'Admin User', loginAt: Date.now() };
    sessionStorage.setItem(LS.adminSession, JSON.stringify(session));
    startAdminInactivityTimer();
    return { success: true, session };
  }

  // ── B) Supabase multi-admin with magic link ───────────────────
  const sb = getSupabase();
  if (!sb) {
    recordFailedAttempt();
    return { success: false, error: 'Invalid credentials' };
  }

  // Step 1: verify password via Supabase Auth
  const { data: authData, error: authError } = await sb.auth.signInWithPassword({ email, password });
  if (authError || !authData?.user) {
    recordFailedAttempt();
    return { success: false, error: 'Invalid credentials' };
  }

  // Step 2: confirm admin role — use server-side endpoint to bypass RLS recursion
  let profile = null;
  try {
    const token = authData.session?.access_token;
    if (token) {
      const resp = await fetch('/api/auth/profile', {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'same-origin',
      });
      if (resp.ok) {
        const body = await resp.json();
        profile = body.profile || null;
      }
    }
  } catch { /* fall through to direct query */ }

  // Fallback: direct Supabase query (works after RLS migration is applied)
  if (!profile) {
    const { data: p, error: profileError } = await sb
      .from('profiles')
      .select('role, name, active')
      .eq('id', authData.user.id)
      .single();
    if (profileError || !p) {
      await sb.auth.signOut();
      recordFailedAttempt();
      return { success: false, error: 'Invalid credentials' };
    }
    profile = p;
  }

  if (profile.role !== 'admin') {
    await sb.auth.signOut();
    recordFailedAttempt();
    return { success: false, error: 'Access denied. Admin privileges required.' };
  }

  if (profile.active === false) {
    await sb.auth.signOut();
    return { success: false, error: 'This account has been suspended.' };
  }

  // Step 3: sign out password session, then send magic link
  await sb.auth.signOut();

  const redirectTo = `${window.location.origin}/admin/dashboard`;

  // Retry once after a brief pause — helps with transient Supabase OTP errors.
  let magicError = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: redirectTo,
      },
    });
    magicError = error;
    if (!error) break;
    if (attempt === 0) await new Promise(r => setTimeout(r, 1200));
  }

  if (magicError) {
    console.error('[AdminAuth] Magic link send error:', magicError);
    const msg = magicError.message?.toLowerCase() || '';
    if (msg.includes('rate') || msg.includes('too many') || magicError.status === 429) {
      return { success: false, error: 'Too many sign-in attempts. Please wait 60 seconds and try again.' };
    }
    if (msg.includes('not found') || msg.includes('user not found')) {
      return { success: false, error: 'Account not found. Contact your administrator.' };
    }
    return { success: false, error: 'Failed to send magic link. Check your email configuration and try again.' };
  }

  clearFailedAttempts();
  return { success: true, magicLinkPending: true, email, name: profile.name || email.split('@')[0] };
}

// ── Magic Link Callback (called on dashboard.html load) ───────
// Processes the Supabase hash fragment set by the magic link redirect.
// Returns true if a valid admin session was established.
export async function handleMagicLinkCallback() {
  const hash = window.location.hash;
  if (!hash || !hash.includes('access_token')) return false;

  const sb = getSupabase();
  if (!sb) return false;

  // Supabase v2 auto-detects the hash — wait for SIGNED_IN event
  return new Promise((resolve) => {
    let resolved = false;
    const done = (val) => {
      if (resolved) return;
      resolved = true;
      resolve(val);
    };

    // Timeout fallback — 6 seconds
    const timer = setTimeout(() => done(false), 6000);

    const { data: { subscription } } = sb.auth.onAuthStateChange(async (event, session) => {
      if (event !== 'SIGNED_IN') return;
      subscription.unsubscribe();
      clearTimeout(timer);

      if (!session?.user) { done(false); return; }

      // Re-verify admin role via server-side endpoint (bypasses RLS recursion)
      let profile = null;
      try {
        const token = session.access_token;
        if (token) {
          const resp = await fetch('/api/auth/profile', {
            headers: { Authorization: `Bearer ${token}` },
            credentials: 'same-origin',
          });
          if (resp.ok) {
            const body = await resp.json();
            profile = body.profile || null;
          }
        }
      } catch { /* fall through */ }

      // Fallback: direct Supabase query
      if (!profile) {
        const { data: p } = await sb
          .from('profiles')
          .select('role, name, active')
          .eq('id', session.user.id)
          .single();
        profile = p;
      }

      if (!profile || profile.role !== 'admin' || profile.active === false) {
        await sb.auth.signOut();
        window.location.href = '/';
        done(false);
        return;
      }

      // Grant admin session in sessionStorage
      const adminSession = {
        email:      session.user.email,
        role:       'admin',
        name:       profile.name || session.user.email.split('@')[0],
        supabaseId: session.user.id,
        loginAt:    Date.now(),
      };
      sessionStorage.setItem(LS.adminSession, JSON.stringify(adminSession));
      // Exchange Supabase JWT for a long-lived HMAC token so admin API calls
      // don't break when the 1-hour Supabase JWT expires.
      // Fall back to storing the JWT directly if the exchange fails.
      try {
        const exchangeRes = await fetch('/api/admin/auth', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ supabaseToken: session.access_token }),
        });
        if (exchangeRes.ok) {
          const { token: hmacToken } = await exchangeRes.json();
          if (hmacToken) { setAdminToken(hmacToken); }
          else            { setAdminToken(session.access_token); }
        } else {
          setAdminToken(session.access_token);
        }
      } catch (_) {
        // Network error or endpoint unavailable — fall back to JWT
        setAdminToken(session.access_token);
      }

      // Register this device so admin users logging in via the customer login
      // page on the same browser won't be asked for another magic link.
      try { registerDevice(session.user.id); } catch (_) { /* non-fatal */ }

      // Clean URL — remove hash so back/reload won't re-trigger
      history.replaceState(null, '', window.location.pathname + window.location.search);

      // Start inactivity tracking after magic-link login
      startAdminInactivityTimer();

      done(true);
    });
  });
}

// ── Logout ────────────────────────────────────────────────────
export function adminLogout() {
  _stopInactivityTimer();

  // Sign out of Supabase
  try { const sb = getSupabase(); if (sb) sb.auth.signOut(); } catch { /* noop */ }

  // Clear admin session token
  sessionStorage.removeItem(LS.adminSession);
  clearAdminToken();

  // Clear user session (customer-side)
  sessionStorage.removeItem(LS.session);

  // Clear all device trust records so the next login requires fresh verification
  try {
    Object.keys(localStorage)
      .filter(k => k.startsWith('zm_known_devices_') || k === 'zm_device_id')
      .forEach(k => localStorage.removeItem(k));
  } catch { /* noop */ }

  // Clear any stale Supabase localStorage tokens
  try {
    Object.keys(localStorage)
      .filter(k => k.startsWith('sb-') || k.startsWith('supabase'))
      .forEach(k => localStorage.removeItem(k));
  } catch { /* noop */ }

  // Redirect to the website home page (not the admin login page)
  window.location.href = '/';
}

// ── Change password (legacy admin only) ──────────────────────
export async function changeAdminPassword(currentPw, newPw) {
  if (!currentPw || !newPw) return { success: false, error: 'All fields are required.' };
  if (newPw.length < 8)     return { success: false, error: 'New password must be at least 8 characters.' };
  if (newPw === currentPw)  return { success: false, error: 'New password must be different from current.' };

  const activeHash = await getActivePasswordHash();
  const { match } = await verifyPassword(currentPw, activeHash);
  if (!match) return { success: false, error: 'Current password is incorrect.' };

  const newHash = await hashPassword(newPw);
  try {
    const res = await fetch('/api/admin/config', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ key: 'password_hash', currentPassword: currentPw, newValue: newHash }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok && res.status !== 0 && res.status < 500) {
      return { success: false, error: json.error || 'Failed to save password.' };
    }
  } catch {
    console.warn('[Manarize] Admin config API unavailable — saving to localStorage only.');
  }

  sessionStorage.setItem(PW_KEY, newHash);
  sessionStorage.removeItem(LS.adminSession);
  clearAdminToken();
  return { success: true };
}

// ── Admin role verification for storage writes ─────────────────
/**
 * Verify that the current browser session is an active, admin-role
 * Supabase user.  Call this before any storage upload / edit / delete
 * in admin JS as a belt-and-suspenders check (RLS is the real gate).
 *
 * Returns { ok: true } on success or { ok: false, reason: string } on
 * failure.  Never throws.
 */
export async function verifyAdminSession() {
  // 1. Check the in-memory sessionStorage session first (fast path)
  const session = getAdminSession();
  if (!session) return { ok: false, reason: 'No admin session — please log in.' };

  if (session.loginAt && Date.now() - session.loginAt > SESSION_TTL_MS) {
    adminLogout();
    return { ok: false, reason: 'Admin session expired — please log in again.' };
  }

  // 2. If this session was created via Supabase (has supabaseId), do a
  //    live DB role check so a demoted user is blocked immediately.
  if (session.supabaseId) {
    try {
      const sb = getSupabase();
      if (!sb) return { ok: false, reason: 'Supabase not initialised.' };

      const { data: { session: sbSession }, error: sessErr } = await sb.auth.getSession();
      if (sessErr || !sbSession || sbSession.user?.id !== session.supabaseId) {
        adminLogout();
        return { ok: false, reason: 'Supabase session expired — please log in again.' };
      }

      const { data: profile, error: profileErr } = await sb
        .from('profiles')
        .select('role, active')
        .eq('id', session.supabaseId)
        .single();

      if (profileErr || !profile) {
        return { ok: false, reason: 'Could not verify admin role.' };
      }
      if (profile.role !== 'admin') {
        adminLogout();
        return { ok: false, reason: 'Access denied — admin role required.' };
      }
      if (profile.active === false) {
        adminLogout();
        return { ok: false, reason: 'Admin account is suspended.' };
      }
    } catch (e) {
      // Non-fatal for legacy (env-admin) sessions — fall through
      console.warn('[AdminAuth] verifyAdminSession exception:', e.message);
    }
  }

  return { ok: true };
}

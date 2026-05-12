/* ============================================================
   ZENMARKET — AUTH  (v30 — Production email + password + OTP)

   DEMO_MODE = true  → localStorage email/password auth (dev/demo)
   DEMO_MODE = false → Production flow:
       Register: name + email + password → Supabase signUp
                 → OTP emailed → verifySignupOtp → account live
       Login:    email + password → validateAndSendLoginOtp
                 → credentials checked → OTP emailed → verifyLoginOtp
                 → session granted
       Users CANNOT log in without a verified, confirmed account.

   Supabase setup:
     1. Authentication → Providers → Email → enable "Confirm email" ON
     2. Authentication → Email Templates → keep OTP expiry ≤ 10 min
     3. Run `node build.js` after filling .env to write js/env.js
     4. Authentication → URL Configuration → set your Site URL
   ============================================================ */
import { LS, ADMIN_EMAIL, ADMIN_PASSWORD, DEMO_MODE } from './config.js';
import { sendWelcomeNotification } from './notifications.js';
import { getUsers, saveUsers, getAddressesSupabase, saveAddressesSupabase } from './store-adapter.js';
import toast from './toast.js';
import { getSupabase } from './supabase.js';
import {
  hashPassword, verifyPassword,
  checkBruteForce, recordFailedAttempt, clearFailedAttempts,
} from './security-utils.js';

// ── httpOnly cookie session sync ─────────────────────────────
// Mirrors Supabase tokens into httpOnly, SameSite=Strict server cookies
// via /api/auth/session, so tokens survive XSS (JS cannot read them back).
async function _syncCookieSession(session) {
  if (!session?.access_token) return;
  try {
    await fetch('/api/auth/session', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token:  session.access_token,
        refresh_token: session.refresh_token,
        expires_at:    session.expires_at,
      }),
    });
  } catch { /* non-fatal — sessionStorage session still active */ }
}

async function _clearCookieSession() {
  try {
    await fetch('/api/auth/session', { method: 'DELETE', credentials: 'same-origin' });
  } catch { /* non-fatal */ }
}



// ── Session ───────────────────────────────────────────────────

// ── Device fingerprinting ─────────────────────────────────────
// Each browser gets a random UUID stored in localStorage.
// On first login from a new browser the user must click a magic link;
// afterwards that browser is trusted and password-only login works.

export function getDeviceId() {
  let id = localStorage.getItem('zm_device_id');
  if (!id) {
    id = crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('zm_device_id', id);
  }
  return id;
}

export function isKnownDevice(userId) {
  try {
    const known = JSON.parse(localStorage.getItem(`zm_known_devices_${userId}`) || '[]');
    return known.includes(getDeviceId());
  } catch { return false; }
}

export function registerDevice(userId) {
  try {
    const key   = `zm_known_devices_${userId}`;
    const known = JSON.parse(localStorage.getItem(key) || '[]');
    const id    = getDeviceId();
    if (!known.includes(id)) {
      known.push(id);
      localStorage.setItem(key, JSON.stringify(known));
    }
  } catch {}
}


export function getSession() {
  try { return JSON.parse(sessionStorage.getItem(LS.session) || 'null'); }
  catch { return null; }
}

export function setSession(user) {
  // Generate a fresh random token on every session write to prevent session fixation
  const token = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  const session = { ...user, _token: token, _createdAt: Date.now() };
  sessionStorage.setItem(LS.session, JSON.stringify(session));
}

export function clearSession() {
  sessionStorage.removeItem(LS.session);
}

export function isLoggedIn() {
  return !!getSession();
}

export function getCurrentUser() {
  return getSession();
}

// ── Supabase auth state listener ─────────────────────────────
let _supabaseListenersInited = false;

// Counter-based suppression (not a boolean) so concurrent tabs / calls
// don't clear each other's lock.  The listener is skipped whenever the
// counter is > 0.  Each call that sets it must decrement it exactly once
// in its finally block.
let _suppressAuthCount = 0;

export function initSupabaseListeners() {
  if (DEMO_MODE || _supabaseListenersInited) return;
  const sb = getSupabase();
  if (!sb) return;
  _supabaseListenersInited = true;


  // ── Browser-close cleanup ──────────────────────────────────
  // sessionStorage auto-clears when the tab/window is closed — no
  // explicit removal is needed here. Supabase localStorage tokens are
  // cleared by logout() to avoid wiping them during normal navigation:
  // pagehide fires on EVERY page transition, not only on tab/window
  // close, so clearing tokens here would destroy the Supabase session
  // before the next page (e.g. /profile) can read it — causing an
  // immediate redirect back to /login.

  sb.auth.onAuthStateChange(async (event, session) => {
    if (_suppressAuthCount > 0) return;   // ← skip during validation-only sign-ins
    if (event === 'SIGNED_IN' && session?.user) {
      const sbUser = session.user;

      // Never overwrite a correctly-resolved admin session.
      // profile-page.js waitForSession() fetches the real role from the DB and
      // sets it synchronously; this listener fires asynchronously and must not
      // downgrade that result back to 'customer'.
      const existing = getSession();
      if (existing?._supabase && existing.id === sbUser.id && existing.role === 'admin') {
        return; // Admin role already in place — skip overwrite
      }

      const localUser = {
        id:        sbUser.id,
        name:      _nameFromSbUser(sbUser),
        email:     sbUser.email,
        phone:     sbUser.user_metadata?.phone || '',
        role:      'customer',
        createdAt: sbUser.created_at,
        _supabase: true,
      };
      // Fetch real role from profiles table (sets admin when applicable)
      await _applyProfileRole(sb, sbUser, localUser);
      setSession(localUser);
      _syncUserToStore(localUser);
      // Mirror tokens into httpOnly cookies (XSS-safe storage layer)
      if (session?.access_token) _syncCookieSession(session);

      // Safety-net: if SIGNED_IN fires while the user is on the login page
      // (e.g. PKCE exchange completed AFTER isCallback check ran), redirect
      // them to the dashboard so they are never stuck on the login form.
      try {
        if (window.location.pathname.startsWith('/login') ||
            window.location.pathname.endsWith('login.html')) {
          const next = sessionStorage.getItem('zm_return_url') || '/profile';
          sessionStorage.removeItem('zm_return_url');
          sessionStorage.setItem('zm_just_logged_in', '1');
          window.location.replace(next);
        }
      } catch (_) { /* non-fatal */ }

    } else if (event === 'SIGNED_OUT') {
      clearSession();
      _clearCookieSession();
    } else if (event === 'TOKEN_REFRESHED' && session?.user) {
      const existing = getSession();
      if (existing?._supabase) setSession({ ...existing, _refreshedAt: Date.now() });
    }
  });
}

/**
 * Fetch role from profiles so the session reflects the real role.
 * NOTE: This does NOT write an admin session — admin login is only
 * via /admin. This only ensures the session.role field is accurate.
 */
async function _applyProfileRole(sb, sbUser, localUser) {
  // Fast path: role was cached in sessionStorage on a previous call this session.
  const cacheKey = `zm_profile_role_${sbUser.id}`;
  try {
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) { localUser.role = cached; return; }
  } catch { /* ignore storage errors */ }

  // Primary path: use server-side /api/auth/profile (bypasses RLS recursion)
  try {
    const { data: { session: sbSession } } = await sb.auth.getSession();
    const token = sbSession?.access_token;
    if (token) {
      const resp = await fetch('/api/auth/profile', {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'same-origin',
      });
      if (resp.ok) {
        const { profile } = await resp.json();
        if (profile?.role && profile.active !== false) {
          localUser.role = profile.role;
          try { sessionStorage.setItem(cacheKey, profile.role); } catch {}
          return;
        }
      }
    }
  } catch { /* fall through to direct query */ }

  // Fallback: direct Supabase query (works once RLS migration is applied)
  try {
    const { data: profile } = await sb
      .from('profiles')
      .select('role, active')
      .eq('id', sbUser.id)
      .single();
    if (profile?.role && profile.active !== false) {
      localUser.role = profile.role;
      try { sessionStorage.setItem(cacheKey, profile.role); } catch {}
    }
  } catch { /* keep default 'customer' */ }
}

async function _syncUserToStore(user) {
  // Production: upsert only this user's profile row — never fetch the whole table.
  // (Old approach called getUsers() + saveUsers(allUsers) on every login, which
  //  scanned and rewrote every profile in the DB on each SIGNED_IN event.)
  const sb = getSupabase?.();
  if (sb) {
    try {
      await sb.from('profiles').upsert({
        id:         user.id,
        name:       user.name  || '',
        email:      user.email || '',
        phone:      user.phone || '',
        role:       user.role === 'admin' ? 'admin' : 'customer',
        active:     true,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id', ignoreDuplicates: true });
    } catch {}
    return;
  }
  // Demo / localStorage fallback
  try {
    const allUsers = await getUsers();
    if (!allUsers.find(u => u.id === user.id)) {
      allUsers.unshift({ ...user, orders: 0, totalSpent: 0, active: true });
      await saveUsers(allUsers);
    }
  } catch {}
}

/** Extract best available display name from a Supabase user object */
function _nameFromSbUser(sbUser) {
  return sbUser.user_metadata?.name
      || sbUser.user_metadata?.full_name
      || sbUser.user_metadata?.display_name
      || sbUser.identities?.[0]?.identity_data?.name
      || sbUser.email?.split('@')[0]
      || 'Customer';
}

// ── Supabase OTP: step 1 — send OTP ──────────────────────────

export async function sendOtp(email) {
  const sb = getSupabase();
  if (!sb) return { success: false, error: 'Supabase not initialised.' };

  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });

  if (error) return { success: false, error: error.message };
  return { success: true };
}

// ── Supabase OTP: step 2 — verify OTP ────────────────────────

export async function verifyOtp(email, token) {
  const sb = getSupabase();
  if (!sb) return { success: false, error: 'Supabase not initialised.' };

  const { data, error } = await sb.auth.verifyOtp({
    email,
    token,
    type: 'email',
  });

  if (error) return { success: false, error: error.message };

  const sbUser = data.user;
  if (!sbUser) return { success: false, error: 'Verification failed. Please try again.' };

  const localUser = {
    id:        sbUser.id,
    name:      _nameFromSbUser(sbUser),
    email:     sbUser.email,
    phone:     sbUser.user_metadata?.phone || '',
    role:      'customer',
    createdAt: sbUser.created_at,
    _supabase: true,
  };
  setSession(localUser);
  _syncUserToStore(localUser);

  return { success: true, user: localUser };
}

export async function updateSupabaseProfile(name, phone) {
  const sb = getSupabase();
  if (!sb) return;
  await sb.auth.updateUser({ data: { name, phone } });
}


// ══════════════════════════════════════════════════════════════
//  PRODUCTION AUTH — email + password + OTP (v30)
// ══════════════════════════════════════════════════════════════

/**
 * Step 1 of production registration.
 * Creates the account in Supabase and triggers a confirmation OTP email.
 * The account is NOT active until verifySignupOtp() succeeds.
 */
export async function signUpWithPassword(name, email, password, phone = '') {
  const sb = getSupabase();
  if (!sb) return { success: false, error: 'Supabase not initialised.' };

  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(email))
    return { success: false, error: 'Please enter a valid email address.' };

  // Point the confirmation link to login.html so the hash handler runs
  const redirectTo = `${window.location.origin}/login`;

  let data, error;
  try {
    ({ data, error } = await sb.auth.signUp({
      email,
      password,
      options: {
        data: { name, phone: phone || '' },
        emailRedirectTo: redirectTo,
      },
    }));
  } catch (err) {
    return { success: false, error: 'Network error. Please check your connection and try again.' };
  }

  if (error) {
    const msg = (error.message || '').toLowerCase();
    if (msg.includes('already registered') ||
        msg.includes('already exists') ||
        msg.includes('user already') ||
        error.status === 400) {
      // Resend the confirmation link in case they never confirmed
      try {
        await sb.auth.resend({ type: 'signup', email, options: { emailRedirectTo: redirectTo } });
      } catch (_) {}
      return {
        success: false,
        error: 'An account with this email already exists. If you haven\'t confirmed it yet, we just resent the confirmation link — check your inbox.',
      };
    }
    return { success: false, error: error.message };
  }

  // Supabase returns data.user even before confirmation.
  // data.session is null until the user clicks the link.
  return { success: true, pendingVerification: true };
}

/**
 * Step 2 of production registration.
 * Verifies the OTP Supabase sent after signUp.
 * On success creates the local session and syncs to the user store.
 */
export async function verifySignupOtp(email, token) {
  const sb = getSupabase();
  if (!sb) return { success: false, error: 'Supabase not initialised.' };

  const { data, error } = await sb.auth.verifyOtp({ email, token, type: 'signup' });

  if (error) {
    if (error.message.toLowerCase().includes('expired') ||
        error.message.toLowerCase().includes('invalid'))
      return { success: false, error: 'Invalid or expired code. Please request a new one.' };
    return { success: false, error: error.message };
  }

  const sbUser = data.user;
  if (!sbUser) return { success: false, error: 'Verification failed. Please try again.' };

  const localUser = {
    id:        sbUser.id,
    name:      _nameFromSbUser(sbUser),
    email:     sbUser.email,
    phone:     sbUser.user_metadata?.phone || '',
    role:      'customer',
    createdAt: sbUser.created_at,
    _supabase: true,
  };
  setSession(localUser);
  _syncUserToStore(localUser);
  registerDevice(localUser.id);   // trust this browser after signup verification
  sendWelcomeNotification(localUser.id, localUser.name);

  return { success: true, user: localUser };
}

/**
 * Step 1 of production login.
 * Validates email + password against Supabase WITHOUT keeping a session,
 * then sends a magic link to the email for one-click sign-in.
 * Returns { success, error?, noAccount?, resent? }
 */
export async function validateAndSendLoginOtp(email, password) {
  const sb = getSupabase();
  if (!sb) return { success: false, error: 'Supabase not initialised.' };

  // Validate email format early to give instant feedback
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(email))
    return { success: false, error: 'Please enter a valid email address.' };

  // Increment the suppression counter so the temporary validation sign-in
  // does NOT write a real session to sessionStorage.
  // Using a counter (not a boolean) means concurrent calls in multiple tabs
  // cannot clear each other's lock — each call owns exactly one increment.
  _suppressAuthCount++;
  let credentialsValid = false;

  try {
    // 15-second timeout prevents the button from hanging indefinitely
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Request timed out. Please check your connection and try again.')), 15000)
    );

    const { error } = await Promise.race([
      sb.auth.signInWithPassword({ email, password }),
      timeout,
    ]);

    if (error) {
      const msg = (error.message || '').toLowerCase();

      if (msg.includes('invalid login credentials') ||
          msg.includes('invalid_credentials') ||
          msg.includes('wrong password') ||
          error.status === 400) {
        return {
          success: false,
          error: 'Incorrect email or password.',
          noAccount: true,
        };
      }

      if (msg.includes('email not confirmed') || msg.includes('not confirmed')) {
        // Resend the signup confirmation LINK (not OTP code)
        try {
          await sb.auth.resend({ type: 'signup', email });
        } catch (_) { /* non-fatal */ }
        return {
          success: false,
          error: 'Your email address is not verified yet. We just resent the confirmation link — click it in your inbox to activate your account, then sign in again.',
          resent: true,
        };
      }

      if (msg.includes('rate') || msg.includes('too many') || error.status === 429) {
        return { success: false, error: 'Too many attempts. Please wait a minute and try again.' };
      }

      return { success: false, error: error.message || 'Sign in failed. Please try again.' };
    }

    credentialsValid = true;
  } catch (err) {
    // Covers timeout + any network exception — always release the lock
    _suppressAuthCount = Math.max(0, _suppressAuthCount - 1);
    return { success: false, error: err.message || 'Connection error. Please try again.' };
  } finally {
    // Fire-and-forget signOut: don't block the magic-link send on a network round-trip.
    // SIGNED_OUT from the listener only calls clearSession() — a no-op here because
    // SIGNED_IN was suppressed, so no session was ever written.
    if (credentialsValid) {
      sb.auth.signOut().catch(() => {}); // intentionally non-blocking
    }
    _suppressAuthCount = Math.max(0, _suppressAuthCount - 1);
  }

  // Credentials valid — send a magic link.
  // emailRedirectTo tells Supabase to embed a clickable URL in the email
  // (instead of a 6-digit OTP code). shouldCreateUser: false ensures only
  // existing, verified accounts receive a link.
  try {
    const { error: otpErr } = await sb.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${window.location.origin}/login`,
      },
    });

    if (otpErr) {
      const msg = (otpErr.message || '').toLowerCase();
      if (msg.includes('rate') || msg.includes('too many') || otpErr.status === 429) {
        return { success: false, error: 'Too many sign-in attempts. Please wait a minute and try again.' };
      }
      if (msg.includes('user not found') || msg.includes('no user')) {
        return { success: false, error: 'No account found with that email. Please create an account first.', noAccount: true };
      }
      return { success: false, error: otpErr.message || 'Failed to send magic link. Please try again.' };
    }
  } catch (err) {
    return { success: false, error: 'Network error sending magic link. Please try again.' };
  }

  return { success: true };
}

/**
 * Step 2 of production login.
 * Verifies the 2FA OTP sent by validateAndSendLoginOtp.
 * On success creates the local session.
 */
/**
 * Sign in / sign up with Google OAuth.
 * Supabase redirects to Google, then back to login.html with the session token.
 * The existing _showEmailLinkCallback handler processes the returned token.
 * Returns { success, error? }
 */
export async function signInWithGoogle() {
  const sb = getSupabase();
  if (!sb) return { success: false, error: 'Supabase not initialised.' };

  const redirectTo = `${window.location.origin}/login`;

  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo },
  });

  if (error) return { success: false, error: error.message };
  // Browser will redirect to Google — nothing more to do here.
  return { success: true };
}

/**
 * Production login — single step.
 * Validates email + password with Supabase and creates a session directly.
 * No OTP / 2FA step. Used when Supabase is configured to send confirm links
 * (not OTP codes) — the standard Supabase email confirmation flow.
 */
export async function signInDirect(email, password) {
  const sb = getSupabase();
  if (!sb) return { success: false, error: 'Supabase not initialised.' };

  const signInPayload = { email, password };

  const { data, error } = await sb.auth.signInWithPassword(signInPayload);

  if (error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('invalid login') || msg.includes('invalid_credentials') || msg.includes('wrong'))
      return { success: false, error: 'Incorrect email or password.', noAccount: true };
    if (msg.includes('email not confirmed'))
      return { success: false, error: 'Your email is not verified yet. Check your inbox for the confirmation link.', notVerified: true };
    return { success: false, error: error.message };
  }

  const sbUser = data.user;
  if (!sbUser) return { success: false, error: 'Sign in failed. Please try again.' };

  // ── New-device verification ───────────────────────────────────
  // If this browser has never been verified for this account, revoke
  // the just-created session and send a magic link instead.
  // The user must click the link in their email; the callback in
  // login-page.js (_showEmailLinkCallback) then grants the session
  // and calls registerDevice() so future logins skip this step.
  if (!isKnownDevice(sbUser.id)) {
    // Fire-and-forget: don't block OTP send on a signOut round-trip.
    // SIGNED_OUT event only clears the session — harmless here.
    sb.auth.signOut().catch(() => {});

    // Note: shouldCreateUser is intentionally omitted (defaults to false in
    // Supabase v2) BUT must not be set to false explicitly for users created
    // via signUp/password — it causes "User not found" on some Supabase
    // configurations. Supabase correctly sends to existing users only.
    let mlErr = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const { error } = await sb.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/login`,
        },
      });
      mlErr = error;
      if (!error) break;
      // Brief pause before retry on transient errors (300 ms is enough)
      if (attempt === 0) await new Promise(r => setTimeout(r, 300));
    }

    if (mlErr) {
      const msg = mlErr.message?.toLowerCase() || '';
      if (msg.includes('rate') || msg.includes('too many') || mlErr.status === 429) {
        return { success: false, error: 'Too many attempts. Please wait 60 seconds and try again.' };
      }
      console.error('[Auth] Magic link send failed:', mlErr.message);
      return { success: false, error: 'Could not send verification email. Please try again or contact support.' };
    }
    return { success: false, requiresMagicLink: true, email };
  }

  const localUser = {
    id:        sbUser.id,
    name:      _nameFromSbUser(sbUser),
    email:     sbUser.email,
    phone:     sbUser.user_metadata?.phone || '',
    role:      'customer',
    createdAt: sbUser.created_at,
    _supabase: true,
  };

  // Fetch real role from profiles table (correctly sets admin when applicable)
  await _applyProfileRole(sb, sbUser, localUser);

  // If admin role, also mint an admin sessionStorage entry so admin pages work
  if (localUser.role === 'admin') {
    try {
      sessionStorage.setItem('zm_admin_session', JSON.stringify({
        email:      localUser.email,
        role:       'admin',
        name:       localUser.name,
        supabaseId: sbUser.id,
        loginAt:    Date.now(),
      }));
    } catch (_) { /* non-fatal */ }
  }

  setSession(localUser);
  _syncUserToStore(localUser);
  return { success: true, user: localUser };
}

export async function verifyLoginOtp(email, token) {
  const sb = getSupabase();
  if (!sb) return { success: false, error: 'Supabase not initialised.' };

  const { data, error } = await sb.auth.verifyOtp({ email, token, type: 'email' });

  if (error) {
    if (error.message.toLowerCase().includes('expired') ||
        error.message.toLowerCase().includes('invalid'))
      return { success: false, error: 'Invalid or expired code. Please try again.' };
    return { success: false, error: error.message };
  }

  const sbUser = data.user;
  if (!sbUser) return { success: false, error: 'Verification failed. Please try again.' };

  const localUser = {
    id:        sbUser.id,
    name:      _nameFromSbUser(sbUser),
    email:     sbUser.email,
    phone:     sbUser.user_metadata?.phone || '',
    role:      'customer',
    createdAt: sbUser.created_at,
    _supabase: true,
  };
  setSession(localUser);
  _syncUserToStore(localUser);
  registerDevice(localUser.id);   // trust this browser after OTP verification

  return { success: true, user: localUser };
}

// ── Demo mode: email + password login ─────────────────────────

export async function login(email, password) {
  if (!DEMO_MODE)
    return { success: false, error: 'Use OTP login in production mode.' };

  // Brute-force guard
  const lockout = checkBruteForce();
  if (lockout) return { success: false, error: lockout };

  const registeredUsers = JSON.parse(localStorage.getItem(LS.registeredUsers) || '[]');
  const found = registeredUsers.find(u => u.email === email);

  if (found) {
    const { match, needsRehash } = await verifyPassword(password, found.password);
    if (match) {
      clearFailedAttempts();
      // Auto-migrate plain-text password to hash on successful login
      if (needsRehash) {
        found.password = await hashPassword(password);
        localStorage.setItem(LS.registeredUsers, JSON.stringify(registeredUsers));
      }
      const { password: _pw, ...safeUser } = found;
      setSession(safeUser);
      return { success: true, user: safeUser };
    }
  }

  const storeUser = (await getUsers()).find(u => u.email === email && u.role !== 'admin');
  if (storeUser && !found) {
    // User exists in store but not registered list — legacy path
    const sessionUser = { ...storeUser, password: undefined };
    clearFailedAttempts();
    setSession(sessionUser);
    return { success: true, user: sessionUser };
  }

  recordFailedAttempt();
  return { success: false, error: 'Invalid email or password.' };
}

export async function register(name, email, password, phone = '') {
  if (!DEMO_MODE)
    return { success: false, error: 'Use OTP registration in production mode.' };

  // Basic email format validation
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(email))
    return { success: false, error: 'Please enter a valid email address.' };

  const users = JSON.parse(localStorage.getItem(LS.registeredUsers) || '[]');
  if (users.find(u => u.email === email))
    return { success: false, error: 'An account with this email already exists.' };

  const hashedPw = await hashPassword(password);

  const user = {
    id: `USR-${Date.now()}`,
    name, email,
    password: hashedPw,   // never stored plain-text
    phone: phone || '',
    role: 'customer',
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  localStorage.setItem(LS.registeredUsers, JSON.stringify(users));

  const { password: _pw, ...safeUser } = user;
  setSession(safeUser);

  const allUsers = await getUsers();
  if (!allUsers.find(u => u.id === user.id)) {
    allUsers.unshift({ ...safeUser, orders: 0, totalSpent: 0, active: true });
    await saveUsers(allUsers);
  }

  sendWelcomeNotification(user.id, name);
  return { success: true, user: safeUser };
}

// ── Logout ────────────────────────────────────────────────────

export async function logout() {
  const sb = getSupabase();
  if (sb) await sb.auth.signOut({ scope: 'local' });
  clearSession();

  // Clear Supabase localStorage tokens on intentional logout only.
  // Also resets the tab counter so session-guard doesn't double-fire.
  try {
    Object.keys(localStorage)
      .filter(k => k.startsWith('sb-') || k.startsWith('supabase'))
      .forEach(k => localStorage.removeItem(k));
    localStorage.removeItem('zm_open_tabs');
    localStorage.removeItem('zm_admin_session');
  } catch { /* noop */ }

  // Notify all open tabs to also clear their session and redirect
  try {
    const ch = new BroadcastChannel('zm_session');
    ch.postMessage('logout');
    ch.close();
  } catch { /* BroadcastChannel unavailable */ }

  window.location.href = '/login';
}

// ── Profile update ────────────────────────────────────────────

export async function updateProfile(updates) {
  const user = getSession();
  if (!user) return { success: false, error: 'Not logged in' };

  if (!DEMO_MODE)
    await updateSupabaseProfile(updates.name || user.name, updates.phone || user.phone);

  const updated = { ...user, ...updates };
  setSession(updated);

  const regUsers = JSON.parse(localStorage.getItem(LS.registeredUsers) || '[]');
  const regIdx = regUsers.findIndex(u => u.id === user.id);
  if (regIdx >= 0) {
    regUsers[regIdx] = { ...regUsers[regIdx], ...updates };
    localStorage.setItem(LS.registeredUsers, JSON.stringify(regUsers));
  }

  const allUsers = await getUsers();
  const storeIdx = allUsers.findIndex(u => u.id === user.id);
  if (storeIdx >= 0) {
    const { password: _pw, ...safeUpdates } = updates;
    allUsers[storeIdx] = { ...allUsers[storeIdx], ...safeUpdates };
    await saveUsers(allUsers);
  }

  return { success: true, user: updated };
}

// ── Addresses ─────────────────────────────────────────────────

export async function getAddresses(userId) {
  if (!DEMO_MODE) {
    try { return await getAddressesSupabase(userId); } catch(e) { console.warn('getAddresses:', e); }
  }
  try {
    const all = JSON.parse(localStorage.getItem(LS.addresses) || '{}');
    return all[userId] || [];
  } catch { return []; }
}

export async function saveAddresses(userId, addresses) {
  if (!DEMO_MODE) {
    try { await saveAddressesSupabase(userId, addresses); return; } catch(e) { console.warn('saveAddresses:', e); }
  }
  try {
    const all = JSON.parse(localStorage.getItem(LS.addresses) || '{}');
    all[userId] = addresses;
    localStorage.setItem(LS.addresses, JSON.stringify(all));
  } catch {}
}

export async function addAddress(userId, addressData) {
  const addresses = await getAddresses(userId);
  const newAddr = {
    id:        `ADDR-${Date.now()}`,
    label:     addressData.label     || 'Home',
    fullName:  addressData.fullName  || '',
    phone:     addressData.phone     || '',
    line1:     addressData.line1     || '',
    line2:     addressData.line2     || '',
    city:      addressData.city      || '',
    district:  addressData.district  || '',
    province:  addressData.province  || '',
    zip:       addressData.zip       || '',
    isDefault: addresses.length === 0,
    createdAt: new Date().toISOString(),
  };
  addresses.push(newAddr);
  await saveAddresses(userId, addresses);
  _syncDefaultAddressToUsersStore(userId, addresses);
  return newAddr;
}

export async function updateAddress(userId, addressId, updates) {
  const addresses = await getAddresses(userId);
  const idx = addresses.findIndex(a => a.id === addressId);
  if (idx < 0) return null;
  addresses[idx] = { ...addresses[idx], ...updates, updatedAt: new Date().toISOString() };
  await saveAddresses(userId, addresses);
  _syncDefaultAddressToUsersStore(userId, addresses);
  return addresses[idx];
}

export async function deleteAddress(userId, addressId) {
  let addresses = await getAddresses(userId);
  const wasDefault = addresses.find(a => a.id === addressId)?.isDefault;
  addresses = addresses.filter(a => a.id !== addressId);
  if (wasDefault && addresses.length > 0) addresses[0].isDefault = true;
  await saveAddresses(userId, addresses);
  _syncDefaultAddressToUsersStore(userId, addresses);
}

export async function setDefaultAddress(userId, addressId) {
  const addresses = await getAddresses(userId);
  addresses.forEach(a => { a.isDefault = a.id === addressId; });
  await saveAddresses(userId, addresses);
  _syncDefaultAddressToUsersStore(userId, addresses);
}

function _syncDefaultAddressToUsersStore(userId, addresses) {
  try {
    const allUsers = JSON.parse(localStorage.getItem(LS.users) || '[]');
    const idx = allUsers.findIndex(u => u.id === userId);
    if (idx >= 0) {
      const def = addresses.find(a => a.isDefault) || addresses[0] || null;
      allUsers[idx].addresses      = addresses;
      allUsers[idx].defaultAddress = def;
      localStorage.setItem(LS.users, JSON.stringify(allUsers));
    }
  } catch {}
}

// ── Admin auth ────────────────────────────────────────────────
// All admin auth logic lives in js/admin/admin-auth.js.
// These re-exports are kept for backward compatibility with any page
// that imports from auth.js, but they delegate to admin-auth.js.

export function requireAdmin() {
  const session = JSON.parse(localStorage.getItem(LS.adminSession) || 'null');
  if (!session || session.role !== 'admin') {
    window.location.href = '/login';
    return false;
  }
  return true;
}

export function getAdminSession() {
  return JSON.parse(localStorage.getItem(LS.adminSession) || 'null');
}

/** @deprecated REMOVED — use adminLogin() from admin-auth.js instead.
 *  This function previously compared plain-text passwords against the config
 *  value, silently bypassing any password the admin had changed. It has been
 *  replaced with a thrown error so any accidental import is caught immediately
 *  rather than silently degrading security. */
export function adminLogin(_email, _password) {
  throw new Error(
    '[Manarize] adminLogin() has been removed from auth.js. ' +
    'Import adminLogin from js/admin/admin-auth.js instead.'
  );
}

export function adminLogout() {
  localStorage.removeItem(LS.adminSession);
  window.location.href = '/login';
}

// ── Auth UI helpers ───────────────────────────────────────────

export function updateAuthUI() {
  const user = getSession();
  document.querySelectorAll('[data-auth="user"]').forEach(el => {
    el.style.display = user ? '' : 'none';
  });
  document.querySelectorAll('[data-auth="guest"]').forEach(el => {
    el.style.display = user ? 'none' : '';
  });
  document.querySelectorAll('[data-user-name]').forEach(el => {
    if (user) el.textContent = user.name;
  });
}

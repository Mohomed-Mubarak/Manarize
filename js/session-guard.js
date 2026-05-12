/* ============================================================
   MANARIZE — Session Guard
   ============================================================
   Clears Supabase auth tokens + local session when the user
   closes ALL browser tabs/windows (not just navigates away).

   Strategy:
   ─────────
   • Uses localStorage tab counter (`zm_open_tabs`) to track
     how many tabs have the site open simultaneously.
   • Each tab increments on load, decrements on unload.
   • When the counter reaches 0 → all tabs are gone → sign out.
   • `pagehide` with persisted=true = bfcache (back/forward nav)
     → do NOT decrement (tab is still alive in cache).
   • BroadcastChannel notifies other tabs when logout fires so
     they can redirect to /login immediately.

   Why not just sessionStorage?
   ─────────────────────────────
   sessionStorage already clears on tab close, so zm_session
   is wiped automatically. The problem is Supabase stores its
   refresh token in localStorage (sb-*) — those survive tab
   close and let the user stay "logged in" on next visit.
   This module clears those on last-tab-close.

   Import in every page via:
     <script type="module" src="/js/session-guard.js"></script>
   Or add it to your page init bundle.
   ============================================================ */

const TAB_KEY   = 'zm_open_tabs';
const GUARD_KEY = 'zm_session_guard_active';

// ── Helpers ───────────────────────────────────────────────────

function getTabCount() {
  return parseInt(localStorage.getItem(TAB_KEY) || '0', 10);
}

function setTabCount(n) {
  localStorage.setItem(TAB_KEY, Math.max(0, n).toString());
}

/** Wipe all Supabase tokens + local session data. */
function clearAllAuthData() {
  // Supabase localStorage tokens (sb-<project>-auth-token etc.)
  try {
    Object.keys(localStorage)
      .filter(k => k.startsWith('sb-') || k.startsWith('supabase'))
      .forEach(k => localStorage.removeItem(k));
  } catch { /* storage restricted */ }

  // App session keys
  const SESSION_KEYS = ['zm_session', 'zm_admin_session'];
  SESSION_KEYS.forEach(k => {
    try { localStorage.removeItem(k); } catch { /* noop */ }
    try { sessionStorage.removeItem(k); } catch { /* noop */ }
  });

  // Clear the tab counter itself
  try { localStorage.removeItem(TAB_KEY); } catch { /* noop */ }
}

/** Sign out via Supabase JS if available, then clear local data. */
async function signOutAndClear() {
  try {
    // Attempt Supabase server-side signOut (invalidates refresh token)
    const sbKey = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
    if (sbKey) {
      // Dynamically access the already-loaded Supabase client if available
      const mod = await import('./supabase.js').catch(() => null);
      const sb  = mod?.getSupabase?.();
      if (sb) await sb.auth.signOut({ scope: 'local' }).catch(() => {});
    }
  } catch { /* noop — clearAllAuthData below handles the local side */ }
  clearAllAuthData();
}

// ── BroadcastChannel — notify sibling tabs to redirect ────────
let _channel = null;
try {
  _channel = new BroadcastChannel('zm_session');
  _channel.onmessage = (e) => {
    if (e.data === 'logout') {
      // Another tab triggered logout — clear local state and redirect
      clearAllAuthData();
      if (!window.location.pathname.startsWith('/login')) {
        window.location.replace('/login.html');
      }
    }
  };
} catch { /* BroadcastChannel not available (Firefox private, old Safari) */ }

function broadcastLogout() {
  try { _channel?.postMessage('logout'); } catch { /* noop */ }
}

// ── Tab registration ──────────────────────────────────────────

/** Register this tab. Call once on page load. */
function registerTab() {
  // Guard against double-registration on bfcache restores
  if (sessionStorage.getItem(GUARD_KEY)) return;
  sessionStorage.setItem(GUARD_KEY, '1');
  setTabCount(getTabCount() + 1);
}

/** Unregister this tab. Call on page unload (last step). */
async function unregisterTab(isPersisted) {
  // bfcache — page is frozen, not gone; don't decrement
  if (isPersisted) return;

  // Already unregistered (pagehide + beforeunload both fire on close)
  if (!sessionStorage.getItem(GUARD_KEY)) return;
  sessionStorage.removeItem(GUARD_KEY);

  const newCount = getTabCount() - 1;
  setTabCount(newCount);

  if (newCount <= 0) {
    // Last tab closing — sign out
    broadcastLogout();
    await signOutAndClear();
  }
}

// ── Event listeners ───────────────────────────────────────────

// Register on load
registerTab();

// pagehide fires reliably on tab close, navigation, and bfcache freeze.
// It replaces beforeunload for session cleanup (works on mobile too).
window.addEventListener('pagehide', (e) => {
  unregisterTab(e.persisted); // e.persisted = true → bfcache, NOT a close
}, { capture: true });

// beforeunload as a belt-and-suspenders fallback for desktop browsers.
// Does NOT fire on mobile or bfcache navigations — pagehide handles those.
window.addEventListener('beforeunload', () => {
  if (!sessionStorage.getItem(GUARD_KEY)) return; // already handled
  const newCount = getTabCount() - 1;
  setTabCount(newCount);
  if (newCount <= 0) {
    broadcastLogout();
    // Synchronous clear only (async signOut can't complete in beforeunload)
    clearAllAuthData();
  }
  // Remove guard so pagehide doesn't double-decrement
  sessionStorage.removeItem(GUARD_KEY);
}, { capture: true });

// Recover from corrupted tab count on storage events
// (e.g. user manually cleared localStorage mid-session)
window.addEventListener('storage', (e) => {
  if (e.key === TAB_KEY && e.newValue === null) {
    // Tab count was wiped — re-register this tab
    registerTab();
  }
});

// ── Admin pages: shorter idle timeout ────────────────────────
// Admin sessions get an extra 30-minute inactivity timeout.
// If the admin leaves the dashboard idle, they are signed out
// even if the tab stays open.
const IS_ADMIN_PAGE = window.location.pathname.startsWith('/admin');
const ADMIN_IDLE_MS = 30 * 60 * 1000; // 30 minutes

if (IS_ADMIN_PAGE) {
  let _idleTimer = null;

  function resetIdleTimer() {
    clearTimeout(_idleTimer);
    _idleTimer = setTimeout(async () => {
      broadcastLogout();
      await signOutAndClear();
      window.location.replace('/login.html');
    }, ADMIN_IDLE_MS);
  }

  ['mousemove', 'keydown', 'pointerdown', 'scroll', 'touchstart'].forEach(evt =>
    document.addEventListener(evt, resetIdleTimer, { passive: true })
  );

  resetIdleTimer(); // start timer on page load
}

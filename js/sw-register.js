/* ============================================================
   MANARIZE — Service Worker Registration
   ============================================================
   Handles registration, updates, and cleanup of stale SWs.
   Runs after window load so it never competes with critical
   resource fetches during page startup.
   ============================================================ */

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;

  try {
    // ── Unregister any stale/broken service workers first ──────
    // This clears old SWs that intercept cross-origin requests
    // (the bug that caused Supabase/CDN CORS failures).
    const existing = await navigator.serviceWorker.getRegistrations();
    for (const reg of existing) {
      const swUrl = reg.active?.scriptURL || reg.installing?.scriptURL || '';
      // Unregister any SW that is NOT pointing at our current /sw.js
      // or that was registered from a different path (legacy).
      if (!swUrl.endsWith('/sw.js')) {
        await reg.unregister();
        console.info('[SW] Unregistered stale SW:', swUrl);
      }
    }

    // ── Register / update the current SW ───────────────────────
    const reg = await navigator.serviceWorker.register('/sw.js', {
      scope:          '/',
      updateViaCache: 'none', // always re-fetch sw.js; never use HTTP cache
    });

    // Periodic update check on long-lived pages (dashboard, admin)
    setInterval(() => reg.update(), 60 * 1000);

    reg.addEventListener('updatefound', () => {
      const newWorker = reg.installing;
      newWorker?.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          console.info('[SW] New version ready. Refresh for updates.');
        }
      });
    });

  } catch (err) {
    console.warn('[SW] Registration error:', err);
  }
}

// Auto-register after window load (never block page startup)
window.addEventListener('load', () => registerServiceWorker(), { once: true });

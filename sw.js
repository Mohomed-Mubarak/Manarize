/* ============================================================
   MANARIZE — Service Worker  (Same-Origin Only)
   ============================================================
   Strategy:
     • Same-origin static assets (CSS/JS/images) → Cache-First
     • Same-origin HTML pages                    → Network-First
     • ALL cross-origin requests                 → PASSTHROUGH (never intercept)
     • API calls                                 → PASSTHROUGH (never cache)

   Cross-origin passthrough is critical — intercepting CDN requests
   (fonts.gstatic.com, cdn.jsdelivr.net, supabase.co) causes CORS
   failures because opaque responses cannot be safely cached or cloned.
   ============================================================ */

const CACHE_VERSION = 'v3'; // mobile perf update // bumped — kills old v1 SW in all browsers
const STATIC_CACHE  = `static-${CACHE_VERSION}`;
const HTML_CACHE    = `html-${CACHE_VERSION}`;

const PRECACHE_URLS = [
  '/css/variables.css',
  '/css/base.css',
  '/css/components.css',
  '/css/layout.css',
  '/css/mobile.css',
  '/dist/js/env.js',
  '/dist/js/config.js',
  '/dist/js/theme-init.js',
  '/dist/js/loader.js',
  '/dist/js/toast.js',
  '/dist/js/utils.js',
  '/favicon.svg',
];

// ── Install ───────────────────────────────────────────────────
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache =>
      cache.addAll(PRECACHE_URLS).catch(err =>
        console.warn('[SW] Pre-cache partial failure:', err)
      )
    )
  );
});

// ── Activate ──────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== STATIC_CACHE && k !== HTML_CACHE)
            .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch ─────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // ── RULE 1: Only GET requests ─────────────────────────────
  if (request.method !== 'GET') return;

  // ── RULE 2: SKIP all cross-origin requests entirely ───────
  // Intercepting CDN/Supabase/font requests causes CORS failures.
  // The browser handles cross-origin caching via its own HTTP cache.
  if (url.origin !== self.location.origin) return;

  // ── RULE 3: SKIP API routes (never cache) ─────────────────
  if (url.pathname.startsWith('/api/')) return;

  // ── RULE 4: SKIP service worker itself ────────────────────
  if (url.pathname === '/sw.js') return;

  // ── Same-origin static assets → Cache-First ───────────────
  const isStatic = /\.(css|js|woff2?|ttf|svg|ico|png|jpg|jpeg|webp|gif)(\?|$)/.test(url.pathname);
  if (isStatic) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // ── Same-origin HTML → Network-First ──────────────────────
  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Everything else: passthrough (no interception)
});

// ── Cache-First (static assets) ───────────────────────────────
async function cacheFirst(request) {
  const cache  = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) {
    // Background revalidation — never blocks the response
    fetch(request).then(resp => {
      if (resp?.ok) cache.put(request, resp.clone());
    }).catch(() => {});
    return cached;
  }
  try {
    const resp = await fetch(request);
    if (resp?.ok) cache.put(request, resp.clone());
    return resp;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}

// ── Network-First (HTML pages) ────────────────────────────────
async function networkFirst(request) {
  const cache = await caches.open(HTML_CACHE);
  try {
    const resp = await fetch(request);
    if (resp?.ok) cache.put(request, resp.clone());
    return resp;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response('<h1>You are offline</h1>', {
      status: 503,
      headers: { 'Content-Type': 'text/html' },
    });
  }
}

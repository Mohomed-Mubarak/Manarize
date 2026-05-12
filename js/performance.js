/* ============================================================
   ZENMARKET — PERFORMANCE  (PageSpeed 90+ toolkit)
   ============================================================
   • WebP URL helper (Unsplash / Supabase Storage)
   • Lazy-load observer for dynamically injected images
   • Interaction-based deferred loading (analytics, chat widgets)
   • Prefetch next-page on link hover
   ============================================================ */

// ── 1. WebP URL Helper ────────────────────────────────────────
/**
 * Convert an image URL to its WebP-optimised equivalent.
 * Supports Unsplash and Supabase Storage transforms.
 * Falls back to the original URL if the format is unknown.
 *
 * @param {string} url   Original image URL
 * @param {number} w     Desired width in px (default 600)
 * @param {number} q     Quality 1-100 (default 80)
 * @returns {string}     WebP-optimised URL
 */
export function toWebP(url, w = 600, q = 80) {
  if (!url) return url;

  // Unsplash → append format=webp, w, q
  if (url.includes('images.unsplash.com')) {
    const u = new URL(url);
    u.searchParams.set('fm',   'webp');
    u.searchParams.set('w',    String(w));
    u.searchParams.set('q',    String(q));
    u.searchParams.set('fit',  'crop');
    return u.toString();
  }

  // Supabase Storage — the /render/image/ transform endpoint requires
  // Supabase Pro / image-transformation add-on. Calling it on free-tier
  // returns a JSON error, which the browser blocks via ORB (Opaque Response
  // Blocking) when the request comes from an <img> tag.
  // Safe fix: always serve the plain /storage/v1/object/public/ URL.
  // If the URL was already rewritten to a render URL, convert it back.
  if (url.includes('supabase.co/storage')) {
    return url
      .replace('/storage/v1/render/image/public/', '/storage/v1/object/public/')
      .replace(/[?&](width|quality|format)=[^&]*/g, '')
      .replace(/[?&]$/, '');
  }

  // Already a data URI or non-transformable URL — return as-is
  return url;
}

// ── 2. Lazy-load Observer ─────────────────────────────────────
/**
 * Observe <img> elements with data-src and swap src on viewport entry.
 * Call this after injecting new product cards into the DOM.
 *
 * @param {HTMLElement} root  Parent element to scope the search
 */
export function lazyObserve(root = document) {
  if (!('IntersectionObserver' in window)) {
    // Fallback: load everything immediately
    root.querySelectorAll('img[data-src]').forEach(img => {
      img.src = img.dataset.src;
      img.removeAttribute('data-src');
    });
    return;
  }

  const io = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const img = entry.target;
      img.src = img.dataset.src;
      img.removeAttribute('data-src');
      img.classList.add('img-loaded');
      obs.unobserve(img);
    });
  }, { rootMargin: '200px' });   // start loading 200px before viewport

  root.querySelectorAll('img[data-src]').forEach(img => io.observe(img));
}

// ── 3. Interaction-based Deferred Loading ────────────────────
/**
 * Defer non-critical third-party scripts (analytics, chat)
 * until the first user interaction (click, scroll, keydown).
 *
 * @param {Function} loader  Function that injects the script tags
 */
export function deferOnInteraction(loader) {
  const events = ['click', 'scroll', 'keydown', 'touchstart', 'mousemove'];
  function onInteract() {
    events.forEach(e => window.removeEventListener(e, onInteract));
    loader();
  }
  events.forEach(e => window.addEventListener(e, onInteract, { once: true, passive: true }));
}

// ── 4. Link Prefetch on Hover ─────────────────────────────────
/**
 * Prefetch a page URL on hover to make navigation feel instant.
 * Only prefetches once per URL and respects Save-Data header.
 *
 * @param {string} selector  CSS selector for <a> elements
 */
export function prefetchOnHover(selector = 'a[href]') {
  if (navigator.connection?.saveData) return;  // respect data-saver mode

  const prefetched = new Set();

  document.addEventListener('mouseover', e => {
    const link = e.target.closest(selector);
    if (!link) return;
    const rawHref = link.getAttribute('href');
    if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('javascript')) return;
    // Skip external URLs — CSP blocks cross-origin prefetch under default-src
    try {
      const url = new URL(rawHref, location.origin);
      if (url.origin !== location.origin) return;
    } catch { return; }
    // Strip .html extension — Vercel cleanUrls redirects .html → clean URL (308)
    const href = rawHref.replace(/\.html(?=\?|#|$)/, '');
    if (prefetched.has(href)) return;
    prefetched.add(href);

    const el = document.createElement('link');
    el.rel  = 'prefetch';
    el.href = href;
    document.head.appendChild(el);
  });
}

// ── 5. Critical CSS Inliner Helper ───────────────────────────
/**
 * Mark a <link rel="stylesheet"> as non-render-blocking using
 * the media trick. Call for non-critical CSS files.
 *
 * Usage in HTML:
 *   <link rel="stylesheet" href="animations.css" media="print" onload="this.media='all'">
 *
 * This JS helper does the same dynamically.
 *
 * @param {string} href  CSS file URL to load asynchronously
 */
export function loadCSSAsync(href) {
  const link    = document.createElement('link');
  link.rel      = 'stylesheet';
  link.href     = href;
  link.media    = 'print';
  link.onload   = () => { link.media = 'all'; };
  document.head.appendChild(link);
}

// ── 6. Fast-click: Remove 300ms tap delay on mobile ──────────
export function initFastClick() {
  if ('ontouchstart' in window) {
    document.documentElement.style.setProperty('touch-action', 'manipulation');
  }
}

// ── 7. Responsive image srcset builder ───────────────────────
export function buildSrcset(url, q = 75) {
  if (!url || !url.includes('unsplash.com')) return '';
  const widths = [320, 480, 640, 900, 1200];
  return widths.map(w => `${toWebP(url, w, q)} ${w}w`).join(', ');
}

// ── 8. Adaptive quality by connection ────────────────────────
export function adaptiveQuality() {
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!conn) return 75;
  if (conn.saveData) return 40;
  const map = { 'slow-2g': 40, '2g': 50, '3g': 65, '4g': 80 };
  return map[conn.effectiveType] ?? 75;
}

// ── 9. Scroll restoration ─────────────────────────────────────
export function initScrollRestoration() {
  if ('scrollRestoration' in history) history.scrollRestoration = 'auto';
}

// ── 10. Safe-area insets for notch devices ────────────────────
export function initSafeArea() {
  const meta = document.querySelector('meta[name="viewport"]');
  if (meta && !meta.content.includes('viewport-fit')) {
    meta.content += ', viewport-fit=cover';
  }
}

// ── 11. Auto-init on module load ─────────────────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    prefetchOnHover();
    initFastClick();
    initScrollRestoration();
    initSafeArea();
    _initSW();
  });
} else {
  prefetchOnHover();
  initFastClick();
  initScrollRestoration();
  initSafeArea();
  _initSW();
}

// ── 12. Service Worker registration (deferred) ───────────────
function _initSW() {
  if (!('serviceWorker' in navigator)) return;
  // Defer SW registration until after page load to avoid competing
  // with critical resource fetches during startup.
  window.addEventListener('load', () => {
    import('./sw-register.js').catch(() => {/* SW optional */});
  }, { once: true });
}

// ── 13. Core Web Vitals reporter ─────────────────────────────
/**
 * Observe LCP, CLS, FID, and INP.
 * Pass a callback to send metrics to your analytics endpoint.
 * @param {(metric: {name: string, value: number, rating: string}) => void} onMetric
 */
export function observeWebVitals(onMetric) {
  if (typeof PerformanceObserver === 'undefined') return;

  // LCP — Largest Contentful Paint
  try {
    new PerformanceObserver(list => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1];
      const rating = last.startTime < 2500 ? 'good' : last.startTime < 4000 ? 'needs-improvement' : 'poor';
      onMetric({ name: 'LCP', value: Math.round(last.startTime), rating });
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch {}

  // CLS — Cumulative Layout Shift
  try {
    let clsValue = 0;
    let sessionValue = 0;
    let sessionEntries = [];
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) {
          const firstEntry = sessionEntries[0];
          const lastEntry  = sessionEntries[sessionEntries.length - 1];
          if (sessionValue &&
              entry.startTime - lastEntry.startTime < 1000 &&
              entry.startTime - firstEntry.startTime < 5000) {
            sessionValue += entry.value;
            sessionEntries.push(entry);
          } else {
            sessionValue = entry.value;
            sessionEntries = [entry];
          }
          if (sessionValue > clsValue) {
            clsValue = sessionValue;
            const rating = clsValue < 0.1 ? 'good' : clsValue < 0.25 ? 'needs-improvement' : 'poor';
            onMetric({ name: 'CLS', value: Math.round(clsValue * 1000) / 1000, rating });
          }
        }
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch {}

  // FID — First Input Delay
  try {
    new PerformanceObserver(list => {
      const entry = list.getEntries()[0];
      const fid = entry.processingStart - entry.startTime;
      const rating = fid < 100 ? 'good' : fid < 300 ? 'needs-improvement' : 'poor';
      onMetric({ name: 'FID', value: Math.round(fid), rating });
    }).observe({ type: 'first-input', buffered: true });
  } catch {}

  // INP — Interaction to Next Paint (replaces FID in CWV 2024+)
  try {
    let maxINP = 0;
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        const inp = entry.processingStart - entry.startTime + entry.duration;
        if (inp > maxINP) {
          maxINP = inp;
          const rating = maxINP < 200 ? 'good' : maxINP < 500 ? 'needs-improvement' : 'poor';
          onMetric({ name: 'INP', value: Math.round(maxINP), rating });
        }
      }
    }).observe({ type: 'event', buffered: true, durationThreshold: 16 });
  } catch {}

  // TTFB — Time To First Byte
  try {
    new PerformanceObserver(list => {
      const entry = list.getEntries()[0];
      const ttfb = entry.responseStart - entry.requestStart;
      const rating = ttfb < 800 ? 'good' : ttfb < 1800 ? 'needs-improvement' : 'poor';
      onMetric({ name: 'TTFB', value: Math.round(ttfb), rating });
    }).observe({ type: 'navigation', buffered: true });
  } catch {}
}

// ── 14. Intersection-based component loader (code splitting) ──
/**
 * Load a module only when a DOM element scrolls into view.
 * Reduces initial JS parse time for below-fold components.
 * @param {string} selector  Element that triggers the load
 * @param {() => Promise<any>} loader  Dynamic import function
 */
export function lazyLoadComponent(selector, loader) {
  const el = document.querySelector(selector);
  if (!el) return;
  if (!('IntersectionObserver' in window)) { loader(); return; }

  const io = new IntersectionObserver(([entry], obs) => {
    if (!entry.isIntersecting) return;
    obs.disconnect();
    loader();
  }, { rootMargin: '400px' });

  io.observe(el);
}

// ── 15. Memory-safe image pool (prevent leak on SPA navigation) ─
/**
 * Cancel all pending lazy-load observers before navigating away.
 * Store the returned cleanup fn and call it on page unload.
 */
export function createLazyPool(root = document) {
  const observers = [];
  const io = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const img = entry.target;
      img.src = img.dataset.src || img.src;
      img.removeAttribute('data-src');
      img.classList.add('img-loaded');
      obs.unobserve(img);
    });
  }, { rootMargin: '200px' });
  observers.push(io);
  root.querySelectorAll('img[data-src]').forEach(img => io.observe(img));
  return () => observers.forEach(o => o.disconnect());
}


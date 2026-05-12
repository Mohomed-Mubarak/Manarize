/* ============================================================
   ZENMARKET — PAGE LOADER  (v22 — black-screen fix)
   ============================================================ */

export function showLoader() {
  const loader = document.getElementById('page-loader');
  const bar    = document.getElementById('page-progress');
  if (loader) loader.classList.remove('hidden');
  if (bar)    { bar.classList.add('active'); bar.classList.remove('done'); }
}

export function hideLoader() {
  const loader = document.getElementById('page-loader');
  const bar    = document.getElementById('page-progress');
  if (loader) {
    // Small delay so content is painted before loader disappears
    setTimeout(() => loader.classList.add('hidden'), 200);
  }
  if (bar) {
    bar.classList.add('done');
    setTimeout(() => {
      bar.classList.remove('active', 'done');
      bar.style.width = '0';
    }, 500);
  }
}

/**
 * Wrap every page's init function with this.
 * Handles show/hide loader + scroll-reveal init.
 */
export async function withLoader(fn) {
  // Ensure loader is visible immediately
  showLoader();

  // Safety net: always dismiss loader after 3s max
  // so the page is NEVER left on a black screen
  const safetyTimer = setTimeout(() => hideLoader(), 3000);

  try {
    await fn();
  } catch (err) {
    console.error('[Manarize] Page init error:', err);
  } finally {
    clearTimeout(safetyTimer);
    hideLoader();
    initScrollReveal();
  }
}

// ── Global safety nets for uncaught module errors ─────────────
// If a <script type="module"> has a syntax/import error, these
// fire hideLoader so the page is never permanently black.
window.addEventListener('error',             () => hideLoader());
window.addEventListener('unhandledrejection',() => hideLoader());

// ── DOMContentLoaded safety net ───────────────────────────────
// If the page JS never calls withLoader (e.g. empty module),
// hide loader once DOM is ready as a last resort.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    // Give JS 800ms to call withLoader; if not, force-hide
    setTimeout(() => {
      const loader = document.getElementById('page-loader');
      if (loader && !loader.classList.contains('hidden')) {
        hideLoader();
      }
    }, 800);
  });
}

// ── Scroll-reveal (IntersectionObserver) ─────────────────────
function initScrollReveal() {
  const elements = document.querySelectorAll('.reveal');
  if (!elements.length) return;

  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('revealed');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -30px 0px' });

  elements.forEach(el => observer.observe(el));
}

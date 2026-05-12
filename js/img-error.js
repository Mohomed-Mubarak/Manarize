/* ============================================================
   IMG-ERROR — Centralised image-error + skeleton handler
   ============================================================
   Replaces ALL inline onerror= / onload= attributes on <img> tags.
   Uses capture-phase listeners so they intercept even inside
   dynamically-created markup.

   Behaviour driven by data attributes on each <img>:
     data-err-hide   — hide the image on error (display:none)
     data-err-fade   — reduce opacity to 0.3
     data-err-src    — swap src to this fallback URL
     data-err-fn     — call window[value](img) as a named handler
     data-skeleton   — add class 'loaded' to parentElement on load OR error
     (no attribute)  — call window.__imgErr(img) if defined
   ============================================================ */

(function initImgErrorHandler() {
  document.addEventListener('error', function handleImgError(e) {
    const img = e.target;
    if (!img || img.tagName !== 'IMG') return;

    if (img.dataset.skeleton !== undefined) {
      img.parentElement?.classList.add('loaded');
    }

    if (img.dataset.errHide !== undefined) {
      img.style.display = 'none';
      return;
    }
    if (img.dataset.errFade !== undefined) {
      img.style.opacity = '0.3';
      return;
    }
    if (img.dataset.errSrc) {
      if (img.src !== img.dataset.errSrc) img.src = img.dataset.errSrc;
      return;
    }
    if (img.dataset.errFn) {
      const fn = window[img.dataset.errFn];
      if (typeof fn === 'function') fn(img);
      return;
    }
    if (typeof window.__imgErr === 'function') {
      window.__imgErr(img);
    }
  }, true /* capture phase */);

  document.addEventListener('load', function handleImgLoad(e) {
    const img = e.target;
    if (!img || img.tagName !== 'IMG') return;
    if (img.dataset.skeleton !== undefined) {
      img.parentElement?.classList.add('loaded');
    }
  }, true /* capture phase */);
})();

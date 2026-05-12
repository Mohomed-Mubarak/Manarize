/* ============================================================
   MANARIZE — Deferred Stylesheet Loader
   ============================================================
   Activates all <link> tags marked with data-defer="true".
   These are initially set to media="print" (non-render-blocking)
   and switched to media="all" once the page has loaded.

   This replaces inline onload handlers which are blocked by CSP
   script-src-elem directives (no hash/nonce for inline scripts).

   Usage in HTML:
     <link rel="stylesheet" href="..." media="print" data-defer="true">
   ============================================================ */

(function () {
  function activateDeferredLinks() {
    document.querySelectorAll('link[data-defer="true"]').forEach(function (link) {
      link.media = 'all';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', activateDeferredLinks);
  } else {
    activateDeferredLinks();
  }
  // Also fire on window load as a safety net
  window.addEventListener('load', activateDeferredLinks);
})();

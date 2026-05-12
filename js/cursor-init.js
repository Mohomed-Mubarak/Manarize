/* Cursorly custom cursor — desktop/mouse only
   Skip on touch devices and any device without a fine pointer (mobile, tablet).
   Wrapped in try-catch: if CDN is unreachable the page silently uses the OS cursor. */
var _isDesktopPointer = !('ontouchstart' in window) &&
  window.matchMedia('(pointer:fine)').matches;

if (_isDesktopPointer) {
  window.addEventListener('load', function () {
    try {
      if (typeof Cursorly === 'undefined') return;
      var c = Cursorly.init();
      try { c.setIcon(6); } catch (_) { /* icon unavailable — keep default cursor */ }
    } catch (e) {
      /* Cursorly failed to initialise — no custom cursor, no crash */
    }
  });
}

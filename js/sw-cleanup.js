/* ============================================================
   MANARIZE — Service Worker Cleanup (runs at <head> parse time)
   ============================================================
   Unregisters ANY service worker that:
     • Is not /sw.js  (stale path), OR
     • Predates cache version v2 (old buggy SW)

   This runs synchronously at the top of <head> so it fires
   before any ES module imports can trigger the old SW.

   File is intentionally tiny — no dependencies.
   ============================================================ */
(function () {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.getRegistrations().then(function (regs) {
    regs.forEach(function (reg) {
      var url = (reg.active || reg.installing || reg.waiting || {}).scriptURL || '';
      // Unregister if: not our sw.js at all, or an old cached copy
      // We detect old copies by checking the URL doesn't include '/sw.js'
      var isOurs = url.indexOf('/sw.js') !== -1 && url.indexOf('manarize') !== -1 || url.endsWith('/sw.js');
      if (!isOurs) {
        reg.unregister().then(function (ok) {
          if (ok) console.info('[SW-cleanup] Removed stale SW:', url);
        });
      }
    });
  }).catch(function () {/* ignore in restricted contexts */});
})();

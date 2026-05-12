/**
 * THEME-INIT.JS — Pre-Paint Theme Initialiser
 * ─────────────────────────────────────────────
 * Runs synchronously before the first paint (placed before any <link> tag)
 * to prevent FOUC (Flash of Unstyled Content).
 * Reads the saved theme from localStorage and sets
 * data-theme on <html> so CSS variables resolve correctly from frame 0.
 */

// Theme initializer — runs before first paint to avoid FOUC
!function () { var t = localStorage.getItem("zm_theme"); t && "dark" !== t && document.documentElement.setAttribute("data-theme", t) }();

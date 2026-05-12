/* ============================================================
   ZENMARKET — hCaptcha
   Checkbox-based CAPTCHA for Login, Signup, and Contact forms.

   Usage:
     import { initCaptcha, getWidgetToken, resetWidget } from './recaptcha.js';

     // 1. Render — call once after the container is in the DOM
     const widgetId = await initCaptcha('my-captcha-container');

     // 2. Validate before submit
     const token = getWidgetToken(widgetId);
     if (!token) { showError('Please complete the captcha.'); return; }

     // 3. On failed submission reset so user can try again
     resetWidget(widgetId);

   Server-side verification (optional but recommended):
     POST your token to /api/verify-captcha and check against
     https://hcaptcha.com/siteverify using HCAPTCHA_SECRET
     (Vercel env var — never expose in the browser).
   ============================================================ */

import { HCAPTCHA_SITE_KEY } from './config.js';

// hCaptcha official test key — always passes in development.
// Replace with your real site key via .env → HCAPTCHA_SITE_KEY.
const SITE_KEY = HCAPTCHA_SITE_KEY || '10000000-ffff-ffff-ffff-000000000001';

// ── Script loading ────────────────────────────────────────────
let _loadPromise = null;

function _loadScript() {
  if (_loadPromise) return _loadPromise;
  _loadPromise = new Promise((resolve) => {
    if (window.hcaptcha) { resolve(); return; }
    const s = document.createElement('script');
    s.src   = 'https://js.hcaptcha.com/1/api.js?render=explicit';
    s.async = true;
    s.onerror = () => {
      console.warn('[Manarize] hCaptcha script failed to load.');
      resolve(); // fail open — don't break UX
    };
    s.onload = () => {
      const poll = setInterval(() => {
        if (window.hcaptcha) { clearInterval(poll); resolve(); }
      }, 40);
    };
    document.head.appendChild(s);
  });
  return _loadPromise;
}

function _captchaTheme() {
  return document.documentElement.getAttribute('data-theme') === 'light'
    ? 'light' : 'dark';
}

// ── Public API ────────────────────────────────────────────────

/**
 * Render an hCaptcha checkbox widget inside `containerId`.
 * Safe to call multiple times — renders only once per container.
 * Returns the widgetId (number) or null if hCaptcha unavailable.
 */
export async function initCaptcha(containerId, options = {}) {
  await _loadScript();
  if (!window.hcaptcha) return null;

  const el = document.getElementById(containerId);
  if (!el) {
    console.warn(`[Manarize] hCaptcha container #${containerId} not found.`);
    return null;
  }

  if (el.dataset.hcRendered) return el._hcWidgetId ?? null;

  const widgetId = window.hcaptcha.render(el, {
    sitekey: SITE_KEY,
    theme:   options.theme ?? _captchaTheme(),
    size:    options.size  ?? 'normal',
    ...options,
  });

  el.dataset.hcRendered = '1';
  el._hcWidgetId = widgetId;
  return widgetId;
}

/**
 * Get the response token. Returns '' when challenge not yet solved.
 */
export function getWidgetToken(widgetId) {
  if (widgetId == null || !window.hcaptcha) return '';
  try { return window.hcaptcha.getResponse(widgetId) || ''; }
  catch { return ''; }
}

/**
 * Reset a widget so the user can solve it again (e.g. after failed submit).
 */
export function resetWidget(widgetId) {
  if (widgetId == null || !window.hcaptcha) return;
  try { window.hcaptcha.reset(widgetId); } catch { /* ignore */ }
}

// ── Backward-compat stubs ─────────────────────────────────────
/** @deprecated Use initCaptcha / getWidgetToken instead. */
export async function getToken(_action = 'DEFAULT') { return null; }

/**
 * Verify an hCaptcha token server-side via /api/verify-captcha.
 * Returns { success: true } on valid token, { success: false, error } otherwise.
 * Callers should block form submission if success is false.
 */
export async function verifyWithServer(token, _action = 'DEFAULT') {
  if (!token) return { success: false, error: 'No captcha token provided' };
  try {
    const res = await fetch('/api/verify-captcha', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ token }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { success: false, error: data.error || 'Captcha verification failed' };
    return { success: !!data.success };
  } catch (err) {
    console.error('[Manarize] verifyWithServer error:', err.message);
    // Fail-closed: network error = reject
    return { success: false, error: 'Could not verify captcha. Please try again.' };
  }
}

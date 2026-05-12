/* ============================================================
   ZENMARKET — ADMIN CONFIRM DIALOG
   Drop-in replacement for window.confirm()

   Usage:
     import { adminConfirm } from './admin-confirm.js';

     const ok = await adminConfirm({
       title:   'Delete order?',          // required
       message: 'This cannot be undone.', // optional
       confirm: 'Delete',                 // optional, default 'Confirm'
       danger:  true,                     // optional — red confirm button
     });
     if (!ok) return;
   ============================================================ */

let _styleInjected = false;
function _esc(s) {
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

function injectStyles() {
  if (_styleInjected) return;
  _styleInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    /* ── Overlay ─────────────────────────────────── */
    .zm-confirm-overlay {
      position: fixed; inset: 0; z-index: 99999;
      background: rgba(0,0,0,.55);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      display: flex; align-items: center; justify-content: center;
      padding: 1rem;
      opacity: 0;
      transition: opacity .18s ease;
    }
    .zm-confirm-overlay.visible { opacity: 1; }

    /* ── Dialog card ─────────────────────────────── */
    .zm-confirm-dialog {
      background: var(--clr-surface);
      border: 1px solid var(--clr-border-2);
      border-radius: 16px;
      box-shadow: 0 24px 80px rgba(0,0,0,.7), 0 0 0 1px rgba(255,255,255,.04);
      padding: 1.75rem 1.75rem 1.5rem;
      width: 100%;
      max-width: 380px;
      transform: scale(.94) translateY(8px);
      transition: transform .22s cubic-bezier(.34,1.4,.64,1), opacity .18s ease;
      opacity: 0;
    }
    .zm-confirm-overlay.visible .zm-confirm-dialog {
      transform: scale(1) translateY(0);
      opacity: 1;
    }

    /* ── Icon ────────────────────────────────────── */
    .zm-confirm-icon {
      width: 44px; height: 44px; border-radius: 12px;
      display: flex; align-items: center; justify-content: center;
      font-size: 1.2rem;
      margin-bottom: 1.1rem;
      flex-shrink: 0;
    }
    .zm-confirm-icon.danger  { background: var(--clr-error-bg);   color: var(--clr-error);   }
    .zm-confirm-icon.warning { background: var(--clr-warning-bg); color: var(--clr-warning); }
    .zm-confirm-icon.info    { background: var(--clr-gold-bg);    color: var(--clr-gold);    }

    /* ── Text ────────────────────────────────────── */
    .zm-confirm-title {
      font-family: var(--ff-body);
      font-size: 1.0625rem;
      font-weight: 600;
      color: var(--clr-text);
      line-height: 1.35;
      margin-bottom: .45rem;
    }
    .zm-confirm-message {
      font-size: .875rem;
      color: var(--clr-text-2);
      line-height: 1.6;
      margin-bottom: 1.5rem;
    }

    /* ── Buttons ─────────────────────────────────── */
    .zm-confirm-btns {
      display: flex; gap: .625rem; justify-content: flex-end;
    }
    .zm-confirm-btn {
      display: inline-flex; align-items: center; gap: .4rem;
      padding: .6rem 1.25rem;
      border-radius: 9999px;
      border: none;
      font-family: var(--ff-body);
      font-size: .875rem;
      font-weight: 500;
      cursor: pointer;
      transition: transform 120ms ease, box-shadow 120ms ease, background 120ms ease, opacity 120ms ease;
      letter-spacing: .01em;
    }
    .zm-confirm-btn:hover  { transform: translateY(-1px); }
    .zm-confirm-btn:active { transform: translateY(0); }

    .zm-confirm-cancel {
      background: transparent;
      color: var(--clr-text-2);
      border: 1px solid var(--clr-border-2);
    }
    .zm-confirm-cancel:hover { background: var(--clr-bg-2); color: var(--clr-text); }

    .zm-confirm-ok {
      background: var(--clr-gold);
      color: #0d0f14;
      box-shadow: 0 3px 14px rgba(201,168,76,.30);
    }
    .zm-confirm-ok:hover { background: var(--clr-gold-light); box-shadow: 0 4px 20px rgba(201,168,76,.45); }

    .zm-confirm-ok.danger {
      background: var(--clr-error);
      color: #fff;
      box-shadow: 0 3px 14px rgba(231,76,60,.30);
    }
    .zm-confirm-ok.danger:hover { background: #ec6c5e; box-shadow: 0 4px 20px rgba(231,76,60,.45); }
  `;
  document.head.appendChild(style);
}

/**
 * @param {Object} opts
 * @param {string}  opts.title    – heading text
 * @param {string}  [opts.message] – supporting paragraph
 * @param {string}  [opts.confirm] – confirm button label  (default: 'Confirm')
 * @param {string}  [opts.cancel]  – cancel button label   (default: 'Cancel')
 * @param {boolean} [opts.danger]  – red confirm button
 * @param {'danger'|'warning'|'info'} [opts.icon] – icon style (auto from danger flag)
 * @returns {Promise<boolean>}
 */
export function adminConfirm({
  title,
  message  = '',
  confirm  = 'Confirm',
  cancel   = 'Cancel',
  danger   = false,
  icon     = danger ? 'danger' : 'warning',
} = {}) {
  injectStyles();

  return new Promise(resolve => {
    const ICONS = {
      danger:  'fa-solid fa-triangle-exclamation',
      warning: 'fa-solid fa-circle-exclamation',
      info:    'fa-solid fa-circle-info',
    };

    const overlay = document.createElement('div');
    overlay.className = 'zm-confirm-overlay';
    overlay.innerHTML = `
      <div class="zm-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="zmc-title">
        <div class="zm-confirm-icon ${icon}">
          <i class="${ICONS[icon] || ICONS.warning}" aria-hidden="true"></i>
        </div>
        <div class="zm-confirm-title" id="zmc-title">${_esc(title)}</div>
        ${message ? `<div class="zm-confirm-message">${message}</div>` : '<div class="zm-confirm-message"></div>'}
        <div class="zm-confirm-btns">
          <button class="zm-confirm-btn zm-confirm-cancel">${_esc(cancel)}</button>
          <button class="zm-confirm-btn zm-confirm-ok ${danger ? 'danger' : ''}">${_esc(confirm)}</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    // Animate in (rAF ensures transition fires)
    requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add('visible')));

    function close(result) {
      overlay.classList.remove('visible');
      overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
      resolve(result);
    }

    overlay.querySelector('.zm-confirm-ok').addEventListener('click',     () => close(true));
    overlay.querySelector('.zm-confirm-cancel').addEventListener('click', () => close(false));

    // Click outside to cancel
    overlay.addEventListener('click', e => { if (e.target === overlay) close(false); });

    // Escape to cancel
    function onKey(e) {
      if (e.key === 'Escape')  { close(false); document.removeEventListener('keydown', onKey); }
      if (e.key === 'Enter')   { close(true);  document.removeEventListener('keydown', onKey); }
    }
    document.addEventListener('keydown', onKey);

    // Focus the confirm button for keyboard users
    setTimeout(() => overlay.querySelector('.zm-confirm-ok')?.focus(), 60);
  });
}

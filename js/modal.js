/* ============================================================
   ZENMARKET — MODAL
   ============================================================ */
import { lockScroll, unlockScroll } from './utils.js';

export function openModal(id) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  overlay.classList.add('open');
  lockScroll();
  // Close on overlay click
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeModal(id);
  }, { once: true });
  // Close on Escape
  const onKey = e => { if (e.key === 'Escape') { closeModal(id); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
}

export function closeModal(id) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  overlay.classList.remove('open');
  unlockScroll();
}

export function createModal({ id, title, body, footer = '', size = '' }) {
  const existing = document.getElementById(id);
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = id;
  overlay.innerHTML = `
    <div class="modal ${size}">
      <div class="modal-header">
        <h3 class="modal-title">${title}</h3>
        <button class="modal-close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-footer">${footer}</div>` : ''}
    </div>`;

  overlay.querySelector('.modal-close').addEventListener('click', () => closeModal(id));
  document.body.appendChild(overlay);
  return overlay;
}

export function confirmModal({ title, message, confirmText = 'Confirm', cancelText = 'Cancel', onConfirm, danger = false }) {
  const id = 'confirm-modal';
  createModal({
    id,
    title,
    size: 'modal-sm',
    body: `<p style="color:var(--clr-text-2)">${message}</p>`,
    footer: `
      <button class="btn btn-ghost" id="confirm-cancel">${cancelText}</button>
      <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="confirm-ok">${confirmText}</button>
    `,
  });
  openModal(id);
  document.getElementById('confirm-cancel').addEventListener('click', () => closeModal(id));
  document.getElementById('confirm-ok').addEventListener('click', () => {
    closeModal(id);
    onConfirm?.();
  });
}

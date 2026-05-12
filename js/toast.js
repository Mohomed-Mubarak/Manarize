/* ============================================================
   ZENMARKET — TOAST NOTIFICATIONS
   ============================================================ */

let container;

function getContainer() {
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  return container;
}

const ICONS = {
  success: 'fa-solid fa-circle-check',
  error:   'fa-solid fa-triangle-exclamation',
  warning: 'fa-solid fa-triangle-exclamation',
  info:    'fa-solid fa-circle-info',
};

export function showToast({ title = '', message = '', type = 'info', duration = 4000 }) {
  const c = getContainer();
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <i class="toast-icon ${ICONS[type]}"></i>
    <div class="toast-body">
      ${title ? `<div class="toast-title">${title}</div>` : ''}
      ${message ? `<div class="toast-msg">${message}</div>` : ''}
    </div>
    <button class="toast-close"><i class="fa-solid fa-xmark"></i></button>
  `;

  const close = toast.querySelector('.toast-close');
  const dismiss = () => {
    toast.classList.add('leaving');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  };
  close.addEventListener('click', dismiss);

  if (duration > 0) setTimeout(dismiss, duration);

  c.appendChild(toast);
  return toast;
}

export function dismissAll() {
  const c = getContainer();
  [...c.querySelectorAll('.toast')].forEach(t => {
    t.classList.add('leaving');
    t.addEventListener('animationend', () => t.remove(), { once: true });
  });
}

export const toast = {
  success: (title, message, dur) => showToast({ title, message, type: 'success', duration: dur }),
  error:   (title, message, dur) => showToast({ title, message, type: 'error',   duration: dur }),
  warning: (title, message, dur) => showToast({ title, message, type: 'warning', duration: dur }),
  info:    (title, message, dur) => showToast({ title, message, type: 'info',    duration: dur }),
  dismissAll,
};

export default toast;

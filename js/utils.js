/* ============================================================
   ZENMARKET — UTILS
   ============================================================ */
import { STORE } from './config.js';

// ── Format Currency ───────────────────────────────────────────
export function formatPrice(amount) {
  return `${STORE.currencySymbol} ${Number(amount).toFixed(2)}`;
}

// ── Format Date ───────────────────────────────────────────────
export function formatDate(dateStr, opts = {}) {
  const d = new Date(dateStr);
  const defaultOpts = { day: '2-digit', month: 'short', year: 'numeric', ...opts };
  return d.toLocaleDateString('en-LK', defaultOpts);
}

export function formatDateTime(dateStr) {
  return new Date(dateStr).toLocaleString('en-LK', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ── Debounce ──────────────────────────────────────────────────
export function debounce(fn, delay = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
}

// ── Throttle ──────────────────────────────────────────────────
export function throttle(fn, delay = 100) {
  let last = 0;
  return (...args) => {
    const now = Date.now();
    if (now - last >= delay) { last = now; fn(...args); }
  };
}

// ── Generate ID ───────────────────────────────────────────────
export function genId(prefix = 'ID') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,7).toUpperCase()}`;
}

// ── Sanitize HTML ─────────────────────────────────────────────
export function sanitize(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Truncate ──────────────────────────────────────────────────
export function truncate(str, len = 80) {
  return str.length > len ? str.slice(0, len) + '…' : str;
}

// ── Deep Clone ────────────────────────────────────────────────
export function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// ── Sleep ─────────────────────────────────────────────────────
export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Stars HTML ────────────────────────────────────────────────
export function starsHtml(rating) {
  const full = Math.floor(rating);
  const half = rating % 1 >= 0.5;
  const empty = 5 - full - (half ? 1 : 0);
  return (
    '<i class="fa-solid fa-star"></i>'.repeat(full) +
    (half ? '<i class="fa-solid fa-star-half-stroke"></i>' : '') +
    '<i class="fa-regular fa-star"></i>'.repeat(empty)
  );
}

// ── URL Params ────────────────────────────────────────────────
export function getParam(key) {
  return new URLSearchParams(window.location.search).get(key);
}

export function setParam(key, value) {
  const url = new URL(window.location.href);
  if (value === null || value === undefined || value === '') {
    url.searchParams.delete(key);
  } else {
    url.searchParams.set(key, value);
  }
  window.history.replaceState({}, '', url.toString());
}

export function setParams(params) {
  const url = new URL(window.location.href);
  Object.entries(params).forEach(([k, v]) => {
    if (v === null || v === undefined || v === '') {
      url.searchParams.delete(k);
    } else {
      url.searchParams.set(k, v);
    }
  });
  window.history.replaceState({}, '', url.toString());
}

// ── Copy to clipboard ─────────────────────────────────────────
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const el = document.createElement('textarea');
    el.value = text;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    return true;
  }
}

// ── Is Mobile ─────────────────────────────────────────────────
export function isMobile() {
  return window.innerWidth < 768;
}

// ── Payment method label ──────────────────────────────────────
export function paymentMethodLabel(method) {
  const map = {
    payhere: '<i class="fa-solid fa-credit-card" style="color:var(--clr-info)"></i> PayHere Online',
    bank:    '<i class="fa-solid fa-building-columns" style="color:var(--clr-gold)"></i> Bank Transfer',
    cod:     '<i class="fa-solid fa-money-bill-wave" style="color:var(--clr-success)"></i> Cash on Delivery',
  };
  return map[method] || method || '—';
}

// ── Order Status Badge ────────────────────────────────────────
export function orderStatusBadge(status) {
  const map = {
    pending:    ['badge-amber',  'Pending'],
    processing: ['badge-blue',   'Processing'],
    shipped:    ['badge-blue',   'Shipped'],
    delivered:  ['badge-green',  'Delivered'],
    cancelled:  ['badge-red',    'Cancelled'],
    refunded:   ['badge-gray',   'Refunded'],
  };
  const [cls, label] = map[status] || ['badge-gray', status];
  return `<span class="badge ${cls}">${label}</span>`;
}

export function paymentStatusBadge(status) {
  const map = {
    paid:    ['badge-green', 'Paid'],
    pending: ['badge-amber', 'Pending'],
    failed:  ['badge-red',   'Failed'],
    refunded:['badge-gray',  'Refunded'],
  };
  const [cls, label] = map[status] || ['badge-gray', status];
  return `<span class="badge ${cls}">${label}</span>`;
}

// ── Scroll lock ───────────────────────────────────────────────
export function lockScroll() {
  document.body.style.overflow = 'hidden';
}
export function unlockScroll() {
  document.body.style.overflow = '';
}

// ── Confirm dialog ────────────────────────────────────────────
export function confirmDialog(message) {
  return window.confirm(message);
}

// ── Estimate delivery ─────────────────────────────────────────
export async function estimateDelivery(district) {
  // Read from Supabase shipping zones (production) or localStorage (demo)
  try {
    const { getShippingZones } = await import('./store-adapter.js');
    const zones = await getShippingZones();
    if (Array.isArray(zones) && zones.length) {
      const zone = zones.find(z => (z.districts || z.provinces || []).includes(district));
      if (zone) return `${zone.minDays || zone.min_days || 2}–${zone.maxDays || zone.max_days || 4} Business Days`;
    }
  } catch {}
  // Fallback to hardcoded defaults
  try {
    const saved = localStorage.getItem('zm_shipping_zones');
    const zones = saved ? JSON.parse(saved) : null;
    if (Array.isArray(zones) && zones.length) {
      const zone = zones.find(z => z.districts.includes(district));
      if (zone) return `${zone.minDays}–${zone.maxDays} Business Days`;
    }
  } catch {}
  const colombo = ['Colombo', 'Gampaha', 'Kalutara'];
  if (colombo.includes(district)) return '1–2 Business Days';
  return '2–4 Business Days';
}

// ── Back-to-top button ────────────────────────────────────────
export function initBackToTop() {
  let btn = document.getElementById('back-to-top');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'back-to-top';
    btn.setAttribute('aria-label', 'Back to top');
    btn.innerHTML = '<i class="fa-solid fa-chevron-up"></i>';
    document.body.appendChild(btn);
  }
  const toggle = () => btn.classList.toggle('visible', window.scrollY > 400);
  window.addEventListener('scroll', toggle, { passive: true });
  btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  toggle();
}

// ── Reposition fixed theme menu on window scroll/resize ───────
export function initThemeMenuReposition() {
  const reposition = () => {
    const menu = document.getElementById('theme-menu') ||
                 document.getElementById('theme-menu-admin');
    if (!menu || menu.hidden) return;
    const btn = document.querySelector('.theme-toggle-btn');
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    menu.style.top   = (r.bottom + 8) + 'px';
    menu.style.right = (window.innerWidth - r.right) + 'px';
  };
  window.addEventListener('scroll',  reposition, { passive: true });
  window.addEventListener('resize',  reposition, { passive: true });
}

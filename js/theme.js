/* ============================================================
   ZENMARKET — THEME SWITCHER
   Themes: dark (default) | light | warm
   ============================================================ */

const THEMES = [
  { id: 'dark',  label: 'Dark',      icon: 'fa-solid fa-moon'              },
  { id: 'light', label: 'Light',     icon: 'fa-solid fa-sun'               },
  { id: 'warm',  label: 'Warm Gold', icon: 'fa-solid fa-fire-flame-curved' },
];

const STORAGE_KEY = 'zm_theme';
let   injected    = false; // guard: only inject once per page

// ── Apply theme to <html> ─────────────────────────────────────
function applyTheme(id) {
  const valid = THEMES.find(t => t.id === id) ? id : 'dark';
  if (valid === 'dark') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', valid);
  }
  localStorage.setItem(STORAGE_KEY, valid);
  return valid;
}

function getSavedTheme() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && THEMES.find(t => t.id === saved)) return saved;
  if (window.matchMedia?.('(prefers-color-scheme: light)').matches) return 'light';
  return 'dark';
}

// ── Build the popup menu HTML (hidden by default) ─────────────
function buildMenuHTML(currentId) {
  return `<div class="theme-menu" id="theme-menu" hidden>
    ${THEMES.map(t => `
      <button class="theme-menu-item${t.id === currentId ? ' active' : ''}"
              data-theme="${t.id}" aria-label="${t.label}">
        <i class="${t.icon}"></i>
        <span>${t.label}</span>
        ${t.id === currentId ? '<i class="fa-solid fa-check theme-check"></i>' : ''}
      </button>`).join('')}
  </div>`;
}

// ── Inject into storefront navbar ─────────────────────────────
function injectStorefront(currentId) {
  const actions = document.querySelector('.navbar-actions');
  if (!actions || document.getElementById('theme-toggle-wrap')) return false;

  const wrap = document.createElement('div');
  wrap.className = 'theme-toggle-wrap';
  wrap.id = 'theme-toggle-wrap';

  const btn = document.createElement('button');
  btn.className = 'nav-icon-btn theme-toggle-btn';
  btn.id = 'theme-toggle-btn';
  btn.setAttribute('aria-label', 'Switch theme');
  btn.title = 'Switch theme';
  btn.innerHTML = `<i class="${THEMES.find(t=>t.id===currentId)?.icon || THEMES[0].icon}" id="theme-toggle-icon"></i>`;

  const menuEl = document.createElement('div');
  menuEl.outerHTML; // unused — build via innerHTML
  wrap.appendChild(btn);
  wrap.insertAdjacentHTML('beforeend', buildMenuHTML(currentId));
  actions.insertBefore(wrap, actions.firstChild);
  wireToggle('theme-toggle-wrap');
  return true;
}

// ── Inject into admin topbar slot ─────────────────────────────
function injectAdmin(currentId) {
  const slot = document.getElementById('theme-toggle-wrap-admin');
  if (!slot || slot.querySelector('.theme-toggle-btn')) return false;

  const wrap = document.createElement('div');
  wrap.className = 'theme-toggle-wrap';
  wrap.id = 'theme-toggle-wrap-admin-inner';
  wrap.style.cssText = 'position:relative;display:inline-flex';

  const btn = document.createElement('button');
  btn.className = 'admin-topbar-btn theme-toggle-btn';
  btn.id = 'theme-toggle-btn-admin';
  btn.setAttribute('aria-label', 'Switch theme');
  btn.title = 'Switch theme';
  btn.innerHTML = `<i class="${THEMES.find(t=>t.id===currentId)?.icon || THEMES[0].icon}" id="theme-toggle-icon-admin"></i>`;

  wrap.appendChild(btn);
  wrap.insertAdjacentHTML('beforeend', buildMenuHTML(currentId).replace('id="theme-menu"','id="theme-menu-admin"'));
  slot.appendChild(wrap);
  wireToggle('theme-toggle-wrap-admin-inner', 'theme-menu-admin');
  return true;
}

// ── Main init ─────────────────────────────────────────────────
export function initTheme() {
  const currentTheme = applyTheme(getSavedTheme());
  if (injected) return;

  const tryInject = () => {
    if (injected) return;

    const didStorefront = injectStorefront(currentTheme);
    const didAdmin      = injectAdmin(currentTheme);

    if (didStorefront || didAdmin) {
      injected = true;
      observer.disconnect();
    }
  };

  const observer = new MutationObserver(tryInject);
  observer.observe(document.body, { childList: true, subtree: false });

  tryInject(); // try immediately too
}

// ── Position a teleported menu below its button ───────────────
function positionMenu(menu, btn) {
  const r = btn.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.top      = (r.bottom + 8) + 'px';
  menu.style.right    = (window.innerWidth - r.right) + 'px';
  menu.style.left     = 'auto';
  menu.style.zIndex   = '999999';
}

// ── Wire events to a specific toggle wrapper ──────────────────
function wireToggle(wrapperId, menuId = 'theme-menu') {
  const wrap = document.getElementById(wrapperId);
  const menu = document.getElementById(menuId);
  const btn  = wrap?.querySelector('.theme-toggle-btn');
  if (!wrap || !menu || !btn) return;

  // Teleport menu to <body> so it escapes all parent stacking contexts
  if (menu.parentElement !== document.body) {
    document.body.appendChild(menu);
  }

  btn.addEventListener('click', e => {
    e.stopPropagation();
    const isOpen = !menu.hidden;
    document.querySelectorAll('.theme-menu').forEach(m => { m.hidden = true; });
    if (!isOpen) {
      positionMenu(menu, btn);
      menu.hidden = false;
    }
  });

  // Select theme
  menu.addEventListener('click', e => {
    e.stopPropagation();
    const item = e.target.closest('[data-theme]');
    if (!item) return;
    const applied = applyTheme(item.dataset.theme);
    menu.hidden = true;

    // Update all toggle icons
    document.querySelectorAll('#theme-toggle-icon, #theme-toggle-icon-admin').forEach(ic => {
      const t = THEMES.find(x => x.id === applied);
      if (t) ic.className = t.icon;
    });

    // Update active + check state in ALL menus
    document.querySelectorAll('.theme-menu').forEach(m => {
      m.querySelectorAll('[data-theme]').forEach(i => {
        const isActive = i.dataset.theme === applied;
        i.classList.toggle('active', isActive);
        const check = i.querySelector('.theme-check');
        if (isActive && !check) {
          i.insertAdjacentHTML('beforeend', '<i class="fa-solid fa-check theme-check"></i>');
        } else if (!isActive && check) {
          check.remove();
        }
      });
    });
  });

  // Close on outside click — use capture phase so it fires before any
  // bubble-phase handlers; check that the click is truly outside the wrap.
  document.addEventListener('click', e => {
    if (!wrap.contains(e.target)) {
      menu.hidden = true;
    }
  }, { capture: true });

  // Close on Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') menu.hidden = true;
  });
}

// Run immediately to prevent FOUC
applyTheme(getSavedTheme());

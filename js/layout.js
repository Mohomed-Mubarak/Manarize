/* ============================================================
   ZENMARKET — SHARED HTML PARTIALS (navbar + footer)
   Fixed: relative paths, proper DOM injection, mobile drawer,
          active link detection, announcement bar, scroll events
   ============================================================ */
import { STORE, WA_PHONE, DEMO_MODE } from './config.js';
import { getUnreadCount } from './notifications.js';
import { updateCartCount } from './cart.js';
import { updateAuthUI, getSession, logout } from './auth.js';
import { initTheme } from './theme.js';
import { initBackToTop, initThemeMenuReposition } from './utils.js';
import { safeUrl } from './security-utils.js';


// ── Site-settings cache (populated async by initLayoutSettings) ──────────
let _cachedSettings = null;

export async function initLayoutSettings() {
  if (_cachedSettings) return _cachedSettings;
  // Always fall back gracefully — never throw, never block page render
  try {
    if (!DEMO_MODE) {
      const { getSiteSettings } = await import('./store-adapter.js');
      const raw = await getSiteSettings();
      const flat = {};
      Object.entries(raw || {}).forEach(([k,v]) => { flat[k] = (v&&typeof v==='object'&&'v'in v)?v.v:v; });
      _cachedSettings = flat;
      return _cachedSettings;
    }
  } catch(e) {
    console.warn('[Layout] Could not load site settings from Supabase:', e.message);
  }
  try { _cachedSettings = JSON.parse(localStorage.getItem('zm_site_settings')||'{}'); } catch {}
  _cachedSettings = _cachedSettings || {};
  return _cachedSettings;
}

function _settings() { return _cachedSettings || {}; }

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
export const NAV_LINKS = [
  { href: '/',              label: 'Home'         },
  { href: 'shop',               label: 'Shop'         },
  { href: 'shop?badge=new',     label: 'New Arrivals', badge: 'new' },
  { href: 'shop?condition=used',label: 'Second Hand',  badge: 'used' },
  { href: 'contact',            label: 'Contact'      },
];

export function navbarHTML(activePage = '') {
  const _pathParts = window.location.pathname.split('/').filter(Boolean);
  const currentFile = (_pathParts[_pathParts.length - 1] || '').replace(/\.html$/, '') || '';
  const currentSearch = new URLSearchParams(window.location.search);

  // Read free shipping threshold from admin settings
  let freeShipThreshold = 5000;
  try {
    const settings = _settings();
    if (settings.freeShip) freeShipThreshold = Number(settings.freeShip) || 5000;
  } catch { /* use default */ }
  const freeShipLabel = `Rs. ${freeShipThreshold.toLocaleString()}`;

  const links = NAV_LINKS.map(l => {
    const _hrefClean = l.href === '/' ? '' : l.href.replace(/^\//, '');
    let isActive = activePage === l.label || currentFile === _hrefClean ||
      (l.href === '/' && (currentFile === '' || window.location.pathname === '/'));
    // Highlight "New Arrivals" when on shop with badge=new
    if (l.badge === 'new'  && currentFile === 'shop' && currentSearch.get('badge') === 'new')  isActive = true;
    if (l.badge === 'used' && currentFile === 'shop' && currentSearch.get('condition') === 'used') isActive = true;
    const extra = l.badge === 'new'  ? ' nav-link--new'
                : l.badge === 'used' ? ' nav-link--used' : '';
    return `<a href="${l.href}" class="nav-link${extra}${isActive ? ' active' : ''}">${l.label}</a>`;
  }).join('');

  // Mobile drawer links (same set)
  const drawerLinks = NAV_LINKS.map(l => {
    const extra = l.badge === 'new'  ? ' nav-link--new'
                : l.badge === 'used' ? ' nav-link--used' : '';
    return `<a href="${l.href}" class="nav-link${extra}">${l.label}</a>`;
  }).join('');

  return `
  <div class="announcement-bar" id="announcement-bar">
    🚀 Free shipping on orders over ${freeShipLabel} across Sri Lanka &nbsp;·&nbsp;
    <a href="/shop">Shop Now</a>
    <button class="announcement-close" id="ann-close" aria-label="Close">
      <i class="fa-solid fa-xmark"></i>
    </button>
  </div>

  <nav class="navbar" id="main-navbar">
    <div class="container navbar-inner">
      <a href="/" class="navbar-logo">Manar<span>ize</span></a>

      <div class="navbar-links">${links}</div>

      <!-- Inline search bar (desktop) -->
      <div class="navbar-search" id="navbar-search-wrap">
        <div class="navbar-search-bar" id="navbar-search-bar">
          <i class="fa-solid fa-magnifying-glass navbar-search-icon"></i>
          <input type="text" id="navbar-search-input" placeholder="Search products…" autocomplete="off" aria-label="Search">
          <button class="navbar-search-clear" id="navbar-search-clear" aria-label="Clear" style="display:none">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
        <div class="navbar-search-dropdown" id="navbar-search-dropdown" hidden></div>
      </div>

      <div class="navbar-actions">
        <a href="/wishlist" class="nav-icon-btn" aria-label="Wishlist" id="navbar-wishlist-btn" style="position:relative">
          <i class="fa-regular fa-heart"></i>
          <span class="badge-count" id="wish-count" style="display:none"></span>
        </a>
        <div class="nav-profile-wrap" id="nav-profile-wrap" style="position:relative">
          <button class="nav-icon-btn" id="nav-profile-btn" aria-label="Account" aria-expanded="false" aria-haspopup="true">
            <i class="fa-regular fa-circle-user" id="nav-profile-icon"></i>
          </button>
          <!-- Profile dropdown (only shown when logged in) -->
          <div class="nav-profile-dropdown" id="nav-profile-dropdown" role="menu" aria-label="Account menu">
            <div class="npd-header">
              <div class="npd-avatar" id="npd-avatar"></div>
              <div>
                <div class="npd-name" id="npd-name"></div>
                <div class="npd-email" id="npd-email"></div>
              </div>
            </div>
            <hr class="npd-divider">
            <a href="/profile" class="npd-item" role="menuitem"><i class="fa-regular fa-user"></i> My Profile</a>
            <a href="profile.html?panel=orders" class="npd-item" role="menuitem"><i class="fa-regular fa-bag-shopping"></i> My Orders</a>
            <a href="profile.html?panel=wishlist" class="npd-item" role="menuitem"><i class="fa-regular fa-heart"></i> Wishlist</a>
            <a href="profile.html?panel=settings" class="npd-item" role="menuitem"><i class="fa-regular fa-gear"></i> Settings</a>
            <hr class="npd-divider">
            <button class="npd-item npd-logout" id="npd-logout-btn" role="menuitem"><i class="fa-solid fa-arrow-right-from-bracket"></i> Sign Out</button>
          </div>
        </div>
        <a href="profile.html?panel=notifications" class="nav-icon-btn" aria-label="Notifications" data-auth="user"
           id="nav-notif-btn" style="position:relative">
          <i class="fa-regular fa-bell"></i>
          <span id="nav-notif-badge" style="display:none;position:absolute;top:-4px;right:-4px;
            background:var(--clr-error);color:#fff;font-size:.6rem;font-weight:700;
            border-radius:50%;width:16px;height:16px;display:none;align-items:center;
            justify-content:center;line-height:1"></span>
        </a>
        <a href="/cart" class="nav-icon-btn" aria-label="Cart" style="position:relative">
          <i class="fa-solid fa-cart-shopping"></i>
          <span class="badge-count cart-count" style="display:none">0</span>
        </a>
      </div>

      <button class="navbar-toggle" id="navbar-toggle" aria-label="Open menu">
        <i class="fa-solid fa-bars"></i>
      </button>
    </div>
  </nav>

  <!-- Mobile Drawer -->
  <div class="nav-drawer" id="nav-drawer">
    <div class="nav-drawer-overlay" id="nav-overlay"></div>
    <div class="nav-drawer-panel">
      <div class="drawer-close">
        <button class="nav-icon-btn" id="drawer-close-btn" aria-label="Close menu">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
      <!-- Mobile search -->
      <div class="drawer-search">
        <div class="search-bar" style="width:100%;margin-bottom:1rem">
          <input type="text" id="drawer-search-input" placeholder="Search products…" autocomplete="off">
          <button id="drawer-search-btn"><i class="fa-solid fa-magnifying-glass"></i></button>
        </div>
      </div>
      <div class="drawer-links">
        ${drawerLinks}
        <hr style="border-color:var(--clr-border);margin:.5rem 0">
        <a href="/profile" class="nav-link" id="drawer-account-link">
          <i class="fa-regular fa-circle-user"></i> <span id="drawer-account-label">My Account</span>
        </a>
        <a href="/cart" class="nav-link">
          <i class="fa-solid fa-cart-shopping"></i> Cart
        </a>
        <hr style="border-color:var(--clr-border);margin:.5rem 0">
        <!-- Theme toggle row inside mobile drawer -->
        <div id="drawer-theme-row" style="padding:.5rem 0">
          <div style="font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;color:var(--clr-text-3);margin-bottom:.5rem">Theme</div>
          <div id="drawer-theme-btns" style="display:flex;gap:.5rem;flex-wrap:wrap"></div>
        </div>
      </div>
    </div>
  </div>`;
}

export function footerHTML() {
  // Pull live contact info from saved settings (editable in admin)
  const settings = _settings();
  const phone   = settings.phone    || STORE.phone;
  const email   = settings.email    || STORE.email;
  const address = settings.address  || STORE.address;
  const waPhone = settings.waPhone  || WA_PHONE;
  const fb      = settings.facebook || STORE.socials.facebook;
  const ig      = settings.instagram|| STORE.socials.instagram;
  const tt      = settings.tiktok   || STORE.socials.tiktok;
  const yt      = settings.youtube  || STORE.socials.youtube;

  return `
  <footer class="footer">
    <div class="container">
      <div class="footer-grid">
        <div class="footer-brand">
          <a class="logo" href="/">Manar<span>ize</span></a>
          <p>Sri Lanka's premium online marketplace. Curated products, exceptional service, delivered to your door.</p>
          <div class="footer-socials">
            <a href="${safeUrl(fb)}"  class="social-icon" target="_blank" rel="noopener" aria-label="Facebook"><i class="fa-brands fa-facebook-f"></i></a>
            <a href="${safeUrl(ig)}" class="social-icon" target="_blank" rel="noopener" aria-label="Instagram"><i class="fa-brands fa-instagram"></i></a>
            <a href="${safeUrl(tt)}"    class="social-icon" target="_blank" rel="noopener" aria-label="TikTok"><i class="fa-brands fa-tiktok"></i></a>
            <a href="${safeUrl(yt)}"   class="social-icon" target="_blank" rel="noopener" aria-label="YouTube"><i class="fa-brands fa-youtube"></i></a>
          </div>
        </div>

        <div class="footer-col">
          <h5>Shop</h5>
          <div class="footer-links">
            <a href="/shop"><i class="fa-solid fa-chevron-right" style="font-size:.6rem"></i> All Products</a>
            <a href="shop.html?cat=clothing"><i class="fa-solid fa-chevron-right" style="font-size:.6rem"></i> Clothing</a>
            <a href="shop.html?cat=sport-shoes"><i class="fa-solid fa-chevron-right" style="font-size:.6rem"></i> Sport Shoes</a>
            <a href="shop.html?cat=laptops"><i class="fa-solid fa-chevron-right" style="font-size:.6rem"></i> Laptops</a>
            <a href="shop.html?cat=computer-accessories"><i class="fa-solid fa-chevron-right" style="font-size:.6rem"></i> Computer Accessories</a>
            <a href="shop.html?cat=second-hand"><i class="fa-solid fa-chevron-right" style="font-size:.6rem"></i> Second Hand</a>
          </div>
        </div>

        <div class="footer-col">
          <h5>Info</h5>
          <div class="footer-links">
            <a href="about.html"><i class="fa-solid fa-chevron-right" style="font-size:.6rem"></i> About Us</a>
            <a href="/blog"><i class="fa-solid fa-chevron-right" style="font-size:.6rem"></i> Blog</a>
            <a href="faq.html"><i class="fa-solid fa-chevron-right" style="font-size:.6rem"></i> FAQ</a>
            <a href="contact.html"><i class="fa-solid fa-chevron-right" style="font-size:.6rem"></i> Contact</a>
            <a href="shipping-policy.html"><i class="fa-solid fa-chevron-right" style="font-size:.6rem"></i> Shipping Policy</a>
            <a href="return-policy.html"><i class="fa-solid fa-chevron-right" style="font-size:.6rem"></i> Return Policy</a>
          </div>
        </div>

        <div class="footer-col">
          <h5>Contact</h5>
          <div class="footer-links" id="footer-contact-links">
            <a href="tel:${phone}"><i class="fa-solid fa-phone"></i> <span class="footer-phone">${phone}</span></a>
            <a href="mailto:${email}"><i class="fa-solid fa-envelope"></i> <span class="footer-email">${email}</span></a>
            <span><i class="fa-solid fa-location-dot"></i> <span class="footer-address">${address}</span></span>
            <a href="https://wa.me/${waPhone}" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp"></i> WhatsApp Us</a>
          </div>
        </div>
      </div>
    </div>

    <div class="container">
      <div class="footer-bottom">
        <p>© ${new Date().getFullYear()} Manarize. All rights reserved.
          &nbsp;·&nbsp;<a href="privacy.html">Privacy Policy</a>
          &nbsp;·&nbsp;<a href="terms.html">Terms</a>
        </p>
        <div class="footer-payments">
          <span class="payment-logo">VISA</span>
          <span class="payment-logo">MC</span>
          <span class="payment-logo">PayHere</span>
          <span class="payment-logo">COD</span>
        </div>
      </div>
    </div>
  </footer>

  <!-- Floating Buttons -->
  <div class="float-actions">
    <button class="float-btn float-top" id="back-to-top" aria-label="Back to top">
      <i class="fa-solid fa-chevron-up"></i>
    </button>
    <a href="https://wa.me/${waPhone}?text=Hi%20Manarize!%20I%20need%20help."
       target="_blank" rel="noopener" class="float-btn float-wa" aria-label="WhatsApp">
      <i class="fa-brands fa-whatsapp"></i>
    </a>
    <a href="tel:${phone}" class="float-btn float-call" aria-label="Call us">
      <i class="fa-solid fa-phone"></i>
    </a>
  </div>`;
}

export async function injectLayout(options = {}) {
  const { activePage = '' } = options;
  // Await settings so footer gets live contact info from Supabase.
  // Nav injects immediately after; footer renders after settings resolve.
  await initLayoutSettings().catch(() => {});

  // ── Inject Navbar ────────────────────────────────────────────
  // If a static skeleton with id="site-nav-wrapper" already exists,
  // replace it in-place to avoid CLS. Otherwise insert before <main>.
  const body = document.body;
  const main  = body.querySelector('main');
  const existingNav = document.getElementById('site-nav-wrapper');

  const navWrapper = document.createElement('nav');
  navWrapper.id = 'site-nav-wrapper';
  navWrapper.innerHTML = navbarHTML(activePage);

  if (existingNav) {
    existingNav.replaceWith(navWrapper);
  } else if (main) {
    body.insertBefore(navWrapper, main);
  } else {
    const utilIds = new Set(['page-loader', 'page-progress', 'toast-container']);
    let ref = null;
    for (const child of body.children) {
      if (!utilIds.has(child.id)) { ref = child; break; }
    }
    ref ? body.insertBefore(navWrapper, ref) : body.appendChild(navWrapper);
  }

  // ── Inject Footer ────────────────────────────────────────────
  const footerWrapper = document.createElement('div');
  footerWrapper.id = 'site-footer-wrapper';
  footerWrapper.innerHTML = footerHTML();
  body.appendChild(footerWrapper);

  // ── Hoist nav-drawer to direct child of <body> ───────────────
  // position:fixed elements must sit outside any ancestor that creates a new
  // stacking context (e.g. body { overflow-x: hidden } in some browsers).
  // Moving the drawer to a direct body child guarantees z-index:1000 beats
  // hero content and the overlay covers the full viewport correctly.
  const drawerEl = navWrapper.querySelector('#nav-drawer');
  if (drawerEl) body.appendChild(drawerEl);

  // ── Mobile Drawer ────────────────────────────────────────────
  const toggle  = document.getElementById('navbar-toggle');
  const drawer  = document.getElementById('nav-drawer');
  const overlay = document.getElementById('nav-overlay');
  const closeBt = document.getElementById('drawer-close-btn');

  const openDrawer  = () => drawer?.classList.add('open');
  const closeDrawer = () => drawer?.classList.remove('open');

  toggle?.addEventListener('click', openDrawer);
  overlay?.addEventListener('click', closeDrawer);
  closeBt?.addEventListener('click', closeDrawer);
  drawer?.querySelectorAll('a.nav-link').forEach(a => a.addEventListener('click', closeDrawer));

  // ── Mobile drawer search ──────────────────────────────────────
  const drawerSearchBtn   = document.getElementById('drawer-search-btn');
  const drawerSearchInput = document.getElementById('drawer-search-input');
  const doDrawerSearch = () => {
    const q = drawerSearchInput?.value.trim();
    if (q) window.location.href = `search?q=${encodeURIComponent(q)}`;
  };
  drawerSearchBtn?.addEventListener('click', doDrawerSearch);
  drawerSearchInput?.addEventListener('keydown', e => { if (e.key === 'Enter') doDrawerSearch(); });

  // ── Navbar inline search (desktop) ───────────────────────────
  initNavbarSearch();

  // ── Announcement close ───────────────────────────────────────
  document.getElementById('ann-close')?.addEventListener('click', () => {
    document.getElementById('announcement-bar')?.remove();
  });

  // ── Navbar shadow on scroll ──────────────────────────────────
  const navbar = document.getElementById('main-navbar');
  if (navbar) {
    const onScroll = () => navbar.classList.toggle('scrolled', window.scrollY > 20);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // ── Back to top button ───────────────────────────────────────
  const topBtn = document.getElementById('back-to-top');
  if (topBtn) {
    window.addEventListener('scroll', () => {
      topBtn.classList.toggle('visible', window.scrollY > 400);
    }, { passive: true });
    topBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  }

  // ── Cart count + Auth UI ─────────────────────────────────────
  updateCartCount();
  // Update wishlist badge count
  (function updateWishCount() {
    try {
      const list = JSON.parse(localStorage.getItem('zm_wishlist') || '[]');
      const el = document.getElementById('wish-count');
      if (!el) return;
      if (list.length > 0) { el.textContent = list.length; el.style.display = 'flex'; }
      else { el.style.display = 'none'; }
    } catch {}
  })();
  updateAuthUI();
  updateNotifBadge();

  // Re-update badge whenever notifications change
  window.addEventListener('notifications:updated', updateNotifBadge);

  // ── Smart Profile Button ─────────────────────────────────────
  initProfileButton();

  // ── Mobile Bottom Nav Bar ────────────────────────────────────
  injectMobileBottomNav();

  // ── Theme toggle ─────────────────────────────────────────────
  initTheme();
  initBackToTop();
  initThemeMenuReposition();

  // ── Drawer theme buttons (mobile) ────────────────────────────
  const drawerThemeBtns = document.getElementById('drawer-theme-btns');
  if (drawerThemeBtns) {
    const THEMES_DRAWER = [
      { id: 'dark',  label: 'Dark',      icon: 'fa-solid fa-moon' },
      { id: 'light', label: 'Light',     icon: 'fa-solid fa-sun' },
      { id: 'warm',  label: 'Warm Gold', icon: 'fa-solid fa-fire-flame-curved' },
    ];

    const renderDrawerTheme = () => {
      const cur = localStorage.getItem('zm_theme') || 'dark';
      drawerThemeBtns.innerHTML = THEMES_DRAWER.map(t => {
        const isActive = t.id === cur;
        return `<button data-drawer-theme="${t.id}"
          style="display:inline-flex;align-items:center;gap:.4rem;padding:.4rem .75rem;border-radius:6px;
                 font-size:.8rem;cursor:pointer;border:1px solid ${isActive ? 'var(--clr-gold)' : 'var(--clr-border)'};
                 background:${isActive ? 'var(--clr-gold)' : 'transparent'};
                 color:${isActive ? '#0a0a0a' : 'var(--clr-text)'};font-weight:${isActive ? '600' : '400'};
                 transition:background .2s,color .2s,border-color .2s">
          <i class="${t.icon}" style="font-size:.75rem"></i> ${t.label}
        </button>`;
      }).join('');

      drawerThemeBtns.querySelectorAll('[data-drawer-theme]').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.drawerTheme;
          if (id === 'dark') {
            document.documentElement.removeAttribute('data-theme');
          } else {
            document.documentElement.setAttribute('data-theme', id);
          }
          localStorage.setItem('zm_theme', id);
          // Sync navbar toggle icon
          const ICONS = { dark: 'fa-solid fa-moon', light: 'fa-solid fa-sun', warm: 'fa-solid fa-fire-flame-curved' };
          document.querySelectorAll('#theme-toggle-icon, #theme-toggle-icon-admin').forEach(ic => {
            ic.className = ICONS[id] || ICONS.dark;
          });
          // Sync .theme-menu-item active states
          document.querySelectorAll('.theme-menu-item').forEach(item => {
            const isNowActive = item.dataset.theme === id;
            item.classList.toggle('active', isNowActive);
            const check = item.querySelector('.theme-check');
            if (isNowActive && !check) item.insertAdjacentHTML('beforeend', '<i class="fa-solid fa-check theme-check"></i>');
            else if (!isNowActive && check) check.remove();
          });
          renderDrawerTheme();
        });
      });
    };

    renderDrawerTheme();
    // Re-render when drawer opens (picks up desktop toggle changes)
    document.getElementById('navbar-toggle')?.addEventListener('click', renderDrawerTheme);
  }
}

// ── Notification badge updater ────────────────────────────────
async function updateNotifBadge() {
  const badge = document.getElementById('nav-notif-badge');
  if (!badge) return;
  let session = null;
  try { session = JSON.parse(localStorage.getItem('zm_session') || 'null'); } catch {}
  if (!session) { badge.style.display = 'none'; return; }
  const count = await getUnreadCount(session.id);
  if (count > 0) {
    badge.textContent   = count > 9 ? '9+' : String(count);
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
}

// ── Navbar search: live dropdown + keyboard nav ───────────────
function initNavbarSearch() {
  const input    = document.getElementById('navbar-search-input');
  const dropdown = document.getElementById('navbar-search-dropdown');
  const clearBtn = document.getElementById('navbar-search-clear');
  if (!input || !dropdown) return;

  // Dynamically import search to avoid circular deps at module parse time
  let searchFn = null;
  const loadSearch = async () => {
    if (searchFn) return;
    try {
      const mod = await import('./search.js');
      searchFn = mod.searchProducts;
    } catch { searchFn = () => []; }
  };

  let debounceTimer;
  let selectedIdx = -1;

  const closeDropdown = () => {
    dropdown.hidden = true;
    dropdown.innerHTML = '';
    selectedIdx = -1;
  };

  const openResults = (results, q) => {
    selectedIdx = -1;
    if (!results.length) {
      dropdown.innerHTML = `
        <div class="nsd-empty">
          <i class="fa-solid fa-magnifying-glass"></i>
          No results for "<strong>${q}</strong>"
        </div>
        <a href="search?q=${encodeURIComponent(q)}" class="nsd-all">
          Browse all products →
        </a>`;
      dropdown.hidden = false;
      return;
    }
    dropdown.innerHTML = results.map((p, i) => `
      <a href="product.html?slug=${encodeURIComponent(esc(p.slug))}" class="nsd-item" data-idx="${i}">
        <img src="${esc(p.images?.[0] || '')}" alt="${esc(p.name)}" class="nsd-img"
             data-err-hide>
        <div class="nsd-info">
          <div class="nsd-name">${esc(p.name)}</div>
          <div class="nsd-meta">${esc(p.category)}${p.badge === 'Used' ? ' · <span class="nsd-used">Used</span>' : ''}</div>
        </div>
        <div class="nsd-price">${formatPrice(p.price)}</div>
      </a>`).join('') +
      `<a href="search?q=${encodeURIComponent(q)}" class="nsd-all">
        See all results for "<strong>${esc(q)}</strong>" →
      </a>`;
    dropdown.hidden = false;
  };

  input.addEventListener('input', async () => {
    const q = input.value.trim();
    clearBtn.style.display = q ? '' : 'none';
    clearTimeout(debounceTimer);
    if (q.length < 2) { closeDropdown(); return; }
    debounceTimer = setTimeout(async () => {
      await loadSearch();
      const results = await searchFn(q, 6);
      openResults(Array.isArray(results) ? results : [], q);
    }, 220);
  });

  input.addEventListener('keydown', e => {
    const items = dropdown.querySelectorAll('.nsd-item, .nsd-all');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIdx = Math.min(selectedIdx + 1, items.length - 1);
      items.forEach((el, i) => el.classList.toggle('nsd-item--selected', i === selectedIdx));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIdx = Math.max(selectedIdx - 1, -1);
      items.forEach((el, i) => el.classList.toggle('nsd-item--selected', i === selectedIdx));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const selected = items[selectedIdx];
      if (selected) selected.click();
      else if (input.value.trim()) window.location.href = `search?q=${encodeURIComponent(input.value.trim())}`;
    } else if (e.key === 'Escape') {
      closeDropdown();
      input.blur();
    }
  });

  clearBtn?.addEventListener('click', () => {
    input.value = '';
    clearBtn.style.display = 'none';
    closeDropdown();
    input.focus();
  });

  document.addEventListener('click', e => {
    if (!document.getElementById('navbar-search-wrap')?.contains(e.target)) closeDropdown();
  });

  // Helper — imported at top of layout.js
  function formatPrice(n) {
    return `Rs. ${n.toLocaleString('en-LK')}`;
  }
}

// ── Mobile Bottom Navigation Bar ─────────────────────────────
function injectMobileBottomNav() {
  // Only inject on mobile (CSS will also hide on desktop)
  const _pathParts = window.location.pathname.split('/').filter(Boolean);
  const _mbParts2 = window.location.pathname.split('/').filter(Boolean);
  const currentFile = (_mbParts2[_mbParts2.length - 1] || '').replace(/\.html$/, '') || '';
  const currentSearch = new URLSearchParams(window.location.search);

  const isShop   = currentFile === 'shop';
  const isHome   = currentFile === 'index' || currentFile === '';
  const isCart   = currentFile === 'cart';
  const isWish   = currentFile === 'wishlist';
  const isSearch = currentFile === 'search';

  const nav = document.createElement('nav');
  nav.className = 'mobile-bottom-nav';
  nav.setAttribute('aria-label', 'Mobile navigation');
  nav.innerHTML = `
    <a href="/"   class="mbn-item${isHome   ? ' active' : ''}">
      <i class="fa-solid fa-house"></i><span>Home</span>
    </a>
    <a href="/shop"    class="mbn-item${isShop && !currentSearch.get('badge') && !currentSearch.get('condition') ? ' active' : ''}">
      <i class="fa-solid fa-store"></i><span>Shop</span>
    </a>
    <a href="/search"  class="mbn-item${isSearch ? ' active' : ''}">
      <i class="fa-solid fa-magnifying-glass"></i><span>Search</span>
    </a>
    <a href="/wishlist" class="mbn-item${isWish   ? ' active' : ''}" id="mbn-wish">
      <i class="fa-regular fa-heart"></i>
      <span>Saved</span>
    </a>
    <a href="/cart"    class="mbn-item${isCart   ? ' active' : ''}" id="mbn-cart">
      <i class="fa-solid fa-bag-shopping"></i>
      <span class="mbn-badge" id="mbn-cart-badge" style="display:none">0</span>
      <span>Cart</span>
    </a>
    <a href="/profile" class="mbn-item" id="mbn-profile">
      <i class="fa-regular fa-circle-user" id="mbn-profile-icon"></i><span>Account</span>
    </a>
  `;
  document.body.appendChild(nav);

  // Sync cart badge with the main cart count
  function syncMbnCart() {
    const badge = document.getElementById('mbn-cart-badge');
    if (!badge) return;
    try {
      const cart = JSON.parse(localStorage.getItem('zm_cart') || '[]');
      const count = cart.reduce((s, i) => s + (i.qty || 1), 0);
      badge.textContent = count > 9 ? '9+' : String(count);
      badge.style.display = count > 0 ? 'flex' : 'none';
    } catch { badge.style.display = 'none'; }
  }
  syncMbnCart();
  window.addEventListener('cart:updated', syncMbnCart);

  // Add bottom padding to body so content isn't hidden behind bar
  // Bottom padding handled by CSS .has-bottom-nav rule
  document.body.classList.add('has-bottom-nav');
}

// ── Profile Button Logic ──────────────────────────────────────
function initProfileButton() {
  const user        = getSession();
  const profileBtn  = document.getElementById('nav-profile-btn');
  const dropdown    = document.getElementById('nav-profile-dropdown');
  const drawerLink  = document.getElementById('drawer-account-link');
  const drawerLabel = document.getElementById('drawer-account-label');
  const mbnProfile  = document.getElementById('mbn-profile');

  if (user) {
    // ── Logged in: show avatar initial in button ──────────────
    const icon = document.getElementById('nav-profile-icon');
    if (icon) {
      icon.className = ''; // remove fa icon classes
      icon.style.cssText = `
        width:28px; height:28px; border-radius:50%;
        background:var(--clr-gold); color:#0a0a0a;
        display:inline-flex; align-items:center; justify-content:center;
        font-size:.8rem; font-weight:700; line-height:1; font-style:normal;
      `;
      icon.textContent = (user.name || '?')[0].toUpperCase();
    }

    // ── Populate dropdown ─────────────────────────────────────
    const avatarEl = document.getElementById('npd-avatar');
    const nameEl   = document.getElementById('npd-name');
    const emailEl  = document.getElementById('npd-email');
    if (avatarEl) avatarEl.textContent = (user.name || '?')[0].toUpperCase();
    if (nameEl)   nameEl.textContent   = user.name  || 'User';
    if (emailEl)  emailEl.textContent  = user.email || '';

    // ── Click profile icon → go directly to profile page ─────
    profileBtn?.addEventListener('click', () => {
      window.location.href = '/profile';
    });

    // Sign out button (still wired in case dropdown is opened via keyboard)
    document.getElementById('npd-logout-btn')?.addEventListener('click', () => {
      logout();
    });

    // ── Drawer & mobile bottom nav → profile ──────────────────
    if (drawerLink)  drawerLink.href = 'profile.html';
    if (drawerLabel) drawerLabel.textContent = 'My Account';
    if (mbnProfile)  mbnProfile.href = 'profile.html';

  } else {
    // ── Guest: clicking profile icon → login page ─────────────
    profileBtn?.addEventListener('click', () => {
      window.location.href = '/login';
    });

    // ── Drawer & mobile bottom nav → login ───────────────────
    if (drawerLink) {
      drawerLink.href = 'login.html';
      const icon = drawerLink.querySelector('i');
      if (icon) icon.className = 'fa-solid fa-lock';
    }
    if (drawerLabel) drawerLabel.textContent = 'Login / Register';
    if (mbnProfile)  mbnProfile.href = 'login.html';
  }
}

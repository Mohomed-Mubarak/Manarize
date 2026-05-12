/* ============================================================
   ZENMARKET — ADMIN LAYOUT  (fixed)
   Sidebar + Topbar injector. Call await injectAdminLayout(pageTitle)
   at the top of every admin page's withLoader callback.
   ============================================================ */
import { getAdminSession, adminLogout } from './admin-auth.js';
import { adminConfirm } from './admin-confirm.js';
import { initTheme } from '../theme.js';
import { getAdminUnreadCount, markAllAdminRead, getAdminNotifications, markAdminRead, deleteAdminNotification } from '../notifications.js';

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

const NAV = [
  {
    label: 'Overview',
    links: [
      { href: 'dashboard.html',  icon: 'fa-solid fa-gauge',           label: 'Dashboard'      },
      { href: 'analytics.html',  icon: 'fa-solid fa-chart-line',      label: 'Analytics'      },
    ],
  },
  {
    label: 'Catalog',
    links: [
      { href: 'products.html',   icon: 'fa-solid fa-store',           label: 'Products'       },
      { href: 'categories.html', icon: 'fa-solid fa-tag',             label: 'Categories'     },
    ],
  },
  {
    label: 'Sales',
    links: [
      { href: 'orders.html',     icon: 'fa-solid fa-clipboard-list',  label: 'Orders'         },
      { href: 'coupons.html',    icon: 'fa-solid fa-ticket',          label: 'Coupons'        },
      { href: 'shipping.html',   icon: 'fa-solid fa-truck',           label: 'Delivery'       },
    ],
  },
  {
    label: 'Content',
    links: [
      { href: 'blog.html',       icon: 'fa-solid fa-newspaper',      label: 'Blog Posts'     },
      { href: 'pages.html',      icon: 'fa-solid fa-file-lines',     label: 'Pages'          },
    ],
  },
  {
    label: 'Community',
    links: [
      { href: 'users.html',      icon: 'fa-solid fa-users',           label: 'Users'          },
      { href: 'reviews.html',    icon: 'fa-solid fa-comments',        label: 'Reviews'        },
      { href: 'notifications.html', icon: 'fa-solid fa-bell',         label: 'Messages'       },
    ],
  },
  {
    label: 'Settings',
    links: [
      { href: 'seo.html',        icon: 'fa-solid fa-magnifying-glass', label: 'SEO'           },
      { href: 'settings.html',   icon: 'fa-solid fa-gear',            label: 'Settings'       },
    ],
  },
];

export async function injectAdminLayout(pageTitle = 'Dashboard') {
  // NOTE: Supabase client is now loaded via ESM import in js/supabase.js.
  // The window.supabase global check is no longer needed.

  const session = getAdminSession();
  if (!session) {
    window.location.href = '/';
    return;
  }

  const currentFile = window.location.pathname.split('/').pop() || 'dashboard.html';

  // ── Build sidebar HTML ───────────────────────────────────────
  const sidebarNavHTML = NAV.map(section => `
    <div class="sidebar-section-label">${section.label}</div>
    ${section.links.map(link => {
      const isActive = currentFile === link.href;
      return `
        <a href="${link.href}" class="sidebar-link${isActive ? ' active' : ''}">
          <i class="${link.icon}"></i>
          <span>${link.label}</span>
        </a>`;
    }).join('')}
  `).join('');

  const sidebarHTML = `
    <aside class="admin-sidebar" id="admin-sidebar">
      <div class="sidebar-logo">
        <div>
          <div class="logo-text">Manarize</div>
        </div>
        <span class="admin-tag">Admin</span>
      </div>
      <nav class="sidebar-nav">${sidebarNavHTML}</nav>
      <div class="sidebar-user">
        <div class="sidebar-avatar">
          <i class="fa-regular fa-circle-user"></i>
        </div>
        <div>
          <div class="sidebar-user-name">${session.name || 'Admin'}</div>
          <div class="sidebar-user-role">Administrator</div>
        </div>
        <button class="sidebar-logout" id="admin-logout-btn" title="Sign out">
          <i class="fa-solid fa-arrow-right-from-bracket"></i>
        </button>
      </div>
    </aside>`;

  const topbarHTML = `
    <header class="admin-topbar">
      <div class="admin-topbar-left">
        <button class="admin-sidebar-toggle" id="sidebar-toggle" aria-label="Toggle sidebar">
          <i class="fa-solid fa-bars"></i>
        </button>
        <span class="admin-page-title">${pageTitle}</span>
      </div>
      <div class="admin-topbar-right">
        <span class="live-dot" style="margin-right:.5rem">Live</span>
        <a href="../index.html" target="_blank" class="admin-topbar-btn" title="View Store">
          <i class="fa-solid fa-store"></i>
        </a>
        <div id="theme-toggle-wrap-admin" style="position:relative;display:inline-flex"></div>
        <div style="position:relative;display:inline-flex">
          <button class="admin-topbar-btn" id="admin-notif-btn" title="Notifications">
            <i class="fa-solid fa-bell"></i>
            <span id="admin-notif-badge" style="display:none;position:absolute;top:-4px;right:-4px;min-width:16px;height:16px;background:var(--clr-error,#ef4444);color:#fff;font-size:.6rem;font-weight:700;border-radius:20px;padding:0 4px;line-height:16px;text-align:center;pointer-events:none"></span>
          </button>
        </div>
        <!-- Admin notification dropdown (injected by JS) -->
        <div id="admin-notif-dropdown" style="display:none;position:fixed;width:340px;max-height:480px;background:var(--clr-surface);border:1px solid var(--clr-border);border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.35);z-index:99999;overflow:hidden;flex-direction:column"></div>
      </div>
    </header>`;

  // ── Snapshot existing page content BEFORE modifying DOM ──────
  const existingNodes = Array.from(document.body.childNodes).filter(node => {
    const id = node.id || '';
    return !['page-loader', 'page-progress', 'toast-container'].includes(id) &&
           node.nodeType === Node.ELEMENT_NODE;
  });

  // ── Build the admin shell wrapper ────────────────────────────
  const shell = document.createElement('div');
  shell.className = 'admin-shell';

  const mainDiv = document.createElement('div');
  mainDiv.className = 'admin-main';
  mainDiv.id = 'admin-main';
  mainDiv.innerHTML = topbarHTML;

  const contentDiv = document.createElement('div');
  contentDiv.className = 'admin-content';
  contentDiv.id = 'admin-content';

  mainDiv.appendChild(contentDiv);
  shell.innerHTML = sidebarHTML;
  shell.appendChild(mainDiv);

  // ── Move existing content into admin-content ─────────────────
  existingNodes.forEach(node => contentDiv.appendChild(node));

  // ── Append shell to body ─────────────────────────────────────
  document.body.appendChild(shell);

  // ── DB setup banner ─────────────────────────────────────────
  // Check if database is configured. Show a prominent banner if not.
  // Non-blocking: runs in background, doesn't delay page render.
  (async () => {
    try {
      // Ask the API for the real status (uses service-role key)
      // If the API call fails (network error / server not running), we do NOT
      // fall back to showing the banner — that was causing false positives.
      let apiStatus = null;
      let apiReachable = false;
      try {
        const { getAdminToken } = await import('../admin-api.js');
        // Skip db-status if not authenticated — avoids noisy 401 in console
        if (!getAdminToken()) throw new Error('No admin token');
        const AdminAPI = (await import('../admin-api.js')).default;
        apiStatus = await AdminAPI.dbStatus.check();
        apiReachable = true;
      } catch (_) { /* API not deployed / server not running — treat as unknown */ }

      // Only show the banner if the API explicitly reports REAL issues.
      // If ordersTableExists=true, the DB is working — suppress false-positive
      // "Missing RLS policy" errors caused by pg_policies being unreadable via REST.
      if (apiReachable && apiStatus?.ordersTableExists) {
        // Table is accessible — filter out unreliable policy-name checks
        const realIssues = (apiStatus?.issues || []).filter(i => !i.startsWith('Missing RLS policy'));
        if (!realIssues.length) {
          try { localStorage.removeItem('zm_db_setup_required'); } catch (_) {}
          return; // DB is fine, suppress banner
        }
        // Override issues with only the real ones
        if (apiStatus) apiStatus.issues = realIssues;
      } else if (apiReachable && (!apiStatus?.issues || apiStatus.issues.length === 0)) {
        // API reached and says everything is fine — clear any stale flag and exit
        try { localStorage.removeItem('zm_db_setup_required'); } catch (_) {}
        return;
      } else {
        // API unreachable — do a lightweight direct Supabase check before showing banner
        const localFlag = localStorage.getItem('zm_db_setup_required');
        if (localFlag !== '1') return; // no flag set, nothing to warn about

        // Flag is set — verify the orders table is actually missing by hitting Supabase directly
        let ordersTableOk = false;
        try {
          const { SUPABASE_URL, SUPABASE_ANON_KEY } = await import('../config.js');
          if (SUPABASE_URL && SUPABASE_ANON_KEY) {
            const resp = await fetch(
              `${SUPABASE_URL}/rest/v1/orders?select=id&limit=1`,
              { headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` } }
            );
            if (resp.ok) {
              ordersTableOk = true;
              try { localStorage.removeItem('zm_db_setup_required'); } catch (_) {}
            }
          }
        } catch (_) {}
        if (ordersTableOk) return; // DB is fine, stale flag cleared
      }

      const issues = apiStatus?.issues || [
        'Orders table could not be verified. supabase-setup.sql may not have been run.',
      ];
      const fix = apiStatus?.fix ||
        'Supabase Dashboard → SQL Editor → paste supabase-setup.sql → Run. ' +
        'Then add SUPABASE_SERVICE_ROLE_KEY in Vercel → Settings → Environment Variables → Redeploy.';

      const banner = document.createElement('div');
      banner.id = 'zm-db-setup-banner';
      banner.style.cssText = [
        'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:99999',
        'background:#b91c1c', 'color:#fff', 'padding:.75rem 1.25rem',
        'display:flex', 'align-items:flex-start', 'gap:.75rem',
        'font-size:.875rem', 'line-height:1.5', 'box-shadow:0 2px 8px rgba(0,0,0,.4)',
      ].join(';');
      banner.innerHTML = `
        <i class="fa-solid fa-triangle-exclamation" style="margin-top:.2rem;flex-shrink:0;font-size:1.1rem"></i>
        <div style="flex:1">
          <strong>Database setup required — orders are NOT saving to Supabase.</strong>
          <ul style="margin:.35rem 0 .5rem;padding-left:1.25rem">
            ${issues.map(i => `<li>${i}</li>`).join('')}
          </ul>
          <strong>How to fix:</strong> ${fix}
        </div>
        <button onclick="document.getElementById('zm-db-setup-banner').remove()"
          style="background:none;border:none;color:#fff;font-size:1.25rem;cursor:pointer;flex-shrink:0;margin-top:-.1rem">×</button>
      `;
      // Insert at the very top of the page, above the sidebar
      document.body.insertBefore(banner, document.body.firstChild);
      // Push main content down so banner doesn't overlap
      const h = banner.offsetHeight;
      const wrapper = document.getElementById('admin-wrapper');
      if (wrapper) wrapper.style.paddingTop = `${h}px`;
    } catch (_) { /* non-critical */ }
  })();

  // ── Wire events ──────────────────────────────────────────────
  document.getElementById('admin-logout-btn')?.addEventListener('click', () => {
    adminConfirm({ title: 'Sign out?', message: 'You will be returned to the login screen.', confirm: 'Sign out', icon: 'info' }).then(ok => { if (ok) adminLogout(); });
  });

  const sidebarEl = document.getElementById('admin-sidebar');
  const toggleBtn  = document.getElementById('sidebar-toggle');

  // ── Sidebar overlay (mobile) ─────────────────────────────
  const overlay = document.createElement('div');
  overlay.className = 'admin-sidebar-overlay';
  overlay.id = 'admin-sidebar-overlay';
  document.body.appendChild(overlay);

  function openSidebar() {
    sidebarEl?.classList.add('open');
    overlay.classList.add('visible');
    document.body.style.overflow = 'hidden'; // prevent background scroll
  }
  function closeSidebar() {
    sidebarEl?.classList.remove('open');
    overlay.classList.remove('visible');
    document.body.style.overflow = '';
  }

  toggleBtn?.addEventListener('click', () => {
    if (sidebarEl?.classList.contains('open')) closeSidebar();
    else openSidebar();
  });

  overlay.addEventListener('click', closeSidebar);

  // Close sidebar when a nav link is clicked on mobile
  sidebarEl?.querySelectorAll('.sidebar-link').forEach(link => {
    link.addEventListener('click', () => {
      if (window.innerWidth < 900) closeSidebar();
    });
  });

  // Close on resize to desktop
  window.addEventListener('resize', () => {
    if (window.innerWidth >= 900) closeSidebar();
  });

  // Swipe-to-close support
  let touchStartX = 0;
  sidebarEl?.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; }, { passive: true });
  sidebarEl?.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (dx < -60) closeSidebar(); // swipe left to close
  }, { passive: true });

  // Notifications button → dropdown panel
  async function renderAdminNotifBadge() {
    const badge = document.getElementById('admin-notif-badge');
    if (!badge) return;
    const count = await getAdminUnreadCount();
    if (count > 0) {
      badge.textContent   = count > 9 ? '9+' : String(count);
      badge.style.display = 'flex';
      badge.style.alignItems = 'center';
      badge.style.justifyContent = 'center';
    } else {
      badge.style.display = 'none';
    }
  }

  async function renderAdminNotifDropdown() {
    const dropdown = document.getElementById('admin-notif-dropdown');
    if (!dropdown) return;
    const notifs = await getAdminNotifications();

    const iconMap = {
      new_order:  { icon: 'fa-solid fa-cart-shopping',    color: 'var(--clr-gold)' },
      new_review: { icon: 'fa-solid fa-star',              color: 'var(--clr-warning,#f59e0b)' },
      default:    { icon: 'fa-solid fa-bell',              color: 'var(--clr-info)' },
    };

    dropdown.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:.75rem 1rem;border-bottom:1px solid var(--clr-border);background:var(--clr-surface)">
        <span style="font-weight:700;font-size:.9rem;color:var(--clr-text)">Notifications</span>
        <button id="admin-notif-mark-all" style="background:none;border:none;color:var(--clr-gold);font-size:.75rem;cursor:pointer;padding:.25rem .5rem;border-radius:6px">Mark all read</button>
      </div>
      <div style="overflow-y:auto;max-height:380px">
        ${notifs.length === 0 ? `
          <div style="padding:2rem;text-align:center;color:var(--clr-text-3);font-size:.875rem">
            <i class="fa-regular fa-bell" style="font-size:1.5rem;display:block;margin-bottom:.5rem"></i>
            No notifications yet
          </div>` :
          notifs.map(n => {
            const ic = iconMap[n.type] || iconMap.default;
            // FIXED: Supabase stores refId inside data.refId — support both shapes
            const refId = n.data?.refId || n.refId || null;
            const link = refId ? `/admin/order-detail?id=${encodeURIComponent(refId)}` : null;
            // FIXED: Supabase returns created_at (snake_case); fall back to camelCase
            const ts = n.created_at || n.createdAt || null;
            return `
              <div class="admin-notif-item" data-id="${n.id}" style="display:flex;align-items:flex-start;gap:.75rem;padding:.75rem 1rem;border-bottom:1px solid var(--clr-border);cursor:pointer;background:${n.read ? 'transparent' : 'rgba(201,168,76,.07)'};transition:background .15s">
                <div style="flex-shrink:0;width:32px;height:32px;border-radius:50%;background:rgba(201,168,76,.12);display:flex;align-items:center;justify-content:center;margin-top:.1rem">
                  <i class="${ic.icon}" style="color:${ic.color};font-size:.8rem"></i>
                </div>
                <div style="flex:1;min-width:0">
                  <div style="font-weight:${n.read ? '500' : '700'};font-size:.8125rem;color:var(--clr-text);line-height:1.3">${esc(n.title)}</div>
                  <div style="font-size:.75rem;color:var(--clr-text-2);margin-top:.2rem;line-height:1.4">${esc(n.message)}</div>
                  <div style="font-size:.7rem;color:var(--clr-text-3);margin-top:.3rem">${ts ? new Date(ts).toLocaleString() : ''}</div>
                </div>
                ${!n.read ? `<span style="width:7px;height:7px;border-radius:50%;background:var(--clr-gold);flex-shrink:0;margin-top:.35rem"></span>` : ''}
              </div>`;
          }).join('')
        }
      </div>
      ${notifs.length > 0 ? `<div style="padding:.5rem 1rem;border-top:1px solid var(--clr-border);text-align:center">
        <a href="notifications.html" style="font-size:.75rem;color:var(--clr-gold);text-decoration:none">View all notifications →</a>
      </div>` : ''}`;

    // Mark all read button
    dropdown.querySelector('#admin-notif-mark-all')?.addEventListener('click', async e => {
      e.stopPropagation();
      markAllAdminRead();
      await renderAdminNotifBadge();
      await renderAdminNotifDropdown();
    });

    // Click on item → mark read + navigate
    dropdown.querySelectorAll('.admin-notif-item').forEach(el => {
      el.addEventListener('click', async () => {
        const id = el.dataset.id;
        markAdminRead(id);
        await renderAdminNotifBadge();
        // FIXED: getAdminNotifications is async; refId is in n.data?.refId (Supabase shape)
        const allNotifs = await getAdminNotifications();
        const notif = allNotifs.find(n => n.id === id);
        const refId = notif?.data?.refId || notif?.refId || null;
        if (refId) window.location.href = `/admin/order-detail?id=${encodeURIComponent(refId)}`;
        else closeDropdown();
      });
    });
  }

  let dropdownOpen = false;

  function positionDropdown() {
    const dd  = document.getElementById('admin-notif-dropdown');
    const btn = document.getElementById('admin-notif-btn');
    if (!dd || !btn) return;
    const rect = btn.getBoundingClientRect();
    // Align right edge of dropdown with right edge of button
    const right  = window.innerWidth - rect.right;
    const top    = rect.bottom + 6;
    dd.style.top   = top  + 'px';
    dd.style.right = right + 'px';
    dd.style.left  = 'auto';
  }

  async function openDropdown() {
    let dd = document.getElementById('admin-notif-dropdown');
    if (!dd) return;

    // ── Portal: hoist to <body> so it escapes the topbar stacking context ──
    // The topbar has position:sticky + z-index:100 which creates a stacking
    // context — any child's z-index is confined within it and will always
    // render behind content outside the topbar. Moving the dropdown to body
    // makes its z-index apply globally.
    if (dd.parentElement !== document.body) {
      document.body.appendChild(dd);
    }

    await renderAdminNotifDropdown();
    positionDropdown();
    dd.style.display       = 'flex';
    dd.style.flexDirection = 'column';
    dd.style.position      = 'fixed';
    dropdownOpen = true;
  }

  function closeDropdown() {
    const dd = document.getElementById('admin-notif-dropdown');
    if (dd) dd.style.display = 'none';
    dropdownOpen = false;
  }

  // Re-position on scroll/resize so it tracks the button
  window.addEventListener('scroll',  () => { if (dropdownOpen) positionDropdown(); }, { passive: true });
  window.addEventListener('resize',  () => { if (dropdownOpen) positionDropdown(); }, { passive: true });

  document.getElementById('admin-notif-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    if (dropdownOpen) closeDropdown();
    else openDropdown();
  });

  document.addEventListener('click', e => {
    if (dropdownOpen && !document.getElementById('admin-notif-dropdown')?.contains(e.target)) {
      closeDropdown();
    }
  });

  // Refresh badge on load and whenever notifications change
  renderAdminNotifBadge();
  window.addEventListener('admin_notifications:updated', () => {
    renderAdminNotifBadge();
    if (dropdownOpen) renderAdminNotifDropdown();
  });

  // Theme toggle
  initTheme();
}

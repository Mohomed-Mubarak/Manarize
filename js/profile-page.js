/* ============================================================
   ZENMARKET — PROFILE PAGE  (v23 — bug-fixed + modern UI)
   ============================================================ */
import { withLoader }    from './loader.js';
import { injectLayout }  from './layout.js';
import { getCurrentUser, isLoggedIn, logout, updateProfile,
         getAddresses, addAddress, updateAddress, deleteAddress,
         setDefaultAddress, initSupabaseListeners, setSession } from './auth.js';
import { initPhoneInput, getPhoneValue } from './phone-input.js';
import { getUserNotifications, getUnreadCount, markRead, markAllRead,
         deleteNotification, notifIcon } from './notifications.js';
import { getProducts }  from './store-adapter.js';
import { getWishlist }             from './cart.js';
import { formatPrice, formatDate, orderStatusBadge } from './utils.js';
import { getUserReview, canEdit, getUserReviews, addReview, editReview, canReview, hasPurchased } from './reviews.js';
import toast from './toast.js';
import { DEMO_MODE } from './config.js';
import { getSupabase } from './supabase.js';
 
function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
import { confirmModal } from './modal.js';
 
/* ── Synchronous early hydration ─────────────────────────────────
   Runs immediately when the module is parsed (before any await).
   Reads the cached session from localStorage and populates the
   sidebar so the user never sees the raw "—" placeholders, even
   if a later Supabase call is slow or fails.
   ────────────────────────────────────────────────────────────── */
(function _hydrateProfileSidebarSync() {
  try {
    // setSession() writes to sessionStorage — must read from the same store.
    // Previously this read from localStorage, which is always empty, so the
    // sidebar never hydrated synchronously.
    const raw = sessionStorage.getItem('zm_session');
    if (!raw) return;
    const user = JSON.parse(raw);
    if (!user) return;
 
    const name  = user.name  || (user.email ? user.email.split('@')[0] : '') || 'My Account';
    const email = user.email || '';
 
    const nameEl   = document.getElementById('profile-name');
    const emailEl  = document.getElementById('profile-email');
    const avatarEl = document.getElementById('profile-avatar');
 
    if (nameEl)  nameEl.textContent  = name;
    if (emailEl) emailEl.textContent = email;
    if (avatarEl) {
      avatarEl.innerHTML = '';                        // remove default <i> icon
      avatarEl.textContent = name[0].toUpperCase();
      avatarEl.classList.add('has-initial');
    }
  } catch (_) { /* silently ignore — async block will fill in shortly */ }
})();
 
/**
 * In production, Supabase may have a valid session that hasn't been
 * written to zm_session yet (e.g. first load after OTP redirect).
 * We call sb.auth.getSession() directly to check and hydrate it.
 */
async function waitForSession() {
  if (DEMO_MODE) return isLoggedIn();
 
  const sb = getSupabase();
  if (!sb) return isLoggedIn();
 
  // Always fetch a fresh Supabase session so name/email are never stale.
  // This fixes returning users whose localStorage session has empty name/email.
  const { data } = await sb.auth.getSession();
  const sbSession = data?.session;
 
  if (sbSession?.user) {
    const sbUser = sbSession.user;
    let name = sbUser.user_metadata?.name
            || sbUser.user_metadata?.full_name
            || sbUser.user_metadata?.display_name
            || sbUser.identities?.[0]?.identity_data?.name
            || '';
    let email = sbUser.email || '';
 
    // If auth metadata has no name, try the server-side profile endpoint
    // (bypasses RLS recursion that causes 500 errors)
    let _profileRole = 'customer';
    try {
      const token = sbSession.access_token;
      let profile = null;

      // Primary: server-side endpoint (bypasses RLS)
      if (token) {
        try {
          const resp = await fetch('/api/auth/profile', {
            headers: { Authorization: `Bearer ${token}` },
            credentials: 'same-origin',
          });
          if (resp.ok) {
            const body = await resp.json();
            profile = body.profile || null;
          }
        } catch { /* fall through to direct query */ }
      }

      // Fallback: direct Supabase query (works after RLS migration)
      if (!profile) {
        const { data: p } = await sb
          .from('profiles')
          .select('name, email, role, active')
          .eq('id', sbUser.id)
          .single();
        profile = p;
      }

      if (profile) {
        if (!name  && profile.name)  name  = profile.name;
        if (!email && profile.email) email = profile.email;
        if (profile.role === 'admin' && profile.active !== false) {
          _profileRole = 'admin';
          // Ensure admin session exists for admin page access
          sessionStorage.setItem('zm_admin_session', JSON.stringify({
            email:      email || sbUser.email,
            role:       'admin',
            name:       profile.name || name,
            supabaseId: sbUser.id,
            loginAt:    Date.now(),
          }));
        }
      }
    } catch (_) { /* profiles table may not exist in all setups */ }
 
    // Final fallback — derive display name from email
    if (!name) name = email ? email.split('@')[0] : 'My Account';
 
    setSession({
      id:        sbUser.id,
      name,
      email,
      phone:     sbUser.user_metadata?.phone || '',
      role:      _profileRole || 'customer',
      createdAt: sbUser.created_at,
      _supabase: true,
    });
    return true;
  }
 
  // No live Supabase session — fall back to whatever is in localStorage.
  return isLoggedIn();
}
 
withLoader(async () => {
  initSupabaseListeners();
 
  // ── 1. Auth gate ──────────────────────────────────────────
  let authed = false;
  try { authed = await waitForSession(); } catch(e) { console.warn('[Profile] waitForSession error:', e); }
  if (!authed) { window.location.href = '/login'; return; }
 
  // ── 2. Layout (nav + footer) ──────────────────────────────
  try { await injectLayout({}); } catch(e) { console.warn('[Profile] injectLayout error:', e); }
 
  // ── 3. Resolve user — must never be null past this point ──
  let user = getCurrentUser();
  if (!user) {
    // Session was lost between waitForSession and getCurrentUser (race with
    // onAuthStateChange). Re-try once from Supabase before giving up.
    try {
      const sb = getSupabase ? getSupabase() : null;
      if (sb) {
        const { data } = await sb.auth.getSession();
        if (data?.session?.user) {
          const sbUser = data.session.user;
          const name = sbUser.user_metadata?.name
                    || sbUser.user_metadata?.full_name
                    || sbUser.user_metadata?.display_name
                    || sbUser.identities?.[0]?.identity_data?.name
                    || sbUser.email?.split('@')[0]
                    || 'My Account';
          let raceRole = 'customer';
          try {
            const { data: raceProfile } = await sb.from('profiles').select('role,active').eq('id', sbUser.id).single();
            if (raceProfile?.role === 'admin' && raceProfile.active !== false) raceRole = 'admin';
          } catch { /* noop */ }
          setSession({ id: sbUser.id, name, email: sbUser.email,
                       phone: sbUser.user_metadata?.phone || '',
                       role: raceRole, createdAt: sbUser.created_at, _supabase: true });
          user = getCurrentUser();
        }
      }
    } catch(e) { console.warn('[Profile] session re-fetch error:', e); }
  }
  if (!user) { window.location.href = '/login'; return; }
 
  // Guarantee name and email are never empty strings
  if (!user.name)  user.name  = user.email?.split('@')[0] || 'My Account';
  if (!user.email) user.email = '';
 
  // ── 4. Welcome toast ──────────────────────────────────────
  try {
    const justLoggedIn = sessionStorage.getItem('zm_just_logged_in');
    if (justLoggedIn) {
      sessionStorage.removeItem('zm_just_logged_in');
      const firstName = (user.name || '').split(' ')[0] || 'there';
      toast.success(`Welcome back, ${firstName}! 👋`, 'You are now signed in.');
    }
  } catch(e) { /* non-critical */ }
 
  // ── 5. Sidebar — avatar / name / email ────────────────────
  // (also re-runs here to pick up any fresher Supabase data, overwriting
  //  the synchronous early hydration that ran at module parse time)
  try {
    const displayName  = user.name  || user.email?.split('@')[0] || 'My Account';
    const displayEmail = user.email || '';
    const initial      = displayName[0].toUpperCase();
 
    const avatarEl = document.getElementById('profile-avatar');
    if (avatarEl) {
      avatarEl.innerHTML = '';
      avatarEl.textContent = initial;
      avatarEl.classList.add('has-initial');
    }
    const nameEl  = document.getElementById('profile-name');
    const emailEl = document.getElementById('profile-email');
    if (nameEl)  nameEl.textContent  = displayName;
    if (emailEl) emailEl.textContent = displayEmail;
  } catch(e) { console.warn('[Profile] sidebar update error:', e); }
 
  // ── 6. Settings form prefill ──────────────────────────────
  try {
    const settingsName  = document.getElementById('settings-name');
    const settingsPhone = document.getElementById('settings-phone');
    const settingsEmail = document.getElementById('settings-email');
    if (settingsName)  settingsName.value  = user.name  || '';
    if (settingsEmail) settingsEmail.value = user.email || '';
    if (settingsPhone) {
      initPhoneInput(settingsPhone);
      if (user.phone) settingsPhone.value = user.phone;
    }
  } catch(e) { console.warn('[Profile] settings prefill error:', e); }
 
  // ── 7. Panel routing ──────────────────────────────────────
  try {
    const urlPanel = new URLSearchParams(window.location.search).get('panel') || 'orders';
    activatePanel(urlPanel);
    initNav();
  } catch(e) { console.warn('[Profile] nav init error:', e); }
 
  // ── 8. Data panels — parallelise independent async panels ──────────────
  // renderOrders and renderMyReviews each hit Supabase; running them in
  // parallel cuts dashboard load time roughly in half.
  await Promise.allSettled([
    renderOrders(user)   .catch(e => console.warn('[Profile] renderOrders error:', e)),
    renderMyReviews(user).catch(e => console.warn('[Profile] renderMyReviews error:', e)),
  ]);
  try { renderWishlist();               } catch(e) { console.warn('[Profile] renderWishlist error:', e); }
  try { initSettings(user);             } catch(e) { console.warn('[Profile] initSettings error:', e); }
  try { renderNotifications(user);      } catch(e) { console.warn('[Profile] renderNotifications error:', e); }
  try { renderAddresses(user);          } catch(e) { console.warn('[Profile] renderAddresses error:', e); }
  try { updateProfileNotifBadge(user);  } catch(e) { /* non-critical */ }

  // ── 9. Event listeners ────────────────────────────────────
  window.addEventListener('notifications:updated', () => {
    try { renderNotifications(user); updateProfileNotifBadge(user); } catch {}
  });
 
  document.getElementById('mark-all-read-btn')?.addEventListener('click', () => {
    markAllRead(user.id);
    try { renderNotifications(user); updateProfileNotifBadge(user); } catch {}
    toast.success('Done', 'All notifications marked as read');
  });
 
  document.getElementById('logout-btn')?.addEventListener('click', e => {
    e.preventDefault();
    logout();
  });
});
 
// ── Panel helpers ─────────────────────────────────────────────
function activatePanel(panelId) {
  document.querySelectorAll('.profile-nav-link').forEach(l => l.classList.remove('active'));
  document.querySelectorAll('.profile-panel').forEach(p => { p.style.display = 'none'; });
  const link  = document.querySelector(`.profile-nav-link[data-panel="${panelId}"]`);
  const panel = document.getElementById(`panel-${panelId}`);
  if (link)  link.classList.add('active');
  if (panel) panel.style.display = '';
}
 
function initNav() {
  document.querySelectorAll('.profile-nav-link[data-panel]').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      activatePanel(link.dataset.panel);
    });
  });
}
 
// ── Orders ────────────────────────────────────────────────────
async function renderOrders(user) {
  const container = document.getElementById('orders-list');
  if (!container) return;
 
  // ── Merge Supabase orders + localStorage orders ───────────────
  // Orders may land in localStorage when the Supabase INSERT fails
  // (RLS, network, session issues). We merge both sources so the
  // user always sees their orders regardless of where they landed.
  let supabaseOrders = [];
  try {
    // Direct Supabase query — bypasses RLS-blocked getMyOrders
    const { getSupabase } = await import('./supabase.js');
    const sb = getSupabase();
    if (sb && user.id) {
      // Primary: match by customer_id (Supabase UUID stored at checkout)
      const { data: byId, error: idErr } = await sb
        .from('orders')
        .select('*')
        .eq('customer_id', user.id)
        .order('created_at', { ascending: false });

      let rows = byId || [];

      // Fallback: if RLS blocked or no results, also query by email so orders
      // placed before the user linked their Supabase session are visible.
      if ((idErr || rows.length === 0) && user.email) {
        const { data: byEmail } = await sb
          .from('orders')
          .select('*')
          .eq('customer_email', user.email)
          .order('created_at', { ascending: false });

        if (byEmail?.length) {
          // Merge, deduplicate by order id
          const seen = new Set(rows.map(r => r.id));
          for (const r of byEmail) {
            if (!seen.has(r.id)) { rows.push(r); seen.add(r.id); }
          }
          rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        }

        if (idErr && rows.length === 0) throw new Error(idErr.message);
      }

      supabaseOrders = rows.map(row => ({
        id:            row.id,
        customerId:    row.customer_id,
        customerName:  row.customer_name   || '',
        customerEmail: row.customer_email  || '',
        customerPhone: row.customer_phone  || '',
        items:         row.items           || [],
        subtotal:      row.subtotal        || 0,
        shipping:      row.shipping        || 0,
        discount:      row.discount        || 0,
        total:         row.total           || 0,
        status:        row.status          || 'pending',
        paymentStatus: row.payment_status  || 'pending',
        paymentMethod: row.payment_method  || '',
        coupon:        row.coupon_code     || '',
        bankRef:       row.bank_ref        || null,
        paymentSlip:   row.payment_slip    || null,
        address:       row.address         || {},
        notes:         row.notes           || '',
        createdAt:     row.created_at,
        updatedAt:     row.updated_at,
      }));
    }
  } catch (e) {
    console.warn('[Profile] Supabase orders fetch failed:', e.message);
  }

  // ── Server-side fallback: /api/user-orders (JWT-verified, service-role) ──
  // Runs when RLS blocks the direct query but the user IS authenticated —
  // e.g. when /api/auth/session is unavailable (404) and the Supabase client
  // cannot restore a session from cookies.
  if (supabaseOrders.length === 0) {
    try {
      const sb2 = getSupabase();
      if (sb2) {
        const { data: { session: _sess } } = await sb2.auth.getSession();
        const jwt = _sess?.access_token;
        if (jwt) {
          const _resp = await fetch('/api/user-orders', {
            headers: { 'Authorization': `Bearer ${jwt}` },
          });
          if (_resp.ok) {
            const { orders: _rows } = await _resp.json();
            supabaseOrders = (_rows || []).map(row => ({
              id:            row.id,
              customerId:    row.customer_id,
              customerName:  row.customer_name   || '',
              customerEmail: row.customer_email  || '',
              customerPhone: row.customer_phone  || '',
              items:         row.items           || [],
              subtotal:      row.subtotal        || 0,
              shipping:      row.shipping        || 0,
              discount:      row.discount        || 0,
              total:         row.total           || 0,
              status:        row.status          || 'pending',
              paymentStatus: row.payment_status  || 'pending',
              paymentMethod: row.payment_method  || '',
              coupon:        row.coupon_code     || '',
              bankRef:       row.bank_ref        || null,
              paymentSlip:   row.payment_slip    || null,
              address:       row.address         || {},
              notes:         row.notes           || '',
              createdAt:     row.created_at,
              updatedAt:     row.updated_at,
            }));
          }
        }
      }
    } catch (_e2) {
      console.warn('[Profile] /api/user-orders fallback failed:', _e2.message);
    }
  }

  // ── SessionStorage fallback for locally-stored orders ───────────
  // If the checkout couldn't sync to Supabase (network/RLS/missing env vars),
  // the order is saved to sessionStorage as zm_last_order. We surface it here
  // so the user always sees their most recent order even if Supabase is down.
  // We merge by ID so a synced order is never shown twice.
  let sessionOrders = [];
  try {
    const raw = sessionStorage.getItem('zm_last_order');
    if (raw) {
      const o = JSON.parse(raw);
      // Only include if it belongs to this user (by id or email)
      const idMatch    = o?.customerId    && user.id    && o.customerId    === user.id;
      const emailMatch = o?.customerEmail && user.email && o.customerEmail === user.email;
      if ((idMatch || emailMatch) && o.id) {
        // Only add if not already in Supabase results
        const alreadySynced = supabaseOrders.some(s => s.id === o.id);
        if (!alreadySynced) {
          sessionOrders.push({ ...o, _localOnly: true }); // flag for badge
        }
      }
    }
  } catch (_) { /* ignore parse errors */ }
 
  // Merge: Supabase orders first (authoritative), then any local-only orders
  const orders = [...supabaseOrders, ...sessionOrders]
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  if (!orders.length) {
    container.innerHTML = `
      <div class="pnl-empty">
        <div class="pnl-empty__icon"><i class="fa-solid fa-bag-shopping"></i></div>
        <h3>No orders yet</h3>
        <p>Your order history will appear here once you place your first order.</p>
        <a href="/shop" class="btn btn-primary">Start Shopping</a>
      </div>`;
    return;
  }
  const allProducts = await getProducts();
  const slugById = {};
  allProducts.forEach(p => { slugById[p.id] = p.slug; });
 
  const orderCards = await Promise.all(orders.map(async o => {
    const canReviewOrder = o.status === 'delivered';
    const itemsHtml = (await Promise.all((o.items || []).map(async item => {
      const slug = item.slug || slugById[item.productId] || '';
      let reviewBadge = '';
      if (canReviewOrder && slug) {
        // canEdit() internally calls getUserReview() — deduplicate to one DB call.
        const already = await getUserReview(user.id, item.productId);
        const editOk  = already ? (!already.editedAt && !already.edited_at) : false;
        if (already && !editOk)
          reviewBadge = `<span class="badge badge-success"><i class="fa-solid fa-circle-check"></i> Reviewed</span>`;
        else if (already && editOk)
          reviewBadge = `<a href="/product?slug=${encodeURIComponent(slug)}&review=1" class="badge badge-warning"><i class="fa-solid fa-pen"></i> Edit</a>`;
        else
          reviewBadge = `<a href="/product?slug=${encodeURIComponent(slug)}&review=1" class="badge badge-gold"><i class="fa-solid fa-star"></i> Review</a>`;
      }
      return `
        <div class="order-item">
          <div class="order-item__name">
            <span>${esc(item.name)}</span>
            ${item.variant ? `<span class="order-item__variant">${esc(item.variant)}</span>` : ''}
            <span class="order-item__qty">×${item.qty}</span>
          </div>
          <div>${reviewBadge}</div>
        </div>`;
    }))).join('');
 
    return `
      <div class="order-card${o._localOnly ? ' order-card--local' : ''}">
        ${o._localOnly ? `
          <div style="background:var(--clr-warning-bg);border-bottom:1px solid rgba(243,156,18,.25);
                      padding:.5rem 1rem;font-size:.8rem;color:var(--clr-warning);
                      display:flex;align-items:center;gap:.5rem;border-radius:var(--r-md) var(--r-md) 0 0">
            <i class="fa-solid fa-clock-rotate-left"></i>
            Order not yet synced to server — shown from local storage. Contact support if it doesn't appear shortly.
          </div>` : ''}
        <div class="order-card__header">
          <div>
            <span class="order-card__id">${o.id}</span>
            <span class="order-card__date">${formatDate(o.createdAt)}</span>
          </div>
          <div class="order-card__right">
            ${orderStatusBadge(o.status)}
            <span class="order-card__total">${formatPrice(o.total)}</span>
          </div>
        </div>
        <div class="order-card__items">${itemsHtml}</div>
        <div class="order-card__footer">
          <a href="/order-success?id=${o.id}" class="btn btn-ghost btn-sm">
            <i class="fa-solid fa-receipt"></i> View Details
          </a>
        </div>
      </div>`;
  }));
  container.innerHTML = orderCards.join('');
}
 
// ── Wishlist ──────────────────────────────────────────────────
function renderWishlist() {
  const grid = document.getElementById('wishlist-grid');
  if (!grid) return;
  const list = getWishlist();
  if (!list.length) {
    grid.innerHTML = `
      <div class="pnl-empty" style="grid-column:1/-1">
        <div class="pnl-empty__icon"><i class="fa-regular fa-heart"></i></div>
        <h3>Your wishlist is empty</h3>
        <p>Save items you love to find them easily later.</p>
        <a href="/shop" class="btn btn-primary">Browse Products</a>
      </div>`;
    return;
  }
  grid.innerHTML = list.map(p => `
    <div class="product-card">
      <div class="product-card__image">
        <a href="/product?slug=${encodeURIComponent(esc(p.slug))}">
          <img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy">
        </a>
      </div>
      <div class="product-card__body">
        <a href="/product?slug=${encodeURIComponent(esc(p.slug))}" class="product-card__name">${esc(p.name)}</a>
        <div class="product-card__footer">
          <span class="product-card__price">${formatPrice(p.price)}</span>
        </div>
      </div>
    </div>`).join('');
}
 
// ── Reviews ───────────────────────────────────────────────────
function starsHtml(rating) {
  return Array.from({ length: 5 }, (_, i) =>
    `<i class="fa-${i < rating ? 'solid' : 'regular'} fa-star" style="color:var(--clr-warning);font-size:.75rem"></i>`
  ).join('');
}
 
function reviewStatusBadge(r) {
  if (r.approved) return `<span class="badge badge-success"><i class="fa-solid fa-circle-check"></i> Approved</span>`;
  if (r.rejected) return `<span class="badge badge-error"><i class="fa-solid fa-circle-xmark"></i> Not Approved</span>`;
  return `<span class="badge badge-warning"><i class="fa-solid fa-clock"></i> Pending Approval</span>`;
}
 
// ── Inline review form (used inside profile My Reviews panel) ─
function buildInlineReviewForm({ user, productId, productName, productImg, slug, existing, isEdit, container, onSuccess }) {
  const formId    = `prf-rv-form-${productId}`;
  const errorId   = `prf-rv-err-${productId}`;
  const charId    = `prf-rv-char-${productId}`;
  const ratingId  = `prf-rv-rating-${productId}`;
  const titleId   = `prf-rv-title-${productId}`;
  const textId    = `prf-rv-text-${productId}`;
 
  const imgHtml = productImg
    ? `<img src="${productImg}" alt="${productName}" style="width:56px;height:56px;object-fit:cover;border-radius:8px;flex-shrink:0;">`
    : `<div style="width:56px;height:56px;border-radius:8px;background:var(--clr-surface-2);display:flex;align-items:center;justify-content:center;flex-shrink:0;"><i class="fa-solid fa-box" style="color:var(--clr-text-3)"></i></div>`;
 
  const starInputHtml = [1,2,3,4,5].map(n => `
    <button type="button" class="prf-star-btn" data-val="${n}" data-fid="${productId}" style="
      background:none;border:none;cursor:pointer;padding:.1rem .15rem;font-size:1.4rem;
      color:${existing && n <= existing.rating ? 'var(--clr-gold,#f59e0b)' : 'var(--clr-border)'};
      transition:color .12s;line-height:1;
    ">★</button>`).join('');
 
  const editNote = isEdit
    ? `<div style="padding:.5rem .75rem;background:rgba(243,156,18,.08);border:1px solid rgba(243,156,18,.25);border-radius:6px;font-size:.78rem;color:var(--clr-warning,#f59e0b);margin-bottom:.75rem;">
        <i class="fa-solid fa-triangle-exclamation" style="margin-right:.3rem;"></i>
        You can edit your review <strong>one time only</strong>. This edit is final.
       </div>` : '';
 
  container.innerHTML = `
    <div class="prf-inline-form" style="
      background:var(--clr-surface);border:1px solid var(--clr-gold,#f59e0b);border-radius:12px;
      padding:1.25rem;margin-bottom:.75rem;
    ">
      <div style="display:flex;align-items:center;gap:.75rem;margin-bottom:1rem;">
        ${imgHtml}
        <div>
          <div style="font-weight:700;font-size:.9375rem;color:var(--clr-text)">${productName}</div>
          <div style="font-size:.78rem;color:var(--clr-text-3);margin-top:.15rem;">
            ${isEdit ? 'Edit your review' : 'Write your review'}
          </div>
        </div>
      </div>
      ${editNote}
      <div style="margin-bottom:.875rem;">
        <div style="font-size:.78rem;font-weight:600;color:var(--clr-text-2);margin-bottom:.4rem;text-transform:uppercase;letter-spacing:.05em;">Your Rating *</div>
        <div id="${ratingId}" style="display:flex;gap:.1rem;align-items:center;">${starInputHtml}</div>
      </div>
      <div style="margin-bottom:.75rem;">
        <label for="${titleId}" style="font-size:.78rem;font-weight:600;color:var(--clr-text-2);display:block;margin-bottom:.3rem;text-transform:uppercase;letter-spacing:.05em;">Title <span style="font-weight:400;opacity:.6">(optional)</span></label>
        <input id="${titleId}" type="text" maxlength="80" placeholder="Summarise your experience"
          value="${existing ? existing.title || '' : ''}"
          style="width:100%;padding:.6rem .75rem;border-radius:8px;border:1px solid var(--clr-border);background:var(--clr-surface-2);color:var(--clr-text);font-size:.875rem;box-sizing:border-box;">
      </div>
      <div style="margin-bottom:.875rem;">
        <label for="${textId}" style="font-size:.78rem;font-weight:600;color:var(--clr-text-2);display:block;margin-bottom:.3rem;text-transform:uppercase;letter-spacing:.05em;">Review * <span id="${charId}" style="float:right;font-weight:400;font-size:.72rem;opacity:.55"></span></label>
        <textarea id="${textId}" rows="4" maxlength="1000" placeholder="Share your experience with this product (min 10 characters)…"
          style="width:100%;padding:.6rem .75rem;border-radius:8px;border:1px solid var(--clr-border);background:var(--clr-surface-2);color:var(--clr-text);font-size:.875rem;resize:vertical;box-sizing:border-box;font-family:inherit;">${existing ? existing.text || '' : ''}</textarea>
      </div>
      <div id="${errorId}" style="color:var(--clr-error,#ef4444);font-size:.8rem;margin-bottom:.5rem;min-height:1.2em;"></div>
      <div style="display:flex;gap:.6rem;flex-wrap:wrap;">
        <button type="button" class="btn btn-primary btn-sm prf-rv-submit" data-pid="${productId}" style="gap:.4rem;">
          <i class="fa-solid fa-${isEdit ? 'pen' : 'paper-plane'}"></i>
          ${isEdit ? 'Save Edit' : 'Submit Review'}
        </button>
        <button type="button" class="btn btn-ghost btn-sm prf-rv-cancel" data-pid="${productId}">
          Cancel
        </button>
      </div>
    </div>`;
 
  // Rating stars interaction
  let selectedRating = existing ? existing.rating : 0;
  const ratingWrap = container.querySelector(`#${ratingId}`);
  const stars = ratingWrap ? Array.from(ratingWrap.querySelectorAll('.prf-star-btn')) : [];
 
  function paintStars(hoverVal) {
    stars.forEach(s => {
      const v = parseInt(s.dataset.val);
      s.style.color = v <= (hoverVal || selectedRating) ? 'var(--clr-gold,#f59e0b)' : 'var(--clr-border)';
    });
  }
  stars.forEach(s => {
    s.addEventListener('mouseenter', () => paintStars(parseInt(s.dataset.val)));
    s.addEventListener('mouseleave', () => paintStars(0));
    s.addEventListener('click', () => { selectedRating = parseInt(s.dataset.val); paintStars(0); });
  });
 
  // Char counter
  const textarea = container.querySelector(`#${textId}`);
  const charEl   = container.querySelector(`#${charId}`);
  if (textarea && charEl) {
    const update = () => { charEl.textContent = `${textarea.value.length}/1000`; };
    textarea.addEventListener('input', update);
    update();
  }
 
  // Submit
  container.querySelector('.prf-rv-submit')?.addEventListener('click', async () => {
    const errEl = container.querySelector(`#${errorId}`);
    const title = container.querySelector(`#${titleId}`)?.value || '';
    const text  = textarea?.value || '';
 
    if (!selectedRating) { errEl.textContent = 'Please select a star rating.'; return; }
    if (text.trim().length < 10) { errEl.textContent = 'Review must be at least 10 characters.'; return; }
    errEl.textContent = '';
 
    const result = isEdit
      ? await editReview({ productId, userId: user.id, rating: selectedRating, title, text })
      : await addReview({ productId, userId: user.id, userName: user.name, rating: selectedRating, title, text });
 
    if (!result.success) { errEl.textContent = result.error; return; }
 
    toast.success('Review submitted!', isEdit
      ? 'Your updated review is pending admin approval.'
      : 'Review submitted! It will appear once our team approves it.');
 
    onSuccess();
  });
 
  // Cancel — collapse back
  container.querySelector('.prf-rv-cancel')?.addEventListener('click', onSuccess);
}
 
async function renderMyReviews(user) {
  const container = document.getElementById('my-reviews-list');
  if (!container) return;
 
  // Build product lookup maps
  const allProducts = await getProducts();
  const slugById  = {};
  const nameById  = {};
  const imgById   = {};
  allProducts.forEach(p => {
    slugById[p.id] = p.slug;
    nameById[p.id] = p.name;
    imgById[p.id]  = (p.images || [])[0] || '';
  });
 
  function reRender() { renderMyReviews(user); }
 
  // All reviews this user has submitted
  const reviews      = await getUserReviews(user.id);
  const reviewedPids = new Set(reviews.map(r => r.productId));
 
  // Count badge on nav
  const countEl = document.getElementById('my-reviews-count');
  if (countEl) countEl.textContent = reviews.length ? String(reviews.length) : '';
 
  // Products from delivered orders NOT yet reviewed → "Ready to Review"
  // Merge Supabase + localStorage (same strategy as renderOrders)
  let _sbDelivered = [];
  try {
    const { getSupabase } = await import('./supabase.js');
    const sb = getSupabase();
    if (sb && user.id) {
      const { data } = await sb.from('orders').select('id,items,status,customer_id')
        .eq('customer_id', user.id).eq('status', 'delivered');
      _sbDelivered = (data || []).map(r => ({ id: r.id, items: r.items || [], status: r.status, customerId: r.customer_id }));
    }
  } catch (_) {}
  // Delivered orders from Supabase only — no localStorage fallback
  const deliveredOrders = _sbDelivered;
  const seenPids    = new Set();
  const pendingItems = [];
  deliveredOrders.forEach(order => {
    (order.items || []).forEach(item => {
      const pid = item.productId;
      if (!pid || reviewedPids.has(pid) || seenPids.has(pid)) return;
      seenPids.add(pid);
      pendingItems.push({
        productId:   pid,
        productName: item.name || nameById[pid] || pid,
        slug:        item.slug || slugById[pid] || '',
        img:         imgById[pid] || '',
      });
    });
  });
 
  // Empty state
  if (!reviews.length && !pendingItems.length) {
    container.innerHTML = `
      <div class="pnl-empty">
        <div class="pnl-empty__icon"><i class="fa-regular fa-star"></i></div>
        <h3>No reviews yet</h3>
        <p>Once your orders are delivered you can share your experience here.</p>
        <a href="/shop" class="btn btn-primary">Browse Products</a>
      </div>`;
    return;
  }
 
  // ── "Ready to Review" section ───────────────────────────────
  let readyHtml = '';
  if (pendingItems.length) {
    const itemsHtml = pendingItems.map(item => {
      const imgHtml = item.img
        ? `<img src="${item.img}" alt="${item.productName}" style="width:52px;height:52px;object-fit:cover;border-radius:8px;flex-shrink:0;">`
        : `<div style="width:52px;height:52px;border-radius:8px;background:var(--clr-surface-2);display:flex;align-items:center;justify-content:center;flex-shrink:0;"><i class="fa-solid fa-box" style="color:var(--clr-text-3)"></i></div>`;
      return `
        <div class="pending-review-item" id="prf-item-${item.productId}">
          ${imgHtml}
          <div class="pending-review-item__body">
            <div class="pending-review-item__name">${item.productName}</div>
            <div class="pending-review-item__sub">Delivered · Share your experience</div>
          </div>
          <button type="button" class="btn btn-primary btn-sm prf-open-form"
            data-pid="${item.productId}"
            data-name="${item.productName.replace(/"/g, '&quot;')}"
            data-img="${(item.img || '').replace(/"/g, '&quot;')}"
            data-slug="${item.slug}">
            <i class="fa-solid fa-star"></i> Write Review
          </button>
          <div class="prf-form-slot" id="prf-slot-${item.productId}"></div>
        </div>`;
    }).join('');
 
    readyHtml = `
      <div class="reviews-section">
        <div class="reviews-section__title">
          <i class="fa-solid fa-star" style="color:var(--clr-gold)"></i>
          Ready to Review
          <span class="count-badge">${pendingItems.length}</span>
        </div>
        <div class="pending-reviews">${itemsHtml}</div>
      </div>`;
  }
 
  // ── Submitted reviews ───────────────────────────────────────
  let submittedHtml = '';
  if (reviews.length) {
    const cardsHtml = reviews.map(r => {
      const slug        = slugById[r.productId] || '';
      const productName = nameById[r.productId] || r.productId;
      const editAllowed = !r.editedAt;
      const isPending   = !r.approved && !r.rejected;
      return `
        <div class="review-card${isPending ? ' review-card--pending' : ''}" id="prf-rc-${r.productId}">
          ${isPending ? `<div class="review-card__pending-bar">
            <i class="fa-solid fa-clock"></i> Pending admin approval — not yet visible on the product page
          </div>` : ''}
          <div class="review-card__header">
            <div>
              <div class="review-card__product">${productName}</div>
              <div class="review-card__meta">
                <span>${starsHtml(r.rating)}</span>
                <span class="review-card__date">${formatDate(r.createdAt)}</span>
                ${r.editedAt ? `<span class="review-card__edited">(edited)</span>` : ''}
              </div>
            </div>
            ${reviewStatusBadge(r)}
          </div>
          ${r.title ? `<div class="review-card__title">${esc(r.title)}</div>` : ''}
          <p class="review-card__text">${esc(r.text)}</p>
          <div class="review-card__actions">
            ${slug ? `<a href="/product?slug=${encodeURIComponent(slug)}" class="btn btn-ghost btn-sm">
              <i class="fa-solid fa-arrow-up-right-from-square"></i> View Product
            </a>` : ''}
            ${editAllowed ? `<button type="button" class="btn btn-ghost btn-sm prf-open-edit"
                style="color:var(--clr-warning)"
                data-pid="${r.productId}"
                data-name="${(productName).replace(/"/g, '&quot;')}"
                data-img="${(imgById[r.productId] || '').replace(/"/g, '&quot;')}"
                data-slug="${slug}">
                <i class="fa-solid fa-pen"></i> Edit <span style="font-size:.7rem;opacity:.7">(1 left)</span>
              </button>` : ''}
          </div>
          <div class="prf-edit-slot" id="prf-edit-slot-${r.productId}"></div>
        </div>`;
    }).join('');
 
    submittedHtml = `
      <div class="reviews-section">
        <div class="reviews-section__title">
          <i class="fa-regular fa-star" style="color:var(--clr-text-3)"></i>
          My Submitted Reviews
          <span class="count-badge count-badge--muted">${reviews.length}</span>
        </div>
        ${cardsHtml}
      </div>`;
  }
 
  container.innerHTML = readyHtml + submittedHtml;
 
  // ── Wire up "Write Review" buttons ────────────────────────
  container.querySelectorAll('.prf-open-form').forEach(btn => {
    btn.addEventListener('click', () => {
      const pid   = btn.dataset.pid;
      const name  = btn.dataset.name;
      const img   = btn.dataset.img;
      const slug  = btn.dataset.slug;
      const slot  = document.getElementById(`prf-slot-${pid}`);
      if (!slot) return;
 
      // Toggle: if already open, close it
      if (slot.children.length > 0) { slot.innerHTML = ''; return; }
 
      // Scroll the parent item into view
      slot.parentElement?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
 
      buildInlineReviewForm({
        user, productId: pid, productName: name, productImg: img, slug,
        existing: null, isEdit: false,
        container: slot,
        onSuccess: reRender,
      });
    });
  });
 
  // ── Wire up "Edit" buttons ────────────────────────────────
  container.querySelectorAll('.prf-open-edit').forEach(btn => {
    btn.addEventListener('click', async () => {
      const pid      = btn.dataset.pid;
      const name     = btn.dataset.name;
      const img      = btn.dataset.img;
      const slug     = btn.dataset.slug;
      const slot     = document.getElementById(`prf-edit-slot-${pid}`);
      const existing = await getUserReview(user.id, pid);
      if (!slot || !existing) return;
 
      if (slot.children.length > 0) { slot.innerHTML = ''; return; }
 
      slot.parentElement?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
 
      buildInlineReviewForm({
        user, productId: pid, productName: name, productImg: img, slug,
        existing, isEdit: true,
        container: slot,
        onSuccess: reRender,
      });
    });
  });
}
 
// ── Addresses ─────────────────────────────────────────────────
const SL_DISTRICTS = [
  'Colombo','Gampaha','Kalutara','Kandy','Matale','Nuwara Eliya',
  'Galle','Matara','Hambantota','Jaffna','Kilinochchi','Mannar',
  'Vavuniya','Mullaitivu','Trincomalee','Batticaloa','Ampara',
  'Kurunegala','Puttalam','Anuradhapura','Polonnaruwa','Badulla',
  'Monaragala','Ratnapura','Kegalle',
];
const SL_PROVINCES = [
  'Western','Central','Southern','Northern','Eastern',
  'North Western','North Central','Uva','Sabaragamuwa',
];
 
function districtOptions(selected = '') {
  return SL_DISTRICTS.map(d =>
    `<option value="${d}" ${d === selected ? 'selected' : ''}>${d}</option>`
  ).join('');
}
function provinceOptions(selected = '') {
  return SL_PROVINCES.map(p =>
    `<option value="${p}" ${p === selected ? 'selected' : ''}>${p}</option>`
  ).join('');
}
 
function addressFormHTML(addr = null) {
  const v = (key, def = '') => addr ? (addr[key] || def) : def;
  return `
    <div class="addr-form-grid">
      <div class="form-group">
        <label class="form-label">Label</label>
        <select class="form-control" name="label">
          ${['Home','Work','Other'].map(l =>
            `<option value="${l}" ${v('label','Home') === l ? 'selected' : ''}>${l}</option>`
          ).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label required">Full Name</label>
        <input class="form-control" type="text" name="fullName" value="${v('fullName')}" placeholder="Recipient name" required>
      </div>
      <div class="form-group addr-form-full">
        <label class="form-label required">Phone</label>
        <div class="ph-input-wrap">
          <span class="ph-prefix">+94</span>
          <input class="form-control ph-digits" type="tel" name="phone"
            value="${v('phone','').replace(/^\+94\s?/,'')}"
            placeholder="7X XXX XXXX" maxlength="10" required>
        </div>
        <small class="form-hint">Sri Lanka number — 9 digits after +94</small>
      </div>
      <div class="form-group addr-form-full">
        <label class="form-label required">Address Line 1</label>
        <input class="form-control" type="text" name="line1" value="${v('line1')}" placeholder="House/Flat no., Street" required>
      </div>
      <div class="form-group addr-form-full">
        <label class="form-label">Address Line 2</label>
        <input class="form-control" type="text" name="line2" value="${v('line2')}" placeholder="Area, Landmark (optional)">
      </div>
      <div class="form-group">
        <label class="form-label required">City</label>
        <input class="form-control" type="text" name="city" value="${v('city')}" placeholder="City" required>
      </div>
      <div class="form-group">
        <label class="form-label required">District</label>
        <select class="form-control" name="district" required>
          <option value="">Select District</option>
          ${districtOptions(v('district'))}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label required">Province</label>
        <select class="form-control" name="province" required>
          <option value="">Select Province</option>
          ${provinceOptions(v('province'))}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Postal Code</label>
        <input class="form-control" type="text" name="zip" value="${v('zip')}" placeholder="Optional">
      </div>
    </div>`;
}
 
function getFormData(container) {
  const get = name => container.querySelector(`[name="${name}"]`)?.value?.trim() || '';
  const digits = get('phone').replace(/\D/g, '');
  return {
    label:    get('label'),
    fullName: get('fullName'),
    phone:    digits ? `+94${digits}` : '',
    line1:    get('line1'),
    line2:    get('line2'),
    city:     get('city'),
    district: get('district'),
    province: get('province'),
    zip:      get('zip'),
  };
}
 
function validateAddressForm(data) {
  if (!data.fullName) return 'Full name is required.';
  if (!data.phone)    return 'Phone number is required.';
  const digits = data.phone.replace(/^\+94/, '');
  if (!/^\d{9}$/.test(digits)) return 'Phone must be exactly 9 digits after +94 (e.g. +94 7X XXX XXXX).';
  if (!data.line1)    return 'Address line 1 is required.';
  if (!data.city)     return 'City is required.';
  if (!data.district) return 'Please select a district.';
  if (!data.province) return 'Please select a province.';
  return null;
}
 
function labelIcon(label) {
  if (label === 'Work')  return 'fa-solid fa-briefcase';
  if (label === 'Other') return 'fa-solid fa-location-dot';
  return 'fa-solid fa-house';
}
 
async function renderAddresses(user) {
  const container = document.getElementById('addresses-list');
  const addBtn    = document.getElementById('add-address-btn');
  const addBtnEmpty = document.getElementById('add-address-empty-btn');
  if (!container) return;
 
  function reRender() { renderAddresses(user); }
 
  const addresses = await getAddresses(user.id);
 
  // ── Empty state ──
  if (!addresses.length) {
    container.innerHTML = `
      <div class="pnl-empty" id="addr-empty-state">
        <div class="pnl-empty__icon"><i class="fa-solid fa-location-dot"></i></div>
        <h3>No addresses saved</h3>
        <p>Add a delivery address to speed up your checkout.</p>
        <button class="btn btn-primary" id="add-address-empty-btn">
          <i class="fa-solid fa-plus"></i> Add Address
        </button>
      </div>
      <div id="addr-form-container"></div>`;
 
    document.getElementById('add-address-empty-btn')?.addEventListener('click', () => {
      openAddressModal(user, null, reRender);
    });
  } else {
    // ── Address cards ──
    container.innerHTML = `
      <div class="addr-cards-grid" id="addr-cards-grid">
        ${addresses.map(addr => `
          <div class="addr-card${addr.isDefault ? ' addr-card--default' : ''}" data-aid="${addr.id}">
            <div class="addr-card__header">
              <div class="addr-card__label">
                <i class="${labelIcon(addr.label)}"></i> ${esc(addr.label)}
              </div>
              ${addr.isDefault ? `<span class="badge badge-gold"><i class="fa-solid fa-star"></i> Default</span>` : ''}
            </div>
            <div class="addr-card__body">
              <div class="addr-card__name">${esc(addr.fullName)}</div>
              <div class="addr-card__phone"><i class="fa-solid fa-phone" style="font-size:.7rem;opacity:.6"></i> ${esc(addr.phone)}</div>
              <div class="addr-card__lines">
                ${esc(addr.line1)}${addr.line2 ? ', ' + esc(addr.line2) : ''},<br>
                ${esc(addr.city)}, ${esc(addr.district)},<br>
                ${esc(addr.province)} Province${addr.zip ? ' — ' + esc(addr.zip) : ''}
              </div>
            </div>
            <div class="addr-card__actions">
              ${!addr.isDefault ? `
                <button class="btn btn-ghost btn-sm addr-set-default" data-aid="${addr.id}">
                  <i class="fa-regular fa-circle-check"></i> Set Default
                </button>` : ''}
              <button class="btn btn-ghost btn-sm addr-edit" data-aid="${addr.id}">
                <i class="fa-solid fa-pen"></i> Edit
              </button>
              <button class="btn btn-ghost btn-sm addr-delete" data-aid="${addr.id}"
                style="color:var(--clr-error)">
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
          </div>`).join('')}
      </div>`;
 
    // Wire actions
    container.querySelectorAll('.addr-set-default').forEach(btn => {
      btn.addEventListener('click', async () => {
        await setDefaultAddress(user.id, btn.dataset.aid);
        toast.success('Default set', 'This is now your default delivery address.');
        reRender();
      });
    });
 
    container.querySelectorAll('.addr-edit').forEach(btn => {
      btn.addEventListener('click', async () => {
        const allAddrs = await getAddresses(user.id);
        const addr = allAddrs.find(a => a.id === btn.dataset.aid);
        if (addr) openAddressModal(user, addr, reRender);
      });
    });
 
    container.querySelectorAll('.addr-delete').forEach(btn => {
      btn.addEventListener('click', () => {
        confirmModal({
          title: 'Delete Address',
          message: 'Are you sure you want to remove this address? This action cannot be undone.',
          confirmText: 'Delete',
          cancelText: 'Cancel',
          danger: true,
          onConfirm: async () => {
            await deleteAddress(user.id, btn.dataset.aid);
            toast.success('Deleted', 'Address removed.');
            reRender();
          },
        });
      });
    });
  }
 
  // Wire header "Add Address" button
  document.getElementById('add-address-btn')?.addEventListener('click', () => {
    openAddressModal(user, null, reRender);
  });
}
 
function openAddressModal(user, existing, onSave) {
  document.getElementById('addr-modal')?.remove();
 
  const isEdit = !!existing;
  const modal  = document.createElement('div');
  modal.id = 'addr-modal';
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal modal-md">
      <div class="modal-header">
        <h3 class="modal-title">
          <i class="fa-solid fa-location-dot" style="color:var(--clr-gold)"></i>
          ${isEdit ? 'Edit Address' : 'Add New Address'}
        </h3>
        <button class="modal-close" id="addr-modal-close" aria-label="Close">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
      <div class="modal-body">
        ${addressFormHTML(existing)}
        <div id="addr-modal-error" style="display:none;margin-top:.75rem;padding:.65rem .875rem;background:var(--clr-error-bg,rgba(239,68,68,.1));color:var(--clr-error,#ef4444);border-radius:var(--r-md);font-size:.85rem"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" id="addr-modal-cancel">Cancel</button>
        <button class="btn btn-primary" id="addr-modal-save">
          <i class="fa-solid fa-floppy-disk"></i> ${isEdit ? 'Save Changes' : 'Save Address'}
        </button>
      </div>
    </div>`;
 
  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add('open'));
 
  const close = () => {
    modal.classList.remove('open');
    setTimeout(() => modal.remove(), 280);
  };
 
  document.getElementById('addr-modal-close')?.addEventListener('click', close);
  document.getElementById('addr-modal-cancel')?.addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
 
  // ── Phone: digits only, max 9 ──────────────────────────────
  const phoneInput = modal.querySelector('.ph-digits');
  if (phoneInput) {
    phoneInput.addEventListener('input', () => {
      phoneInput.value = phoneInput.value.replace(/\D/g, '').slice(0, 9);
    });
  }
 
  document.getElementById('addr-modal-save')?.addEventListener('click', async () => {
    const saveBtn = document.getElementById('addr-modal-save');
    const data  = getFormData(modal);
    const error = validateAddressForm(data);
    const errEl = document.getElementById('addr-modal-error');
    if (!errEl) return;
    if (error) {
      errEl.textContent    = error;
      errEl.style.display  = '';
      return;
    }
    errEl.style.display = 'none';
    if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving…'; }
 
    try {
      if (isEdit) {
        await updateAddress(user.id, existing.id, data);
        toast.success('Updated!', 'Address saved successfully.');
      } else {
        await addAddress(user.id, data);
        toast.success('Added!', 'New address saved.');
      }
    } catch(e) {
      errEl.textContent   = 'Failed to save address. Please try again.';
      errEl.style.display = '';
      if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> ${isEdit ? 'Save Changes' : 'Save Address'}`; }
      return;
    }
    close();
    onSave();
  });
}
 
// ── Settings ──────────────────────────────────────────────────
async function initSettings(user) {
  // ── Eye-toggle for all password fields ──────────────────────
  document.querySelectorAll('.pw-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      if (!input) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.querySelector('i').className = show ? 'fa-regular fa-eye-slash' : 'fa-regular fa-eye';
    });
  });
 
  // ── Pre-fill current password (demo mode only) ───────────────
  try {
    import('./config.js').then(({ DEMO_MODE }) => {
      if (!DEMO_MODE) return;
      const users = JSON.parse(localStorage.getItem('zm_users') || '[]');
      const stored = users.find(u => u.id === user.id || u.email === user.email);
      if (stored?.password) {
        const cpEl = document.getElementById('current-pass');
        // Only fill if plain-text (un-hashed); bcrypt hashes start with '$'
        if (cpEl && !stored.password.startsWith('$')) cpEl.value = stored.password;
      }
    }).catch(() => {});
  } catch (_) { /* production — passwords never exposed */ }
 
  document.getElementById('profile-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const name  = document.getElementById('settings-name')?.value.trim() || '';
    const phone = getPhoneValue(document.getElementById('settings-phone')) || '';
    const result = await updateProfile({ name, phone });
    if (result.success) {
      toast.success('Saved!', 'Profile updated successfully');
      const nameEl = document.getElementById('profile-name');
      if (nameEl) nameEl.textContent = name;
    }
  });
 
  document.getElementById('password-form')?.addEventListener('submit', e => {
    e.preventDefault();
    const current = document.getElementById('current-pass')?.value || '';
    const newPass = document.getElementById('new-pass')?.value || '';
    const confirm = document.getElementById('confirm-pass')?.value || '';
    if (!current)            { toast.error('Error', 'Please enter your current password'); return; }
    if (newPass !== confirm)  { toast.error('Error', 'Passwords do not match'); return; }
    if (newPass.length < 6)  { toast.error('Error', 'Password must be at least 6 characters'); return; }
    toast.success('Updated!', 'Password changed successfully');
    document.getElementById('password-form').reset();
  });
}
 
// ── Notifications ─────────────────────────────────────────────
async function updateProfileNotifBadge(user) {
  const badge = document.getElementById('profile-notif-badge');
  if (!badge) return;
  // FIXED: getUnreadCount is async (Supabase fetch) — was missing await
  const count = await getUnreadCount(user.id);
  badge.textContent   = count > 9 ? '9+' : String(count);
  badge.style.display = count > 0 ? '' : 'none';
}
 
async function renderNotifications(user) {
  const list = document.getElementById('notifications-list');
  if (!list) return;
 
  // Show loading state while fetching
  list.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--clr-text-3)"><i class="fa-solid fa-spinner fa-spin"></i> Loading notifications…</div>`;
 
  // FIXED: was missing `await` — getUserNotifications is async (Supabase fetch)
  const notifs = await getUserNotifications(user.id);
 
  if (!notifs.length) {
    list.innerHTML = `
      <div class="pnl-empty">
        <div class="pnl-empty__icon"><i class="fa-regular fa-bell"></i></div>
        <h3>No notifications yet</h3>
        <p>Order confirmations, review approvals and messages will appear here.</p>
      </div>`;
    return;
  }
 
  function timeAgo(iso) {
    if (!iso) return '';
    const diff  = Date.now() - new Date(iso).getTime();
    const mins  = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days  = Math.floor(diff / 86400000);
    if (mins  < 1)  return 'Just now';
    if (mins  < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days  < 7)  return `${days}d ago`;
    return new Date(iso).toLocaleDateString('en-LK', { day: 'numeric', month: 'short' });
  }
 
  list.innerHTML = notifs.map(n => {
    const { icon, color } = notifIcon(n.type);
    // FIXED: Supabase stores refId inside data.refId — support both shapes
    const refId  = n.data?.refId || n.refId || null;
    const isLink = refId && n.type === 'order_success';
    const href   = isLink ? `order-success.html?id=${encodeURIComponent(refId)}` : null;
    // FIXED: Supabase returns created_at (snake_case); fall back to camelCase for localStorage
    const timeStr = timeAgo(n.created_at || n.createdAt);
    return `
      <div data-notif-id="${n.id}" class="notif-card${n.read ? '' : ' notif-card--unread'}">
        <div class="notif-card__dot${n.read ? ' notif-card__dot--read' : ''}"></div>
        <div class="notif-card__icon" style="background:${color}22;color:${color}">
          <i class="${icon}"></i>
        </div>
        <div class="notif-card__body">
          ${href ? `<a href="${href}" class="notif-card__title">${esc(n.title)}</a>`
                 : `<div class="notif-card__title">${esc(n.title)}</div>`}
          <div class="notif-card__msg">${esc(n.message)}</div>
          <div class="notif-card__time">${timeStr}</div>
        </div>
        <div class="notif-card__actions">
          ${!n.read ? `<button class="notif-action-btn notif-read-btn" data-id="${n.id}" title="Mark as read">
            <i class="fa-solid fa-check"></i>
          </button>` : ''}
          <button class="notif-action-btn notif-del-btn" data-id="${n.id}" title="Delete">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </div>
      </div>`;
  }).join('');
 
  list.querySelectorAll('.notif-read-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      markRead(btn.dataset.id);
      renderNotifications(user);
      updateProfileNotifBadge(user);
    });
  });
 
  list.querySelectorAll('.notif-del-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      deleteNotification(btn.dataset.id);
      renderNotifications(user);
      updateProfileNotifBadge(user);
    });
  });
 
  list.querySelectorAll('.notif-card').forEach(card => {
    card.addEventListener('click', () => {
      markRead(card.dataset.notifId);
      renderNotifications(user);
      updateProfileNotifBadge(user);
    });
  });
}
 
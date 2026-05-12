/* ============================================================
   ZENMARKET — ORDER SUCCESS
   ============================================================ */
import { withLoader } from './loader.js';
import { injectLayout } from './layout.js';
import { getOrder, getSiteSettings } from './store-adapter.js';
import { formatPrice, getParam, estimateDelivery } from './utils.js';
import { printInvoice, downloadInvoicePDF } from './invoice.js';
import { WA_PHONE } from './config.js';
import { getCurrentUser, isLoggedIn } from './auth.js';

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

withLoader(async () => {
  // ── Auth guard — only logged-in users can view orders ────────
  if (!isLoggedIn()) {
    window.location.href = '/login?next=' + encodeURIComponent(window.location.href);
    return;
  }

  await injectLayout({});

  const currentUser = getCurrentUser();

  // ── Resolve order ─────────────────────────────────────────
  // 1. Try URL param → look up in localStorage orders
  // 2. Fall back to sessionStorage (set immediately before redirect)
  // 3. If truly not found, show error state rather than redirect
  const orderId = getParam('id');
  let order = null;

  if (orderId) {
    // Fetch this specific order from Supabase (or localStorage in demo mode).
    // getOrder() is O(1) — no need to load every order in the system.
    try {
      order = await getOrder(orderId);
    } catch (e) {
      console.warn('[OrderSuccess] getOrder failed, trying sessionStorage fallback:', e.message);
    }
  }

  // Fallback: order placed moments ago, still in sessionStorage
  if (!order) {
    try {
      const raw = sessionStorage.getItem('zm_last_order');
      if (raw) {
        const candidate = JSON.parse(raw);
        // Accept if it matches the URL param (or if there's no URL param)
        if (!orderId || candidate.id === orderId) {
          order = candidate;
        }
      }
    } catch { /* ignore parse errors */ }
  }

  // ── Ownership check — user can only see their own orders ──
  // Three match strategies (any ONE is enough to accept the order):
  //   1. Supabase user ID — most reliable in production
  //   2. Email — fallback when session was refreshed and IDs differ
  //   3. sessionStorage — order just placed in this tab (trust it directly)
  if (order) {
    const idMatch    = currentUser?.id    && order.customerId    === currentUser.id;
    const emailMatch = (currentUser?.email != null && currentUser.email !== '')
                       && order.customerEmail === currentUser.email;
    // sessionStorage match: the order was written there moments ago by checkout.js;
    // trust it even if the Supabase session user ID differs (e.g. after a token refresh).
    let sessionMatch = false;
    try {
      const raw = sessionStorage.getItem('zm_last_order');
      if (raw) {
        const cached = JSON.parse(raw);
        sessionMatch = cached?.id === order.id;
      }
    } catch (_) {}
    if (!idMatch && !emailMatch && !sessionMatch) {
      order = null; // not this user's order — prevent enumeration
    }
  }

  if (!order) {
    // Show a friendly error rather than silent redirect
    document.querySelector('.success-hero h1').textContent  = 'Order Not Found';
    document.querySelector('.success-hero p').textContent   = 'We could not locate your order. It may have already been recorded — check your profile for order history.';
    document.querySelector('.success-icon i').className     = 'fa-solid fa-circle-exclamation';
    document.querySelector('.success-icon').style.color     = 'var(--clr-warning)';
    document.querySelector('.order-actions').innerHTML      =
      `<a href="/profile" class="btn btn-primary"><i class="fa-regular fa-circle-user"></i> View My Orders</a>
       <a href="/shop" class="btn btn-ghost"><i class="fa-solid fa-store"></i> Continue Shopping</a>`;
    return;
  }

  await renderSuccessPage(order);

  // ── Show sync-failure banner if order is NOT in Supabase ──────────────
  // Directly check Supabase (anon key) to confirm the order exists.
  // Shows banner only when positively confirmed missing — no stale flag dependency.
  (async () => {
    try {
      const { SUPABASE_URL, SUPABASE_ANON_KEY } = await import('./config.js');
      if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !order?.id) return;
      // Small delay so the success page renders first
      await new Promise(r => setTimeout(r, 2000));
      const resp = await fetch(
        `${SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(order.id)}&select=id`,
        { headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` } }
      );
      if (!resp.ok) return; // Can't verify — don't show banner
      const rows = await resp.json();
      if (Array.isArray(rows) && rows.length > 0) {
        // Order IS in Supabase — all good, clear any stale flag
        try { localStorage.removeItem('zm_db_setup_required'); } catch (_) {}
        return;
      }
      // Order not found in Supabase — attempt a silent auto-retry INSERT first
      let autoSynced = false;
      try {
        const { getSupabase } = await import('./supabase.js');
        const sbRetry = getSupabase();
        if (sbRetry && order) {
          const retryRow = {
            id:             order.id,
            customer_id:    order.customerId    || null,
            customer_name:  order.customerName  || '',
            customer_email: order.customerEmail || '',
            customer_phone: order.customerPhone || '',
            items:          order.items         || [],
            subtotal:       order.subtotal      || 0,
            shipping:       order.shipping      || 0,
            discount:       order.discount      || 0,
            total:          order.total         || 0,
            status:         order.status        || 'pending',
            payment_status: order.paymentStatus || 'pending',
            payment_method: order.paymentMethod || '',
            coupon_code:    order.coupon        || '',
            bank_ref:       order.bankRef       || null,
            payment_slip:   order.paymentSlip   || null,
            address:        order.address       || {},
            notes:          order.notes         || '',
            created_at:     order.createdAt     || new Date().toISOString(),
            updated_at:     new Date().toISOString(),
          };
          const { error: retryErr } = await sbRetry.from('orders').insert(retryRow);
          if (!retryErr || retryErr.code === '23505') {
            autoSynced = true;
            // Remove from localStorage emergency backup now that it's in Supabase
            try {
              const local = JSON.parse(localStorage.getItem('zm_orders') || '[]');
              const cleaned = local.filter(o => o.id !== order.id);
              localStorage.setItem('zm_orders', JSON.stringify(cleaned));
              localStorage.removeItem('zm_db_setup_required');
            } catch (_) {}
            console.log('[OrderSuccess] Auto-retry sync succeeded for', order.id);
          }
        }
      } catch (_) {}

      if (autoSynced) return; // synced silently — no banner needed

      // Auto-retry failed — show the banner so the user knows
      const banner = document.createElement('div');
      banner.id = 'local-order-banner';
      banner.style.cssText = [
        'background:var(--clr-warning-bg)',
        'border:1px solid rgba(243,156,18,.4)',
        'border-radius:var(--r-xl)',
        'padding:1.25rem 1.5rem',
        'margin:1rem auto 2rem',
        'max-width:640px',
        'display:flex',
        'gap:.875rem',
        'align-items:flex-start',
        'position:relative',
      ].join(';');
      banner.innerHTML = `
        <i class="fa-solid fa-triangle-exclamation"
           style="color:var(--clr-warning);font-size:1.25rem;margin-top:.1rem;flex-shrink:0"></i>
        <div style="flex:1">
          <strong style="color:var(--clr-text);display:block;margin-bottom:.25rem">
            Order recorded locally
          </strong>
          <p style="font-size:.875rem;color:var(--clr-text-2);margin:0">
            Your order was placed but could not sync to the server.
            Please screenshot this page and contact support with your Order ID:&nbsp;
            <strong style="font-family:var(--ff-mono);color:var(--clr-text)">${order.id}</strong>
          </p>
        </div>
        <button id="dismiss-local-banner"
                style="background:none;border:none;cursor:pointer;color:var(--clr-text-3);
                       font-size:1.1rem;line-height:1;padding:0;flex-shrink:0"
                aria-label="Dismiss">×</button>`;
      document.querySelector('.success-hero')?.insertAdjacentElement('afterend', banner);
      document.getElementById('dismiss-local-banner')
        ?.addEventListener('click', () => banner.remove());
    } catch (_) { /* verification failed — don't show banner */ }
  })();

  launchConfetti();
});

async function renderSuccessPage(order) {
  (document.getElementById('order-number')||{}) .textContent = order.id;

  // ── Bank transfer notice ─────────────────────────────────
  if (order.paymentMethod === 'bank') {
    let settings = {};
    try {
      const raw = await getSiteSettings().catch(()=>null) || {};
      const flat = {};
      Object.entries(raw).forEach(([k, v]) => { flat[k] = (v && typeof v === 'object' && 'v' in v) ? v.v : v; });
      settings = flat;
    } catch { try { settings = JSON.parse(localStorage.getItem('zm_site_settings') || '{}'); } catch {} }
    const bankNotice = document.getElementById('bank-notice');
    if (bankNotice) {
      bankNotice.style.display = '';
      (document.getElementById('bank-notice-acct')||{}) .textContent = settings.accountNumber || '1234567890';
      (document.getElementById('bank-notice-name')||{}) .textContent = settings.bankName      || 'Bank of Ceylon';
      (document.getElementById('bank-notice-holder')||{}) .textContent = settings.accountName  || 'Manarize (Pvt) Ltd';
      const refEl = document.getElementById('bank-ref-display');
      if (refEl) refEl.textContent = order.id;
      const waPhone = settings.waPhone || '94771234567';
      (document.getElementById('bank-notice-wa')||{}) .href = `https://wa.me/${waPhone}?text=${encodeURIComponent(`Hi Manarize! My bank transfer reference for Order ${order.id} is: `)}`;
    }
    // Change success hero text
    const heroTitle = document.querySelector('.success-hero h1');
    if (heroTitle) heroTitle.textContent = 'Order Placed!';
    const heroP = document.querySelector('.success-hero p');
    if (heroP) heroP.textContent = 'Complete your bank transfer to confirm the order.';
  }

  // Status steps
  const statusMap = {
    pending:    1,
    processing: 2,
    shipped:    3,
    delivered:  4,
  };
  const stepNum = statusMap[order.status] || 1;
  ['placed','confirmed','shipped','delivered'].forEach((s, i) => {
    const el = document.getElementById(`step-${s}`);
    if (!el) return;
    el.classList.remove('done', 'active');
    if (i + 1 < stepNum)      el.classList.add('done');
    else if (i + 1 === stepNum) el.classList.add('active');
  });
  // "placed" is always done
  document.getElementById('step-placed')?.classList.add('done');
  // confirmed = done when processing or beyond
  if (stepNum >= 2) document.getElementById('step-confirmed')?.classList.add('done');

  // Delivery estimate
  const est = await estimateDelivery(order.address?.district || 'Colombo');
  (document.getElementById('delivery-estimate')||{}) .textContent = est;

  // Items
  const itemsEl = document.getElementById('success-order-items');
  if (itemsEl) {
    itemsEl.innerHTML = order.items.map(item => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:.625rem 0;border-bottom:1px solid var(--clr-border)">
        <div>
          <div style="font-weight:500;font-size:.875rem">${esc(item.name)}</div>
          ${item.variant ? `<div style="font-size:.75rem;color:var(--clr-text-3)">${esc(item.variant)}</div>` : ''}
          <div style="font-size:.75rem;color:var(--clr-text-3)">Qty: ${item.qty}</div>
        </div>
        <span style="font-family:var(--ff-mono);font-size:.875rem;color:var(--clr-text-2)">${formatPrice(item.price * item.qty)}</span>
      </div>`).join('');
  }

  (document.getElementById('so-subtotal')||{}) .textContent = formatPrice(order.subtotal);
  (document.getElementById('so-shipping')||{}) .textContent = formatPrice(order.shipping);
  (document.getElementById('so-total')||{})    .textContent = formatPrice(order.total);

  // Discount row
  const discountRow = document.getElementById('so-discount-row');
  const discountEl  = document.getElementById('so-discount');
  if (discountRow) {
    if (order.discount > 0) {
      discountRow.style.display = 'flex';
      if (discountEl) discountEl.textContent = `-${formatPrice(order.discount)}`;
    } else {
      discountRow.style.display = 'none';
    }
  }

  const addr = order.address;
  (document.getElementById('delivery-address')||{}) .innerHTML = `
    <strong>${esc(order.customerName)}</strong><br>
    ${esc(addr?.line1 || '')}<br>
    ${addr?.line2 ? esc(addr.line2) + '<br>' : ''}
    ${esc(addr?.city)}, ${esc(addr?.district)}<br>
    ${addr?.province ? esc(addr.province) + ' Province · ' : ''}${esc(addr?.zip || '')}<br>
    <span style="color:var(--clr-text-3)">${esc(order.customerPhone)}</span>`;

  // Order notes (Bug 1 fix)
  const notesSection = document.getElementById('order-notes-section');
  const notesEl      = document.getElementById('order-notes-text');
  if (notesSection && notesEl) {
    if (order.notes && order.notes.trim()) {
      notesEl.textContent        = order.notes.trim();
      notesSection.style.display = '';
    } else {
      notesSection.style.display = 'none';
    }
  }

  // Buttons
  document.getElementById('btn-print')?.addEventListener('click', () => {
    printInvoice(order);
  });

  document.getElementById('btn-download-pdf')?.addEventListener('click', () => {
    downloadInvoicePDF(order);
  });

  // WhatsApp share
  const waText = `My order *${order.id}* at Manarize has been placed! Total: Rs. ${order.total.toLocaleString()}. Thank you! 🛍️`;
  (document.getElementById('btn-whatsapp')||{}) .href =
    `https://wa.me/${WA_PHONE}?text=${encodeURIComponent(waText)}`;
}

function launchConfetti() {
  // Inject keyframes once — makes this function fully self-contained
  // and avoids relying on animations.css being loaded in time.
  if (!document.getElementById('_confetti-kf')) {
    const s = document.createElement('style');
    s.id = '_confetti-kf';
    s.textContent = `
      @keyframes _confettiFall {
        0%   { transform: translateY(0)     rotate(0deg);   opacity: 1; }
        100% { transform: translateY(110vh) rotate(720deg); opacity: 0; }
      }`;
    document.head.appendChild(s);
  }

  const colors = ['#c9a84c','#e2c06e','#2ecc71','#3498db','#e74c3c','#f39c12'];
  for (let i = 0; i < 80; i++) {
    setTimeout(() => {
      const piece    = document.createElement('div');
      const size     = 6  + Math.random() * 8;
      const duration = 2.5 + Math.random() * 2;
      const delay    = Math.random() * 0.8;

      // Single cssText with ALL properties — no external class needed.
      // Splitting animation-duration / animation-delay from the class's
      // animation shorthand causes silent failures in several browsers.
      piece.style.cssText = `
        position: fixed;
        left: ${Math.random() * 100}vw;
        top: -20px;
        width: ${size}px;
        height: ${size}px;
        background: ${colors[Math.floor(Math.random() * colors.length)]};
        border-radius: ${Math.random() > .5 ? '50%' : '2px'};
        animation: _confettiFall ${duration}s ${delay}s ease forwards;
        z-index: 9999;
        pointer-events: none;
      `;

      document.body.appendChild(piece);
      // Remove after the piece has fully animated (not a fixed 5 s)
      setTimeout(() => piece.remove(), (duration + delay) * 1000 + 200);
    }, i * 30);
  }
}




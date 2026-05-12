/* ============================================================
   ZENMARKET — ADMIN ORDER DETAIL + FULL EDIT
   ============================================================ */
import { adminConfirm } from './admin-confirm.js';
import { requireAdmin }      from './admin-auth.js';
import { injectAdminLayout } from './admin-layout.js';
import { withLoader }        from '../loader.js';
import { updateOrder, deleteOrder, saveOneOrder } from '../store-adapter.js';
import AdminAPI from '../admin-api.js';
import { getProducts } from '../store-adapter.js';
import { formatPrice, formatDateTime, orderStatusBadge, paymentStatusBadge, paymentMethodLabel } from '../utils.js';
import { printInvoice }  from '../invoice.js';
import { WA_PHONE }      from '../config.js';
import toast from '../toast.js';
import { esc } from '../security-utils.js';
import {
  sendOrderDeliveredNotification,
  sendPaymentConfirmedNotification,
  addAdminNotification,
} from '../notifications.js';

let order = null;
let editedOrder = null;  // working copy during edit

withLoader(async () => {
  if (!requireAdmin()) return;
  await injectAdminLayout('Order Detail');

  const id = new URLSearchParams(window.location.search).get('id');
  if (!id) {
    document.getElementById('order-content').innerHTML =
      `<div class="empty-state"><i class="fa-solid fa-clipboard-list"></i><h3>No order ID</h3><a href="orders.html" class="btn btn-outline">Back to Orders</a></div>`;
    return;
  }

  // Helper to map a snake_case row to the camelCase object expected by the renderer
  const mapRow = row => ({
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
  });

  // Try both sources — AdminAPI (service-role) and direct Supabase — in parallel.
  // Whichever returns the row first wins; the other is ignored.
  const [adminResult, supabaseResult] = await Promise.allSettled([
    // Source A: AdminAPI (service-role, bypasses RLS)
    (async () => {
      const { getSupabase: _gs } = await import('../supabase.js');
      const sb = _gs();
      if (!sb) throw new Error('Supabase not initialised');
      const { data, error } = await sb
        .from('orders').select('*').eq('id', id).single();
      if (error && error.code !== 'PGRST116') throw new Error(error.message);
      return data || null;
    })(),

    // Source B: Direct Supabase (anon SELECT, uses "Anon read all orders" RLS policy)
    (async () => {
      const resp = await AdminAPI.orders.list({ limit: 1, search: id });
      const row = (resp?.data || []).find(r => r.id === id);
      return row || null;
    })(),
  ]);

  // Pick first successful non-null result
  let raw = null;
  if (supabaseResult.status === 'fulfilled' && supabaseResult.value) raw = supabaseResult.value;
  else if (adminResult.status === 'fulfilled' && adminResult.value) raw = adminResult.value;

  if (raw) {
    // Detect whether it's already camelCase (from store-adapter) or snake_case (from DB)
    order = raw.customer_id !== undefined ? mapRow(raw) : raw;
  } else {
    // Last resort: store-adapter (covers localStorage demo mode)
    try {
      const { getOrder } = await import('../store-adapter.js');
      order = await getOrder(id);
    } catch (_) {}
  }

  if (!order) {
    const why = [
      adminResult.status    === 'rejected' ? `AdminAPI: ${adminResult.reason?.message}`    : null,
      supabaseResult.status === 'rejected' ? `Supabase: ${supabaseResult.reason?.message}` : null,
    ].filter(Boolean).join(' | ');
    document.getElementById('order-content').innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-clipboard-list"></i>
        <h3>Order not found</h3>
        <p style="color:var(--clr-text-3);font-size:.875rem">ID: ${esc(id)}</p>
        ${why ? `<p style="color:var(--clr-error);font-size:.8125rem;margin-top:.5rem">${esc(why)}</p>` : ''}
        <a href="orders.html" class="btn btn-outline" style="margin-top:1rem">Back to Orders</a>
      </div>`;
    return;
  }

  // If paymentSlip is a storage path (not a URL or base64), resolve a
  // short-lived signed URL so the admin can view it without public access.
  await resolveSlipSignedUrl();

  renderOrderDetail();
});

/**
 * If order.paymentSlip looks like a storage path (no protocol prefix,
 * no data: prefix), ask Supabase for a 60-minute signed URL and update
 * the in-memory order object.  Errors are swallowed — worst case the
 * admin sees a broken image link.
 */
async function resolveSlipSignedUrl() {
  if (!order?.paymentSlip) return;
  const slip = order.paymentSlip;
  // Already a URL or base64 fallback — nothing to resolve
  if (slip.startsWith('http') || slip.startsWith('data:')) return;

  try {
    const { getSupabase } = await import('../supabase.js');
    const sb = getSupabase();
    if (!sb) return;

    // 3600 s = 60 minutes — enough for an admin review session
    const { data, error } = await sb.storage
      .from('payment-slips')
      .createSignedUrl(slip, 3600);

    if (error) {
      console.warn('[AdminOrderDetail] Signed URL error:', error.message);
      return;
    }

    order.paymentSlip = data.signedUrl;
    console.log('[AdminOrderDetail] Slip signed URL generated.');
  } catch (e) {
    console.warn('[AdminOrderDetail] resolveSlipSignedUrl exception:', e.message);
  }
}

// ── Render full order detail ───────────────────────────────────
function renderOrderDetail() {
  const el = document.getElementById('order-content');
  if (!el) return;

  const o = order;

  el.innerHTML = `
    <!-- Header row -->
    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:1rem;margin-bottom:1.5rem">
      <div>
        <div style="display:flex;align-items:center;gap:1rem;flex-wrap:wrap">
          <h2 style="font-family:var(--ff-mono);font-size:1.375rem;color:var(--clr-gold)">${o.id}</h2>
          <span id="status-badge-el">${orderStatusBadge(o.status)}</span>
          ${paymentStatusBadge(o.paymentStatus)}
          ${o.paymentMethod === 'bank' ? `<span class="badge badge-amber"><i class="fa-solid fa-building-columns"></i> Bank Transfer</span>` : ''}
        </div>
        <div style="font-size:.8125rem;color:var(--clr-text-3);margin-top:.25rem">${formatDateTime(o.createdAt)}</div>
      </div>
      <div style="display:flex;gap:.75rem;flex-wrap:wrap">
        <button class="btn btn-primary btn-sm" id="btn-edit-order">
          <i class="fa-solid fa-pen-to-square"></i> Edit Order
        </button>
        <button class="btn btn-ghost btn-sm" id="print-btn">
          <i class="fa-solid fa-print"></i> Print Invoice
        </button>
        <button class="btn btn-success btn-sm" id="wa-resend-btn"
          style="background:var(--clr-whatsapp);border-color:var(--clr-whatsapp);color:#fff">
          <i class="fa-brands fa-whatsapp"></i> Notify
        </button>
        <a href="orders.html" class="btn btn-ghost btn-sm">
          <i class="fa-solid fa-arrow-left"></i> Back
        </a>
        <button class="btn btn-danger btn-sm" id="btn-delete-order">
          <i class="fa-solid fa-trash"></i> Delete Order
        </button>
      </div>
    </div>

    <!-- Bank transfer slip (if any) -->
    ${o.paymentSlip ? (() => {
      const isPaid     = o.paymentStatus === 'paid';
      const isFailed   = o.paymentStatus === 'failed';
      const isVerified = isPaid || isFailed;

      // Badge reflects actual payment status
      const slipBadge = isPaid
        ? `<span class="badge badge-green"><i class="fa-solid fa-circle-check"></i> Payment Confirmed</span>`
        : isFailed
          ? `<span class="badge" style="background:var(--clr-error-bg);color:var(--clr-error)"><i class="fa-solid fa-ban"></i> Payment Rejected</span>`
          : `<span class="badge badge-amber"><i class="fa-solid fa-clock"></i> Awaiting Verification</span>`;

      // Image — displayed inline, no click-to-open link
      let slipMedia = '';
      if (o.paymentSlip.startsWith('data:image') || /^https?:\/\//.test(o.paymentSlip)) {
        const isImage = o.paymentSlip.startsWith('data:image') ||
          /\.(jpg|jpeg|png|webp)(\?|$)/i.test(o.paymentSlip);
        slipMedia = isImage
          ? `<img src="${o.paymentSlip}" style="max-height:200px;border-radius:8px;border:1px solid var(--clr-border);display:block">`
          : `<div style="display:flex;align-items:center;gap:.75rem;padding:1rem;background:var(--clr-bg-2);border-radius:8px;border:1px solid var(--clr-border);color:var(--clr-text-2)">
               <i class="fa-solid fa-file-pdf" style="color:var(--clr-error);font-size:2rem"></i>
               <div style="font-size:.875rem">PDF Slip attached</div>
             </div>`;
      } else {
        slipMedia = `<div style="padding:1rem;background:var(--clr-bg-2);border-radius:8px;border:1px solid var(--clr-border)">
          <i class="fa-solid fa-file-pdf" style="color:var(--clr-error);font-size:2rem"></i>
          <div style="font-size:.875rem;margin-top:.5rem">PDF Slip attached</div>
        </div>`;
      }

      return `
      <div class="card" style="margin-bottom:1.5rem;border-color:var(--clr-gold-dim)">
        <div style="display:flex;align-items:center;gap:.75rem;margin-bottom:1rem">
          <i class="fa-solid fa-file-invoice" style="color:var(--clr-gold);font-size:1.125rem"></i>
          <h4 style="font-size:.9375rem">Payment Slip — Bank Transfer</h4>
          ${slipBadge}
        </div>
        <div style="display:flex;gap:1rem;align-items:flex-start;flex-wrap:wrap">
          ${slipMedia}
          <div>
            ${o.bankRef ? `<div style="font-size:.875rem;margin-bottom:.75rem"><strong>Ref:</strong> <span style="font-family:var(--ff-mono)">${esc(o.bankRef)}</span></div>` : ''}
            ${isVerified
              ? `<div style="display:flex;align-items:center;gap:.5rem;font-size:.875rem;
                            color:${isPaid ? 'var(--clr-success)' : 'var(--clr-error)'}">
                   <i class="fa-solid ${isPaid ? 'fa-circle-check' : 'fa-ban'}"></i>
                   ${isPaid ? 'Payment has been confirmed.' : 'Payment has been rejected.'}
                 </div>`
              : `<div style="display:flex;gap:.75rem">
                   <button class="btn btn-primary btn-sm" id="btn-bank-paid">
                     <i class="fa-solid fa-circle-check"></i> Mark as Paid
                   </button>
                   <button class="btn btn-ghost btn-sm" id="btn-bank-reject">
                     <i class="fa-solid fa-xmark"></i> Reject
                   </button>
                 </div>`
            }
          </div>
        </div>
      </div>`;
    })() : ''}

    <div style="display:grid;grid-template-columns:1fr 340px;gap:1.5rem;align-items:start">
      <div>
        <!-- Customer info -->
        <div class="card" style="margin-bottom:1.5rem">
          <h4 style="margin-bottom:1rem;font-size:.9375rem;font-weight:600">
            <i class="fa-regular fa-circle-user" style="color:var(--clr-gold)"></i> Customer
          </h4>
          <div style="display:grid;grid-template-columns:auto 1fr;gap:.5rem 1rem;font-size:.875rem">
            <span style="color:var(--clr-text-3)">Name</span>
            <span style="font-weight:500">${esc(o.customerName)}</span>
            <span style="color:var(--clr-text-3)">Email</span>
            <a href="mailto:${esc(o.customerEmail)}" style="color:var(--clr-gold)">${esc(o.customerEmail)}</a>
            <span style="color:var(--clr-text-3)">Phone</span>
            <a href="tel:${esc(o.customerPhone)}" style="color:var(--clr-gold)">${esc(o.customerPhone)}</a>
          </div>
        </div>

        <!-- Delivery address -->
        <div class="card" style="margin-bottom:1.5rem">
          <h4 style="margin-bottom:1rem;font-size:.9375rem;font-weight:600">
            <i class="fa-solid fa-location-dot" style="color:var(--clr-gold)"></i> Delivery Address
          </h4>
          <div style="font-size:.875rem;color:var(--clr-text-2);line-height:2">
            ${esc(o.address?.line1) || ''}<br>
            ${o.address?.line2 ? esc(o.address.line2) + '<br>' : ''}
            ${esc(o.address?.city)}, ${esc(o.address?.district)}<br>
            ${esc(o.address?.province)} Province · ${esc(o.address?.zip) || ''}
          </div>
        </div>

        <!-- Order items -->
        <div class="card" id="order-items-card">
          <h4 style="margin-bottom:1rem;font-size:.9375rem;font-weight:600">
            <i class="fa-solid fa-box" style="color:var(--clr-gold)"></i> Order Items
          </h4>
          ${renderItemsReadonly(o)}
        </div>
      </div>

      <!-- Right panel: status + payment controls -->
      <div>
        <div class="card" style="margin-bottom:1.25rem">
          <h4 style="margin-bottom:1rem;font-size:.9375rem;font-weight:600">Order Status</h4>
          <div class="form-group">
            <label class="form-label">Fulfilment Status</label>
            <select class="form-control" id="status-select">
              ${['pending','processing','shipped','delivered','cancelled','refunded'].map(s =>
                `<option value="${s}" ${o.status === s ? 'selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`
              ).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Payment Status</label>
            <select class="form-control" id="payment-select">
              ${['pending','paid','failed','refunded'].map(s =>
                `<option value="${s}" ${o.paymentStatus === s ? 'selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`
              ).join('')}
            </select>
          </div>
          <div style="padding:.75rem;background:var(--clr-bg-2);border-radius:var(--r-md);font-size:.8125rem">
            <div style="color:var(--clr-text-3);margin-bottom:.25rem">Payment Method</div>
            <div style="font-weight:500">
              ${paymentMethodLabel(o.paymentMethod)}
            </div>
            ${o.bankRef ? `<div style="color:var(--clr-text-3);margin-top:.25rem">Ref: <span style="font-family:var(--ff-mono)">${esc(o.bankRef)}</span></div>` : ''}
          </div>
        </div>

        ${o.notes ? `
          <div class="card" style="margin-bottom:1.25rem">
            <h4 style="margin-bottom:.75rem;font-size:.9375rem;font-weight:600">Order Notes</h4>
            <p style="font-size:.875rem;color:var(--clr-text-2);line-height:1.7">${esc(o.notes)}</p>
          </div>` : ''}

        <!-- Order totals summary -->
        <div class="card">
          <h4 style="margin-bottom:1rem;font-size:.9375rem;font-weight:600">Totals</h4>
          <div style="display:flex;flex-direction:column;gap:.375rem;font-size:.875rem">
            <div style="display:flex;justify-content:space-between;color:var(--clr-text-2)">
              <span>Subtotal</span><span style="font-family:var(--ff-mono)">${formatPrice(o.subtotal)}</span>
            </div>
            <div style="display:flex;justify-content:space-between;color:var(--clr-text-2)">
              <span>Shipping</span><span style="font-family:var(--ff-mono)">${formatPrice(o.shipping)}</span>
            </div>
            ${o.discount > 0 ? `<div style="display:flex;justify-content:space-between;color:var(--clr-success)">
              <span>Discount ${o.coupon ? `(${esc(o.coupon)})` : ''}</span>
              <span style="font-family:var(--ff-mono)">-${formatPrice(o.discount)}</span>
            </div>` : ''}
            <div style="display:flex;justify-content:space-between;font-weight:700;font-size:1rem;padding-top:.5rem;border-top:1px solid var(--clr-border)">
              <span>Total</span><span style="font-family:var(--ff-mono);color:var(--clr-gold)">${formatPrice(o.total)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div id="invoice-print" style="display:none"></div>`;

  // Bind status/payment selects
  document.getElementById('status-select')?.addEventListener('change', async e => {
    const newStatus = e.target.value;
    await saveField('status', newStatus);
    const _badge = document.getElementById('status-badge-el'); if (_badge) _badge.innerHTML = orderStatusBadge(newStatus);
    toast.success('Updated', `Order status → ${newStatus}`);
    if (newStatus === 'delivered' && order.customerId) {
      sendOrderDeliveredNotification(order.customerId, order.id);
    }
  });
  document.getElementById('payment-select')?.addEventListener('change', async e => {
    const newPayStatus = e.target.value;
    await saveField('paymentStatus', newPayStatus);
    toast.success('Updated', `Payment status → ${newPayStatus}`);
    if (newPayStatus === 'paid' && order.customerId) {
      sendPaymentConfirmedNotification(order.customerId, order.id, order.total);
    }
  });

  // Print
  document.getElementById('print-btn')?.addEventListener('click', () => printInvoice(order));

  // WhatsApp
  document.getElementById('wa-resend-btn')?.addEventListener('click', () => {
    const msg = `*Manarize Order Update*\n\nOrder: *${o.id}*\nStatus: ${o.status}\nPayment: ${o.paymentStatus}\nTotal: Rs. ${o.total.toLocaleString()}\n\nThank you for shopping with Manarize!`;
    window.open(`https://wa.me/${o.customerPhone.replace(/\D/g, '')}?text=${encodeURIComponent(msg)}`, '_blank');
  });

  // Bank transfer actions (CSP-safe: bound here instead of inline onclick)
  document.getElementById('btn-bank-paid')?.addEventListener('click', markBankPaid);
  document.getElementById('btn-bank-reject')?.addEventListener('click', markBankFailed);

  // Delete order
  document.getElementById('btn-delete-order')?.addEventListener('click', async () => {
    const ok = await adminConfirm({ title: `Delete order ${order.id}?`, message: `Total: Rs. ${order.total.toLocaleString()} — this cannot be undone.`, confirm: 'Delete', danger: true });
    if (!ok) return;
    await deleteOrder(order.id);
    toast.success('Deleted', `Order ${order.id} has been removed`);
    setTimeout(() => window.location.href = '/admin/orders', 700);
  });

  // Edit button
  document.getElementById('btn-edit-order')?.addEventListener('click', openEditModal);
}

// ── Render items (read-only) ──────────────────────────────────
function renderItemsReadonly(o) {
  return (o.items || []).map(item => `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;padding:.75rem 0;border-bottom:1px solid var(--clr-border)">
      <div style="flex:1">
        <div style="font-size:.9375rem;font-weight:500">${esc(item.name)}</div>
        ${item.variant ? `<div style="font-size:.75rem;color:var(--clr-text-3)">${esc(item.variant)}</div>` : ''}
        <div style="font-size:.8125rem;color:var(--clr-text-3);margin-top:.25rem">
          Qty: <strong>${item.qty}</strong> &nbsp;×&nbsp; ${formatPrice(item.price)}
        </div>
      </div>
      <span style="font-family:var(--ff-mono);font-weight:600;color:var(--clr-text)">${formatPrice(item.price * item.qty)}</span>
    </div>`).join('') +
    `<div style="text-align:right;font-size:.875rem;color:var(--clr-text-3);padding-top:.75rem">
      ${o.items.length} item${o.items.length !== 1 ? 's' : ''} · Order total: <strong style="color:var(--clr-gold);font-family:var(--ff-mono)">${formatPrice(o.total)}</strong>
    </div>`;
}

// ── Save a single field ───────────────────────────────────────
async function saveField(key, value) {
  const colMap = {
    status: 'status', paymentStatus: 'payment_status',
    paymentMethod: 'payment_method', notes: 'notes',
  };
  const col = colMap[key] || key;
  await updateOrder(order.id, { [col]: value });
  order = { ...order, [key]: value };
}

// ── Mark bank transfer paid / failed ─────────────────────────
async function markBankPaid() {
  await saveField('paymentStatus', 'paid');
  await saveField('status', 'processing');
  document.getElementById('payment-select').value = 'paid';
  document.getElementById('status-select').value  = 'processing';
  const _badge = document.getElementById('status-badge-el'); if (_badge) _badge.innerHTML = orderStatusBadge('processing');
  toast.success('Payment Confirmed', 'Bank transfer verified — order is now processing');
  if (order.customerId) {
    sendPaymentConfirmedNotification(order.customerId, order.id, order.total);
  }
  renderOrderDetail(); // re-render to hide action buttons
}
async function markBankFailed() {
  await saveField('paymentStatus', 'failed');
  await saveField('status', 'cancelled');
  document.getElementById('payment-select').value = 'failed';
  document.getElementById('status-select').value  = 'cancelled';
  const _badge = document.getElementById('status-badge-el'); if (_badge) _badge.innerHTML = orderStatusBadge('cancelled');
  toast.info('Payment Rejected', 'Bank transfer rejected — order has been cancelled');
  renderOrderDetail(); // re-render to hide action buttons
}

// ── Full Edit Modal ───────────────────────────────────────────
async function openEditModal() {
  const allProducts = await getProducts({ adminMode: true });
  document.getElementById('order-edit-modal')?.remove();

  const o = { ...order };
  editedOrder = JSON.parse(JSON.stringify(o));

  const modal = document.createElement('div');
  modal.id = 'order-edit-modal';
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal modal-lg" style="max-height:90vh;overflow-y:auto">
      <div class="modal-header">
        <h3 class="modal-title"><i class="fa-solid fa-pen-to-square" style="color:var(--clr-gold)"></i> Edit Order — <span style="font-family:var(--ff-mono);color:var(--clr-gold)">${o.id}</span></h3>
        <button class="modal-close" id="close-edit-modal"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="modal-body" style="padding:1.5rem">

        <!-- Tab nav -->
        <div class="tabs" style="margin-bottom:1.5rem">
          <button class="tab-btn active" data-tab="edit-customer">Customer</button>
          <button class="tab-btn" data-tab="edit-address">Address</button>
          <button class="tab-btn" data-tab="edit-items">Items &amp; Totals</button>
          <button class="tab-btn" data-tab="edit-payment">Payment</button>
        </div>

        <!-- Customer tab -->
        <div class="tab-panel active" id="tab-edit-customer">
          <div class="form-row">
            <div class="form-group">
              <label class="form-label required">Customer Name</label>
              <input class="form-control" type="text" id="edit-cust-name" value="${esc(o.customerName)}">
            </div>
            <div class="form-group">
              <label class="form-label required">Email</label>
              <input class="form-control" type="email" id="edit-cust-email" value="${esc(o.customerEmail)}">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label required">Phone</label>
            <input class="form-control" type="tel" id="edit-cust-phone" value="${esc(o.customerPhone)}">
          </div>
          <div class="form-group">
            <label class="form-label">Order Notes</label>
            <textarea class="form-control" id="edit-notes" rows="3">${esc(o.notes) || ''}</textarea>
          </div>
        </div>

        <!-- Address tab -->
        <div class="tab-panel" id="tab-edit-address">
          <div class="form-group">
            <label class="form-label required">Address Line 1</label>
            <input class="form-control" type="text" id="edit-line1" value="${esc(o.address?.line1) || ''}">
          </div>
          <div class="form-group">
            <label class="form-label">Address Line 2</label>
            <input class="form-control" type="text" id="edit-line2" value="${esc(o.address?.line2) || ''}">
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label required">City</label>
              <input class="form-control" type="text" id="edit-city" value="${esc(o.address?.city) || ''}">
            </div>
            <div class="form-group">
              <label class="form-label required">District</label>
              <select class="form-control" id="edit-district">
                ${['Colombo','Gampaha','Kalutara','Kandy','Matale','Nuwara Eliya','Galle','Matara','Hambantota','Jaffna','Kilinochchi','Mannar','Vavuniya','Mullaitivu','Trincomalee','Batticaloa','Ampara','Kurunegala','Puttalam','Anuradhapura','Polonnaruwa','Badulla','Monaragala','Ratnapura','Kegalle'].map(d =>
                  `<option ${o.address?.district === d ? 'selected' : ''}>${d}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label required">Province</label>
              <select class="form-control" id="edit-province">
                ${['Western','Central','Southern','Northern','Eastern','North Western','North Central','Uva','Sabaragamuwa'].map(p =>
                  `<option ${o.address?.province === p ? 'selected' : ''}>${p}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Postal Code</label>
              <input class="form-control" type="text" id="edit-zip" value="${esc(o.address?.zip) || ''}">
            </div>
          </div>
        </div>

        <!-- Items & Totals tab -->
        <div class="tab-panel" id="tab-edit-items">
          <div id="edit-items-list">
            ${renderItemsEditable(editedOrder.items)}
          </div>

          <!-- Add item from catalogue -->
          <div style="margin-top:1rem;padding:1rem;background:var(--clr-bg-2);border-radius:var(--r-md);border:1px solid var(--clr-border)">
            <div style="font-size:.8125rem;font-weight:600;color:var(--clr-text-2);margin-bottom:.75rem">Add Item from Catalogue</div>
            <div style="display:flex;gap:.75rem;align-items:flex-end;flex-wrap:wrap">
              <div class="form-group" style="flex:1;margin:0;min-width:200px">
                <label class="form-label">Product</label>
                <select class="form-control" id="add-item-select" style="font-size:.8125rem">
                  <option value="">Select product…</option>
                  ${allProducts.filter(p => p.active !== false).map(p =>
                    `<option value="${p.id}" data-price="${p.price}" data-name="${esc(p.name)}">${esc(p.name)} — Rs.${p.price.toLocaleString()}</option>`
                  ).join('')}
                </select>
              </div>
              <div class="form-group" style="width:80px;margin:0">
                <label class="form-label">Qty</label>
                <input class="form-control" type="number" id="add-item-qty" min="1" value="1" style="font-size:.8125rem">
              </div>
              <button type="button" class="btn btn-outline btn-sm" id="btn-add-catalogue-item" style="margin-bottom:1.25rem">
                <i class="fa-solid fa-plus"></i> Add
              </button>
            </div>
          </div>

          <!-- Manual item -->
          <div style="margin-top:.75rem;padding:1rem;background:var(--clr-bg-2);border-radius:var(--r-md);border:1px solid var(--clr-border)">
            <div style="font-size:.8125rem;font-weight:600;color:var(--clr-text-2);margin-bottom:.75rem">Add Custom Item</div>
            <div style="display:flex;gap:.75rem;align-items:flex-end;flex-wrap:wrap">
              <div class="form-group" style="flex:2;margin:0;min-width:160px">
                <label class="form-label">Item Name</label>
                <input class="form-control" type="text" id="manual-item-name" placeholder="Product name" style="font-size:.8125rem">
              </div>
              <div class="form-group" style="flex:1;margin:0;min-width:100px">
                <label class="form-label">Unit Price (Rs.)</label>
                <input class="form-control" type="number" id="manual-item-price" min="0" placeholder="0" style="font-size:.8125rem">
              </div>
              <div class="form-group" style="width:80px;margin:0">
                <label class="form-label">Qty</label>
                <input class="form-control" type="number" id="manual-item-qty" min="1" value="1" style="font-size:.8125rem">
              </div>
              <button type="button" class="btn btn-outline btn-sm" id="btn-add-manual-item" style="margin-bottom:1.25rem">
                <i class="fa-solid fa-plus"></i> Add
              </button>
            </div>
          </div>

          <!-- Totals editor -->
          <div style="margin-top:1rem;padding:1rem;background:var(--clr-bg-2);border-radius:var(--r-md);border:1px solid var(--clr-border)">
            <div style="font-size:.8125rem;font-weight:600;color:var(--clr-text-2);margin-bottom:.75rem">Adjust Totals</div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Shipping (Rs.)</label>
                <input class="form-control" type="number" id="edit-shipping" value="${o.shipping}" min="0" style="font-size:.8125rem">
              </div>
              <div class="form-group">
                <label class="form-label">Discount (Rs.)</label>
                <input class="form-control" type="number" id="edit-discount" value="${o.discount || 0}" min="0" style="font-size:.8125rem">
              </div>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:.9375rem;font-weight:600;padding:.625rem .5rem;background:var(--clr-surface);border-radius:var(--r-sm)">
              <span>Calculated Total</span>
              <span id="calc-total" style="font-family:var(--ff-mono);color:var(--clr-gold)">${formatPrice(o.total)}</span>
            </div>
          </div>
        </div>

        <!-- Payment tab -->
        <div class="tab-panel" id="tab-edit-payment">
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Fulfilment Status</label>
              <select class="form-control" id="edit-status-sel">
                ${['pending','processing','shipped','delivered','cancelled','refunded'].map(s =>
                  `<option value="${s}" ${o.status === s ? 'selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`
                ).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Payment Status</label>
              <select class="form-control" id="edit-payment-sel">
                ${['pending','paid','failed','refunded'].map(s =>
                  `<option value="${s}" ${o.paymentStatus === s ? 'selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`
                ).join('')}
              </select>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Payment Method</label>
            <select class="form-control" id="edit-payment-method">
              <option value="payhere" ${o.paymentMethod === 'payhere' ? 'selected' : ''}>PayHere Online</option>
              <option value="bank"    ${o.paymentMethod === 'bank'    ? 'selected' : ''}>Bank Transfer</option>
              <option value="cod"     ${o.paymentMethod === 'cod'     ? 'selected' : ''}>Cash on Delivery</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Bank Reference / Transaction ID</label>
            <input class="form-control" type="text" id="edit-bank-ref" value="${esc(o.bankRef) || ''}" placeholder="TXN123456789">
          </div>
        </div>

      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" id="cancel-edit-order">Cancel</button>
        <button class="btn btn-primary" id="save-edit-order">
          <i class="fa-solid fa-circle-check"></i> Save All Changes
        </button>
      </div>
    </div>`;

  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add('open'));

  // Tabs
  modal.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      modal.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      modal.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${target}`)?.classList.add('active');
    });
  });

  // Close
  const close = () => { modal.classList.remove('open'); setTimeout(() => modal.remove(), 300); };
  document.getElementById('close-edit-modal')?.addEventListener('click', close);
  document.getElementById('cancel-edit-order')?.addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });

  // Item events
  bindItemEditorEvents();

  // Live total recalc
  ['edit-shipping','edit-discount'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', recalcTotal);
  });

  // Save
  document.getElementById('save-edit-order')?.addEventListener('click', () => {
    saveAllEdits(close);
  });
}

// ── Render editable items list ────────────────────────────────
function renderItemsEditable(items) {
  if (!items?.length) return `<div style="color:var(--clr-text-3);font-size:.875rem;padding:.5rem 0">No items</div>`;
  return items.map((item, i) => `
    <div class="edit-item-row" data-idx="${i}" style="display:flex;align-items:center;gap:.75rem;padding:.625rem 0;border-bottom:1px solid var(--clr-border)">
      <div style="flex:1;font-size:.875rem">
        <div style="font-weight:500">${esc(item.name)}</div>
        ${item.variant ? `<div style="font-size:.75rem;color:var(--clr-text-3)">${esc(item.variant)}</div>` : ''}
      </div>
      <div style="display:flex;align-items:center;gap:.5rem">
        <label style="font-size:.75rem;color:var(--clr-text-3)">Qty</label>
        <input type="number" class="form-control item-qty-input" min="1" value="${item.qty}"
          style="width:64px;font-size:.8125rem;padding:.375rem .5rem;text-align:center"
          data-idx="${i}">
        <span style="font-family:var(--ff-mono);font-size:.8125rem;color:var(--clr-text-2);min-width:72px;text-align:right">${formatPrice(item.price)}</span>
        <span style="font-family:var(--ff-mono);font-size:.875rem;font-weight:600;min-width:80px;text-align:right">${formatPrice(item.price * item.qty)}</span>
        <button type="button" class="btn btn-ghost btn-sm remove-item-btn" data-idx="${i}"
          style="color:var(--clr-error);padding:.25rem .375rem" title="Remove item">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    </div>`).join('');
}

function updateItemQty(idx, val) {
  const qty = Math.max(1, parseInt(val) || 1);
  editedOrder.items[idx].qty = qty;
  recalcTotal();
}

function bindItemEditorEvents() {
  // Remove item
  document.getElementById('edit-items-list')?.querySelectorAll('.remove-item-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx);
      editedOrder.items.splice(idx, 1);
      document.getElementById('edit-items-list').innerHTML = renderItemsEditable(editedOrder.items);
      bindItemEditorEvents();
      recalcTotal();
    });
  });

  // Qty inputs — CSP-safe event delegation (replaces oninput="updateItemQty(...)")
  document.getElementById('edit-items-list')?.querySelectorAll('.item-qty-input').forEach(input => {
    input.addEventListener('input', () => {
      const idx = parseInt(input.dataset.idx);
      if (!isNaN(idx)) updateItemQty(idx, input.value);
    });
  });

  // Add from catalogue
  document.getElementById('btn-add-catalogue-item')?.addEventListener('click', () => {
    const sel   = document.getElementById('add-item-select');
    const opt   = sel.options[sel.selectedIndex];
    const qty   = parseInt(document.getElementById('add-item-qty').value) || 1;
    if (!opt?.value) { toast.error('Select', 'Choose a product first'); return; }
    editedOrder.items.push({
      productId: opt.value,
      name:      opt.text.split(' — ')[0],
      price:     parseInt(opt.dataset.price) || 0,
      qty,
      variant:   '',
    });
    document.getElementById('edit-items-list').innerHTML = renderItemsEditable(editedOrder.items);
    bindItemEditorEvents();
    recalcTotal();
    sel.selectedIndex = 0;
    document.getElementById('add-item-qty').value = 1;
  });

  // Add custom/manual item
  document.getElementById('btn-add-manual-item')?.addEventListener('click', () => {
    const name  = document.getElementById('manual-item-name')?.value.trim();
    const price = parseFloat(document.getElementById('manual-item-price')?.value) || 0;
    const qty   = parseInt(document.getElementById('manual-item-qty')?.value) || 1;
    if (!name)  { toast.error('Required', 'Enter item name'); return; }
    if (!price) { toast.error('Required', 'Enter item price'); return; }
    editedOrder.items.push({ productId: '', name, price, qty, variant: '' });
    document.getElementById('edit-items-list').innerHTML = renderItemsEditable(editedOrder.items);
    bindItemEditorEvents();
    recalcTotal();
    document.getElementById('manual-item-name').value  = '';
    document.getElementById('manual-item-price').value = '';
    document.getElementById('manual-item-qty').value   = 1;
  });
}

// ── Recalculate total ─────────────────────────────────────────
function recalcTotal() {
  const shipping = parseFloat(document.getElementById('edit-shipping')?.value) || 0;
  const discount = parseFloat(document.getElementById('edit-discount')?.value) || 0;
  // Re-read qtys from inputs
  document.querySelectorAll('.item-qty-input').forEach(inp => {
    const idx = parseInt(inp.dataset.idx);
    if (!isNaN(idx) && editedOrder.items[idx]) {
      editedOrder.items[idx].qty = Math.max(1, parseInt(inp.value) || 1);
    }
  });
  const subtotal = editedOrder.items.reduce((s, i) => s + i.price * i.qty, 0);
  const total    = Math.max(0, subtotal + shipping - discount);
  const el = document.getElementById('calc-total');
  if (el) el.textContent = formatPrice(total);
  editedOrder.subtotal = subtotal;
  editedOrder.shipping = shipping;
  editedOrder.discount = discount;
  editedOrder.total    = total;
}

// ── Save all edits back to localStorage ──────────────────────
async function saveAllEdits(closeFn) {
  recalcTotal();

  const updates = {
    customerName:  document.getElementById('edit-cust-name')?.value.trim()  || editedOrder.customerName,
    customerEmail: document.getElementById('edit-cust-email')?.value.trim() || editedOrder.customerEmail,
    customerPhone: document.getElementById('edit-cust-phone')?.value.trim() || editedOrder.customerPhone,
    notes:         document.getElementById('edit-notes')?.value.trim()       || '',
    address: {
      line1:    document.getElementById('edit-line1')?.value.trim()    || '',
      line2:    document.getElementById('edit-line2')?.value.trim()    || '',
      city:     document.getElementById('edit-city')?.value.trim()     || '',
      district: document.getElementById('edit-district')?.value        || '',
      province: document.getElementById('edit-province')?.value        || '',
      zip:      document.getElementById('edit-zip')?.value.trim()      || '',
    },
    items:         editedOrder.items,
    subtotal:      editedOrder.subtotal,
    shipping:      editedOrder.shipping,
    discount:      editedOrder.discount,
    total:         editedOrder.total,
    status:        document.getElementById('edit-status-sel')?.value   || editedOrder.status,
    paymentStatus: document.getElementById('edit-payment-sel')?.value  || editedOrder.paymentStatus,
    paymentMethod: document.getElementById('edit-payment-method')?.value || editedOrder.paymentMethod,
    bankRef:       document.getElementById('edit-bank-ref')?.value.trim() || '',
    updatedAt:     new Date().toISOString(),
  };

  if (!updates.customerName || !updates.customerEmail) {
    toast.error('Required', 'Customer name and email are required');
    return;
  }

  const prevStatus    = order.status;
  const prevPayStatus = order.paymentStatus;
  const merged = { ...order, ...updates };
  await saveOneOrder(merged);
  order = merged;

  // Notify customer on key status transitions
  const cid = order.customerId;
  if (cid) {
    if (updates.status === 'delivered' && prevStatus !== 'delivered') {
      sendOrderDeliveredNotification(cid, order.id);
    }
    if (updates.paymentStatus === 'paid' && prevPayStatus !== 'paid') {
      sendPaymentConfirmedNotification(cid, order.id, order.total);
    }
  }

  toast.success('Saved!', `Order ${order.id} updated successfully`);
  closeFn();
  renderOrderDetail();   // re-render with fresh data
}

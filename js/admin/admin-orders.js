/* ============================================================
   ZENMARKET — ADMIN ORDERS
   ============================================================ */
import { requireAdmin } from './admin-auth.js';
import AdminAPI from '../admin-api.js';
import { getSupabase } from '../supabase.js';
import { adminConfirm } from './admin-confirm.js';
import { injectAdminLayout } from './admin-layout.js';
import { formatPrice, formatDateTime, orderStatusBadge, paymentStatusBadge } from '../utils.js';
import { withLoader } from '../loader.js';
import toast from '../toast.js';
import { esc } from '../security-utils.js';

let allOrders = [];
let filtered  = [];
let page = 1;
const PER_PAGE = 15;

withLoader(async () => {
  if (!requireAdmin()) return;
  await injectAdminLayout('Orders');

  // ── Row mapper: snake_case DB row → camelCase order object ───
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

  // ── Fetch from BOTH sources concurrently ─────────────────────
  // Source A (AdminAPI): uses service-role key → bypasses RLS entirely.
  //   Requires SUPABASE_SERVICE_ROLE_KEY + ADMIN_API_TOKEN in Vercel env vars.
  // Source B (Supabase anon): works on any host including local dev.
  //   Requires "Anon read all orders" RLS policy from supabase-setup.sql.
  //
  // Both run in parallel. Results are merged + deduplicated by order ID,
  // so orders are always visible regardless of which source has them.

  const [adminApiResult, supabaseResult] = await Promise.allSettled([
    // Source A — AdminAPI (service-role)
    (async () => {
      const resp = await AdminAPI.orders.list({ limit: 1000 });
      if (!resp || !Array.isArray(resp.data)) throw new Error('Empty or invalid AdminAPI response');
      return resp.data;
    })(),

    // Source B — Direct Supabase anon SELECT
    (async () => {
      const sb = getSupabase();
      if (!sb) throw new Error(
        'Supabase client not initialised. Check SUPABASE_URL / SUPABASE_ANON_KEY in env.js'
      );
      const { data, error } = await sb
        .from('orders')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1000);
      if (error) {
        const isRls = error.code === '42501' ||
          (error.message || '').toLowerCase().includes('permission') ||
          (error.message || '').toLowerCase().includes('policy');
        throw new Error(
          isRls
            ? `RLS is blocking SELECT. Run supabase-setup.sql in your Supabase project → SQL Editor. (${error.code})`
            : `${error.code}: ${error.message}`
        );
      }
      return data || [];
    })(),
  ]);

  // Log diagnostics so the developer can see what worked
  if (adminApiResult.status === 'fulfilled') {
    console.log('[Admin Orders] AdminAPI (service-role):', adminApiResult.value.length, 'orders');
  } else {
    console.warn('[Admin Orders] AdminAPI unavailable:', adminApiResult.reason?.message);
  }
  if (supabaseResult.status === 'fulfilled') {
    console.log('[Admin Orders] Supabase anon query:', supabaseResult.value.length, 'orders');
  } else {
    console.warn('[Admin Orders] Supabase direct query failed:', supabaseResult.reason?.message);
  }

  // ── Merge & deduplicate by order ID ─────────────────────────
  // Priority: Supabase (freshest) → AdminAPI → localStorage backup
  const seen = new Map();
  const addRows = rows => (rows || []).forEach(r => { if (!seen.has(r.id)) seen.set(r.id, mapRow(r)); });
  if (supabaseResult.status === 'fulfilled') addRows(supabaseResult.value);
  if (adminApiResult.status  === 'fulfilled') addRows(adminApiResult.value);

  // ── Source C: localStorage fallback (orders that failed to reach Supabase) ──
  // These are orders saved as an emergency backup when all Supabase paths failed.
  // Marked with _localFallback:true so admin knows they need manual sync.
  try {
    const localRaw = localStorage.getItem('zm_orders');
    if (localRaw) {
      const localOrders = JSON.parse(localRaw);
      if (Array.isArray(localOrders)) {
        localOrders.forEach(o => {
          if (!o || !o.id) return;
          if (!seen.has(o.id)) {
            // Map camelCase local order to expected shape
            seen.set(o.id, {
              id:            o.id,
              customerId:    o.customerId    || '',
              customerName:  o.customerName  || '',
              customerEmail: o.customerEmail || '',
              customerPhone: o.customerPhone || '',
              items:         o.items         || [],
              subtotal:      o.subtotal      || 0,
              shipping:      o.shipping      || 0,
              discount:      o.discount      || 0,
              total:         o.total         || 0,
              status:        o.status        || 'pending',
              paymentStatus: o.paymentStatus || 'pending',
              paymentMethod: o.paymentMethod || '',
              coupon:        o.coupon        || '',
              bankRef:       o.bankRef       || null,
              paymentSlip:   o.paymentSlip   || null,
              address:       o.address       || {},
              notes:         (o.notes        || '') + (o._localFallback ? ' [LOCAL BACKUP — not synced to DB]' : ''),
              createdAt:     o.createdAt,
              updatedAt:     o.updatedAt,
            });
          }
        });
      }
    }
  } catch (_) {}

  allOrders = [...seen.values()].sort((a, b) =>
    new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
  );

  // ── If BOTH Supabase sources failed, show a useful setup error ──────────
  if (adminApiResult.status === 'rejected' && supabaseResult.status === 'rejected') {
    const tbody = document.getElementById('orders-tbody');
    if (tbody && !allOrders.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="9" style="padding:2.5rem;text-align:center">
            <div style="max-width:540px;margin:0 auto;text-align:left">
              <p style="font-weight:600;color:var(--clr-error);margin-bottom:.75rem">
                <i class="fa-solid fa-triangle-exclamation"></i>&nbsp;
                Cannot load orders from Supabase — setup required
              </p>
              <p style="font-size:.875rem;color:var(--clr-text-2);margin-bottom:.5rem">
                <strong>Step 1 (required):</strong> Open your
                <a href="https://supabase.com/dashboard" target="_blank" style="color:var(--clr-gold)">Supabase project</a>
                → SQL Editor → paste <code>supabase-setup.sql</code> → Run.
              </p>
              <p style="font-size:.875rem;color:var(--clr-text-2);margin-bottom:.5rem">
                <strong>Step 2:</strong> In .env set real <code>SUPABASE_URL</code> +
                <code>SUPABASE_ANON_KEY</code> then run <code>node build.js</code>.
              </p>
              <details style="margin-top:.75rem;font-size:.8125rem;color:var(--clr-text-3)">
                <summary style="cursor:pointer;color:var(--clr-text-3)">Show error details</summary>
                <pre style="margin-top:.5rem;white-space:pre-wrap;word-break:break-all;font-size:.75rem">AdminAPI: ${adminApiResult.reason?.message}
Supabase: ${supabaseResult.reason?.message}</pre>
              </details>
            </div>
          </td>
        </tr>`;
    }
    if (!allOrders.length) {
      if (document.getElementById('orders-count'))
        document.getElementById('orders-count').textContent = '0 orders';
      return;
    }
    // If local orders exist, fall through to render them with a warning banner
    const tbody2 = document.getElementById('orders-tbody');
    if (tbody2) tbody2.innerHTML = '';
    const tableContainer = document.querySelector('.admin-table-container') || document.querySelector('.table-container');
    if (tableContainer) {
      const banner = document.createElement('div');
      banner.style.cssText = 'background:rgba(255,160,0,.12);border:1px solid rgba(255,160,0,.4);border-radius:8px;padding:.875rem 1rem;margin-bottom:1rem;font-size:.875rem;color:var(--clr-text-2)';
      banner.innerHTML = `
        <div style="display:flex;align-items:center;gap:.75rem;flex-wrap:wrap">
          <span><i class="fa-solid fa-triangle-exclamation" style="color:#ffa000;margin-right:.5rem"></i>
          <strong>Supabase unreachable</strong> — showing locally-saved backup orders only. Run <code>supabase-setup.sql</code> to fix.</span>
          <button id="sync-local-orders-btn" style="margin-left:auto;padding:.35rem .875rem;background:var(--clr-gold);color:#000;border:none;border-radius:6px;cursor:pointer;font-size:.8125rem;font-weight:600;white-space:nowrap">
            <i class="fa-solid fa-cloud-arrow-up"></i> Sync to Supabase
          </button>
        </div>`;
      document.getElementById('sync-local-orders-btn')?.addEventListener('click', syncLocalOrdersToSupabase);
      tableContainer.insertBefore(banner, tableContainer.firstChild);
    }
  }

  filtered = [...allOrders];
  renderTable();
  bindSearch();
  bindFilters();
});

function renderTable() {
  const start = (page-1)*PER_PAGE;
  const slice = filtered.slice(start, start+PER_PAGE);
  const tbody = document.getElementById('orders-tbody');
  if (!tbody) return;

  if (!slice.length) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:3rem;color:var(--clr-text-3)">No orders found</td></tr>`;
  } else {
    tbody.innerHTML = slice.map(o => `
      <tr data-id="${o.id}">
        <td style="width:36px">
          <input type="checkbox" class="order-checkbox" data-id="${o.id}"
            style="accent-color:var(--clr-gold);width:14px;height:14px;cursor:pointer">
        </td>
        <td class="text-main">
          <a href="order-detail.html?id=${o.id}" style="color:var(--clr-gold);font-family:var(--ff-mono)">${o.id}</a>
        </td>
        <td>
          <div class="order-customer">
            <span class="cust-name">${esc(o.customerName)}</span>
            <span class="cust-email">${esc(o.customerEmail)}</span>
          </div>
        </td>
        <td class="hide-mobile" style="color:var(--clr-text-2)">${o.items.length} item${o.items.length>1?'s':''}</td>
        <td class="text-main" style="font-family:var(--ff-mono)">${formatPrice(o.total)}</td>
        <td>${orderStatusBadge(o.status)}</td>
        <td class="hide-mobile">${paymentStatusBadge(o.paymentStatus)}</td>
        <td class="hide-mobile" style="color:var(--clr-text-3);font-size:.8125rem">${formatDateTime(o.createdAt)}</td>
        <td>
          <div style="display:flex;gap:.4rem;align-items:center">
            <a href="order-detail.html?id=${o.id}" class="btn btn-ghost btn-sm">
              <i class="fa-regular fa-eye"></i> View
            </a>
            <button class="btn btn-ghost btn-sm delete-order-btn"
              data-id="${o.id}" data-total="${o.total}"
              title="Delete order"
              style="color:var(--clr-error)">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </td>
      </tr>`).join('');
  }
  renderPagination();
  document.getElementById('orders-count').textContent = `${filtered.length} orders`;
  bindDeleteButtons();
  bindBulkSelect();
}

function renderPagination() {
  const totalPages = Math.ceil(filtered.length/PER_PAGE);
  const pag = document.getElementById('orders-pagination');
  if (!pag || totalPages <= 1) { if(pag) pag.innerHTML=''; return; }
  let html = `<button class="page-btn" onclick="goPage(${page-1})" ${page<=1?'disabled':''}><i class="fa-solid fa-chevron-left"></i></button>`;
  for (let i=1; i<=totalPages; i++) {
    html += `<button class="page-btn ${i===page?'active':''}" onclick="goPage(${i})">${i}</button>`;
  }
  html += `<button class="page-btn" onclick="goPage(${page+1})" ${page>=totalPages?'disabled':''}><i class="fa-solid fa-chevron-right"></i></button>`;
  pag.innerHTML = html;
}

window.goPage = p => {
  page = p; renderTable();
};

function bindSearch() {
  document.getElementById('order-search')?.addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    filtered = allOrders.filter(o =>
      o.id.toLowerCase().includes(q) ||
      o.customerName.toLowerCase().includes(q) ||
      o.customerEmail.toLowerCase().includes(q)
    );
    page = 1; renderTable();
  });
}

function bindFilters() {
  document.getElementById('filter-status')?.addEventListener('change', applyFilter);
  document.getElementById('filter-payment')?.addEventListener('change', applyFilter);
  document.getElementById('sort-orders')?.addEventListener('change', applySort);
}

function applyFilter() {
  const status  = document.getElementById('filter-status')?.value  || '';
  const payment = document.getElementById('filter-payment')?.value || '';
  filtered = allOrders.filter(o => {
    if (status  && o.status !== status)        return false;
    if (payment && o.paymentStatus !== payment) return false;
    return true;
  });
  page = 1; renderTable();
}

function applySort() {
  const s = document.getElementById('sort-orders')?.value || '';
  if (s === 'newest')   filtered.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
  if (s === 'oldest')   filtered.sort((a,b) => new Date(a.createdAt) - new Date(b.createdAt));
  if (s === 'amount-h') filtered.sort((a,b) => b.total - a.total);
  if (s === 'amount-l') filtered.sort((a,b) => a.total - b.total);
  page = 1; renderTable();
}

// ── Delete order ─────────────────────────────────────────────
function bindDeleteButtons() {
  document.querySelectorAll('.delete-order-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id    = btn.dataset.id;
      const total = btn.dataset.total;
      const ok = await adminConfirm({ title: `Delete order ${id}?`, message: `Total: Rs. ${Number(total).toLocaleString()} — this cannot be undone.`, confirm: 'Delete', danger: true });
      if (!ok) return;
      await AdminAPI.orders.delete(id);
      allOrders  = allOrders.filter(o => o.id !== id);
      filtered   = filtered.filter(o => o.id !== id);
      toast.success('Deleted', `Order ${id} removed`);
      renderTable();
    });
  });
}

// ── Bulk select & delete ─────────────────────────────────────
function bindBulkSelect() {
  const selectAll = document.getElementById('select-all-orders');
  const bulkBtn   = document.getElementById('bulk-delete-btn');
  const countEl   = document.getElementById('selected-count');

  const updateBulkBar = () => {
    const checked = document.querySelectorAll('.order-checkbox:checked');
    const n = checked.length;
    if (bulkBtn) bulkBtn.style.display = n > 0 ? '' : 'none';
    if (countEl) countEl.textContent = n;
  };

  selectAll?.addEventListener('change', () => {
    document.querySelectorAll('.order-checkbox').forEach(cb => {
      cb.checked = selectAll.checked;
    });
    updateBulkBar();
  });

  document.getElementById('orders-tbody')?.addEventListener('change', e => {
    if (e.target.classList.contains('order-checkbox')) {
      const allChecked = [...document.querySelectorAll('.order-checkbox')].every(cb => cb.checked);
      if (selectAll) selectAll.checked = allChecked;
      updateBulkBar();
    }
  });

  bulkBtn?.addEventListener('click', async () => {
    const checked = [...document.querySelectorAll('.order-checkbox:checked')];
    if (!checked.length) return;
    const ids = checked.map(cb => cb.dataset.id);
    const ok = await adminConfirm({ title: `Delete ${ids.length} selected order${ids.length > 1 ? 's' : ''}?`, message: 'This cannot be undone.', confirm: 'Delete All', danger: true });
    if (!ok) return;
    await AdminAPI.orders.deleteBulk(ids);
    allOrders = allOrders.filter(o => !ids.includes(o.id));
    filtered  = filtered.filter(o => !ids.includes(o.id));
    if (selectAll) selectAll.checked = false;
    if (bulkBtn)   bulkBtn.style.display = 'none';
    if (countEl)   countEl.textContent = '0';
    renderTable();
    toast.success('Deleted', `${ids.length} order${ids.length > 1 ? 's' : ''} removed`);
  });
}

// ── Update order status (used in order-detail.html) ───────────
window.updateOrderStatus = async (id, status) => {
  await AdminAPI.orders.updateStatus(id, status);
  toast.success('Status updated', `Order ${id} → ${status}`);
};

window.updatePaymentStatus = async (id, status) => {
  await AdminAPI.orders.updatePayment(id, status);
  toast.success('Payment updated', `Order ${id} payment → ${status}`);
};

// ── Sync locally-saved orders to Supabase ────────────────────
// Called when admin clicks "Sync to Supabase" on the warning banner.
// Reads all orders from localStorage emergency backup and INSERTs them
// into Supabase. Successfully synced orders are removed from localStorage.
async function syncLocalOrdersToSupabase() {
  const btn = document.getElementById('sync-local-orders-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Syncing…'; }

  const sb = getSupabase();
  if (!sb) {
    toast.error('Supabase not ready', 'Check SUPABASE_URL and SUPABASE_ANON_KEY in env.js.');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Sync to Supabase'; }
    return;
  }

  let localOrders = [];
  try {
    localOrders = JSON.parse(localStorage.getItem('zm_orders') || '[]');
    if (!Array.isArray(localOrders)) localOrders = [];
  } catch (_) {}

  if (!localOrders.length) {
    toast.info('Nothing to sync', 'No locally-saved orders found in this browser.');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Sync to Supabase'; }
    return;
  }

  let synced = 0;
  let failed = 0;
  const stillLocal = [];

  for (const o of localOrders) {
    if (!o || !o.id) continue;
    const row = {
      id:             o.id,
      customer_id:    o.customerId    || null,
      customer_name:  o.customerName  || '',
      customer_email: o.customerEmail || '',
      customer_phone: o.customerPhone || '',
      items:          o.items         || [],
      subtotal:       o.subtotal      || 0,
      shipping:       o.shipping      || 0,
      discount:       o.discount      || 0,
      total:          o.total         || 0,
      status:         o.status        || 'pending',
      payment_status: o.paymentStatus || 'pending',
      payment_method: o.paymentMethod || '',
      coupon_code:    o.coupon        || o.couponCode || '',
      bank_ref:       o.bankRef       || null,
      payment_slip:   o.paymentSlip   || null,
      address:        o.address       || {},
      notes:          (o.notes || '').replace(' [LOCAL BACKUP — not synced to DB]', ''),
      created_at:     o.createdAt     || new Date().toISOString(),
      updated_at:     new Date().toISOString(),
    };
    try {
      const { error: insErr } = await sb.from('orders').insert(row);
      if (!insErr) { synced++; continue; }
      if (insErr.code === '23505') { synced++; continue; } // already exists in DB
      console.warn('[Sync] Failed for', o.id, insErr.code, insErr.message);
      failed++;
      stillLocal.push(o);
    } catch (e) {
      console.warn('[Sync] Exception for', o.id, e.message);
      failed++;
      stillLocal.push(o);
    }
  }

  // Remove successfully synced orders from localStorage
  try { localStorage.setItem('zm_orders', JSON.stringify(stillLocal)); } catch (_) {}

  if (synced > 0 && failed === 0) {
    toast.success('Sync complete', `${synced} order${synced > 1 ? 's' : ''} pushed to Supabase.`);
    setTimeout(() => window.location.reload(), 1200);
  } else if (synced > 0) {
    toast.info('Partial sync', `${synced} synced, ${failed} failed — check console.`);
    setTimeout(() => window.location.reload(), 1500);
  } else {
    toast.error('Sync failed', 'Could not save to Supabase. Make sure supabase-setup.sql has been run first.');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Retry Sync'; }
  }
}

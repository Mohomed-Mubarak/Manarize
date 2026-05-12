/* ============================================================
   ZENMARKET — ADMIN COUPONS  (fixed — atomic ops)
   ============================================================ */
import { adminConfirm }      from './admin-confirm.js';
import { requireAdmin }      from './admin-auth.js';
import { injectAdminLayout } from './admin-layout.js';
import { withLoader }        from '../loader.js';
import { getCoupons, insertCoupon, deleteCoupon, toggleCoupon } from '../store-adapter.js';
import { formatPrice, formatDate } from '../utils.js';
import toast                 from '../toast.js';
import { esc }               from '../security-utils.js';

// ── Render table ──────────────────────────────────────────────
async function renderCoupons() {
  const coupons = await getCoupons();
  const tbody   = document.getElementById('coupons-tbody');
  const countEl = document.getElementById('coupon-count');
  if (!tbody) return;

  if (countEl) countEl.textContent = `${coupons.length} coupon${coupons.length !== 1 ? 's' : ''}`;

  if (!coupons.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--clr-text-3)">No coupons yet — create one →</td></tr>`;
    return;
  }

  tbody.innerHTML = coupons.map(c => {
    const discountLabel =
      c.type === 'percent'  ? `${c.value}% off` :
      c.type === 'shipping' ? 'Free shipping'    :
                              `Rs. ${Number(c.value).toLocaleString('en-LK')} off`;
    const discountClass =
      c.type === 'percent'  ? 'badge-blue'   :
      c.type === 'shipping' ? 'badge-green'  : 'badge-amber';

    return `
      <tr>
        <td style="font-family:var(--ff-mono);font-weight:600;color:var(--clr-gold)">${esc(c.code)}</td>
        <td><span class="badge ${discountClass}">${discountLabel}</span></td>
        <td style="font-family:var(--ff-mono);color:var(--clr-text-2)">${formatPrice(c.minOrder || 0)}</td>
        <td style="color:var(--clr-text-2)">${c.used || 0} / ${c.maxUses || '∞'}</td>
        <td><span class="badge ${c.active ? 'badge-green' : 'badge-gray'}">${c.active ? 'Active' : 'Inactive'}</span></td>
        <td style="color:var(--clr-text-3);font-size:.8125rem">${formatDate(c.expires || '')}</td>
        <td>
          <div style="display:flex;gap:.5rem;align-items:center">
            <button class="btn btn-ghost btn-sm toggle-btn"
              data-id="${esc(c.id)}"
              data-active="${c.active}"
              style="color:${c.active ? 'var(--clr-warning)' : 'var(--clr-success)'}">
              <i class="fa-solid ${c.active ? 'fa-toggle-off' : 'fa-toggle-on'}"></i>
              ${c.active ? 'Disable' : 'Enable'}
            </button>
            <button class="btn btn-ghost btn-sm delete-btn"
              data-id="${esc(c.id)}" data-code="${esc(c.code)}"
              style="color:var(--clr-error)" title="Delete">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </td>
      </tr>`;
  }).join('');

  // Bind toggle buttons — atomic single-row update
  tbody.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id        = btn.dataset.id;
      const newActive = btn.dataset.active === 'true' ? false : true;
      btn.disabled = true;
      try {
        await toggleCoupon(id, newActive);
        toast.info('Updated', `Coupon ${newActive ? 'activated' : 'deactivated'}`);
        renderCoupons();
      } catch (err) {
        toast.error('Error', err.message || 'Could not update coupon');
        btn.disabled = false;
      }
    });
  });

  // Bind delete buttons — atomic single-row delete
  tbody.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id   = btn.dataset.id;
      const code = btn.dataset.code;
      const ok = await adminConfirm({
        title:   `Delete coupon "${code}"?`,
        message: 'Customers with this code will no longer be able to use it.',
        confirm: 'Delete',
        danger:  true,
      });
      if (!ok) return;
      btn.disabled = true;
      try {
        await deleteCoupon(id);
        toast.success('Deleted', `Coupon ${code} removed`);
        renderCoupons();
      } catch (err) {
        toast.error('Error', err.message || 'Could not delete coupon');
        btn.disabled = false;
      }
    });
  });
}

// ── Add coupon ────────────────────────────────────────────────
function bindAddForm() {
  const addBtn = document.getElementById('add-coupon-btn');
  if (!addBtn) return;

  addBtn.addEventListener('click', async () => {
    const code  = (document.getElementById('coupon-code')?.value   || '').trim().toUpperCase();
    const type  =  document.getElementById('coupon-type')?.value   || 'percent';
    const value = parseFloat(document.getElementById('coupon-value')?.value  || '0');
    const min   = parseFloat(document.getElementById('coupon-min')?.value    || '0');
    const maxRaw = document.getElementById('coupon-max')?.value;
    const max   = maxRaw ? parseInt(maxRaw, 10) : null;   // null = unlimited
    const exp   =  document.getElementById('coupon-expires')?.value || '';

    // Validation
    if (!code) {
      toast.error('Required', 'Enter a coupon code');
      return;
    }
    if (type !== 'shipping' && (isNaN(value) || value <= 0)) {
      toast.error('Required', 'Enter a valid discount value');
      return;
    }
    if (type === 'percent' && value > 100) {
      toast.error('Invalid', 'Percentage discount cannot exceed 100%');
      return;
    }

    // Check for duplicate code
    let existing = [];
    try { existing = await getCoupons(); } catch (_) { /* non-fatal */ }
    if (existing.find(c => c.code === code)) {
      toast.error('Duplicate', `Code "${code}" already exists`);
      return;
    }

    addBtn.disabled = true;
    addBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creating…';

    const newCoupon = {
      id:       `CPN-${Date.now()}`,
      code,
      type,
      value:    type === 'shipping' ? 0 : value,
      minOrder: isNaN(min) ? 0 : min,
      maxUses:  (!max || isNaN(max)) ? null : max,   // null = unlimited
      used:     0,
      active:   true,
      expires:  exp || null,   // null = no expiry (stored as NULL in DB)
    };

    try {
      await insertCoupon(newCoupon);
      toast.success('Created', `Coupon "${code}" created successfully`);

      // Reset form
      ['coupon-code', 'coupon-value', 'coupon-min', 'coupon-expires'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      const maxEl = document.getElementById('coupon-max');
      if (maxEl) maxEl.value = '';
      const typeEl = document.getElementById('coupon-type');
      if (typeEl) typeEl.value = 'percent';

      renderCoupons();
    } catch (err) {
      toast.error('Error', err.message || 'Could not create coupon');
    } finally {
      addBtn.disabled = false;
      addBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Create Coupon';
    }
  });
}

// ── Init ──────────────────────────────────────────────────────
withLoader(async () => {
  if (!requireAdmin()) return;
  await injectAdminLayout('Coupons');
  renderCoupons();
  bindAddForm();
  // CSP-safe replacement for oninput="this.value=this.value.toUpperCase()" in HTML
  const codeInput = document.getElementById('coupon-code');
  if (codeInput) {
    codeInput.addEventListener('input', () => {
      const pos = codeInput.selectionStart;
      codeInput.value = codeInput.value.toUpperCase();
      codeInput.setSelectionRange(pos, pos);
    });
  }
});

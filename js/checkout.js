/* ============================================================
   ZENMARKET — CHECKOUT  (PayHere · Bank Transfer · COD)
   ============================================================ */
import { withLoader }         from './loader.js';
import { injectLayout }       from './layout.js';
import { getCart, clearCart } from './cart.js';
import { getShippingRate, getDeliveryDays, getProducts, getCoupons, getSiteSettings, decrementStock, incrementCouponUsage } from './store-adapter.js';
import { formatPrice }        from './utils.js';
import { getCurrentUser, isLoggedIn, getAddresses, setSession } from './auth.js';
import { initPhoneInput, getPhoneValue } from './phone-input.js';
import { sendOrderSuccessNotification, sendNewOrderAdminNotification } from './notifications.js';
import { LS, WA_PHONE, DEMO_MODE, SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import toast                  from './toast.js';

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

let shippingCost    = 350;
let selectedPayment = '';
let slipDataUrl     = null;
let _cachedSettings = null; // populated by withLoader, reused by loadBankDetails

const DEFAULT_BANK = {
  bankName:      'Bank of Ceylon',
  accountName:   'Manarize (Pvt) Ltd',
  accountNumber: '1234567890',
  branchName:    'Colombo Main Branch',
  branchCode:    '001',
  swiftCode:     'BCEYLKLX',
};

// ── CRITICAL: auth guard + form bind, outside withLoader ──────
// ── Auth guard + form initialisation ─────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // ── Auth guard (hard wall — no guest checkout) ────────────
  if (!isLoggedIn()) {
    sessionStorage.setItem('zm_return_url', '/checkout');
    window.location.href = '/login?next=/checkout';
    return;
  }

  const cart = getCart();

  // Redirect to cart if empty
  if (!cart.length) {
    window.location.href = '/cart';
    return;
  }

  // Bind the form immediately (synchronous — no Supabase needed)
  bindForm(cart);
  initPhoneInput(document.getElementById('phone'));
  bindDistrictChange();
  bindPaymentSelect();
  bindBankUpload();
  renderOrderItems(cart);
  updateTotals(cart);

  // Hydrate fresh session from Supabase (fixes empty name/email in production)
  // then auto-fill the form and load saved addresses
  await prefillUser();
});

/** Refresh Supabase session → re-hydrate localStorage → return fresh user.
 *  Falls back to cached getCurrentUser() if Supabase is unavailable. */
async function ensureSession() {
  if (DEMO_MODE) return getCurrentUser();
  try {
    const { getSupabase } = await import('./supabase.js');
    const sb = getSupabase();
    if (!sb) return getCurrentUser();
    const { data } = await sb.auth.getSession();
    const sbUser = data?.session?.user;
    if (!sbUser) return getCurrentUser();
    const cached = getCurrentUser() || {};
    const localUser = {
      id:        sbUser.id,
      name:      sbUser.user_metadata?.name
               || sbUser.user_metadata?.full_name
               || sbUser.user_metadata?.display_name
               || sbUser.email?.split('@')[0]
               || cached.name || '',
      email:     sbUser.email || cached.email || '',
      phone:     sbUser.user_metadata?.phone || cached.phone || '',
      role:      'customer',
      createdAt: sbUser.created_at,
      _supabase: true,
    };
    setSession(localUser);
    return localUser;
  } catch {
    return getCurrentUser();
  }
}

// ── Layout + UI enhancements (non-critical) ───────────────────
withLoader(async () => {
  await injectLayout({});

  const cart = getCart();
  if (!cart.length) return; // already redirected above

  // Load settings ONCE with a 2-second max timeout so the page
  // never hangs for 6+ seconds waiting on Supabase.
  let settings = {};
  try {
    const settingsPromise = getSiteSettings().catch(() => null);
    const timeout         = new Promise(r => setTimeout(() => r(null), 2000));
    const raw = await Promise.race([settingsPromise, timeout]) || {};
    // Flatten {v: value} wrappers from Supabase storage
    const flat = {};
    Object.entries(raw).forEach(([k, v]) => {
      flat[k] = (v && typeof v === 'object' && 'v' in v) ? v.v : v;
    });
    settings = flat;
    // Cache for loadBankDetails so it never calls Supabase again
    _cachedSettings = settings;
  } catch {
    try { settings = JSON.parse(localStorage.getItem(LS.siteSettings) || '{}'); } catch {}
  }

  const payhereEnabled = settings.payhereEnabled !== false && settings.payhereEnabled !== 'false';
  const bankEnabled    = settings.bankEnabled    !== false && settings.bankEnabled    !== 'false';
  const codEnabled     = settings.codEnabled     !== false && settings.codEnabled     !== 'false';

  const payhereOpt = document.querySelector('input[name="payment"][value="payhere"]')?.closest('.payment-option');
  const bankOpt    = document.querySelector('input[name="payment"][value="bank"]')?.closest('.payment-option');
  const codOpt     = document.querySelector('input[name="payment"][value="cod"]')?.closest('.payment-option');

  if (payhereOpt && !payhereEnabled) payhereOpt.style.display = 'none';
  if (bankOpt    && !bankEnabled)    bankOpt.style.display    = 'none';
  if (codOpt     && !codEnabled)     codOpt.style.display     = 'none';

  // No auto-selection — user must choose a payment method
  document.querySelectorAll('input[name="payment"]').forEach(r => { r.checked = false; });
  document.querySelectorAll('.payment-option').forEach(o => o.classList.remove('selected'));
  selectedPayment = '';

  loadBankDetails();
});

// ── Load bank details ─────────────────────────────────────────
async function loadBankDetails() {
  // Reuse settings already fetched by withLoader (avoids a second Supabase round-trip)
  let settings = _cachedSettings;
  if (!settings) {
    try { settings = JSON.parse(localStorage.getItem(LS.siteSettings) || '{}'); } catch { settings = {}; }
  }
  const bank = {
    bankName:      settings.bankName      || DEFAULT_BANK.bankName,
    accountName:   settings.accountName   || DEFAULT_BANK.accountName,
    accountNumber: settings.accountNumber || DEFAULT_BANK.accountNumber,
    branchName:    settings.branchName    || DEFAULT_BANK.branchName,
    branchCode:    settings.branchCode    || DEFAULT_BANK.branchCode,
    swiftCode:     settings.swiftCode     || DEFAULT_BANK.swiftCode,
  };

  const infoEl = document.getElementById('bank-account-info');
  if (!infoEl) return;
  infoEl.innerHTML = [
    ['Bank',           esc(bank.bankName)],
    ['Account Name',   esc(bank.accountName)],
    ['Account Number', `<span style="font-family:var(--ff-mono);font-weight:700;color:var(--clr-gold);font-size:1rem;letter-spacing:.05em">${esc(bank.accountNumber)}</span>`],
    ['Branch',         esc(bank.branchName)],
    ['Branch Code',    esc(bank.branchCode)],
    ['SWIFT / BIC',    esc(bank.swiftCode)],
  ].map(([label, val]) =>
    `<span style="color:var(--clr-text-3);font-size:.8125rem">${esc(label)}</span>
     <span style="color:var(--clr-text-2)">${val}</span>`
  ).join('');
}

// ── Render order items ────────────────────────────────────────
function renderOrderItems(cart) {
  const el = document.getElementById('checkout-items');
  if (!el) return;
  el.innerHTML = cart.map(item => `
    <div style="display:flex;gap:.75rem;align-items:center;padding:.625rem 0;border-bottom:1px solid var(--clr-border)">
      <div style="position:relative;flex-shrink:0">
        <img src="${item.image || ''}" style="width:52px;height:52px;border-radius:6px;object-fit:cover;background:var(--clr-bg-2)" alt="${esc(item.name)}"
             data-err-fn="__imgErr">
        <span style="position:absolute;top:-6px;right:-6px;background:var(--clr-surface-2);color:var(--clr-text-2);border-radius:50%;width:18px;height:18px;display:flex;align-items:center;justify-content:center;font-size:.7rem;border:1px solid var(--clr-border)">${item.qty}</span>
      </div>
      <div style="flex:1;font-size:.875rem">
        <div style="font-weight:500;color:var(--clr-text)">${esc(item.name)}</div>
        ${item.variant ? `<div style="font-size:.75rem;color:var(--clr-text-3)">${esc(item.variant)}</div>` : ''}
      </div>
      <span style="font-family:var(--ff-mono);font-size:.875rem;color:var(--clr-text-2)">${formatPrice((parseFloat(item.price) || 0) * (parseInt(item.qty) || 0))}</span>
    </div>`).join('');
}

// ── Totals ────────────────────────────────────────────────────
function updateTotals(cart) {
  let discountData = {};
  try { discountData = JSON.parse(sessionStorage.getItem('zm_cart_discount') || '{}'); } catch {}
  const subtotal      = cart.reduce((s, i) => s + (parseFloat(i.price) || 0) * (parseInt(i.qty) || 0), 0);
  const discount      = discountData.discount || 0;
  // Auto-apply free shipping if subtotal meets admin threshold
  const freeShipThreshold = Number(_cachedSettings?.freeShip) || 0;
  const qualifiesForFreeShip = freeShipThreshold > 0 && subtotal >= freeShipThreshold;
  const isFreeShip    = discountData.freeShipping || qualifiesForFreeShip;
  const effectiveShip = isFreeShip ? 0 : shippingCost;
  const total         = Math.max(0, subtotal + effectiveShip - discount);

  const sub  = document.getElementById('co-subtotal');
  const ship = document.getElementById('co-shipping');
  const tot  = document.getElementById('co-total');
  const drow = document.getElementById('co-discount-row');
  const disc = document.getElementById('co-discount');

  if (sub)  sub.textContent  = formatPrice(subtotal);
  if (ship) ship.textContent = isFreeShip ? 'FREE' : formatPrice(effectiveShip);
  if (tot)  tot.textContent  = formatPrice(total);

  if (drow) {
    if (discount > 0) {
      drow.style.display = '';
      if (disc) disc.textContent = `-${formatPrice(discount)}`;
    } else if (isFreeShip) {
      drow.style.display = '';
      if (disc) disc.textContent = 'Free shipping applied';
    } else {
      drow.style.display = 'none';
    }
  }
}

// ── Prefill user ──────────────────────────────────────────────
async function prefillUser() {
  // ensureSession() refreshes from Supabase in production so name/email
  // are always populated even on a hard page reload
  const user = await ensureSession();
  if (!user || (!user.id && !user.email)) return;
  const names = (user.name || '').split(' ');
  setVal('first-name', names[0] || '');
  setVal('last-name',  names.slice(1).join(' ') || '');
  setVal('email',      user.email  || '');

  // Phone: set raw value then fire 'input' so initPhoneInput normalises it
  const phoneEl = document.getElementById('phone');
  if (phoneEl && user.phone) {
    phoneEl.value = user.phone;
    phoneEl.dispatchEvent(new Event('input'));
  }

  // Render the saved-address picker and auto-fill the default
  await renderSavedAddressPicker(user);
}

// ── Saved Address Picker ──────────────────────────────────────
async function renderSavedAddressPicker(user) {
  const addresses = await getAddresses(user.id);
  if (!addresses || !addresses.length) return;

  // Auto-fill with default address immediately
  const defaultAddr = addresses.find(a => a.isDefault) || addresses[0];
  if (defaultAddr) fillAddressFields(defaultAddr);

  // Build the picker UI above the shipping address fields
  const shippingSection = document.querySelector('.checkout-section:nth-child(2)');
  if (!shippingSection) return;

  const picker = document.createElement('div');
  picker.id = 'saved-address-picker';
  picker.style.cssText = 'margin-bottom:1.25rem;';

  picker.innerHTML = `
    <label class="form-label" style="margin-bottom:.5rem;display:block">
      <i class="fa-solid fa-location-dot" style="color:var(--clr-gold);margin-right:.35rem"></i>
      Saved Addresses
    </label>
    <div id="saved-addr-cards" style="display:flex;flex-direction:column;gap:.5rem;">
      ${addresses.map(addr => `
        <label class="saved-addr-card${addr.isDefault ? ' selected' : ''}"
               data-aid="${addr.id}"
               style="display:flex;align-items:flex-start;gap:.75rem;padding:.875rem 1rem;
                      border-radius:var(--r-md);border:2px solid ${addr.isDefault ? 'var(--clr-gold)' : 'var(--clr-border)'};
                      background:${addr.isDefault ? 'var(--clr-gold-bg)' : 'var(--clr-bg-2)'};
                      cursor:pointer;transition:all .2s;position:relative">
          <input type="radio" name="saved_address" value="${addr.id}"
                 ${addr.isDefault ? 'checked' : ''}
                 style="margin-top:.2rem;accent-color:var(--clr-gold)">
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.2rem;flex-wrap:wrap">
              <span style="font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;
                           padding:.1rem .45rem;border-radius:999px;
                           background:var(--clr-surface-2);color:var(--clr-text-3)">
                <i class="fa-solid fa-house" style="font-size:.65rem;margin-right:.2rem"></i>${esc(addr.label || 'Home')}
              </span>
              ${addr.isDefault ? `<span style="font-size:.7rem;font-weight:600;color:var(--clr-gold);padding:.1rem .45rem;border-radius:999px;background:var(--clr-gold-bg);border:1px solid var(--clr-gold-dim)"><i class="fa-solid fa-star" style="font-size:.6rem;margin-right:.2rem"></i>Default</span>` : ''}
              <strong style="font-size:.875rem;color:var(--clr-text)">${esc(addr.fullName || '')}</strong>
              ${addr.phone ? `<span style="font-size:.8rem;color:var(--clr-text-3)"><i class="fa-solid fa-phone" style="font-size:.7rem;margin-right:.2rem"></i>${esc(addr.phone)}</span>` : ''}
            </div>
            <div style="font-size:.8125rem;color:var(--clr-text-2);line-height:1.5">
              ${esc(addr.line1)}${addr.line2 ? ', ' + esc(addr.line2) : ''}, ${esc(addr.city)}, ${esc(addr.district)}${addr.province ? ', ' + esc(addr.province) + ' Province' : ''}
            </div>
          </div>
        </label>`).join('')}
    </div>
    <div style="margin-top:.625rem">
      <button type="button" id="use-diff-addr-btn"
              style="font-size:.8125rem;color:var(--clr-text-3);background:none;border:none;
                     cursor:pointer;padding:0;display:flex;align-items:center;gap:.35rem;
                     text-decoration:underline;text-underline-offset:2px">
        <i class="fa-solid fa-pen-to-square"></i> Enter a different address
      </button>
    </div>`;

  // Insert before the address form fields
  const firstFormGroup = shippingSection.querySelector('.form-group');
  if (firstFormGroup) shippingSection.insertBefore(picker, firstFormGroup);

  // Initially hide the manual form fields
  toggleManualFields(false);

  // Radio change → fill address
  picker.querySelectorAll('input[name="saved_address"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const chosen = addresses.find(a => a.id === radio.value);
      if (!chosen) return;
      fillAddressFields(chosen);
      // Update card highlight
      picker.querySelectorAll('.saved-addr-card').forEach(card => {
        const isSelected = card.dataset.aid === radio.value;
        card.style.borderColor = isSelected ? 'var(--clr-gold)' : 'var(--clr-border)';
        card.style.background  = isSelected ? 'var(--clr-gold-bg)' : 'var(--clr-bg-2)';
      });
    });
  });

  // "Enter a different address" toggle
  document.getElementById('use-diff-addr-btn')?.addEventListener('click', () => {
    const isHidden = document.getElementById('manual-addr-fields')?.style.display === 'none';
    toggleManualFields(isHidden);
    const btn = document.getElementById('use-diff-addr-btn');
    if (btn) btn.innerHTML = isHidden
      ? '<i class="fa-solid fa-xmark"></i> Cancel — use saved address'
      : '<i class="fa-solid fa-pen-to-square"></i> Enter a different address';
    if (isHidden) {
      // Clear autofilled values so user starts fresh
      ['addr-line1','addr-line2','city','district','province','zip'].forEach(id => setVal(id, ''));
      // Deselect all saved address radios
      picker.querySelectorAll('input[name="saved_address"]').forEach(r => r.checked = false);
      picker.querySelectorAll('.saved-addr-card').forEach(card => {
        card.style.borderColor = 'var(--clr-border)';
        card.style.background  = 'var(--clr-bg-2)';
      });
    } else {
      // Re-fill from currently selected radio or default
      const checkedRadio = picker.querySelector('input[name="saved_address"]:checked');
      const addr = checkedRadio
        ? addresses.find(a => a.id === checkedRadio.value)
        : defaultAddr;
      if (addr) fillAddressFields(addr);
    }
  });
}

function fillAddressFields(addr) {
  setVal('addr-line1', addr.line1    || '');
  setVal('addr-line2', addr.line2    || '');
  setVal('city',       addr.city     || '');
  setVal('zip',        addr.zip      || '');

  // Optionally fill name & phone from saved address if they are empty
  if (addr.fullName) {
    const names = addr.fullName.split(' ');
    const fn = document.getElementById('first-name');
    const ln = document.getElementById('last-name');
    if (fn && !fn.value) setVal('first-name', names[0] || '');
    if (ln && !ln.value) setVal('last-name', names.slice(1).join(' ') || '');
  }
  if (addr.phone) {
    const ph = document.getElementById('phone');
    if (ph && !ph.value) {
      ph.value = addr.phone;
      ph.dispatchEvent(new Event('input'));
    }
  }

  // Select district
  const districtEl = document.getElementById('district');
  if (districtEl && addr.district) {
    [...districtEl.options].forEach(o => {
      o.selected = o.text === addr.district || o.value === addr.district;
    });
    districtEl.dispatchEvent(new Event('change'));
  } else {
    // No district — still refresh totals with default shipping
    updateTotals(getCart());
  }

  // Select province
  const provinceEl = document.getElementById('province');
  if (provinceEl && addr.province) {
    const prov = addr.province.replace(' Province', '');
    [...provinceEl.options].forEach(o => {
      o.selected = o.text === prov || o.value === prov;
    });
  }
}

function toggleManualFields(show) {
  let wrapper = document.getElementById('manual-addr-fields');
  if (!wrapper) {
    // Wrap existing address form-groups on first call
    const shippingSection = document.querySelector('.checkout-section:nth-child(2)');
    if (!shippingSection) return;
    const groups = [...shippingSection.querySelectorAll('.form-group, .form-row')];
    // Exclude the notes field and shipping indicator — wrap only the pure address fields
    const addrGroups = groups.filter(el => {
      const inputs = el.querySelectorAll('#addr-line1,#addr-line2,#city,#district,#province,#zip');
      return inputs.length > 0;
    });
    if (!addrGroups.length) {
      // fallback: wrap all form-groups inside section
      wrapper = document.createElement('div');
      wrapper.id = 'manual-addr-fields';
      const firstGroup = shippingSection.querySelector('.form-group');
      if (firstGroup) shippingSection.insertBefore(wrapper, firstGroup);
      groups.forEach(g => {
        if (!['notes','shipping-indicator'].some(id => g.id === id || g.querySelector(`#${id}`)))
          wrapper.appendChild(g);
      });
    } else {
      wrapper = document.createElement('div');
      wrapper.id = 'manual-addr-fields';
      addrGroups[0].parentNode.insertBefore(wrapper, addrGroups[0]);
      addrGroups.forEach(g => wrapper.appendChild(g));
    }
  }
  wrapper.style.display = show ? '' : 'none';
}

// ── District → shipping rate ──────────────────────────────────
function bindDistrictChange() {
  document.getElementById('district')?.addEventListener('change', async e => {
    const d = e.target.value;
    const indicator = document.getElementById('shipping-indicator');
    if (!d) { if (indicator) indicator.style.display = 'none'; return; }
    shippingCost = await getShippingRate(d);
    if (indicator) indicator.style.display = '';
    const nameEl = document.getElementById('shipping-district-name');
    const rateEl = document.getElementById('shipping-rate-val');
    if (nameEl) nameEl.textContent = d;
    if (rateEl) rateEl.textContent = formatPrice(shippingCost);
    // Show delivery days estimate
    const daysEl = document.getElementById('shipping-days-val');
    if (daysEl) {
      const days = await getDeliveryDays(d);
      if (days) {
        daysEl.innerHTML = `<i class="fa-regular fa-clock" style="margin-right:.35rem"></i>Estimated delivery: <strong>${days} working days</strong>`;
        daysEl.style.display = '';
      } else {
        daysEl.style.display = 'none';
      }
    }
    updateTotals(getCart());
  });
}

// ── Payment method select ─────────────────────────────────────
function bindPaymentSelect() {
  document.querySelectorAll('input[name="payment"]').forEach(radio => {
    radio.addEventListener('change', () => {
      selectedPayment = radio.value;
      document.querySelectorAll('.payment-option').forEach(opt => opt.classList.remove('selected'));
      radio.closest('.payment-option')?.classList.add('selected');
      const bankPanel = document.getElementById('bank-details-panel');
      if (bankPanel) bankPanel.style.display = radio.value === 'bank' ? '' : 'none';
    });
  });
}

// ── Bank slip upload ──────────────────────────────────────────
function bindBankUpload() {
  const zone  = document.getElementById('slip-upload-zone');
  const input = document.getElementById('slip-file');
  if (!zone || !input) return;

  zone.addEventListener('click', () => input.click());
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.style.borderColor = 'var(--clr-gold)'; zone.style.background = 'var(--clr-gold-bg)'; });
  zone.addEventListener('dragleave', () => { zone.style.borderColor = ''; zone.style.background = ''; });
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.style.borderColor = ''; zone.style.background = '';
    if (e.dataTransfer.files[0]) handleSlipFile(e.dataTransfer.files[0]);
  });
  input.addEventListener('change', () => { if (input.files[0]) handleSlipFile(input.files[0]); });
}

function handleSlipFile(file) {
  // SECURITY: Block SVGs (can contain scripts), enforce 500KB limit, verify extension+MIME
  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  const ALLOWED_EXT   = ['.jpg', '.jpeg', '.png', '.webp', '.pdf'];
  const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));

  if (!ALLOWED_TYPES.includes(file.type) || !ALLOWED_EXT.includes(ext)) {
    toast.error('Invalid file type', 'Please upload a JPG, PNG, WebP, or PDF file.');
    return;
  }
  if (file.size > 500 * 1024) { toast.error('Too large', 'File must be under 500KB to store safely'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    slipDataUrl = e.target.result;
    const preview = document.getElementById('slip-preview');
    if (!preview) return;
    preview.style.display = '';
    if (file.type.startsWith('image/')) {
      preview.innerHTML = `
        <div style="position:relative;display:inline-block">
          <img src="${slipDataUrl}" style="max-height:140px;border-radius:8px;border:1px solid var(--clr-border)">
          <button type="button" id="remove-slip" style="position:absolute;top:-8px;right:-8px;width:22px;height:22px;background:var(--clr-error);color:#fff;border:none;border-radius:50%;cursor:pointer;font-size:.75rem">×</button>
        </div>
        <div style="font-size:.8125rem;color:var(--clr-success);margin-top:.375rem"><i class="fa-solid fa-circle-check"></i> Payment slip attached</div>`;
    } else {
      preview.innerHTML = `
        <div style="display:flex;align-items:center;gap:.75rem;padding:.75rem;background:var(--clr-bg-2);border-radius:8px;border:1px solid var(--clr-border)">
          <i class="fa-solid fa-file-pdf" style="font-size:1.5rem;color:var(--clr-error)"></i>
          <div>
            <div style="font-size:.875rem;font-weight:500">${esc(file.name)}</div>
            <div style="font-size:.75rem;color:var(--clr-text-3)">${(file.size/1024).toFixed(0)} KB</div>
          </div>
          <button type="button" id="remove-slip" style="margin-left:auto;color:var(--clr-error);background:none;border:none;cursor:pointer;font-size:1.125rem">×</button>
        </div>`;
    }
    document.getElementById('remove-slip')?.addEventListener('click', () => {
      slipDataUrl = null;
      if (preview) { preview.style.display = 'none'; preview.innerHTML = ''; }
      const slipFile = document.getElementById('slip-file');
      if (slipFile) slipFile.value = '';
    });
  };
  reader.readAsDataURL(file);
}

// ── Form submit ───────────────────────────────────────────────
function bindForm(cart) {
  const form = document.getElementById('checkout-form');
  const btn  = document.getElementById('place-order-btn');
  if (!form || !btn) return;

  form.addEventListener('submit', async e => {
    e.preventDefault();
    e.stopPropagation();

    if (!validateForm()) return;

    // ── Hard auth re-check before creating order ──────────────
    // Guards against session expiring mid-session or direct POST attacks.
    const user = getCurrentUser();
    if (!user || !user.id) {
      toast.error('Session expired', 'Please log in again to place your order.');
      sessionStorage.setItem('zm_return_url', '/checkout');
      setTimeout(() => window.location.href = '/login?next=/checkout', 1200);
      return;
    }

    // Prevent double-submit
    if (btn.disabled) return;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Processing…';

    try {
      let discountData = {};
      try { discountData = JSON.parse(sessionStorage.getItem('zm_cart_discount') || '{}'); } catch {}

      // CRIT-07: Re-validate prices from the authoritative product catalog —
      // never trust cart prices stored in localStorage (user-editable).
      let catalogProducts = [];
      try { catalogProducts = await getProducts() || []; } catch (e) { console.warn('[Checkout] getProducts failed, using cart prices:', e.message); }
      const subtotal = cart.reduce((s, i) => {
        const canonical = catalogProducts.find(p => p.id === i.productId);
        const safePrice = (canonical && typeof canonical.price === 'number') ? canonical.price : i.price;
        return s + safePrice * i.qty;
      }, 0);

      // CRIT-08: Re-validate coupon from the authoritative coupon store —
      // never trust the discount amount stored in sessionStorage (user-editable).
      let discount    = 0;
      let freeShip    = false;
      let appliedCode = null;
      if (discountData.coupon?.code) {
        let coupons = [];
        try { coupons = await getCoupons() || []; } catch (e) { console.warn('[Checkout] getCoupons failed:', e.message); }
        const coupon  = coupons.find(c => c.code === discountData.coupon.code && c.active);
        if (coupon) {
          if (coupon.type === 'percent') {
            discount = Math.round(subtotal * coupon.value / 100);
          } else if (coupon.type === 'fixed') {
            discount = Math.min(coupon.value, subtotal);
          } else if (coupon.type === 'shipping') {
            // free-shipping coupon — no monetary discount, just zero shipping
          }
          freeShip    = coupon.type === 'shipping';
          appliedCode = coupon.code;
          // Usage increment is done atomically via incrementCouponUsage() after the
          // order is persisted — avoids the race-condition of read-modify-write here.
        }
        // If coupon not found/inactive, discount stays 0 — tampered sessionStorage silently ignored
      }

      // Also auto-apply free shipping if subtotal meets admin threshold
      const freeShipThresh = Number(_cachedSettings?.freeShip) || 0;
      const qualifies = freeShipThresh > 0 && subtotal >= freeShipThresh;
      const effectiveShip = (freeShip || qualifies) ? 0 : shippingCost;
      const total         = Math.max(0, subtotal + effectiveShip - discount);
      const isBank        = selectedPayment === 'bank';
      const isCOD         = selectedPayment === 'cod';

      // ── Build order — customerId is ALWAYS the real user.id ──
      const order = {
        id:            `ORD-${crypto.randomUUID()}`,
        customerId:    user.id,          // never 'guest'
        customerName:  `${getVal('first-name')} ${getVal('last-name')}`.trim(),
        customerEmail: user.email,       // authoritative from session, not form input
        customerPhone: getPhoneValue(document.getElementById('phone')) || getVal('phone'),
        items: cart.map(i => ({
          productId: i.productId,
          name:      i.name,
          slug:      i.slug  || '',
          qty:       i.qty,
          price:     i.price,
          variant:   i.variant || '',
        })),
        subtotal,
        shipping:      effectiveShip,
        discount,
        total,
        status:        (isCOD || isBank) ? 'pending' : 'processing',
        paymentStatus: (isCOD || isBank) ? 'pending' : 'pending',
        paymentMethod: selectedPayment,
        address: {
          line1:    getVal('addr-line1'),
          line2:    getVal('addr-line2'),
          city:     getVal('city'),
          district: getVal('district'),
          province: getVal('province'),
          zip:      getVal('zip'),
        },
        notes:       getVal('notes'),
        coupon:      appliedCode,
        bankRef:     isBank ? getVal('bank-ref') : null,
        paymentSlip: null,   // populated below after Storage upload
        createdAt:   new Date().toISOString(),
        updatedAt:   new Date().toISOString(),
      };

      // Payment flow
      if (isCOD) {
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Placing Order…';
        await delay(600);

      } else if (isBank) {
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Recording Order…';

        // ── Upload bank slip to Supabase Storage ────────────────────
        // Do this synchronously here (inside the button-click handler)
        // so the slip URL is ready before we build the DB row.
        if (slipDataUrl) {
          if (DEMO_MODE) {
            // In demo mode, store the base64 data URL directly
            order.paymentSlip = slipDataUrl;
          } else {
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Uploading slip…';
            const slipUrl = await uploadBankSlipToStorage(slipDataUrl, order.id);
            if (slipUrl) {
              order.paymentSlip = slipUrl;
              console.log('[Checkout] Bank slip uploaded:', slipUrl);
            } else {
              // Upload failed — fall back to base64 so slip is not lost
              order.paymentSlip = slipDataUrl;
              console.warn('[Checkout] Slip upload failed; storing base64 fallback.');
            }
          }
        }

        await delay(400);
        toast.info('Bank Transfer', 'Your order is recorded. Complete your bank transfer and send the slip via WhatsApp.');

      } else {
        // PayHere (demo simulation)
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Connecting to PayHere…';
        await delay(800);
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Verifying Payment…';
        await delay(800);
        order.status        = 'processing';
        order.paymentStatus = 'paid';
        order.updatedAt     = new Date().toISOString();
        toast.success('Payment Verified', 'Your payment was processed successfully');
        await delay(300);
      }

      // WhatsApp admin notification — must be called BEFORE any await so that
      // window.open() fires synchronously within the button-click user-gesture.
      // Browsers block window.open() called after an async/await boundary.
      sendAdminWhatsApp(order);

      // ── Save order to Supabase ────────────────────────────────────────────
      //
      //  Single authoritative path through store-adapter → supabase-store.js.
      //  saveOneOrder() does INSERT with UPDATE-on-conflict (upsert), so
      //  double-submits are handled safely. Orders are stored ONLY in Supabase
      //  so the admin dashboard always has a complete view.
      //
      //  sessionStorage holds the order temporarily so the order-success page
      //  can display it instantly without a round-trip. It is tab-scoped and
      //  cleared automatically when the tab closes — it is NOT a data store.
      // ─────────────────────────────────────────────────────────────────────

      // Temp store for order-success page display (tab-scoped, not persistent)
      // ── Temp store for order-success page display (tab-scoped, auto-cleared) ──
      try { sessionStorage.setItem('zm_last_order', JSON.stringify(order)); } catch (_) {}

      if (!DEMO_MODE) {
        // ── Save order to Supabase — three independent paths, waterfall ────────
        //
        //  Path A: Supabase JS client (anon key, no session needed for INSERT).
        //          Works for static hosting. Needs supabase-setup.sql § 20 GRANTs.
        //
        //  Path B: Raw Supabase REST API with anon key (no SDK, pure fetch).
        //          Fallback when SDK fails. Same RLS requirements as Path A.
        //
        //  Path C: POST /api/orders — Vercel serverless, service-role key.
        //          Only available when deployed to Vercel with the env var set.
        //
        //  Any ONE succeeding is enough. All errors are logged.
        //  If all fail → order is saved to localStorage as an emergency backup
        //  so the admin can recover it from browser dev-tools / the admin panel.
        // ─────────────────────────────────────────────────────────────────────

        // Build the shared snake_case row once
        const row = {
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

        // Upsert helper — INSERT, fall back to UPDATE on duplicate key (idempotent retry)
        // sanitizeRow: strips any key not present in the DB schema, preventing PGRST204
        // errors if the JS order object ever gets a field the table doesn't have yet.
        const KNOWN_ORDER_COLUMNS = new Set([
          'id','customer_id','customer_name','customer_email','customer_phone',
          'items','subtotal','shipping','discount','total','status',
          'payment_status','payment_method','coupon_code','bank_ref',
          'payment_slip','address','notes','created_at','updated_at',
          'payment_id'
        ]);
        function sanitizeRow(r) {
          return Object.fromEntries(Object.entries(r).filter(([k]) => KNOWN_ORDER_COLUMNS.has(k)));
        }

        async function upsertRow(sb) {
          const { error: insErr } = await sb.from('orders').insert(sanitizeRow(row));
          if (!insErr) return;
          if (insErr.code === '23505') {
            const { error: updErr } = await sb
              .from('orders')
              .update({ ...row, updated_at: new Date().toISOString() })
              .eq('id', order.id);
            if (updErr) throw new Error(updErr.message);
            return;
          }
          throw Object.assign(new Error(insErr.message), { code: insErr.code });
        }

        let savedToDb = false;
        const diagErrors = {};

        // ── Path A: Direct Supabase JS client INSERT (fastest, most reliable) ──────
        // Bypasses the store-adapter layer to get the raw Supabase error code for diagnosis.
        try {
          const { getSupabase } = await import('./supabase.js');
          const sbA = getSupabase();
          if (!sbA) throw new Error('Supabase client not initialised — check SUPABASE_URL/SUPABASE_ANON_KEY in env.js');

          const { error: insErrA } = await sbA.from('orders').insert(sanitizeRow(row));
          if (!insErrA) {
            savedToDb = true;
            console.log('[Checkout] ✓ Path A (direct Supabase INSERT):', order.id);
          } else if (insErrA.code === '23505') {
            // Duplicate key — order already in DB (double-submit), treat as success
            savedToDb = true;
            console.log('[Checkout] ✓ Path A (duplicate — already in DB):', order.id);
          } else {
            // Log the FULL error so the developer can see exactly what failed
            const hint = insErrA.code === '42501' || (insErrA.message||'').toLowerCase().includes('denied')
              ? '← RLS / GRANT missing. Run FIX-orders-supabase.sql in Supabase SQL Editor.'
              : insErrA.code === '42P01'
              ? '← orders table does not exist. Run FIX-orders-supabase.sql in Supabase SQL Editor.'
              : '';
            console.error(
              `[Checkout] Path A INSERT failed:\n  code: ${insErrA.code}\n  message: ${insErrA.message}\n  details: ${insErrA.details}\n  hint: ${insErrA.hint}\n  ${hint}`
            );
            throw new Error(`${insErrA.code}: ${insErrA.message}${hint ? ' ' + hint : ''}`);
          }
        } catch (eA) {
          diagErrors.pathA = eA.message;
          console.warn('[Checkout] Path A failed:', eA.message);
        }

        // ── Path B: Raw Supabase REST with user JWT (fallback) ───────────────
        if (!savedToDb) {
          try {
            if (!SUPABASE_URL || !SUPABASE_ANON_KEY)
              throw new Error('SUPABASE_URL or SUPABASE_ANON_KEY not configured in env.js');
            const endpoint = `${SUPABASE_URL}/rest/v1/orders`;
            // Prefer the authenticated user's JWT over the anon key —
            // this satisfies RLS policies that check auth.uid() and also
            // works with anon INSERT policies when no session is available.
            let authToken = SUPABASE_ANON_KEY;
            try {
              const { getSupabase } = await import('./supabase.js');
              const _sb = getSupabase();
              if (_sb) {
                const { data: _sd } = await _sb.auth.getSession();
                if (_sd?.session?.access_token) authToken = _sd.session.access_token;
              }
            } catch (_) { /* keep anon key as fallback */ }
            const headers  = {
              'Content-Type': 'application/json',
              'apikey':        SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${authToken}`,
              'Prefer':        'return=minimal',
            };
            const ctrl    = new AbortController();
            const timerId = setTimeout(() => ctrl.abort(), 8000);
            const resp    = await fetch(endpoint, {
              method: 'POST', headers, body: JSON.stringify(row), signal: ctrl.signal,
            });
            clearTimeout(timerId);
            if (resp.ok) {
              savedToDb = true;
              console.log('[Checkout] ✓ Path B (REST anon POST):', order.id);
            } else if (resp.status === 409) {
              // Duplicate key — update instead
              const patchCtrl    = new AbortController();
              const patchTimerId = setTimeout(() => patchCtrl.abort(), 8000);
              const patchResp    = await fetch(`${endpoint}?id=eq.${encodeURIComponent(row.id)}`, {
                method: 'PATCH', headers,
                body: JSON.stringify({ ...row, updated_at: new Date().toISOString() }),
                signal: patchCtrl.signal,
              });
              clearTimeout(patchTimerId);
              if (patchResp.ok) {
                savedToDb = true;
                console.log('[Checkout] ✓ Path B (REST anon PATCH):', order.id);
              } else {
                const t = await patchResp.text().catch(() => '');
                throw new Error(`PATCH ${patchResp.status}: ${t.slice(0, 200)}`);
              }
            } else {
              const text    = await resp.text().catch(() => '');
              const isGrant = text.includes('42501') || text.toLowerCase().includes('permission') || text.toLowerCase().includes('denied');
              throw new Error(`REST ${resp.status}: ${text.slice(0, 200)}${isGrant ? ' ← run supabase-setup.sql GRANTs section' : ''}`);
            }
          } catch (eB) {
            diagErrors.pathB = eB.message;
            console.warn('[Checkout] Path B failed:', eB.message);
          }
        }

        // ── Path C: Vercel /api/orders (service-role — Vercel deployments only) ──
        if (!savedToDb) {
          try {
            const ctrl    = new AbortController();
            const timerId = setTimeout(() => ctrl.abort(), 8000);
            const resp    = await fetch('/api/orders', {
              method:  'POST',
              headers: { 'Content-Type': 'application/json' },
              body:    JSON.stringify(row),
              signal:  ctrl.signal,
            });
            clearTimeout(timerId);
            if (!resp.ok) {
              const e = await resp.json().catch(() => ({}));
              throw new Error(`HTTP ${resp.status}: ${e.error || 'unknown'}`);
            }
            savedToDb = true;
            console.log('[Checkout] ✓ Path C (/api/orders service-role):', order.id);
          } catch (eC) {
            diagErrors.pathC = eC.message;
            console.warn('[Checkout] Path C failed:', eC.message);
          }
        }

        if (savedToDb) {
          try { localStorage.removeItem('zm_db_setup_required'); } catch (_) {}
        } else {
          // ── ALL paths failed — emergency localStorage backup ─────────────
          // Save order to localStorage so the admin can see it in the admin
          // orders panel and recover it manually.
          try {
            const existing = JSON.parse(localStorage.getItem(LS.orders) || '[]');
            if (!Array.isArray(existing)) throw new Error('bad format');
            if (!existing.find(o => o.id === order.id)) {
              existing.unshift({ ...order, _localFallback: true });
              localStorage.setItem(LS.orders, JSON.stringify(existing));
            }
          } catch (_) {}
          try { localStorage.setItem('zm_db_setup_required', '1'); } catch (_) {}

          console.error(
            `[Manarize] ⚠ ORDER ${order.id} DID NOT REACH SUPABASE.\n` +
            `Path A (JS client): ${diagErrors.pathA || 'ok'}\n` +
            `Path B (REST anon): ${diagErrors.pathB || 'ok'}\n` +
            `Path C (/api/orders): ${diagErrors.pathC || 'ok'}\n\n` +
            `MOST LIKELY FIX:\n` +
            `  1. Supabase → SQL Editor → run supabase-setup.sql\n` +
            `  2. Verify SUPABASE_URL + SUPABASE_ANON_KEY in .env then: node build.js\n` +
            `  3. For Vercel: add SUPABASE_SERVICE_ROLE_KEY in project env vars`
          );

          toast.error(
            'Server sync failed',
            `Your order (${order.id}) was placed but couldn't reach our server. ` +
            `Screenshot your order ID and contact us if it doesn't appear in your profile.`
          );
          await delay(1500);
        }
      } else {
        // DEMO_MODE — save to localStorage (demo/offline use)
        try {
          const existing = JSON.parse(localStorage.getItem(LS.orders) || '[]');
          if (!existing.find(o => o.id === order.id)) existing.unshift(order);
          localStorage.setItem(LS.orders, JSON.stringify(existing));
        } catch (_) {}
      }

      // Decrement stock — non-critical, ignore failures
      try { await decrementStock(order.items); } catch (e) {
        try { const ls = await import('./store.js'); ls.decrementStock(order.items); } catch {}
      }

      // Increment coupon usage — non-critical, ignore failures
      if (appliedCode) {
        try { await incrementCouponUsage(appliedCode); } catch (e) {
          try { const ls = await import('./store.js'); ls.incrementCouponUsage(appliedCode); } catch {}
        }
      }

      // User notification — await so it completes before we navigate away
      await sendOrderSuccessNotification(user.id, order.id, order.total);

      // Admin notification — await so it completes before we navigate away
      await sendNewOrderAdminNotification(order.id, order.customerName, order.total);

      // Clear cart and discount
      clearCart();
      try { sessionStorage.removeItem('zm_cart_discount'); } catch {}

      // Redirect to success page
      window.location.href = `/order-success?id=${encodeURIComponent(order.id)}`;

    } catch (err) {
      const msg = err?.message || String(err) || 'Unknown error';
      console.error('[Checkout] Unexpected error:', msg, err);
      // If order was already saved (sessionStorage has it), redirect anyway
      try {
        const saved = sessionStorage.getItem('zm_last_order');
        if (saved) {
          const o = JSON.parse(saved);
          if (o && o.id) {
            window.location.href = '/order-success?id=' + encodeURIComponent(o.id);
            return;
          }
        }
      } catch {}
      toast.error('Order Failed', msg);
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-lock"></i> <span>Place Order</span>';
    }
  });
}

// ── Validate form with scroll-to-error ───────────────────────
function validateForm() {
  const required = [
    { id: 'first-name', label: 'First Name' },
    { id: 'last-name',  label: 'Last Name'  },
    { id: 'email',      label: 'Email'      },
    { id: 'phone',      label: 'Phone'      },
    { id: 'addr-line1', label: 'Address'    },
    { id: 'city',       label: 'City'       },
    { id: 'district',   label: 'District'   },
    { id: 'province',   label: 'Province'   },
  ];

  let firstInvalid = null;
  let valid = true;

  required.forEach(({ id }) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (!el.value?.trim()) {
      el.classList.add('error');
      if (!firstInvalid) firstInvalid = el;
      valid = false;
    } else {
      el.classList.remove('error');
    }
  });

  if (!valid) {
    toast.error('Required Fields', 'Please fill in all highlighted fields.');
    // Scroll to first error with offset for sticky navbar
    if (firstInvalid) {
      const top = firstInvalid.getBoundingClientRect().top + window.scrollY - 100;
      window.scrollTo({ top, behavior: 'smooth' });
      setTimeout(() => firstInvalid.focus(), 400);
    }
    return false;
  }

  // Payment method must be explicitly selected
  if (!selectedPayment) {
    const paySection = document.querySelector('.payment-option')?.closest('section, .step, .card, div[class*="payment"]')
      || document.querySelector('input[name="payment"]')?.closest('section, .step, .card');
    toast.error('Payment Method Required', 'Please select a payment method to continue.');
    if (paySection) {
      const top = paySection.getBoundingClientRect().top + window.scrollY - 100;
      window.scrollTo({ top, behavior: 'smooth' });
    }
    return false;
  }

  // Bank transfer requires a payment slip
  if (selectedPayment === 'bank' && !slipDataUrl) {
    const slipZone = document.getElementById('slip-upload-zone');
    toast.error('Payment Slip Required', 'Please attach your bank transfer slip before placing the order.');
    if (slipZone) {
      const top = slipZone.getBoundingClientRect().top + window.scrollY - 100;
      window.scrollTo({ top, behavior: 'smooth' });
      slipZone.style.outline = '2px solid var(--clr-error, #e53e3e)';
      slipZone.style.outlineOffset = '3px';
      setTimeout(() => { slipZone.style.outline = ''; slipZone.style.outlineOffset = ''; }, 3000);
    }
    return false;
  }

  return valid;
}

// ── WhatsApp Admin Notification ───────────────────────────────
function sendAdminWhatsApp(order) {
  try {
    const itemLines = order.items
      .map(i => `  • ${i.name}${i.variant ? ` (${i.variant})` : ''} × ${i.qty} — Rs.${(i.price * i.qty).toLocaleString()}`)
      .join('\n');
    const paymentLabel = {
      payhere: 'PayHere (Online)',
      bank:    'Bank Transfer',
      cod:     'Cash on Delivery',
    }[order.paymentMethod] || order.paymentMethod;

    const msg = [
      '🛒 *NEW ORDER — Manarize*',
      '─────────────────────────',
      `📦 *Order ID:* ${order.id}`,
      `👤 *Customer:* ${order.customerName}`,
      `📞 *Phone:* ${order.customerPhone}`,
      `📧 *Email:* ${order.customerEmail}`,
      '',
      '*Items:*',
      itemLines,
      '',
      `🚚 *Shipping:* Rs.${order.shipping.toLocaleString()} (${order.address.district})`,
      order.discount > 0 ? `🎟️ *Discount:* -Rs.${order.discount.toLocaleString()}` : null,
      `💰 *Total: Rs.${order.total.toLocaleString()}*`,
      `💳 *Payment:* ${paymentLabel}`,
      '',
      `📍 *Address:* ${order.address.line1}, ${order.address.city}`,
      order.notes ? `📝 *Notes:* ${order.notes}` : null,
    ].filter(Boolean).join('\n');

    const phone = (WA_PHONE || '').replace(/\D/g, '');
    if (!phone) return;
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
    // Open in background tab — admin sees it without interrupting checkout
    window.open(url, '_blank', 'noopener,noreferrer');
  } catch (e) {
    console.warn('[WhatsApp] Notification failed:', e);
  }
}

// ── Bank Slip — Supabase Storage Upload ──────────────────────
/**
 * Converts a base64 data URL to a Blob and uploads it to the
 * PRIVATE Supabase "payment-slips" storage bucket.
 *
 * Returns the storage FILE PATH (e.g. "abc-123/slip.jpg") on success,
 * or null on failure.  The path — NOT a URL — is stored in the orders
 * table.  Admins retrieve a short-lived signed URL at view time.
 *
 * Requires the user to be authenticated (enforced both by the checkout
 * auth guard and by the bucket's RLS policy).
 *
 * Never throws — a failed upload must not block order placement.
 */
async function uploadBankSlipToStorage(dataUrl, orderId) {
  try {
    const { getSupabase } = await import('./supabase.js');
    const sb = getSupabase();
    if (!sb) { console.warn('[Checkout] Supabase not ready — slip not uploaded.'); return null; }

    // Verify the user is authenticated before attempting upload
    const { data: sessionData } = await sb.auth.getSession();
    if (!sessionData?.session?.user) {
      console.warn('[Checkout] Unauthenticated — slip upload rejected.');
      return null;
    }

    // Convert data URL → Blob (browser-native, no libraries needed)
    const fetchRes  = await fetch(dataUrl);
    const blob      = await fetchRes.blob();

    // Determine file extension from MIME type
    const extMap    = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
    const ext       = extMap[blob.type] || 'jpg';
    const filePath  = `${orderId}/slip.${ext}`;

    const { error: uploadErr } = await sb.storage
      .from('payment-slips')
      .upload(filePath, blob, { contentType: blob.type, upsert: true });

    if (uploadErr) {
      console.error('[Checkout] Slip upload error:', uploadErr.message);
      return null;
    }

    // Bucket is PRIVATE — return the storage path so admins can generate
    // short-lived signed URLs when viewing the order.  Never expose a
    // public URL (the bucket has no public access).
    console.log('[Checkout] Bank slip stored at path:', filePath);
    return filePath;
  } catch (e) {
    console.warn('[Checkout] uploadBankSlipToStorage exception:', e.message);
    return null;
  }
}

// ── Helpers ───────────────────────────────────────────────────
const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
const getVal = id         => document.getElementById(id)?.value?.trim() || '';
const delay  = ms         => new Promise(r => setTimeout(r, ms));
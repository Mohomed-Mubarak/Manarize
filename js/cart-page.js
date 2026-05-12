/* ============================================================
   ZENMARKET — CART PAGE
   ============================================================ */
import { withLoader } from './loader.js';
import { injectLayout } from './layout.js';
import { getCart, renderCartItems, getCartTotal, clearCart } from './cart.js';
import { getCoupons } from './store-adapter.js';
import { formatPrice } from './utils.js';
import { isLoggedIn } from './auth.js';
import toast from './toast.js';

let appliedCoupon = null;

withLoader(async () => {
  await injectLayout({});
  render();
  autoApplyFreeShipping();
  bindCoupon();
  bindCheckoutGuard();
});

// ── Auto-apply free-shipping coupon ──────────────────────────
// Scans active coupons of type 'shipping'. If the cart subtotal
// meets the coupon's minimum order, the coupon is silently applied
// and the summary is refreshed. No manual code entry needed.
async function autoApplyFreeShipping() {
  if (appliedCoupon) return;
  const subtotal = getCartTotal();
  if (!subtotal) return;

  const coupons = await getCoupons();
  const match = coupons.find(c =>
    c.active &&
    c.type === 'shipping' &&
    subtotal >= (c.minOrder || 0)
  );
  if (!match) return;

  appliedCoupon = match;
  updateSummary();

  const input = document.getElementById('coupon-input');
  const msgEl = document.getElementById('coupon-msg');
  if (input) input.value = match.code;
  if (msgEl) {
    msgEl.textContent = '🚚 Free shipping automatically applied!';
    msgEl.style.color = 'var(--clr-success)';
  }

  import('./toast.js').then(m =>
    m.default.success('Free Shipping!', 'Your order qualifies for free shipping.')
  ).catch(() => {});
}

function render() {
  const container = document.getElementById('cart-items-container');
  renderCartItems(container);
  updateSummary();

  const checkoutBtn = document.getElementById('checkout-btn');
  const cart = getCart();
  if (checkoutBtn) {
    checkoutBtn.style.display = cart.length ? '' : 'none';
  }
}

function updateSummary() {
  const subtotal = getCartTotal();
  let discount = 0;
  let freeShipping = false;
  if (appliedCoupon) {
    if (appliedCoupon.type === 'percent') discount = Math.round(subtotal * appliedCoupon.value / 100);
    else if (appliedCoupon.type === 'fixed') discount = appliedCoupon.value;
    else if (appliedCoupon.type === 'shipping') freeShipping = true;
  }
  const total = Math.max(0, subtotal - discount);

  document.getElementById('summary-subtotal').textContent = formatPrice(subtotal);
  document.getElementById('summary-discount').textContent = freeShipping ? 'Free shipping' : formatPrice(discount);
  document.getElementById('summary-total').textContent    = formatPrice(total);

  // Show/hide discount row
  const discountRow = document.getElementById('summary-discount')?.closest('.summary-row');
  if (discountRow) discountRow.style.display = (discount > 0 || freeShipping) ? '' : 'none';

  // Store for checkout
  sessionStorage.setItem('zm_cart_discount', JSON.stringify({ coupon: appliedCoupon, discount, freeShipping }));
}

function bindCoupon() {
  document.getElementById('apply-coupon')?.addEventListener('click', async () => {
    const code   = document.getElementById('coupon-input').value.trim().toUpperCase();
    const msgEl  = document.getElementById('coupon-msg');
    const coupons = await getCoupons();

    // Step 1: find by code (regardless of active status)
    const coupon = coupons.find(c => c.code === code);

    if (!coupon) {
      msgEl.textContent = '❌ Invalid coupon code';
      msgEl.style.color = 'var(--clr-error)';
      appliedCoupon = null;
    } else if (!coupon.active) {
      msgEl.textContent = '❌ This coupon is currently disabled';
      msgEl.style.color = 'var(--clr-error)';
      appliedCoupon = null;
    } else if (coupon.expires && new Date(coupon.expires) < new Date()) {
      msgEl.textContent = '❌ This coupon has expired';
      msgEl.style.color = 'var(--clr-error)';
      appliedCoupon = null;
    } else {
      const subtotal = getCartTotal();
      if (subtotal < (coupon.minOrder || 0)) {
        msgEl.textContent = `❌ Minimum order Rs. ${(coupon.minOrder || 0).toLocaleString()} required`;
        msgEl.style.color = 'var(--clr-error)';
        appliedCoupon = null;
      } else {
        appliedCoupon = coupon;
        const label = coupon.type === 'percent' ? coupon.value + '% off'
          : coupon.type === 'shipping' ? 'Free shipping'
          : 'Rs. ' + coupon.value.toLocaleString() + ' off';
        msgEl.textContent = `✅ Coupon applied! ${label}`;
        msgEl.style.color = 'var(--clr-success)';
        toast.success('Coupon applied!', label);
      }
    }
    updateSummary();
  });
}

// Listen for cart updates
window.addEventListener('cart:updated', () => {
  render();
});

// ── Checkout guard ────────────────────────────────────────────
// Intercept the checkout button: guests are redirected to login
// with a ?next= param so they land back on checkout after auth.
function bindCheckoutGuard() {
  const btn = document.getElementById('checkout-btn');
  if (!btn) return;

  btn.addEventListener('click', e => {
    if (isLoggedIn()) return; // allow normal navigation

    e.preventDefault();
    toast.info('Sign in required', 'Please log in or create an account to continue.');
    // Save destination so login page can redirect back after auth
    sessionStorage.setItem('zm_return_url', '/checkout');
    setTimeout(() => {
      window.location.href = '/login?next=/checkout';
    }, 700);
  });
}

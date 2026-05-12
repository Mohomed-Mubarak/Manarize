/* ============================================================
   ZENMARKET — CART
   ============================================================ */
import { LS } from './config.js';
import { formatPrice } from './utils.js';
import { esc } from './security-utils.js';
import toast from './toast.js';

// ── Cart State ────────────────────────────────────────────────
function loadCart() {
  try { return JSON.parse(localStorage.getItem(LS.cart) || '[]'); }
  catch { return []; }
}

function saveCart(cart) {
  localStorage.setItem(LS.cart, JSON.stringify(cart));
  updateCartCount();
  dispatchCartEvent(cart);
}

function dispatchCartEvent(cart) {
  window.dispatchEvent(new CustomEvent('cart:updated', { detail: cart }));
}

// ── Cart Operations ───────────────────────────────────────────
export function getCart() { return loadCart(); }

export function getCartCount() {
  return loadCart().reduce((s, i) => s + i.qty, 0);
}

export function getCartTotal() {
  return loadCart().reduce((s, i) => s + i.price * i.qty, 0);
}

export function addToCart(product, qty = 1, variant = '') {
  const cart = loadCart();
  const key = `${product.id}__${variant}`;
  const existing = cart.find(i => i.key === key);
  if (existing) {
    existing.qty = Math.min(existing.qty + qty, product.stock || 99);
    toast.success('Cart updated', `${product.name} quantity updated`);
  } else {
    cart.push({
      key,
      productId: product.id,
      name: product.name,
      slug: product.slug,
      price: product.price,
      image: product.images?.[0] || '',
      variant,
      qty,
      stock: product.stock || 99,
    });
    toast.success('Added to cart', product.name);
  }
  saveCart(cart);
}

export function removeFromCart(key) {
  const cart = loadCart().filter(i => i.key !== key);
  saveCart(cart);
  toast.info('Removed', 'Item removed from cart');
}

export function updateQty(key, qty) {
  if (qty < 1) { removeFromCart(key); return; }
  const cart = loadCart();
  const item = cart.find(i => i.key === key);
  if (item) { item.qty = Math.min(qty, item.stock); saveCart(cart); }
}

export function clearCart() {
  saveCart([]);
}

// ── Wishlist ──────────────────────────────────────────────────
export function getWishlist() {
  try { return JSON.parse(localStorage.getItem(LS.wishlist) || '[]'); }
  catch { return []; }
}

export function toggleWishlist(product) {
  const list = getWishlist();
  const idx = list.findIndex(p => p.id === product.id);
  if (idx >= 0) {
    list.splice(idx, 1);
    toast.info('Wishlist', `${product.name} removed from wishlist`);
  } else {
    list.push({ id: product.id, name: product.name, price: product.price, image: product.images?.[0] || '', slug: product.slug });
    toast.success('Wishlist', `${product.name} added to wishlist`);
  }
  localStorage.setItem(LS.wishlist, JSON.stringify(list));
  return idx < 0;
}

export function isWishlisted(productId) {
  return getWishlist().some(p => p.id === productId);
}

// ── Update cart count badge ───────────────────────────────────
export function updateCartCount() {
  const count = getCartCount();
  document.querySelectorAll('.cart-count').forEach(el => {
    el.textContent = count > 0 ? count : '';
    el.style.display = count > 0 ? 'flex' : 'none';
  });
}

// ── Render cart items (cart.html) ─────────────────────────────
export function renderCartItems(container) {
  const cart = getCart();
  if (!container) return;

  if (!cart.length) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-cart-shopping"></i>
        <h3>Your cart is empty</h3>
        <p>Looks like you haven't added anything yet.</p>
        <a href="shop.html" class="btn btn-primary">Start Shopping</a>
      </div>`;
    return;
  }

  container.innerHTML = cart.map(item => `
    <div class="cart-item" data-key="${esc(item.key)}">
      <div class="cart-item-img">
        <a href="product.html?slug=${encodeURIComponent(item.slug)}">
          <img src="${item.image}" alt="${esc(item.name)}" loading="lazy"
               data-err-fn="__imgErr">
        </a>
      </div>
      <div class="cart-item-details">
        <a href="product.html?slug=${encodeURIComponent(item.slug)}" class="cart-item-name">${esc(item.name)}</a>
        ${item.variant ? `<div class="cart-item-variant">${esc(item.variant)}</div>` : ''}
        <div class="cart-item-price">${formatPrice(item.price)}</div>
        <div class="cart-item-controls">
          <div class="qty-stepper">
            <button class="qty-btn" data-action="minus" data-key="${esc(item.key)}"><i class="fa-solid fa-minus"></i></button>
            <input class="qty-input" type="number" value="${item.qty}" min="1" max="${item.stock}" data-key="${esc(item.key)}">
            <button class="qty-btn" data-action="plus" data-key="${esc(item.key)}"><i class="fa-solid fa-plus"></i></button>
          </div>
          <button class="cart-item-remove" data-key="${esc(item.key)}"><i class="fa-solid fa-trash"></i> Remove</button>
        </div>
      </div>
      <div class="cart-item-subtotal">${formatPrice(item.price * item.qty)}</div>
    </div>
  `).join('');

  // Events
  container.querySelectorAll('.qty-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.key;
      const item = getCart().find(i => i.key === key);
      if (!item) return;
      const delta = btn.dataset.action === 'plus' ? 1 : -1;
      updateQty(key, item.qty + delta);
      renderCartItems(container);
      renderCartSummary();
    });
  });

  container.querySelectorAll('.qty-input').forEach(input => {
    input.addEventListener('change', () => {
      updateQty(input.dataset.key, parseInt(input.value) || 1);
      renderCartItems(container);
      renderCartSummary();
    });
  });

  container.querySelectorAll('.cart-item-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      removeFromCart(btn.dataset.key);
      renderCartItems(container);
      renderCartSummary();
    });
  });
}

export function renderCartSummary(appliedCoupon = null) {
  const cart = getCart();
  const subtotal = getCartTotal();
  let discount = 0;
  let freeShipping = false;
  if (appliedCoupon) {
    if (appliedCoupon.type === 'percent')  discount = Math.round(subtotal * appliedCoupon.value / 100);
    else if (appliedCoupon.type === 'fixed')    discount = appliedCoupon.value;
    else if (appliedCoupon.type === 'shipping') freeShipping = true;
  }

  // Use getElementById (IDs are document-unique); querySelector('.cart-summary') was fragile
  const subEl  = document.getElementById('summary-subtotal');
  const discEl = document.getElementById('summary-discount');
  const totEl  = document.getElementById('summary-total');
  if (!subEl || !discEl || !totEl) return; // summary elements not present on this page

  subEl.textContent  = formatPrice(subtotal);
  discEl.textContent = freeShipping
    ? 'Free shipping'
    : discount > 0 ? `-${formatPrice(discount)}` : formatPrice(0);
  totEl.textContent  = formatPrice(Math.max(0, subtotal - discount));

  // Show/hide discount row
  const discRow = discEl?.closest('.summary-row');
  if (discRow) discRow.style.display = (discount > 0 || freeShipping) ? '' : 'none';
}

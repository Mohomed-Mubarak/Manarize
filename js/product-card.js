/* ============================================================
   ZENMARKET — PRODUCT CARD  (shared HTML builder)
   ============================================================ */
import { formatPrice, starsHtml } from './utils.js';
import { isWishlisted }           from './cart.js';
import { toWebP }                 from './performance.js';
import { isLoggedIn }             from './auth.js';

// Safe fallback: a reliable external placeholder that never breaks HTML attributes
export const IMG_FALLBACK = 'https://placehold.co/400x400/1e2330/667080?text=No+Image';

/**
 * Build a product card HTML string.
 * @param {Object}  p
 * @param {Object}  [opts]
 * @param {boolean} [opts.showCart=true]
 * @param {boolean} [opts.showActions=true]
 * @param {boolean} [opts.mini=false]
 */
export function productCardHTML(p, opts = {}) {
  const {
    showCart    = true,
    showActions = true,
    mini        = false,
  } = opts;

  const discount = p.comparePrice && p.comparePrice > p.price
    ? Math.round((1 - p.price / p.comparePrice) * 100)
    : 0;
  const wished   = isWishlisted(p.id);
  const imgSrc   = toWebP((p.images && p.images[0]) ? p.images[0] : IMG_FALLBACK, 400, 80);
  const isUsed   = p.badge === 'Used';
  const lowStock = p.stock > 0 && p.stock <= 5;

  // data-err-fn drives the central img-error.js handler — no inline onerror needed
  const onerrorAttr = `data-err-fn="__imgErr"`;

  return `<div class="product-card" data-id="${p.id}">
  <div class="product-card__image">
    <a href="product.html?slug=${encodeURIComponent(esc(p.slug))}">
      <img src="${imgSrc}" alt="${esc(p.name)}" loading="lazy" decoding="async" ${onerrorAttr}>
    </a>
    <div class="product-card__badge">
      ${discount > 0 ? `<span class="badge badge-red">${discount}% OFF</span>` : ''}
      ${p.stock === 0 ? `<span class="badge badge-gray">Out of Stock</span>` : ''}
      ${isUsed ? `<span class="badge badge-used"><i class="fa-solid fa-recycle"></i> Used</span>` : ''}
      ${lowStock && !isUsed ? `<span class="badge badge-amber">Only ${p.stock} left</span>` : ''}
    </div>
    ${showActions ? `<div class="product-card__actions">
      <button class="btn btn-ghost btn-icon wish-btn" data-id="${p.id}" title="Wishlist">
        <i class="${wished ? 'fa-solid' : 'fa-regular'} fa-heart"
           style="color:${wished ? 'var(--clr-error)' : ''}"></i>
      </button>
      <a href="product.html?slug=${encodeURIComponent(esc(p.slug))}" class="btn btn-ghost btn-icon" title="View">
        <i class="fa-regular fa-eye"></i>
      </a>
    </div>` : ''}
  </div>
  <div class="product-card__body">
    <div class="product-card__category">${esc(p.category || '')}</div>
    <a href="product.html?slug=${encodeURIComponent(esc(p.slug))}" class="product-card__name">${esc(p.name)}</a>
    ${!mini ? `<div style="margin-top:.25rem;display:flex;align-items:center;gap:.25rem">
      <span class="stars">${starsHtml(p.rating || 4.5)}</span>
      <span style="font-size:.75rem;color:var(--clr-text-3)">(${p.reviewCount || 0})</span>
    </div>` : ''}
    <div class="product-card__footer">
      <div>
        <span class="product-card__price">${formatPrice(p.price)}</span>
        ${p.comparePrice && p.comparePrice > p.price
          ? `<span class="product-card__compare">${formatPrice(p.comparePrice)}</span>`
          : ''}
      </div>
    </div>
  </div>
  ${showCart && p.stock > 0 ? `<div class="product-card__btns">
    <button class="product-card__cart-btn add-cart-btn" data-id="${p.id}">
      <i class="fa-solid fa-cart-shopping"></i> Add to Cart
    </button>
    <button class="product-card__buy-btn buy-now-btn" data-id="${p.id}" title="Buy Now">
      <i class="fa-solid fa-bolt"></i><span class="buy-label"> Buy Now</span>
    </button>
  </div>` : ''}
</div>`;
}

// Register the global onerror handler once.
// Strategy: on first error, strip Supabase transform params and retry
// with the plain object URL. Only fall back to the placeholder on the
// second consecutive failure, preventing the transform API from hiding
// images on free-tier projects or misconfigured buckets.
if (typeof window !== 'undefined' && !window.__imgErr) {
  window.__imgErr = function(img) {
    img.onerror = null; // prevent infinite loop

    const src = img.src || '';
    // If this was a Supabase render/image URL, retry with the plain object URL
    if (src.includes('supabase.co/storage/v1/render/image/')) {
      const plainUrl = src
        .replace('/storage/v1/render/image/public/', '/storage/v1/object/public/')
        .replace(/[?&](width|quality|format)=[^&]*/g, '')
        .replace(/^&/, '?');
      img.onerror = function() {
        img.onerror = null;
        img.src = IMG_FALLBACK;
        img.style.opacity = '0.4';
      };
      img.src = plainUrl.replace(/\?$/, '');
      return;
    }

    img.src = IMG_FALLBACK;
    img.style.opacity = '0.4';
  };
}

/** Bind wishlist + add-to-cart events on a container. */
export function bindCardEvents(container, allProducts, addToCartFn, toggleWishlistFn) {
  if (!container) return;

  container.addEventListener('click', e => {
    // Add to cart
    const cartBtn = e.target.closest('.add-cart-btn');
    if (cartBtn) {
      e.preventDefault();
      const p = allProducts.find(x => x.id === cartBtn.dataset.id);
      if (p) addToCartFn(p);
      return;
    }
    // Buy Now — add to cart, then route based on auth state
    const buyBtn = e.target.closest('.buy-now-btn');
    if (buyBtn) {
      e.preventDefault();
      const p = allProducts.find(x => x.id === buyBtn.dataset.id);
      if (p) {
        addToCartFn(p);
        if (isLoggedIn()) {
          // Already signed in → go straight to cart
          window.location.href = '/cart';
        } else {
          // Not signed in → preserve cart destination, send to login
          try { sessionStorage.setItem('zm_return_url', '/cart'); } catch { /* ignore */ }
          window.location.href = '/login?next=/cart';
        }
      }
      return;
    }

    // Wishlist
    const wishBtn = e.target.closest('.wish-btn');
    if (wishBtn) {
      const p = allProducts.find(x => x.id === wishBtn.dataset.id);
      if (!p) return;
      const added = toggleWishlistFn(p);
      const icon  = wishBtn.querySelector('i');
      if (icon) {
        icon.className = `${added ? 'fa-solid' : 'fa-regular'} fa-heart`;
        icon.style.color = added ? 'var(--clr-error)' : '';
      }
    }
  });
}

// ── Helper ────────────────────────────────────────────────────
function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Returns HTML for a single skeleton product card.
 * Render N of these while products are loading, then replace with real cards.
 */
export function skeletonCardHTML() {
  return `<div class="product-card product-card--skeleton">
  <div class="skel-img skeleton"></div>
  <div class="skel-body">
    <div class="skel-tag  skeleton"></div>
    <div class="skel-name skeleton"></div>
    <div class="skel-name2 skeleton"></div>
    <div class="skel-stars skeleton"></div>
    <div class="skel-price skeleton"></div>
    <div class="skel-btn  skeleton"></div>
  </div>
</div>`;
}

/**
 * Wrap an <img> in a skeleton container that fades out once loaded.
 * Usage: container.innerHTML = skeletonImg(src, alt, 'aspect-ratio:1/1');
 */
export function skeletonImg(src, alt = '', style = '') {
  return `<div class="img-skeleton-wrap" style="${style}">
  <img src="${src}" alt="${alt}" loading="lazy" decoding="async"
       data-err-fn="__imgErr" data-skeleton>
</div>`;
}

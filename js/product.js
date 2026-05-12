/* ============================================================
   ZENMARKET — PRODUCT PAGE
   ============================================================ */
import { withLoader } from './loader.js';
import { injectLayout } from './layout.js';
import { getProducts } from './store-adapter.js';
import { formatPrice, starsHtml, getParam, copyText } from './utils.js';
import { addToCart, toggleWishlist, isWishlisted } from './cart.js';
import { productCardHTML, bindCardEvents, skeletonImg } from './product-card.js';
import { toWebP } from './performance.js';
import toast from './toast.js';
import { getSession } from './auth.js';
import {
  getProductReviews, getReviewStats,
  hasPurchased, canReview, hasReviewed, canEdit, getUserReview,
  addReview, editReview,
} from './reviews.js';

let product = null;
let selectedVariants = {};
let qty = 1;

withLoader(async () => {
  await injectLayout({});
  const slug = getParam('slug') || getParam('id');
  const products = await getProducts().catch(()=>[]);

  product = products.find(p => p.slug === slug || p.id === slug);

  if (!product) {
    document.getElementById('product-name').textContent = 'Product not found';
    return;
  }

  renderProduct(product);
  renderRelated(product, products);
  initTabs();
  await initReviews(product);

  // Deferred re-render: ensures reviews list is populated even if a silent
  // error interrupted the first render pass inside withLoader try/catch
  setTimeout(async () => { if (product) { await renderReviewSummary(product); await renderReviewsList(product); } }, 0);

  // Live review count in tab label
  const liveCount = (await getProductReviews(product.id)).length;
  const rcEl = document.getElementById('review-count');
  if (rcEl) rcEl.textContent = liveCount || product.reviewCount || 0;

  // ── Auto-open Reviews tab when ?review=1 is in URL ────────
  // Used by the "Write a Review" button on the profile/orders page.
  if (getParam('review') === '1') {
    // Activate the reviews tab button + panel
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    const reviewTabBtn = document.querySelector('.tab-btn[data-tab="reviews"]');
    if (reviewTabBtn) reviewTabBtn.classList.add('active');
    document.getElementById('tab-reviews')?.classList.add('active');

    // Smooth-scroll to review form after a brief paint delay
    setTimeout(() => {
      const target = document.getElementById('review-form-area') ||
                     document.getElementById('tab-reviews');
      if (target) {
        const top = target.getBoundingClientRect().top + window.scrollY - 100;
        window.scrollTo({ top, behavior: 'smooth' });
      }
    }, 350);
  }
});

function renderProduct(p) {
  // Meta — SEO & Open Graph
  const seoTitle = `${p.name} — Buy in Sri Lanka | Manarize`;
  const seoDesc  = (p.description || `Buy ${p.name} online in Sri Lanka. Best price guaranteed.`).slice(0, 160);
  const canonical = `https://manarize.lk/product.html?slug=${p.slug}`;
  const mainImage = p.images?.[0] || '';

  document.title = seoTitle;
  document.getElementById('page-desc')?.setAttribute('content', seoDesc);
  document.getElementById('page-canonical')?.setAttribute('href', canonical);

  // Open Graph tags
  _setMeta('og:title',       seoTitle);
  _setMeta('og:description', seoDesc);
  _setMeta('og:image',       mainImage);
  _setMeta('og:url',         canonical);
  _setMeta('og:type',        'product');
  _setMeta('product:price:amount',   String(p.price));
  _setMeta('product:price:currency', 'LKR');
  // Twitter card
  _setMeta('twitter:card',        'summary_large_image');
  _setMeta('twitter:title',       seoTitle);
  _setMeta('twitter:description', seoDesc);
  _setMeta('twitter:image',       mainImage);

  // Breadcrumb
  document.getElementById('bc-category').textContent = p.category;
  document.getElementById('bc-product').textContent  = p.name;
  document.getElementById('bc-category').href = `shop.html?cat=${p.categorySlug}`;

  // Gallery — WebP-optimised images with skeleton loading
  const mainImg = document.getElementById('main-img');
  const thumbs  = document.getElementById('gallery-thumbs');
  if (mainImg && p.images?.length) {
    const wrap = mainImg.closest('.img-skeleton-wrap') || mainImg.parentElement;
    // If already wrapped, update src; else inject skeleton wrapper
    if (mainImg.closest('.img-skeleton-wrap')) {
      mainImg.src = toWebP(p.images[0], 700, 85);
      mainImg.alt = p.name;
      mainImg.onerror = () => { if (window.__imgErr) window.__imgErr(mainImg); };
      if (mainImg.complete && mainImg.naturalWidth) wrap.classList.add('loaded');
      else mainImg.addEventListener('load', () => wrap.classList.add('loaded'), { once: true });
    } else {
      // Inject skeleton wrapper around existing img
      const skWrap = document.createElement('div');
      skWrap.className = 'img-skeleton-wrap';
      skWrap.style.cssText = mainImg.style.cssText;
      mainImg.parentElement.insertBefore(skWrap, mainImg);
      skWrap.appendChild(mainImg);
      mainImg.src = toWebP(p.images[0], 700, 85);
      mainImg.alt = p.name;
      mainImg.onerror = () => { if (window.__imgErr) window.__imgErr(mainImg); skWrap.classList.add('loaded'); };
      mainImg.addEventListener('load', () => skWrap.classList.add('loaded'), { once: true });
    }
  }
  if (thumbs && p.images?.length) {
    thumbs.innerHTML = p.images.map((img, i) => `
      <div class="gallery-thumb ${i===0?'active':''}" data-src="${toWebP(img, 700, 85)}">
        <img src="${toWebP(img, 100, 70)}" alt="${p.name} ${i+1}" loading="lazy" decoding="async">
      </div>`).join('');
    thumbs.querySelectorAll('img').forEach(img => {
      img.addEventListener('error', function() { if (window.__imgErr) window.__imgErr(this); });
    });
    thumbs.querySelectorAll('.gallery-thumb').forEach(t => {
      t.addEventListener('click', () => {
        const wrap = mainImg.closest('.img-skeleton-wrap');
        if (wrap) wrap.classList.remove('loaded');
        mainImg.src = t.dataset.src;
        if (wrap) mainImg.addEventListener('load', () => wrap.classList.add('loaded'), { once: true });
        thumbs.querySelectorAll('.gallery-thumb').forEach(x => x.classList.remove('active'));
        t.classList.add('active');
      });
    });
  }

  // Info
  document.getElementById('product-name').textContent     = p.name;
  document.getElementById('product-category').textContent = p.category;
  document.getElementById('product-price').textContent    = formatPrice(p.price);
  document.getElementById('product-stars').innerHTML      = starsHtml(p.rating || 4.5);
  document.getElementById('product-reviews').textContent  = `${p.reviewCount || 0} reviews`;
  document.getElementById('product-sku').textContent      = p.sku || p.id;
  document.getElementById('meta-category').textContent    = p.category;
  document.getElementById('product-weight').textContent   = p.weight || '—';
  document.getElementById('product-tags').textContent     = (p.tags || []).join(', ') || '—';
  document.getElementById('review-count').textContent     = p.reviewCount || 0;
  document.getElementById('desc-content').textContent     = p.description || 'No description available.';

  // Compare price
  if (p.comparePrice) {
    const diff = Math.round((1 - p.price / p.comparePrice) * 100);
    document.getElementById('product-compare').textContent = formatPrice(p.comparePrice);
    document.getElementById('product-compare').classList.remove('hidden');
    document.getElementById('product-save').textContent = `Save ${diff}%`;
    document.getElementById('product-save').classList.remove('hidden');
  }

  // Stock
  const stockEl   = document.getElementById('product-stock');
  const stockText = document.getElementById('stock-text');
  if (stockEl) {
    if (p.stock === 0) {
      stockEl.innerHTML = `<span class="stock-dot out-of-stock"></span><span style="color:var(--clr-error)">Out of Stock</span>`;
      document.getElementById('add-to-cart-btn').disabled = true;
      document.getElementById('add-to-cart-btn').textContent = 'Out of Stock';
      const buyNowBtn = document.getElementById('buy-now-btn');
      if (buyNowBtn) { buyNowBtn.disabled = true; buyNowBtn.innerHTML = '<i class="fa-solid fa-ban"></i> Unavailable'; }
    } else if (p.stock <= 10) {
      stockEl.innerHTML = `<span class="stock-dot low-stock"></span><span style="color:var(--clr-warning)">Low Stock</span>`;
      if (stockText) stockText.textContent = `Only ${p.stock} left`;
    } else {
      stockEl.innerHTML = `<span class="stock-dot in-stock"></span><span style="color:var(--clr-success)">In Stock</span>`;
    }
  }

  // Variants
  const varContainer = document.getElementById('variants-container');
  if (varContainer && p.variants?.length) {
    varContainer.innerHTML = p.variants.map(v => `
      <div style="margin-bottom:1rem">
        <div class="variant-label">${v.name}</div>
        <div class="variant-options">
          ${v.options.map((opt, i) => `
            <button class="variant-opt${i===0?' active':''}" data-group="${v.name}" data-val="${opt}">${opt}</button>`).join('')}
        </div>
      </div>`).join('');

    // Init first option selected
    p.variants.forEach(v => { selectedVariants[v.name] = v.options[0]; });

    varContainer.querySelectorAll('.variant-opt').forEach(btn => {
      btn.addEventListener('click', () => {
        const group = btn.dataset.group;
        varContainer.querySelectorAll(`.variant-opt[data-group="${group}"]`)
          .forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedVariants[group] = btn.dataset.val;
      });
    });
  }

  // Qty stepper
  const qtyInput = document.getElementById('qty-input');
  document.getElementById('qty-minus')?.addEventListener('click', () => {
    qty = Math.max(1, qty - 1);
    qtyInput.value = qty;
  });
  document.getElementById('qty-plus')?.addEventListener('click', () => {
    qty = Math.min(p.stock || 99, qty + 1);
    qtyInput.value = qty;
  });
  qtyInput?.addEventListener('input', () => {
    qty = Math.max(1, Math.min(parseInt(qtyInput.value) || 1, p.stock || 99));
    qtyInput.value = qty;
  });

  // Add to cart
  document.getElementById('add-to-cart-btn')?.addEventListener('click', () => {
    const varStr = Object.entries(selectedVariants).map(([k,v]) => `${k}: ${v}`).join(', ');
    addToCart(p, qty, varStr);
  });

  // Buy Now — add to cart, then go to cart page (login first if not authenticated)
  document.getElementById('buy-now-btn')?.addEventListener('click', () => {
    const varStr = Object.entries(selectedVariants).map(([k,v]) => `${k}: ${v}`).join(', ');
    addToCart(p, qty, varStr);
    const session = getSession();
    if (session) {
      // Already logged in → straight to cart
      window.location.href = '/cart';
    } else {
      // Not logged in → save cart destination, send to login
      try { sessionStorage.setItem('zm_return_url', '/cart'); } catch { /* ignore */ }
      window.location.href = '/login?next=/cart';
    }
  });

  // Wishlist
  const wishBtn = document.getElementById('wishlist-btn');
  const updateWishBtn = () => {
    if (!wishBtn) return;
    const w = isWishlisted(p.id);
    wishBtn.innerHTML = w
      ? '<i class="fa-solid fa-heart" style="color:var(--clr-error)"></i>'
      : '<i class="fa-regular fa-heart"></i>';
  };
  updateWishBtn();
  wishBtn?.addEventListener('click', () => {
    toggleWishlist(p);
    updateWishBtn();
  });

  // Share
  const url = encodeURIComponent(window.location.href);
  const name = encodeURIComponent(p.name);
  document.getElementById('share-wa').href = `https://wa.me/?text=${name}%20${url}`;
  document.getElementById('share-fb').href = `https://facebook.com/sharer/sharer.php?u=${url}`;
  document.getElementById('copy-link-btn')?.addEventListener('click', async () => {
    await copyText(window.location.href);
    toast.success('Copied!', 'Link copied to clipboard');
  });

  // JSON-LD — Product schema (enhanced)
  const ld = document.createElement('script');
  ld.type = 'application/ld+json';
  ld.text = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    description: p.description || '',
    image: p.images || [],
    sku: p.sku || p.id,
    brand: { '@type': 'Brand', name: 'Manarize' },
    offers: {
      '@type': 'Offer',
      url: `https://manarize.lk/product.html?slug=${p.slug}`,
      price: p.price,
      priceCurrency: 'LKR',
      priceValidUntil: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
      availability: p.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      seller: { '@type': 'Organization', name: 'Manarize', url: 'https://manarize.lk' },
    },
    ...(p.reviewCount ? {
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: p.rating || 4.5,
        reviewCount: p.reviewCount,
        bestRating: 5,
      },
    } : {}),
  });
  document.head.appendChild(ld);

  // JSON-LD — BreadcrumbList
  const bcLd = document.createElement('script');
  bcLd.type = 'application/ld+json';
  bcLd.text = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home',     item: 'https://manarize.lk/' },
      { '@type': 'ListItem', position: 2, name: 'Shop',     item: 'https://manarize.lk/shop.html' },
      { '@type': 'ListItem', position: 3, name: p.category, item: `https://manarize.lk/shop.html?cat=${p.categorySlug}` },
      { '@type': 'ListItem', position: 4, name: p.name,     item: `https://manarize.lk/product.html?slug=${p.slug}` },
    ],
  });
  document.head.appendChild(bcLd);
}

function renderRelated(current, all) {
  // AI-style recommendation: same category first, then by shared tags, limit 4
  const sameCat = all.filter(p =>
    p.id !== current.id &&
    p.categorySlug === current.categorySlug &&
    p.active !== false
  );

  const byTags = all.filter(p =>
    p.id !== current.id &&
    p.categorySlug !== current.categorySlug &&
    p.active !== false &&
    (p.tags || []).some(t => (current.tags || []).includes(t))
  );

  // Merge: category matches first, fill remainder with tag matches
  const seen = new Set();
  const related = [];
  for (const p of [...sameCat, ...byTags]) {
    if (related.length >= 4) break;
    if (!seen.has(p.id)) { seen.add(p.id); related.push(p); }
  }

  const grid = document.getElementById('related-products');
  if (!grid) return;
  if (!related.length) {
    grid.innerHTML = '<p style="color:var(--clr-text-3)">No related products found.</p>';
    return;
  }
  grid.innerHTML = related.map(p => productCardHTML(p, { mini: true })).join('');
  bindCardEvents(grid, all, addToCart, toggleWishlist);
}

// ── Meta tag helper (create or update) ───────────────────────
function _setMeta(name, content) {
  if (!content) return;
  const prop = name.startsWith('og:') || name.startsWith('product:') ? 'property' : 'name';
  let el = document.querySelector(`meta[${prop}="${name}"]`);
  if (!el) { el = document.createElement('meta'); el.setAttribute(prop, name); document.head.appendChild(el); }
  el.setAttribute('content', content);
}

function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const target = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${target}`)?.classList.add('active');
      // Re-render reviews every time the reviews tab is activated
      // so the list is always fresh and any earlier render error is recovered
      if (target === 'reviews' && product) {
        await renderReviewSummary(product);
        await renderReviewsList(product);
        await renderReviewFormArea(product);
      }
    });
  });
}

// ── Reviews ───────────────────────────────────────────────────

async function initReviews(p) {
  await renderReviewSummary(p);
  await renderReviewsList(p);
  await renderReviewFormArea(p);
}

/** Big average + breakdown bars */
async function renderReviewSummary(p) {
  const el = document.getElementById('review-summary');
  if (!el) return;
  const stats = await getReviewStats(p.id);

  // Merge live review data with the product's built-in counters for display
  const count = stats.count || 0;
  const avg   = stats.count ? stats.avg : 0;

  el.innerHTML = `
    <div style="text-align:center;min-width:80px">
      <div style="font-size:3rem;font-weight:700;color:var(--clr-text-1);line-height:1">${avg || '—'}</div>
      <div class="stars" style="margin:.25rem 0">${starsHtml(avg || 0)}</div>
      <div style="font-size:.75rem;color:var(--clr-text-3)">${count} review${count !== 1 ? 's' : ''}</div>
    </div>
    <div style="flex:1;min-width:160px">
      ${[5,4,3,2,1].map(star => {
        const n   = stats.breakdown[star] || 0;
        const pct = count ? Math.round(n / count * 100) : 0;
        return `
          <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.3rem">
            <span style="font-size:.75rem;color:var(--clr-text-3);width:10px">${star}</span>
            <i class="fa-solid fa-star" style="color:var(--clr-gold);font-size:.65rem"></i>
            <div style="flex:1;height:6px;background:var(--clr-border);border-radius:3px;overflow:hidden">
              <div style="width:${pct}%;height:100%;background:var(--clr-gold);border-radius:3px"></div>
            </div>
            <span style="font-size:.75rem;color:var(--clr-text-3);width:24px;text-align:right">${n}</span>
          </div>`;
      }).join('')}
    </div>`;
}

/** Write / edit form area */
async function renderReviewFormArea(p) {
  const area = document.getElementById('review-form-area');
  if (!area) return;

  const user = getSession();

  // ── Not logged in → read-only notice ──────────────────────
  if (!user) {
    area.innerHTML = `
      <div style="padding:.875rem 1.25rem;background:var(--clr-surface-2);border-radius:8px;border:1px dashed var(--clr-border);text-align:center">
        <p style="color:var(--clr-text-3);font-size:.875rem;margin:0">
          <i class="fa-regular fa-pen-to-square" style="margin-right:.4rem;color:var(--clr-gold)"></i>
          Want to share your experience?
          <a href="/login" style="color:var(--clr-gold);font-weight:600;margin-left:.25rem">Sign in to write a review</a>
        </p>
      </div>`;
    return;
  }

  const existing      = await getUserReview(user.id, p.id);
  const alreadyEdited = existing && existing.editedAt;
  const purchased     = await canReview(user.id, p.id);

  // ── Logged in but has NOT received this product → read-only notice ──
  if (!purchased && !existing) {
    area.innerHTML = `
      <div style="padding:.875rem 1.25rem;background:var(--clr-surface-2);border-radius:var(--radius-md);border:1px dashed var(--clr-border);text-align:center">
        <p style="color:var(--clr-text-3);font-size:.875rem;margin:0 0 .5rem">
          <i class="fa-solid fa-truck" style="margin-right:.4rem;color:var(--clr-gold)"></i>
          Only customers with a <strong>delivered order</strong> for this product can write a review.
        </p>
        <a href="/cart" style="display:inline-flex;align-items:center;gap:.4rem;font-size:.8rem;font-weight:600;color:var(--clr-gold);text-decoration:none;padding:.4rem .85rem;border:1px solid var(--clr-gold);border-radius:999px;margin-top:.15rem;transition:background .2s" onmouseover="this.style.background='rgba(201,168,76,.1)'" onmouseout="this.style.background='transparent'">
          <i class="fa-solid fa-bag-shopping"></i> Buy this product first
        </a>
      </div>`;
    return;
  }

  // ── Already reviewed AND already edited → read-only ──────
  if (existing && alreadyEdited) {
    const statusMsg = existing.approved
      ? '<i class="fa-solid fa-circle-check" style="color:var(--clr-success,#22c55e);margin-right:.4rem"></i> Your review is approved and visible on this product.'
      : existing.rejected
        ? '<i class="fa-solid fa-circle-xmark" style="color:var(--clr-error,#ef4444);margin-right:.4rem"></i> Your review was not approved. Your one-time edit has been used.'
        : '<i class="fa-solid fa-clock" style="color:var(--clr-warning,#f59e0b);margin-right:.4rem"></i> Your edited review is pending admin approval.';
    area.innerHTML = `
      <div style="padding:1.25rem;background:var(--clr-surface-2);border-radius:var(--radius-md);border:1px dashed var(--clr-border)">
        <p style="color:var(--clr-text-3);font-size:.85rem;margin:0">${statusMsg}</p>
      </div>`;
    return;
  }

  // ── Already reviewed, NOT yet edited → show current status + edit option ──
  if (existing && !alreadyEdited) {
    if (existing.approved) {
      // Approved: show form to edit (one time)
    } else if (existing.rejected) {
      area.innerHTML = `
        <div style="padding:1.25rem;background:var(--clr-surface-2);border-radius:var(--radius-md);border:1px dashed var(--clr-border)">
          <p style="color:var(--clr-text-3);font-size:.85rem;margin:0 0 .75rem">
            <i class="fa-solid fa-circle-xmark" style="color:var(--clr-error,#ef4444);margin-right:.4rem"></i>
            Your review was not approved. You may edit and resubmit once.
          </p>
        </div>`;
      // Fall through to show edit form below
    } else {
      // Pending: allow edit while waiting
      area.innerHTML = `
        <div style="padding:.75rem 1rem;background:rgba(245,158,11,.07);border-radius:var(--radius-md);border:1px solid rgba(245,158,11,.25);margin-bottom:1rem">
          <p style="color:var(--clr-warning,#f59e0b);font-size:.8125rem;margin:0">
            <i class="fa-solid fa-clock" style="margin-right:.4rem"></i>
            Your review is pending admin approval. You may edit it once before it goes live.
          </p>
        </div>`;
    }
  }

  const isEdit   = !!existing;
  const verified = await hasPurchased(user.id, p.id);
  const formId   = 'zm-review-form';
  const verifiedBadge = verified
    ? '<span style="font-size:.75rem;color:var(--clr-success,#22c55e);font-weight:400">✓ Verified Purchase</span>'
    : '<span style="font-size:.75rem;color:var(--clr-text-3);font-weight:400">Unverified</span>';
  const title    = isEdit ? `Edit Your Review <span style="font-size:.75rem;color:var(--clr-warning,#f59e0b);font-weight:400">(1 edit allowed)</span>` : `Write a Review ${verifiedBadge}`;

  area.innerHTML = `
    <div style="padding:1.5rem;background:var(--clr-surface-2,#f9f9f9);border-radius:var(--radius-md);border:1px solid var(--clr-border)">
      <h4 style="margin-bottom:1rem;font-family:var(--ff-body);font-size:1rem">${title}</h4>

      <form id="${formId}" novalidate>
        <!-- Star picker -->
        <div style="margin-bottom:1rem">
          <label style="font-size:.8rem;color:var(--clr-text-3);display:block;margin-bottom:.4rem">Rating *</label>
          <div id="star-picker" style="display:flex;gap:.25rem;cursor:pointer" role="radiogroup" aria-label="Star rating">
            ${[1,2,3,4,5].map(i => `
              <span data-val="${i}" role="radio" aria-label="${i} star${i>1?'s':''}"
                style="font-size:1.6rem;color:${existing && existing.rating >= i ? 'var(--clr-gold)' : 'var(--clr-border)'};transition:color .15s"
                aria-checked="${existing && existing.rating === i}">&#9733;</span>`).join('')}
          </div>
          <input type="hidden" id="review-rating" value="${existing ? existing.rating : ''}">
        </div>

        <!-- Title -->
        <div style="margin-bottom:.75rem">
          <label for="review-title" style="font-size:.8rem;color:var(--clr-text-3);display:block;margin-bottom:.3rem">Title (optional)</label>
          <input id="review-title" type="text" maxlength="80" placeholder="Summarise your experience"
            value="${existing ? _esc(existing.title) : ''}"
            style="width:100%;padding:.6rem .875rem;border:1px solid var(--clr-border);border-radius:var(--radius-sm);font-size:.9rem;background:var(--clr-surface);color:var(--clr-text-1);outline:none">
        </div>

        <!-- Body -->
        <div style="margin-bottom:1rem">
          <label for="review-text" style="font-size:.8rem;color:var(--clr-text-3);display:block;margin-bottom:.3rem">Review * <span id="char-count" style="float:right"></span></label>
          <textarea id="review-text" rows="4" maxlength="1000" placeholder="Share your thoughts about this product (min 10 characters)…"
            style="width:100%;padding:.6rem .875rem;border:1px solid var(--clr-border);border-radius:var(--radius-sm);font-size:.9rem;resize:vertical;background:var(--clr-surface);color:var(--clr-text-1);outline:none;font-family:inherit">${existing ? _esc(existing.text) : ''}</textarea>
        </div>

        <div style="display:flex;align-items:center;gap:1rem;flex-wrap:wrap">
          <button type="submit" class="btn btn-primary" style="padding:.65rem 1.75rem;font-size:.9rem">
            ${isEdit ? '<i class="fa-solid fa-pen"></i> Save Edit' : '<i class="fa-solid fa-paper-plane"></i> Submit Review'}
          </button>
          <span id="review-form-error" style="color:var(--clr-error,#ef4444);font-size:.8rem"></span>
        </div>
      </form>
    </div>`;

  // ── Star picker interaction ────────────────────────────────
  let selectedRating = existing ? existing.rating : 0;
  const ratingInput  = document.getElementById('review-rating');
  const stars        = document.querySelectorAll('#star-picker span');

  function paintStars(hovered) {
    const val = hovered || selectedRating;
    stars.forEach(s => {
      s.style.color = +s.dataset.val <= val ? 'var(--clr-gold)' : 'var(--clr-border)';
    });
  }

  stars.forEach(s => {
    s.addEventListener('mouseenter', () => paintStars(+s.dataset.val));
    s.addEventListener('mouseleave', () => paintStars(0));
    s.addEventListener('click', () => {
      selectedRating   = +s.dataset.val;
      ratingInput.value = selectedRating;
      paintStars(0);
    });
  });
  paintStars(0);

  // ── Char counter ──────────────────────────────────────────
  const textarea  = document.getElementById('review-text');
  const charCount = document.getElementById('char-count');
  if (textarea && charCount) {
    const updateCC = () => { charCount.textContent = `${textarea.value.length}/1000`; };
    textarea.addEventListener('input', updateCC);
    updateCC();
  }

  // ── Form submit ───────────────────────────────────────────
  document.getElementById(formId)?.addEventListener('submit', async e => {
    e.preventDefault();
    const errEl = document.getElementById('review-form-error');
    if (!errEl) return;
    errEl.textContent = '';

    const rating = +ratingInput.value;
    const title  = document.getElementById('review-title')?.value || '';
    const text   = textarea?.value || '';

    const result = isEdit
      ? await editReview({ productId: p.id, userId: user.id, rating, title, text })
      : await addReview({ productId: p.id, userId: user.id, userName: user.name, rating, title, text });

    if (!result.success) {
      errEl.textContent = result.error;
      return;
    }

    toast.success('Review submitted!', isEdit
      ? 'Your updated review is pending admin approval and will appear once approved.'
      : 'Your review has been submitted! It will appear here once approved by our team.');
    // Re-render everything
    await renderReviewSummary(p);
    await renderReviewFormArea(p);
    await renderReviewsList(p);
    // Update tab counter
    const reviewCount = document.getElementById('review-count');
    if (reviewCount) reviewCount.textContent = (await getProductReviews(p.id)).length;
  });
}


/** Render a single review card HTML */
function reviewCardHTML(r, index = 0) {
  const initials = (r.userName || '?').split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
  const dateStr  = new Date(r.createdAt).toLocaleDateString('en-LK', { year:'numeric', month:'short', day:'numeric' });
  const editNote = r.editedAt ? `<span style="font-size:.7rem;color:var(--clr-text-3);margin-left:.4rem">(edited)</span>` : '';

  const avatarPalette = [
    ['rgba(201,168,76,.18)','var(--clr-gold,#f59e0b)'],
    ['rgba(59,130,246,.15)','#3b82f6'],
    ['rgba(34,197,94,.15)','#16a34a'],
    ['rgba(168,85,247,.15)','#a855f7'],
    ['rgba(234,88,12,.15)','#ea580c'],
    ['rgba(236,72,153,.15)','#ec4899'],
  ];
  const avatarIdx = (r.userId || r.userName || '').split('').reduce((s,c)=>s+c.charCodeAt(0),0) % avatarPalette.length;
  const [avatarBg, avatarClr] = avatarPalette[avatarIdx];

  const starsSvg = [1,2,3,4,5].map(i=>`
    <svg width="15" height="15" viewBox="0 0 20 20" fill="${i<=r.rating?'var(--clr-gold,#f59e0b)':'rgba(255,255,255,.12)'}">
      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
    </svg>`).join('');

  const ratingLabel = ['','Terrible','Poor','Average','Good','Excellent'][r.rating] || '';

  return `
    <div class="zm-rv-card" style="
      padding:1.5rem;
      background:var(--clr-surface);
      border:1px solid var(--clr-border);
      border-radius:16px;
      transition:border-color .25s,box-shadow .25s,transform .25s;
      position:relative;
      overflow:hidden;
    " data-rv-hover="1">

      <!-- Top accent bar for first/featured review -->
      ${index === 0 ? `<div style="position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,var(--clr-gold),rgba(201,168,76,.2))"></div>` : ''}

      <!-- Header row: avatar + name + stars -->
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;margin-bottom:1rem;flex-wrap:wrap">

        <!-- Left: avatar + name + verified -->
        <div style="display:flex;align-items:center;gap:.875rem">
          <div style="
            width:46px;height:46px;border-radius:50%;flex-shrink:0;
            background:${avatarBg};
            border:2px solid ${avatarClr}44;
            display:flex;align-items:center;justify-content:center;
            font-weight:800;font-size:.9rem;color:${avatarClr};
            letter-spacing:.03em;font-family:var(--ff-heading,sans-serif);
          ">${initials}</div>
          <div>
            <div style="font-weight:700;font-size:.9375rem;color:var(--clr-text);line-height:1.25;margin-bottom:.2rem">${_esc(r.userName)}</div>
            ${r.verified
              ? `<span style="display:inline-flex;align-items:center;gap:.25rem;font-size:.7rem;font-weight:600;color:var(--clr-success,#22c55e);background:rgba(34,197,94,.1);padding:.15rem .5rem;border-radius:999px">
                   <i class="fa-solid fa-circle-check" style="font-size:.6rem"></i>Verified Purchase
                 </span>`
              : `<span style="display:inline-flex;align-items:center;gap:.25rem;font-size:.7rem;color:var(--clr-text-3)">
                   <i class="fa-regular fa-user" style="font-size:.6rem"></i>Unverified
                 </span>`}
          </div>
        </div>

        <!-- Right: stars + rating label + date -->
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:.3rem">
          <div style="display:flex;align-items:center;gap:3px">${starsSvg}</div>
          <div style="font-size:.72rem;font-weight:600;color:var(--clr-gold)">${ratingLabel}</div>
          <div style="font-size:.7rem;color:var(--clr-text-3)">${dateStr}${editNote}</div>
        </div>
      </div>

      <!-- Review title -->
      ${r.title ? `<div style="font-weight:700;font-size:.9375rem;color:var(--clr-text);margin-bottom:.5rem;line-height:1.4">${_esc(r.title)}</div>` : ''}

      <!-- Review body -->
      <p style="color:var(--clr-text-2);font-size:.875rem;line-height:1.85;margin:0;padding-top:${r.title ? '0' : '.1rem'}">${_esc(r.text)}</p>
    </div>`;
}

const REVIEWS_INITIAL = 3;

/** Reviews list: first 3 visible, rest behind "More Reviews" button */
async function renderReviewsList(p) {
  const list = document.getElementById('reviews-list');
  if (!list) return;

  const reviews = await getProductReviews(p.id);

  if (!reviews.length) {
    list.innerHTML = `
      <div style="padding:3rem 1rem;text-align:center;border:1px dashed var(--clr-border);border-radius:16px;margin-top:.5rem">
        <div style="width:56px;height:56px;border-radius:50%;background:rgba(201,168,76,.08);display:inline-flex;align-items:center;justify-content:center;margin-bottom:1rem">
          <i class="fa-regular fa-comment-dots" style="font-size:1.5rem;color:var(--clr-gold)"></i>
        </div>
        <p style="color:var(--clr-text);font-size:.9375rem;margin:0 0 .4rem;font-weight:600">No reviews yet</p>
        <p style="color:var(--clr-text-3);font-size:.825rem;margin:0;opacity:.8">Be the first to share your experience with this product!</p>
      </div>`;
    return;
  }

  const visible = reviews.slice(0, REVIEWS_INITIAL);
  const hidden  = reviews.slice(REVIEWS_INITIAL);
  const hasMore = hidden.length > 0;

  list.innerHTML = `
    <!-- Section header -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem;padding-bottom:.875rem;border-bottom:1px solid var(--clr-border)">
      <div style="display:flex;align-items:center;gap:.625rem">
        <div style="width:32px;height:32px;border-radius:8px;background:rgba(201,168,76,.12);display:flex;align-items:center;justify-content:center">
          <i class="fa-solid fa-users" style="color:var(--clr-gold);font-size:.8rem"></i>
        </div>
        <div>
          <div style="font-weight:700;font-size:1rem;color:var(--clr-text);line-height:1.2">Customer Reviews</div>
          <div style="font-size:.72rem;color:var(--clr-text-3);margin-top:.1rem">${reviews.length} verified review${reviews.length !== 1 ? 's' : ''}</div>
        </div>
      </div>
      <span style="font-size:.72rem;color:var(--clr-text-3);display:flex;align-items:center;gap:.3rem">
        <i class="fa-solid fa-clock" style="font-size:.65rem"></i>Most recent
      </span>
    </div>

    <!-- Visible reviews (first 3) -->
    <div id="reviews-visible" style="display:flex;flex-direction:column;gap:.875rem">
      ${visible.map((r, i) => reviewCardHTML(r, i)).join('')}
    </div>

    ${hasMore ? `
      <!-- Hidden reviews (revealed on click) -->
      <div id="reviews-hidden" style="display:none;flex-direction:column;gap:.875rem;margin-top:.875rem">
        ${hidden.map((r, i) => reviewCardHTML(r, i + REVIEWS_INITIAL)).join('')}
      </div>

      <!-- Toggle button -->
      <div style="margin-top:1.75rem;text-align:center">
        <button id="reviews-toggle-btn" data-open="false" style="
          display:inline-flex;align-items:center;gap:.625rem;
          padding:.75rem 2.25rem;border-radius:999px;cursor:pointer;
          border:1.5px solid var(--clr-gold,#f59e0b);
          background:transparent;color:var(--clr-gold,#f59e0b);
          font-size:.875rem;font-weight:700;font-family:var(--ff-body);
          transition:background .2s,color .2s,transform .15s;letter-spacing:.03em;
        "
>
          <i class="fa-solid fa-chevron-down" id="rv-toggle-icon" style="font-size:.68rem;transition:transform .25s"></i>
          More Reviews
          <span style="
            background:rgba(201,168,76,.15);padding:.1rem .55rem;border-radius:999px;
            font-size:.75rem;font-weight:700;
          ">${hidden.length}</span>
        </button>
      </div>` : ''}`;

  // Attach hover listeners for review cards (replaces removed inline onmouseenter/onmouseleave)
  list.querySelectorAll('[data-rv-hover]').forEach(card => {
    card.addEventListener('mouseenter', () => {
      card.style.borderColor  = 'rgba(201,168,76,.5)';
      card.style.boxShadow    = '0 6px 28px rgba(0,0,0,.18)';
      card.style.transform    = 'translateY(-1px)';
    });
    card.addEventListener('mouseleave', () => {
      card.style.borderColor  = 'var(--clr-border)';
      card.style.boxShadow    = 'none';
      card.style.transform    = 'translateY(0)';
    });
  });

  if (hasMore) {
    document.getElementById('reviews-toggle-btn')?.addEventListener('click', function () {
      const open     = this.dataset.open === 'true';
      const hiddenEl = document.getElementById('reviews-hidden');
      if (!hiddenEl) return;

      if (open) {
        // Collapse
        hiddenEl.style.display = 'none';
        this.dataset.open = 'false';
        this.innerHTML = `
          <i class="fa-solid fa-chevron-down" id="rv-toggle-icon" style="font-size:.68rem;transition:transform .25s"></i>
          More Reviews
          <span style="background:rgba(201,168,76,.15);padding:.1rem .55rem;border-radius:999px;font-size:.75rem;font-weight:700;">${hidden.length}</span>`;
        list.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        // Expand
        hiddenEl.style.display = 'flex';
        this.dataset.open = 'true';
        this.innerHTML = `
          <i class="fa-solid fa-chevron-up" id="rv-toggle-icon" style="font-size:.68rem"></i>
          Show Fewer Reviews`;
      }
      this.onmouseenter = () => { this.style.background='var(--clr-gold,#f59e0b)'; this.style.color='#0a0a0a'; this.style.transform='scale(1.02)'; };
      this.onmouseleave = () => { this.style.background='transparent'; this.style.color='var(--clr-gold,#f59e0b)'; this.style.transform='scale(1)'; };
    });
  }
}

function _esc(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}


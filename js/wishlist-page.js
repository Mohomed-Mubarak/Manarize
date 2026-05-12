/* ============================================================
   ZENMARKET v20 — WISHLIST PAGE  (fixed + fast)
   Fixes:
     • initLayout → injectLayout  (was crashing the whole module)
     • Added withLoader so the loader is actually dismissed by JS
     • Fixed toast import (default export, not namespace)
     • Fixed toolbar always-visible bug (double display in style attr)
     • Skeleton cards shown instantly before real content renders
     • Cached getProducts() result — one read, shared everywhere
   ============================================================ */
import { withLoader }                        from './loader.js';
import { injectLayout }                      from './layout.js';
import { getWishlist, toggleWishlist, addToCart } from './cart.js';
import { getProducts } from './store-adapter.js';
import { formatPrice }                       from './utils.js';
import toast                                 from './toast.js';
import { confirmModal }                      from './modal.js';

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── State ──────────────────────────────────────────────────────
let currentSort = 'date-desc';
let cachedProducts = [];   // loaded once in withLoader, reused everywhere

// ── Boot ───────────────────────────────────────────────────────
withLoader(async () => {
  await injectLayout({ activePage: '' });

  // Show skeleton cards immediately so the grid is not blank
  showSkeletons();

  // Load product catalogue once (synchronous localStorage read, cached)
  cachedProducts = await getProducts();

  render();
  bindSort();
  bindActions();
});

// ── Skeletons (shown before real cards are ready) ──────────────
function showSkeletons() {
  const grid = document.getElementById('wishlist-grid');
  if (!grid) return;
  let count;
  try { count = JSON.parse(localStorage.getItem('zm_wishlist') || '[]').length; }
  catch { count = 0; }
  if (count === 0) return;
  count = Math.min(count, 8);
  grid.style.display = 'grid';
  grid.innerHTML = Array.from({ length: count }, () => `
    <div class="product-card" aria-hidden="true">
      <div class="product-card__image skeleton" style="aspect-ratio:1;border-radius:var(--r-lg)"></div>
      <div class="product-card__body" style="gap:.5rem;display:flex;flex-direction:column">
        <div class="skeleton" style="height:.75rem;width:50%;border-radius:var(--r-sm)"></div>
        <div class="skeleton" style="height:1rem;width:85%;border-radius:var(--r-sm)"></div>
        <div class="skeleton" style="height:1rem;width:60%;border-radius:var(--r-sm)"></div>
      </div>
    </div>`).join('');
}

// ── Render grid ────────────────────────────────────────────────
function render() {
  const wishlist = getWishlist();

  // Enrich wishlist items with full product data where available
  const items = wishlist.map(w => {
    const full = cachedProducts.find(p => p.id === w.id);
    return full ? { ...w, ...full } : w;
  });

  const sorted   = sortItems([...items], currentSort);

  const grid     = document.getElementById('wishlist-grid');
  const empty    = document.getElementById('wishlist-empty');
  const toolbar  = document.getElementById('wishlist-toolbar');
  const badge    = document.getElementById('wishlist-count-badge');
  const shareBtn = document.getElementById('share-wishlist-btn');
  const clearBtn = document.getElementById('clear-wishlist-btn');

  if (!sorted.length) {
    grid.style.display    = 'none';
    toolbar.style.display = 'none';
    empty.style.display   = 'flex';
    if (badge)    badge.style.display    = 'none';
    if (shareBtn) shareBtn.style.display = 'none';
    if (clearBtn) clearBtn.style.display = 'none';
    return;
  }

  empty.style.display   = 'none';
  grid.style.display    = 'grid';
  toolbar.style.display = 'flex';
  if (badge)    { badge.style.display = 'inline-flex'; badge.textContent = sorted.length; }
  if (shareBtn) shareBtn.style.display = 'inline-flex';
  if (clearBtn) clearBtn.style.display = 'inline-flex';

  grid.innerHTML = sorted.map(item => cardHTML(item)).join('');
  bindCardEvents();
}

// ── Card HTML ──────────────────────────────────────────────────
function cardHTML(item) {
  const img        = item.images?.[0] || item.image || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&q=80';
  const price      = formatPrice(item.price || 0);
  const comparePrice = item.comparePrice ? formatPrice(item.comparePrice) : '';
  const discount   = item.comparePrice && item.comparePrice > item.price
    ? Math.round((1 - item.price / item.comparePrice) * 100) : 0;
  const slug       = item.slug || item.id;
  const stock      = item.stock !== undefined ? item.stock : 10;
  const outOfStock = stock <= 0;

  return `
  <div class="product-card" data-id="${item.id}">
    <div class="product-card__image">
      <a href="product.html?slug=${encodeURIComponent(slug)}">
        <img src="${img}" alt="${esc(item.name)}" loading="lazy" decoding="async">
      </a>
      ${discount > 0 ? `<span class="badge badge-red" style="position:absolute;top:.5rem;left:.5rem">${discount}% OFF</span>` : ''}
      ${outOfStock ? `<div style="position:absolute;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;border-radius:var(--r-lg)"><span style="color:#fff;font-size:var(--fs-sm);font-weight:600;letter-spacing:.06em">OUT OF STOCK</span></div>` : ''}
      <button class="btn-remove-wish" data-id="${item.id}"
        style="position:absolute;top:.5rem;right:.5rem;width:30px;height:30px;border-radius:50%;background:var(--clr-surface);border:1px solid var(--clr-border);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all var(--t-fast);color:var(--clr-error)"
        title="Remove from wishlist" aria-label="Remove from wishlist">
        <i class="fa-solid fa-xmark" style="font-size:.75rem"></i>
      </button>
    </div>
    <div class="product-card__body">
      <div class="product-card__category">${esc(item.category || '')}</div>
      <a href="product.html?slug=${encodeURIComponent(slug)}" class="product-card__name">${esc(item.name)}</a>
      <div class="product-card__footer">
        <div>
          <div class="product-card__price">${price}</div>
          ${comparePrice ? `<div class="product-card__compare" style="text-decoration:line-through;font-size:var(--fs-xs);color:var(--clr-text-3)">${comparePrice}</div>` : ''}
        </div>
        <button class="btn btn-primary btn-sm btn-add-to-cart" data-id="${item.id}"
          ${outOfStock ? 'disabled' : ''}>
          <i class="fa-solid fa-cart-plus"></i>
        </button>
      </div>
    </div>
  </div>`;
}

// ── Bind card events ───────────────────────────────────────────
function bindCardEvents() {
  document.querySelectorAll('.btn-remove-wish').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      const id = btn.dataset.id;
      const p  = cachedProducts.find(x => String(x.id) === String(id));
      if (p) toggleWishlist(p);
      const card = btn.closest('.product-card');
      if (card) {
        card.style.transition = 'opacity .25s ease, transform .25s ease';
        card.style.opacity    = '0';
        card.style.transform  = 'scale(.92)';
        setTimeout(() => render(), 260);
      } else {
        render();
      }
    });
  });

  document.querySelectorAll('.btn-add-to-cart').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      const id = btn.dataset.id;
      const p  = cachedProducts.find(x => String(x.id) === String(id));
      if (!p) return;
      addToCart(p, 1);
      btn.innerHTML = '<i class="fa-solid fa-check"></i>';
      btn.classList.add('btn-success');
      btn.classList.remove('btn-primary');
      setTimeout(() => {
        btn.innerHTML = '<i class="fa-solid fa-cart-plus"></i>';
        btn.classList.remove('btn-success');
        btn.classList.add('btn-primary');
      }, 1500);
    });
  });
}

// ── Sort ───────────────────────────────────────────────────────
function sortItems(items, sort) {
  switch (sort) {
    case 'price-asc':  return items.sort((a, b) => (a.price || 0) - (b.price || 0));
    case 'price-desc': return items.sort((a, b) => (b.price || 0) - (a.price || 0));
    case 'name-asc':   return items.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    default:           return items;   // date-desc = insertion order
  }
}

function bindSort() {
  document.querySelectorAll('#wishlist-sort-chips .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#wishlist-sort-chips .chip')
        .forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      currentSort = chip.dataset.sort;
      render();
    });
  });
}

// ── Header actions ─────────────────────────────────────────────
function bindActions() {
  document.getElementById('clear-wishlist-btn')?.addEventListener('click', () => {
    confirmModal({
      title: 'Clear Wishlist',
      message: 'Remove all items from your wishlist? This cannot be undone.',
      confirmText: 'Clear All',
      cancelText: 'Cancel',
      danger: true,
      onConfirm: () => {
        localStorage.setItem('zm_wishlist', '[]');
        render();
        toast.info('Wishlist', 'Wishlist cleared');
      },
    });
  });

  document.getElementById('share-wishlist-btn')?.addEventListener('click', () => {
    const ids = getWishlist().map(w => w.id).join(',');
    const url = `${window.location.origin}${window.location.pathname}?shared=${encodeURIComponent(ids)}`;
    navigator.clipboard?.writeText(url).then(() => {
      toast.success('Copied!', 'Wishlist link copied to clipboard');
    }).catch(() => {
      toast.info('Share', 'Copy this URL: ' + url);
    });
  });

  // Handle shared wishlist param on load
  const shared = new URLSearchParams(window.location.search).get('shared');
  if (shared) {
    const ids = shared.split(',').map(s => s.trim()).filter(Boolean);
    if (ids.length) {
      const current = getWishlist().map(w => String(w.id));
      let added = 0;
      ids.forEach(id => {
        if (current.includes(String(id))) return;
        const p = cachedProducts.find(x => String(x.id) === String(id));
        if (p) { toggleWishlist(p); added++; }
      });
      if (added) toast.success('Wishlist', `${added} shared item${added > 1 ? 's' : ''} added to your wishlist`);
      window.history.replaceState({}, '', window.location.pathname);
      render();
    }
  }
}

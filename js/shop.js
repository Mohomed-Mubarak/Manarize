/* ============================================================
   ZENMARKET — SHOP PAGE
   ============================================================ */
import { withLoader } from './loader.js';
import { injectLayout } from './layout.js';
import { getProducts, getCategories } from './store-adapter.js';

import { formatPrice, getParam, setParams, debounce } from './utils.js';
import { addToCart, toggleWishlist } from './cart.js';
import { productCardHTML, bindCardEvents, skeletonCardHTML } from './product-card.js';

const PER_PAGE = 12;
let page = 1;
let allProducts  = [];
let allCategories = [];
let filtered    = [];
let activeCat    = '';
let activeSub    = '';   // subcategory slug
let activeBadge     = ''; // 'new' from nav link ?badge=new
let activeCondition = ''; // '' | 'new' | 'used'
let activeSearch = '';
let activeSort  = 'featured';
let maxPrice    = 50000;
let inStockOnly = false;
let activeTags  = new Set();

withLoader(async () => {
  await injectLayout({ activePage: 'Shop' });

  // Show skeleton cards while products load
  const grid = document.getElementById('products-grid');
  if (grid) {
    grid.innerHTML = Array(PER_PAGE).fill(0).map(() => skeletonCardHTML()).join('');
  }

  allProducts = (await getProducts().catch(()=>[])).filter(p => p.active !== false);
  allCategories = await getCategories().catch(()=>[]);

  // Read URL params
  activeCat    = getParam('cat')       || '';
  activeSub    = getParam('sub')       || '';
  activeSearch = getParam('q')         || '';
  activeSort   = getParam('sort')      || 'featured';
  activeBadge  = getParam('badge')     || '';
  // ?condition=used from nav link maps to the condition filter
  const condParam = getParam('condition') || '';
  if (condParam) {
    activeCondition = condParam;
    const radio = document.querySelector(`input[name="condition"][value="${condParam}"]`);
    if (radio) radio.checked = true;
  }

  populateCategoryFilter();
  populateTagFilter();
  applyAndRender();
  bindUI();

  if (activeSearch) {
    const el = document.getElementById('shop-search');
    if (el) el.value = activeSearch;
    updatePageHeader(activeSearch, activeCat);
  }
  if (activeBadge === 'new') {
    updatePageHeader('', '', 'New Arrivals', 'Fresh drops and newly listed products');
  }
  if (condParam === 'used') {
    updatePageHeader('', '', 'Second Hand', 'Pre-owned items in great condition');
  }
  if (activeCat) {
    updatePageHeader(activeSearch, activeCat);
    const radio = document.querySelector(`input[name="cat"][value="${activeCat}"]`);
    if (radio) radio.checked = true;
  }

  // Sort dropdown value
  const sortSel = document.getElementById('sort-select');
  if (sortSel && activeSort) sortSel.value = activeSort;

  // Mobile sidebar — drawer with overlay + scroll lock + swipe-to-close
  const shopSidebar = document.getElementById('shop-sidebar');
  const filterOverlay = document.getElementById('sidebar-overlay');

  function openFilters() {
    shopSidebar?.classList.add('open', 'drawer-open');
    filterOverlay?.classList.add('open', 'visible');
    document.body.style.overflow = 'hidden';
  }
  function closeFilters() {
    shopSidebar?.classList.remove('open', 'drawer-open');
    filterOverlay?.classList.remove('open', 'visible');
    document.body.style.overflow = '';
  }

  document.getElementById('mobile-filter-btn')?.addEventListener('click', openFilters);
  filterOverlay?.addEventListener('click', closeFilters);
  document.getElementById('shop-sidebar-close')?.addEventListener('click', closeFilters);

  // Swipe left to close filter sidebar
  let filterTouchX = 0;
  shopSidebar?.addEventListener('touchstart', e => { filterTouchX = e.touches[0].clientX; }, { passive: true });
  shopSidebar?.addEventListener('touchend', e => {
    if (e.changedTouches[0].clientX - filterTouchX < -60) closeFilters();
  }, { passive: true });

  // Close on resize to desktop
  window.addEventListener('resize', () => { if (window.innerWidth >= 900) closeFilters(); });
});

function applyAndRender() {
  // Filter
  filtered = allProducts.filter(p => {
    if (activeCat && p.categorySlug !== activeCat) return false;
    if (activeSub  && p.subcategorySlug !== activeSub)  return false;
    if (activeBadge === 'new'  && p.badge === 'Used') return false;
    if (activeCondition === 'used' && p.badge !== 'Used') return false;
    if (activeCondition === 'new'  && p.badge === 'Used') return false;
    if (activeSearch && !p.name.toLowerCase().includes(activeSearch.toLowerCase()) &&
        !p.description?.toLowerCase().includes(activeSearch.toLowerCase()) &&
        !p.tags?.some(t => t.includes(activeSearch.toLowerCase()))) return false;
    if (inStockOnly && p.stock <= 0) return false;
    if (p.price > maxPrice) return false;
    if (activeTags.size && !p.tags?.some(t => activeTags.has(t))) return false;
    return true;
  });

  // Sort
  const sorts = {
    featured:   (a,b) => (b.featured?1:0) - (a.featured?1:0),
    newest:     (a,b) => new Date(b.createdAt) - new Date(a.createdAt),
    'price-asc':  (a,b) => a.price - b.price,
    'price-desc': (a,b) => b.price - a.price,
    'name-asc':   (a,b) => a.name.localeCompare(b.name),
    rating:       (a,b) => (b.rating||0) - (a.rating||0),
  };
  if (sorts[activeSort]) filtered.sort(sorts[activeSort]);

  page = 1;
  renderProducts(true);
  renderActiveFilters();
  setParams({ cat: activeCat||null, sub: activeSub||null, q: activeSearch||null, sort: activeSort !== 'featured' ? activeSort : null });
}

function renderProducts(reset = false) {
  const grid    = document.getElementById('products-grid');
  const empty   = document.getElementById('shop-empty');
  const countEl = document.getElementById('results-count');
  const moreBtn = document.getElementById('load-more-btn');
  if (!grid) return;

  const total = filtered.length;
  const end   = Math.min(page * PER_PAGE, total);
  const slice = filtered.slice(0, end);

  if (countEl) countEl.textContent = `${total} product${total !== 1 ? 's' : ''}`;
  if (empty)   empty.style.display = total === 0 ? 'block' : 'none';

  if (total === 0) { grid.innerHTML = ''; if (moreBtn) moreBtn.style.display = 'none'; return; }

  // Build cards with per-card error isolation
  const cards = slice.map(p => {
    try { return productCardHTML(p); }
    catch { return ''; }
  }).join('');

  grid.innerHTML = cards;
  bindCardEvents(grid, allProducts, addToCart, toggleWishlist);

  if (moreBtn) moreBtn.style.display = end < total ? 'inline-flex' : 'none';
}

function renderActiveFilters() {
  const el = document.getElementById('active-filters');
  if (!el) return;
  const chips = [];
  if (activeCat) {
    const cats = allCategories;
    const cat = cats.find(c => c.slug === activeCat);
    chips.push(`<span class="chip active" data-remove="cat">${cat?.name || activeCat} <span class="chip-remove">×</span></span>`);
  }
  if (activeSub) {
    chips.push(`<span class="chip active" data-remove="sub">${activeSub} <span class="chip-remove">×</span></span>`);
  }
  if (activeBadge === 'new') chips.push(`<span class="chip active" data-remove="badge">New Arrivals <span class="chip-remove">×</span></span>`);
  if (activeCondition === 'used') chips.push(`<span class="chip active" data-remove="condition">Second Hand <span class="chip-remove">×</span></span>`);
  if (activeCondition === 'new')  chips.push(`<span class="chip active" data-remove="condition">New Only <span class="chip-remove">×</span></span>`);
  if (activeSearch) chips.push(`<span class="chip active" data-remove="q">Search: "${activeSearch}" <span class="chip-remove">×</span></span>`);
  if (inStockOnly) chips.push(`<span class="chip active" data-remove="stock">In Stock <span class="chip-remove">×</span></span>`);
  activeTags.forEach(t => chips.push(`<span class="chip active" data-remove="tag" data-tag="${t}">${t} <span class="chip-remove">×</span></span>`));
  el.innerHTML = chips.join('');
  el.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const type = chip.dataset.remove;
      if (type === 'cat')       { activeCat = ''; document.querySelector('input[name="cat"][value=""]')?.click(); }
      if (type === 'sub')       { activeSub = ''; document.querySelector('input[name="subcat"][value=""]')?.click(); }
      if (type === 'badge')     { activeBadge = ''; }
      if (type === 'condition') { activeCondition = ''; document.querySelector('input[name="condition"][value=""]')?.click(); }
      if (type === 'q')         { activeSearch = ''; document.getElementById('shop-search').value = ''; }
      if (type === 'stock')     { inStockOnly = false; document.getElementById('filter-instock').checked = false; }
      if (type === 'tag')       activeTags.delete(chip.dataset.tag);
      applyAndRender();
    });
  });
}

function populateCategoryFilter() {
  const list = document.getElementById('cat-filter-list');
  if (!list) return;
  const cats = allCategories;
  list.innerHTML =
    `<label class="cat-radio-label${activeCat === '' ? ' selected' : ''}">
       <input type="radio" name="cat" value=""> All Categories
     </label>` +
    cats.map(c =>
      `<label class="cat-radio-label${activeCat === c.slug ? ' selected' : ''}">
         <input type="radio" name="cat" value="${c.slug}"> ${c.name}
         ${c.count ? `<small>${c.count}</small>` : ''}
       </label>`
    ).join('');

  list.querySelectorAll('input[name="cat"]').forEach(radio => {
    if (radio.value === activeCat) radio.checked = true;
    radio.addEventListener('change', () => {
      activeCat = radio.value;
      activeSub = '';
      // Update selected styling
      list.querySelectorAll('.cat-radio-label').forEach(l => l.classList.remove('selected'));
      radio.closest('.cat-radio-label')?.classList.add('selected');
      renderSubcats(activeCat);
      applyAndRender();
    });
  });

  // Show subcats for current activeCat on load
  if (activeCat) renderSubcats(activeCat);
}

function renderSubcats(catSlug) {
  const labelEl = document.getElementById('subcat-section-label');
  const listEl  = document.getElementById('subcat-filter-list');
  if (!labelEl || !listEl) return;

  if (!catSlug) {
    labelEl.style.display = 'none';
    listEl.style.display  = 'none';
    listEl.innerHTML = '';
    return;
  }

  const cats = allCategories;
  const cat  = cats.find(c => c.slug === catSlug);
  const subs = cat?.subcategories || [];

  if (!subs.length) {
    labelEl.style.display = 'none';
    listEl.style.display  = 'none';
    listEl.innerHTML = '';
    return;
  }

  labelEl.style.display = '';
  listEl.style.display  = '';

  // Render as pill-style chips so they're fast to scan + click
  listEl.innerHTML =
    `<button class="sub-pill${activeSub === '' ? ' active' : ''}" data-sub="">All</button>` +
    subs.map(s =>
      `<button class="sub-pill${activeSub === s.slug ? ' active' : ''}" data-sub="${s.slug}">${s.name}</button>`
    ).join('');

  listEl.querySelectorAll('.sub-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      activeSub = btn.dataset.sub;
      listEl.querySelectorAll('.sub-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyAndRender();
    });
  });
}

function populateTagFilter() {
  const el = document.getElementById('tag-filter-list');
  if (!el) return;
  const tags = [...new Set(allProducts.flatMap(p => p.tags || []))].slice(0, 15);
  el.innerHTML = tags.map(t => `<span class="chip tag-chip" data-tag="${t}">${t}</span>`).join('');
  el.querySelectorAll('.tag-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const t = chip.dataset.tag;
      if (activeTags.has(t)) { activeTags.delete(t); chip.classList.remove('active'); }
      else                   { activeTags.add(t);    chip.classList.add('active'); }
      applyAndRender();
    });
  });
}

function updatePageHeader(q, cat, customTitle = '', customDesc = '') {
  const titleEl = document.getElementById('page-title');
  const descEl  = document.getElementById('page-desc');
  const crumbEl = document.getElementById('breadcrumb-current');
  if (customTitle) {
    if (titleEl) titleEl.textContent = customTitle;
    if (descEl && customDesc) descEl.textContent = customDesc;
    if (crumbEl) crumbEl.textContent = customTitle;
  } else if (q) {
    if (titleEl) titleEl.textContent = `Search: "${q}"`;
    if (crumbEl) crumbEl.textContent = `Search Results`;
  } else if (cat) {
    const cats = allCategories;
    const c = cats.find(x => x.slug === cat);
    if (titleEl && c) titleEl.textContent = c.name;
    if (crumbEl && c) crumbEl.textContent = c.name;
  }
}

function bindUI() {
  // Search
  const searchInput = document.getElementById('shop-search');
  searchInput?.addEventListener('input', debounce(() => {
    activeSearch = searchInput.value.trim();
    applyAndRender();
  }, 300));

  // Sort
  document.getElementById('sort-select')?.addEventListener('change', e => {
    activeSort = e.target.value; applyAndRender();
  });

  // Price range
  const priceSlider = document.getElementById('price-max');
  priceSlider?.addEventListener('input', () => {
    maxPrice = parseInt(priceSlider.value);
    const el = document.getElementById('price-max-label');
    if (el) el.textContent = maxPrice.toLocaleString();
    applyAndRender();
  });

  // In stock
  document.getElementById('filter-instock')?.addEventListener('change', e => {
    inStockOnly = e.target.checked; applyAndRender();
  });

  // Condition filter
  document.querySelectorAll('input[name="condition"]').forEach(r => {
    r.addEventListener('change', () => { activeCondition = r.value; applyAndRender(); });
  });

  // Clear filters
  document.getElementById('clear-filters')?.addEventListener('click', () => {
    activeCat = ''; activeSearch = ''; inStockOnly = false; maxPrice = 50000; activeTags.clear(); activeSort = 'featured';
    document.getElementById('shop-search').value = '';
    document.querySelector('input[name="cat"][value=""]')?.click();
    document.getElementById('filter-instock').checked = false;
    if (priceSlider) { priceSlider.value = 50000; document.getElementById('price-max-label').textContent = '50,000'; }
    document.querySelectorAll('.tag-chip').forEach(c => c.classList.remove('active'));
    applyAndRender();
  });
  document.getElementById('reset-shop')?.addEventListener('click', () => {
    document.getElementById('clear-filters')?.click();
  });

  // Load more
  document.getElementById('load-more-btn')?.addEventListener('click', () => {
    page++; renderProducts();
  });
}

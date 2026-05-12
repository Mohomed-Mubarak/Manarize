/* ============================================================
   ZENMARKET — SEARCH PAGE
   ============================================================ */
import { withLoader }    from './loader.js';
import { injectLayout }  from './layout.js';
import { searchProducts as searchLocal } from './search.js';
import { searchProducts as searchDB } from './store-adapter.js';
import { addToCart, toggleWishlist } from './cart.js';
import { productCardHTML, bindCardEvents } from './product-card.js';

withLoader(async () => {
  await injectLayout({ activePage: 'Shop' });

  const params = new URLSearchParams(window.location.search);
  const q      = params.get('q') || '';

  const input = document.getElementById('main-search');
  if (input && q) input.value = q;

  if (q) {
    runSearch(q);
  } else {
    showEmpty('Enter a search term to find products');
  }

  input?.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const val = input.value.trim();
      if (val) {
        window.history.replaceState({}, '', `search.html?q=${encodeURIComponent(val)}`);
        runSearch(val);
      }
    }
  });

  document.getElementById('search-submit')?.addEventListener('click', () => {
    const val = input?.value.trim();
    if (val) {
      window.history.replaceState({}, '', `search.html?q=${encodeURIComponent(val)}`);
      runSearch(val);
    }
  });
});

async function runSearch(query) {
  // Try DB-level full-text search first (faster, supports partial word match via FTS).
  // Fall back to client-side filtering if DB search fails or returns nothing.
  let results;

  try {
    results = await searchDB(query);
  } catch (_) {
    results = [];
  }

  // If DB search returned nothing, try client-side filter as fallback
  // (handles cases where FTS column isn't set up yet)
  if (!results || !results.length) {
    results = await searchLocal(query);
  }
  const heading     = document.getElementById('search-heading');
  if (heading) heading.textContent = `Results for "${query}"`;
  document.title = `"${query}" — Manarize`;

  const grid  = document.getElementById('search-results-grid');
  const empty = document.getElementById('search-empty');

  if (!results.length) {
    if (grid) grid.innerHTML = '';
    showEmpty(`No results found for "${query}"`);
    return;
  }

  if (empty) empty.style.display = 'none';

  grid.innerHTML = results.map(p => productCardHTML(p)).join('');
  bindCardEvents(grid, results, addToCart, toggleWishlist);
}

function showEmpty(msg) {
  const empty   = document.getElementById('search-empty');
  const heading = document.getElementById('empty-heading');
  if (empty)   empty.style.display = 'block';
  if (heading) heading.textContent  = msg;
}

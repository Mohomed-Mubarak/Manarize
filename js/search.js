/* ============================================================
   ZENMARKET — SEARCH
   ============================================================ */
import { getProducts, searchProducts as searchDB } from './store-adapter.js';
import { formatPrice, truncate } from './utils.js';

export async function searchProducts(query, limit = 50) {
  if (!query || query.length < 2) return [];
  const q = query.toLowerCase().trim();
  const all = await getProducts().catch(() => []);
  if (!Array.isArray(all)) return [];
  return all.filter(p =>
    p.active !== false && (
      (p.name        || '').toLowerCase().includes(q) ||
      (p.category    || '').toLowerCase().includes(q) ||
      (p.description || '').toLowerCase().includes(q) ||
      (p.tags     || []).some(t => (t || '').toLowerCase().includes(q)) ||
      (p.hashtags || []).some(t => (t || '').toLowerCase().includes(q))
    )
  ).slice(0, limit);
}

// ── Quick Search Dropdown ─────────────────────────────────────
export function initQuickSearch(inputEl, dropdownEl) {
  if (!inputEl || !dropdownEl) return;

  let debounceTimer;

  inputEl.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      const q = inputEl.value.trim();
      if (q.length < 2) { dropdownEl.innerHTML = ''; dropdownEl.hidden = true; return; }
      // Use DB search first, fall back to local if unavailable
      let results;
      try { results = await searchDB(q, { limit: 6 }); } catch (_) { results = []; }
      if (!results || !results.length) results = await searchProducts(q, 6);
      renderQuickResults(results, q, dropdownEl);
    }, 250);
  });

  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && inputEl.value.trim()) {
      window.location.href = `search?q=${encodeURIComponent(inputEl.value.trim())}`;
    }
    if (e.key === 'Escape') { dropdownEl.hidden = true; }
  });

  document.addEventListener('click', e => {
    if (!inputEl.closest('form')?.contains(e.target)) {
      dropdownEl.hidden = true;
    }
  });
}

function renderQuickResults(results, query, el) {
  const safeQuery = query.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  if (!results.length) {
    el.innerHTML = `<div style="padding:1rem;color:var(--clr-text-3);font-size:.875rem">No results for &ldquo;${safeQuery}&rdquo;</div>`;
    el.hidden = false;
    return;
  }
  el.innerHTML = results.map(p => `
    <a href="product.html?slug=${encodeURIComponent(p.slug)}" class="quick-result">
      <img src="${p.images?.[0] || ''}" alt="${safeQuery}" loading="lazy">
      <div>
        <div class="qr-name">${highlight(p.name, query)}</div>
        <div class="qr-price">${formatPrice(p.price)}</div>
      </div>
    </a>
  `).join('') +
  `<a href="search?q=${encodeURIComponent(query)}" class="quick-result-all">
    See all results for &ldquo;<strong>${safeQuery}</strong>&rdquo; →
  </a>`;
  el.hidden = false;
}

function highlight(text, query) {
  const re = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return text.replace(re, '<mark>$1</mark>');
}

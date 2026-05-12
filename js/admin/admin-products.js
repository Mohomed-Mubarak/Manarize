/* ============================================================
   ZENMARKET — ADMIN PRODUCTS
   ============================================================ */
import { requireAdmin } from './admin-auth.js';
import { getProducts, saveProduct, deleteProduct, generateProductId, generateSlug, getCategories } from '../store-adapter.js';
import { formatPrice } from '../utils.js';
import { injectAdminLayout } from './admin-layout.js';
import { withLoader } from '../loader.js';
import toast from '../toast.js';
import { confirmModal } from '../modal.js';
import { esc } from '../security-utils.js';

let allProducts = [];
let filtered    = [];
let page = 1;
const PER_PAGE  = 15;

withLoader(async () => {
  if (!requireAdmin()) return;
  await injectAdminLayout('Products');

  try {
    // adminMode: true — fetch ALL products (including inactive) for admin view
    allProducts = await getProducts({ adminMode: true });
  } catch (err) {
    console.error('[Admin Products] Failed to load products:', err);
    const tbody = document.getElementById('products-tbody');
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:3rem;color:var(--clr-error)">
        <i class="fa-solid fa-triangle-exclamation" style="margin-right:.5rem"></i>
        Failed to load products: ${esc(err.message)}
      </td></tr>`;
    }
    const countEl = document.getElementById('products-count');
    if (countEl) countEl.textContent = 'Error loading products';
    return;
  }

  filtered    = [...allProducts];
  renderTable();
  bindSearch();
  bindFilters();
  bindTableEvents();          // ← event delegation instead of inline handlers
  await populateCategoryFilter();
});

function renderTable() {
  const start = (page - 1) * PER_PAGE;
  const slice = filtered.slice(start, start + PER_PAGE);
  const tbody = document.getElementById('products-tbody');
  if (!tbody) return;

  if (!slice.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:3rem;color:var(--clr-text-3)">No products found</td></tr>`;
  } else {
    tbody.innerHTML = slice.map(p => `
      <tr data-id="${p.id}">
        <td>
          <div style="display:flex;align-items:center;gap:.75rem">
            <img class="prod-thumb" src="${p.images?.[0]||'https://via.placeholder.com/44'}" alt="${esc(p.name)}"
                 data-err-hide>
            <div class="prod-info">
              <span class="name">${esc(p.name)}</span>
              <span class="sku">${esc(p.sku || p.id)}</span>
            </div>
          </div>
        </td>
        <td style="color:var(--clr-text-3)">${p.category ? esc(p.category) : '<span style="color:var(--clr-text-3);font-style:italic;font-size:.8rem">—</span>'}</td>
        <td class="text-main" style="font-family:var(--ff-mono)">${formatPrice(p.price)}</td>
        <td>
          <span class="badge ${p.stock === 0 ? 'badge-red' : p.stock <= 10 ? 'badge-amber' : 'badge-green'}">
            ${p.stock === 0 ? 'Out of stock' : p.stock}
          </span>
        </td>
        <td>
          <label class="toggle" title="Featured">
            <input type="checkbox" data-action="featured" data-id="${p.id}" ${p.featured ? 'checked' : ''}>
            <div class="toggle-track"></div>
            <div class="toggle-thumb"></div>
          </label>
        </td>
        <td>
          <label class="toggle" title="Active">
            <input type="checkbox" data-action="active" data-id="${p.id}" ${p.active !== false ? 'checked' : ''}>
            <div class="toggle-track"></div>
            <div class="toggle-thumb"></div>
          </label>
        </td>
        <td>
          <div style="display:flex;gap:.5rem">
            <a href="product-edit.html?id=${p.id}" class="btn btn-ghost btn-sm" title="Edit"><i class="fa-solid fa-pen-to-square"></i></a>
            <button class="btn btn-ghost btn-sm" data-action="delete" data-id="${p.id}" title="Delete" style="color:var(--clr-error)"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      </tr>`).join('');
  }

  renderPagination();
  document.getElementById('products-count').textContent = `${filtered.length} products`;
}

function renderPagination() {
  const totalPages = Math.ceil(filtered.length / PER_PAGE);
  const pag = document.getElementById('products-pagination');
  if (!pag) return;
  if (totalPages <= 1) { pag.innerHTML = ''; return; }
  let html = `<button class="page-btn" data-page="${page-1}" ${page<=1?'disabled':''}><i class="fa-solid fa-chevron-left"></i></button>`;
  for (let i = 1; i <= totalPages; i++) {
    if (Math.abs(i - page) <= 2 || i === 1 || i === totalPages) {
      html += `<button class="page-btn ${i===page?'active':''}" data-page="${i}">${i}</button>`;
    } else if (Math.abs(i - page) === 3) {
      html += `<span style="color:var(--clr-text-3);padding:0 .5rem">…</span>`;
    }
  }
  html += `<button class="page-btn" data-page="${page+1}" ${page>=totalPages?'disabled':''}><i class="fa-solid fa-chevron-right"></i></button>`;
  pag.innerHTML = html;
}

// Pagination click delegation
document.addEventListener('click', e => {
  const btn = e.target.closest('#products-pagination [data-page]');
  if (!btn || btn.disabled) return;
  const p = parseInt(btn.dataset.page, 10);
  const totalPages = Math.ceil(filtered.length / PER_PAGE);
  if (p < 1 || p > totalPages) return;
  page = p;
  renderTable();
});

function bindSearch() {
  const input = document.getElementById('product-search');
  if (!input) return;
  input.addEventListener('input', () => {
    const q = input.value.toLowerCase();
    filtered = allProducts.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q) ||
      (p.sku || '').toLowerCase().includes(q)
    );
    page = 1;
    renderTable();
  });
}

function bindFilters() {
  document.getElementById('filter-category')?.addEventListener('change', applyFilters);
  document.getElementById('filter-status')?.addEventListener('change', applyFilters);
  document.getElementById('sort-products')?.addEventListener('change', applySort);
}

function applyFilters() {
  const cat    = document.getElementById('filter-category')?.value || '';
  const status = document.getElementById('filter-status')?.value || '';
  const q      = document.getElementById('product-search')?.value.toLowerCase() || '';
  filtered = allProducts.filter(p => {
    if (q && !p.name.toLowerCase().includes(q) && !p.category.toLowerCase().includes(q) && !(p.sku || '').toLowerCase().includes(q)) return false;
    if (cat && p.categorySlug !== cat) return false;
    if (status === 'active' && p.active === false) return false;
    if (status === 'inactive' && p.active !== false) return false;
    if (status === 'featured' && !p.featured) return false;
    if (status === 'outofstock' && p.stock > 0) return false;
    return true;
  });
  page = 1;
  renderTable();
}

function applySort() {
  const sort = document.getElementById('sort-products')?.value || '';
  const map = {
    'name-asc':   (a,b) => a.name.localeCompare(b.name),
    'name-desc':  (a,b) => b.name.localeCompare(a.name),
    'price-asc':  (a,b) => a.price - b.price,
    'price-desc': (a,b) => b.price - a.price,
    'stock-asc':  (a,b) => a.stock - b.stock,
    'newest':     (a,b) => new Date(b.createdAt) - new Date(a.createdAt),
  };
  if (map[sort]) filtered.sort(map[sort]);
  page = 1;
  renderTable();
}

// ── Event delegation for table interactions ───────────────────
function bindTableEvents() {
  const tbody = document.getElementById('products-tbody');
  if (!tbody) return;

  tbody.addEventListener('change', e => {
    const input = e.target;
    if (input.tagName !== 'INPUT' || input.type !== 'checkbox') return;
    const id  = input.dataset.id;
    const act = input.dataset.action;
    const p   = allProducts.find(x => x.id === id);
    if (!p || !act) return;

    if (act === 'featured') {
      p.featured = input.checked;
      saveProduct(p);
      toast.success('Updated', `${p.name} — featured: ${input.checked ? 'on' : 'off'}`);
    } else if (act === 'active') {
      p.active = input.checked;
      saveProduct(p);
      toast.success('Updated', `${p.name} ${input.checked ? 'activated' : 'deactivated'}`);
    }
  });

  tbody.addEventListener('click', e => {
    const btn = e.target.closest('[data-action="delete"]');
    if (!btn) return;
    const id = btn.dataset.id;
    const p  = allProducts.find(x => x.id === id);
    if (!p) return;
    confirmModal({
      title:       'Delete Product',
      message:     `Are you sure you want to delete "<strong>${esc(p.name)}</strong>"? This cannot be undone.`,
      confirmText: 'Delete',
      danger:      true,
      onConfirm:   async () => {
        try {
          await deleteProduct(id);
          allProducts = await getProducts({ adminMode: true });
          filtered    = filtered.filter(x => x.id !== id);
          renderTable();
          toast.success('Deleted', `${p.name} has been removed`);
        } catch (err) {
          console.error('[Admin Products] Delete failed:', err);
          toast.error('Delete failed', err.message || 'Could not delete product.');
        }
      },
    });
  });
}

// ── Populate category filter ──────────────────────────────────
async function populateCategoryFilter() {
  const sel = document.getElementById('filter-category');
  if (!sel) return;

  try {
    const cats = await getCategories().catch(()=>[]);
    if (!cats || cats.length === 0) {
      sel.innerHTML = `<option value="">All Categories</option>`;
      return;
    }
    sel.innerHTML =
      `<option value="">All Categories</option>` +
      cats.map(c => `<option value="${esc(c.slug || '')}">${esc(c.name)}</option>`).join('');
  } catch (err) {
    console.error('[Admin Products] populateCategoryFilter failed:', err);
    sel.innerHTML = `<option value="">All Categories</option>`;
  }
}

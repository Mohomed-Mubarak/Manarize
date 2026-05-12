/* ============================================================
   ZENMARKET — ADMIN CATEGORIES  (v4 — Supabase + subcategory support)
   ============================================================
   Routes through store-adapter so it works in both DEMO_MODE
   (localStorage) and production (Supabase).
   ============================================================ */
import { adminConfirm }      from './admin-confirm.js';
import { requireAdmin }      from './admin-auth.js';
import { injectAdminLayout } from './admin-layout.js';
import { withLoader }        from '../loader.js';
import { getCategories, saveCategories, getProducts } from '../store-adapter.js';
import { esc } from '../security-utils.js';
import toast from '../toast.js';

// ── Module-level cache ────────────────────────────────────────
let _cats          = [];
let _productCounts = {};

function loadCats() {
  return JSON.parse(JSON.stringify(_cats));
}

async function saveCats(cats) {
  _cats = cats;
  try {
    await saveCategories(cats);
  } catch (err) {
    console.error('[Admin Categories] saveCategories failed:', err);
    toast.error('Save failed', err.message || 'Could not save categories.');
    throw err;
  }
}

function getCounts() { return _productCounts; }

async function loadCounts() {
  try {
    const products = await getProducts({ adminMode: true });
    const map = {};
    products.forEach(p => {
      if (p.categorySlug) map[p.categorySlug] = (map[p.categorySlug] || 0) + 1;
    });
    return map;
  } catch { return {}; }
}

function toSlug(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function populateParentSelect() {
  const sel = document.getElementById('sub-parent-cat');
  if (!sel) return;
  sel.innerHTML = `<option value="">Select parent category…</option>` +
    loadCats().map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
}

function renderTable() {
  const cats    = loadCats();
  const counts  = getCounts();
  const tbody   = document.getElementById('cats-tbody');
  const countEl = document.getElementById('cat-count');
  if (!tbody) return;

  const total  = cats.length;
  const active = cats.filter(c => c.active !== false).length;
  if (countEl) countEl.textContent = `${total} categories · ${active} active`;

  let html = '';

  cats.forEach(c => {
    const subs     = c.subcategories || [];
    const isActive = c.active !== false;
    const hasSubs  = subs.length > 0;

    html += `
      <tr id="cat-row-${esc(c.id)}" style="${!isActive ? 'opacity:.5' : ''}">
        <td style="text-align:center;padding:.5rem">
          ${hasSubs ? `<button class="expand-btn" data-target="${esc(c.id)}" title="Expand subcategories"><i class="fa-solid fa-chevron-right" style="font-size:.7rem"></i></button>` : ''}
        </td>
        <td style="text-align:center">
          <i class="${c.icon || 'fa-solid fa-tag'}" style="color:${isActive ? 'var(--clr-gold)' : 'var(--clr-text-3)'};font-size:1.1rem"></i>
        </td>
        <td>
          <div style="font-weight:600;color:var(--clr-text)">${esc(c.name)}</div>
          <div style="font-size:.75rem;color:var(--clr-text-3);font-family:var(--ff-mono)">${esc(c.slug)}</div>
        </td>
        <td>
          <div style="display:flex;flex-wrap:wrap;max-width:260px">
            ${subs.map(s => `
              <span class="subcat-tag">${esc(s.name)}
                <button class="remove-sub" data-cat="${esc(c.id)}" data-sub="${esc(s.id)}" title="Remove subcategory">×</button>
              </span>`).join('')}
            ${!subs.length ? `<span style="font-size:.75rem;color:var(--clr-text-3);font-style:italic">No subcategories</span>` : ''}
          </div>
        </td>
        <td><span class="badge badge-blue">${counts[c.slug] || 0}</span></td>
        <td>
          <span class="badge ${isActive ? 'badge-green' : 'badge-gray'}">${isActive ? 'Active' : 'Inactive'}</span>
        </td>
        <td>
          <div style="display:flex;gap:.4rem;align-items:center">
            <button class="btn btn-ghost btn-sm toggle-cat" data-id="${esc(c.id)}"
              title="${isActive ? 'Deactivate' : 'Activate'}"
              style="color:${isActive ? 'var(--clr-warning)' : 'var(--clr-success)'}">
              <i class="fa-solid ${isActive ? 'fa-toggle-on' : 'fa-toggle-off'}"></i>
            </button>
            ${!c.isDefault
              ? `<button class="btn btn-ghost btn-sm delete-cat" data-id="${esc(c.id)}" data-name="${esc(c.name)}" style="color:var(--clr-error)" title="Delete"><i class="fa-solid fa-trash"></i></button>`
              : `<span style="font-size:.7rem;color:var(--clr-text-3);font-style:italic">Default</span>`}
          </div>
        </td>
      </tr>`;

    if (hasSubs) {
      html += `
        <tr class="subcat-expand-row" id="subs-${esc(c.id)}" style="display:none">
          <td colspan="7">
            <div style="padding:.5rem 1rem .75rem 3.5rem">
              <div style="font-size:.75rem;text-transform:uppercase;letter-spacing:.08em;color:var(--clr-text-3);margin-bottom:.5rem">
                Subcategories in ${esc(c.name)}
              </div>
              <table style="width:100%;font-size:.8125rem"><tbody>
                ${subs.map(s => `
                  <tr>
                    <td style="padding:.375rem .5rem;color:var(--clr-text-2)">
                      <i class="fa-solid fa-chevron-right" style="font-size:.6rem;color:var(--clr-text-3);margin-right:.375rem"></i>${esc(s.name)}
                    </td>
                    <td style="padding:.375rem .5rem;font-family:var(--ff-mono);color:var(--clr-text-3);font-size:.75rem">${esc(s.slug)}</td>
                    <td style="padding:.375rem .5rem;text-align:right">
                      <button class="btn btn-ghost btn-sm remove-sub-btn" data-cat="${esc(c.id)}" data-sub="${esc(s.id)}" style="color:var(--clr-error)" title="Remove">
                        <i class="fa-solid fa-trash"></i> Remove
                      </button>
                    </td>
                  </tr>`).join('')}
              </tbody></table>
            </div>
          </td>
        </tr>`;
    }
  });

  tbody.innerHTML = html;
  bindTableEvents();
}

function bindTableEvents() {
  const tbody = document.getElementById('cats-tbody');
  if (!tbody) return;

  tbody.querySelectorAll('.expand-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const subRow = document.getElementById(`subs-${btn.dataset.target}`);
      const isOpen = subRow.style.display !== 'none';
      subRow.style.display = isOpen ? 'none' : '';
      btn.classList.toggle('open', !isOpen);
    });
  });

  tbody.querySelectorAll('.toggle-cat').forEach(btn => {
    btn.addEventListener('click', async () => {
      const cats = loadCats();
      const idx  = cats.findIndex(c => c.id === btn.dataset.id);
      if (idx < 0) return;
      cats[idx].active = cats[idx].active === false ? true : false;
      try {
        await saveCats(cats);
        toast.info('Updated', `"${cats[idx].name}" ${cats[idx].active ? 'activated' : 'deactivated'}`);
        renderTable();
        populateParentSelect();
      } catch { /* saveCats shows error toast */ }
    });
  });

  tbody.querySelectorAll('.delete-cat').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ok = await adminConfirm({
        title: `Delete category "${btn.dataset.name}"?`,
        message: 'Products in this category will become uncategorised.',
        confirm: 'Delete', danger: true,
      });
      if (!ok) return;
      try {
        await saveCats(loadCats().filter(c => c.id !== btn.dataset.id));
        toast.success('Deleted', `"${btn.dataset.name}" removed`);
        renderTable();
        populateParentSelect();
      } catch { /* saveCats shows error toast */ }
    });
  });

  tbody.querySelectorAll('.remove-sub, .remove-sub-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const cats    = loadCats();
      const cat     = cats.find(c => c.id === btn.dataset.cat);
      if (!cat) return;
      const subName = cat.subcategories.find(s => s.id === btn.dataset.sub)?.name || 'Subcategory';
      const ok      = await adminConfirm({
        title: `Remove subcategory "${subName}"?`,
        message: `It will be removed from ${esc(cat.name)}.`,
        confirm: 'Remove', danger: true,
      });
      if (!ok) return;
      cat.subcategories = cat.subcategories.filter(s => s.id !== btn.dataset.sub);
      try {
        await saveCats(cats);
        toast.success('Removed', `"${subName}" subcategory removed`);
        renderTable();
        populateParentSelect();
      } catch { /* saveCats shows error toast */ }
    });
  });
}

function bindAddCatForm() {
  const nameInput   = document.getElementById('new-cat-name');
  const iconInput   = document.getElementById('new-cat-icon');
  const iconPreview = document.getElementById('icon-preview');

  iconInput?.addEventListener('input', () => {
    const cls = iconInput.value.trim() || 'fa-solid fa-tag';
    if (iconPreview) { iconPreview.className = cls; iconPreview.style.cssText = 'color:var(--clr-gold);margin-left:.25rem'; }
  });

  document.getElementById('add-cat-btn')?.addEventListener('click', async () => {
    const name = (nameInput?.value || '').trim();
    if (!name) { toast.error('Required', 'Enter a category name'); nameInput?.focus(); return; }

    const cats = loadCats();
    const slug = toSlug(name);
    if (cats.find(c => c.slug === slug)) { toast.error('Duplicate', `"${slug}" already exists`); return; }

    cats.push({
      id: `cat-${Date.now()}`, name, slug,
      icon:          iconInput?.value.trim() || 'fa-solid fa-tag',
      isDefault:     false,
      active:        true,
      subcategories: [],
    });

    try {
      await saveCats(cats);
      toast.success('Created', `Category "${name}" added`);
      if (nameInput)   nameInput.value  = '';
      if (iconInput)   iconInput.value  = '';
      if (iconPreview) { iconPreview.className = 'fa-solid fa-tag'; iconPreview.style.cssText = 'color:var(--clr-gold);margin-left:.25rem'; }
      renderTable();
      populateParentSelect();
    } catch { /* saveCats shows error toast */ }
  });
}

function bindAddSubForm() {
  document.getElementById('add-sub-btn')?.addEventListener('click', async () => {
    const parentId = document.getElementById('sub-parent-cat')?.value;
    const subName  = (document.getElementById('new-sub-name')?.value || '').trim();

    if (!parentId) { toast.error('Required', 'Select a parent category'); return; }
    if (!subName)  { toast.error('Required', 'Enter a subcategory name'); return; }

    const cats = loadCats();
    const cat  = cats.find(c => c.id === parentId);
    if (!cat) return;

    const slug = toSlug(subName);
    if (!cat.subcategories) cat.subcategories = [];
    if (cat.subcategories.find(s => s.slug === slug)) {
      toast.error('Duplicate', `"${subName}" already exists in ${cat.name}`);
      return;
    }

    cat.subcategories.push({ id: `sub-${Date.now()}`, name: subName, slug });

    try {
      await saveCats(cats);
      toast.success('Added', `"${subName}" added to ${cat.name}`);
      const subNameEl = document.getElementById('new-sub-name');
      if (subNameEl) subNameEl.value = '';
      renderTable();
      populateParentSelect();
    } catch { /* saveCats shows error toast */ }
  });
}

// ── Init ──────────────────────────────────────────────────────
withLoader(async () => {
  if (!requireAdmin()) return;
  await injectAdminLayout('Categories');

  try {
    [_cats, _productCounts] = await Promise.all([
      getCategories(),
      loadCounts(),
    ]);
  } catch (err) {
    console.error('[Admin Categories] Init failed:', err);
    toast.error('Load failed', 'Could not load categories. Check your connection.');
    _cats          = [];
    _productCounts = {};
  }

  renderTable();
  populateParentSelect();
  bindAddCatForm();
  bindAddSubForm();
});

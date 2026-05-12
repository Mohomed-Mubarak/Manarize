/* ============================================================
   ZENMARKET — ADMIN BLOG  (post list + publish/delete)
   ============================================================ */
import { requireAdmin }      from './admin-auth.js';
import { injectAdminLayout } from './admin-layout.js';
import { withLoader }        from '../loader.js';
import { confirmModal }      from '../modal.js';
import toast                 from '../toast.js';
import {
  getPosts, savePost, deletePost,
} from '../blog-data.js';

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── Page init ─────────────────────────────────────────────────
let posts     = [];
let filtered  = [];
let filterVal = 'all';
let searchVal = '';

withLoader(async () => {
  if (!requireAdmin()) return;
  await injectAdminLayout('Blog Posts');
  posts    = await getPosts({ adminMode: true });
  filtered = [...posts];
  renderTable();
  bindUI();
});

// ── Render ────────────────────────────────────────────────────
function renderTable() {
  const tbody   = document.getElementById('blog-tbody');
  const countEl = document.getElementById('blog-count');
  if (!tbody) return;

  const q = searchVal.toLowerCase();
  filtered = posts.filter(p => {
    const matchFilter =
      filterVal === 'all'        ? true
    : filterVal === 'published'  ? p.published
    : filterVal === 'draft'      ? !p.published
    : filterVal === 'featured'   ? p.featured
    : true;
    const matchSearch = !q ||
      p.title.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q) ||
      (p.tags || []).some(t => t.includes(q));
    return matchFilter && matchSearch;
  });

  if (countEl) countEl.textContent = `${filtered.length} post${filtered.length !== 1 ? 's' : ''}`;

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:3rem;color:var(--clr-text-3)">
      <i class="fa-solid fa-newspaper" style="font-size:2rem;display:block;margin-bottom:.75rem;opacity:.3"></i>
      No posts found
    </td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(p => {
    const date = new Date(p.createdAt).toLocaleDateString('en-LK', { day:'2-digit', month:'short', year:'numeric' });
    return `
    <tr data-id="${p.id}">
      <td>
        <div style="display:flex;align-items:center;gap:.875rem">
          <img src="${p.coverImage || 'https://via.placeholder.com/52x40/1e2330/667080?text=No+img'}"
               alt="" style="width:68px;height:48px;object-fit:cover;border-radius:6px;flex-shrink:0;background:var(--clr-bg-2)"
               data-err-hide>
          <div>
            <div style="font-weight:500;color:var(--clr-text);font-size:.875rem;line-height:1.3">${esc(p.title)}</div>
            <div style="font-size:.75rem;color:var(--clr-text-3);margin-top:2px;font-family:var(--ff-mono)">${esc(p.slug)}</div>
          </div>
        </div>
      </td>
      <td><span class="badge badge-blue" style="font-size:.7rem">${p.category ? esc(p.category) : '—'}</span></td>
      <td style="color:var(--clr-text-3);font-size:.8125rem">${date}</td>
      <td>
        <label class="toggle" title="${p.published ? 'Published' : 'Draft'}">
          <input type="checkbox" data-action="publish" data-id="${p.id}" ${p.published ? 'checked' : ''}>
          <div class="toggle-track"></div>
          <div class="toggle-thumb"></div>
        </label>
      </td>
      <td>
        <label class="toggle" title="${p.featured ? 'Featured' : 'Not featured'}">
          <input type="checkbox" data-action="featured" data-id="${p.id}" ${p.featured ? 'checked' : ''}>
          <div class="toggle-track"></div>
          <div class="toggle-thumb"></div>
        </label>
      </td>
      <td>
        <div style="display:flex;gap:.375rem;align-items:center">
          <a href="blog-edit.html?id=${p.id}" class="btn btn-ghost btn-sm" title="Edit">
            <i class="fa-solid fa-pen-to-square"></i>
          </a>
          <a href="../blog-post.html?slug=${esc(p.slug)}" target="_blank" class="btn btn-ghost btn-sm" title="Preview">
            <i class="fa-regular fa-eye"></i>
          </a>
          <button class="btn btn-ghost btn-sm" data-action="delete" data-id="${p.id}" title="Delete"
                  style="color:var(--clr-error)">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

// ── UI bindings ───────────────────────────────────────────────
function bindUI() {
  // Search
  document.getElementById('blog-search')?.addEventListener('input', e => {
    searchVal = e.target.value.trim();
    renderTable();
  });

  // Filter tabs
  document.querySelectorAll('[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      filterVal = btn.dataset.filter;
      document.querySelectorAll('[data-filter]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderTable();
    });
  });

  // Table delegation — publish toggle, featured toggle, delete
  const tbody = document.getElementById('blog-tbody');
  tbody?.addEventListener('change', async e => {
    const input = e.target;
    if (input.type !== 'checkbox') return;
    const id  = input.dataset.id;
    const act = input.dataset.action;
    const p   = posts.find(x => x.id === id);
    if (!p) return;
    if (act === 'publish') {
      p.published = input.checked;
      p.updatedAt = new Date().toISOString();
      await savePost(p);
      toast.success('Updated', p.published ? `"${esc(p.title)}" is now live` : `"${esc(p.title)}" moved to drafts`);
    } else if (act === 'featured') {
      p.featured = input.checked;
      p.updatedAt = new Date().toISOString();
      await savePost(p);
      toast.success('Updated', `"${esc(p.title)}" featured: ${input.checked ? 'on' : 'off'}`);
    }
  });

  tbody?.addEventListener('click', e => {
    const btn = e.target.closest('[data-action="delete"]');
    if (!btn) return;
    const id = btn.dataset.id;
    const p  = posts.find(x => x.id === id);
    if (!p) return;
    confirmModal({
      title:       'Delete Post',
      message:     `Permanently delete "<strong>${esc(p.title)}</strong>"? This cannot be undone.`,
      confirmText: 'Delete',
      danger:      true,
      onConfirm: async () => {
        await deletePost(id);
        posts    = await getPosts();
        renderTable();
        toast.success('Deleted', `"${esc(p.title)}" removed`);
      },
    });
  });
}

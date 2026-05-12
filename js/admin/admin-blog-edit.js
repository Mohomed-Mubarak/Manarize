/* ============================================================
   ZENMARKET — ADMIN BLOG EDIT  (create / edit post)
   ============================================================ */
import { requireAdmin, verifyAdminSession } from './admin-auth.js';
import { injectAdminLayout } from './admin-layout.js';
import { withLoader }        from '../loader.js';
import toast                 from '../toast.js';
import {
  getPosts, savePost, generatePostId, generatePostSlug,
} from '../blog-data.js';
import { DEMO_MODE } from '../config.js';

const CATEGORIES = [
  'Food & Culture', 'Fashion', 'Lifestyle', 'Technology',
  'Travel', 'Health & Wellness', 'Business', 'News',
];

let post        = null;   // current post object (null = new)
let isDirty     = false;  // unsaved changes flag
let autoSaveTimer;

withLoader(async () => {
  if (!requireAdmin()) return;

  const id = new URLSearchParams(window.location.search).get('id');
  if (id) {
    post = (await getPosts()).find(p => p.id === id) || null;
    if (!post) { toast.error('Not found', 'Post not found'); return; }
    await injectAdminLayout('Edit Post');
    document.getElementById('page-heading').textContent = 'Edit Post';
  } else {
    await injectAdminLayout('New Post');
    document.getElementById('page-heading').textContent = 'New Post';
  }

  populateCategories();
  fillForm();
  bindEditor();
  bindForm();
  bindAutoSave();
  bindCoverImage();
  initWordCount();
});

// ── Category select ───────────────────────────────────────────
function populateCategories() {
  const sel = document.getElementById('post-category');
  if (!sel) return;
  sel.innerHTML = `<option value="">Select category…</option>` +
    CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('');
}

// ── Fill form from post object ────────────────────────────────
function fillForm() {
  if (!post) return;
  setVal('post-title',    post.title);
  setVal('post-slug',     post.slug);
  setVal('post-excerpt',  post.excerpt);
  setVal('post-author',   post.author);
  setVal('post-cover',    post.coverImage);
  setVal('post-tags',     (post.tags || []).join(', '));
  setVal('post-seo-title', post.seoTitle || '');
  setVal('post-seo-desc',  post.seoDesc  || '');
  setVal('post-read-time', post.readTime || 5);
  document.getElementById('post-published').checked = !!post.published;
  document.getElementById('post-featured').checked  = !!post.featured;
  // Category
  const catSel = document.getElementById('post-category');
  if (catSel && post.category) catSel.value = post.category;
  // Cover preview
  if (post.coverImage) updateCoverPreview(post.coverImage);
  // Rich editor content
  const editor = document.getElementById('rich-editor');
  if (editor) editor.innerHTML = post.content || '';
  updateWordCount();
}

// ── Rich text toolbar binding ─────────────────────────────────
function bindEditor() {
  const editor = document.getElementById('rich-editor');
  if (!editor) return;

  editor.setAttribute('contenteditable', 'true');

  // Toolbar buttons
  document.querySelectorAll('[data-cmd]').forEach(btn => {
    btn.addEventListener('mousedown', e => {
      e.preventDefault(); // don't lose editor focus
      const cmd   = btn.dataset.cmd;
      const value = btn.dataset.val || null;

      if (cmd === 'insertHTML') {
        // Block-level insertions
        document.execCommand('insertHTML', false, value);
      } else if (cmd === 'createLink') {
        const url = prompt('Enter URL:', 'https://');
        if (url) document.execCommand('createLink', false, url);
      } else if (cmd === 'insertImage') {
        const url = prompt('Image URL:', 'https://');
        if (url) document.execCommand('insertImage', false, url);
      } else {
        document.execCommand(cmd, false, value);
      }
      editor.focus();
      markDirty();
    });
  });

  // Keyboard shortcuts
  editor.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'b') { e.preventDefault(); document.execCommand('bold', false, null); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'i') { e.preventDefault(); document.execCommand('italic', false, null); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'u') { e.preventDefault(); document.execCommand('underline', false, null); }
  });

  editor.addEventListener('input', () => { markDirty(); updateWordCount(); });
  editor.addEventListener('paste', e => {
    // Strip rich formatting on paste — paste plain text only
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  });
}

// ── Cover image ───────────────────────────────────────────────
function bindCoverImage() {
  const input   = document.getElementById('post-cover');
  const fileBtn = document.getElementById('cover-upload-btn');
  const fileIn  = document.getElementById('cover-file-input');

  input?.addEventListener('input', () => {
    updateCoverPreview(input.value.trim());
    markDirty();
  });

  fileBtn?.addEventListener('click', () => fileIn?.click());
  fileIn?.addEventListener('change', async () => {
    const file = fileIn.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error('Too large', 'Image must be under 5MB'); return; }

    // In demo mode fall back to local base64 preview only
    if (DEMO_MODE) {
      const reader = new FileReader();
      reader.onload = e => {
        const url = e.target.result;
        setVal('post-cover', url);
        updateCoverPreview(url);
        markDirty();
      };
      reader.readAsDataURL(file);
      return;
    }

    // Production: upload directly to Supabase Storage (same pattern as product images)
    // This avoids the /api/admin/upload serverless hop entirely — no 405 risk.
    fileBtn.disabled = true;
    const originalText = fileBtn.innerHTML;
    fileBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Uploading…';
    try {
      // Admin role verification (belt-and-suspenders; RLS enforces at DB level)
      const authCheck = await verifyAdminSession();
      if (!authCheck.ok) throw new Error(`Upload denied: ${authCheck.reason}`);

      const { getSupabase } = await import('../supabase.js');
      const sb = getSupabase();
      if (!sb) throw new Error('Supabase not initialised');

      const ext      = (file.name.match(/\.([a-z0-9]+)$/i) || [])[1] || 'jpg';
      const safeName = `${Date.now()}-${file.name.replace(/[^a-z0-9]/gi, '-').toLowerCase().slice(0, 40)}.${ext}`;
      const path     = `blog/${safeName}`;

      const { data, error } = await sb.storage
        .from('product-images')
        .upload(path, file, { contentType: file.type, cacheControl: '31536000', upsert: false });

      if (error) throw new Error(error.message);

      const { data: urlData } = sb.storage.from('product-images').getPublicUrl(data.path);
      const url = urlData.publicUrl;

      setVal('post-cover', url);
      updateCoverPreview(url);
      markDirty();
      toast.success('Uploaded', 'Cover image uploaded successfully');
    } catch (err) {
      toast.error('Upload failed', err.message || 'Could not upload image');
    } finally {
      fileBtn.disabled = false;
      fileBtn.innerHTML = originalText;
      fileIn.value = '';
    }
  });
}

function updateCoverPreview(url) {
  const wrap = document.getElementById('cover-preview-wrap');
  const img  = document.getElementById('cover-preview-img');
  const empty = document.getElementById('cover-preview-empty');
  if (!wrap) return;
  if (url) {
    if (img)   { img.src = url; img.style.display = 'block'; }  // FIX: '' reverts to CSS 'display:none'; must explicitly set 'block'
    if (empty) empty.style.display = 'none';
  } else {
    if (img)   img.style.display = 'none';
    if (empty) empty.style.display = 'flex';                    // FIX: wrap uses flexbox centering, so restore 'flex' not ''
  }
}

// ── Form submit ───────────────────────────────────────────────
function bindForm() {
  document.getElementById('blog-post-form')?.addEventListener('submit', e => {
    e.preventDefault();
    saveCurrentPost(true);
  });

  document.getElementById('save-draft-btn')?.addEventListener('click', () => {
    document.getElementById('post-published').checked = false;
    saveCurrentPost(true);
  });

  document.getElementById('publish-btn')?.addEventListener('click', () => {
    document.getElementById('post-published').checked = true;
    saveCurrentPost(true);
  });

  // CSP-safe replacements for inline onclick/onchange in blog-edit.html
  document.getElementById('heading-select')?.addEventListener('change', function () {
    document.execCommand('formatBlock', false, this.value);
    this.value = '';
  });
  document.getElementById('save-draft-btn-side')?.addEventListener('click', () => {
    document.getElementById('save-draft-btn')?.click();
  });
  document.getElementById('publish-btn-side')?.addEventListener('click', () => {
    document.getElementById('publish-btn')?.click();
  });
}

async function saveCurrentPost(showToast = false) {
  const title    = getVal('post-title');
  const content  = document.getElementById('rich-editor')?.innerHTML || '';

  if (!title.trim()) {
    toast.error('Required', 'Post title is required');
    document.getElementById('post-title')?.focus();
    return;
  }

  const slug = getVal('post-slug') || generatePostSlug(title);
  setVal('post-slug', slug);

  const now = new Date().toISOString();
  const saved = {
    id:         post?.id          || generatePostId(),
    title:      title.trim(),
    slug,
    category:   getVal('post-category') || 'Uncategorised',
    excerpt:    getVal('post-excerpt').trim(),
    content,
    coverImage: getVal('post-cover').trim(),
    author:     getVal('post-author').trim() || 'Manarize Team',
    readTime:   parseInt(getVal('post-read-time')) || 5,
    tags:       getVal('post-tags').split(',').map(t => t.trim()).filter(Boolean),
    seoTitle:   getVal('post-seo-title').trim(),
    seoDesc:    getVal('post-seo-desc').trim(),
    published:  document.getElementById('post-published').checked,
    featured:   document.getElementById('post-featured').checked,
    createdAt:  post?.createdAt || now,
    updatedAt:  now,
  };

  try {
    await savePost(saved);
  } catch (err) {
    console.error('[saveBlogPost] Supabase error:', err);
    toast.error('Save failed', err.message || 'Could not save post. Check your connection and try again.');
    return;
  }

  post     = saved;
  isDirty  = false;
  updateDirtyIndicator();

  if (showToast) {
    toast.success(saved.published ? 'Published!' : 'Draft saved',
      saved.published ? `"${saved.title}" is now live` : `"${saved.title}" saved as draft`);
  }

  // Update URL if new post
  if (!new URLSearchParams(window.location.search).get('id')) {
    history.replaceState({}, '', `blog-edit.html?id=${saved.id}`);
  }
}

// ── Auto-save every 30s if dirty ─────────────────────────────
function bindAutoSave() {
  autoSaveTimer = setInterval(() => {
    if (isDirty && getVal('post-title')) {
      saveCurrentPost(false);
      showAutoSaveFlash();
    }
  }, 30000);
}

function showAutoSaveFlash() {
  const el = document.getElementById('autosave-indicator');
  if (!el) return;
  el.textContent = 'Auto-saved';
  el.style.opacity = '1';
  setTimeout(() => { el.style.opacity = '0'; }, 2500);
}

// ── Word / char count ─────────────────────────────────────────
function initWordCount() {
  updateWordCount();
  ['post-title', 'post-seo-title', 'post-seo-desc', 'post-excerpt'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => {
      updateWordCount();
      markDirty();
    });
  });
}

function updateWordCount() {
  const editor  = document.getElementById('rich-editor');
  const countEl = document.getElementById('word-count');
  const text    = editor?.innerText || '';
  const words   = text.trim() ? text.trim().split(/\s+/).length : 0;
  if (countEl) countEl.textContent = `${words} word${words !== 1 ? 's' : ''}`;

  // Character counts for SEO fields
  updateCharCount('post-seo-title', 'seo-title-count', 60);
  updateCharCount('post-seo-desc',  'seo-desc-count',  160);
  updateCharCount('post-excerpt',   'excerpt-count',   200);
}

function updateCharCount(inputId, countId, max) {
  const el    = document.getElementById(inputId);
  const cnt   = document.getElementById(countId);
  if (!el || !cnt) return;
  const len   = el.value.length;
  cnt.textContent = `${len}/${max}`;
  cnt.style.color = len > max ? 'var(--clr-error)' : 'var(--clr-text-3)';
}

// ── Slug auto-generation ──────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const titleInput = document.getElementById('post-title');
  const slugInput  = document.getElementById('post-slug');
  let slugManual   = false;

  slugInput?.addEventListener('input', () => { slugManual = true; markDirty(); });

  titleInput?.addEventListener('input', () => {
    markDirty();
    if (!slugManual && !post) {
      slugInput.value = generatePostSlug(titleInput.value);
    }
  });
});

// ── Dirty tracking ────────────────────────────────────────────
function markDirty() {
  isDirty = true;
  updateDirtyIndicator();
}
function updateDirtyIndicator() {
  const el = document.getElementById('dirty-dot');
  if (el) el.style.display = isDirty ? 'inline-block' : 'none';
}

// ── Helpers ───────────────────────────────────────────────────
const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
const getVal = id          => document.getElementById(id)?.value?.trim() || '';

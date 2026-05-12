/* ============================================================
   ZENMARKET — ADMIN PRODUCT EDIT / CREATE  (fixed)
   ============================================================ */
import { requireAdmin, verifyAdminSession } from './admin-auth.js';
import { injectAdminLayout }  from './admin-layout.js';
import {
  getProducts, saveProduct, getCategories,
  generateProductId, generateSlug
} from '../store-adapter.js';
import { withLoader }  from '../loader.js';
import toast           from '../toast.js';

let product    = null;
let imageUrls  = [];   // array of URL strings or data: URIs
let variants   = [];

withLoader(async () => {
  if (!requireAdmin()) return;
  await injectAdminLayout('Product Edit');

  const params = new URLSearchParams(window.location.search);
  const id     = params.get('id');

  await populateCategories();

  if (id) {
    const products = await getProducts({ adminMode: true }); // include inactive products
    product = products.find(p => p.id === id);
    if (product) {
      document.getElementById('edit-page-title').textContent = 'Edit Product';
      document.getElementById('product-id-display').textContent = `ID: ${product.id}`;
      fillForm(product);
    } else {
      toast.error('Not found', `Product ${id} not found`);
    }
  } else {
    // New product — auto-generate ID
    const newId = await generateProductId();
    const idEl = document.getElementById('prod-id');
    if (idEl) idEl.value = newId;
  }

  bindNameToSlug();
  bindImageUpload();
  bindVariants();
  bindSaveButton();
  bindHashtagInput();
  bindSEOFields();
});

// ── Populate category dropdown ─────────────────────────────────
async function populateCategories() {
  const sel = document.getElementById('prod-category');
  if (!sel) return;

  try {
    const cats = await getCategories().catch(()=>[]);

    if (!cats || cats.length === 0) {
      sel.innerHTML = `<option value="">No categories found — add some in Categories</option>`;
      toast.error('No Categories', 'No categories found. Please add categories first.');
      return;
    }

    sel.innerHTML =
      `<option value="">Select Category</option>` +
      cats.map(c =>
        `<option value="${escHtml(c.name)}" data-slug="${escHtml(c.slug || '')}">${escHtml(c.name)}</option>`
      ).join('');
  } catch (err) {
    console.error('[populateCategories]', err);
    sel.innerHTML = `<option value="">Could not load categories</option>`;
    toast.error('Categories Error', 'Could not load categories. Check your Supabase connection and RLS policies.');
  }
}

// ── Fill form fields from existing product ─────────────────────
function fillForm(p) {
  setVal('prod-id',      p.id);
  setVal('prod-name',    p.name);
  setVal('prod-slug',    p.slug);
  setVal('prod-desc',    p.description || '');
  setVal('prod-sku',     p.sku || '');
  setVal('prod-weight',  p.weight || '');
  setVal('prod-tags',    (p.tags || []).join(', '));
  setVal('prod-price',   p.price);
  setVal('prod-compare', p.comparePrice || '');
  setVal('prod-stock',   p.stock);

  const activeCb   = document.getElementById('prod-active');
  const featuredCb = document.getElementById('prod-featured');
  if (activeCb)   activeCb.checked   = p.active !== false;
  if (featuredCb) featuredCb.checked = !!p.featured;

  // Category
  const catSel = document.getElementById('prod-category');
  if (catSel) {
    Array.from(catSel.options).forEach(opt => {
      opt.selected = opt.value === p.category;
    });
  }

  // Images
  imageUrls = Array.isArray(p.images) ? [...p.images] : [];
  renderImagePreviews();

  // Variants
  variants = JSON.parse(JSON.stringify(p.variants || []));
  renderVariants();

  // Hashtags
  if (p.hashtags && Array.isArray(p.hashtags)) {
    setHashtags(p.hashtags);
  }

  // SEO
  setVal('seo-title', p.seoTitle || '');
  setVal('seo-desc',  p.seoDesc  || '');
  updateSEOCounters();
  updateSEOPreview();
}

// ── Auto-generate slug from name ──────────────────────────────
function bindNameToSlug() {
  const nameEl = document.getElementById('prod-name');
  const slugEl = document.getElementById('prod-slug');
  if (!nameEl || !slugEl) return;
  nameEl.addEventListener('input', async () => {
    const prev = nameEl.dataset.prev || '';
    const prevSlug = await generateSlug(prev);
    if (!product || slugEl.value === prevSlug) {
      slugEl.value = await generateSlug(nameEl.value);
    }
    nameEl.dataset.prev = nameEl.value;
  });
}

// ── Image Upload (URL + File + Drag-and-drop → via Admin API) ────
// Images are uploaded directly to Supabase Storage using the anon client.
// The product-images bucket has a public SELECT policy for anon and
// INSERT/UPDATE/DELETE policies restricted to authenticated (admin) users
// (set in supabase-setup.sql § 18) so no service role key is needed.

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const BUCKET        = 'product-images';

/**
 * Upload one File directly to Supabase Storage (anon key, no serverless hop).
 * Returns the public CDN URL string.
 */
async function uploadImageToStorage(file) {
  const { DEMO_MODE } = await import('../config.js');

  // ── DEMO / local fallback ─────────────────────────────────────
  if (DEMO_MODE) {
    return URL.createObjectURL(file);
  }

  // ── Admin role verification (belt-and-suspenders; RLS is the real gate) ──
  const authCheck = await verifyAdminSession();
  if (!authCheck.ok) throw new Error(`Upload denied: ${authCheck.reason}`);

  // ── Production: direct Supabase Storage upload ────────────────
  const { getSupabase } = await import('../supabase.js');
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialised');

  const productId = document.getElementById('prod-id')?.value || 'new';
  const ext       = (file.name.match(/\.([a-z0-9]+)$/i) || [])[1] || 'jpg';
  const safeName  = `${Date.now()}-${file.name.replace(/[^a-z0-9]/gi, '-').toLowerCase().slice(0, 40)}.${ext}`;
  const path      = `products/${productId}/${safeName}`;

  const { data, error } = await sb.storage
    .from(BUCKET)
    .upload(path, file, {
      contentType:  file.type,
      cacheControl: '31536000',
      upsert:       false,
    });

  if (error) throw new Error(error.message);

  const { data: urlData } = sb.storage.from(BUCKET).getPublicUrl(data.path);
  return urlData.publicUrl;
}

function bindImageUpload() {
  const zone      = document.getElementById('upload-zone');
  const fileInput = document.getElementById('img-file-input');
  const urlInput  = document.getElementById('img-url-input');
  const addUrlBtn = document.getElementById('add-img-url-btn');

  // Click zone → open file picker
  zone?.addEventListener('click', e => {
    if (e.target !== urlInput && e.target !== addUrlBtn) fileInput?.click();
  });

  // Drag-over visual feedback
  zone?.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('dragover'); });
  // Only remove dragover when the pointer genuinely leaves the zone boundary.
  // Without the relatedTarget check, dragleave fires on every child element
  // entry (icon, text), causing the highlight to flicker and drop to misfire.
  zone?.addEventListener('dragleave', e => {
    if (!zone.contains(e.relatedTarget)) zone.classList.remove('dragover');
  });
  zone?.addEventListener('dragenter', e   => e.preventDefault());

  // Drop files
  zone?.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('dragover');
    handleFiles(e.dataTransfer.files);
  });

  // File picker change
  fileInput?.addEventListener('change', () => {
    if (fileInput.files.length) handleFiles(fileInput.files);
    fileInput.value = '';
  });

  // Add image by URL
  const doAddUrl = () => {
    const url = urlInput?.value.trim();
    if (!url) { toast.error('No URL', 'Please enter an image URL'); return; }
    if (!url.match(/^https?:\/\//i)) {
      toast.error('Invalid URL', 'URL must start with http:// or https://');
      return;
    }
    imageUrls.push(url);
    if (urlInput) urlInput.value = '';
    renderImagePreviews();
    toast.success('Added', 'Image URL added');
  };

  addUrlBtn?.addEventListener('click', doAddUrl);
  urlInput?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); doAddUrl(); }
  });
}

/**
 * Validate files then upload each one to Supabase Storage.
 * Shows per-file progress inside the upload zone.
 */
async function handleFiles(files) {
  const valid = Array.from(files).filter(file => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast.error('Invalid file', `${file.name} — unsupported format`);
      return false;
    }
    if (file.size > MAX_FILE_SIZE) {
      toast.error('Too large', `${file.name} exceeds 5 MB`);
      return false;
    }
    return true;
  });

  if (!valid.length) return;

  const zone = document.getElementById('upload-zone');
  if (zone) zone.classList.add('uploading');

  // Upload all valid files concurrently, collect results
  const results = await Promise.allSettled(
    valid.map(async file => {
      // Show per-file pending indicator
      const tmpId  = `img-tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      addPendingPreview(tmpId, file);

      const url = await uploadImageToStorage(file);
      imageUrls.push(url);
      removePendingPreview(tmpId);
      return url;
    })
  );

  if (zone) zone.classList.remove('uploading');

  const failed = results.filter(r => r.status === 'rejected');
  if (failed.length) {
    failed.forEach(r => console.error('[Image Upload]', r.reason));
    const firstReason = failed[0]?.reason?.message || 'Unknown error';
    toast.error('Upload failed', `${failed.length} image(s) could not be uploaded. ${firstReason}`);
  }

  renderImagePreviews();
}

/** Add a "uploading…" ghost card while a file is in-flight */
function addPendingPreview(id, file) {
  const container = document.getElementById('image-previews');
  if (!container) return;
  const div = document.createElement('div');
  div.id        = id;
  div.className = 'img-preview-item img-preview-item--pending';
  div.innerHTML = `
    <div class="img-upload-progress">
      <i class="fa-solid fa-spinner fa-spin" style="font-size:1.25rem;color:var(--clr-gold)"></i>
      <span>${file.name.length > 20 ? file.name.slice(0, 20) + '…' : file.name}</span>
    </div>`;
  container.appendChild(div);
}

function removePendingPreview(id) {
  document.getElementById(id)?.remove();
}

function renderImagePreviews() {
  const el = document.getElementById('image-previews');
  if (!el) return;

  // Remove only settled previews (keep any pending ones)
  el.querySelectorAll('.img-preview-item:not(.img-preview-item--pending)').forEach(n => n.remove());

  if (!imageUrls.length && !el.querySelector('.img-preview-item--pending')) {
    el.innerHTML = `<p style="color:var(--clr-text-3);font-size:.8125rem;padding:.5rem 0">No images yet. Add via URL or upload files above.</p>`;
    return;
  }

  // Prepend settled previews before any pending ones
  const fragment = document.createDocumentFragment();
  imageUrls.forEach((url, i) => {
    const div = document.createElement('div');
    div.className = 'img-preview-item';
    div.style.position = 'relative';
    div.innerHTML = `
      <img src="${url}" alt="Image ${i + 1}"
           data-err-fade>
      <button type="button" class="img-preview-remove"
              onclick="window._removeImg(${i})" title="Remove image">×</button>
      ${i === 0 ? `<span style="position:absolute;bottom:4px;left:4px;background:var(--clr-gold);color:#000;font-size:.6rem;padding:1px 4px;border-radius:3px;font-weight:700">MAIN</span>` : ''}`;
    fragment.appendChild(div);
  });
  el.prepend(fragment);
}

window._removeImg = i => {
  imageUrls.splice(i, 1);
  renderImagePreviews();
};

// ── Variants ──────────────────────────────────────────────────
function bindVariants() {
  document.getElementById('add-variant-btn')?.addEventListener('click', () => {
    variants.push({ name: '', options: [] });
    renderVariants();
    // Focus the new name input
    const inputs = document.querySelectorAll('.variant-name-input');
    inputs[inputs.length - 1]?.focus();
  });
}

function renderVariants() {
  const el = document.getElementById('variants-list');
  if (!el) return;

  if (!variants.length) {
    el.innerHTML = `<p style="color:var(--clr-text-3);font-size:.875rem;padding:.25rem 0">
      No variants. Add colour, size, or other options above.
    </p>`;
    return;
  }

  el.innerHTML = variants.map((v, i) => `
    <div style="padding:1rem;background:var(--clr-bg-2);border:1px solid var(--clr-border);border-radius:var(--r-md);margin-bottom:.75rem">
      <div style="display:flex;gap:.75rem;margin-bottom:.75rem;align-items:center">
        <input class="form-control variant-name-input" type="text"
               placeholder="Variant name (e.g. Color)"
               value="${escHtml(v.name)}"
               oninput="window._updateVariantName(${i}, this.value)"
               style="max-width:200px">
        <button type="button" class="btn btn-ghost btn-sm" onclick="window._removeVariant(${i})"
                style="color:var(--clr-error);flex-shrink:0">
          <i class="fa-solid fa-trash"></i> Remove
        </button>
      </div>
      <input class="form-control" type="text"
             placeholder="Options — comma separated (e.g. Red, Blue, Green)"
             value="${escHtml(v.options.join(', '))}"
             oninput="window._updateVariantOptions(${i}, this.value)">
    </div>`).join('');
}

window._updateVariantName    = (i, v) => { variants[i].name = v; };
window._updateVariantOptions = (i, v) => { variants[i].options = v.split(',').map(s => s.trim()).filter(Boolean); };
window._removeVariant        = i      => { variants.splice(i, 1); renderVariants(); };

// ── Save button ───────────────────────────────────────────────
function bindSaveButton() {
  const btn = document.getElementById('save-product-btn');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    const name  = getVal('prod-name').trim();
    const price = parseFloat(getVal('prod-price'));
    const stock = parseInt(getVal('prod-stock'), 10);
    const catEl = document.getElementById('prod-category');

    // Validation
    const errors = [];
    if (!name)           errors.push('Product name is required');
    if (isNaN(price) || price < 0) errors.push('Valid price is required');
    if (isNaN(stock) || stock < 0) errors.push('Valid stock quantity is required');
    if (!catEl?.value)   errors.push('Category is required');

    if (errors.length) {
      toast.error('Validation Error', errors.join(' · '));
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Saving…';

    try {
      const catOpt   = catEl.options[catEl.selectedIndex];
      const catSlug  = catOpt?.getAttribute('data-slug') || await generateSlug(catEl.value);
      const prodId   = getVal('prod-id') || await generateProductId();
      const rawSlug  = getVal('prod-slug').trim();
      const slug     = rawSlug || await generateSlug(name);
      const compare  = parseFloat(getVal('prod-compare')) || null;
      const tags     = getVal('prod-tags').split(',').map(s => s.trim()).filter(Boolean);

      const updated = {
        ...(product || {}),
        id:           prodId,
        name,
        slug,
        description:  getVal('prod-desc').trim(),
        sku:          getVal('prod-sku').trim() || `SKU-${prodId}`,
        weight:       getVal('prod-weight').trim(),
        tags,
        hashtags:     getHashtags(),
        price,
        comparePrice: compare,
        stock:        isNaN(stock) ? 0 : stock,
        category:     catEl.value,
        categorySlug: catSlug,
        active:       document.getElementById('prod-active')?.checked !== false,
        featured:     !!document.getElementById('prod-featured')?.checked,
        images:       imageUrls.length
                        ? imageUrls
                        : ['https://images.unsplash.com/photo-1546868871-7041f2a55e12?w=600&q=80'],
        variants:     variants.filter(v => v.name),   // discard unnamed variants
        seoTitle:     getVal('seo-title').trim(),
        seoDesc:      getVal('seo-desc').trim(),
        // Preserve existing rating/review/creation data when editing.
        // mapProductRow always maps review_count → reviewCount, so camelCase
        // fields are the canonical source here. New products start at 0, not 4.5.
        rating:       product?.rating      ?? 0,
        reviewCount:  product?.reviewCount ?? 0,
        createdAt:    product?.createdAt   ?? new Date().toISOString(),
        updatedAt:    new Date().toISOString(),
      };

      await saveProduct(updated);
      toast.success('Saved!', `"${name}" has been saved successfully`);

      // Redirect after short delay
      setTimeout(() => { window.location.href = '/admin/products'; }, 900);
    } catch (err) {
      console.error('[Save Product]', err);
      toast.error('Save failed', err.message || 'Could not save product. Check your Supabase connection.');
      btn.disabled = false;
      btn.textContent = 'Save Product';
    }
  });
}

// ── Hashtag Input ─────────────────────────────────────────────
let _hashtags = [];

function getHashtags() { return [..._hashtags]; }

function setHashtags(arr) {
  _hashtags = arr.map(normaliseTag).filter(Boolean);
  renderHashtags();
}

function normaliseTag(raw) {
  // Ensure single leading #, lowercase, no spaces
  const clean = String(raw).trim().replace(/^#+/, '').replace(/\s+/g, '-').toLowerCase();
  return clean ? `#${clean}` : '';
}

function renderHashtags() {
  const pills = document.getElementById('hashtag-pills');
  if (!pills) return;
  pills.innerHTML = _hashtags.map((tag, i) => `
    <span class="hashtag-pill">
      ${escHtml(tag)}
      <button type="button" class="hashtag-pill__remove" data-idx="${i}" aria-label="Remove ${tag}">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </span>`).join('');
  // update hidden input for form serialisation
  const hidden = document.getElementById('prod-hashtags');
  if (hidden) hidden.value = _hashtags.join(' ');
}

function addHashtag(raw) {
  const tag = normaliseTag(raw);
  if (!tag || _hashtags.includes(tag)) return;
  _hashtags.push(tag);
  renderHashtags();
}

function bindHashtagInput() {
  const wrap  = document.getElementById('hashtag-wrap');
  const input = document.getElementById('hashtag-input');
  const pills = document.getElementById('hashtag-pills');
  if (!input || !wrap || !pills) return;

  // Click on wrap focuses the input
  wrap.addEventListener('click', () => input.focus());

  // Remove pill on × click
  pills.addEventListener('click', e => {
    const btn = e.target.closest('.hashtag-pill__remove');
    if (!btn) return;
    const idx = parseInt(btn.dataset.idx, 10);
    _hashtags.splice(idx, 1);
    renderHashtags();
  });

  // Add tag on Enter / Space / comma
  input.addEventListener('keydown', e => {
    if (['Enter', ' ', ','].includes(e.key)) {
      e.preventDefault();
      const val = input.value.trim();
      if (val) { addHashtag(val); input.value = ''; }
    }
    // Backspace on empty input removes last tag
    if (e.key === 'Backspace' && !input.value && _hashtags.length) {
      _hashtags.pop();
      renderHashtags();
    }
  });

  // Also add on blur
  input.addEventListener('blur', () => {
    const val = input.value.trim();
    if (val) { addHashtag(val); input.value = ''; }
  });
}

// ── SEO Fields ────────────────────────────────────────────────
function updateSEOCounters() {
  const titleEl = document.getElementById('seo-title');
  const descEl  = document.getElementById('seo-desc');
  const tc      = document.getElementById('seo-title-count');
  const dc      = document.getElementById('seo-desc-count');
  if (titleEl && tc) {
    const len = titleEl.value.length;
    tc.textContent = `${len} / 70`;
    tc.className   = `seo-counter ${len > 70 ? 'over' : len >= 50 ? 'good' : ''}`;
  }
  if (descEl && dc) {
    const len = descEl.value.length;
    dc.textContent = `${len} / 160`;
    dc.className   = `seo-counter ${len > 160 ? 'over' : len >= 120 ? 'good' : ''}`;
  }
}

async function updateSEOPreview() {
  const rawSlug  = getVal('prod-slug');
  const prodName = getVal('prod-name');
  const slug     = rawSlug || (prodName ? await generateSlug(prodName) : 'product-slug');
  const title    = getVal('seo-title') || getVal('prod-name') || 'Product title will appear here';
  const desc     = getVal('seo-desc')  || 'Meta description will appear here. Make it compelling to improve click-through rate from Google.';

  const slugEl  = document.getElementById('seo-preview-slug');
  const titleEl = document.getElementById('seo-preview-title');
  const descEl  = document.getElementById('seo-preview-desc');

  if (slugEl)  slugEl.textContent  = slug;
  if (titleEl) titleEl.textContent = title.length > 60 ? title.slice(0, 60) + '…' : title;
  if (descEl)  descEl.textContent  = desc.length  > 155 ? desc.slice(0, 155) + '…' : desc;
}

function bindSEOFields() {
  const titleEl = document.getElementById('seo-title');
  const descEl  = document.getElementById('seo-desc');
  const slugEl  = document.getElementById('prod-slug');

  [titleEl, descEl, slugEl].forEach(el => {
    if (!el) return;
    el.addEventListener('input', () => {
      updateSEOCounters();
      updateSEOPreview();
    });
  });

  // Auto-populate meta title from product name if empty
  const nameEl = document.getElementById('prod-name');
  if (nameEl) {
    nameEl.addEventListener('input', () => {
      if (titleEl && !titleEl.value) {
        titleEl.value = nameEl.value;
        updateSEOCounters();
      }
      updateSEOPreview();
    });
  }

  updateSEOCounters();
  updateSEOPreview();
}

// ── Helpers ───────────────────────────────────────────────────
function setVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val ?? '';
}
function getVal(id) {
  return document.getElementById(id)?.value ?? '';
}
function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

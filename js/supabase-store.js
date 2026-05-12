/* ============================================================
   ZENMARKET — SUPABASE DATA LAYER  (v29 — Production)
   ============================================================
   This module provides the same API as js/store.js but reads
   from / writes to Supabase (PostgreSQL) instead of localStorage.

   USAGE:
     import { getProducts, saveOrder } from './supabase-store.js';

   DEMO_MODE vs PRODUCTION:
     js/store.js     → localStorage (DEMO_MODE=true, default)
     this file       → Supabase     (DEMO_MODE=false, production)

   The calling code in shop.js, product.js, checkout.js etc. should
   import from the correct module based on DEMO_MODE, or use the
   unified adapter in store-adapter.js (recommended).

   SUPABASE TABLE SETUP:
     Run the SQL in ZENMARKET.md § 20 "Supabase Production Database"
     before using this module.
   ============================================================ */

import { getSupabase, query, querySafe } from './supabase.js';

// ── Row mappers — convert Supabase snake_case → app camelCase ────────
// Supabase returns column names exactly as defined in Postgres (snake_case).
// Every other module in the app uses camelCase. These mappers are the single
// translation layer so the rest of the codebase never needs to change.

function mapProductRow(row) {
  if (!row) return null;
  return {
    // Direct 1-to-1 fields (same name in DB and app)
    id:           row.id,
    name:         row.name,
    slug:         row.slug,
    description:  row.description,
    price:        row.price,
    stock:        row.stock,
    category:     row.category,
    sku:          row.sku,
    weight:       row.weight,
    tags:         row.tags         || [],
    hashtags:     row.hashtags     || [],
    images:       row.images       || [],
    variants:     row.variants     || [],
    active:       row.active,
    featured:     row.featured,
    rating:       row.rating       ?? 0,
    // snake_case → camelCase conversions
    comparePrice: row.compare_price  ?? null,
    categorySlug: row.category_slug  ?? null,
    reviewCount:  row.review_count   ?? 0,
    seoTitle:     row.seo_title      ?? null,
    seoDesc:      row.seo_desc       ?? null,
    createdAt:    row.created_at     ?? null,
    updatedAt:    row.updated_at     ?? null,
  };
}

function mapReviewRow(row) {
  if (!row) return null;
  return {
    ...row,
    productId: row.product_id  ?? row.productId  ?? null,
    userName:  row.user_name   ?? row.userName   ?? 'Anonymous',
    text:      row.body        ?? row.text        ?? '',
    createdAt: row.created_at  ?? row.createdAt  ?? null,
    updatedAt: row.updated_at  ?? row.updatedAt  ?? null,
  };
}




// ── Products ──────────────────────────────────────────────────────

// In-memory TTL cache for the unfiltered storefront product list.
// Avoids a Supabase round-trip on every page navigation.
// Invalidated after save/delete or after PRODUCT_CACHE_TTL ms.
let _productCache    = null;
let _productCacheTs  = 0;
const PRODUCT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ── Category cache — categories almost never change ──────────────
let _categoryCache   = null;
let _categoryCacheTs = 0;
const CATEGORY_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// ── Site settings cache — changes rarely ─────────────────────────
let _settingsCache   = null;
let _settingsCacheTs = 0;
const SETTINGS_CACHE_TTL = 15 * 60 * 1000; // 15 minutes

/** Force-expire the product cache (call after save/delete). */
export function invalidateProductCache() {
  _productCache   = null;
  _productCacheTs = 0;
}

/** Force-expire the category cache (call after category save/delete). */
export function invalidateCategoryCache() {
  _categoryCache   = null;
  _categoryCacheTs = 0;
}

/** Force-expire the settings cache (call after settings save). */
export function invalidateSettingsCache() {
  _settingsCache   = null;
  _settingsCacheTs = 0;
}

// Columns fetched for the storefront list view.
// Omits 'description' (large text) — loaded only on the single-product page.
const PRODUCT_LIST_COLS =
  'id,name,slug,price,stock,category,category_slug,images,featured,' +
  'rating,review_count,active,tags,hashtags,sku,variants,weight,created_at';

/**
 * Fetch all active products.
 * @param {{ category?: string, limit?: number, featured?: boolean, adminMode?: boolean }} opts
 * @returns {Promise<object[]>}
 */
export async function getProducts({ category, limit, featured, adminMode = false } = {}) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialised');

  // Return cached list for unfiltered storefront requests (most common path).
  const canCache = !adminMode && !category && !featured && !limit;
  if (canCache && _productCache && (Date.now() - _productCacheTs) < PRODUCT_CACHE_TTL) {
    return _productCache;
  }

  // Admin gets full rows; storefront gets lean column list (no large description).
  const cols = adminMode ? '*' : PRODUCT_LIST_COLS;

  let q = sb
    .from('products')
    .select(cols)
    .order('created_at', { ascending: false });

  // Storefront only shows active products; admin bypasses this filter
  if (!adminMode) q = q.eq('active', true);

  if (category) q = q.eq('category_slug', category);
  if (featured)  q = q.eq('featured', true);
  if (limit)     q = q.limit(limit);

  const rows = await query(q);
  const mapped = rows.map(mapProductRow);

  if (canCache) { _productCache = mapped; _productCacheTs = Date.now(); }
  return mapped;
}

/**
 * Fetch a single product by slug or id.
 * @param {{ slug?: string, id?: string, adminMode?: boolean }} opts
 * @returns {Promise<object|null>}
 */
export async function getProduct({ slug, id, adminMode = false } = {}) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialised');

  let q = sb.from('products').select('*');
  // Storefront only shows active products; admin can fetch inactive ones too
  if (!adminMode) q = q.eq('active', true);
  if (slug) q = q.eq('slug', slug).maybeSingle();
  else if (id) q = q.eq('id', id).maybeSingle();
  else throw new Error('getProduct requires slug or id');

  const row = await querySafe(q);
  return mapProductRow(row);
}

/**
 * Search products by name (case-insensitive partial match).
 * @param {string} term
 * @param {{ limit?: number }} opts
 * @returns {Promise<object[]>}
 */
export async function searchProducts(term, { limit = 20 } = {}) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialised');

  const trimmed = (term || '').trim();
  if (!trimmed) return [];

  // Full-text search via the generated `fts` tsvector column + GIN index.
  // `:*` suffix enables prefix matching — requires raw tsquery (no type:'websearch').
  const tsQuery = trimmed.split(/\s+/).filter(Boolean).map(w => w + ':*').join(' & ');

  let rows = await query(
    sb.from('products')
      .select(PRODUCT_LIST_COLS)
      .eq('active', true)
      .textSearch('fts', tsQuery, { config: 'english' })
      .limit(limit)
  ).catch(() => null);

  // Fall back to ilike if FTS fails OR returns no results
  if (!rows || !rows.length) {
    rows = await query(
      sb.from('products')
        .select(PRODUCT_LIST_COLS)
        .eq('active', true)
        .ilike('name', `%${trimmed}%`)
        .limit(limit)
    ).catch(() => []);
  }

  return (rows || []).map(mapProductRow);
}

/**
 * Decrement stock after a successful order.
 * Called server-side via the PayHere webhook or after payment confirmation.
 * @param {{ productId: string, qty: number }[]} items
 */
export async function decrementStock(items) {
  const sb = getSupabase();
  if (!sb) return;

  await Promise.all(
    items.map(({ productId, qty }) =>
      sb.rpc('decrement_stock', { product_id: productId, amount: qty })
    )
  );
}

// ── Orders ────────────────────────────────────────────────────────

/**
 * Save a new order to Supabase.
 * @param {object} order
 * @returns {Promise<object>} Saved order row
 */
export async function saveOrder(order) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialised');

  const row = {
    ...orderToRow(order),
    created_at: order.createdAt || new Date().toISOString(),
  };

  // INSERT first; fall back to UPDATE on duplicate ID (idempotent retry)
  const { error: insErr } = await sb.from('orders').insert(row);
  if (!insErr) return order;

  if (insErr.code === '23505') {
    const { error: updErr } = await sb
      .from('orders')
      .update({ ...row, updated_at: new Date().toISOString() })
      .eq('id', order.id);
    if (updErr) throw new Error(updErr.message);
    return order;
  }
  throw new Error(insErr.message);
}

/**
 * Fetch orders for the currently logged-in customer.
 * @returns {Promise<object[]>}
 */
export async function getMyOrders(fallbackUserId) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialised');

  // Prefer the Supabase JWT user; fall back to the ID stored in localStorage
  // (covers the case where the customer signed in via the custom auth flow
  //  and Supabase does not have an active browser session cookie).
  let userId = fallbackUserId || null;
  try {
    const { data } = await sb.auth.getUser();
    if (data?.user?.id) userId = data.user.id;
  } catch (_) { /* ignore — use fallbackUserId */ }

  if (!userId) return [];

  const rows = await query(
    sb.from('orders')
      .select('*')
      .eq('customer_id', userId)
      .order('created_at', { ascending: false })
  );
  return rows.map(mapOrderRow);
}

/**
 * Fetch a single order by ID.
 * Returns null (not an exception) when the order doesn't exist or isn't visible.
 * @param {string} orderId
 * @returns {Promise<object|null>}
 */
export async function getOrder(orderId) {
  if (!orderId) return null;
  const sb = getSupabase();
  if (!sb) {
    // Demo / localStorage mode — fall through to store.js via adapter
    throw new Error('Supabase not initialised');
  }

  const row = await querySafe(
    sb.from('orders').select('*').eq('id', orderId).maybeSingle()
  );
  if (row) return mapOrderRow(row);

  // Order not found in Supabase — check localStorage emergency fallback
  // (used when all Supabase paths failed at checkout time)
  try {
    const local = JSON.parse(localStorage.getItem('zm_orders') || '[]');
    if (Array.isArray(local)) {
      const found = local.find(o => o.id === orderId);
      if (found) return found; // already camelCase from checkout.js
    }
  } catch (_) { /* ignore */ }

  return null;
}

// ── Categories ────────────────────────────────────────────────────

/**
 * Fetch all categories.
 * Returns all rows (active and inactive) so admin dropdowns show everything.
 * @returns {Promise<object[]>}
 */
export async function getCategories() {
  // Return cached categories — they change very rarely (10 min TTL)
  if (_categoryCache && (Date.now() - _categoryCacheTs) < CATEGORY_CACHE_TTL) {
    return _categoryCache;
  }

  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialised');

  // Only fetch columns we actually use — skip description + timestamps
  const data = await query(
    sb.from('categories')
      .select('id,name,slug,icon,active,sort_order,parent_id')
      .order('sort_order', { ascending: true })
  );

  if (!Array.isArray(data)) return [];

  // Build nested structure: parent categories with subcategories[] array
  // matching the shape admin-categories.js and shop.js expect.
  const parents = data.filter(r => !r.parent_id);
  const result = parents.map(p => ({
    id:            p.id,
    name:          p.name,
    slug:          p.slug,
    icon:          p.icon  || 'fa-solid fa-tag',
    isDefault:     false,           // not stored in DB; default to false
    active:        p.active !== false,
    subcategories: data
      .filter(r => r.parent_id === p.id)
      .map(s => ({ id: s.id, name: s.name, slug: s.slug })),
  }));

  _categoryCache   = result;
  _categoryCacheTs = Date.now();
  return result;
}

/**
 * Persist the full nested category list to Supabase.
 * Called by admin-categories page when categories are added/edited/deleted.
 * Maps the nested app structure back to flat DB rows using parent_id.
 * @param {object[]} cats  — nested category array from admin-categories.js
 */
export async function saveCategories(cats) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialised');
  if (!Array.isArray(cats)) return;

  // Flatten nested structure → DB rows
  const rows   = [];
  const allIds = new Set();

  cats.forEach((cat, i) => {
    allIds.add(cat.id);
    rows.push({
      id:         cat.id,
      name:       cat.name,
      slug:       cat.slug,
      icon:       cat.icon || null,
      parent_id:  null,
      active:     cat.active !== false,
      sort_order: i,
    });
    (cat.subcategories || []).forEach((sub, j) => {
      allIds.add(sub.id);
      rows.push({
        id:         sub.id,
        name:       sub.name,
        slug:       sub.slug,
        icon:       null,
        parent_id:  cat.id,
        active:     true,
        sort_order: j,
      });
    });
  });

  // Delete categories that were removed from the list
  const { data: existing } = await sb.from('categories').select('id');
  const existingIds = (existing || []).map(r => r.id);
  const toDelete    = existingIds.filter(id => !allIds.has(id));
  if (toDelete.length) {
    const { error: delErr } = await sb.from('categories').delete().in('id', toDelete);
    if (delErr) throw new Error(delErr.message);
  }

  // Upsert all current categories
  if (rows.length) {
    const { error: upsErr } = await sb
      .from('categories')
      .upsert(rows, { onConflict: 'id' });
    if (upsErr) throw new Error(upsErr.message);
  }
}

// ── Coupons ───────────────────────────────────────────────────────

/**
 * Look up a coupon by code and validate it.
 * @param {string} code
 * @returns {Promise<object|null>}
 */
export async function getCoupon(code) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialised');

  const coupon = await querySafe(
    sb.from('coupons')
      .select('*')
      .eq('code', code.toUpperCase())
      .eq('active', true)
      .maybeSingle()
  );

  if (!coupon) return null;

  // Check expiry
  if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
    return null;
  }

  // Check usage limit
  if (coupon.max_uses && coupon.used_count >= coupon.max_uses) {
    return null;
  }

  return coupon;
}

/**
 * Increment a coupon's used_count after successful order.
 * @param {string} couponCode
 */
export async function incrementCouponUsage(couponCode) {
  const sb = getSupabase();
  if (!sb) return;
  await sb.rpc('increment_coupon_usage', { coupon_code: couponCode });
}

// ── Shipping Zones ────────────────────────────────────────────────

/**
 * Fetch all shipping zones.
 * @returns {Promise<object[]>}
 */
export async function getShippingZones() {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialised');

  const rows = await query(
    sb.from('shipping_zones').select('*').order('rate', { ascending: true })
  );
  return rows.map(mapShippingZoneRow);
}

function mapShippingZoneRow(row) {
  if (!row) return null;
  return {
    id:        row.id,
    name:      row.name,
    districts: row.districts  || row.provinces  || [],
    rate:      row.rate       ?? 0,
    freeAbove: row.free_above ?? null,
    // DB columns are min_days / max_days; app uses minDays / maxDays
    // Auto-correct corrupted data where min exceeds max
    minDays:   Math.min(row.min_days ?? row.minDays ?? 1, row.max_days ?? row.maxDays ?? 7),
    maxDays:   Math.max(row.max_days ?? row.maxDays ?? 7, row.min_days ?? row.minDays ?? 1),
    active:    row.active     !== false,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

// ── Reviews ───────────────────────────────────────────────────────

/**
 * Fetch approved reviews for a product.
 * @param {string} productId
 * @returns {Promise<object[]>}
 */
export async function getProductReviews(productId) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialised');

  const rows = await query(
    sb.from('reviews')
      .select('*')
      .eq('product_id', productId)
      .eq('approved', true)
      .order('created_at', { ascending: false })
  );
  return rows.map(mapReviewRow);
}

/**
 * Submit a new product review.
 * @param {object} review
 * @returns {Promise<object>}
 */
export async function submitReview(review) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialised');

  const { data, error } = await sb
    .from('reviews')
    .insert({
      ...review,
      approved:   false,
      rejected:   false,
      created_at: new Date().toISOString(),
    })
    .select()
    .maybeSingle();

  if (error) throw new Error(error.message);
  return mapReviewRow(data);
}

// ── Customer Profile ──────────────────────────────────────────────

/**
 * Fetch the current user's profile.
 * @returns {Promise<object|null>}
 */
export async function getProfile() {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialised');

  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;

  return querySafe(
    sb.from('profiles').select('*').eq('id', user.id).maybeSingle()
  );
}

/**
 * Update the current user's profile.
 * @param {{ name?: string, phone?: string }} updates
 * @returns {Promise<object>}
 */
export async function updateProfile(updates) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialised');

  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await sb
    .from('profiles')
    .upsert({ id: user.id, ...updates })
    .select()
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

// ── Contact Messages ──────────────────────────────────────────────

/**
 * Save a contact form submission.
 * @param {object} msg
 * @returns {Promise<object>}
 */
export async function saveContactMessage(msg) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialised');

  const { data, error } = await sb
    .from('contact_messages')
    .insert({ ...msg, read: false, created_at: new Date().toISOString() })
    .select()
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

// ── Admin: Save / Delete Products ────────────────────────────────

/**
 * Upsert a product to Supabase.
 * Accepts the camelCase object used throughout the admin UI and maps
 * it to the snake_case column names in the `products` table.
 * @param {object} product
 * @returns {Promise<object>} Saved product row
 */
export async function saveProduct(product) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialised');
  invalidateProductCache();

  const row = {
    id:            product.id,
    name:          product.name,
    slug:          product.slug,
    description:   product.description   || null,
    price:         product.price,
    compare_price: product.comparePrice  || null,
    stock:         product.stock         ?? 0,
    category:      product.category      || null,
    category_slug: product.categorySlug  || null,
    sku:           product.sku           || null,
    weight:        product.weight        || null,
    tags:          product.tags          || [],
    hashtags:      product.hashtags      || [],
    images:        product.images        || [],
    variants:      product.variants      || [],
    active:        product.active        !== false,
    featured:      !!product.featured,
    rating:        product.rating        ?? 0,
    review_count:  product.reviewCount   ?? 0,
    seo_title:     product.seoTitle      || null,
    seo_desc:      product.seoDesc       || null,
    created_at:    product.createdAt     || new Date().toISOString(),
    updated_at:    new Date().toISOString(),
  };

  const { data, error } = await sb
    .from('products')
    .upsert(row, { onConflict: 'id' })
    .select()
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

/**
 * Delete a product by ID.
 * @param {string} id
 */
export async function deleteProduct(id) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialised');
  invalidateProductCache();
  const { error } = await sb.from('products').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/**
 * Generate a unique product ID based on current timestamp.
 * (In production we don't have localStorage to count from, so we use
 * a short time-based suffix instead.)
 */
export function generateProductId() {
  return `PRD-${Date.now().toString(36).toUpperCase().slice(-6)}`;
}

/**
 * Convert a display name to a URL-safe slug.
 * @param {string} name
 * @returns {string}
 */
export function generateSlug(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// ── Supabase SQL Functions (run once in SQL editor) ───────────────
/*
  -- Required for decrementStock() and incrementCouponUsage() above:

  CREATE OR REPLACE FUNCTION decrement_stock(product_id text, amount integer)
  RETURNS void LANGUAGE sql AS $$
    UPDATE products
    SET stock = GREATEST(0, stock - amount), updated_at = now()
    WHERE id = product_id;
  $$;

  CREATE OR REPLACE FUNCTION increment_coupon_usage(coupon_code text)
  RETURNS void LANGUAGE sql AS $$
    UPDATE coupons
    SET used_count = used_count + 1
    WHERE code = coupon_code;
  $$;
*/

// ══════════════════════════════════════════════════════════════
// SECTION: Admin-facing functions added to complete Supabase
// migration (orders admin, coupons admin, shipping admin,
// blog posts, notifications, site settings, users admin)
// ══════════════════════════════════════════════════════════════

// ── Orders (admin) ────────────────────────────────────────────

/**
 * Get ALL orders (admin view — no user filter).
 */
export async function getOrders() {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialised');
  const { data, error } = await sb
    .from('orders')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []).map(mapOrderRow);
}

/**
 * Save a new order (INSERT). Used by checkout.
 * Falls back to UPDATE on duplicate ID (idempotent retry).
 * Using INSERT avoids the ON CONFLICT DO UPDATE path that can trip RLS
 * UPDATE policies even when no conflict actually occurs.
 * @param {object} order - full order object (camelCase)
 */
export async function saveOneOrder(order) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialised');
  const row = orderToRow(order);

  // Ensure the Supabase client has the current auth session before inserting.
  // Without this, the client may use the anon role even when the user is logged in,
  // which can fail RLS policies that check auth.uid().
  try {
    const { data: sessionData } = await sb.auth.getSession();
    if (sessionData?.session) {
      await sb.auth.setSession(sessionData.session);
    }
  } catch (_) { /* non-critical — proceed without session */ }

  // INSERT first — correct path for new orders placed at checkout
  const { error: insertErr } = await sb.from('orders').insert(row);

  if (!insertErr) return; // success

  // Duplicate ID (retry / double-submit) — fall through to UPDATE
  if (insertErr.code === '23505') {
    const { error: updateErr } = await sb
      .from('orders')
      .update({ ...row, updated_at: new Date().toISOString() })
      .eq('id', order.id);
    if (updateErr) {
      console.error('[Supabase] saveOneOrder update error:', updateErr.code, updateErr.message);
      throw new Error(updateErr.message);
    }
    return;
  }

  console.error('[Supabase] saveOneOrder insert error:', insertErr.code, insertErr.message, insertErr.details,
    '\n→ If code is 42501 or "permission denied": run supabase-setup.sql in Supabase SQL Editor',
    '\n→ If code is 42P01 ("relation does not exist"): orders table missing — run supabase-setup.sql');
  throw new Error(insertErr.message);
}

/**
 * Update specific fields on an order row.
 * @param {string} id
 * @param {object} fields - snake_case column map
 */
// C-1 FIX: updateOrder / deleteOrder now route through the /api/admin/orders
// serverless endpoint (service role key, bypasses RLS).
// Direct anon-key mutations on orders are blocked by RLS — anon INSERT only.
async function _adminFetch(path, options = {}) {
  const token = (typeof sessionStorage !== 'undefined'
    ? sessionStorage.getItem('zm_admin_api_token')
    : null) || '';
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token, ...(options.headers || {}) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function updateOrder(id, fields) {
  await _adminFetch(`/api/admin/orders?id=${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(fields),
  });
}

/**
 * Delete an order by ID via the service-role admin API.
 */
export async function deleteOrder(id) {
  await _adminFetch(`/api/admin/orders?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

/**
 * Delete multiple orders by ID array via the service-role admin API.
 */
export async function deleteOrders(ids) {
  await _adminFetch('/api/admin/orders', {
    method: 'DELETE',
    body: JSON.stringify({ ids }),
  });
}

// ── Row mappers for orders ────────────────────────────────────
function mapOrderRow(row) {
  if (!row) return null;
  return {
    id:            row.id,
    customerId:    row.customer_id,
    customerName:  row.customer_name   || '',
    customerEmail: row.customer_email  || '',
    customerPhone: row.customer_phone  || '',
    items:         row.items           || [],
    subtotal:      row.subtotal        || 0,
    shipping:      row.shipping        || 0,   // was "shippingCost" — fixed for consistency
    discount:      row.discount        || 0,
    total:         row.total           || 0,
    status:        row.status          || 'pending',
    paymentStatus: row.payment_status  || 'pending',
    paymentMethod: row.payment_method  || '',
    coupon:        row.coupon_code     || '',   // align with checkout.js key "coupon"
    bankRef:       row.bank_ref        || null,
    paymentSlip:   row.payment_slip    || null,
    address:       row.address         || {},
    notes:         row.notes           || '',
    createdAt:     row.created_at,
    updatedAt:     row.updated_at,
  };
}

function orderToRow(o) {
  return {
    id:             o.id,
    customer_id:    o.customerId    || null,
    customer_name:  o.customerName  || '',
    customer_email: o.customerEmail || '',
    customer_phone: o.customerPhone || '',
    items:          o.items         || [],
    subtotal:       o.subtotal      || 0,
    shipping:       o.shipping      || o.shippingCost || 0,
    discount:       o.discount      || 0,
    total:          o.total         || 0,
    status:         o.status        || 'pending',
    payment_status: o.paymentStatus || 'pending',
    payment_method: o.paymentMethod || '',
    coupon_code:    o.couponCode    || o.coupon    || '',
    bank_ref:       o.bankRef       || o.bank_ref  || null,
    payment_slip:   o.paymentSlip   || null,
    address:        o.address       || {},
    notes:          o.notes         || '',
    created_at:     o.createdAt     || new Date().toISOString(),
    updated_at:     new Date().toISOString(),
  };
}

// ── Coupons (admin full CRUD) ─────────────────────────────────

/**
 * Get all coupons (admin view).
 */
export async function getCoupons() {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialised');
  const { data, error } = await sb
    .from('coupons')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []).map(row => ({
    id:       row.id,
    code:     row.code,
    type:     row.type,
    value:    row.value,
    minOrder: row.min_order   || 0,
    maxUses:  row.max_uses    || 0,
    used:     row.used_count  || 0,
    active:   row.active      !== false,
    expires:  row.expires_at  || '',
    createdAt:row.created_at,
  }));
}

/**
 * Save (upsert) all coupons — mirrors the localStorage saveCoupons API.
 */
export async function saveCoupons(coupons) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialised');
  const rows = coupons.map(c => ({
    id:          c.id,
    code:        c.code,
    type:        c.type,
    value:       c.value,
    min_order:   c.minOrder   || 0,
    max_uses:    c.maxUses    || null,
    used_count:  c.used       || 0,
    active:      c.active     !== false,
    expires_at:  c.expires    || null,
    updated_at:  new Date().toISOString(),
  }));
  const { error } = await sb.from('coupons').upsert(rows, { onConflict: 'id' });
  if (error) throw new Error(error.message);
}

/**
 * Insert a single new coupon. Preferred over saveCoupons for creates.
 */
export async function insertCoupon(coupon) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialised');
  const { error } = await sb.from('coupons').insert({
    id:          coupon.id,
    code:        coupon.code,
    type:        coupon.type,
    value:       coupon.value,
    min_order:   coupon.minOrder   || 0,
    max_uses:    coupon.maxUses    || null,
    used_count:  0,
    active:      true,
    expires_at:  coupon.expires    || null,
  });
  if (error) throw new Error(error.message);
}

/**
 * Delete a single coupon by id.
 */
export async function deleteCoupon(id) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialised');
  const { error } = await sb.from('coupons').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/**
 * Toggle a coupon's active status.
 */
export async function toggleCoupon(id, active) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialised');
  const { error } = await sb.from('coupons').update({ active, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw new Error(error.message);
}

// ── Shipping zones (admin save) ───────────────────────────────

/**
 * Persist updated shipping zones back to Supabase.
 * Upserts all zones in one call.
 */
export async function saveShippingZones(zones) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialised');
  const rows = zones.map(z => ({
    id:         z.id,
    name:       z.name,
    districts:  z.districts  || z.provinces  || [],
    rate:       z.rate        ?? 0,
    min_days:   z.minDays     ?? z.min_days   ?? 1,
    max_days:   z.maxDays     ?? z.max_days   ?? 5,
    active:     z.active      !== false,
    updated_at: new Date().toISOString(),
  }));
  const { error } = await sb.from('shipping_zones').upsert(rows);
  if (error) throw new Error(error.message);
}

// ── Users (admin full CRUD) ───────────────────────────────────

/**
 * Get all user profiles (admin view).
 */
export async function getUsers() {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialised');
  const { data, error } = await sb
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []).map(row => ({
    id:         row.id,
    name:       row.name  || row.email?.split('@')[0] || 'Unknown',
    email:      row.email || '—',
    phone:      row.phone || '',
    role:       row.role  || 'customer',
    active:     row.active !== false,
    orders:     row.orders      || 0,
    totalSpent: row.total_spent || 0,
    createdAt:  row.created_at,
  }));
}

/**
 * Upsert one user profile.
 */
export async function saveUsers(users) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialised');
  const rows = users.map(u => ({
    id:         u.id,
    name:       u.name,
    email:      u.email,
    phone:      u.phone  || '',
    role:       u.role   || 'customer',
    active:     u.active !== false,
    updated_at: new Date().toISOString(),
  }));
  const { error } = await sb.from('profiles').upsert(rows);
  if (error) throw new Error(error.message);
}

// ── Blog posts ────────────────────────────────────────────────

/**
 * Get all blog posts (admin gets all, storefront sees published only).
 */
export async function getBlogPosts({ adminMode = false } = {}) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialised');
  let q = sb.from('blog_posts').select('*').order('created_at', { ascending: false });
  if (!adminMode) q = q.eq('published', true);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data || []).map(mapBlogRow);
}

/**
 * Get a single blog post by slug or id.
 */
export async function getBlogPost({ slug, id } = {}) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialised');
  let q = sb.from('blog_posts').select('*');
  if (slug) q = q.eq('slug', slug);
  else if (id) q = q.eq('id', id);
  const { data, error } = await q.maybeSingle();
  if (error) return null;
  return mapBlogRow(data);
}

/**
 * Save (upsert) a single blog post.
 */
export async function saveBlogPost(post) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialised');

  // Core columns — guaranteed to exist in every table version
  const coreRow = {
    id:         post.id,
    title:      post.title,
    slug:       post.slug,
    content:    post.content    || post.body || '',
    author:     post.author     || 'Manarize Team',
    tags:       post.tags       || [],
    published:  !!post.published,
    created_at: post.createdAt  || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Extended columns — only present after running blog_posts_migration.sql
  const extendedRow = {
    ...coreRow,
    category:    post.category    || '',
    excerpt:     post.excerpt     || '',
    cover_image: post.coverImage  || post.cover_image || '',
    featured:    !!post.featured,
    read_time:   post.readTime    || post.read_time || 5,
    seo_title:   post.seoTitle    || post.seo_title || '',
    seo_desc:    post.seoDesc     || post.seo_desc  || '',
  };

  // Try full upsert first; fall back to core-only if columns are missing
  const { error } = await sb.from('blog_posts').upsert(extendedRow);
  if (!error) return;

  if (error.message && error.message.includes('column')) {
    console.warn('[saveBlogPost] Extended columns missing — using core-only upsert. Run blog_posts_migration.sql to enable all fields.');
    const { error: coreError } = await sb.from('blog_posts').upsert(coreRow);
    if (coreError) throw new Error(coreError.message);
    return;
  }

  throw new Error(error.message);
}

/**
 * Save all blog posts at once (mirrors localStorage savePosts API).
 */
export async function savePosts(posts) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialised');

  const extendedRows = posts.map(p => ({
    id:          p.id,
    title:       p.title,
    slug:        p.slug,
    content:     p.content      || p.body || '',
    author:      p.author       || 'Manarize Team',
    tags:        p.tags         || [],
    published:   !!p.published,
    updated_at:  new Date().toISOString(),
    // Extended columns (present after migration)
    category:    p.category     || '',
    excerpt:     p.excerpt      || '',
    cover_image: p.coverImage   || p.cover_image || '',
    featured:    !!p.featured,
    read_time:   p.readTime     || p.read_time || 5,
    seo_title:   p.seoTitle     || p.seo_title || '',
    seo_desc:    p.seoDesc      || p.seo_desc  || '',
  }));

  const { error } = await sb.from('blog_posts').upsert(extendedRows);
  if (!error) return;

  if (error.message && error.message.includes('column')) {
    console.warn('[savePosts] Extended columns missing — using core-only upsert. Run blog_posts_migration.sql to enable all fields.');
    const coreRows = posts.map(p => ({
      id:         p.id,
      title:      p.title,
      slug:       p.slug,
      content:    p.content    || p.body || '',
      author:     p.author     || 'Manarize Team',
      tags:       p.tags       || [],
      published:  !!p.published,
      updated_at: new Date().toISOString(),
    }));
    const { error: coreError } = await sb.from('blog_posts').upsert(coreRows);
    if (coreError) throw new Error(coreError.message);
    return;
  }

  throw new Error(error.message);
}

/**
 * Get all posts (alias for storefront compatibility).
 */
export async function getPosts({ adminMode = false } = {}) {
  return getBlogPosts({ adminMode });
}

/**
 * Delete a blog post by id.
 */
export async function deleteBlogPost(id) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialised');
  const { error } = await sb.from('blog_posts').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

function mapBlogRow(row) {
  return {
    id:          row.id,
    title:       row.title,
    slug:        row.slug,
    category:    row.category     || '',
    excerpt:     row.excerpt      || '',
    content:     row.content      || '',
    coverImage:  row.cover_image  || '',
    author:      row.author       || '',
    tags:        row.tags         || [],
    published:   row.published,
    featured:    row.featured     || false,
    readTime:    row.read_time    || 5,
    seoTitle:    row.seo_title    || '',
    seoDesc:     row.seo_desc     || '',
    publishedAt: row.published_at,
    createdAt:   row.created_at,
    updatedAt:   row.updated_at,
  };
}

// ── Notifications ─────────────────────────────────────────────

/**
 * Get all notifications (newest first).
 */
export async function getNotifications({ userId } = {}) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialised');
  let q = sb
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);
  // When a userId is supplied filter to that user's notifications only.
  // Filter on the indexed user_id column — NOT the unindexed data->>'userId'
  // JSONB path which caused a full table scan on every storefront page load.
  if (userId) {
    q = q.eq('user_id', userId);
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data || [];
}

/**
 * Add a notification row.
 */
export async function addNotification(notif) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialised');
  const { error } = await sb.from('notifications').insert({
    id:         notif.id    || `NOTIF-${Date.now()}`,
    type:       notif.type  || 'info',
    title:      notif.title || '',
    message:    notif.message || '',
    data:       notif.data  || {},
    // Persist userId in the indexed user_id column so getNotifications()
    // can filter with an index scan instead of a full JSONB equality scan.
    user_id:    (notif.data && notif.data.userId) || notif.userId || null,
    read:       false,
    created_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}

/**
 * Mark a notification as read.
 */
export async function markNotificationRead(id) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialised');
  const { error } = await sb.from('notifications').update({ read: true }).eq('id', id);
  if (error) throw new Error(error.message);
}

/**
 * Mark all notifications as read.
 */
export async function markAllNotificationsRead() {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialised');
  const { error } = await sb.from('notifications').update({ read: true }).eq('read', false);
  if (error) throw new Error(error.message);
}

// ── Site settings ─────────────────────────────────────────────

/**
 * Get all site settings as a flat key→value object.
 */
export async function getSiteSettings() {
  // Cache for 15 minutes — settings change very rarely
  if (_settingsCache && (Date.now() - _settingsCacheTs) < SETTINGS_CACHE_TTL) {
    return _settingsCache;
  }

  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialised');
  const { data, error } = await sb.from('site_settings').select('key,value');
  if (error) {
    // Table may not exist yet — return empty object instead of throwing
    console.warn('[getSiteSettings]', error.message);
    return {};
  }
  const out = {};
  (data || []).forEach(row => { out[row.key] = row.value; });

  _settingsCache   = out;
  _settingsCacheTs = Date.now();
  return out;
}

/**
 * Save site settings. Accepts the full settings object; upserts every key.
 * @param {object} settings - flat object of key→value pairs (value can be any JSON)
 */
export async function saveSiteSettings(settings) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialised');
  const rows = Object.entries(settings).map(([key, value]) => ({
    key,
    value: typeof value === 'object' ? value : { v: value },
    updated_at: new Date().toISOString(),
  }));
  const { error } = await sb.from('site_settings').upsert(rows);
  if (error) throw new Error(error.message);
}

// ══════════════════════════════════════════════════════════════
// SECTION: Extended functions — Reviews (admin), Addresses,
//          Newsletter, Contact Messages  (Supabase migration)
// ══════════════════════════════════════════════════════════════

// ── Reviews: missing admin + user functions ───────────────────

/**
 * Fix submitReview — explicit column mapping so camelCase fields
 * from the JS layer don't leak into Postgres snake_case columns.
 */
export async function submitReviewV2(review) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialised');
  const row = {
    id:          review.id || `REV-${Date.now()}`,
    product_id:  review.productId,
    user_id:     review.userId,
    user_name:   review.userName || 'Anonymous',
    rating:      review.rating,
    title:       review.title   || '',
    body:        review.text    || review.body || '',
    verified:    review.verified || false,
    approved:    false,
    rejected:    false,
    edited_at:   null,
    approved_at: null,
    created_at:  new Date().toISOString(),
  };
  const { error } = await sb.from('reviews').insert(row);
  if (error) throw new Error(error.message);
  return mapReviewRow(row);
}

/** All reviews for a product — admin (all statuses). */
export async function getProductReviewsAdmin(productId) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialised');
  const rows = await query(
    sb.from('reviews').select('*').eq('product_id', productId)
      .order('created_at', { ascending: false })
  );
  return rows.map(r => ({ ...mapReviewRow(r), text: r.body || r.text || '' }));
}

/** Flat list of ALL reviews across all products (admin dashboard). */
export async function getAllReviewsFlat({ approvedOnly = false } = {}) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialised');
  let q = sb.from('reviews').select('*').order('created_at', { ascending: false });
  if (approvedOnly) q = q.eq('approved', true).eq('rejected', false);
  const rows = await query(q);
  return rows.map(r => ({
    ...mapReviewRow(r),
    productId: r.product_id,
    text:      r.body || r.text || '',
  }));
}

/** Get a single user's review for a specific product, or null. */
export async function getUserReview(userId, productId) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialised');
  const row = await querySafe(
    sb.from('reviews').select('*').eq('user_id', userId).eq('product_id', productId).maybeSingle()
  );
  return row ? { ...mapReviewRow(row), text: row.body || row.text || '' } : null;
}

/** All reviews submitted by a userId (profile page). */
export async function getUserReviews(userId) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialised');
  const rows = await query(
    sb.from('reviews').select('*').eq('user_id', userId)
      .order('created_at', { ascending: false })
  );
  return rows.map(r => ({
    ...mapReviewRow(r),
    productId: r.product_id,
    text:      r.body || r.text || '',
  }));
}

/** Edit an existing review — enforces one-edit-only via edited_at IS NULL. */
export async function editReview({ productId, userId, rating, title, text }) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialised');
  const updateFields = {
    rating,
    title:      title || '',
    body:       text,
    edited_at:  new Date().toISOString(),
    approved:   false,
    rejected:   false,
    approved_at: null,
  };
  const { error } = await sb.from('reviews').update(updateFields)
    .eq('product_id', productId).eq('user_id', userId).is('edited_at', null);
  if (error) throw new Error(error.message);
  // Fetch the updated row to return it
  const { data, error: fetchErr } = await sb.from('reviews').select('*')
    .eq('product_id', productId).eq('user_id', userId).maybeSingle();
  if (fetchErr) throw new Error(fetchErr.message);
  return data ? { ...mapReviewRow(data), text: data.body || '' } : null;
}

/** Approve a review by id. */
export async function approveReview(reviewId) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialised');
  const { error } = await sb.from('reviews').update({
    approved: true, rejected: false, approved_at: new Date().toISOString(),
  }).eq('id', reviewId);
  if (error) throw new Error(error.message);
  return true;
}

/** Reject a review by id. */
export async function rejectReview(reviewId) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialised');
  const { error } = await sb.from('reviews').update({
    approved: false, rejected: true, approved_at: null,
  }).eq('id', reviewId);
  if (error) throw new Error(error.message);
  return true;
}

/** Delete a review by id. */
export async function deleteReview(reviewId) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialised');
  const { error } = await sb.from('reviews').delete().eq('id', reviewId);
  if (error) throw new Error(error.message);
  return true;
}

// ── Addresses — stored as JSONB in profiles.addresses ─────────

export async function getAddresses(userId) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialised');
  const row = await querySafe(
    sb.from('profiles').select('addresses').eq('id', userId).maybeSingle()
  );
  return Array.isArray(row?.addresses) ? row.addresses : [];
}

export async function saveAddresses(userId, addresses) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialised');
  const { error } = await sb.from('profiles')
    .upsert({ id: userId, addresses, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}

// ── Newsletter Subscribers ─────────────────────────────────────

export async function saveNewsletterSubscriber(email) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialised');
  // Use RPC (SECURITY DEFINER) — avoids needing SELECT permission for anon.
  // Upsert requires SELECT (PostgREST return=representation), which anon lacks.
  const { data, error } = await sb.rpc('subscribe_newsletter', { p_email: email.toLowerCase().trim() });
  if (error) throw new Error(error.message);
  if (data === 'already_subscribed') throw new Error('already_subscribed');
}

export async function getNewsletterSubscribers() {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialised');
  const { data, error } = await sb.from('newsletter_subscribers')
    .select('*').order('subscribed_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function deleteNewsletterSubscriber(email) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialised');
  const { error } = await sb.from('newsletter_subscribers')
    .delete().eq('email', email);
  if (error) throw new Error(error.message);
}

// ── Contact Messages — Supabase-backed ────────────────────────

export async function getContactMessages() {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialised');
  const { data, error } = await sb.from('contact_messages').select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []).map(r => ({
    id:        r.id,
    firstName: r.first_name || '',
    lastName:  r.last_name  || '',
    email:     r.email      || '',
    phone:     r.phone      || '',
    subject:   r.subject    || '',
    message:   r.message    || '',
    read:      r.read       || false,
    createdAt: r.created_at,
  }));
}

export async function markContactMessageRead(id) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialised');
  const { error } = await sb.from('contact_messages').update({ read: true }).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteContactMessage(id) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialised');
  const { error } = await sb.from('contact_messages').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ══════════════════════════════════════════════════════════════
// SECTION: Extended functions — Reviews (admin), Addresses,
//          Newsletter, Contact Messages  (Supabase migration)
// ══════════════════════════════════════════════════════════════
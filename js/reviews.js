/* ============================================================
   ZENMARKET — PRODUCT REVIEWS  (v2 — Supabase + localStorage)
   DEMO_MODE=true  → localStorage (zm_product_reviews)
   DEMO_MODE=false → Supabase reviews table
   ============================================================ */
import { LS, DEMO_MODE } from './config.js';
import { getOrders }     from './store-adapter.js';
import { addAdminNotification } from './notifications.js';

async function _store() {
  if (DEMO_MODE) return null;
  return import('./supabase-store.js');
}

// ── localStorage helpers (demo / fallback) ────────────────────
export function getAllReviews() {
  try { return JSON.parse(localStorage.getItem(LS.productReviews) || '{}'); } catch { return {}; }
}
function _saveAll(map) { localStorage.setItem(LS.productReviews, JSON.stringify(map)); }

// ── Read ──────────────────────────────────────────────────────
export async function getProductReviews(productId, includeRejected = false) {
  try {
    const store = await _store();
    if (store) {
      if (includeRejected) return store.getProductReviewsAdmin(productId);
      return store.getProductReviews(productId);
    }
  } catch(e) { console.warn('getProductReviews:', e); }
  const all = getAllReviews();
  const list = all[productId] || [];
  const filtered = includeRejected ? list : list.filter(r => r.approved === true && r.rejected !== true);
  return filtered.slice().sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export async function getAllReviewsFlat(opts = {}) {
  try {
    const store = await _store();
    if (store) return store.getAllReviewsFlat(opts);
  } catch(e) { console.warn('getAllReviewsFlat:', e); }
  const all = getAllReviews();
  const result = [];
  Object.entries(all).forEach(([pid, reviews]) => reviews.forEach(r => result.push({...r, productId: pid})));
  const flat = result.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
  if (opts.approvedOnly) return flat.filter(r => r.approved === true && r.rejected !== true);
  return flat;
}

export async function getUserReviews(userId) {
  if (!userId) return [];
  try {
    const store = await _store();
    if (store) return store.getUserReviews(userId);
  } catch(e) { console.warn('getUserReviews:', e); }
  const all = getAllReviews();
  const result = [];
  Object.entries(all).forEach(([pid, reviews]) => {
    reviews.forEach(r => { if (r.userId === userId) result.push({...r, productId: pid}); });
  });
  return result.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export async function getUserReview(userId, productId) {
  if (!userId) return null;
  try {
    const store = await _store();
    if (store) return store.getUserReview(userId, productId);
  } catch(e) { console.warn('getUserReview:', e); }
  const reviews = await getProductReviews(productId, true);
  return reviews.find(r => r.userId === userId) || null;
}

// ── Purchase / eligibility ────────────────────────────────────
export async function hasPurchased(userId, productId) {
  if (!userId || typeof userId !== 'string' || userId === 'guest') return false;
  const orders = await getOrders();
  return orders.some(o =>
    o.customerId === userId && o.status === 'delivered' &&
    (o.items || []).some(i => i.productId === productId)
  );
}
export async function canReview(userId, productId)  { return hasPurchased(userId, productId); }
export async function hasReviewed(userId, productId) { return !!(await getUserReview(userId, productId)); }
export async function canEdit(userId, productId) {
  const r = await getUserReview(userId, productId);
  return r ? (!r.editedAt && !r.edited_at) : false;
}

export async function getReviewStats(productId) {
  const reviews = await getProductReviews(productId);
  if (!reviews.length) return { avg: 0, count: 0, breakdown: {} };
  const breakdown = {5:0,4:0,3:0,2:0,1:0};
  let sum = 0;
  reviews.forEach(r => { sum += r.rating; breakdown[r.rating] = (breakdown[r.rating]||0)+1; });
  return { avg: +(sum/reviews.length).toFixed(1), count: reviews.length, breakdown };
}

// ── Write ──────────────────────────────────────────────────────
export async function addReview({ productId, userId, userName, rating, title, text }) {
  if (!userId || typeof userId !== 'string' || userId === 'guest')
    return { success: false, error: 'You must be logged in to leave a review.' };
  if (!(await canReview(userId, productId)))
    return { success: false, error: 'Only customers who have purchased this product can leave a review.' };
  if (await hasReviewed(userId, productId))
    return { success: false, error: 'You have already reviewed this product.' };
  if (!rating || rating < 1 || rating > 5) return { success: false, error: 'Please select a star rating.' };
  if (!text || text.trim().length < 10)    return { success: false, error: 'Review must be at least 10 characters.' };

  const review = {
    id: `REV-${Date.now()}`, productId, userId,
    userName: userName || 'Anonymous', rating: Number(rating),
    title: (title||'').trim(), text: text.trim(),
    createdAt: new Date().toISOString(), editedAt: null,
    verified: await hasPurchased(userId, productId), approved: false, approvedAt: null,
  };
  try {
    const store = await _store();
    if (store) {
      const saved = await store.submitReviewV2(review);
      addAdminNotification({ type:'new_review', title:'New Review Pending ⭐', message:`${userName||'A customer'} submitted a ${rating}-star review. Please approve or reject it.`, refId: productId });
      return { success: true, review: saved };
    }
  } catch(e) { console.warn('addReview Supabase error:', e); }
  // Demo fallback
  const all = getAllReviews();
  if (!all[productId]) all[productId] = [];
  all[productId].push(review);
  _saveAll(all);
  addAdminNotification({ type:'new_review', title:'New Review Pending ⭐', message:`${userName||'A customer'} submitted a ${rating}-star review.`, refId: productId });
  return { success: true, review };
}

export async function editReview({ productId, userId, rating, title, text }) {
  if (!userId || typeof userId !== 'string' || userId === 'guest')
    return { success: false, error: 'You must be logged in to edit a review.' };
  if (!(await canEdit(userId, productId)))
    return { success: false, error: 'You have already used your one-time edit, or have no review to edit.' };
  if (!rating || rating < 1 || rating > 5) return { success: false, error: 'Please select a star rating.' };
  if (!text || text.trim().length < 10)    return { success: false, error: 'Review must be at least 10 characters.' };
  try {
    const store = await _store();
    if (store) { const saved = await store.editReview({ productId, userId, rating, title, text }); return { success: true, review: saved }; }
  } catch(e) { console.warn('editReview Supabase error:', e); }
  const all = getAllReviews(); const list = all[productId]||[]; const idx = list.findIndex(r => r.userId===userId);
  if (idx<0) return { success: false, error: 'Review not found.' };
  list[idx] = { ...list[idx], rating:Number(rating), title:(title||'').trim(), text:text.trim(), editedAt:new Date().toISOString(), approved:false, rejected:false, approvedAt:null };
  all[productId]=list; _saveAll(all);
  return { success: true, review: list[idx] };
}

// ── Admin ──────────────────────────────────────────────────────
export async function approveReview(productId, reviewId) {
  try {
    const store = await _store();
    if (store) { await store.approveReview(reviewId); return true; }
  } catch(e) { console.warn('approveReview:', e); }
  const all = getAllReviews(); const list = all[productId]||[]; const idx = list.findIndex(r=>r.id===reviewId);
  if (idx<0) return false;
  list[idx].approved=true; list[idx].approvedAt=new Date().toISOString();
  all[productId]=list; _saveAll(all); return true;
}

export async function rejectReview(productId, reviewId) {
  try {
    const store = await _store();
    if (store) { await store.rejectReview(reviewId); return true; }
  } catch(e) { console.warn('rejectReview:', e); }
  const all = getAllReviews(); const list = all[productId]||[]; const idx = list.findIndex(r=>r.id===reviewId);
  if (idx<0) return false;
  list[idx].approved=false; list[idx].rejected=true; list[idx].approvedAt=null;
  all[productId]=list; _saveAll(all); return true;
}

export async function deleteReview(productId, reviewId) {
  try {
    const store = await _store();
    if (store) { await store.deleteReview(reviewId); return true; }
  } catch(e) { console.warn('deleteReview:', e); }
  const all = getAllReviews();
  if (!all[productId]) return false;
  all[productId] = all[productId].filter(r => r.id !== reviewId);
  if (!all[productId].length) delete all[productId];
  _saveAll(all); return true;
}

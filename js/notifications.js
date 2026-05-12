/* ============================================================
   ZENMARKET — USER NOTIFICATIONS
   Persists to Supabase notifications table in production,
   falls back to localStorage in demo mode.
   Types: welcome | order_success | review_approved | order_delivered | payment_confirmed
   Admin types: new_order | new_review | bank_transfer
   ============================================================ */

const KEY       = 'zm_user_notifications';
const ADMIN_KEY = 'zm_admin_notifications';

// ── Backend resolver ──────────────────────────────────────────
async function _store() {
  const { DEMO_MODE } = await import('./config.js');
  if (DEMO_MODE) return null;
  return await import('./supabase-store.js');
}

// ── Local-storage helpers (demo / fallback) ───────────────────
function _lsLoad(key)       { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; } }
function _lsSave(key, list) { localStorage.setItem(key, JSON.stringify(list)); }

// ── Public USER API ───────────────────────────────────────────

/** Returns notifications for a specific userId, newest first */
export async function getUserNotifications(userId) {
  if (!userId) return [];
  try {
    const store = await _store();
    if (store) {
      const all = await store.getNotifications({ userId });
      return all
                .sort((a, b) => new Date(b.created_at || b.createdAt) - new Date(a.created_at || a.createdAt));
    }
  } catch {}
  return _lsLoad(KEY)
    .filter(n => n.userId === userId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/** Returns count of unread notifications for userId */
export async function getUnreadCount(userId) {
  return (await getUserNotifications(userId)).filter(n => !n.read).length;
}

/** Add a notification (deduplicates by type+refId within 24h) */
export async function addNotification({ userId, type, title, message, refId = null }) {
  if (!userId) return;
  try {
    const store = await _store();
    if (store) {
      await store.addNotification({
        id:      `NOTIF-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
        type, title, message,
        data:    { userId, refId },
        read:    false,
      });
      window.dispatchEvent(new CustomEvent('notifications:updated'));
      return;
    }
  } catch {}
  // Demo fallback
  const all    = _lsLoad(KEY);
  const recent = Date.now() - 24 * 60 * 60 * 1000;
  const exists = all.some(n => n.userId === userId && n.type === type && n.refId === refId && new Date(n.createdAt).getTime() > recent);
  if (exists) return;
  all.push({ id: `NOTIF-${Date.now()}-${Math.random().toString(36).slice(2,6)}`, userId, type, title, message, refId, read: false, createdAt: new Date().toISOString() });
  _lsSave(KEY, all);
  window.dispatchEvent(new CustomEvent('notifications:updated'));
}

/** Mark a single notification as read */
export async function markRead(notifId) {
  try {
    const store = await _store();
    if (store) { await store.markNotificationRead(notifId); return; }
  } catch {}
  const all = _lsLoad(KEY);
  const idx = all.findIndex(n => n.id === notifId);
  if (idx >= 0) { all[idx].read = true; _lsSave(KEY, all); }
}

/** Mark all notifications for a user as read */
export async function markAllRead(userId) {
  try {
    const store = await _store();
    if (store) { await store.markAllNotificationsRead(); return; }
  } catch {}
  _lsSave(KEY, _lsLoad(KEY).map(n => n.userId === userId ? { ...n, read: true } : n));
}

/** Delete a notification */
export async function deleteNotification(notifId) {
  try {
    const store = await _store();
    if (store) {
      const sb = (await import('./supabase.js')).getSupabase();
      if (sb) { await sb.from('notifications').delete().eq('id', notifId); return; }
    }
  } catch {}
  _lsSave(KEY, _lsLoad(KEY).filter(n => n.id !== notifId));
}

// ── Convenience senders ───────────────────────────────────────

export function sendWelcomeNotification(userId, name) {
  addNotification({ userId, type: 'welcome', title: 'Welcome to Manarize! 🎉', message: `Hi ${name}! Your account is ready. Explore our products and enjoy shopping.`, refId: null });
}

export function sendOrderSuccessNotification(userId, orderId, total) {
  return addNotification({ userId, type: 'order_success', title: 'Order Placed Successfully ✅', message: `Your order #${orderId} has been received. Total: Rs. ${total.toLocaleString()}. We'll update you when it ships.`, refId: orderId });
}

export function sendReviewApprovedNotification(userId, productName) {
  addNotification({ userId, type: 'review_approved', title: 'Your Review is Live ⭐', message: `Your review for "${productName}" has been approved and is now visible to other shoppers.`, refId: null });
}

export function sendOrderDeliveredNotification(userId, orderId) {
  addNotification({ userId, type: 'order_delivered', title: 'Order Delivered 📦', message: `Your order #${orderId} has been marked as delivered! You can now leave reviews for your purchased items.`, refId: orderId });
}

export function sendPaymentConfirmedNotification(userId, orderId, total) {
  addNotification({ userId, type: 'payment_confirmed', title: 'Payment Confirmed ✅', message: `Your payment of Rs. ${total.toLocaleString()} for order #${orderId} has been confirmed. Your order is now being processed.`, refId: orderId });
}

// ── Admin Notifications ───────────────────────────────────────

export async function addAdminNotification({ type, title, message, refId = null }) {
  try {
    const store = await _store();
    if (store) {
      // Dedup: skip if same type+refId was inserted within the last 30 seconds
      try {
        const recent = Date.now() - 30 * 1000;
        const all    = await store.getNotifications();
        const exists = all.some(n =>
          n.data?.admin === true &&
          n.type === type &&
          (n.data?.refId === refId) &&
          new Date(n.created_at || n.createdAt).getTime() > recent
        );
        if (exists) return;
      } catch {} // dedup failure is non-critical — proceed with insert

      await store.addNotification({
        id:      `ANOTIF-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
        type,
        title,
        message,
        data:    { admin: true, refId },
        userId:  null,   // explicit null so user_id column stays NULL (admin-only)
        read:    false,
      });
      window.dispatchEvent(new CustomEvent('admin_notifications:updated'));
      return;
    }
  } catch (e) {
    console.warn('[AdminNotif] Supabase save failed:', e.message);
  }
  // LocalStorage fallback (demo / offline)
  const all    = _lsLoad(ADMIN_KEY);
  const recent = Date.now() - 30 * 1000;
  if (all.some(n => n.type === type && n.refId === refId && new Date(n.createdAt).getTime() > recent)) return;
  all.unshift({ id: `ANOTIF-${Date.now()}-${Math.random().toString(36).slice(2,6)}`, type, title, message, refId, read: false, createdAt: new Date().toISOString() });
  _lsSave(ADMIN_KEY, all);
  window.dispatchEvent(new CustomEvent('admin_notifications:updated'));
}

export async function getAdminNotifications() {
  try {
    const store = await _store();
    if (store) {
      const all = await store.getNotifications(); // no userId = fetch all
      // Admin notifications: data.admin=true OR user_id is null/empty (and not a user-targeted notif)
      return all
        .filter(n => n.data?.admin === true || (!n.user_id && !n.data?.userId))
        .sort((a, b) => new Date(b.created_at || b.createdAt) - new Date(a.created_at || a.createdAt));
    }
  } catch {}
  return _lsLoad(ADMIN_KEY).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export async function getAdminUnreadCount() {
  return (await getAdminNotifications()).filter(n => !n.read).length;
}

export async function markAdminRead(notifId) {
  try {
    const store = await _store();
    if (store) { await store.markNotificationRead(notifId); return; }
  } catch {}
  const all = _lsLoad(ADMIN_KEY);
  const idx = all.findIndex(n => n.id === notifId);
  if (idx >= 0) { all[idx].read = true; _lsSave(ADMIN_KEY, all); }
}

export async function markAllAdminRead() {
  try {
    const store = await _store();
    if (store) { await store.markAllNotificationsRead(); return; }
  } catch {}
  _lsSave(ADMIN_KEY, _lsLoad(ADMIN_KEY).map(n => ({ ...n, read: true })));
}

export async function deleteAdminNotification(notifId) {
  try {
    const store = await _store();
    if (store) {
      const sb = (await import('./supabase.js')).getSupabase();
      if (sb) { await sb.from('notifications').delete().eq('id', notifId); return; }
    }
  } catch {}
  _lsSave(ADMIN_KEY, _lsLoad(ADMIN_KEY).filter(n => n.id !== notifId));
}

export function sendNewOrderAdminNotification(orderId, customerName, total) {
  return addAdminNotification({ type: 'new_order', title: `New Order #${orderId} 🛒`, message: `${customerName} placed an order for Rs. ${total.toLocaleString()}. Review and process it now.`, refId: orderId });
}

export function adminNotifIcon(type) {
  const map = {
    new_order:       { icon: 'fa-solid fa-cart-shopping',   color: 'var(--clr-gold)'    },
    new_review:      { icon: 'fa-solid fa-star',            color: 'var(--clr-warning)'  },
    bank_transfer:   { icon: 'fa-solid fa-building-columns', color: 'var(--clr-info)'    },
  };
  return map[type] || { icon: 'fa-solid fa-bell', color: 'var(--clr-gold)' };
}

// ── Icon map ──────────────────────────────────────────────────
export function notifIcon(type) {
  const map = {
    welcome:            { icon: 'fa-solid fa-party-horn',    color: 'var(--clr-gold)'    },
    order_success:      { icon: 'fa-solid fa-circle-check',  color: 'var(--clr-success)' },
    review_approved:    { icon: 'fa-solid fa-star',          color: 'var(--clr-gold)'    },
    order_delivered:    { icon: 'fa-solid fa-box-open',      color: 'var(--clr-success)' },
    payment_confirmed:  { icon: 'fa-solid fa-credit-card',   color: 'var(--clr-success)' },
  };
  return map[type] || { icon: 'fa-solid fa-bell', color: 'var(--clr-info)' };
}

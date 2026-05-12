/* ============================================================
   ZENMARKET — SUPABASE REALTIME  (v29)
   ============================================================
   Manages live database subscriptions for the admin panel and
   storefront. Uses Supabase Realtime (Postgres CDC).

   USAGE:
     import { subscribeToOrders, subscribeToStock } from './realtime.js';

     // Admin dashboard — live order feed
     const unsub = subscribeToOrders((order) => {
       console.log('New order:', order);
     });

     // Storefront — live stock updates
     const unsub2 = subscribeToStock('prod-001', (stock) => {
       document.getElementById('stock').textContent = stock;
     });

     // Cleanup on page unload
     window.addEventListener('beforeunload', () => {
       unsub(); unsub2();
     });

   SUPABASE SETUP:
     1. Enable Realtime on your project:
        Supabase → Database → Replication → enable for: orders, products
     2. That's it — no extra SQL needed.
   ============================================================ */

import { getSupabase } from './supabase.js';
import { DEMO_MODE }   from './config.js';

// Active channel references (so we can unsubscribe cleanly)
const _channels = new Map();

let _channelCounter = 0;
function uid(prefix) {
  return `${prefix}-${++_channelCounter}-${Date.now()}`;
}

// ── Helpers ───────────────────────────────────────────────────────

function noopUnsub() {}

function makeUnsub(channel) {
  return function unsubscribe() {
    const sb = getSupabase();
    if (sb && channel) {
      sb.removeChannel(channel).catch(() => {});
    }
  };
}

// ── Orders — new / updated ────────────────────────────────────────

/**
 * Subscribe to new and updated orders (admin use).
 *
 * @param {function} onNew      Called with full order row when INSERT fires
 * @param {function} onUpdate   Called with {id, status, payment_status, updated_at} on UPDATE
 * @returns {function}          Call to unsubscribe
 */
export function subscribeToOrders({ onNew, onUpdate } = {}) {
  if (DEMO_MODE) return noopUnsub;
  const sb = getSupabase();
  if (!sb) return noopUnsub;

  const channelId = uid('orders');

  const channel = sb
    .channel(channelId)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'orders' },
      (payload) => {
        if (typeof onNew === 'function') onNew(payload.new);
      }
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'orders' },
      (payload) => {
        if (typeof onUpdate === 'function') {
          onUpdate({
            id:             payload.new.id,
            status:         payload.new.status,
            payment_status: payload.new.payment_status,
            updated_at:     payload.new.updated_at,
            _full:          payload.new,
          });
        }
      }
    )
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR') {
        console.warn('[Realtime] Orders channel error — will retry automatically');
      }
    });

  _channels.set(channelId, channel);
  return makeUnsub(channel);
}

// ── Single order — status tracking ───────────────────────────────

/**
 * Watch a single order for status/payment changes.
 * Useful on the order-success page so customers see live updates.
 *
 * @param {string}   orderId
 * @param {function} onChange  Called with updated order row
 * @returns {function}         Unsubscribe
 */
export function subscribeToOrder(orderId, onChange) {
  if (DEMO_MODE || !orderId || typeof onChange !== 'function') return noopUnsub;
  const sb = getSupabase();
  if (!sb) return noopUnsub;

  const channelId = uid(`order-${orderId}`);

  const channel = sb
    .channel(channelId)
    .on(
      'postgres_changes',
      {
        event:  'UPDATE',
        schema: 'public',
        table:  'orders',
        filter: `id=eq.${orderId}`,
      },
      (payload) => onChange(payload.new)
    )
    .subscribe();

  _channels.set(channelId, channel);
  return makeUnsub(channel);
}

// ── Product stock — live inventory ───────────────────────────────

/**
 * Subscribe to stock changes for a single product.
 * Call on the product detail page to reflect live inventory.
 *
 * @param {string}   productId
 * @param {function} onStockChange  Called with new stock number
 * @returns {function}              Unsubscribe
 */
export function subscribeToStock(productId, onStockChange) {
  if (DEMO_MODE || !productId || typeof onStockChange !== 'function') return noopUnsub;
  const sb = getSupabase();
  if (!sb) return noopUnsub;

  const channelId = uid(`stock-${productId}`);

  const channel = sb
    .channel(channelId)
    .on(
      'postgres_changes',
      {
        event:  'UPDATE',
        schema: 'public',
        table:  'products',
        filter: `id=eq.${productId}`,
      },
      (payload) => {
        if (payload.new.stock !== undefined) {
          onStockChange(payload.new.stock);
        }
      }
    )
    .subscribe();

  _channels.set(channelId, channel);
  return makeUnsub(channel);
}

// ── Reviews — moderation queue ───────────────────────────────────

/**
 * Subscribe to new product reviews (admin moderation).
 *
 * @param {function} onNew  Called with new review row
 * @returns {function}      Unsubscribe
 */
export function subscribeToReviews(onNew) {
  if (DEMO_MODE || typeof onNew !== 'function') return noopUnsub;
  const sb = getSupabase();
  if (!sb) return noopUnsub;

  const channelId = uid('reviews');

  const channel = sb
    .channel(channelId)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'reviews' },
      (payload) => onNew(payload.new)
    )
    .subscribe();

  _channels.set(channelId, channel);
  return makeUnsub(channel);
}

// ── Presence — admin panel online indicator ───────────────────────

/**
 * Track which admin users are currently active.
 * Shows a "live" badge in the admin sidebar.
 *
 * @param {string}   adminEmail
 * @param {function} onSync     Called with array of present users
 * @returns {function}          Unsubscribe + go offline
 */
export function trackAdminPresence(adminEmail, onSync) {
  if (DEMO_MODE || !adminEmail) return noopUnsub;
  const sb = getSupabase();
  if (!sb) return noopUnsub;

  const channelId = uid('admin-presence');

  const channel = sb
    .channel(channelId, { config: { presence: { key: adminEmail } } })
    .on('presence', { event: 'sync' }, () => {
      const state  = channel.presenceState();
      const online = Object.values(state).flat();
      if (typeof onSync === 'function') onSync(online);
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await channel.track({
          email:     adminEmail,
          online_at: new Date().toISOString(),
        });
      }
    });

  _channels.set(channelId, channel);

  return async function unsubscribe() {
    await channel.untrack();
    const s = getSupabase();
    if (s) s.removeChannel(channel).catch(() => {});
  };
}

// ── Cleanup all channels ─────────────────────────────────────────

/**
 * Remove all active Realtime channels.
 * Call on page unload or during SPA navigation.
 */
export function unsubscribeAll() {
  const sb = getSupabase();
  if (!sb) return;
  for (const [, channel] of _channels) {
    sb.removeChannel(channel).catch(() => {});
  }
  _channels.clear();
}

// Auto-cleanup on page unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', unsubscribeAll);
}

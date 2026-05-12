/* ============================================================
   ZENMARKET — STORE (Production — Supabase backend)
   ============================================================
   All demo data removed. In production (DEMO_MODE=false) this file
   is bypassed — store-adapter.js routes to supabase-store.js instead.
   This file is only active in demo/test mode (DEMO_MODE=true).
   ============================================================ */
import { LS } from './config.js';
export { LS };  // re-export so admin pages can do: import { LS } from '../js/store.js'

// ── Default Categories ────────────────────────────────────────
// ── Default Categories (with Subcategories) ───────────────────
export const DEFAULT_CATEGORIES = [
  {
    id: 'cat-001', name: 'Clothing', slug: 'clothing',
    icon: 'fa-solid fa-shirt', isDefault: true, active: true,
    subcategories: [
      { id: 'sub-001-1', name: "Men's Wear",      slug: 'mens-wear'      },
      { id: 'sub-001-2', name: "Women's Wear",    slug: 'womens-wear'    },
      { id: 'sub-001-3', name: "Kids' Wear",      slug: 'kids-wear'      },
      { id: 'sub-001-4', name: 'Traditional Wear', slug: 'traditional-wear' },
    ],
  },
  {
    id: 'cat-002', name: 'Sport Shoes', slug: 'sport-shoes',
    icon: 'fa-solid fa-shoe-prints', isDefault: true, active: true,
    subcategories: [
      { id: 'sub-002-1', name: 'Running Shoes',   slug: 'running-shoes'  },
      { id: 'sub-002-2', name: 'Training Shoes',  slug: 'training-shoes' },
      { id: 'sub-002-3', name: 'Casual Sneakers', slug: 'casual-sneakers'},
    ],
  },
  {
    id: 'cat-003', name: 'Second Hand', slug: 'second-hand',
    icon: 'fa-solid fa-recycle', isDefault: true, active: true,
    subcategories: [
      { id: 'sub-003-1', name: 'Used Electronics', slug: 'used-electronics'},
      { id: 'sub-003-2', name: 'Used Clothing',    slug: 'used-clothing'   },
      { id: 'sub-003-3', name: 'Used Furniture',   slug: 'used-furniture'  },
      { id: 'sub-003-4', name: 'Used Books',       slug: 'used-books'      },
    ],
  },
  {
    id: 'cat-004', name: 'Laptops', slug: 'laptops',
    icon: 'fa-solid fa-laptop', isDefault: true, active: true,
    subcategories: [
      { id: 'sub-004-1', name: 'Gaming Laptops',   slug: 'gaming-laptops'  },
      { id: 'sub-004-2', name: 'Business Laptops', slug: 'business-laptops'},
      { id: 'sub-004-3', name: 'Budget Laptops',   slug: 'budget-laptops'  },
    ],
  },
  {
    id: 'cat-005', name: 'Computer Accessories', slug: 'computer-accessories',
    icon: 'fa-solid fa-computer-mouse', isDefault: true, active: true,
    subcategories: [
      { id: 'sub-005-1', name: 'Keyboards',  slug: 'keyboards' },
      { id: 'sub-005-2', name: 'Mice',       slug: 'mice'      },
      { id: 'sub-005-3', name: 'Monitors',   slug: 'monitors'  },
      { id: 'sub-005-4', name: 'Storage',    slug: 'storage'   },
      { id: 'sub-005-5', name: 'Cables & Hubs', slug: 'cables-hubs' },
    ],
  },
  {
    id: 'cat-006', name: 'Electronics', slug: 'electronics',
    icon: 'fa-solid fa-microchip', isDefault: true, active: true,
    subcategories: [
      { id: 'sub-006-1', name: 'Phones',     slug: 'phones'     },
      { id: 'sub-006-2', name: 'Audio',      slug: 'audio'      },
      { id: 'sub-006-3', name: 'Cameras',    slug: 'cameras'    },
      { id: 'sub-006-4', name: 'Wearables',  slug: 'wearables'  },
    ],
  },
  {
    id: 'cat-007', name: 'Home & Living', slug: 'home-living',
    icon: 'fa-solid fa-couch', isDefault: true, active: true,
    subcategories: [
      { id: 'sub-007-1', name: 'Furniture',  slug: 'furniture'  },
      { id: 'sub-007-2', name: 'Kitchen',    slug: 'kitchen'    },
      { id: 'sub-007-3', name: 'Decor',      slug: 'decor'      },
    ],
  },
  {
    id: 'cat-008', name: 'Beauty', slug: 'beauty',
    icon: 'fa-solid fa-spa', isDefault: true, active: true,
    subcategories: [
      { id: 'sub-008-1', name: 'Skincare',   slug: 'skincare'   },
      { id: 'sub-008-2', name: 'Makeup',     slug: 'makeup'     },
      { id: 'sub-008-3', name: 'Hair Care',  slug: 'hair-care'  },
    ],
  },
];

// ── Default Products ──────────────────────────────────────────
export const DEFAULT_PRODUCTS = [];
export const DEFAULT_ORDERS = [];
export const DEFAULT_USERS = [];

// ── Default Coupons ───────────────────────────────────────────
export const DEFAULT_COUPONS = [
  { id: 'CPN-001', code: 'WELCOME10', type: 'percent', value: 10, minOrder: 2000, maxUses: 100, used: 34, active: true, expires: '2025-12-31' },
  { id: 'CPN-002', code: 'SAVE500',   type: 'fixed',   value: 500, minOrder: 5000, maxUses: 50, used: 12, active: true, expires: '2025-06-30' },
  { id: 'CPN-003', code: 'FREESHIP',  type: 'shipping', value: 100, minOrder: 3000, maxUses: 200, used: 89, active: false, expires: '2025-03-31' },
];

// ── Shipping Zones ────────────────────────────────────────────
export const SHIPPING_ZONES = [
  { id: 'sz-1',  name: 'Colombo',        districts: ['Colombo'],                                                  rate: 250, minDays: 1, maxDays: 2 },
  { id: 'sz-2',  name: 'Western Other',  districts: ['Gampaha', 'Kalutara'],                                     rate: 350, minDays: 1, maxDays: 3 },
  { id: 'sz-3',  name: 'Central',        districts: ['Kandy', 'Matale', 'Nuwara Eliya'],                         rate: 450, minDays: 2, maxDays: 4 },
  { id: 'sz-4',  name: 'Southern',       districts: ['Galle', 'Matara', 'Hambantota'],                           rate: 500, minDays: 2, maxDays: 4 },
  { id: 'sz-5',  name: 'Northern',       districts: ['Jaffna', 'Kilinochchi', 'Mannar', 'Vavuniya', 'Mullaitivu'], rate: 600, minDays: 3, maxDays: 6 },
  { id: 'sz-6',  name: 'Eastern',        districts: ['Trincomalee', 'Batticaloa', 'Ampara'],                     rate: 600, minDays: 3, maxDays: 6 },
  { id: 'sz-7',  name: 'NW Province',    districts: ['Kurunegala', 'Puttalam'],                                  rate: 450, minDays: 2, maxDays: 4 },
  { id: 'sz-8',  name: 'North Central',  districts: ['Anuradhapura', 'Polonnaruwa'],                             rate: 500, minDays: 2, maxDays: 5 },
  { id: 'sz-9',  name: 'Uva',            districts: ['Badulla', 'Monaragala'],                                   rate: 550, minDays: 2, maxDays: 5 },
  { id: 'sz-10', name: 'Sabaragamuwa',   districts: ['Ratnapura', 'Kegalle'],                                    rate: 450, minDays: 2, maxDays: 4 },
];

// ── Editable shipping zones (reads localStorage, falls back to defaults) ──
export function getShippingZones() {
  try {
    const saved = localStorage.getItem('zm_shipping_zones');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return JSON.parse(JSON.stringify(SHIPPING_ZONES));
}

export function saveShippingZones(zones) {
  localStorage.setItem('zm_shipping_zones', JSON.stringify(zones));
}

export function getDeliveryDays(district) {
  if (!district) return null;
  const zones = getShippingZones();
  const zone = zones.find(z => z.districts.includes(district));
  if (!zone) return '3–7';
  return `${zone.minDays}–${zone.maxDays}`;
}

// ── Store Data Access ─────────────────────────────────────────
export function getProducts() {
  let products;
  try {
    const edited = JSON.parse(localStorage.getItem(LS.editedProducts) || '{}');
    const extra  = JSON.parse(localStorage.getItem(LS.extraProducts)  || '[]');
    const base   = DEFAULT_PRODUCTS.map(p => edited[p.id] ? { ...p, ...edited[p.id] } : { ...p });
    products = [...base, ...extra];
  } catch { products = JSON.parse(JSON.stringify(DEFAULT_PRODUCTS)); }

  return products;
}

export function getCategories() {
  try {
    const raw = localStorage.getItem(LS.categories);
    if (!raw) return JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
    const saved = JSON.parse(raw);
    return Array.isArray(saved) && saved.length > 0 ? saved : JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
  } catch { return JSON.parse(JSON.stringify(DEFAULT_CATEGORIES)); }
}

export function getOrders() {
  try {
    const raw = localStorage.getItem(LS.orders);
    if (raw === null) return []; // no orders yet
    const saved = JSON.parse(raw);
    return Array.isArray(saved) ? saved : JSON.parse(JSON.stringify(DEFAULT_ORDERS));
  } catch { return JSON.parse(JSON.stringify(DEFAULT_ORDERS)); }
}

export function saveUsers(users) {
  localStorage.setItem(LS.users, JSON.stringify(users));
}

export function saveCategories(cats) {
  localStorage.setItem(LS.categories, JSON.stringify(cats));
}

export function saveOrders(orders) {
  localStorage.setItem(LS.orders, JSON.stringify(orders));
  _syncAllUserStats(orders);
}

// ── Auto-sync orders count + totalSpent for every user ────────
function _syncAllUserStats(orders) {
  try {
    const users = getUsers();
    if (!Array.isArray(users) || !users.length) return;

    // Build a per-user aggregation map from ALL orders
    const statsMap = {};
    orders.forEach(order => {
      const uid = order.customerId;
      if (!uid || uid === 'guest') return;
      if (!statsMap[uid]) statsMap[uid] = { orders: 0, totalSpent: 0 };
      statsMap[uid].orders += 1;
      // Count only non-cancelled orders toward totalSpent
      if (order.status !== 'cancelled') {
        statsMap[uid].totalSpent += (order.total || 0);
      }
    });

    // Apply stats back to users array
    let changed = false;
    const updated = users.map(u => {
      const s = statsMap[u.id];
      if (!s) return u;
      const newOrders = s.orders;
      const newSpent  = s.totalSpent;
      if (u.orders !== newOrders || u.totalSpent !== newSpent) {
        changed = true;
        return { ...u, orders: newOrders, totalSpent: newSpent };
      }
      return u;
    });

    if (changed) saveUsers(updated);
  } catch (e) {
    console.warn('[Manarize] _syncAllUserStats failed:', e);
  }
}

export function getUsers() {
  try {
    const raw = localStorage.getItem(LS.users);
    if (raw === null) return DEFAULT_USERS;
    const saved = JSON.parse(raw);
    return Array.isArray(saved) && saved.length > 0 ? saved : DEFAULT_USERS;
  } catch { return DEFAULT_USERS; }
}

export function getCoupons() {
  try {
    const raw = localStorage.getItem(LS.coupons);
    if (!raw) return JSON.parse(JSON.stringify(DEFAULT_COUPONS));
    const saved = JSON.parse(raw);
    return Array.isArray(saved) && saved.length > 0 ? saved : JSON.parse(JSON.stringify(DEFAULT_COUPONS));
  } catch { return JSON.parse(JSON.stringify(DEFAULT_COUPONS)); }
}

export function saveCoupons(coupons) {
  localStorage.setItem(LS.coupons, JSON.stringify(coupons));
}

export function insertCoupon(coupon) {
  const coupons = getCoupons();
  coupons.push(coupon);
  saveCoupons(coupons);
}

export function deleteCoupon(id) {
  saveCoupons(getCoupons().filter(c => c.id !== id));
}

export function toggleCoupon(id, active) {
  const coupons = getCoupons();
  const idx = coupons.findIndex(c => c.id === id);
  if (idx >= 0) { coupons[idx].active = active; saveCoupons(coupons); }
}

export function saveProduct(product) {
  if (DEFAULT_PRODUCTS.find(p => p.id === product.id)) {
    const edited = JSON.parse(localStorage.getItem(LS.editedProducts) || '{}');
    edited[product.id] = product;
    localStorage.setItem(LS.editedProducts, JSON.stringify(edited));
  } else {
    const extra = JSON.parse(localStorage.getItem(LS.extraProducts) || '[]');
    const idx = extra.findIndex(p => p.id === product.id);
    if (idx >= 0) extra[idx] = product; else extra.push(product);
    localStorage.setItem(LS.extraProducts, JSON.stringify(extra));
  }
}

export function deleteProduct(id) {
  const edited = JSON.parse(localStorage.getItem(LS.editedProducts) || '{}');
  delete edited[id];
  localStorage.setItem(LS.editedProducts, JSON.stringify(edited));
  const extra = JSON.parse(localStorage.getItem(LS.extraProducts) || '[]');
  localStorage.setItem(LS.extraProducts, JSON.stringify(extra.filter(p => p.id !== id)));
}

export function generateProductId() {
  const products = getProducts();
  const maxNum = products.reduce((max, p) => {
    const n = parseInt(p.id.replace('PRD-', ''));
    return isNaN(n) ? max : Math.max(max, n);
  }, 0);
  return `PRD-${String(maxNum + 1).padStart(4, '0')}`;
}

export function generateSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function getShippingRate(district) {
  const zones = getShippingZones();
  const zone = zones.find(z => z.districts.includes(district));
  return zone ? zone.rate : 600;
}

// ── Save a single order (append or replace by id) ─────────────
export function saveOneOrder(order) {
  const orders = getOrders();
  const idx = orders.findIndex(o => o.id === order.id);
  if (idx >= 0) { orders[idx] = order; } else { orders.unshift(order); }
  saveOrders(orders);
}

// ── Fetch a single order by ID ────────────────────────────────
export function getOrder(orderId) {
  if (!orderId) return null;
  return getOrders().find(o => o.id === orderId) || null;
}

// ── Decrement stock for ordered items ─────────────────────────
export function decrementStock(items) {
  if (!Array.isArray(items)) return;
  const extra  = JSON.parse(localStorage.getItem(LS.extraProducts)  || '[]');
  const edited = JSON.parse(localStorage.getItem(LS.editedProducts) || '{}');
  items.forEach(({ productId, qty }) => {
    // Check extra products first
    const ei = extra.findIndex(p => p.id === productId);
    if (ei >= 0) {
      extra[ei].stock = Math.max(0, (extra[ei].stock ?? 0) - qty);
      return;
    }
    // Then edited default products
    if (edited[productId]) {
      edited[productId].stock = Math.max(0, (edited[productId].stock ?? 0) - qty);
    }
  });
  localStorage.setItem(LS.extraProducts,  JSON.stringify(extra));
  localStorage.setItem(LS.editedProducts, JSON.stringify(edited));
}

// ── Increment coupon usage counter ────────────────────────────
export function incrementCouponUsage(code) {
  const coupons = getCoupons();
  const idx = coupons.findIndex(c => c.code === code);
  if (idx >= 0) {
    coupons[idx].usageCount = (coupons[idx].usageCount || 0) + 1;
    saveCoupons(coupons);
  }
}

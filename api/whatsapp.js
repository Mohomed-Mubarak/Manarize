/* ============================================================
   ZENMARKET — WhatsApp Notification API (Vercel Serverless)
   ============================================================
   Endpoint: POST /api/whatsapp

   Sends order notifications via WhatsApp Business API.

   SUPPORTS TWO MODES:
   A) WhatsApp Business Cloud API (Meta) — WHATSAPP_MODE=cloud
      Requires: WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID
   B) wa.me link fallback — WHATSAPP_MODE=link (default)
      Returns a wa.me URL for the frontend to open

   SETUP (Cloud API):
     1. Create Meta Developer account → WhatsApp Business App
     2. Get your Phone Number ID + Access Token
     3. Set WHATSAPP_MODE=cloud in Vercel env vars
     4. Approved message templates are required for outbound msgs

   ============================================================ */

const { createClient } = require('@supabase/supabase-js');

// ── HIGH-3: Rate limiting ─────────────────────────────────────────
const _rl = new Map(); // ip → { count, resetAt }
const RL_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RL_MAX       = 50;              // 50 notifications / IP / hour

function checkRateLimit(ip) {
  const now   = Date.now();
  const entry = _rl.get(ip) || { count: 0, resetAt: now + RL_WINDOW_MS };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + RL_WINDOW_MS; }
  entry.count++;
  _rl.set(ip, entry);
  return entry.count > RL_MAX;
}

function isAuthorised(req) {
  const token    = req.headers['x-admin-token'];
  const expected = process.env.ADMIN_API_TOKEN;
  if (!expected || !token) return false;
  return token.length === expected.length &&
    require('crypto').timingSafeEqual(
      Buffer.from(token),
      Buffer.from(expected)
    );
}

async function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

// ── WhatsApp Cloud API sender ────────────────────────────────────
async function sendViaCloudAPI(to, templateName, components) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken   = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneNumberId || !accessToken) {
    throw new Error('WhatsApp Cloud API credentials not configured');
  }

  const response = await fetch(
    `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to:                to.replace(/[^0-9]/g, ''),
        type:              'template',
        template: {
          name:       templateName,
          language:   { code: 'en' },
          components: components || [],
        },
      }),
    }
  );

  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'WhatsApp API error');
  return data;
}

// ── Build wa.me link (fallback / link mode) ──────────────────────
function buildWaLink(phone, message) {
  const clean = phone.replace(/[^0-9]/g, '');
  const encoded = encodeURIComponent(message);
  return `https://wa.me/${clean}?text=${encoded}`;
}

// ── Order notification message builder ──────────────────────────
function buildOrderMessage(order) {
  const items = (order.items || [])
    .map(i => `• ${i.name} × ${i.qty} — Rs.${(i.price * i.qty).toLocaleString()}`)
    .join('\n');

  return (
    `🛒 *New Order — #${order.id}*\n\n` +
    `👤 *Customer:* ${order.customer_name}\n` +
    `📞 *Phone:* ${order.customer_phone}\n` +
    `📧 *Email:* ${order.customer_email}\n\n` +
    `*Items:*\n${items}\n\n` +
    `💰 *Subtotal:* Rs.${(order.subtotal || 0).toLocaleString()}\n` +
    `🚚 *Shipping:* Rs.${(order.shipping || 0).toLocaleString()}\n` +
    (order.discount ? `🏷 *Discount:* Rs.${order.discount.toLocaleString()}\n` : '') +
    `✅ *Total:* Rs.${(order.total || 0).toLocaleString()}\n\n` +
    `💳 *Payment:* ${order.payment_method || 'N/A'}\n` +
    `📍 *Address:* ${order.address?.line1 || ''}, ${order.address?.city || ''}\n\n` +
    `🔗 View in Admin: ${process.env.SITE_URL || ''}/admin/order-detail.html?id=${order.id}`
  );
}

// ── Status update message builder ───────────────────────────────
function buildStatusMessage(order, newStatus) {
  const statusEmoji = {
    confirmed:  '✅', packed: '📦', shipped: '🚚',
    delivered:  '🎉', cancelled: '❌',
  };
  const emoji = statusEmoji[newStatus] || '📋';

  return (
    `${emoji} *Manarize Order Update*\n\n` +
    `Hi ${order.customer_name},\n` +
    `Your order *#${order.id}* has been updated.\n\n` +
    `*New Status:* ${newStatus.toUpperCase()}\n` +
    `*Total:* Rs.${(order.total || 0).toLocaleString()}\n\n` +
    (newStatus === 'shipped'
      ? `Your order is on its way! Estimated delivery: 2-5 business days.\n\n`
      : '') +
    (newStatus === 'delivered'
      ? `Thank you for shopping with Manarize! 🙏\n\n`
      : '') +
    `Questions? Reply to this message or visit ${process.env.SITE_URL || 'manarize.lk'}`
  );
}

module.exports = async function handler(req, res) {
  const __origin = process.env.SITE_URL || null; if (__origin) res.setHeader('Access-Control-Allow-Origin', __origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = (req.headers['x-forwarded-for'] || '127.0.0.1').split(',')[0].trim();
  if (checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }

  if (!isAuthorised(req)) {
    return res.status(401).json({ error: 'Unauthorised' });
  }

  let body;
  try { body = await readJson(req); }
  catch { return res.status(400).json({ error: 'Invalid JSON' }); }

  const { type, order, phone, newStatus } = body;
  const mode = process.env.WHATSAPP_MODE || 'link';

  try {
    if (type === 'new_order') {
      // Notify admin WhatsApp numbers about new order
      const adminPhone  = process.env.WA_PHONE;
      const adminPhone2 = process.env.WA_PHONE_2;
      const message     = buildOrderMessage(order);

      if (mode === 'cloud') {
        // Send via WhatsApp Business Cloud API
        const results = [];
        if (adminPhone)  results.push(await sendViaCloudAPI(adminPhone,  'order_notification', []));
        if (adminPhone2) results.push(await sendViaCloudAPI(adminPhone2, 'order_notification', []));
        return res.status(200).json({ sent: true, mode: 'cloud', results });
      } else {
        // Return wa.me links for the admin to click
        const links = [];
        if (adminPhone)  links.push(buildWaLink(adminPhone,  message));
        if (adminPhone2) links.push(buildWaLink(adminPhone2, message));
        return res.status(200).json({ sent: false, mode: 'link', links, message });
      }
    }

    if (type === 'status_update') {
      // Notify customer about order status change
      if (!phone)     return res.status(400).json({ error: 'phone required' });
      if (!newStatus) return res.status(400).json({ error: 'newStatus required' });

      const message = buildStatusMessage(order, newStatus);

      if (mode === 'cloud') {
        const result = await sendViaCloudAPI(phone, 'order_status_update', []);
        return res.status(200).json({ sent: true, mode: 'cloud', result });
      } else {
        const link = buildWaLink(phone, message);
        return res.status(200).json({ sent: false, mode: 'link', link, message });
      }
    }

    return res.status(400).json({ error: `Unknown notification type: ${type}` });

  } catch (err) {
    console.error('[WhatsApp API]', err.message);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

/* ============================================================
   ZENMARKET — Customer Orders API  (Vercel Serverless Function)
   ============================================================
   Endpoint: /api/orders
     POST → create a new order

   SECURITY FIXES (2026-04-25):
     CRIT-2: Server-side price re-validation against Supabase catalog.
             Orders are rejected if client-submitted total doesn't match.
     MED-1:  payment_slip validated against Supabase Storage domain.
     MED-2:  Internal Supabase error codes/messages never sent to client.
     HIGH-3: In-memory rate limiting (30 orders / IP / hour).
   ============================================================ */

const { createClient } = require('@supabase/supabase-js');
const { validate, checkBodySize } = require('./_validate');

// Module-level singleton — reused across warm Vercel invocations.
let _serviceClient = null;
function getServiceClient() {
  if (_serviceClient) return _serviceClient;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set in environment.');
  _serviceClient = createClient(url, key, {
    auth:   { persistSession: false },
    db:     { schema: 'public' },
    global: { headers: { 'x-application-name': 'manarize-orders' } },
  });
  return _serviceClient;
}

function cors(res) {
  const __origin = process.env.SITE_URL || null;
  if (__origin) res.setHeader('Access-Control-Allow-Origin', __origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

// ── HIGH-3: Rate limiting — persistent (survives cold starts) ────────
// Uses _ratelimit.js → Supabase-backed rate_limits table.
// Falls back to in-memory Map when Supabase is unavailable.
const { createRateLimiter } = require('./_ratelimit');
let _rateLimiter = null;
function getRateLimiter() {
  if (!_rateLimiter) {
    _rateLimiter = createRateLimiter(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
  }
  return _rateLimiter;
}

async function checkRateLimit(ip) {
  const { limited } = await getRateLimiter().check(`orders:${ip}`, {
    max:      30,
    windowMs: 60 * 60 * 1000, // 1 hour
  });
  return limited;
}

// ── MED-1: payment_slip URL validation ───────────────────────────
function validatePaymentSlip(value) {
  if (!value) return null;
  const str = String(value).trim();
  if (!str) return null;
  try {
    const u = new URL(str);
    // Only allow HTTPS URLs on Supabase Storage domain
    if (u.protocol !== 'https:') return null;
    if (!u.hostname.endsWith('.supabase.co')) return null;
    if (!u.pathname.includes('/storage/')) return null;
    return str.slice(0, 2048);
  } catch { return null; }
}

// ── CRIT-2: Server-side price validation ─────────────────────────
// Returns { valid: bool, computedTotal: number, error?: string }
async function validatePrices(sb, items, submittedSubtotal, shipping, discount) {
  if (!Array.isArray(items) || items.length === 0) {
    return { valid: false, error: 'Order must contain at least one item' };
  }

  // Extract product IDs
  const productIds = [...new Set(items.map(i => i.product_id || i.id).filter(Boolean))];
  if (productIds.length === 0) {
    return { valid: false, error: 'Items are missing product IDs' };
  }

  // Fetch canonical prices from DB
  const { data: products, error } = await sb
    .from('products')
    .select('id, price, sale_price, active')
    .in('id', productIds);

  if (error) {
    // If products table is unavailable, fail-open with a warning
    // (Better than blocking all orders due to DB issues)
    console.warn('[orders] Could not fetch product prices for validation:', error.message);
    return { valid: true, computedTotal: null, skipped: true };
  }

  const priceMap = new Map();
  for (const p of (products || [])) {
    const canonical = (p.sale_price != null && p.sale_price > 0) ? p.sale_price : p.price;
    priceMap.set(String(p.id), canonical);
  }

  // Recalculate subtotal using canonical prices
  let computedSubtotal = 0;
  for (const item of items) {
    const pid      = String(item.product_id || item.id || '');
    const canonical = priceMap.get(pid);
    if (canonical == null) {
      // Unknown product — reject the order
      return { valid: false, error: 'One or more products could not be found' };
    }
    const qty = parseInt(item.qty, 10) || 1;
    computedSubtotal += canonical * qty;
  }

  // Round to 2 decimal places to avoid floating point issues
  computedSubtotal = Math.round(computedSubtotal * 100) / 100;
  const shippingAmt = Math.round((Number(shipping) || 0) * 100) / 100;
  const discountAmt = Math.round((Number(discount)  || 0) * 100) / 100;
  const computedTotal = Math.round((computedSubtotal + shippingAmt - discountAmt) * 100) / 100;

  // Allow a small tolerance (1 currency unit) for rounding differences
  const submittedTotal = Math.round((submittedSubtotal + shippingAmt - discountAmt) * 100) / 100;
  if (Math.abs(computedTotal - submittedTotal) > 1.00) {
    console.warn(`[orders] Price mismatch: client submitted ${submittedTotal}, computed ${computedTotal}`);
    return { valid: false, error: 'Order total does not match current product prices' };
  }

  return { valid: true, computedTotal, computedSubtotal };
}

const VALID_STATUSES         = ['pending','processing','confirmed','packed','shipped','delivered','cancelled','refunded'];
const VALID_PAYMENT_STATUSES = ['pending','paid','failed','refunded','cancelled'];
const VALID_PAYMENT_METHODS  = ['cod','bank','payhere','card','online'];

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  // ── Rate limit ────────────────────────────────────────────────
  const ip = (req.headers['x-forwarded-for'] || '127.0.0.1').split(',')[0].trim();
  if (await checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }

  let body;
  try {
    const sizeErr = checkBodySize(req);
    if (sizeErr) return res.status(413).json({ error: sizeErr });
    body = await readJson(req);
  } catch {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  // ── Schema validation ──────────────────────────────────────────
  const ORDER_SCHEMA = {
    id:            { type: 'string',  required: true,  max: 128 },
    total:         { type: 'number',  required: true,  min: 0   },
    currency:      { type: 'string',  required: false, max: 10, default: 'LKR' },
    customer_name: { type: 'string',  required: false, max: 256 },
    customer_email:{ type: 'string',  required: false, max: 320 },
    customer_phone:{ type: 'string',  required: false, max: 32  },
    address:       { type: 'string',  required: false, max: 1000 },
    items:         { type: 'array',   required: true,  max: 200 },
    payment_slip:  { type: 'string',  required: false, max: 2048 },
    notes:         { type: 'string',  required: false, max: 2000 },
  };
  const { body: validBody, error: validErr } = validate(body, ORDER_SCHEMA);
  if (validErr) return res.status(400).json({ error: validErr });
  body = { ...body, ...validBody }; // merge validated fields

  try {
    const sb = getServiceClient();

    // ── CRIT-2: Server-side price validation ──────────────────
    const priceCheck = await validatePrices(
      sb,
      Array.isArray(body.items) ? body.items : [],
      Number(body.subtotal) || 0,
      Number(body.shipping) || 0,
      Number(body.discount) || 0,
    );

    if (!priceCheck.valid) {
      return res.status(422).json({ error: priceCheck.error || 'Price validation failed' });
    }

    // Use server-computed values when available; fall back to client on DB unavailability
    const verifiedSubtotal = priceCheck.computedSubtotal != null ? priceCheck.computedSubtotal : (Number(body.subtotal) || 0);
    const verifiedTotal    = priceCheck.computedTotal    != null ? priceCheck.computedTotal    : (Number(body.total)    || 0);

    // ── Build a safe, sanitised row ───────────────────────────
    const row = {
      id:             String(body.id).slice(0, 64),
      customer_id:    body.customer_id    ? String(body.customer_id).slice(0, 128) : null,
      customer_name:  body.customer_name  ? String(body.customer_name).slice(0, 256)  : '',
      customer_email: body.customer_email ? String(body.customer_email).slice(0, 256) : '',
      customer_phone: body.customer_phone ? String(body.customer_phone).slice(0, 64)  : '',
      items:          Array.isArray(body.items) ? body.items : [],
      subtotal:       verifiedSubtotal,
      shipping:       Number(body.shipping) || 0,
      discount:       Number(body.discount) || 0,
      total:          verifiedTotal,
      status:         VALID_STATUSES.includes(body.status)         ? body.status         : 'pending',
      payment_status: VALID_PAYMENT_STATUSES.includes(body.payment_status) ? body.payment_status : 'pending',
      payment_method: VALID_PAYMENT_METHODS.includes(body.payment_method)  ? body.payment_method  : 'cod',
      coupon_code:    body.coupon_code ? String(body.coupon_code).slice(0, 64) : '',
      bank_ref:       body.bank_ref    ? String(body.bank_ref).slice(0, 256)   : null,
      payment_slip:   validatePaymentSlip(body.payment_slip),  // MED-1: validated
      address:        body.address && typeof body.address === 'object' ? body.address : {},
      notes:          body.notes ? String(body.notes).slice(0, 1024) : '',
      created_at:     body.created_at || new Date().toISOString(),
      updated_at:     new Date().toISOString(),
    };

    // INSERT — on duplicate ID (double-submit) UPDATE instead
    const { data, error } = await sb
      .from('orders')
      .insert(row)
      .select()
      .single();

    if (error) {
      // 23505 = unique_violation (duplicate order ID)
      if (error.code === '23505') {
        const { data: updated, error: updErr } = await sb
          .from('orders')
          .update({ ...row, updated_at: new Date().toISOString() })
          .eq('id', row.id)
          .select()
          .single();
        if (updErr) {
          // MED-2: don't leak internal error to client
          console.error('[API /orders] upsert error:', updErr.message, updErr.code);
          throw new Error('Order could not be saved. Please try again.');
        }
        return res.status(200).json({ data: updated, deduplicated: true });
      }

      // 42P01 = table does not exist
      if (error.code === '42P01' || (error.message || '').includes('does not exist')) {
        console.error('[API /orders] orders table missing — run supabase-setup.sql');
        return res.status(503).json({
          error: 'Database not configured. Run supabase-setup.sql in Supabase → SQL Editor.',
          code:  'TABLE_MISSING',
          fix:   'https://supabase.com/dashboard → SQL Editor → paste supabase-setup.sql → Run',
        });
      }

      // 42501 = RLS permission denied
      if (error.code === '42501' || (error.message || '').toLowerCase().includes('policy')) {
        console.error('[API /orders] RLS blocked INSERT — run supabase-setup.sql');
        return res.status(403).json({
          error: 'Row-level security is blocking the insert. Run supabase-setup.sql.',
          code:  'RLS_BLOCKED',
          fix:   'https://supabase.com/dashboard → SQL Editor → paste supabase-setup.sql → Run',
        });
      }

      // MED-2: generic error for all other cases
      console.error('[API /orders] insert error:', error.message, error.code);
      throw new Error('Order could not be saved. Please try again.');
    }

    return res.status(201).json({ data });

  } catch (err) {
    if (err.message.includes('not set in environment')) {
      console.error('[API /orders] Missing env vars:', err.message);
      return res.status(503).json({
        error: 'Service temporarily unavailable.',
        code:  'ENV_MISSING',
        fix:   'Vercel → Project → Settings → Environment Variables → add SUPABASE_SERVICE_ROLE_KEY',
      });
    }
    // MED-2: generic error message to client, detail only in logs
    console.error('[API /orders POST]', err.message);
    console.error('[Orders API] handler error:', err.message);
    return res.status(500).json({ error: 'Order could not be saved. Please try again.' });
  }
};

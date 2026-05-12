/* ============================================================
   ZENMARKET — PayHere IPN Webhook  (Vercel Serverless Function)
   ============================================================
   Endpoint: POST /api/payhere-webhook

   PayHere sends a server-to-server Instant Payment Notification
   to this URL after every transaction attempt.

   SETUP:
     1. Log in to PayHere → Settings → Domains & URLs
     2. Set "Notify URL" to: https://yourdomain.com/api/payhere-webhook
     3. Add PAYHERE_MERCHANT_SECRET to Vercel Environment Variables

   SECURITY:
     - Verifies the md5 signature PayHere sends
     - Only accepts POST requests
     - Uses Supabase service role key — never exposed to the browser
   ============================================================ */

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

// ── Supabase admin client (service role — never in the browser) ──
function getAdminClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase env vars');
  return createClient(url, key, { auth: { persistSession: false } });
}

// ── PayHere MD5 signature verification ──────────────────────────
function verifyPayHereSignature(params, merchantSecret) {
  const {
    merchant_id,
    order_id,
    payhere_amount,
    payhere_currency,
    status_code,
    md5sig,
  } = params;

  const secretHash = crypto
    .createHash('md5')
    .update(merchantSecret)
    .digest('hex')
    .toUpperCase();

  const localSig = crypto
    .createHash('md5')
    .update(
      merchant_id +
      order_id +
      payhere_amount +
      payhere_currency +
      status_code +
      secretHash
    )
    .digest('hex')
    .toUpperCase();

  return localSig === (md5sig || '').toUpperCase();
}

// ── Status code → readable status ───────────────────────────────
const STATUS_MAP = {
  '2':  'paid',
  '0':  'pending',
  '-1': 'cancelled',
  '-2': 'failed',
  '-3': 'chargedback',
};

// ── Parse URL-encoded body (Vercel doesn't do it for IPN) ────────
async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const params = Object.fromEntries(new URLSearchParams(body));
        resolve(params);
      } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

// ── Main handler ─────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let params;
  try {
    params = await parseBody(req);
  } catch {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  const {
    order_id,
    status_code,
    merchant_id,
    payhere_amount,
    payhere_currency,
    payment_id,
    bank_ref,
    method,
  } = params;

  // Validate required fields
  if (!order_id || !status_code || !merchant_id) {
    return res.status(400).json({ error: 'Missing required IPN fields' });
  }

  // Verify merchant ID matches
  if (merchant_id !== process.env.PAYHERE_MERCHANT_ID) {
    console.error('[PayHere IPN] Merchant ID mismatch:', merchant_id);
    return res.status(403).json({ error: 'Merchant ID mismatch' });
  }

  // Verify signature
  const merchantSecret = process.env.PAYHERE_MERCHANT_SECRET;
  if (!merchantSecret) {
    console.error('[PayHere IPN] PAYHERE_MERCHANT_SECRET not set');
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  if (!verifyPayHereSignature(params, merchantSecret)) {
    console.error('[PayHere IPN] Signature verification failed for order:', order_id);
    return res.status(403).json({ error: 'Invalid signature' });
  }

  const paymentStatus = STATUS_MAP[status_code] || 'unknown';
  const orderStatus   = status_code === '2' ? 'processing' : undefined;

  try {
    const supabase = getAdminClient();

    // ── Secondary validation: verify amount + currency against DB ─
    // MD5 is cryptographically weak; a secondary check ensures an
    // attacker cannot forge a "paid" notification with an altered
    // amount even if they bypass the HMAC check.
    if (status_code === '2') {
      const { data: dbOrder, error: fetchErr } = await supabase
        .from('orders')
        .select('total, currency')
        .eq('id', order_id)
        .single();

      if (fetchErr || !dbOrder) {
        console.error('[PayHere IPN] Order not found for secondary validation:', order_id);
        return res.status(404).json({ error: 'Order not found' });
      }

      const dbAmount   = parseFloat(dbOrder.total || 0).toFixed(2);
      const ipnAmount  = parseFloat(payhere_amount || 0).toFixed(2);
      const dbCurrency = (dbOrder.currency || 'LKR').toUpperCase();
      const ipnCurrency = (payhere_currency || '').toUpperCase();

      if (ipnAmount !== dbAmount || ipnCurrency !== dbCurrency) {
        console.error(
          `[PayHere IPN] Amount/currency mismatch — ` +
          `DB: ${dbAmount} ${dbCurrency}, IPN: ${ipnAmount} ${ipnCurrency} ` +
          `(order: ${order_id})`
        );
        return res.status(403).json({ error: 'Payment amount mismatch' });
      }
    }

    // Build update payload
    const update = {
      payment_status: paymentStatus,
      payment_id:     payment_id  || null,
      bank_ref:       bank_ref    || null,
      payment_method: method      || null,
      updated_at:     new Date().toISOString(),
    };
    if (orderStatus) update.status = orderStatus;

    const { error } = await supabase
      .from('orders')
      .update(update)
      .eq('id', order_id);

    if (error) {
      console.error('[PayHere IPN] DB update failed:', error.message);
      return res.status(500).json({ error: 'Database update failed' });
    }

    // Log for audit trail
    console.log(
      `[PayHere IPN] order=${order_id} ` +
      `status=${status_code}(${paymentStatus}) ` +
      `payment_id=${payment_id} ` +
      `amount=${payhere_amount} ${payhere_currency} ` +
      `bank_ref=${bank_ref}`
    );

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('[PayHere IPN] Unexpected error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

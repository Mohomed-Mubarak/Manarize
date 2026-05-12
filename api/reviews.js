/* ============================================================
   MANARIZE — Public Reviews API  (Vercel Serverless Function)
   Zero external dependencies — uses native fetch() only.
   Node 18+ built-in fetch is used; no @supabase/supabase-js needed.

   GET /api/reviews
     ?ids=REV-123,REV-456  → specific admin review IDs (REV- prefix)
     ?ids=uuid1,uuid2      → specific product review UUIDs
     ?limit=20             → max results (capped at 100)
   ============================================================ */

'use strict';

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || process.env.SITE_URL || null;

function setCors(res, reqOrigin) {
  // Never use wildcard — restrict to explicit storefront origin.
  // Set ALLOWED_ORIGIN (or SITE_URL) in Vercel env vars.
  if (ALLOWED_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  } else if (reqOrigin) {
    // Fallback for local dev only — log a warning in prod
    console.warn('[/api/reviews] ALLOWED_ORIGIN not set — reflecting request origin');
    res.setHeader('Access-Control-Allow-Origin', reqOrigin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
}

// Thin Supabase REST helper — no SDK needed
function supabaseREST(url, key) {
  const base = url.replace(/\/$/, '') + '/rest/v1';
  const headers = {
    'apikey':        key,
    'Authorization': 'Bearer ' + key,
    'Content-Type':  'application/json',
    'Prefer':        'return=representation',
  };

  return {
    async select(table, query) {
      const qs = new URLSearchParams(query).toString();
      const res = await fetch(`${base}/${table}?${qs}`, { headers, signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
      return res.json();
    },
  };
}

module.exports = async function handler(req, res) {
  try {
    setCors(res, req.headers.origin);
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'GET')    return res.status(405).json({ error: 'Method not allowed' });

    const sbUrl = process.env.SUPABASE_URL;
    const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!sbUrl || !sbKey || sbUrl.includes('YOUR_PROJECT')) {
      console.warn('[/api/reviews] Missing or placeholder Supabase env vars');
      return res.status(200).json({ data: [], count: 0, error: 'Supabase not configured' });
    }

    const limit  = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const rawIds = req.query.ids
      ? req.query.ids.split(',').map(s => s.trim()).filter(Boolean)
      : [];

    const adminIds   = rawIds.filter(id => id.startsWith('REV-'));
    const productIds = rawIds.filter(id => !id.startsWith('REV-'));

    // When caller only passes REV-* IDs they want ONLY those admin reviews
    const wantsAdminOnly = rawIds.length > 0 && adminIds.length === rawIds.length;

    const sb = supabaseREST(sbUrl, sbKey);

    // ── 1. Admin-curated reviews from site_settings ─────────────
    const adminReviews = [];
    try {
      const rows = await sb.select('site_settings', {
        'key': 'eq.zm_admin_reviews',
        'select': 'value',
      });

      if (rows && rows[0] && rows[0].value != null) {
        const raw = rows[0].value;
        let arr = [];
        if (Array.isArray(raw)) {
          arr = raw;
        } else if (raw && typeof raw === 'object' && Array.isArray(raw.v)) {
          arr = raw.v;
        } else if (typeof raw === 'string') {
          try {
            const p = JSON.parse(raw);
            arr = Array.isArray(p) ? p : (p && Array.isArray(p.v) ? p.v : []);
          } catch { /* ignore */ }
        }

        arr.forEach(function(r) {
          if (!r || !r.id) return;
          if (r.status !== 'approved') return;
          if (adminIds.length > 0 && !adminIds.includes(r.id)) return;
          adminReviews.push({
            id:       r.id       || '',
            source:   'admin',
            customer: r.customer || 'Anonymous',
            product:  r.product  || '',
            rating:   Number(r.rating) || 5,
            text:     r.text     || '',
            date:     r.date     || r.createdAt || new Date().toISOString(),
            verified: false,
            status:   'approved',
          });
        });
      }
    } catch (e) {
      console.error('[/api/reviews] admin fetch:', e.message);
    }

    // ── 2. Product reviews (skip when only admin IDs requested) ─
    const productReviews = [];
    if (!wantsAdminOnly) {
      try {
        const query = {
          'approved': 'eq.true',
          'rejected': 'eq.false',
          'select':   'id,user_name,product_id,rating,body,title,created_at,verified',
          'order':    'created_at.desc',
          'limit':    String(limit),
        };
        if (productIds.length > 0) {
          query['id'] = 'in.(' + productIds.join(',') + ')';
        }

        const rows = await sb.select('reviews', query);
        if (Array.isArray(rows)) {
          rows.forEach(function(r) {
            productReviews.push({
              id:       r.id         || '',
              source:   'product',
              customer: r.user_name  || 'Anonymous',
              product:  r.product_id || '',
              rating:   Number(r.rating) || 5,
              text:     r.body       || '',
              title:    r.title      || '',
              date:     r.created_at,
              verified: !!r.verified,
              status:   'approved',
            });
          });
        }
      } catch (e) {
        console.error('[/api/reviews] product fetch:', e.message);
      }
    }

    const merged = adminReviews.concat(productReviews)
      .sort(function(a, b) { return new Date(b.date) - new Date(a.date); })
      .slice(0, limit);

    return res.status(200).json({ data: merged, count: merged.length });

  } catch (fatal) {
    console.error('[/api/reviews] fatal:', fatal.message);
    return res.status(200).json({ data: [], count: 0 });
  }
};

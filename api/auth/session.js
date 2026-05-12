'use strict';
/**
 * /api/auth/session  — Supabase token cookie proxy
 *
 * POST /api/auth/session   { access_token, refresh_token, expires_at }
 * GET  /api/auth/session   → { session } | { session: null }
 * DELETE /api/auth/session → clears cookies
 */

const IS_PROD = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || process.env.SITE_URL || null;

const COOKIE_OPTS = [
  'HttpOnly',
  'SameSite=Strict',
  IS_PROD ? 'Secure' : '',
  'Path=/',
  'Max-Age=604800',
].filter(Boolean).join('; ');

const CLEAR_OPTS = [
  'HttpOnly',
  'SameSite=Strict',
  IS_PROD ? 'Secure' : '',
  'Path=/',
  'Max-Age=0',
  'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
].filter(Boolean).join('; ');

function setCors(res, origin) {
  const allow = ALLOWED_ORIGIN || origin || '*';
  res.setHeader('Access-Control-Allow-Origin', allow);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
}

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  if (!raw) return {};
  return Object.fromEntries(
    raw.split(';').map(c => {
      const eq = c.indexOf('=');
      if (eq < 0) return [c.trim(), ''];
      return [c.slice(0, eq).trim(), c.slice(eq + 1).trim()];
    })
  );
}

async function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 8000) reject(new Error('Body too large'));
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  try {
    setCors(res, req.headers.origin);

    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }

    // POST — store tokens in httpOnly cookies
    if (req.method === 'POST') {
      let body;
      try { body = await readJson(req); }
      catch (e) { return res.status(400).json({ error: e.message }); }

      const { access_token, refresh_token, expires_at } = body;

      if (!access_token || typeof access_token !== 'string' ||
          !refresh_token || typeof refresh_token !== 'string') {
        return res.status(400).json({ error: 'access_token and refresh_token required' });
      }

      if (access_token.split('.').length !== 3) {
        return res.status(400).json({ error: 'Invalid access_token format' });
      }

      res.setHeader('Set-Cookie', [
        `sb-access-token=${encodeURIComponent(access_token)}; ${COOKIE_OPTS}`,
        `sb-refresh-token=${encodeURIComponent(refresh_token)}; ${COOKIE_OPTS}`,
        `sb-expires-at=${expires_at || ''}; ${COOKIE_OPTS}`,
      ]);
      return res.status(200).json({ ok: true });
    }

    // GET — return tokens from cookies
    if (req.method === 'GET') {
      const cookies = parseCookies(req);
      const access_token  = decodeURIComponent(cookies['sb-access-token']  || '');
      const refresh_token = decodeURIComponent(cookies['sb-refresh-token'] || '');
      const expires_at    = cookies['sb-expires-at'] || null;

      if (!access_token || !refresh_token) {
        return res.status(200).json({ session: null });
      }

      return res.status(200).json({
        session: {
          access_token,
          refresh_token,
          expires_at: Number(expires_at) || null,
        },
      });
    }

    // DELETE — clear cookies
    if (req.method === 'DELETE') {
      res.setHeader('Set-Cookie', [
        `sb-access-token=; ${CLEAR_OPTS}`,
        `sb-refresh-token=; ${CLEAR_OPTS}`,
        `sb-expires-at=; ${CLEAR_OPTS}`,
      ]);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('[api/auth/session] Unhandled error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

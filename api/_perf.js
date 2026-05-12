/* ============================================================
   MANARIZE — API Performance Utilities
   ============================================================
   Shared helpers for all serverless functions:
   • ETag / conditional GET (304 Not Modified)
   • JSON response compression hint
   • Timing header injection (Server-Timing)
   • CORS with strict origin check
   ============================================================ */

const crypto = require('crypto');

/**
 * Set standard CORS headers with strict origin pinning.
 * @param {object} res  Node/Vercel response
 * @param {string} method  HTTP method (for Allow header)
 */
function setCors(res, method = 'GET, POST, OPTIONS') {
  const origin = process.env.SITE_URL || null;
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', method);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token');
  res.setHeader('Vary', 'Origin');
}

/**
 * Send a JSON response with ETag for conditional caching.
 * If the client sends a matching If-None-Match header, returns 304.
 * @param {object} req
 * @param {object} res
 * @param {number} status  HTTP status code
 * @param {any}    data    JSON-serialisable payload
 * @param {object} opts    { maxAge: seconds, timing: string }
 */
function jsonResponse(req, res, status, data, opts = {}) {
  const { maxAge = 0, timing } = opts;
  const json = JSON.stringify(data);

  // ETag: weak hash of the response body
  const etag = `W/"${crypto.createHash('md5').update(json).digest('hex').slice(0, 16)}"`;
  res.setHeader('ETag', etag);

  // Cache-Control
  if (maxAge > 0) {
    res.setHeader('Cache-Control', `public, max-age=${maxAge}, stale-while-revalidate=${maxAge * 2}`);
  } else {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  }

  // Server-Timing (visible in Chrome DevTools → Network → Timing)
  if (timing) res.setHeader('Server-Timing', timing);

  // Conditional GET — 304 Not Modified
  if (req.headers['if-none-match'] === etag && status === 200) {
    res.status(304).end();
    return;
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(status).send(json);
}

/**
 * Simple request timer.
 * Usage:
 *   const t = startTimer();
 *   // ... do work ...
 *   const ms = t.end();
 *   jsonResponse(req, res, 200, data, { timing: `db;dur=${ms}` });
 */
function startTimer() {
  const start = Date.now();
  return { end: () => Date.now() - start };
}

/**
 * Parse request body as JSON.
 * Rejects on invalid JSON or body > maxBytes (default 64 KB).
 */
async function readJson(req, maxBytes = 65536) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

module.exports = { setCors, jsonResponse, startTimer, readJson };

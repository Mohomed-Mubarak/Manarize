#!/usr/bin/env node
/* ============================================================
   ZENMARKET — LOCAL DEV SERVER
   ============================================================
   Runs the project locally with BOTH:
     • Static file serving  (HTML, CSS, JS, etc.)
     • /api/* routes        (same handlers as Vercel serverless)

   FIRST TIME SETUP:
     npm install          ← install @supabase/supabase-js
     node build.js        ← generate js/env.js from .env
     node server.js       ← start the server

   SHORTCUT (build + serve in one):
     npm run dev:local

   Usage:
     node server.js            # default port 3000
     PORT=8080 node server.js
   ============================================================ */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const url  = require('url');

// ── Load .env before anything else ───────────────────────────────
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eq = trimmed.indexOf('=');
    if (eq < 0) return;
    const key = trimmed.slice(0, eq).trim();
    let val   = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (!(key in process.env)) process.env[key] = val;
  });
  console.log('[server] Loaded .env');
} else {
  console.warn('[server] No .env found — using existing process.env');
}

// ── node_modules check ───────────────────────────────────────────
if (!fs.existsSync(path.join(__dirname, 'node_modules', '@supabase'))) {
  console.error('');
  console.error('ERROR: Dependencies not installed.');
  console.error('Run:   npm install');
  console.error('Then:  node server.js');
  process.exit(1);
}

const PORT = parseInt(process.env.PORT || '3000', 10);
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
  '.txt':  'text/plain',
  '.xml':  'application/xml',
};

const API_ROUTES = {
  '/api/health':            path.join(ROOT, 'api/health.js'),
  '/api/reviews':           path.join(ROOT, 'api/reviews.js'),
  '/api/verify-captcha':    path.join(ROOT, 'api/verify-captcha.js'),
  '/api/orders':            path.join(ROOT, 'api/orders.js'),
  '/api/whatsapp':          path.join(ROOT, 'api/whatsapp.js'),
  '/api/payhere-webhook':   path.join(ROOT, 'api/payhere-webhook.js'),
  '/api/auth/session':      path.join(ROOT, 'api/auth/session.js'),
  '/api/auth/profile':      path.join(ROOT, 'api/auth/profile.js'),
  '/api/user-orders':       path.join(ROOT, 'api/user-orders.js'),
  '/api/admin/db-status':   path.join(ROOT, 'api/admin/db-status.js'),
  '/api/admin/auth':        path.join(ROOT, 'api/admin/auth.js'),
  '/api/admin/orders':      path.join(ROOT, 'api/admin/orders.js'),
  '/api/admin/products':    path.join(ROOT, 'api/admin/products.js'),
  '/api/admin/reviews':     path.join(ROOT, 'api/admin/reviews.js'),
  '/api/admin/users':             path.join(ROOT, 'api/admin/users.js'),
  '/api/admin/config':            path.join(ROOT, 'api/admin/config.js'),
  '/api/admin/upload':            path.join(ROOT, 'api/admin/upload.js'),
  '/api/admin/contact-messages':  path.join(ROOT, 'api/admin/contact-messages.js'),
  '/api/admin/newsletter':        path.join(ROOT, 'api/admin/newsletter.js'),
};

function wrapRes(raw) {
  let _status = 200;
  const proxy = {
    status(code)   { _status = code; return proxy; },
    setHeader(k,v) { raw.setHeader(k, v); return proxy; },
    json(data) {
      if (!raw.headersSent)
        raw.writeHead(_status, { 'Content-Type': 'application/json' });
      raw.end(JSON.stringify(data));
    },
    send(data) {
      if (!raw.headersSent) raw.writeHead(_status);
      raw.end(data != null ? String(data) : '');
    },
    end(data) {
      if (!raw.headersSent) raw.writeHead(_status);
      raw.end(data != null ? data : '');
    },
  };
  return proxy;
}

function augmentReq(req, parsedUrl) {
  req.query = Object.fromEntries(new URLSearchParams(parsedUrl.query || ''));
  return req;
}

function serveFile(res, filePath, statusCode) {
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    const mime = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(statusCode || 200, { 'Content-Type': mime });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname  = (parsedUrl.pathname || '/').replace(/\/+$/, '') || '/';

  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // API routes
  const handlerPath = API_ROUTES[pathname];
  if (handlerPath) {
    try {
      delete require.cache[require.resolve(handlerPath)];
      const handler = require(handlerPath);
      augmentReq(req, parsedUrl);
      await handler(req, wrapRes(res));
    } catch (err) {
      console.error('[server] API error', pathname, ':', err.message);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Static files
  let filePath = path.join(ROOT, pathname);
  if (!path.extname(filePath)) {
    const a = filePath + '.html';
    const b = path.join(filePath, 'index.html');
    try { if (fs.statSync(a).isFile()) filePath = a; } catch {}
    try { if (filePath === path.join(ROOT, pathname) && fs.statSync(b).isFile()) filePath = b; } catch {}
  }

  try {
    if (fs.statSync(filePath).isFile()) { serveFile(res, filePath); return; }
  } catch {}

  const p404 = path.join(ROOT, '404.html');
  try { if (fs.statSync(p404).isFile()) { serveFile(res, p404, 404); return; } } catch {}
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('404 Not Found');
});

server.listen(PORT, () => {
  console.log('');
  console.log('  Manarize Dev Server running at http://localhost:' + PORT);
  console.log('  /api/* routes handled by local serverless functions');
  console.log('');
  console.log('  SUPABASE_URL:              ' + (process.env.SUPABASE_URL             ? 'set' : 'MISSING'));
  console.log('  SUPABASE_SERVICE_ROLE_KEY: ' + (process.env.SUPABASE_SERVICE_ROLE_KEY ? 'set' : 'MISSING'));
  console.log('  ADMIN_API_TOKEN:           ' + (process.env.ADMIN_API_TOKEN           ? 'set' : 'MISSING'));
  console.log('');
  console.log('  Press Ctrl+C to stop.');
  console.log('');
});

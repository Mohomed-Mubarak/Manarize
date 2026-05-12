/**
 * perf-build.js — Performance build step for Manarize
 * Called at the end of build.js
 * Does:
 *   1. Minify all js/**‌/*.js → dist/js/ (preserving structure)
 *   2. Process all HTML: defer CSS, update JS paths, add preloads, fix lazy images,
 *      INLINE theme-init.js (eliminates render-blocking request),
 *      add ?v=BUILD_HASH to all CSS/JS hrefs (cache busting with immutable headers)
 *   3. Update sw.js PRECACHE_URLS to reference dist/js/ files
 *   4. Upgrade /js/ cache headers to immutable (safe because ?v= busts cache)
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

// Build hash — stable per build, changes on any file modification
const BUILD_HASH = (() => {
  try {
    return require('child_process')
      .execSync('git rev-parse --short HEAD', { cwd: __dirname, stdio: ['pipe','pipe','pipe'] })
      .toString().trim();
  } catch {
    // Fallback: hash of current timestamp rounded to minute (reproducible within a build)
    return crypto.createHash('md5')
      .update(String(Math.floor(Date.now() / 60000)))
      .digest('hex').slice(0, 8);
  }
})();

const ROOT = __dirname;

// ── 1. JS MINIFICATION ─────────────────────────────────────────────────────

async function minifyJs() {
  let esbuild;
  try { esbuild = require('esbuild'); } catch {
    console.warn('[perf] ⚠  esbuild not available — skipping JS minification');
    return false;
  }

  const jsDir    = path.join(ROOT, 'js');
  const distJs   = path.join(ROOT, 'dist', 'js');
  fs.mkdirSync(distJs, { recursive: true });

  function collectJs(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return collectJs(full);
      if (e.name.endsWith('.js') && !e.name.endsWith('.bak') && e.name !== 'env.js') return [full];
      return [];
    });
  }

  const files = collectJs(jsDir);

  try {
    await esbuild.build({
      entryPoints: files,
      bundle:      false,   // Keep ESM imports as-is (avoid circular-dep bundling)
      minify:      true,
      format:      'esm',
      outdir:      distJs,
      outbase:     jsDir,
      target:      ['es2020'],
      logLevel:    'warning',
    });

    // Copy generated env.js (not minified — it's tiny and auto-generated)
    const envSrc = path.join(jsDir, 'env.js');
    if (fs.existsSync(envSrc)) {
      fs.copyFileSync(envSrc, path.join(distJs, 'env.js'));
    }

    // Create admin/ and pages/ subdirs if needed
    ['admin', 'pages'].forEach(sub => {
      const d = path.join(distJs, sub);
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    });

    console.log(`[perf] ✓ JS minified → dist/js/ (${files.length} files)`);
    return true;
  } catch (e) {
    console.error('[perf] esbuild error:', e.message);
    return false;
  }
}

// ── 2. HTML PROCESSING ─────────────────────────────────────────────────────

// Inlined theme-init snippet — keep in sync with js/theme-init.js
const THEME_INIT_INLINE = `(function(){var t=localStorage.getItem("zm_theme");t&&t!=="dark"&&document.documentElement.setAttribute("data-theme",t)})();`;

function processHtml(filePath) {
  let html = fs.readFileSync(filePath, 'utf8');

  // ── 2a. Defer all CSS <link> tags except loader.css ──────────────────────
  // First, extract noscript blocks so we don't touch them
  const noscriptPlaceholders = [];
  html = html.replace(/<noscript>[\s\S]*?<\/noscript>/gi, match => {
    const idx = noscriptPlaceholders.length;
    noscriptPlaceholders.push(match);
    return `<!--NOSCRIPT_${idx}-->`;
  });

  // Match: <link rel="stylesheet" href="..."> NOT already having media="print"
  html = html.replace(
    /(<link\s+rel="stylesheet"\s+href="([^"]*\.css)")((?:\s+[^>]*?)?)(>)/g,
    (match, open, href, rest, close) => {
      if (rest.includes('media="print"') || rest.includes('data-defer')) return match;
      if (href.endsWith('loader.css')) return match;
      return `${open} media="print" data-defer="true"${rest}${close}`;
    }
  );

  // Restore noscript blocks (with media="all" in their links, not print)
  noscriptPlaceholders.forEach((block, idx) => {
    // Ensure noscript links have media="all" (remove print/defer if present)
    const fixed = block.replace(/\s+media="print"\s+data-defer="true"/g, '');
    html = html.replace(`<!--NOSCRIPT_${idx}-->`, fixed);
  });

  // ── 2b. Add defer to cursor-init.js if missing ───────────────────────────
  html = html.replace(
    /(<script\s+)src="([^"]*cursor-init\.js)"([^>]*)>/g,
    (match, open, src, rest) => {
      if (rest.includes('defer')) return match;
      return `${open}src="${src}"${rest} defer>`;
    }
  );

  // ── 2c. Update sw-cleanup.js to use dist/js/ and add defer ───────────────
  html = html.replace(
    /<script\s+src="(?:\/)?(?:\.\.\/)?js\/sw-cleanup\.js"([^>]*)>/g,
    (match, rest) => {
      const hasDeferAlready = rest.includes('defer');
      return `<script src="/dist/js/sw-cleanup.js"${hasDeferAlready ? rest : rest + ' defer'}>`;
    }
  );

  // ── 2d. Update all type="module" src paths to /dist/js/ ──────────────────
  html = html.replace(
    /(<script\s+type="module"\s+src=")([^"]+\.js)(")/g,
    (match, before, src, after) => {
      const normalized = src
        .replace(/^\.\.\/js\//, '/dist/js/')
        .replace(/^(?:\.\/)?js\//, '/dist/js/')
        .replace(/^\/js\//, '/dist/js/');
      return `${before}${normalized}${after}`;
    }
  );

  // ── 2e. Update non-module deferred scripts (cursor-init, defer-styles) ────
  html = html.replace(
    /(<script\s[^>]*src=")(?:\.\.\/)?js\/(cursor-init|defer-styles)\.js"/g,
    (match, before, name) => `${before}/dist/js/${name}.js"`
  );

  // ── 2f. Add rel="modulepreload" for the first module script ──────────────
  if (!html.includes('modulepreload')) {
    const modMatch = html.match(/<script\s+type="module"\s+src="([^"]+\.js)"/);
    if (modMatch) {
      const preload = `  <link rel="modulepreload" href="${modMatch[1]}">\n`;
      html = html.replace(/(\s*<\/head>)/, `\n${preload}$1`);
    }
  }

  // ── 2g. Add loading="lazy" to img tags missing it ────────────────────────
  html = html.replace(/<img\s([^>]+)>/g, (match, attrs) => {
    if (attrs.includes('loading=')) return match;
    if (attrs.includes('fetchpriority="high"')) return match; // above-fold hero
    return `<img ${attrs} loading="lazy">`;
  });

  // ── 2h. Add preload for loader.css ───────────────────────────────────────
  const loaderHref = html.match(/href="([^"]*loader\.css)"/)?.[1];
  if (loaderHref && !html.includes(`preload" href="${loaderHref}"`)) {
    const preloadLoader = `  <link rel="preload" href="${loaderHref}" as="style">\n`;
    html = html.replace(/(\s*<link\s+rel="stylesheet"[^>]*loader\.css)/, `\n${preloadLoader}$1`);
  }

  // ── 2i. Inline theme-init.js (eliminates render-blocking request) ─────────
  // theme-init MUST run synchronously (anti-FOUC), so we can't defer it.
  // Inlining it removes the extra HTTP round-trip entirely.
  html = html.replace(
    /<script\s+src="(?:\.\.\/)?(?:\.\/)?(?:dist\/)?js\/theme-init\.js"[^>]*><\/script>/g,
    `<script>${THEME_INIT_INLINE}</script>`
  );

  // ── 2j. Add ?v=BUILD_HASH to all CSS and JS refs (cache busting) ─────────
  // Allows immutable cache headers even for /js/ and /css/ — hash changes on deploy.
  // Strip any existing ?v=... first, then append current build hash.
  html = html.replace(
    /((?:href|src)="[^"]*\.(?:css|js))(?:\?v=[^"]*)?(")/g,
    (match, before, after) => {
      // Skip: external CDN, api/, sw.js, env.js (env.js is no-cache anyway)
      if (/^(?:https?:)?\/\//.test(before.replace(/^(?:href|src)="/, ''))) return match;
      if (before.includes('/api/') || before.includes('sw.js') || before.includes('env.js')) return match;
      return `${before}?v=${BUILD_HASH}${after}`;
    }
  );

  fs.writeFileSync(filePath, html, 'utf8');
}

function collectHtml(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const full = path.join(dir, e.name);
    if (e.isDirectory() && e.name !== 'node_modules' && e.name !== 'dist') {
      return collectHtml(full);
    }
    if (e.name.endsWith('.html')) return [full];
    return [];
  });
}

// ── 3. UPDATE sw.js PRECACHE_URLS ──────────────────────────────────────────

function updateSwPrecache() {
  const swPath = path.join(ROOT, 'sw.js');
  if (!fs.existsSync(swPath)) return;

  let sw = fs.readFileSync(swPath, 'utf8');
  // Replace /js/ references in PRECACHE_URLS with /dist/js/
  sw = sw.replace(
    /(const PRECACHE_URLS\s*=\s*\[)([\s\S]*?)(\];)/,
    (match, open, body, close) => {
      const updated = body.replace(/(?<!\/dist)\/js\//g, '/dist/js/');
      return `${open}${updated}${close}`;
    }
  );
  fs.writeFileSync(swPath, sw, 'utf8');
  console.log('[perf] ✓ sw.js PRECACHE_URLS updated to dist/js/');
}

// ── 4. UPGRADE /js/ CACHE TO IMMUTABLE + ADD dist/js/ RULE ───────────────
// Safe because all HTML refs now have ?v=BUILD_HASH — hash changes on deploy.

function updateVercelHeaders() {
  const vPath = path.join(ROOT, 'vercel.json');
  if (!fs.existsSync(vPath)) return;

  const v = JSON.parse(fs.readFileSync(vPath, 'utf8'));

  // Upgrade /js/(.*) from stale-while-revalidate to immutable
  const jsRule = v.headers.find(h => h.source === '/js/(.*)');
  if (jsRule) {
    const cc = jsRule.headers.find(h => h.key === 'Cache-Control');
    if (cc && cc.value !== 'public, max-age=31536000, immutable') {
      cc.value = 'public, max-age=31536000, immutable';
      console.log('[perf] ✓ vercel.json: /js/(.*) upgraded to immutable cache');
    }
  }

  // Add /dist/js/ immutable rule if missing
  const hasDistJs = v.headers.some(h => h.source && h.source.includes('dist'));
  if (!hasDistJs) {
    const jsIdx = v.headers.findIndex(h => h.source === '/js/(.*)');
    const distRule = {
      source: '/dist/js/(.*)',
      headers: [
        { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        { key: 'Vary', value: 'Accept-Encoding' }
      ]
    };
    if (jsIdx >= 0) {
      v.headers.splice(jsIdx + 1, 0, distRule);
    } else {
      v.headers.push(distRule);
    }
    console.log('[perf] ✓ vercel.json: added /dist/js/ immutable cache rule');
  }

  fs.writeFileSync(vPath, JSON.stringify(v, null, 2), 'utf8');
}

// ── MAIN ───────────────────────────────────────────────────────────────────

module.exports = async function runPerfBuild() {
  console.log(`[perf] Starting performance build... (build hash: ${BUILD_HASH})`);

  // JS minification
  await minifyJs();

  // HTML processing
  const htmlFiles = collectHtml(ROOT);
  let htmlCount = 0;
  for (const f of htmlFiles) {
    try {
      processHtml(f);
      htmlCount++;
    } catch (e) {
      console.warn(`[perf] ⚠  HTML error in ${f}: ${e.message}`);
    }
  }
  console.log(`[perf] ✓ HTML processed (${htmlCount} files)`);

  // SW update
  updateSwPrecache();

  // vercel.json update
  updateVercelHeaders();

  console.log('[perf] ✓ Performance build complete');
};

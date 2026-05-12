#!/usr/bin/env node
/**
 * pin-cursorly.js — Run once to pin cursorly.js to a specific commit + SRI hash.
 *
 * Usage:
 *   node scripts/pin-cursorly.js
 *
 * What it does:
 *   1. Fetches the current cursorly.js@latest from jsdelivr
 *   2. Computes the sha256 SRI hash
 *   3. Gets the resolved commit SHA from the jsdelivr API
 *   4. Rewrites every HTML file's <script> tag to use the pinned URL + integrity attr
 *   5. Saves the file locally to js/vendor/cursorly.min.js as a self-hosted fallback
 *
 * Re-run when you want to update cursorly to a newer version.
 */

'use strict';
const https  = require('https');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const PACKAGE   = 'gh/iamashruu/cursorly.js';
const FILE_PATH = 'dist/cursorly.min.js';
const CDN_URL   = `https://cdn.jsdelivr.net/${PACKAGE}@latest/${FILE_PATH}`;
const API_URL   = `https://data.jsdelivr.com/v1/packages/${PACKAGE}/resolved?specifier=latest`;
const OUT_DIR   = path.join(__dirname, '..', 'js', 'vendor');
const OUT_FILE  = path.join(OUT_DIR, 'cursorly.min.js');
const ROOT      = path.join(__dirname, '..');

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

(async () => {
  console.log('Fetching cursorly.js@latest …');
  const [body, meta] = await Promise.all([
    get(CDN_URL),
    get(API_URL).then(b => JSON.parse(b.toString())).catch(() => ({})),
  ]);

  const sri    = 'sha256-' + crypto.createHash('sha256').update(body).digest('base64');
  const commit = meta.version || 'latest';
  const pinnedUrl = `https://cdn.jsdelivr.net/${PACKAGE}@${commit}/${FILE_PATH}`;

  console.log(`Resolved commit: ${commit}`);
  console.log(`SRI hash:        ${sri}`);

  // Save self-hosted copy
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, body);
  console.log(`Saved self-hosted copy → js/vendor/cursorly.min.js`);

  // Build the new <script> tag (use self-hosted URL for best security)
  const selfHostedTag = `<script src="/js/vendor/cursorly.min.js" integrity="${sri}" crossorigin="anonymous" defer data-desktop-only="true"></script>`;
  const pinnedCdnTag  = `<script src="${pinnedUrl}" integrity="${sri}" crossorigin="anonymous" defer data-desktop-only="true"></script>`;

  // Update all HTML files
  const OLD_PATTERN = /(<script\s[^>]*gh\/iamashruu\/cursorly\.js@[^"]*"[^>]*>(?:<\/script>)?)/g;
  const htmlFiles = fs.readdirSync(ROOT)
    .filter(f => f.endsWith('.html'))
    .map(f => path.join(ROOT, f));

  let updated = 0;
  for (const file of htmlFiles) {
    let src = fs.readFileSync(file, 'utf8');
    if (!src.includes('cursorly')) continue;
    src = src.replace(OLD_PATTERN, selfHostedTag);
    fs.writeFileSync(file, src);
    updated++;
    console.log(`  Updated: ${path.basename(file)}`);
  }

  console.log(`\n✅ Done — ${updated} HTML files updated.`);
  console.log(`   CDN fallback URL (if preferred over self-hosting):`);
  console.log(`   ${pinnedCdnTag}\n`);
  console.log('   Add js/vendor/ to your git repo (or re-run this script in CI).');
})().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});

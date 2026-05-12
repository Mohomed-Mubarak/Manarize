const fs   = require('fs');
const path = require('path');
 
// ── 0. Parse flags ────────────────────────────────────────────────
const args     = process.argv.slice(2);
const isDemoFlag = args.includes('--demo');
 
// ── 1. Determine which .env file to load ──────────────────────────
//   Priority: --demo flag → .env.demo → .env → process.env (Vercel)
function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  fs.readFileSync(filePath, 'utf8').split('\n').forEach(line => {
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
}
 
const envDemoFile = path.join(__dirname, '.env.demo');
const envFile     = path.join(__dirname, '.env');
 
if (isDemoFlag) {
  console.log('[build] 🎭  --demo flag detected — loading .env.demo');
  loadEnvFile(envDemoFile);
} else if (fs.existsSync(envFile)) {
  console.log('[build] 📄  Loading .env');
  loadEnvFile(envFile);
} else if (fs.existsSync(envDemoFile)) {
  // Fallback: no .env but .env.demo exists (e.g. fresh clone, quick start)
  console.log('[build] ℹ   No .env found — falling back to .env.demo for demo mode');
  loadEnvFile(envDemoFile);
} else {
  console.log('[build] ℹ   No .env or .env.demo found — using process.env (Vercel)');
}
 
// ── 2. Read vars with safe demo fallbacks ─────────────────────────
function get(key, fallback = '') {
  const val = process.env[key];
  return val && val.trim() ? val.trim() : fallback;
}
 
// ── 3. Determine mode ─────────────────────────────────────────────
//   --demo flag always forces DEMO_MODE=true regardless of .env
//   Auto-fallback: placeholder Supabase URL → force demo mode
const _sbUrl = get('SUPABASE_URL', '');
const _sbKey = get('SUPABASE_ANON_KEY', '');
const _supabaseConfigured = Boolean(
  _sbUrl && !_sbUrl.includes('YOUR_PROJECT') &&
  _sbKey && !_sbKey.includes('YOUR_') && _sbKey.length > 20
);
const demoMode = isDemoFlag
  ? true
  : get('DEMO_MODE', 'false') === 'true' || !_supabaseConfigured;
 
// ── 4. Validate ───────────────────────────────────────────────────
if (demoMode) {
  console.log('[build] ℹ   DEMO MODE — localStorage auth, no database required.');
} else {
  const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'];
  const missing  = required.filter(k => !get(k));
  if (missing.length > 0) {
    console.error(`[build] ERROR: DEMO_MODE=false but missing required vars: ${missing.join(', ')}`);
    console.error('[build] HINT: Fill in .env from .env.example with your Supabase credentials');
    process.exit(1);
  }
  // Warn about server-only vars
  ['SUPABASE_SERVICE_ROLE_KEY', 'ADMIN_API_TOKEN', 'PAYHERE_MERCHANT_SECRET', 'SITE_URL']
    .forEach(k => { if (!get(k)) console.warn(`[build] WARNING: ${k} is not set — needed by serverless API routes`); });
 
  // ── Detect placeholder values that will break payments, email, login ──
  const PLACEHOLDER_PATTERNS = [/^YOUR_/i, /yourdomain\.com$/i];
  const PLACEHOLDER_VARS = [
    'PAYHERE_MERCHANT_ID',
    'PAYHERE_MERCHANT_SECRET',
    'EMAILJS_PUBLIC_KEY',
    'EMAILJS_SERVICE_ID',
    'EMAILJS_TEMPLATE_ID',
    'EMAILJS_ADMIN_EMAIL',
    'SITE_URL',
  ];
  const unfilled = PLACEHOLDER_VARS.filter(k => {
    const v = get(k);
    return v && PLACEHOLDER_PATTERNS.some(re => re.test(v));
  });
  if (unfilled.length > 0) {
    console.error('[build] ───────────────────────────────────────────────────────────');
    console.error('[build] ERROR: The following .env values are still placeholders:');
    unfilled.forEach(k => console.error(`[build]   ${k}=${get(k)}`));
    console.error('[build]');
    console.error('[build] These placeholder values will break:');
    if (unfilled.some(k => k.startsWith('PAYHERE')))    console.error('[build]   💳  Payments  — PayHere checkout will fail');
    if (unfilled.some(k => k.startsWith('EMAILJS')))    console.error('[build]   📧  Email     — Contact form emails will not send');
    if (unfilled.some(k => k === 'SITE_URL'))           console.error('[build]   🔐  Login     — OAuth redirects and IPN callbacks will fail');
    console.error('[build]');
    console.warn('[build] Fix: set real values in Vercel Environment Variables.');
    console.warn('[build] ───────────────────────────────────────────────────────────');
    // Warning only — do not exit. Set real values in Vercel dashboard.
  }
}
 
// ── 5. PUBLIC vars only — never put secrets in browser bundle ─────
//   NEVER add SUPABASE_SERVICE_ROLE_KEY, ADMIN_API_TOKEN, PAYHERE_MERCHANT_SECRET here.
const env = {
  SUPABASE_URL:        get('SUPABASE_URL',        'https://YOUR_PROJECT.supabase.co'),
  SUPABASE_ANON_KEY:   get('SUPABASE_ANON_KEY',   ''),
  DEMO_MODE:           demoMode,
  // BUG FIX: ADMIN_EMAIL was previously missing from generated env.js
  // causing ENV.ADMIN_EMAIL to be undefined in config.js (needed for demo admin login)
  ADMIN_EMAIL:         demoMode ? get('ADMIN_EMAIL', 'admin@yourdomain.com') : '',
  // SECURITY: ADMIN_PASSWORD is only needed in DEMO_MODE to seed the initial
  // password hash on first run. In production (DEMO_MODE=false) the hash is
  // stored server-side in Supabase and fetched via /api/admin/config — the
  // plaintext password must never appear in the browser-readable bundle.
  ADMIN_PASSWORD:      demoMode ? get('ADMIN_PASSWORD', '') : '',
  PAYHERE_MERCHANT_ID: get('PAYHERE_MERCHANT_ID',  'YOUR_MERCHANT_ID'),
  PAYHERE_SANDBOX:     get('PAYHERE_SANDBOX',      'true') !== 'false',
  WA_PHONE:            get('WA_PHONE',             ''),
  WA_PHONE_2:          get('WA_PHONE_2',           ''),
  POSTHOG_KEY:         get('POSTHOG_KEY',          ''),
  POSTHOG_HOST:        get('POSTHOG_HOST',         'https://app.posthog.com'),
  EMAILJS_PUBLIC_KEY:  get('EMAILJS_PUBLIC_KEY',   ''),
  EMAILJS_SERVICE_ID:  get('EMAILJS_SERVICE_ID',   ''),
  EMAILJS_TEMPLATE_ID: get('EMAILJS_TEMPLATE_ID',  ''),
  EMAILJS_ADMIN_EMAIL:  get('EMAILJS_ADMIN_EMAIL',  'admin@manarize.lk'),
  // hCaptcha — site key is PUBLIC (safe in browser bundle)
  // Secret key lives only in Vercel env vars (server-side /api routes)
  HCAPTCHA_SITE_KEY:   get('HCAPTCHA_SITE_KEY',   '10000000-ffff-ffff-ffff-000000000001'),
  // SECURITY: ADMIN_API_TOKEN is intentionally excluded from this public bundle.
  // Admin API calls must authenticate via Supabase session JWT with role='admin'.
  // See api/admin/* handlers: they verify req.headers['x-supabase-jwt'] server-side.
};
 
function jsStr(v) {
  return String(v)
    .replace(/\\/g, '\\\\')
    .replace(/`/g,  '\\`')
    .replace(/\$/g, '\\$');
}
 
// ── 6. Write js/env.js ────────────────────────────────────────────
const out = `// AUTO-GENERATED by build.js — do not edit manually.
// Source: ${isDemoFlag ? '.env.demo (--demo flag)' : fs.existsSync(envFile) ? '.env' : '.env.demo (fallback)'}
// Generated: ${new Date().toISOString()}
// Mode: ${demoMode ? 'DEMO (localStorage auth)' : 'PRODUCTION (Supabase)'}
//
// ⚠  This file is GITIGNORED — do not commit it.
//    Demo defaults live in js/env.production.js (committed).
//    Production secrets come from .env (gitignored) or Vercel env vars.
//
// ⚠  SECURITY: Only PUBLIC variables are written here.
//    SERVER-ONLY vars (service role key, admin token, merchant secret)
//    are accessed exclusively by Vercel Serverless Functions via process.env.
 
export const ENV = Object.freeze({
  SUPABASE_URL:        \`${jsStr(env.SUPABASE_URL)}\`,
  SUPABASE_ANON_KEY:   \`${jsStr(env.SUPABASE_ANON_KEY)}\`,
  DEMO_MODE:           ${env.DEMO_MODE},
  ADMIN_EMAIL:         \`${jsStr(env.ADMIN_EMAIL)}\`,
  ADMIN_PASSWORD:      \`${jsStr(env.ADMIN_PASSWORD)}\`,
  PAYHERE_MERCHANT_ID: \`${jsStr(env.PAYHERE_MERCHANT_ID)}\`,
  PAYHERE_SANDBOX:     ${env.PAYHERE_SANDBOX},
  WA_PHONE:            \`${jsStr(env.WA_PHONE)}\`,
  WA_PHONE_2:          \`${jsStr(env.WA_PHONE_2)}\`,
  POSTHOG_KEY:         \`${jsStr(env.POSTHOG_KEY)}\`,
  POSTHOG_HOST:        \`${jsStr(env.POSTHOG_HOST)}\`,
  EMAILJS_PUBLIC_KEY:  \`${jsStr(env.EMAILJS_PUBLIC_KEY)}\`,
  EMAILJS_SERVICE_ID:  \`${jsStr(env.EMAILJS_SERVICE_ID)}\`,
  EMAILJS_TEMPLATE_ID: \`${jsStr(env.EMAILJS_TEMPLATE_ID)}\`,
  EMAILJS_ADMIN_EMAIL: \`${jsStr(env.EMAILJS_ADMIN_EMAIL)}\`,
  HCAPTCHA_SITE_KEY:   \`${jsStr(env.HCAPTCHA_SITE_KEY)}\`,
  // ADMIN_API_TOKEN intentionally omitted — server-only secret, never in browser bundle.
});
`;
 
const outPath = path.join(__dirname, 'js', 'env.js');
fs.writeFileSync(outPath, out, 'utf8');
console.log(`[build] ✓ js/env.js written (DEMO_MODE=${env.DEMO_MODE})`);
console.log(`[build] ⚠  js/env.js is gitignored — do not commit it`);

// ── 7. Performance build: JS minification + HTML processing ──────
// Runs in ALL modes (production and demo).
// Minifies all client JS → dist/js/, processes HTML for perf.
(async () => {
  try {
    const runPerfBuild = require('./perf-build.js');
    await runPerfBuild();
  } catch (e) {
    console.warn('[build] ⚠  perf-build error:', e.message);
  }
})();

if (!demoMode) {
  console.log('[build] ✓ Production build ready. Deploy to Vercel or run: npx serve .');
} else {
  console.log('[build] ✓ Demo build ready. Run: npx serve . --cors');
  console.log('[build] 💡 To run production: cp .env.example .env → fill values → node build.js');
}
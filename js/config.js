/* ============================================================
   ZENMARKET — CONFIG
   All secrets come from js/env.js which is generated at build
   time by build.js from environment variables.

   NEVER hardcode credentials here.
   Run `node build.js` locally after editing .env.
   ============================================================ */
import { ENV } from './env.js';

// ── Supabase ─────────────────────────────────────────────────
export const SUPABASE_URL      = ENV.SUPABASE_URL;
export const SUPABASE_ANON_KEY = ENV.SUPABASE_ANON_KEY;

// ── Demo Mode ────────────────────────────────────────────────
// true  → localStorage email/password auth (dev/demo)
// false → Supabase OTP magic-link auth (production)
export const DEMO_MODE = ENV.DEMO_MODE;

// ── Admin (demo mode only) ───────────────────────────────────
// Only used when DEMO_MODE === true.
// In production these are unused — Supabase handles all auth.
export const ADMIN_EMAIL     = ENV.ADMIN_EMAIL;
export const ADMIN_PASSWORD  = ENV.ADMIN_PASSWORD;
// SECURITY: ADMIN_API_TOKEN is intentionally not exported from config.js.
// It is a server-only secret managed via Vercel environment variables.
// Admin API authentication uses Supabase session JWTs — see js/admin-api.js.

// ── PayHere ──────────────────────────────────────────────────
export const PAYHERE_MERCHANT_ID = ENV.PAYHERE_MERCHANT_ID;
export const PAYHERE_SANDBOX     = ENV.PAYHERE_SANDBOX;

// ── WhatsApp ─────────────────────────────────────────────────
export const WA_PHONE   = ENV.WA_PHONE;
export const WA_PHONE_2 = ENV.WA_PHONE_2;

// ── PostHog ──────────────────────────────────────────────────
export const POSTHOG_KEY  = ENV.POSTHOG_KEY;
export const POSTHOG_HOST = ENV.POSTHOG_HOST;

// ── EmailJS ──────────────────────────────────────────────────
export const EMAILJS = {
  publicKey:  ENV.EMAILJS_PUBLIC_KEY,
  serviceId:  ENV.EMAILJS_SERVICE_ID,
  templateId: ENV.EMAILJS_TEMPLATE_ID,
  adminEmail: ENV.EMAILJS_ADMIN_EMAIL,
};

// ── hCaptcha ─────────────────────────────────────────────────
// Site key is public (safe in browser bundle).
// Replace the test key (10000000-ffff-…) with your real key before going live.
// Secret key must stay server-only in Vercel environment variables.
export const HCAPTCHA_SITE_KEY = ENV.HCAPTCHA_SITE_KEY;

// ── Store Settings (not secret — safe to hardcode) ───────────
export const STORE = {
  name:           'Manarize',
  tagline:        'Premium Shopping in Sri Lanka',
  currency:       'LKR',
  currencySymbol: 'Rs.',
  phone:          '+94 77 123 4567',
  email:          'hello@manarize.lk',
  address:        'Colombo 03, Sri Lanka',
  socials: {
    facebook:  'https://facebook.com/manarize',
    instagram: 'https://instagram.com/manarize',
    tiktok:    'https://tiktok.com/@manarize',
    youtube:   'https://youtube.com/@manarize',
  },
};

// ── LocalStorage Keys (not secret — safe to hardcode) ────────
export const LS = {
  cart:             'zm_cart',
  wishlist:         'zm_wishlist',
  adminSession:     'zm_admin_session',
  session:          'zm_session',
  registeredUsers:  'zm_registered_users',
  addresses:        'zm_addresses',
  products:         'zm_products',
  orders:           'zm_orders',
  users:            'zm_users',
  extraProducts:    'zm_extra_products',
  editedProducts:   'zm_edited_products',
  categories:       'zm_categories',
  coupons:          'zm_coupons',
  siteSettings:     'zm_site_settings',
  seoSettings:      'zm_seo_settings',
  adminReviews:     'zm_admin_reviews',
  contactMessages:  'zm_contact_messages',
  shippingZones:    'zm_shipping_zones',
  homepageReviews:  'zm_homepage_reviews',
  productReviews:   'zm_product_reviews',
  newsletterEmails: 'zm_newsletter_emails',
};

# Manarize — Project Structure Reference

> **Version 29** · Vanilla HTML / CSS / ES Modules · Supabase + PayHere + Vercel
> Sri Lanka's premium e-commerce platform — full storefront + admin panel, no framework required.

---

## Overview

| Attribute        | Value                                      |
|------------------|--------------------------------------------|
| Stack            | Vanilla HTML, CSS, JavaScript (ES Modules) |
| Backend          | Supabase (Postgres + Auth + Realtime)       |
| Payments         | PayHere (sandbox & production)             |
| Notifications    | WhatsApp API, EmailJS                      |
| Hosting          | Vercel (serverless functions via `api/`)   |
| Node requirement | ≥ 20.0.0                                   |
| Build tool       | `node build.js` (env var injection)        |

---

## Full Directory Tree

```
manarize-v29/
│
│  ── Storefront Pages ──────────────────────────────────────────
├── index.html                   Homepage (hero, featured, bestsellers)
├── shop.html                    Full product catalogue (filter + sort)
├── product.html                 Product detail (gallery, variants, reviews)
├── cart.html                    Shopping cart (quantities, coupon, summary)
├── checkout.html                Checkout (PayHere / Bank Transfer / COD)
├── order-success.html           Order confirmation + PDF invoice + confetti
├── search.html                  Live search results page
├── login.html                   Login / Register forms
├── profile.html                 Customer account (orders, wishlist, details)
├── wishlist.html                Dedicated wishlist page
├── contact.html                 Contact form (EmailJS integration)
├── blog.html                    Blog listing
├── blog-post.html               Single blog post view
├── faq.html                     FAQ accordion
├── about.html                   About / brand story
├── privacy.html                 Privacy policy
├── terms.html                   Terms of service
├── return-policy.html           Returns & refunds
├── shipping-policy.html         Shipping information
├── 404.html                     Custom 404 error page
│
│  ── Config & Deployment ──────────────────────────────────────
├── vercel.json                  Vercel deployment config, security headers, cache rules
├── build.js                     Build script — injects env vars into env.js
├── package.json                 npm manifest (supabase-js dep, dev scripts)
├── .env.example                 Environment variable template
├── .gitignore                   Git ignore rules
├── _headers                     Cloudflare Pages header overrides
├── robots.txt                   SEO crawler rules
├── sitemap.xml                  XML sitemap for search engines
├── supabase-setup.sql           Full Supabase schema (tables, RLS, functions)
│
│  ── Serverless API (Vercel Functions) ─────────────────────────
├── api/
│   ├── health.js                Health-check endpoint (GET /api/health)
│   ├── payhere-webhook.js       PayHere IPN webhook — verifies & records payments
│   ├── whatsapp.js              WhatsApp order notification dispatcher
│   └── admin/
│       ├── orders.js            Admin: list / update orders (protected)
│       ├── products.js          Admin: create / update / delete products (protected)
│       └── reviews.js           Admin: approve / reject reviews (protected)
│
│  ── CSS Architecture ───────────────────────────────────────────
├── css/
│   ├── variables.css            Design tokens — colours, fonts, spacing, shadows
│   ├── base.css                 CSS reset + global typography
│   ├── animations.css           Keyframes + scroll-reveal utilities
│   ├── components.css           Buttons, badges, forms, modals, toasts, chips
│   ├── layout.css               Navbar, footer, floating action buttons
│   ├── storefront.css           Hero, shop grid, product, cart, checkout
│   ├── admin.css                Complete admin panel styles
│   ├── pages.css                Auth, profile, policy page styles
│   ├── loader.css               Page loader & progress bar
│   ├── mobile.css               Mobile-specific overrides (responsive)
│   ├── style.css                @import aggregator (single entry point)
│   └── pages/                   Per-page CSS overrides (scoped, lazy-loaded)
│       ├── index.css            Homepage overrides
│       ├── shop.css             Shop page overrides
│       ├── product.css          Product detail overrides
│       ├── cart.css             Cart page overrides
│       ├── checkout.css         Checkout overrides
│       ├── order-success.css    Order success overrides
│       ├── search.css           Search results overrides
│       ├── login.css            Auth page overrides
│       ├── profile.css          Profile page overrides
│       ├── wishlist.css         Wishlist page overrides
│       ├── contact.css          Contact page overrides
│       ├── blog.css             Blog listing overrides
│       ├── blog-post.css        Blog post overrides
│       ├── faq.css              FAQ overrides
│       ├── about.css            About page overrides
│       ├── privacy.css          Privacy page overrides
│       ├── terms.css            Terms page overrides
│       ├── return-policy.css    Return policy overrides
│       ├── shipping-policy.css  Shipping policy overrides
│       ├── 404.css              404 page overrides
│       ├── admin-index.css      Admin login overrides
│       ├── admin-dashboard.css  Admin dashboard overrides
│       ├── admin-analytics.css  Admin analytics overrides
│       ├── admin-products.css   Admin products overrides
│       ├── admin-product-edit.css Admin product editor overrides
│       ├── admin-orders.css     Admin orders overrides
│       ├── admin-order-detail.css Admin order detail overrides
│       ├── admin-users.css      Admin users overrides
│       ├── admin-categories.css Admin categories overrides
│       ├── admin-coupons.css    Admin coupons overrides
│       ├── admin-shipping.css   Admin shipping zones overrides
│       ├── admin-reviews.css    Admin reviews overrides
│       ├── admin-notifications.css Admin notifications overrides
│       ├── admin-blog.css       Admin blog list overrides
│       ├── admin-blog-edit.css  Admin blog editor overrides
│       ├── admin-seo.css        Admin SEO settings overrides
│       ├── admin-pages.css      Admin page manager overrides
│       └── admin-settings.css   Admin settings overrides
│
│  ── JavaScript Architecture ───────────────────────────────────
├── js/
│   │
│   │  Core / Shared
│   ├── config.js                All constants, Supabase keys, localStorage key map
│   ├── env.js                   Auto-generated by build.js — public env variables
│   ├── env.example.js           Template for env.js values
│   ├── utils.js                 Shared helpers: formatPrice, starsHtml, debounce…
│   ├── toast.js                 Toast notification system (success, error, info)
│   ├── loader.js                Page loader + withLoader() async wrapper
│   ├── modal.js                 Generic modal dialog component
│   ├── theme.js                 Dark / Light / Warm Gold theme switcher
│   ├── theme-init.js            Pre-paint theme initialiser (prevents FOUC)
│   ├── performance.js           WebP detection, lazy observer, link prefetch
│   ├── security-utils.js        XSS escaping, URL validation, brute-force guard
│   │
│   │  Data Layer
│   ├── store.js                 Demo data + localStorage CRUD (offline/demo mode)
│   ├── supabase.js              Supabase client initialiser
│   ├── supabase-store.js        Supabase data adapter (mirrors store.js interface)
│   ├── store-adapter.js         Switches between demo store and Supabase at runtime
│   ├── analytics.js             Analytics events (PostHog + custom)
│   ├── realtime.js              Supabase Realtime subscriptions (live order updates)
│   │
│   │  Domain Modules
│   ├── auth.js                  Customer session management + registration
│   ├── cart.js                  Cart + wishlist state (add, remove, totals)
│   ├── reviews.js               Product review engine (CRUD, pagination, stats)
│   ├── search.js                Fuzzy product search with highlighting
│   ├── invoice.js               Client-side PDF invoice generator
│   ├── notifications.js         Admin notification store
│   ├── contact-messages.js      Contact form message storage
│   ├── blog-data.js             Blog post data (demo content)
│   ├── admin-api.js             Thin wrapper over admin Vercel API endpoints
│   │
│   │  UI Components
│   ├── layout.js                Navbar + footer HTML injector (shared across pages)
│   ├── product-card.js          Shared product card HTML builder
│   ├── phone-input.js           Phone input with country code selector
│   │
│   │  Page Controllers (one per storefront page)
│   ├── home.js                  Homepage — hero, featured products, bestsellers
│   ├── shop.js                  Shop — filters, sorting, pagination
│   ├── product.js               Product detail — gallery, variants, tabs
│   ├── cart-page.js             Cart page — quantity management, coupon, summary
│   ├── checkout.js              Checkout — form validation, payment dispatch
│   ├── order-success.js         Order confirmation + confetti + invoice download
│   ├── login-page.js            Auth forms — login, register, forgot password
│   ├── profile-page.js          Account dashboard — orders, wishlist, personal details
│   ├── search-page.js           Search results rendering
│   └── wishlist-page.js         Wishlist page logic
│
│  ── JS Subfolders ─────────────────────────────────────────────
├── js/admin/                    Admin panel controllers (one per admin page)
│   ├── admin-auth.js            Admin session + brute-force protection
│   ├── admin-layout.js          Sidebar + topbar HTML injector
│   ├── admin-confirm.js         Reusable confirmation dialog component
│   ├── admin-analytics.js       Revenue analytics + Chart.js charts
│   ├── admin-dashboard.js       KPIs, live charts, delivery snapshot
│   ├── admin-products.js        Product list — search, filter, delete
│   ├── admin-product-edit.js    Add/edit product form + AI description generator
│   ├── admin-orders.js          Orders list — status filter, bulk actions
│   ├── admin-order-detail.js    Full order view + status management + timeline
│   ├── admin-users.js           Customer account management
│   ├── admin-categories.js      Category CRUD + drag-to-reorder
│   ├── admin-coupons.js         Coupon / promo code management
│   ├── admin-shipping.js        Delivery zone editor (district-level rates)
│   ├── admin-blog.js            Blog post list + publish/unpublish
│   ├── admin-blog-edit.js       Rich blog post editor
│   └── admin-settings.js        Store settings + admin password change
│
└── js/pages/                    Thin page-init entry points (import + bootstrap)
    ├── faq.js                   FAQ page initialiser
    ├── admin-analytics.js       Admin analytics page initialiser
    └── admin-blog-edit.js       Admin blog editor page initialiser
│
│  ── Admin Panel HTML ──────────────────────────────────────────
└── admin/
    ├── index.html               Admin login
    ├── dashboard.html           Dashboard — KPIs + charts
    ├── analytics.html           Revenue analytics
    ├── products.html            Product management
    ├── product-edit.html        Add / edit product
    ├── orders.html              Order list
    ├── order-detail.html        Order detail + status management
    ├── users.html               Customer management
    ├── categories.html          Category management
    ├── coupons.html             Coupon & promo codes
    ├── shipping.html            Delivery zone editor
    ├── reviews.html             Review moderation
    ├── notifications.html       System alerts + contact messages
    ├── blog.html                Blog post management
    ├── blog-edit.html           Blog post editor
    ├── seo.html                 SEO settings (meta, OG, schema)
    ├── pages.html               Static page manager
    └── settings.html            Store settings + password change
```

---

## Key Subsystem Map

| Subsystem            | Entry Files                                         | Notes                                          |
|----------------------|-----------------------------------------------------|------------------------------------------------|
| **Config**           | `js/config.js`, `js/env.js`                         | All constants live here — edit before deploy   |
| **Data layer**       | `js/store.js` / `js/supabase-store.js`              | `store-adapter.js` picks the right one         |
| **Auth (customer)**  | `js/auth.js`                                        | Session in `localStorage`, Supabase in prod    |
| **Auth (admin)**     | `js/admin/admin-auth.js`                            | Brute-force protection, session timeout        |
| **Cart & Wishlist**  | `js/cart.js`                                        | Reactive — all pages import this               |
| **Payments**         | `js/checkout.js`, `api/payhere-webhook.js`          | PayHere sandbox flag in `config.js`            |
| **Reviews**          | `js/reviews.js`, `api/admin/reviews.js`             | Client-side + server-side moderation           |
| **Realtime**         | `js/realtime.js`                                    | Supabase Realtime for live order updates       |
| **Theming**          | `js/theme-init.js`, `js/theme.js`, `css/variables.css` | 3 themes, no FOUC                          |
| **SEO**              | `robots.txt`, `sitemap.xml`, `admin/seo.html`       | Per-page meta managed from admin               |
| **Database schema**  | `supabase-setup.sql`                                | Full schema with RLS policies                  |
| **Deployment**       | `vercel.json`, `build.js`, `.env.example`           | Vercel Functions + security headers            |

---

## Quick Start

```bash
# Option A — VS Code + Live Server (recommended)
unzip manarize-v29.zip && cd manarize-v29
code .
# Right-click index.html → "Open with Live Server"

# Option B — Node.js
npx serve .          # http://localhost:3000

# Option C — Python
python3 -m http.server 8000
```

> ES Modules **require** a local HTTP server — `file://` URLs will fail with CORS errors.

**Default admin credentials** → `/admin/index.html` · `admin@manarize.lk` / `admin123`
Change the password immediately after first login via Admin → Settings.

---

## npm Scripts

| Script        | Command                          | Purpose                                |
|---------------|----------------------------------|----------------------------------------|
| `build`       | `node build.js`                  | Inject env vars → `js/env.js`          |
| `dev`         | `npx serve . --cors`             | Local dev server with CORS             |
| `dev:node`    | inline `http.createServer`       | Zero-dependency local server           |
| `health`      | `curl /api/health`               | Verify serverless function is running  |

---

## Environment Variables (`.env.example`)

```
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_ANON_KEY=YOUR_ANON_KEY
PAYHERE_MERCHANT_ID=YOUR_MERCHANT_ID
PAYHERE_SECRET=YOUR_SECRET
WHATSAPP_TOKEN=YOUR_WA_TOKEN
EMAILJS_SERVICE_ID=YOUR_SERVICE_ID
```

Run `node build.js` after setting these to populate `js/env.js`.

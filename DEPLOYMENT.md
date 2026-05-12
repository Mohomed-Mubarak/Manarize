# Manarize v29 — Production Deployment Guide

> **Complete step-by-step instructions** for taking Manarize from demo to a live, production-grade store.
> Estimated total setup time: **2–4 hours** for first-time deployments.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Prerequisites — What You Need First](#2-prerequisites)
3. [Step 1 — Supabase (Database & Auth)](#3-step-1--supabase-database--auth)
4. [Step 2 — PayHere (Payments)](#4-step-2--payhere-payments)
5. [Step 3 — WhatsApp Business Setup](#5-step-3--whatsapp-business-setup)
6. [Step 4 — EmailJS (Contact Form)](#6-step-4--emailjs-contact-form)
7. [Step 5 — PostHog Analytics (Optional)](#7-step-5--posthog-analytics-optional)
8. [Step 6 — Build the Project Locally](#8-step-6--build-the-project-locally)
9. [Step 7 — GitHub Repository](#9-step-7--github-repository)
10. [Step 8 — Deploy to Vercel](#10-step-8--deploy-to-vercel)
11. [Step 9 — Custom Domain + Cloudflare CDN](#11-step-9--custom-domain--cloudflare-cdn)
12. [Step 10 — Post-Deployment Verification](#12-step-10--post-deployment-verification)
13. [Step 11 — Admin Panel First-Run Setup](#13-step-11--admin-panel-first-run-setup)
14. [Step 12 — Security Hardening](#14-step-12--security-hardening)
15. [Step 13 — Monitoring & Uptime](#15-step-13--monitoring--uptime)
16. [Alternative Deployment Targets](#16-alternative-deployment-targets)
17. [Production Checklist (Print This)](#17-production-checklist-print-this)
18. [Ongoing Maintenance](#18-ongoing-maintenance)
19. [Rollback Procedure](#19-rollback-procedure)
20. [Troubleshooting Common Issues](#20-troubleshooting-common-issues)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Production Stack                          │
│                                                             │
│  Browser ──► Cloudflare CDN ──► Vercel Edge                 │
│                                    │                         │
│               Static Files  ◄──────┤                         │
│               (HTML/CSS/JS)        │                         │
│                                    ▼                         │
│                          Vercel Serverless Fns               │
│                          /api/payhere-webhook                │
│                          /api/whatsapp                       │
│                          /api/admin/*                        │
│                                    │                         │
│                                    ▼                         │
│                           Supabase (Singapore)               │
│                           ├── PostgreSQL DB                  │
│                           ├── Auth (OTP magic link)          │
│                           ├── Storage (images)               │
│                           └── Realtime (orders/stock)        │
│                                                             │
│  Payments:  PayHere ──► /api/payhere-webhook ──► Supabase   │
│  Emails:    EmailJS (direct from browser)                   │
│  WhatsApp:  wa.me links OR Meta Cloud API                   │
│  Analytics: PostHog (browser SDK)                           │
└─────────────────────────────────────────────────────────────┘
```

**Cost estimate at launch (0–500 orders/month):**

| Service | Free Tier | Paid When |
|---|---|---|
| Vercel | 100GB bandwidth/mo | >100GB or team features |
| Supabase | 500MB DB, 2GB storage | >500MB DB |
| Cloudflare | Unlimited bandwidth | DDoS/WAF Pro features |
| PayHere | No monthly fee | 2.95% per transaction |
| EmailJS | 200 emails/mo | >200 emails |
| PostHog | 1M events/mo | >1M events |

**Total fixed cost at launch: LKR 0/month** (all within free tiers)

---

## 2. Prerequisites

Before starting, make sure you have:

- [ ] **Node.js 20+** installed — check with `node --version`
- [ ] **Git** installed — check with `git --version`
- [ ] A **domain name** (e.g., `yourstore.lk`) — buy from Cloudflare Registrar, GoDaddy, or Lanka Domains
- [ ] A **business email** (e.g., `admin@yourstore.lk`)
- [ ] A **PayHere merchant account** (apply at payhere.lk — takes 1–3 business days)
- [ ] A **WhatsApp Business number** (the number your store will use)
- [ ] A **GitHub account** — free at github.com
- [ ] A **Vercel account** — free at vercel.com (sign up with GitHub)

---

## 3. Step 1 — Supabase (Database & Auth)

Supabase is your production database and authentication provider. It replaces the demo mode's localStorage.

### 3.1 Create a Project

1. Go to **https://supabase.com** and sign in with GitHub
2. Click **"New Project"**
3. Fill in:
   - **Name:** `manarize-production`
   - **Database Password:** Generate a strong one and save it in a password manager
   - **Region:** `Southeast Asia (Singapore)` — closest to Sri Lanka
   - **Plan:** Free
4. Click **"Create new project"** — takes ~2 minutes to provision

### 3.2 Copy Your API Keys

1. In your new project, go to **Settings → API**
2. Copy and save in a text file:
   ```
   Project URL:      https://xxxxxxxxxxxx.supabase.co
   anon/public key:  eyJhbGciOiJI...  (long JWT)
   service_role key: eyJhbGciOiJI...  (different long JWT — KEEP THIS SECRET)
   ```
   > ⚠️ The **service_role key** bypasses all security. Never put it in frontend code.

### 3.3 Run the Database Schema

1. In Supabase, click **SQL Editor** in the left sidebar
2. Click **"New query"**
3. Open the file `supabase-setup.sql` from your project folder
4. **Select all** (Ctrl+A) and paste it into the SQL editor
5. Click **"Run"** (or press Ctrl+Enter)
6. You should see: `Success. No rows returned`

### 3.4 Configure Authentication

1. Go to **Authentication → Providers**
2. Under **Email**, make sure it is **Enabled**
3. Enable **"Confirm email"** → set to **Magic Link / OTP** mode
4. Go to **Authentication → URL Configuration**
5. Set **Site URL** to your production domain: `https://yourstore.lk`
6. Under **Redirect URLs**, add:
   ```
   https://yourstore.lk/**
   https://www.yourstore.lk/**
   ```

### 3.5 Configure Email Templates (Optional but Recommended)

1. Go to **Authentication → Email Templates**
2. Edit the **"Magic Link"** template to use your brand name:
   ```
   Subject: Your Manarize login link
   Body:    Click the link below to sign in to Manarize:
            {{ .ConfirmationURL }}
            This link expires in 1 hour.
   ```

### 3.6 Verify Row Level Security is Active

After running the SQL setup, verify security is on:

1. Go to **SQL Editor → New query**
2. Run:
   ```sql
   SELECT tablename, rowsecurity
   FROM pg_tables
   WHERE schemaname = 'public'
   ORDER BY tablename;
   ```
3. Every table should show `rowsecurity = true`

---

## 4. Step 2 — PayHere (Payments)

### 4.1 Register as a Merchant

1. Go to **https://www.payhere.lk** and click **"Register"**
2. Choose **"Business Account"**
3. Fill in your business details and upload required documents (NIC, business registration if applicable)
4. Wait for approval — typically **1–3 business days**

### 4.2 Get Your Credentials

Once approved:

1. Log in to your PayHere dashboard
2. Go to **Settings → Merchant**
3. Copy:
   - **Merchant ID** (6-digit number)
   - **Merchant Secret** (click "Generate" if first time — save this securely)

### 4.3 Configure the Notify URL

This is the webhook PayHere calls after every payment:

1. Still in **Settings → Domains & URLs**
2. Add your domain to **Allowed Domains**: `yourstore.lk`
3. Set **Notify URL** to: `https://yourstore.lk/api/payhere-webhook`
4. Set **Return URL** to: `https://yourstore.lk/order-success.html`
5. Set **Cancel URL** to: `https://yourstore.lk/checkout.html`

### 4.4 Test in Sandbox First

- Keep `PAYHERE_SANDBOX=true` in your `.env` during testing
- PayHere sandbox credentials: use any test card from their docs
- Only switch to `PAYHERE_SANDBOX=false` when you're ready to go live

---

## 5. Step 3 — WhatsApp Business Setup

Manarize sends order notifications to your WhatsApp number. Two modes are available:

### Mode A — wa.me Links (Default, Zero Setup)

The default mode opens a pre-filled WhatsApp message in the browser. No API setup needed. Best for small stores.

1. Set `WHATSAPP_MODE=link` in your `.env`
2. Set `WA_PHONE=94XXXXXXXXX` (your number in international format, no `+`)
3. Optionally set `WA_PHONE_2` as a backup number

### Mode B — Meta Business Cloud API (Advanced, Automated)

Sends automated messages without requiring the customer to open WhatsApp. Best for high-volume stores.

1. Go to **https://developers.facebook.com** → Create App → Business
2. Add **WhatsApp** product to your app
3. Get a **phone number ID** and **access token** from the API setup page
4. Set in `.env`:
   ```
   WHATSAPP_MODE=cloud
   WHATSAPP_ACCESS_TOKEN=your_token_here
   WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id
   ```
5. Submit your message templates for Meta approval (takes 24–48 hours)

---

## 6. Step 4 — EmailJS (Contact Form)

EmailJS sends emails from your contact form without a backend server.

### 6.1 Create an Account

1. Go to **https://www.emailjs.com** and sign up (free)

### 6.2 Add an Email Service

1. Go to **Email Services** → **Add New Service**
2. Choose your provider:
   - **Gmail** — easiest if you use Google Workspace
   - **Outlook/Hotmail** — if you use Microsoft 365
   - **Custom SMTP** — for any hosting provider email
3. Follow the connection steps and click **"Connect Account"**
4. Copy the **Service ID** (e.g., `service_abc123`)

### 6.3 Create an Email Template

1. Go to **Email Templates** → **Create New Template**
2. Use this template (supports all contact form fields):

   ```
   Subject: New Contact Message from {{from_name}} — Manarize

   From:    {{from_name}} <{{from_email}}>
   Phone:   {{phone}}
   Subject: {{subject}}

   Message:
   {{message}}

   ---
   Reply to: {{reply_to}}
   Sent from Manarize Contact Form
   ```

3. Set **"To Email"** to your admin email address
4. Copy the **Template ID** (e.g., `template_xyz789`)

### 6.4 Get Your Public Key

1. Go to **Account** → **General** → **API Keys**
2. Copy your **Public Key**

### 6.5 Restrict to Your Domain (Important for Security)

1. Go to **Account** → **Security**
2. Under **"Allowed Origins"**, add: `https://yourstore.lk`
3. This prevents other websites from sending emails using your quota

---

## 7. Step 5 — PostHog Analytics (Optional)

PostHog gives you privacy-friendly analytics — page views, user journeys, conversion rates — without sending data to Google.

1. Go to **https://posthog.com** → Sign up (free)
2. Create a new project, choose **"EU Cloud"** or **"US Cloud"**
3. Go to **Project Settings** → **Project API Key**
4. Copy the key (starts with `phc_`)
5. Set in `.env`:
   ```
   POSTHOG_KEY=phc_your_key_here
   POSTHOG_HOST=https://app.posthog.com
   ```

If you leave `POSTHOG_KEY` blank, analytics is completely disabled. No tracking code loads.

---

## 8. Step 6 — Build the Project Locally

Now you have all the credentials. Time to configure the project.

### 8.1 Install Dependencies

```bash
# Navigate to your project folder
cd manarize-v29

# Install Node.js dependencies
npm install
```

### 8.2 Create Your .env File

```bash
# Copy the example file
cp .env.example .env
```

Now open `.env` in a text editor and fill in every value:

```env
# ── Core Mode ────────────────────────────────────
DEMO_MODE=false

# ── Admin Account ────────────────────────────────
ADMIN_EMAIL=admin@yourstore.lk
ADMIN_PASSWORD=YourVeryStrongPassword123!

# ── Supabase (from Step 1) ────────────────────────
SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJI...your_anon_key...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJI...your_service_role_key...

# ── Security ──────────────────────────────────────
# Generate with: openssl rand -hex 32
ADMIN_API_TOKEN=a8f3d2c1e4b5a6f7d8c9e0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0

# ── Site ──────────────────────────────────────────
SITE_URL=https://yourstore.lk

# ── PayHere (from Step 2) ─────────────────────────
PAYHERE_MERCHANT_ID=123456
PAYHERE_MERCHANT_SECRET=YourPayHereSecret
PAYHERE_SANDBOX=false

# ── WhatsApp (from Step 3) ────────────────────────
WA_PHONE=94771234567
WA_PHONE_2=94751234567
WHATSAPP_MODE=link

# ── EmailJS (from Step 4) ─────────────────────────
EMAILJS_PUBLIC_KEY=your_emailjs_public_key
EMAILJS_SERVICE_ID=service_abc123
EMAILJS_TEMPLATE_ID=template_xyz789
EMAILJS_ADMIN_EMAIL=admin@yourstore.lk

# ── PostHog (from Step 5, optional) ──────────────
POSTHOG_KEY=phc_your_key_here
POSTHOG_HOST=https://app.posthog.com
```

### 8.3 Run the Build Script

```bash
node build.js
```

**Expected output:**
```
[build] ✓ js/env.js written (DEMO_MODE=false)
[build] INFO: Production mode active — Supabase auth enabled
```

If you see any `ERROR:` lines, fix the missing variable and re-run.

### 8.4 Test Locally Before Deploying

```bash
npm run dev
# Opens at http://localhost:3000
```

Check:
- [ ] Homepage loads without console errors
- [ ] Admin login works at `/admin/index.html`
- [ ] Products display correctly
- [ ] Cart add/remove functions
- [ ] Checkout form fills in (will fail payment in dev — that's expected)

---

## 9. Step 7 — GitHub Repository

Vercel deploys directly from GitHub. Every push to `main` triggers a new deployment automatically.

### 9.1 Create a New Private Repository

1. Go to **https://github.com/new**
2. Name: `manarize` (or your store name)
3. Set to **Private** (important — your `.env` must never be public)
4. Do **not** initialise with README or .gitignore (your project has these)
5. Click **"Create repository"**

### 9.2 Verify .gitignore is Correct

Open `.gitignore` and confirm these are listed:

```
.env
js/env.js
node_modules/
```

> ⚠️ If `js/env.js` is not in `.gitignore`, add it now. It contains credentials generated by `build.js`.

### 9.3 Push Your Project

```bash
# In your manarize-v29 folder
git init
git add .
git commit -m "Initial production setup"
git branch -M main
git remote add origin https://github.com/yourusername/manarize.git
git push -u origin main
```

Verify at `https://github.com/yourusername/manarize` that:
- `.env` is **NOT** visible (if it is, run `git rm --cached .env` immediately)
- `js/env.js` is **NOT** visible

---

## 10. Step 8 — Deploy to Vercel

### 10.1 Import Your Repository

1. Go to **https://vercel.com/new**
2. Click **"Import Git Repository"**
3. Find and select your `manarize` repository
4. Click **"Import"**

### 10.2 Configure the Build

Vercel should auto-detect from `vercel.json`, but verify:

| Setting | Value |
|---|---|
| Framework Preset | Other |
| Build Command | `node build.js` |
| Output Directory | `.` (dot — the project root) |
| Install Command | `npm install` |
| Node.js Version | 20.x |

### 10.3 Add All Environment Variables

This is the most important step. In the Vercel setup screen, click **"Environment Variables"** and add every variable from your `.env` file:

| Variable | Value | Environment |
|---|---|---|
| `DEMO_MODE` | `false` | Production, Preview, Development |
| `ADMIN_EMAIL` | `admin@yourstore.lk` | All |
| `ADMIN_PASSWORD` | `YourStrongPassword123!` | All |
| `SUPABASE_URL` | `https://xxx.supabase.co` | All |
| `SUPABASE_ANON_KEY` | `eyJhbGciOi...` | All |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJhbGciOi...` | All |
| `ADMIN_API_TOKEN` | `a8f3d2c1e4...` | All |
| `SITE_URL` | `https://yourstore.lk` | Production only |
| `PAYHERE_MERCHANT_ID` | `123456` | All |
| `PAYHERE_MERCHANT_SECRET` | `your_secret` | All |
| `PAYHERE_SANDBOX` | `false` | Production only |
| `PAYHERE_SANDBOX` | `true` | Preview, Development |
| `WA_PHONE` | `94771234567` | All |
| `WA_PHONE_2` | `94751234567` | All |
| `WHATSAPP_MODE` | `link` | All |
| `EMAILJS_PUBLIC_KEY` | `your_key` | All |
| `EMAILJS_SERVICE_ID` | `service_xxx` | All |
| `EMAILJS_TEMPLATE_ID` | `template_xxx` | All |
| `EMAILJS_ADMIN_EMAIL` | `admin@yourstore.lk` | All |
| `POSTHOG_KEY` | `phc_xxx` | Production only |

> 💡 **Tip:** Set `PAYHERE_SANDBOX=true` on **Preview** deployments so test branches don't accidentally charge real cards.

### 10.4 Deploy

Click **"Deploy"**. Vercel will:

1. Clone your repository
2. Run `npm install`
3. Run `node build.js` (generates `js/env.js` using your env vars)
4. Deploy all files globally to its CDN edge network

**First deployment takes ~60–90 seconds.** After that, re-deploys are typically 20–30 seconds.

You'll get a deployment URL like: `https://manarize-abc123.vercel.app`

### 10.5 Verify the Deployment

Visit your Vercel URL and check:

```bash
# Test the health endpoint
curl https://manarize-abc123.vercel.app/api/health
```

Expected response:
```json
{
  "status": "ok",
  "version": "29",
  "timestamp": "2026-...",
  "services": {
    "env": "ok",
    "supabase": "ok"
  }
}
```

If `supabase` shows an error, check your `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` environment variables.

---

## 11. Step 9 — Custom Domain + Cloudflare CDN

### 11.1 Add Your Domain in Vercel

1. In Vercel, go to your project → **Settings → Domains**
2. Click **"Add Domain"**
3. Enter: `yourstore.lk`
4. Click **"Add"**
5. Also add: `www.yourstore.lk` (Vercel auto-redirects www → root)

Vercel will show you the DNS records to configure. Keep this page open.

### 11.2 Set Up Cloudflare (Strongly Recommended)

Cloudflare gives you free CDN, DDoS protection, and faster page loads for Sri Lankan visitors.

**Step 1 — Add your site to Cloudflare:**
1. Go to **https://cloudflare.com** → Sign up free
2. Click **"Add a Site"** → enter `yourstore.lk`
3. Choose **Free plan**
4. Cloudflare scans your existing DNS records

**Step 2 — Update nameservers at your domain registrar:**
1. Cloudflare shows two nameserver addresses (e.g., `ajax.ns.cloudflare.com`)
2. Log in to wherever you bought your domain
3. Replace the existing nameservers with the Cloudflare ones
4. Save. DNS propagation takes 5 minutes to 48 hours.

**Step 3 — Configure DNS in Cloudflare:**
1. In Cloudflare → DNS → Records
2. Add a **CNAME** record:
   ```
   Type:    CNAME
   Name:    @  (or yourstore.lk)
   Target:  cname.vercel-dns.com
   Proxy:   ✅ Proxied (orange cloud)
   TTL:     Auto
   ```
3. Add another CNAME for www:
   ```
   Type:    CNAME
   Name:    www
   Target:  cname.vercel-dns.com
   Proxy:   ✅ Proxied
   TTL:     Auto
   ```

**Step 4 — SSL/TLS Settings in Cloudflare:**
1. Go to **SSL/TLS → Overview**
2. Set mode to **"Full (Strict)"** — this enforces HTTPS end-to-end

**Step 5 — Performance settings in Cloudflare:**
1. **Speed → Optimization:**
   - Auto Minify: ✅ HTML, ✅ CSS, ✅ JavaScript
   - Brotli: ✅ On
   - Rocket Loader: ❌ **OFF** (breaks ES modules — this is important)
   - Mirage: ❌ Off
2. **Network:**
   - HTTP/3 (QUIC): ✅ On
   - 0-RTT Connection Resumption: ✅ On

**Step 6 — Security settings in Cloudflare:**
1. **Security → WAF:**
   - Managed Rules: ✅ On (Cloudflare Managed Ruleset)
2. **Security → Bots:**
   - Bot Fight Mode: ✅ On
3. **Security → DDoS:**
   - HTTP DDoS attack protection: ✅ High sensitivity

### 11.3 Verify Your Domain Works

After DNS propagates:

```bash
curl -I https://yourstore.lk
# Should return: HTTP/2 200
# With header: server: cloudflare
```

Visit `https://yourstore.lk` in your browser. The padlock should be green (HTTPS).

---

## 12. Step 10 — Post-Deployment Verification

Run through every feature to confirm it works end-to-end.

### 12.1 Storefront

```
□ https://yourstore.lk           — Homepage loads, hero image shows
□ /shop.html                     — Products display with prices
□ /product.html?slug=XXX         — Product detail, images, variants
□ Add to cart                    — Cart icon badge updates
□ /cart.html                     — Items shown, remove works
□ /login.html                    — OTP email sent and received
□ /checkout.html                 — Form pre-fills with saved address
□ /order-success.html            — Confirmation page after order
```

### 12.2 Admin Panel

```
□ /admin/index.html              — Login with your admin credentials
□ /admin/dashboard.html          — Stats and charts load
□ /admin/products.html           — Product list shows
□ /admin/orders.html             — Order list shows
□ /admin/reviews.html            — Review management works
□ /admin/settings.html           — Settings save and persist
```

### 12.3 API Endpoints

```bash
# Health check
curl https://yourstore.lk/api/health

# These should return 401 without a valid token (correct behaviour)
curl https://yourstore.lk/api/admin/orders
curl https://yourstore.lk/api/admin/products
```

### 12.4 Payment Flow Test

1. Add a product to cart
2. Log in as a customer
3. Go to checkout
4. Select **Bank Transfer** (safest test — no actual charge)
5. Submit — verify order appears in Admin → Orders
6. If testing PayHere: use their sandbox test cards from payhere.lk/sandbox

### 12.5 Email Test

1. Submit the contact form at `/contact.html`
2. Confirm you receive the email at your admin address

### 12.6 WhatsApp Test

1. Place a test order
2. Confirm the WhatsApp notification link opens with the correct order details

---

## 13. Step 11 — Admin Panel First-Run Setup

After deploying, log in to your admin panel and configure everything for your real store.

### 13.1 Change Admin Password

1. Go to **Admin → Settings → Security**
2. Enter your current password and set a new strong one
3. This is stored as a hashed value — not plain text

### 13.2 Store Identity

**Admin → Settings → Store Details:**
- Store name
- Tagline / description
- Contact phone
- Contact email
- Physical address
- Social media links (Facebook, Instagram, TikTok)

### 13.3 Payment Methods

**Admin → Settings → Payments:**
- Enable/disable PayHere, Bank Transfer, COD
- Enter your bank account details (shown to customers on checkout)
- Set PayHere live mode

### 13.4 Shipping Zones

**Admin → Delivery Zones:**
- Review the default Sri Lanka shipping zones
- Update rates to match your actual courier costs
- Adjust delivery day estimates per zone

### 13.5 SEO Settings

**Admin → SEO Settings:**
- Set your site URL (e.g., `https://yourstore.lk`)
- Default meta title and description
- Google Analytics 4 ID (starts with `G-`)
- Google Site Verification code

### 13.6 Add Your Products

**Admin → Products → Add Product:**
- Upload real product photos (WebP format, 800×800px minimum)
- Fill in accurate descriptions, prices, and stock levels
- Set categories, tags, and SKUs
- Mark your hero products as "Featured"

### 13.7 Delete Demo Data

After adding real products and taking real orders:

1. Go to **Admin → Products** → delete all demo products (PRD-0001 through PRD-0020)
2. Go to **Admin → Orders** → delete demo orders (ORD-20240001 through ORD-20240009)
3. Go to **Admin → Users** → delete demo users (USR-0001, USR-0002, USR-0003)

---

## 14. Step 12 — Security Hardening

### 14.1 Rotate Credentials

Before going public, rotate any credential that was ever in demo mode:

```bash
# Generate new ADMIN_API_TOKEN
openssl rand -hex 32

# Generate new admin password hash (just change the password in admin panel)
# Admin → Settings → Change Admin Password
```

Update these in Vercel → Settings → Environment Variables, then trigger a redeploy.

### 14.2 Verify .gitignore

```bash
git status --short
# .env and js/env.js should NOT appear in the output
```

If they appear:
```bash
git rm --cached .env js/env.js
git commit -m "Remove accidentally tracked secret files"
git push
```

### 14.3 GitHub Secret Scanning

1. Go to your GitHub repo → **Settings → Security → Code security and analysis**
2. Enable **"Secret scanning"** — GitHub alerts you if a credential is accidentally committed

### 14.4 Supabase Security Checklist

In your Supabase dashboard:

1. **Authentication → Auth Policies:**
   - Rate limiting: ✅ Enable rate limiting on auth endpoints
   - Email confirmation: ✅ Required before login

2. **Database → Row Level Security:**
   - Verify every table has RLS enabled (confirmed in Step 3.6)

3. **Database → Roles:**
   - Do NOT use the `postgres` or `service_role` key in any public-facing code

4. **Project Settings → Network:**
   - Add your Vercel deployment IP ranges to the allowlist (optional but recommended)

### 14.5 Vercel Security Settings

1. Go to your project → **Settings → Security**
2. Enable **"Password Protection"** on Preview deployments (optional — prevents public access to test branches)
3. In **Settings → General** → Deployment Protection → enable **"Vercel Authentication"** on non-production branches

### 14.6 Test Your Security Headers

```bash
# Check security headers are present
curl -I https://yourstore.lk | grep -E "X-Content-Type|X-Frame|Strict-Transport|Content-Security"
```

Expected headers (from your `vercel.json`):
```
strict-transport-security: max-age=63072000; includeSubDomains; preload
x-content-type-options: nosniff
x-frame-options: DENY
content-security-policy: ...
```

---

## 15. Step 13 — Monitoring & Uptime

### 15.1 UptimeRobot (Free — Recommended)

1. Sign up at **https://uptimerobot.com** (free — 50 monitors)
2. Click **"Add New Monitor"**
3. Configure:
   ```
   Monitor Type:    HTTP(s)
   Friendly Name:  Manarize Production
   URL:             https://yourstore.lk/api/health
   Check Interval: 5 minutes
   Alert Contacts: your email + WhatsApp
   ```
4. Add a second monitor for the homepage:
   ```
   URL:  https://yourstore.lk
   ```

### 15.2 Vercel Analytics (Built-in)

1. In your Vercel project → **Analytics** tab
2. Enable **Web Vitals** — monitors real user Core Web Vitals (LCP, FID, CLS)
3. Free for 2,500 data points/month

### 15.3 Supabase Monitoring

1. In Supabase → **Reports** tab
2. Monitor:
   - Database size (free tier limit: 500MB)
   - API requests per day
   - Auth users count
3. Set up **Database → Alerts** for storage approaching limits

### 15.4 Cloudflare Analytics

1. In Cloudflare → **Analytics & Logs → Traffic**
2. Monitor requests, threats blocked, and bandwidth usage — all free

---

## 16. Alternative Deployment Targets

### Netlify

```bash
# Install CLI
npm install -g netlify-cli

# Login
netlify login

# Deploy
cd manarize-v29
netlify deploy --prod --dir .
```

**Netlify environment variables:**
1. Site → Settings → Environment Variables → Add all variables from `.env`
2. Build settings: Build command `node build.js`, Publish directory `.`

**Netlify Functions:** The `api/` folder uses Vercel function format. For Netlify, rename `api/` to `netlify/functions/` and update each handler to use Netlify's format:
```js
// Vercel:  module.exports = async (req, res) => { ... }
// Netlify: exports.handler = async (event, context) => { ... }
```

---

### Cloudflare Pages

1. Go to **Cloudflare Dashboard → Pages → Create a project**
2. Connect your GitHub repository
3. Configure:
   ```
   Framework preset:   None
   Build command:      node build.js
   Build output dir:   /
   ```
4. Add environment variables in **Settings → Environment Variables**

**Note:** Cloudflare Pages uses **Cloudflare Workers** for serverless functions, not Node.js. The `api/` folder's `.js` files use Vercel/Node.js format and will need to be rewritten as Cloudflare Workers if you use this platform.

---

### cPanel / Shared Hosting (Basic — No Serverless)

Use this only if you don't need PayHere webhook verification (the webhook requires a serverless function).

1. Run `node build.js` locally to generate `js/env.js`
2. Upload all files via FTP to `public_html/`
3. Create an `.htaccess` file in `public_html/`:

```apache
# Error pages
ErrorDocument 404 /404.html

# Security
Options -Indexes
ServerSignature Off

# HTTPS redirect
RewriteEngine On
RewriteCond %{HTTPS} off
RewriteRule ^(.*)$ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]

# WWW to non-www redirect (or reverse — pick one)
RewriteCond %{HTTP_HOST} ^www\.(.+)$ [NC]
RewriteRule ^ https://%1%{REQUEST_URI} [R=301,L]

# Clean URLs (remove .html)
RewriteCond %{REQUEST_FILENAME} !-d
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME}.html -f
RewriteRule ^(.+)$ $1.html [L,QSA]

# Caching
<IfModule mod_expires.c>
  ExpiresActive On
  ExpiresByType text/css "access plus 1 year"
  ExpiresByType application/javascript "access plus 1 day"
  ExpiresByType image/webp "access plus 30 days"
  ExpiresByType image/png "access plus 30 days"
  ExpiresByType image/jpeg "access plus 30 days"
  ExpiresByType text/html "access plus 0 seconds"
</IfModule>

# Security headers
<IfModule mod_headers.c>
  Header always set X-Content-Type-Options "nosniff"
  Header always set X-Frame-Options "DENY"
  Header always set X-XSS-Protection "1; mode=block"
  Header always set Referrer-Policy "strict-origin-when-cross-origin"
  Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains"
</IfModule>

# Protect sensitive files
<FilesMatch "^\.env|build\.js$">
  Require all denied
</FilesMatch>
```

> ⚠️ With cPanel, the PayHere webhook (`/api/payhere-webhook`) will not work. Payment verification will be client-side only (less secure). Use Vercel for production stores that take real payments.

---

## 17. Production Checklist (Print This)

### 🔐 Security
- [ ] `DEMO_MODE=false` in Vercel env vars
- [ ] Admin password changed from `admin123`
- [ ] `ADMIN_API_TOKEN` is a 64-character random hex string
- [ ] `.env` and `js/env.js` are in `.gitignore` and NOT in GitHub
- [ ] Supabase RLS is active on all tables
- [ ] `PAYHERE_SANDBOX=false` (for live payments only)
- [ ] EmailJS restricted to your domain
- [ ] Supabase Auth rate limiting enabled

### 🗄️ Database
- [ ] `supabase-setup.sql` has been run successfully
- [ ] Auth → Site URL set to production domain
- [ ] Auth → Redirect URLs include production domain
- [ ] Auth email templates branded with store name

### 💳 Payments
- [ ] PayHere Merchant ID and Secret are the **live** (not sandbox) values
- [ ] PayHere Notify URL set to `https://yourstore.lk/api/payhere-webhook`
- [ ] PayHere Return URL set to `https://yourstore.lk/order-success.html`
- [ ] PayHere allowed domain includes `yourstore.lk`
- [ ] Bank account details updated in Admin → Settings

### 📡 Infrastructure
- [ ] GitHub repo is **Private**
- [ ] All environment variables added to Vercel
- [ ] Custom domain connected in Vercel
- [ ] Cloudflare DNS configured and proxied (orange cloud)
- [ ] SSL/TLS mode set to "Full (Strict)" in Cloudflare
- [ ] Rocket Loader is **OFF** in Cloudflare
- [ ] `https://yourstore.lk/api/health` returns `"status": "ok"`

### 📧 Notifications
- [ ] EmailJS Service ID, Template ID, and Public Key set
- [ ] Contact form sends real emails
- [ ] WhatsApp phone number is your real business number
- [ ] WhatsApp test notification received

### 🛒 Store Content
- [ ] Demo products deleted (PRD-0001 through PRD-0020)
- [ ] Real products added with actual photos and prices
- [ ] Shipping zone rates match your actual courier fees
- [ ] Payment methods configured (PayHere / Bank / COD)
- [ ] About, FAQ, Privacy Policy, Terms pages updated
- [ ] Sitemap XML updated with your real domain
- [ ] robots.txt Sitemap URL updated

### 📈 SEO & Analytics
- [ ] Sitemap submitted to Google Search Console
- [ ] Google Analytics 4 ID set in Admin → SEO
- [ ] Meta titles and descriptions set for key pages
- [ ] Open Graph images uploaded
- [ ] Google Search Console verified

### 🔔 Monitoring
- [ ] UptimeRobot monitor created for `/api/health`
- [ ] Alert email/WhatsApp configured in UptimeRobot
- [ ] Vercel Web Analytics enabled
- [ ] Supabase storage alerts configured

---

## 18. Ongoing Maintenance

### Weekly Tasks
- Check UptimeRobot for any downtime incidents
- Review new orders in Admin panel
- Approve or reject pending product reviews
- Monitor Supabase database size (free tier: 500MB)

### Monthly Tasks
- Review PostHog/analytics for conversion rate and bounce rate
- Check Cloudflare Security Events for blocked threats
- Review Supabase auth logs for unusual login patterns
- Update product stock levels and prices
- Test the checkout flow end-to-end with a real order

### When Updating the Codebase

```bash
# 1. Pull latest changes
git pull origin main

# 2. If .env changed (new variables added), update it
cp .env.example .env.example.new
# Compare and add new variables to your .env

# 3. Run build
node build.js

# 4. Test locally
npm run dev

# 5. Push to GitHub — Vercel auto-deploys
git add .
git commit -m "Update: describe what changed"
git push origin main
```

### Supabase Backup

Supabase Pro plan includes daily automatic backups. On the free plan, export manually:

1. Supabase → **Database → Backups** → Download
2. Or via SQL: `pg_dump` (available in Supabase SQL editor with export)

### Updating Environment Variables

When you change an env var in Vercel:

1. Go to your project → **Settings → Environment Variables**
2. Edit the variable and save
3. Go to **Deployments** → click **"..."** on the latest deployment → **"Redeploy"**
4. The new value takes effect after the redeploy completes

---

## 19. Rollback Procedure

If a deployment breaks the live site:

### Instant Rollback via Vercel

1. Go to your Vercel project → **Deployments** tab
2. Find the last **working** deployment (green checkmark)
3. Click **"..."** on it → **"Promote to Production"**
4. The previous working version is live within 30 seconds

### Rollback via Git

```bash
# Find the last good commit
git log --oneline -10

# Roll back locally
git revert HEAD  # or git reset --hard <commit-hash>

# Push the rollback
git push origin main
```

---

## 20. Troubleshooting Common Issues

### "CORS error" on API calls
- Ensure `SITE_URL` is set correctly in Vercel env vars
- Check the `vercel.json` headers include your domain in `Content-Security-Policy`

### "Supabase not initialised" error in console
- Verify `SUPABASE_URL` and `SUPABASE_ANON_KEY` are set in Vercel
- Check they don't contain placeholder text (`YOUR_PROJECT`)
- Trigger a fresh redeploy after fixing env vars

### Admin login not working
- Confirm `ADMIN_EMAIL` and `ADMIN_PASSWORD` match what you're typing
- The password is case-sensitive
- If you forgot the password: update `ADMIN_PASSWORD` in Vercel env vars and redeploy

### PayHere webhook not receiving notifications
- Verify the Notify URL in PayHere dashboard matches exactly: `https://yourstore.lk/api/payhere-webhook`
- Check `PAYHERE_MERCHANT_SECRET` is the correct live key (not sandbox)
- Test with: `curl -X POST https://yourstore.lk/api/payhere-webhook` — should return 400 (correct, missing params)

### OTP emails not arriving
- Check Supabase → Authentication → Logs for send errors
- Verify the Site URL in Supabase Auth matches your domain exactly
- Check spam folder
- Supabase free tier has a rate limit of 3 auth emails per hour per email address

### WhatsApp messages not working
- Verify `WA_PHONE` has no `+` sign and includes country code (`94xxxxxxxxx`)
- Test by manually visiting: `https://wa.me/94771234567?text=test`

### Products not loading / 404 on product pages
- Check browser console for JavaScript module errors
- Verify `js/env.js` was generated correctly by `build.js` during deployment
- Run `curl https://yourstore.lk/js/env.js` — should return JS code, not 404

### Vercel build failing
- Check the build logs in Vercel → Deployments → click the failed deployment
- Common cause: missing env variable that `build.js` requires
- Fix: add the missing variable in Settings → Environment Variables → Redeploy

### Cloudflare "Error 522 — Connection timed out"
- Vercel deployment may be down → check https://vercel.com/status
- Temporarily set Cloudflare DNS record to "DNS only" (grey cloud) to bypass Cloudflare and test direct

---

*Manarize v29 — Production Deployment Guide*
*Last updated: April 2026*

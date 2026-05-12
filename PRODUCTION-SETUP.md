# Manarize — Production Setup Guide

This build has **demo data removed** and is configured for **production mode** (Supabase backend, live PayHere payments).

---

## Quick Start

```bash
# 1. Copy the environment template
cp .env.demo .env

# 2. Fill in every value in .env with your real credentials (see below)

# 3. Generate the browser config
node build.js

# 4. Deploy to Vercel (or run locally)
npm run dev
```

---

## Required Credentials

### Supabase (Database + Auth)
1. Create a project at https://supabase.com (choose Singapore region for LK)
2. Go to **Project Settings → API**
3. Copy:
   - `SUPABASE_URL` — your Project URL
   - `SUPABASE_ANON_KEY` — the `anon / public` key
   - `SUPABASE_SERVICE_ROLE_KEY` — the `service_role` key *(server-only, never in browser)*
4. Run the database schema: paste `supabase-setup.sql` into the Supabase SQL editor

### PayHere (Payments)
1. Register at https://payhere.lk
2. Go to **Settings → Merchant**
3. Copy `PAYHERE_MERCHANT_ID` and `PAYHERE_MERCHANT_SECRET`
4. Set your Notify URL in PayHere dashboard: `https://yourdomain.com/api/payhere-webhook`
5. `PAYHERE_SANDBOX=false` for live payments

### Admin API Token
Generate a secure random token:
```bash
openssl rand -hex 32
```
Set this as `ADMIN_API_TOKEN` in your `.env` and in Vercel environment variables.

### WhatsApp
Set `WA_PHONE` and `WA_PHONE_2` to your business numbers in international format (no `+`), e.g. `94771234567`.

### EmailJS (Contact Form)
1. Sign up at https://emailjs.com
2. Add an Email Service and create a Template
3. Fill in `EMAILJS_PUBLIC_KEY`, `EMAILJS_SERVICE_ID`, `EMAILJS_TEMPLATE_ID`, `EMAILJS_ADMIN_EMAIL`

---

## Vercel Deployment

Add **all** variables from your `.env` into:
**Project → Settings → Environment Variables**

The `vercel.json` `buildCommand` runs `node build.js` automatically on every deploy.

---

## Pre-Launch Checklist

- [ ] `.env` created with all real credentials
- [ ] `DEMO_MODE=false` confirmed in `.env`
- [ ] `PAYHERE_SANDBOX=false` confirmed
- [ ] `ADMIN_API_TOKEN` set to a random 32-byte hex string
- [ ] `SUPABASE_SERVICE_ROLE_KEY` set (needed by `/api` routes)
- [ ] `SITE_URL` set to your live domain
- [ ] Database schema applied via `supabase-setup.sql`
- [ ] PayHere Notify URL configured in PayHere dashboard
- [ ] `js/env.js` is **not** in git (`git status` should not show it)
- [ ] `.env` is **not** in git (`git status` should not show it)

---

## Adding Products, Users & Categories

All data is managed through the **Admin Panel** (`/admin`) after deployment. There is no pre-loaded demo data — start fresh and add your real products.

- **Products** → `/admin/products.html` → Add Product
- **Categories** → `/admin/categories.html`
- **Users** are created automatically when customers sign up via Supabase OTP auth

---

## Demo Mode (optional, for testing)

If you need to test locally without a database:

```bash
npm run dev:demo
# Admin login: admin@yourdomain.com / (set ADMIN_PASSWORD in .env.demo)
```

This uses localStorage — no Supabase connection required.

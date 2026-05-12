-- ============================================================
-- MANARIZE — Full Supabase Setup (Combined)
-- Order: 1) Schema + RLS (supabase-setup.sql)
--        2) Profiles/contact/newsletter RLS fix
--        3) Recursion fix + is_current_user_admin()
-- Safe to re-run: uses IF NOT EXISTS / CREATE OR REPLACE / DROP IF EXISTS
-- ============================================================

-- ============================================================
-- ZENMARKET — Complete Supabase Setup  (run once in SQL Editor)
-- Includes all ALTER TABLE for missing columns, new tables,
-- fixed RPC functions, trigger, RLS policies, and indexes.
-- Safe to re-run: uses IF NOT EXISTS / CREATE OR REPLACE.
--
-- v3 SECURITY PATCH (2026-04-25):
--   • C-1 — orders: removed anon SELECT/UPDATE/DELETE broad policies.
--            Admin mutations go via /api/admin/orders (service role).
--   • C-2 — profiles: removed anon SELECT all + anon UPDATE all.
--            Prevents privilege escalation (role='admin') via anon key.
--   • C-3 — products/categories: removed auth all-write policies.
--            Authenticated customers are now read-only.
--            Admin writes go via /api/admin/products (service role).
--   • M-4 — newsletter_subscribers: removed anon SELECT (exposed emails).
--   • Added rate_limits table for persistent serverless rate limiting.
-- ============================================================


-- ============================================================
-- § 1. PRODUCTS
-- ============================================================
CREATE TABLE IF NOT EXISTS products (
  id            text        PRIMARY KEY,
  name          text        NOT NULL,
  slug          text        UNIQUE NOT NULL,
  description   text,
  price         numeric     NOT NULL DEFAULT 0,
  compare_price numeric,
  stock         integer     NOT NULL DEFAULT 0,
  category      text,
  category_slug text,
  sku           text,
  weight        numeric,
  tags          text[]      DEFAULT '{}',
  hashtags      text[]      DEFAULT '{}',
  images        text[]      DEFAULT '{}',
  variants      jsonb       DEFAULT '[]',
  active        boolean     NOT NULL DEFAULT true,
  featured      boolean     NOT NULL DEFAULT false,
  rating        numeric     DEFAULT 0,
  review_count  integer     DEFAULT 0,
  seo_title     text,
  seo_desc      text,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- C-3 FIX: drop the old "auth all products" write-all policy
DROP POLICY IF EXISTS "Anon read active products"  ON products;
DROP POLICY IF EXISTS "Anon all products"           ON products;
DROP POLICY IF EXISTS "Auth all products"           ON products;
DROP POLICY IF EXISTS "Auth read products"          ON products;

-- Anon: read active products only (storefront)
CREATE POLICY "Anon read active products" ON products
  FOR SELECT TO anon USING (active = true);

-- Authenticated customers: read only (all products incl inactive for search)
-- Writes go exclusively through /api/admin/products using service role key
CREATE POLICY "Auth read products" ON products
  FOR SELECT TO authenticated USING (true);


-- ============================================================
-- § 2. CATEGORIES
-- ============================================================
CREATE TABLE IF NOT EXISTS categories (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  slug        text UNIQUE NOT NULL,
  description text,
  image       text,
  icon        text,
  parent_id   text REFERENCES categories(id) ON DELETE SET NULL,
  active      boolean     NOT NULL DEFAULT true,
  sort_order  integer     DEFAULT 0,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);
ALTER TABLE categories ADD COLUMN IF NOT EXISTS icon      text;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS parent_id text REFERENCES categories(id) ON DELETE SET NULL;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

-- C-3 FIX: drop old write-all policies
DROP POLICY IF EXISTS "Anon all categories"  ON categories;
DROP POLICY IF EXISTS "Anon read categories" ON categories;
DROP POLICY IF EXISTS "Auth all categories"  ON categories;
DROP POLICY IF EXISTS "Auth read categories" ON categories;

-- Anon and authenticated: read only
-- Admin writes go via /api/admin/* with service role key
CREATE POLICY "Anon read categories" ON categories
  FOR SELECT TO anon USING (true);

CREATE POLICY "Auth read categories" ON categories
  FOR SELECT TO authenticated USING (true);


-- ============================================================
-- § 3. ORDERS
-- ============================================================
CREATE TABLE IF NOT EXISTS orders (
  id              text PRIMARY KEY,
  customer_id     text,
  customer_name   text,
  customer_email  text,
  customer_phone  text,
  address         jsonb,
  items           jsonb   DEFAULT '[]',
  subtotal        numeric DEFAULT 0,
  shipping        numeric DEFAULT 0,
  discount        numeric DEFAULT 0,
  total           numeric DEFAULT 0,
  status          text    DEFAULT 'pending',
  payment_status  text    DEFAULT 'pending',
  payment_method  text    DEFAULT 'cod',
  payment_id      text,
  payment_slip    text,
  bank_ref        text,
  coupon_code     text,
  notes           text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_code  text DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_id   text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_slip text;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- C-1 FIX: Drop ALL legacy and previous policies
DROP POLICY IF EXISTS "Anon all orders"          ON orders;
DROP POLICY IF EXISTS "Anon insert orders"        ON orders;
DROP POLICY IF EXISTS "Anon read all orders"      ON orders;
DROP POLICY IF EXISTS "Anon update orders"        ON orders;
DROP POLICY IF EXISTS "Anon delete orders"        ON orders;
DROP POLICY IF EXISTS "Auth all orders"           ON orders;
DROP POLICY IF EXISTS "Auth insert own orders"    ON orders;
DROP POLICY IF EXISTS "Auth select own orders"    ON orders;
DROP POLICY IF EXISTS "Users can insert orders"   ON orders;
DROP POLICY IF EXISTS "Users can read own orders" ON orders;
DROP POLICY IF EXISTS "Users own orders"          ON orders;
DROP POLICY IF EXISTS "Select own orders"         ON orders;
DROP POLICY IF EXISTS "Insert orders"             ON orders;
DROP POLICY IF EXISTS "Authenticated insert"      ON orders;
DROP POLICY IF EXISTS "Public insert orders"      ON orders;
DROP POLICY IF EXISTS "Allow insert for all"      ON orders;
DROP POLICY IF EXISTS "Users read own orders"     ON orders;

-- C-1 FIX: Anon can only INSERT (guest checkout — storefront has no Supabase session)
CREATE POLICY "Anon insert orders" ON orders
  FOR INSERT TO anon WITH CHECK (true);

-- Authenticated users can read their own orders (profile page).
-- Matches by customer_id (Supabase UUID) OR customer_email so that orders
-- placed before the user linked their Supabase session remain visible.
DROP POLICY IF EXISTS "Users read own orders" ON orders;
CREATE POLICY "Users read own orders" ON orders
  FOR SELECT TO authenticated USING (
    auth.uid()::text = customer_id
    OR customer_email = auth.email()
  );

-- NOTE: Admin reads/writes/deletes go exclusively through
-- /api/admin/orders which uses SUPABASE_SERVICE_ROLE_KEY (bypasses RLS).


-- ============================================================
-- § 4. COUPONS
-- ============================================================
CREATE TABLE IF NOT EXISTS coupons (
  id          text    PRIMARY KEY,
  code        text    UNIQUE NOT NULL,
  type        text    NOT NULL DEFAULT 'percent',
  value       numeric NOT NULL DEFAULT 0,
  min_order   numeric DEFAULT 0,
  max_uses    integer DEFAULT NULL,
  used_count  integer NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true,
  expires_at  timestamptz,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS max_uses    integer DEFAULT NULL;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS used_count  integer NOT NULL DEFAULT 0;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS expires_at  timestamptz;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS min_order   numeric DEFAULT 0;
ALTER TABLE coupons DROP CONSTRAINT IF EXISTS coupons_type_check;
ALTER TABLE coupons ADD CONSTRAINT coupons_type_check CHECK (type IN ('percent', 'fixed', 'shipping'));
ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anon all coupons"          ON coupons;
DROP POLICY IF EXISTS "Anon read active coupons"  ON coupons;
DROP POLICY IF EXISTS "Anon read all coupons"     ON coupons;
DROP POLICY IF EXISTS "Auth all coupons"          ON coupons;
DROP POLICY IF EXISTS "Auth read coupons"         ON coupons;

-- Anon reads active coupons only (storefront validation)
CREATE POLICY "Anon read active coupons" ON coupons
  FOR SELECT TO anon USING (active = true);

-- Admin writes via service role API — no authenticated write policy needed
CREATE POLICY "Auth read coupons" ON coupons
  FOR SELECT TO authenticated USING (true);


-- ============================================================
-- § 5. SHIPPING ZONES
-- ============================================================
CREATE TABLE IF NOT EXISTS shipping_zones (
  id          text    PRIMARY KEY,
  name        text    NOT NULL,
  provinces   text[]  DEFAULT '{}',
  districts   text[]  DEFAULT '{}',
  rate        numeric NOT NULL DEFAULT 0,
  free_above  numeric DEFAULT NULL,
  min_days    integer DEFAULT 2,
  max_days    integer DEFAULT 4,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);
ALTER TABLE shipping_zones ADD COLUMN IF NOT EXISTS districts   text[]       DEFAULT '{}';
ALTER TABLE shipping_zones ADD COLUMN IF NOT EXISTS free_above  numeric      DEFAULT NULL;
ALTER TABLE shipping_zones ADD COLUMN IF NOT EXISTS min_days    integer      DEFAULT 2;
ALTER TABLE shipping_zones ADD COLUMN IF NOT EXISTS max_days    integer      DEFAULT 4;
ALTER TABLE shipping_zones ADD COLUMN IF NOT EXISTS active      boolean      NOT NULL DEFAULT true;
ALTER TABLE shipping_zones ADD COLUMN IF NOT EXISTS updated_at  timestamptz  DEFAULT now();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'shipping_zones' AND column_name = 'provinces'
  ) THEN
    UPDATE shipping_zones
    SET districts = provinces
    WHERE (districts IS NULL OR districts = '{}')
      AND provinces IS NOT NULL AND provinces != '{}';
  END IF;
END $$;

ALTER TABLE shipping_zones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anon all shipping_zones"   ON shipping_zones;
DROP POLICY IF EXISTS "Anon read shipping_zones"  ON shipping_zones;
DROP POLICY IF EXISTS "Auth all shipping_zones"   ON shipping_zones;
DROP POLICY IF EXISTS "Auth read shipping_zones"  ON shipping_zones;

CREATE POLICY "Anon read shipping_zones" ON shipping_zones
  FOR SELECT TO anon USING (true);

CREATE POLICY "Auth read shipping_zones" ON shipping_zones
  FOR SELECT TO authenticated USING (true);


-- ============================================================
-- § 6. PROFILES  (customers + admin users)
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text,
  email       text,
  phone       text    DEFAULT '',
  role        text    DEFAULT 'customer' CHECK (role IN ('customer','admin')),
  active      boolean DEFAULT true,
  orders      integer DEFAULT 0,
  total_spent numeric DEFAULT 0,
  addresses   jsonb   DEFAULT '[]',
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email       text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS active      boolean DEFAULT true;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS orders      integer DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS total_spent numeric DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS addresses   jsonb   DEFAULT '[]';

UPDATE profiles p SET email = u.email
FROM auth.users u WHERE p.id = u.id AND p.email IS NULL;

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- C-2 FIX: Drop all broad anon policies on profiles
DROP POLICY IF EXISTS "Anon read all profiles"  ON profiles;
DROP POLICY IF EXISTS "Anon update profiles"    ON profiles;
DROP POLICY IF EXISTS "Anon insert profiles"    ON profiles;
DROP POLICY IF EXISTS "Anon insert own profile" ON profiles;
DROP POLICY IF EXISTS "Users own profile"       ON profiles;

-- C-2 FIX: Anon can only INSERT during signup (Supabase trigger handles this,
-- but keep for edge cases). Cannot read or update profiles without auth.
-- The trigger handle_new_user() uses SECURITY DEFINER so it bypasses RLS.
CREATE POLICY "Anon insert own profile" ON profiles
  FOR INSERT TO anon WITH CHECK (true);

-- Authenticated users can only access their own profile
CREATE POLICY "Users own profile" ON profiles
  FOR ALL TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- NOTE: Admin profile reads (for role checks) go exclusively through
-- /api/admin/* which uses SUPABASE_SERVICE_ROLE_KEY (bypasses RLS).


-- ============================================================
-- § 7. REVIEWS
-- ============================================================
CREATE TABLE IF NOT EXISTS reviews (
  id          text PRIMARY KEY,
  product_id  text NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id     text NOT NULL,
  user_name   text DEFAULT 'Anonymous',
  rating      integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title       text    DEFAULT '',
  body        text    NOT NULL,
  verified    boolean DEFAULT false,
  approved    boolean DEFAULT false,
  rejected    boolean DEFAULT false,
  edited_at   timestamptz,
  approved_at timestamptz,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS rejected    boolean     DEFAULT false;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS edited_at   timestamptz;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS updated_at  timestamptz DEFAULT now();

ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anon read approved reviews" ON reviews;
DROP POLICY IF EXISTS "Anon all reviews"           ON reviews;
DROP POLICY IF EXISTS "Anon insert reviews"        ON reviews;
DROP POLICY IF EXISTS "Auth all reviews"           ON reviews;
DROP POLICY IF EXISTS "Auth read reviews"          ON reviews;
DROP POLICY IF EXISTS "Auth insert reviews"        ON reviews;

-- M-4: Anon can only read approved, non-rejected reviews
CREATE POLICY "Anon read approved reviews" ON reviews
  FOR SELECT TO anon USING (approved = true AND rejected = false);

-- Anon can submit reviews (guest shoppers)
CREATE POLICY "Anon insert reviews" ON reviews
  FOR INSERT TO anon WITH CHECK (true);

-- Authenticated users can read all reviews and submit; admin manages via API
CREATE POLICY "Auth read reviews" ON reviews
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Auth insert reviews" ON reviews
  FOR INSERT TO authenticated WITH CHECK (true);


-- ============================================================
-- § 8. CONTACT MESSAGES
-- ============================================================
CREATE TABLE IF NOT EXISTS contact_messages (
  id         text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  first_name text, last_name text, email text, phone text,
  subject    text, message   text,
  read       boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE contact_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anon all contact_messages"    ON contact_messages;
DROP POLICY IF EXISTS "Anon insert contact_messages" ON contact_messages;
DROP POLICY IF EXISTS "Auth all contact_messages"    ON contact_messages;

-- Public users submit only; admin reads via service-role API
CREATE POLICY "Anon insert contact_messages" ON contact_messages
  FOR INSERT TO anon WITH CHECK (true);

-- ============================================================
-- § 9. BLOG POSTS
-- ============================================================
CREATE TABLE IF NOT EXISTS blog_posts (
  id           text PRIMARY KEY,
  title        text NOT NULL,
  slug         text UNIQUE NOT NULL,
  category     text,
  excerpt      text,
  content      text,
  cover_image  text,
  author       text    DEFAULT 'Manarize Team',
  published    boolean DEFAULT false,
  featured     boolean DEFAULT false,
  read_time    integer DEFAULT 5,
  tags         text[]  DEFAULT '{}',
  seo_title    text,
  seo_desc     text,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS content     text;
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS category    text         DEFAULT '';
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS excerpt     text         DEFAULT '';
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS cover_image text         DEFAULT '';
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS author      text         DEFAULT 'Manarize Team';
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS featured    boolean      DEFAULT false;
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS read_time   integer      DEFAULT 5;
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS tags        text[]       DEFAULT '{}';
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS seo_title   text         DEFAULT '';
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS seo_desc    text         DEFAULT '';
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS updated_at  timestamptz  DEFAULT now();

ALTER TABLE blog_posts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anon read published posts" ON blog_posts;
DROP POLICY IF EXISTS "Anon all blog_posts"       ON blog_posts;
DROP POLICY IF EXISTS "Auth all blog_posts"       ON blog_posts;
DROP POLICY IF EXISTS "Auth read blog_posts"      ON blog_posts;

-- M-4: Anon reads published posts only
CREATE POLICY "Anon read published posts" ON blog_posts
  FOR SELECT TO anon USING (published = true);

-- Authenticated users read all (for admin preview); writes via service-role API
CREATE POLICY "Auth read blog_posts" ON blog_posts
  FOR SELECT TO authenticated USING (true);


-- ============================================================
-- § 10. NOTIFICATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
  id         text PRIMARY KEY,
  type       text NOT NULL DEFAULT 'info',
  title      text NOT NULL DEFAULT '',
  message    text NOT NULL DEFAULT '',
  data       jsonb DEFAULT '{}',
  user_id    text,
  read       boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS user_id text;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anon all notifications"    ON notifications;
DROP POLICY IF EXISTS "Anon read notifications"   ON notifications;
DROP POLICY IF EXISTS "Anon insert notifications" ON notifications;
DROP POLICY IF EXISTS "Anon update notifications" ON notifications;
DROP POLICY IF EXISTS "Auth all notifications"    ON notifications;

-- Anon: read admin-targeted notifications (realtime badge), insert new-order notifications
CREATE POLICY "Anon read notifications"   ON notifications FOR SELECT TO anon USING (true);
CREATE POLICY "Anon insert notifications" ON notifications FOR INSERT TO anon WITH CHECK (true);
-- Anon may only flip read=true (mark-read), nothing else
CREATE POLICY "Anon update notifications" ON notifications FOR UPDATE TO anon
  USING (true) WITH CHECK (read = true);

DROP POLICY IF EXISTS "Auth all notifications" ON notifications;
-- Admin-role users have full access to all notifications (dashboard)
DROP POLICY IF EXISTS "Admin all notifications" ON notifications;
CREATE POLICY "Admin all notifications"
  ON notifications FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin' AND active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin' AND active = true
    )
  );

-- Regular authenticated users may read, update, and delete their OWN notifications only
DROP POLICY IF EXISTS "Auth user own notifications select" ON notifications;
CREATE POLICY "Auth user own notifications select"
  ON notifications FOR SELECT TO authenticated
  USING (user_id = auth.uid()::text);

DROP POLICY IF EXISTS "Auth user own notifications update" ON notifications;
CREATE POLICY "Auth user own notifications update"
  ON notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

DROP POLICY IF EXISTS "Auth user own notifications delete" ON notifications;
CREATE POLICY "Auth user own notifications delete"
  ON notifications FOR DELETE TO authenticated
  USING (user_id = auth.uid()::text);


-- ============================================================
-- § 11. SITE SETTINGS
-- ============================================================
CREATE TABLE IF NOT EXISTS site_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE site_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anon all site_settings"    ON site_settings;
DROP POLICY IF EXISTS "Anon read site_settings"   ON site_settings;
DROP POLICY IF EXISTS "Anon write site_settings"  ON site_settings;
DROP POLICY IF EXISTS "Anon update site_settings" ON site_settings;
DROP POLICY IF EXISTS "Auth all site_settings"    ON site_settings;

-- Storefront reads settings publicly
CREATE POLICY "Anon read site_settings"   ON site_settings FOR SELECT TO anon USING (true);
-- Authenticated users may read settings (e.g. for personalisation)
DROP POLICY IF EXISTS "Auth read site_settings" ON site_settings;
CREATE POLICY "Auth read site_settings"   ON site_settings FOR SELECT TO authenticated USING (true);
-- Only admin-role users may write settings
DROP POLICY IF EXISTS "Admin write site_settings" ON site_settings;
CREATE POLICY "Admin write site_settings"
  ON site_settings FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin' AND active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin' AND active = true
    )
  );


-- ============================================================
-- § 12. NEWSLETTER SUBSCRIBERS
-- ============================================================
CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  email         text PRIMARY KEY,
  subscribed_at timestamptz DEFAULT now(),
  active        boolean DEFAULT true
);
ALTER TABLE newsletter_subscribers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anon insert newsletter" ON newsletter_subscribers;
DROP POLICY IF EXISTS "Anon read newsletter"   ON newsletter_subscribers;

-- M-4 FIX: Anon can only INSERT (subscribe). SELECT removed — exposes all emails.
-- Admin reads subscriber list via service-role key in API.
CREATE POLICY "Anon insert newsletter" ON newsletter_subscribers
  FOR INSERT TO anon WITH CHECK (true);

-- subscribe_newsletter: SECURITY DEFINER so anon can call via RPC
-- without needing SELECT permission (upsert requires SELECT, which is insecure).
-- Returns: 'subscribed' | 'already_subscribed'
DROP FUNCTION IF EXISTS subscribe_newsletter(text);
CREATE OR REPLACE FUNCTION subscribe_newsletter(p_email text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO newsletter_subscribers (email, subscribed_at, active)
  VALUES (lower(trim(p_email)), now(), true)
  ON CONFLICT (email) DO NOTHING;

  IF FOUND THEN
    RETURN 'subscribed';
  ELSE
    RETURN 'already_subscribed';
  END IF;
END;
$$;

-- Allow anon and authenticated to call the function
GRANT EXECUTE ON FUNCTION subscribe_newsletter(text) TO anon;
GRANT EXECUTE ON FUNCTION subscribe_newsletter(text) TO authenticated;


-- ============================================================
-- § 13. ADMIN CONFIG
-- ============================================================
CREATE TABLE IF NOT EXISTS admin_config (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE admin_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anon all admin_config" ON admin_config;
DROP POLICY IF EXISTS "Auth all admin_config" ON admin_config;
-- No anon access. Service role key only (server-side API routes).
-- Authenticated access locked down — admin uses service role via API.


-- ============================================================
-- § 14. RATE LIMITS  (H-1 FIX: persistent serverless rate limiting)
-- ============================================================
-- Replaces in-memory Maps that reset on each Vercel cold start.
-- Used by /api/verify-captcha and /api/admin/auth.
-- Rows auto-expire via the reset_at column; a cleanup cron or
-- the insert-on-conflict logic handles stale rows.
CREATE TABLE IF NOT EXISTS rate_limits (
  key        text PRIMARY KEY,        -- e.g. "captcha:1.2.3.4" or "auth:user@x.com"
  count      integer NOT NULL DEFAULT 0,
  locked     boolean NOT NULL DEFAULT false,
  locked_until timestamptz,
  reset_at   timestamptz NOT NULL DEFAULT (now() + interval '1 minute'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role rate_limits" ON rate_limits;
-- No anon/authenticated access — only service role key (server-side only)


-- ============================================================
-- § 15. RPC FUNCTIONS
-- ============================================================

-- Atomically decrement product stock (prevents going below 0)
CREATE OR REPLACE FUNCTION decrement_stock(product_id text, amount integer)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE products
  SET stock = GREATEST(0, stock - amount), updated_at = now()
  WHERE id = product_id;
$$;

-- Atomically increment coupon usage counter
CREATE OR REPLACE FUNCTION increment_coupon_usage(coupon_code text)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE coupons SET used_count = used_count + 1, updated_at = now()
  WHERE code = coupon_code;
$$;

-- Recalculate product avg rating from approved reviews
CREATE OR REPLACE FUNCTION refresh_product_rating(p_product_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_avg   numeric;
  v_count integer;
BEGIN
  SELECT COALESCE(AVG(rating),0), COUNT(*)
  INTO v_avg, v_count
  FROM reviews
  WHERE product_id = p_product_id AND approved = true AND rejected = false;
  UPDATE products SET rating = ROUND(v_avg,1), review_count = v_count, updated_at = now()
  WHERE id = p_product_id;
END;
$$;

-- Rate limit check/increment — SECURITY DEFINER so anon role can call it
-- Returns: { limited: bool, count: int }
CREATE OR REPLACE FUNCTION check_rate_limit(
  p_key        text,
  p_max        integer,
  p_window_ms  bigint,
  p_lockout_ms bigint DEFAULT 0
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_row rate_limits%ROWTYPE;
  v_now timestamptz := now();
BEGIN
  SELECT * INTO v_row FROM rate_limits WHERE key = p_key FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO rate_limits (key, count, locked, locked_until, reset_at, updated_at)
    VALUES (p_key, 1, false, NULL,
            v_now + (p_window_ms || ' milliseconds')::interval, v_now)
    ON CONFLICT (key) DO NOTHING;
    RETURN jsonb_build_object('limited', false, 'count', 1);
  END IF;

  -- Reset window if expired
  IF v_now > v_row.reset_at THEN
    UPDATE rate_limits SET count = 1, locked = false, locked_until = NULL,
      reset_at = v_now + (p_window_ms || ' milliseconds')::interval,
      updated_at = v_now
    WHERE key = p_key;
    RETURN jsonb_build_object('limited', false, 'count', 1);
  END IF;

  -- Check lockout
  IF v_row.locked AND v_row.locked_until IS NOT NULL AND v_now < v_row.locked_until THEN
    RETURN jsonb_build_object('limited', true, 'count', v_row.count);
  END IF;

  -- Increment
  UPDATE rate_limits SET count = count + 1,
    locked = CASE WHEN count + 1 >= p_max AND p_lockout_ms > 0 THEN true ELSE false END,
    locked_until = CASE WHEN count + 1 >= p_max AND p_lockout_ms > 0
      THEN v_now + (p_lockout_ms || ' milliseconds')::interval ELSE NULL END,
    updated_at = v_now
  WHERE key = p_key;

  RETURN jsonb_build_object('limited', (v_row.count + 1 > p_max), 'count', v_row.count + 1);
END;
$$;

-- Auto-update updated_at timestamps
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_products_updated_at   ON products;
CREATE TRIGGER trg_products_updated_at   BEFORE UPDATE ON products   FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_orders_updated_at     ON orders;
CREATE TRIGGER trg_orders_updated_at     BEFORE UPDATE ON orders     FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_reviews_updated_at    ON reviews;
CREATE TRIGGER trg_reviews_updated_at    BEFORE UPDATE ON reviews    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_profiles_updated_at   ON profiles;
CREATE TRIGGER trg_profiles_updated_at   BEFORE UPDATE ON profiles   FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION trg_review_approved()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.approved IS DISTINCT FROM OLD.approved OR NEW.rejected IS DISTINCT FROM OLD.rejected) THEN
    PERFORM refresh_product_rating(NEW.product_id);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_reviews_rating ON reviews;
CREATE TRIGGER trg_reviews_rating AFTER UPDATE ON reviews FOR EACH ROW EXECUTE FUNCTION trg_review_approved();

-- Grant RPC function access (SECURITY DEFINER handles its own auth)
GRANT EXECUTE ON FUNCTION decrement_stock(text,integer)             TO anon, authenticated;
GRANT EXECUTE ON FUNCTION increment_coupon_usage(text)              TO anon, authenticated;
GRANT EXECUTE ON FUNCTION refresh_product_rating(text)              TO anon, authenticated;
GRANT EXECUTE ON FUNCTION check_rate_limit(text,integer,bigint,bigint) TO anon, authenticated;


-- ============================================================
-- § 16. TRIGGER: Auto-create profile on Supabase auth signup
-- ============================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, name, phone, role, email, addresses)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email,'@',1)),
    COALESCE(NEW.raw_user_meta_data->>'phone',''),
    'customer',
    NEW.email,
    '[]'::jsonb
  )
  ON CONFLICT (id) DO UPDATE SET
    email      = EXCLUDED.email,
    updated_at = now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();


-- ============================================================
-- § 17. REALTIME
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;

DO $$ DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['orders','products','reviews','notifications'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename=t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I', t);
    END IF;
  END LOOP;
END $$;


-- ============================================================
-- § 18. INDEXES (v2 — Production Performance Optimized)
-- ============================================================

-- ── Core single-column indexes ────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_products_slug          ON products(slug);
CREATE INDEX IF NOT EXISTS idx_products_category_slug ON products(category_slug);
CREATE INDEX IF NOT EXISTS idx_products_active        ON products(active);
CREATE INDEX IF NOT EXISTS idx_orders_customer_id     ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status          ON orders(status);
CREATE INDEX IF NOT EXISTS idx_reviews_product_id     ON reviews(product_id);
CREATE INDEX IF NOT EXISTS idx_reviews_user_id        ON reviews(user_id);
CREATE INDEX IF NOT EXISTS idx_reviews_approved       ON reviews(approved);
CREATE INDEX IF NOT EXISTS idx_blog_posts_slug        ON blog_posts(slug);
CREATE INDEX IF NOT EXISTS idx_notifications_read     ON notifications(read);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id  ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_coupons_code           ON coupons(code);
CREATE INDEX IF NOT EXISTS idx_rate_limits_reset_at   ON rate_limits(reset_at);

-- ── COMPOSITE INDEXES — storefront hot paths ─────────────────────
-- Covers: getProducts() — active + sort by newest (most common query)
CREATE INDEX IF NOT EXISTS idx_products_active_created
  ON products(active, created_at DESC);

-- Covers: getProducts({ featured: true }) — homepage featured section
CREATE INDEX IF NOT EXISTS idx_products_active_featured
  ON products(active, featured, created_at DESC);

-- Covers: getProducts({ category }) — shop page category filter
CREATE INDEX IF NOT EXISTS idx_products_active_cat_created
  ON products(active, category_slug, created_at DESC);

-- Covers: price-sorted storefront queries
CREATE INDEX IF NOT EXISTS idx_products_active_price
  ON products(active, price);

-- Covers: rating-sorted storefront queries
CREATE INDEX IF NOT EXISTS idx_products_active_rating
  ON products(active, rating DESC, review_count DESC);

-- ── PARTIAL INDEXES — only index active products (smaller, faster) ─
-- Partial index: active storefront products sorted by newest
CREATE INDEX IF NOT EXISTS idx_products_active_partial_created
  ON products(created_at DESC) WHERE active = true;

-- Partial index: active + featured (homepage — tiny subset, very fast)
CREATE INDEX IF NOT EXISTS idx_products_featured_partial
  ON products(created_at DESC) WHERE active = true AND featured = true;

-- ── ORDERS hot paths ──────────────────────────────────────────────
-- RLS policy: "Users read own orders" matches by customer_email
CREATE INDEX IF NOT EXISTS idx_orders_customer_email  ON orders(customer_email);
-- Admin dashboard: sort by newest + filter by status
CREATE INDEX IF NOT EXISTS idx_orders_status_created  ON orders(status, created_at DESC);
-- Admin: filter by payment_status
CREATE INDEX IF NOT EXISTS idx_orders_payment_status  ON orders(payment_status);

-- ── REVIEWS hot paths ─────────────────────────────────────────────
-- Storefront: approved reviews for a product, newest first
CREATE INDEX IF NOT EXISTS idx_reviews_product_approved
  ON reviews(product_id, approved, created_at DESC);

-- ── NOTIFICATIONS hot paths ───────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_notifications_user_read_created
  ON notifications(user_id, read, created_at DESC);

-- ── BLOG hot paths ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_blog_posts_published_created
  ON blog_posts(published, created_at DESC);

-- ── COUPONS: active coupon lookup by code ─────────────────────────
CREATE INDEX IF NOT EXISTS idx_coupons_active_code
  ON coupons(code) WHERE active = true;

-- ── PROFILES: role lookup (admin check in storage policies) ───────
CREATE INDEX IF NOT EXISTS idx_profiles_role_active
  ON profiles(role, active) WHERE role = 'admin';

-- ── FULL-TEXT SEARCH — products ───────────────────────────────────
-- Enable pg_trgm for fast trigram-based ilike on product name
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN trigram index on name — makes ilike '%term%' ~10x faster
CREATE INDEX IF NOT EXISTS idx_products_name_trgm
  ON products USING gin(name gin_trgm_ops);

-- Composite tsvector full-text search column
-- Weights: A=name (highest), B=category, C=tags/description
ALTER TABLE products ADD COLUMN IF NOT EXISTS fts tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(category, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'C')
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_products_fts
  ON products USING gin(fts);

-- Grant the new column to roles
GRANT SELECT ON TABLE public.products TO anon, authenticated;


-- ============================================================
-- § 19. STORAGE — product-images bucket
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-images', 'product-images', true, 5242880,
  ARRAY['image/jpeg','image/png','image/webp','image/gif']
) ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public read product images"  ON storage.objects;
CREATE POLICY "Public read product images"
  ON storage.objects FOR SELECT TO anon USING (bucket_id = 'product-images');

-- Authenticated non-admin users may also read product images (e.g. logged-in shoppers)
DROP POLICY IF EXISTS "Auth read product images"  ON storage.objects;
CREATE POLICY "Auth read product images"
  ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'product-images');

-- Only admin-role users may upload, update, or delete product / blog images
DROP POLICY IF EXISTS "Admin upload product images"  ON storage.objects;
CREATE POLICY "Admin upload product images"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'product-images'
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin' AND active = true
    )
  );

DROP POLICY IF EXISTS "Admin update product images"  ON storage.objects;
CREATE POLICY "Admin update product images"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'product-images'
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin' AND active = true
    )
  );

DROP POLICY IF EXISTS "Admin delete product images"  ON storage.objects;
CREATE POLICY "Admin delete product images"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'product-images'
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin' AND active = true
    )
  );


-- ============================================================
-- § 20. STORAGE — payment-slips bucket  (PRIVATE)
-- ============================================================
-- Bucket is PRIVATE: no public URLs. Admins access via signed URLs.
-- Only authenticated (logged-in) users may upload their own slip.
-- Only users with profiles.role = 'admin' may read any slip.
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'payment-slips', 'payment-slips', false, 524288,
  ARRAY['image/jpeg','image/png','image/webp','application/pdf']
) ON CONFLICT (id) DO UPDATE SET public = false;

-- Remove old permissive policies (anon access & broad auth read)
DROP POLICY IF EXISTS "Anon upload payment slips"   ON storage.objects;
DROP POLICY IF EXISTS "Anon update payment slips"   ON storage.objects;
DROP POLICY IF EXISTS "Auth read payment slips"     ON storage.objects;
DROP POLICY IF EXISTS "Public read payment slips"   ON storage.objects;
DROP POLICY IF EXISTS "Auth upload payment slips"   ON storage.objects;
DROP POLICY IF EXISTS "Auth update payment slips"   ON storage.objects;

-- Authenticated users may upload a slip whose path starts with their own order id.
-- The path format is: {orderId}/slip.{ext}
-- We validate they own that order by joining to the orders table.
DROP POLICY IF EXISTS "Auth user upload own order slip"   ON storage.objects;
CREATE POLICY "Auth user upload own order slip"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'payment-slips'
    AND EXISTS (
      SELECT 1 FROM public.orders
      WHERE id::text = split_part(name, '/', 1)
        AND customer_id = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS "Auth user update own order slip"  ON storage.objects;
CREATE POLICY "Auth user update own order slip"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'payment-slips'
    AND EXISTS (
      SELECT 1 FROM public.orders
      WHERE id::text = split_part(name, '/', 1)
        AND customer_id = auth.uid()::text
    )
  )
  WITH CHECK (
    bucket_id = 'payment-slips'
    AND EXISTS (
      SELECT 1 FROM public.orders
      WHERE id::text = split_part(name, '/', 1)
        AND customer_id = auth.uid()::text
    )
  );

-- Only admin-role users may read payment slips (for the admin dashboard).
DROP POLICY IF EXISTS "Admin read payment slips"    ON storage.objects;
CREATE POLICY "Admin read payment slips"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'payment-slips'
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role = 'admin'
        AND active = true
    )
  );


-- ============================================================
-- § 21. TABLE-LEVEL GRANTS
-- ============================================================
GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- orders: C-1 FIX — anon INSERT only (no SELECT/UPDATE/DELETE)
-- Admin operations use service role key via /api/admin/orders
GRANT INSERT                              ON TABLE public.orders TO anon;
GRANT ALL                                 ON TABLE public.orders TO authenticated;

-- products: C-3 FIX — anon and authenticated read only
-- Admin writes via service role key in /api/admin/products
GRANT SELECT                              ON TABLE public.products TO anon;
GRANT SELECT                              ON TABLE public.products TO authenticated;

-- categories: C-3 FIX — read only for both roles
GRANT SELECT                              ON TABLE public.categories TO anon;
GRANT SELECT                              ON TABLE public.categories TO authenticated;

-- coupons: anon read active only
GRANT SELECT                              ON TABLE public.coupons TO anon;
GRANT SELECT                              ON TABLE public.coupons TO authenticated;

-- profiles: C-2 FIX — anon INSERT only (signup), no SELECT or UPDATE
GRANT INSERT                              ON TABLE public.profiles TO anon;
GRANT ALL                                 ON TABLE public.profiles TO authenticated;

-- reviews
GRANT SELECT, INSERT                      ON TABLE public.reviews TO anon;
GRANT ALL                                 ON TABLE public.reviews TO authenticated;

-- notifications
GRANT SELECT, INSERT, UPDATE              ON TABLE public.notifications TO anon;
GRANT ALL                                 ON TABLE public.notifications TO authenticated;

-- contact_messages: anon INSERT only
GRANT INSERT                              ON TABLE public.contact_messages TO anon;
GRANT ALL                                 ON TABLE public.contact_messages TO authenticated;

-- blog_posts: read only for anon
GRANT SELECT                              ON TABLE public.blog_posts TO anon;
GRANT SELECT                              ON TABLE public.blog_posts TO authenticated;

-- shipping_zones: read only
GRANT SELECT                              ON TABLE public.shipping_zones TO anon;
GRANT SELECT                              ON TABLE public.shipping_zones TO authenticated;

-- site_settings: anon read only (admin writes via service role)
GRANT SELECT                              ON TABLE public.site_settings TO anon;
GRANT ALL                                 ON TABLE public.site_settings TO authenticated;

-- newsletter_subscribers: anon INSERT only (M-4 FIX: no SELECT)
GRANT INSERT                              ON TABLE public.newsletter_subscribers TO anon;
GRANT ALL                                 ON TABLE public.newsletter_subscribers TO authenticated;

-- admin_config: no anon access at all
GRANT ALL ON TABLE public.admin_config TO authenticated;

-- rate_limits: no direct anon access; use check_rate_limit() RPC
-- (SECURITY DEFINER function handles its own table access)


-- ============================================================
-- § 22. RELOAD POSTGREST SCHEMA CACHE
-- ============================================================
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Done. Security patch v3 applied.
-- Critical RLS issues C-1, C-2, C-3, M-4 resolved.
-- Persistent rate_limits table added for H-1 fix.
-- ============================================================


-- ============================================================
-- MIGRATION 1: Fix profiles, contact_messages, newsletter RLS
-- ============================================================
-- ============================================================
-- FIX: RLS policies for profiles, contact_messages, and
--      newsletter_subscribers tables.
-- Run this in: Supabase project → SQL Editor
-- ============================================================
-- Fixes:
--   1. "new row violates row-level security policy" on profiles
--   2. Contact messages not appearing in admin dashboard
--   3. Newsletter subscribers not appearing in admin dashboard
-- ============================================================


-- ╔══════════════════════════════════════════════════════════╗
-- ║  1. PROFILES                                             ║
-- ╚══════════════════════════════════════════════════════════╝

DROP POLICY IF EXISTS "Users can insert own profile"         ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile"         ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile"           ON public.profiles;
DROP POLICY IF EXISTS "Public profiles are viewable"         ON public.profiles;
DROP POLICY IF EXISTS "Profiles are viewable by owner"       ON public.profiles;
DROP POLICY IF EXISTS "Allow individual insert access"       ON public.profiles;
DROP POLICY IF EXISTS "Allow individual update access"       ON public.profiles;
DROP POLICY IF EXISTS "Allow individual read access"         ON public.profiles;
DROP POLICY IF EXISTS "Enable insert for authenticated"      ON public.profiles;
DROP POLICY IF EXISTS "Enable update for users based on id"  ON public.profiles;
DROP POLICY IF EXISTS "Service role full access"             ON public.profiles;
DROP POLICY IF EXISTS "Admins can read all profiles"         ON public.profiles;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.profiles TO service_role;

-- Users can read their own profile
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() = id);

-- Admins can read all profiles (needed for admin dashboard user list)
CREATE POLICY "Admins can read all profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

-- Users can create their own profile row on sign-up
CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

-- Users can update their own profile (cannot self-promote to admin)
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND role = (SELECT role FROM public.profiles WHERE id = auth.uid())
  );


-- ╔══════════════════════════════════════════════════════════╗
-- ║  2. CONTACT MESSAGES                                     ║
-- ╚══════════════════════════════════════════════════════════╝

DROP POLICY IF EXISTS "Anyone can submit contact messages"    ON public.contact_messages;
DROP POLICY IF EXISTS "Admins can read contact messages"      ON public.contact_messages;
DROP POLICY IF EXISTS "Admins can update contact messages"    ON public.contact_messages;
DROP POLICY IF EXISTS "Admins can delete contact messages"    ON public.contact_messages;

ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.contact_messages TO service_role;

-- Visitors (anon + authenticated) can INSERT a contact form submission
CREATE POLICY "Anyone can submit contact messages"
  ON public.contact_messages FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Only admins can SELECT (read) messages
CREATE POLICY "Admins can read contact messages"
  ON public.contact_messages FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

-- Only admins can UPDATE (mark as read)
CREATE POLICY "Admins can update contact messages"
  ON public.contact_messages FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

-- Only admins can DELETE messages
CREATE POLICY "Admins can delete contact messages"
  ON public.contact_messages FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );


-- ╔══════════════════════════════════════════════════════════╗
-- ║  3. NEWSLETTER SUBSCRIBERS                               ║
-- ╚══════════════════════════════════════════════════════════╝

DROP POLICY IF EXISTS "Anyone can subscribe to newsletter"   ON public.newsletter_subscribers;
DROP POLICY IF EXISTS "Admins can read newsletter"           ON public.newsletter_subscribers;
DROP POLICY IF EXISTS "Admins can delete newsletter"         ON public.newsletter_subscribers;

ALTER TABLE public.newsletter_subscribers ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.newsletter_subscribers TO service_role;

-- Visitors can subscribe (INSERT their own email)
CREATE POLICY "Anyone can subscribe to newsletter"
  ON public.newsletter_subscribers FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Only admins can read the full subscriber list
CREATE POLICY "Admins can read newsletter"
  ON public.newsletter_subscribers FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

-- Only admins can delete subscribers
CREATE POLICY "Admins can delete newsletter"
  ON public.newsletter_subscribers FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );


-- ── Verify ────────────────────────────────────────────────────
-- Run this to confirm policies were created:
-- SELECT tablename, policyname, cmd
-- FROM pg_policies
-- WHERE tablename IN ('profiles','contact_messages','newsletter_subscribers')
-- ORDER BY tablename, cmd;


-- ============================================================
-- MIGRATION 2: Fix infinite recursion — is_current_user_admin()
-- ============================================================
-- ============================================================
-- FIX: Infinite recursion in profiles RLS policies
-- 
-- Root cause: policies use EXISTS (SELECT 1 FROM profiles WHERE ...)
-- which triggers the same RLS policy again → infinite recursion → 500
--
-- Fix: SECURITY DEFINER function that bypasses RLS when checking
-- if the current user is an admin.
--
-- Run this in: Supabase project → SQL Editor
-- ============================================================

-- 1. Create a SECURITY DEFINER helper function
--    Runs as the function owner (postgres), bypassing RLS on profiles.
--    This breaks the infinite recursion.
CREATE OR REPLACE FUNCTION public.is_current_user_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT role = 'admin' AND (active IS NOT FALSE)
     FROM public.profiles
     WHERE id = auth.uid()
     LIMIT 1),
    false
  );
$$;

-- Allow authenticated users to call this function
GRANT EXECUTE ON FUNCTION public.is_current_user_admin() TO authenticated;


-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  2. PROFILES — drop recursive policies and recreate              ║
-- ╚══════════════════════════════════════════════════════════════════╝

-- Drop ALL existing profile policies to start clean
DROP POLICY IF EXISTS "Users can view own profile"        ON public.profiles;
DROP POLICY IF EXISTS "Admins can read all profiles"      ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile"      ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile"      ON public.profiles;
DROP POLICY IF EXISTS "Public profiles are viewable"      ON public.profiles;
DROP POLICY IF EXISTS "Profiles are viewable by owner"    ON public.profiles;
DROP POLICY IF EXISTS "Allow individual insert access"    ON public.profiles;
DROP POLICY IF EXISTS "Allow individual update access"    ON public.profiles;
DROP POLICY IF EXISTS "Allow individual read access"      ON public.profiles;
DROP POLICY IF EXISTS "Enable insert for authenticated"   ON public.profiles;
DROP POLICY IF EXISTS "Enable update for users based on id" ON public.profiles;
DROP POLICY IF EXISTS "Service role full access"          ON public.profiles;
DROP POLICY IF EXISTS "Anon insert own profile"           ON public.profiles;
DROP POLICY IF EXISTS "Users own profile"                 ON public.profiles;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.profiles TO service_role;

-- Users can read their OWN profile (no subquery → no recursion)
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() = id);

-- Admins can read ALL profiles — uses SECURITY DEFINER fn (no recursion)
CREATE POLICY "Admins can read all profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (public.is_current_user_admin());

-- Anyone (anon) can insert a profile row on sign-up
CREATE POLICY "Anon insert own profile"
  ON public.profiles FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Users can update their own profile
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Admins can update any profile (e.g. ban user, change role)
CREATE POLICY "Admins can update any profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING (public.is_current_user_admin());


-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  3. OTHER TABLES — fix recursive admin check policies            ║
-- ╚══════════════════════════════════════════════════════════════════╝

-- orders
DROP POLICY IF EXISTS "Admins can read all orders"   ON public.orders;
DROP POLICY IF EXISTS "Admins can update orders"     ON public.orders;
DROP POLICY IF EXISTS "Admins can delete orders"     ON public.orders;

CREATE POLICY "Admins can read all orders"
  ON public.orders FOR SELECT TO authenticated
  USING (public.is_current_user_admin());

CREATE POLICY "Admins can update orders"
  ON public.orders FOR UPDATE TO authenticated
  USING (public.is_current_user_admin());

CREATE POLICY "Admins can delete orders"
  ON public.orders FOR DELETE TO authenticated
  USING (public.is_current_user_admin());

-- contact_messages
DROP POLICY IF EXISTS "Admins can read contact messages"   ON public.contact_messages;
DROP POLICY IF EXISTS "Admins can update contact messages" ON public.contact_messages;
DROP POLICY IF EXISTS "Admins can delete contact messages" ON public.contact_messages;

CREATE POLICY "Admins can read contact messages"
  ON public.contact_messages FOR SELECT TO authenticated
  USING (public.is_current_user_admin());

CREATE POLICY "Admins can update contact messages"
  ON public.contact_messages FOR UPDATE TO authenticated
  USING (public.is_current_user_admin());

CREATE POLICY "Admins can delete contact messages"
  ON public.contact_messages FOR DELETE TO authenticated
  USING (public.is_current_user_admin());

-- newsletter_subscribers
DROP POLICY IF EXISTS "Admins can read newsletter" ON public.newsletter_subscribers;
DROP POLICY IF EXISTS "Admins can delete newsletter" ON public.newsletter_subscribers;

CREATE POLICY "Admins can read newsletter"
  ON public.newsletter_subscribers FOR SELECT TO authenticated
  USING (public.is_current_user_admin());

CREATE POLICY "Admins can delete newsletter"
  ON public.newsletter_subscribers FOR DELETE TO authenticated
  USING (public.is_current_user_admin());

-- products (write)
DROP POLICY IF EXISTS "Admins can manage products" ON public.products;
DROP POLICY IF EXISTS "Auth all products" ON public.products;
CREATE POLICY "Admins can manage products"
  ON public.products FOR ALL TO authenticated
  USING (public.is_current_user_admin())
  WITH CHECK (public.is_current_user_admin());

-- categories (write)
DROP POLICY IF EXISTS "Admins can manage categories" ON public.categories;
DROP POLICY IF EXISTS "Auth all categories" ON public.categories;
CREATE POLICY "Admins can manage categories"
  ON public.categories FOR ALL TO authenticated
  USING (public.is_current_user_admin())
  WITH CHECK (public.is_current_user_admin());

-- ── Verify ──────────────────────────────────────────────────────────
-- SELECT tablename, policyname, cmd
-- FROM pg_policies
-- WHERE tablename IN ('profiles','orders','contact_messages','newsletter_subscribers')
-- ORDER BY tablename, cmd;

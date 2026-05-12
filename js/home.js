/* ============================================================
   MANARIZE — HOME PAGE
   ============================================================ */
import { withLoader, hideLoader } from './loader.js';
import { injectLayout } from './layout.js';
import { getProducts, getCategories, getSiteSettings, saveNewsletterSubscriber } from './store-adapter.js';
import { getAllReviews, getAllReviewsFlat } from './reviews.js';
import { formatPrice } from './utils.js';
import { addToCart, toggleWishlist, isWishlisted } from './cart.js';
import { initQuickSearch } from './search.js';
import { injectSpeedInsights } from '@vercel/speed-insights';

injectSpeedInsights();
function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
import { productCardHTML, bindCardEvents, skeletonCardHTML } from './product-card.js';
import toast from './toast.js';
import { LS, SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

withLoader(async () => {
  await injectLayout({ activePage: 'Home' });

  // ── Reveal page immediately — skeletons show while data loads ─
  // FCP fires now, before any Supabase fetch.
  hideLoader();

  // Pre-fill grids with skeleton cards
  ['featured-products', 'new-arrivals'].forEach(id => {
    const g = document.getElementById(id);
    if (g && !g.children.length) g.innerHTML = Array(4).fill(0).map(() => skeletonCardHTML()).join('');
  });

  initQuickSearch(
    document.getElementById('hero-search-input'),
    document.getElementById('search-dropdown')
  );
  document.getElementById('hero-search-btn')?.addEventListener('click', () => {
    const q = document.getElementById('hero-search-input')?.value.trim();
    if (q) window.location.href = `search?q=${encodeURIComponent(q)}`;
  });

  // ── Fetch data in background ──────────────────────────────────
  const [_allProducts, _allCategories] = await Promise.all([
    getProducts(),
    getCategories(),
  ]);

  // ── Fill above-fold sections once data arrives ────────────────
  renderCategories(_allCategories);
  renderFeatured(_allProducts);
  initHeroRotation(_allProducts);

  // ── Defer below-fold until browser is idle ────────────────────
  const idle = window.requestIdleCallback
    ? cb => window.requestIdleCallback(cb, { timeout: 2000 })
    : cb => setTimeout(cb, 100);

  idle(() => {
    renderNewArrivals(_allProducts);
    initHeroParticles();
    initCountdown();
    renderHomepageReviews();
    initNewsletter();
  });
});

// ── Categories ────────────────────────────────────────────────
function renderCategories(cats) {
  const grid = document.getElementById('categories-grid');
  if (!grid) return;
  const active = (cats || []).filter(c => c.active !== false);
  grid.innerHTML = active.map(c => `
    <a href="shop.html?cat=${c.slug}" class="cat-card hover-lift">
      <i class="${c.icon}"></i>
      <span>${c.name}</span>
      <small>${c.subcategories?.length ? `${c.subcategories.length} subcategories` : 'View all'}</small>
    </a>`).join('');
}

// ── Featured Products ─────────────────────────────────────────
function renderFeatured(products) {
  const grid = document.getElementById('featured-products');
  if (!grid) return;
  const featured = (products || []).filter(p => p.featured && p.active !== false).slice(0, 4);
  grid.innerHTML = featured.map(p => { try { return productCardHTML(p); } catch { return ''; } }).join('');
  bindCardEvents(grid, products || [], addToCart, toggleWishlist);
}

// ── New Arrivals ──────────────────────────────────────────────
function renderNewArrivals(products) {
  const grid = document.getElementById('new-arrivals');
  if (!grid) return;
  const arrivals = (products || [])
    .filter(p => p.active !== false && p.badge !== 'Used')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 5);
  grid.innerHTML = arrivals.map(p => { try { return productCardHTML(p); } catch { return ''; } }).join('');
  bindCardEvents(grid, products || [], addToCart, toggleWishlist);
}

// ── Hero product rotation ─────────────────────────────────────
function initHeroRotation(products) {
  const active = (products || []).filter(p => p.active !== false && p.images?.length);
  if (!active.length) return;

  // Prefer featured products, but fall back to all active products with images
  const pool = active.filter(p => p.featured).length >= 2
    ? active.filter(p => p.featured)
    : active;

  let idx = 0;
  const imgEl = document.getElementById('hero-product-img');
  const nameEl = document.getElementById('hero-badge-name');
  const priceEl = document.getElementById('hero-badge-price');
  if (!imgEl) return;

  // ── Immediately show the first Supabase product ──
  const setProduct = (p) => {
    imgEl.src = p.images?.[0] || '';
    imgEl.alt = p.name || 'Product';
    imgEl.style.opacity = '1';
    if (nameEl) nameEl.textContent = p.name;
    if (priceEl) priceEl.textContent = formatPrice(p.price);
  };
  setProduct(pool[0]);

  // ── Don't rotate if only one product ──
  if (pool.length < 2) return;

  const update = () => {
    idx = (idx + 1) % pool.length;
    const p = pool[idx];

    // Fade out → swap src → fade in
    imgEl.style.opacity = '0';
    setTimeout(() => setProduct(p), 400);
  };

  setInterval(update, 5000);
}

// ── Countdown Timer ───────────────────────────────────────────
async function initCountdown() {
  // Load promo settings from Supabase (production) or localStorage (demo)
  let settings = {};
  try { settings = await getSiteSettings().catch(() => null) || {}; } catch {
    try { settings = JSON.parse(localStorage.getItem('zm_site_settings') || '{}'); } catch { }
  }
  const _g = (k, d) => { const v = settings[k]; if (v == null) return d; return (typeof v === 'object' && 'v' in v) ? v.v : v; };

  // Defaults
  const promoEnabled = _g('promoEnabled', true) !== false && _g('promoEnabled', true) !== 'false';
  const eyebrow = _g('promoEyebrow', 'Limited Time Offer');
  const title = _g('promoTitle', 'Mega Sale — Up to 30% Off');
  const desc = _g('promoDesc', "Don't miss out on our biggest sale of the season. Premium products at unbeatable prices.");
  const btnText = _g('promoBtnText', 'Shop the Sale');
  const btnUrl = _g('promoBtnUrl', '/shop');
  const endDateStr = _g('promoEndDate', '');

  // Update banner text content
  const sectionEl = document.getElementById('promo-section');
  if (!sectionEl) return;

  if (!promoEnabled) {
    sectionEl.style.display = 'none';
    return;
  }

  const eyebrowEl = document.getElementById('promo-eyebrow-text');
  const titleEl = document.getElementById('promo-title-text');
  const descEl = document.getElementById('promo-desc-text');
  const btnEl = document.getElementById('promo-btn-link');

  if (eyebrowEl) eyebrowEl.textContent = eyebrow;
  if (titleEl) titleEl.textContent = title;
  if (descEl) descEl.textContent = desc;
  if (btnEl) { btnEl.textContent = btnText; btnEl.href = btnUrl; }

  // Determine end time
  const TIMER_KEY = 'zm_promo_timer_end';
  let end;
  if (endDateStr) {
    end = new Date(endDateStr).getTime();
  } else {
    end = parseInt(sessionStorage.getItem(TIMER_KEY) || '0', 10);
    if (!end || end < Date.now()) {
      end = Date.now() + 24 * 60 * 60 * 1000;
      sessionStorage.setItem(TIMER_KEY, String(end));
    }
  }

  // Show formatted end date below the timer
  const endDateEl = document.getElementById('promo-end-date-display');
  if (endDateEl && end) {
    const endDate = new Date(end);
    const formatted = endDate.toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true
    });
    endDateEl.textContent = `Ends: ${formatted}`;
    endDateEl.style.display = '';
  }

  const tick = () => {
    const diff = Math.max(0, end - Date.now());
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    const pad = n => String(n).padStart(2, '0');
    const hEl = document.getElementById('timer-h');
    const mEl = document.getElementById('timer-m');
    const sEl = document.getElementById('timer-s');
    if (hEl) hEl.textContent = pad(h);
    if (mEl) mEl.textContent = pad(m);
    if (sEl) sEl.textContent = pad(s);
    // When timer hits zero, show "Sale Ended"
    if (diff === 0) {
      const timerWrap = document.getElementById('promo-timer-wrap');
      if (timerWrap) timerWrap.innerHTML = '<span style="color:var(--clr-text-3);font-size:.875rem">Sale has ended</span>';
      if (endDateEl) endDateEl.style.display = 'none';
    }
  };
  tick();
  const _timerId = setInterval(tick, 1000);
  // Clean up if the section is ever removed (e.g. SPA navigation)
  window.addEventListener('pagehide', () => clearInterval(_timerId), { once: true });
}

// ── Newsletter ────────────────────────────────────────────────
function initNewsletter() {
  const form = document.getElementById('newsletter-form');
  if (!form) return;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const email = (document.getElementById('newsletter-email').value || '').trim().toLowerCase();
    if (!email) return;

    try {
      await saveNewsletterSubscriber(email);
      toast.success('Subscribed!', email + ' added to our newsletter.');
    } catch (err) {
      if (err?.message === 'already_subscribed') {
        toast.info('Already subscribed', email + ' is already on our newsletter.');
      } else {
        // Fallback: localStorage demo/offline
        let subs = [];
        try { subs = JSON.parse(localStorage.getItem(LS.newsletterEmails) || '[]'); } catch { }
        if (!subs.find(s => s.email === email)) {
          subs.unshift({ email, subscribedAt: new Date().toISOString() });
          localStorage.setItem(LS.newsletterEmails, JSON.stringify(subs));
          toast.success('Subscribed!', email + ' added to our newsletter.');
        } else { toast.info('Already subscribed', email + ' is already on our newsletter.'); }
      }
    }
    form.reset();
  });
}

// ── Homepage Reviews ──────────────────────────────────────────
// ── Helpers shared by renderHomepageReviews ───────────────────
function _parseAdminReviewsValue(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'object' && Array.isArray(raw.v)) return raw.v;
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      if (Array.isArray(p)) return p;
      if (p && Array.isArray(p.v)) return p.v;
    } catch { /* ignore */ }
  }
  return [];
}

function _normaliseAdminReview(r) {
  return {
    id:       r.id       || '',
    source:   'admin',
    customer: r.customer || 'Anonymous',
    product:  r.product  || '',
    rating:   Number(r.rating) || 5,
    text:     r.text     || '',
    date:     r.date     || r.createdAt || new Date().toISOString(),
    verified: false,
    status:   'approved',
  };
}

async function renderHomepageReviews() {
  const section = document.getElementById('reviews-section');
  if (!section) return;

  // Keep hidden until we confirm there are reviews to show
  section.style.display = 'none';

  // Load all site settings once — reuse for homepage config + admin reviews
  let allSettings = {};
  try { allSettings = await getSiteSettings() || {}; } catch { }

  // ── Parse homepage reviews config ─────────────────────────────
  let cfg = {};
  try {
    const raw = allSettings['zm_homepage_reviews'];
    if (raw) cfg = (typeof raw === 'object' && !Array.isArray(raw) && 'v' in raw) ? raw.v : raw;
  } catch { }
  // Fallback to localStorage (same device)
  if (!cfg || !Object.keys(cfg).length) {
    try { cfg = JSON.parse(localStorage.getItem('zm_homepage_reviews') || '{}'); } catch { }
  }

  const enabled = cfg.enabled !== false && cfg.enabled !== 'false';
  if (!enabled) return;

  if (cfg.enabled === undefined) {
    try {
      const defaultCfg = { enabled: true, title: 'What Our Customers Say', subtitle: 'Real experiences from real shoppers', maxCount: 3, showCta: false };
      localStorage.setItem('zm_homepage_reviews', JSON.stringify(defaultCfg));
      Object.assign(cfg, defaultCfg);
    } catch { }
  }

  // Update heading / subtitle / CTA
  const titleEl    = document.getElementById('reviews-section-title');
  const subtitleEl = document.getElementById('reviews-section-subtitle');
  const ctaEl      = document.getElementById('reviews-section-cta');
  if (titleEl    && cfg.title)    titleEl.textContent = cfg.title;
  if (subtitleEl && cfg.subtitle) subtitleEl.textContent = cfg.subtitle;
  if (ctaEl && cfg.ctaText) {
    ctaEl.textContent = cfg.ctaText + ' ';
    ctaEl.insertAdjacentHTML('beforeend', '<i class="fa-solid fa-arrow-right"></i>');
  }
  if (ctaEl) ctaEl.style.display = cfg.showCta ? '' : 'none';

  // ── Resolve pinned IDs (admin panel saves as featuredIds or pinnedIds) ─
  const maxCount    = parseInt(cfg.maxCount, 10) || 3;
  const _pinnedArr  = cfg.pinnedIds || cfg.featuredIds;
  const featuredIds = (_pinnedArr && _pinnedArr.length) ? _pinnedArr : null;

  let allReviews = [];
  let loaded     = false;

  // ── TIER 1: /api/reviews serverless function (service-role key) ──
  try {
    const params = new URLSearchParams({ limit: String(maxCount * 3) });
    if (featuredIds && featuredIds.length) params.set('ids', featuredIds.join(','));

    // 6-second timeout — avoids hanging on cold-start / missing function
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const resp = await fetch('/api/reviews?' + params.toString(), { signal: ctrl.signal });
    clearTimeout(timer);

    if (resp.ok) {
      const json = await resp.json();
      if (Array.isArray(json.data) && json.data.length) {
        allReviews = json.data;
        loaded = true;
      }
      // API responded ok (even with 0 results) — skip TIER 2 to avoid duplicate fetch
    } else {
      console.warn('[reviews] /api/reviews ->', resp.status, '— trying Supabase REST');
    }
  } catch (e) {
    if (e.name !== 'AbortError') console.warn('[reviews] /api/reviews failed:', e.message);
  }

  // ── TIER 2: direct Supabase REST (anon key, public RLS allows reads) ──
  const _sbReady = SUPABASE_URL && !SUPABASE_URL.includes('YOUR_PROJECT') &&
                   SUPABASE_ANON_KEY && SUPABASE_ANON_KEY.length > 20;
  if (!loaded && _sbReady) {
    try {
      const headers = {
        apikey:        SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      };

      // 1. Admin-curated reviews from site_settings
      const settingResp = await fetch(
        `${SUPABASE_URL}/rest/v1/site_settings?key=eq.zm_admin_reviews&select=value`,
        { headers }
      );
      if (settingResp.ok) {
        const rows = await settingResp.json();
        if (rows && rows[0] && rows[0].value != null) {
          const arr = _parseAdminReviewsValue(rows[0].value);
          arr
            .filter(r => r && r.id && (!r.status || r.status === 'approved'))
            .filter(r => !featuredIds || featuredIds.includes(r.id))
            .forEach(r => allReviews.push(_normaliseAdminReview(r)));
        }
      }

      // 2. Product reviews (only fetch if not exclusively requesting admin IDs)
      const wantsAdminOnly = featuredIds && featuredIds.every(id => id.startsWith('REV-'));
      if (!wantsAdminOnly) {
        const revResp = await fetch(
          `${SUPABASE_URL}/rest/v1/reviews?approved=eq.true&rejected=eq.false` +
          `&select=id,user_name,product_id,rating,body,created_at,verified` +
          `&order=created_at.desc&limit=${maxCount * 3}`,
          { headers }
        );
        if (revResp.ok) {
          const revRows = await revResp.json();
          (revRows || []).forEach(r => {
            allReviews.push({
              id:       r.id,
              source:   'product',
              customer: r.user_name  || 'Anonymous',
              product:  r.product_id || '',
              rating:   Number(r.rating) || 5,
              text:     r.body       || '',
              date:     r.created_at,
              verified: !!r.verified,
              status:   'approved',
            });
          });
        }
      }

      if (allReviews.length) {
        allReviews.sort((a, b) => new Date(b.date) - new Date(a.date));
        loaded = true;
      }
    } catch (e) {
      console.warn('[reviews] Supabase REST failed:', e.message);
    }
  }

  // ── TIER 3: supabase-js + localStorage (last resort) ────────────
  if (!loaded) {
    // a) Admin reviews from getSiteSettings() result (already loaded above)
    const adminFromSettings = _parseAdminReviewsValue(allSettings['zm_admin_reviews']);
    if (adminFromSettings.length) {
      adminFromSettings
        .filter(r => r && r.id && (!r.status || r.status === 'approved'))
        .forEach(r => allReviews.push(_normaliseAdminReview(r)));
    }

    // b) Admin reviews from localStorage (same-device fallback)
    if (!allReviews.length) {
      try {
        const lsArr = JSON.parse(localStorage.getItem('zm_admin_reviews') || '[]');
        (Array.isArray(lsArr) ? lsArr : [])
          .filter(r => r && r.id && (!r.status || r.status === 'approved'))
          .forEach(r => allReviews.push(_normaliseAdminReview(r)));
      } catch { }
    }

    // c) Product reviews via supabase-js
    try {
      const flatReviews = await getAllReviewsFlat({ approvedOnly: true });
      let productLookup = {};
      try {
        const prods = await getProducts();
        prods.forEach(p => { productLookup[p.id] = p.name; });
      } catch { }
      flatReviews.forEach(r => {
        const isApproved = r.approved === true || r.approved === 1 || r.approved === 't';
        const isRejected = r.rejected === true  || r.rejected === 1  || r.rejected === 't';
        if (isApproved && !isRejected) {
          allReviews.push({
            id:       r.id,
            source:   'product',
            customer: r.userName || r.user_name || 'Anonymous',
            product:  productLookup[r.productId || r.product_id] || r.productId || '',
            rating:   Number(r.rating) || 5,
            text:     r.text || r.body || '',
            date:     r.createdAt || r.created_at,
            verified: !!r.verified,
            status:   'approved',
          });
        }
      });
    } catch (e) {
      console.warn('[reviews] supabase-js fallback failed:', e);
    }

    allReviews.sort((a, b) => new Date(b.date) - new Date(a.date));
  }

  // ── Filter to pinned reviews (or show all if none are pinned) ───
  let approved = allReviews.filter(r => !r.status || r.status === 'approved');

  if (featuredIds && featuredIds.length) {
    const pinned = approved.filter(r => featuredIds.includes(r.id));
    // Only narrow down if we actually found some of the pinned ones
    if (pinned.length) approved = pinned;
  }

  approved = approved.slice(0, maxCount);

  if (!approved.length) { section.style.display = 'none'; return; }

  // ── Render ───────────────────────────────────────────────────────
  function starsHtml(n) {
    return Array.from({ length: 5 }, (_, i) =>
      `<i class="fa-${i < n ? 'solid' : 'regular'} fa-star"></i>`
    ).join('');
  }

  function avatarLetter(name) {
    return (name || '?').trim()[0].toUpperCase();
  }

  function formatDate(d) {
    try {
      return new Date(d).toLocaleDateString('en-LK', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch { return d || ''; }
  }

  const grid = document.getElementById('homepage-reviews-grid');
  if (!grid) return;

  grid.innerHTML = approved.map(r => `
    <div class="review-card reveal">
      <div class="review-card__stars">${starsHtml(r.rating)}</div>
      <p class="review-card__text">${esc(r.text)}</p>
      <div class="review-card__footer">
        <div class="review-card__avatar">${avatarLetter(r.customer)}</div>
        <div>
          <div class="review-card__author">${esc(r.customer)}</div>
          <div class="review-card__product">${esc(r.product)}</div>
        </div>
        <span class="review-card__date">${formatDate(r.date)}</span>
      </div>
    </div>`).join('');

  section.style.display = '';

  // ── Re-observe dynamically injected .reveal cards ─────────────
  // initScrollReveal() in loader.js runs once at page-load (static querySelectorAll),
  // so cards added later are never observed and stay opacity:0.
  // Fix: set up a fresh IntersectionObserver for the new cards.
  const newCards = grid.querySelectorAll('.reveal:not(.revealed)');
  if (newCards.length) {
    if ('IntersectionObserver' in window) {
      const revealObs = new IntersectionObserver((entries, obs) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('revealed');
            obs.unobserve(entry.target);
          }
        });
      }, { threshold: 0.08, rootMargin: '0px 0px -30px 0px' });
      newCards.forEach(el => revealObs.observe(el));
    } else {
      // Fallback for browsers without IntersectionObserver
      newCards.forEach(el => el.classList.add('revealed'));
    }
  }
}

// ── Hero Particle Animation ─────────────────────────────────────
async function initHeroParticles() {
  const isMobile = window.matchMedia('(max-width: 768px)').matches;
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── 2. Canvas particle field ──────────────────────────────────
  const canvas = document.getElementById('particle-canvas');
  if (!canvas) return;

  // Continuous rAF loop — skip on mobile to free CPU/GPU for LCP/FID
  if (isMobile || prefersReduced) {
    canvas.style.display = 'none';
    return;
  }

  const hero = canvas.closest('.hero');
  const resize = () => { canvas.width = hero.offsetWidth; canvas.height = hero.offsetHeight; };
  resize();
  window.addEventListener('resize', resize, { passive: true });

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const COLORS = [
    'rgba(201,168,76,',
    'rgba(226,192,110,',
    'rgba(160,122,48,',
    'rgba(255,255,255,',
  ];

  // Scale particle count to device capability
  const particleCount = (navigator.hardwareConcurrency ?? 4) >= 4 ? 90 : 40;

  const particles = Array.from({ length: particleCount }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    radius: 0.5 + Math.random() * 1.8,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    vx: (Math.random() - 0.5) * 0.3,
    vy: -0.08 - Math.random() * 0.35,
    alpha: 0,
    maxAlpha: 0.1 + Math.random() * 0.22,
    fadeIn: true,
    life: 0,
    maxLife: 200 + Math.random() * 320,
    delay: Math.random() * 180,
  }));

  let frame = 0;
  const draw = () => {
    frame++;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
      if (frame < p.delay) return;
      p.life++;
      if (p.fadeIn) {
        p.alpha = Math.min(p.alpha + 0.007, p.maxAlpha);
        if (p.alpha >= p.maxAlpha) p.fadeIn = false;
      } else {
        p.alpha -= 0.004;
      }
      if (p.alpha <= 0 || p.life > p.maxLife) {
        p.x = Math.random() * canvas.width;
        p.y = canvas.height + 5;
        p.alpha = 0; p.fadeIn = true; p.life = 0;
        p.maxLife = 200 + Math.random() * 320;
      }
      p.x += p.vx; p.y += p.vy;
      if (p.x < -5) p.x = canvas.width + 5;
      if (p.x > canvas.width + 5) p.x = -5;
      if (p.alpha <= 0) return;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = p.color + p.alpha.toFixed(3) + ')';
      ctx.fill();
    });
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}
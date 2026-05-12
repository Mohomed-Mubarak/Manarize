/* ============================================================
   ZENMARKET — POSTHOG ANALYTICS  (v29 — Full Stack)
   ============================================================
   Wraps PostHog product analytics with Manarize-specific events.
   Gracefully degrades when PostHog is not configured.

   SETUP:
     1. Sign up at https://posthog.com
     2. Create a project → copy the API key
     3. Set POSTHOG_KEY=phc_xxxxx in .env → run node build.js
     4. Import this module on any page that needs tracking

   USAGE:
     import analytics from './analytics.js';

     analytics.pageView();
     analytics.productViewed(product);
     analytics.addedToCart(product, qty);
     analytics.checkout.started(cart);
     analytics.checkout.completed(order);

   PRIVACY:
     - IP addresses are masked by default (PostHog setting)
     - No PII is sent in event properties (emails/phones excluded)
     - Users are identified by anonymous ID until they log in
   ============================================================ */

import { POSTHOG_KEY, POSTHOG_HOST, STORE } from './config.js';

// ── Initialise PostHog ────────────────────────────────────────────

let _ph = null;
let _ready = false;

function init() {
  if (_ready) return;
  _ready = true;

  if (!POSTHOG_KEY) return; // Analytics disabled — no key configured

  if (typeof window === 'undefined') return;

  // PostHog snippet initialisation (loaded via CDN in HTML)
  if (!window.posthog) {
    console.warn('[Analytics] PostHog not loaded — add the script tag to your HTML');
    return;
  }

  window.posthog.init(POSTHOG_KEY, {
    api_host:             POSTHOG_HOST || 'https://app.posthog.com',
    capture_pageview:     false,  // We call pageView() manually for SPAs
    capture_pageleave:    true,
    autocapture:          false,  // Explicit events only — avoid noise
    disable_session_recording: false,
    mask_all_text:        false,
    mask_all_element_attributes: false,
    persistence:          'localStorage+cookie',
    loaded: (ph) => {
      _ph = ph;
    },
  });
}

// ── Safe capture helper ───────────────────────────────────────────

function capture(event, props = {}) {
  if (!_ph) return;
  try {
    _ph.capture(event, {
      store:    STORE.name,
      currency: STORE.currency,
      ...props,
    });
  } catch (err) {
    console.warn('[Analytics] capture error:', err.message);
  }
}

// ── Public API ────────────────────────────────────────────────────

const analytics = {

  // ── Page ─────────────────────────────────────────────────────────

  /** Call on every page load / SPA navigation */
  pageView(overrides = {}) {
    init();
    if (!_ph) return;
    _ph.capture('$pageview', {
      $current_url: window.location.href,
      page_title:   document.title,
      ...overrides,
    });
  },

  // ── Identity ──────────────────────────────────────────────────────

  /**
   * Identify a logged-in user.
   * Only sends non-PII: role and join date.
   * @param {{ id: string, role: string, createdAt: string }} user
   */
  identify(user) {
    init();
    if (!_ph || !user?.id) return;
    _ph.identify(user.id, {
      role:       user.role || 'customer',
      created_at: user.createdAt,
    });
  },

  /** Reset identity on logout */
  reset() {
    if (_ph) _ph.reset();
  },

  // ── Products ──────────────────────────────────────────────────────

  /**
   * @param {object} product
   */
  productViewed(product) {
    capture('product_viewed', {
      product_id:   product.id,
      product_name: product.name,
      category:     product.category,
      price:        product.price,
    });
  },

  /**
   * @param {object} product
   * @param {number} qty
   * @param {string} [variant]
   */
  addedToCart(product, qty = 1, variant = null) {
    capture('added_to_cart', {
      product_id:   product.id,
      product_name: product.name,
      category:     product.category,
      price:        product.price,
      qty,
      variant,
    });
  },

  /**
   * @param {object} product
   */
  removedFromCart(product) {
    capture('removed_from_cart', {
      product_id:   product.id,
      product_name: product.name,
      price:        product.price,
    });
  },

  /**
   * @param {object} product
   * @param {boolean} added
   */
  wishlistToggled(product, added) {
    capture(added ? 'added_to_wishlist' : 'removed_from_wishlist', {
      product_id:   product.id,
      product_name: product.name,
      price:        product.price,
    });
  },

  /**
   * @param {string} term
   * @param {number} resultCount
   */
  searched(term, resultCount) {
    capture('searched', { term, result_count: resultCount });
  },

  // ── Checkout funnel ───────────────────────────────────────────────

  checkout: {
    /**
     * @param {{ items: object[], subtotal: number }} cart
     */
    started(cart) {
      capture('checkout_started', {
        item_count: (cart.items || []).length,
        subtotal:   cart.subtotal,
      });
    },

    /**
     * @param {string} step  e.g. 'shipping', 'payment'
     */
    stepCompleted(step) {
      capture('checkout_step_completed', { step });
    },

    /**
     * @param {string} method  e.g. 'payhere', 'cod', 'bank'
     */
    paymentMethodSelected(method) {
      capture('payment_method_selected', { method });
    },

    /**
     * @param {object} order
     */
    completed(order) {
      capture('order_placed', {
        order_id:      order.id,
        total:         order.total,
        item_count:    (order.items || []).length,
        payment_method: order.payment_method,
        has_coupon:    !!order.coupon,
        discount:      order.discount || 0,
        shipping:      order.shipping || 0,
      });
    },
  },

  // ── Reviews ───────────────────────────────────────────────────────

  /**
   * @param {object} review
   */
  reviewSubmitted(review) {
    capture('review_submitted', {
      product_id: review.product_id,
      rating:     review.rating,
    });
  },

  // ── Blog ─────────────────────────────────────────────────────────

  /**
   * @param {string} postTitle
   * @param {string} postSlug
   */
  blogPostViewed(postTitle, postSlug) {
    capture('blog_post_viewed', { post_title: postTitle, post_slug: postSlug });
  },

  // ── Engagement ───────────────────────────────────────────────────

  /** @param {string} section e.g. 'hero', 'featured', 'newsletter' */
  ctaClicked(section) {
    capture('cta_clicked', { section });
  },

  /** @param {'whatsapp'|'email'|'phone'} method */
  contactInitiated(method) {
    capture('contact_initiated', { method });
  },

  /** Newsletter signup */
  newsletterSignup() {
    capture('newsletter_signup');
  },

  // ── Errors ───────────────────────────────────────────────────────

  /**
   * @param {string} context  e.g. 'checkout', 'payment', 'auth'
   * @param {string} message  Error message (no PII)
   */
  errorOccurred(context, message) {
    capture('error_occurred', { context, error_message: message });
  },

};

// Auto-init on module load
init();

export default analytics;

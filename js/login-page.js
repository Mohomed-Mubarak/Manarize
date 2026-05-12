/* ============================================================
   ZENMARKET — LOGIN PAGE  (v30 — production email+password+OTP)

   DEMO_MODE = true
     Classic email/password forms (localStorage, no Supabase needed)

   DEMO_MODE = false  ← production
     Sign In:        email + password → validate → OTP → session
     Create Account: name + email + password → signUp → OTP → session
     A user CANNOT sign in without a verified account.
   ============================================================ */
import { withLoader }              from './loader.js';
import { isLoggedIn, initSupabaseListeners, setSession,
         login, register, registerDevice,
         signUpWithPassword, validateAndSendLoginOtp, signInWithGoogle } from './auth.js';
import { getSupabase } from './supabase.js';
import { initPhoneInput, getPhoneValue }            from './phone-input.js';
import toast                                        from './toast.js';
import { DEMO_MODE }                                from './config.js';
import { safeRedirectPath }                         from './security-utils.js';
import { initCaptcha, getWidgetToken, resetWidget } from './recaptcha.js';

// ── hCaptcha widget IDs (set in withLoader after DOM is ready) ─
let _hcapLoginId    = null;
let _hcapRegisterId = null;

// ── Return URL ────────────────────────────────────────────────
function getReturnUrl() {
  try {
    const param = new URLSearchParams(window.location.search).get('next');
    if (param) { const s = safeRedirectPath(param); if (s) return s; }
    const stored = sessionStorage.getItem('zm_return_url');
    if (stored) {
      sessionStorage.removeItem('zm_return_url');
      const s = safeRedirectPath(stored);
      if (s) return s;
    }
  } catch { /* ignore */ }
  return '/profile';
}

// ── Boot ──────────────────────────────────────────────────────
withLoader(async () => {
  initSupabaseListeners();

  // ── Handle email confirmation / magic-link callback ──────────
  // When a user clicks the confirmation link in their inbox, Supabase
  // redirects them back to login.html with the session token in the URL
  // hash (#access_token=...). detectSessionInUrl:true in supabase.js
  // processes it automatically; we just need to wait and redirect.
  // Detect email confirmation / magic-link callback.
  // Supabase may put the token in the URL hash (#access_token=...)
  // or as query params (?token_hash=...&type=signup) depending on config.
  const hash   = window.location.hash;
  const search = window.location.search;
  const isCallback = !DEMO_MODE && (
    hash.includes('access_token')    ||
    hash.includes('type=signup')     ||
    hash.includes('type=recovery')   ||
    hash.includes('type=magiclink')  ||
    hash.includes('type=email')      ||
    search.includes('token_hash')    ||
    search.includes('type=signup')   ||
    search.includes('type=recovery') ||
    search.includes('type=magiclink')||
    search.includes('type=email')    ||
    search.includes('confirmation_token') ||
    // PKCE flow: Supabase JS v2 redirects back with ?code= (auth code exchange).
    // Without this, users who click a magic link land on the login form instead
    // of the callback handler and are never redirected to the dashboard.
    (search.includes('code=') && !search.includes('discount_code=') && !search.includes('promo_code='))
  );
  if (isCallback) {
    _showEmailLinkCallback();
    return;
  }

  if (isLoggedIn()) { window.location.href = getReturnUrl(); return; }

  // ── Init hCaptcha widgets ─────────────────────────────────
  [_hcapLoginId, _hcapRegisterId] = await Promise.all([
    initCaptcha('hcap-login'),
    initCaptcha('hcap-register'),
  ]);

  if (DEMO_MODE) {
    initTabs();
    initPasswordToggle();
    initDemoLoginForm();
    initDemoRegisterForm();
  } else {
    initProductionFlow();
  }
});

// ── Email link callback screen ────────────────────────────────
async function _showEmailLinkCallback() {
  // Hide the normal login UI and show a confirming screen
  const root = document.getElementById('auth-form-panel') || document.querySelector('.auth-card') || document.querySelector('.auth-wrap') || document.body;
  const box = document.createElement('div');
  box.style.cssText = 'text-align:center;padding:2rem 1rem';
  box.innerHTML = `
    <div style="font-size:2.5rem;margin-bottom:1rem">
      <i class="fa-solid fa-circle-notch fa-spin" style="color:var(--clr-gold)"></i>
    </div>
    <div style="font-size:1.125rem;font-weight:600;margin-bottom:.5rem" id="ecb-title">Signing you in…</div>
    <div style="font-size:.875rem;color:var(--clr-text-3)" id="ecb-sub">Verifying your link, please wait.</div>
  `;

  // Hide all form content — tabs + both forms
  document.querySelectorAll(
    '.tabs, #tab-login-btn, #tab-register-btn, #form-login, #form-register'
  ).forEach(el => { el.style.display = 'none'; });
  root.appendChild(box);

  const sb = getSupabase();
  if (!sb) {
    document.getElementById('ecb-title').textContent = 'Configuration error';
    document.getElementById('ecb-sub').textContent = 'Supabase is not initialised. Check your setup.';
    return;
  }

  // ── PKCE code exchange (BUG FIX) ─────────────────────────────────────
  // detectSessionInUrl:true handles URL hash tokens (#access_token=...) but
  // may NOT auto-exchange the PKCE ?code= query parameter in all environments.
  // Explicitly calling exchangeCodeForSession() when a ?code= is present
  // ensures the exchange always completes, fixing the stuck spinner bug.
  const _codeParam = new URLSearchParams(window.location.search).get('code');
  if (_codeParam) {
    try {
      await sb.auth.exchangeCodeForSession(_codeParam);
    } catch (exchangeErr) {
      // If exchange fails (code already used, expired) fall through to polling.
      console.warn('[Auth] PKCE code exchange failed:', exchangeErr.message);
    }
    // Clean the code from the URL so it cannot be replayed on refresh.
    try {
      window.history.replaceState({}, '', window.location.pathname + window.location.hash);
    } catch (_) {}
  }

  // Poll up to 15 s (75 x 200 ms) — increased from 10 s for slow connections.
  let session = null;
  for (let i = 0; i < 75; i++) {
    try {
      const { data } = await sb.auth.getSession();
      if (data?.session?.user) { session = data.session; break; }
    } catch (_) { /* keep polling */ }
    await new Promise(r => setTimeout(r, 200));
  }

  if (session?.user) {
    const sbUser = session.user;

    // Resolve real role from the profiles table so admin users
    // who arrive via a magic-link are not stuck with 'customer'.
    let resolvedRole = 'customer';
    let resolvedName = sbUser.user_metadata?.name || sbUser.email?.split('@')[0] || 'Customer';
    try {
      const { data: profile } = await sb
        .from('profiles')
        .select('role, name, active')
        .eq('id', sbUser.id)
        .single();
      if (profile?.role) resolvedRole = profile.role;
      if (profile?.name) resolvedName = profile.name;
      // Mint an admin session in sessionStorage so admin pages are accessible
      if (resolvedRole === 'admin' && profile?.active !== false) {
        sessionStorage.setItem('zm_admin_session', JSON.stringify({
          email:      sbUser.email,
          role:       'admin',
          name:       resolvedName,
          supabaseId: sbUser.id,
          loginAt:    Date.now(),
        }));
      }
    } catch (_) { /* keep defaults on network error */ }

    setSession({
      id:        sbUser.id,
      name:      resolvedName,
      email:     sbUser.email,
      phone:     sbUser.user_metadata?.phone || '',
      role:      resolvedRole,
      createdAt: sbUser.created_at,
      _supabase: true,
    });
    // Trust this browser going forward — no magic link needed next login
    registerDevice(sbUser.id);

    const titleEl = document.getElementById('ecb-title');
    const subEl   = document.getElementById('ecb-sub');
    const iconEl  = box.querySelector('i');
    if (titleEl) titleEl.textContent = 'Signed in successfully!';
    if (subEl)   subEl.textContent   = 'Redirecting you now…';
    if (iconEl)  { iconEl.className = 'fa-solid fa-circle-check'; iconEl.style.color = 'var(--clr-success, #22c55e)'; }

    sessionStorage.setItem('zm_just_logged_in', '1');
    setTimeout(() => {
      // Clean the token from the URL before redirecting
      try { window.history.replaceState({}, '', window.location.pathname); } catch (_) {}
      window.location.href = getReturnUrl();
    }, 900);
  } else {
    const titleEl = document.getElementById('ecb-title');
    const subEl   = document.getElementById('ecb-sub');
    const iconEl  = box.querySelector('i');
    if (titleEl) titleEl.textContent = 'Link expired or already used';
    if (subEl)   subEl.innerHTML = 'This sign-in link has expired or was already used.<br><a href="/login" style="color:var(--clr-gold)">← Go back to sign in</a> and request a new one.';
    if (iconEl)  { iconEl.className = 'fa-solid fa-circle-xmark'; iconEl.style.color = 'var(--clr-error, #ef4444)'; }
  }
}

// ── New-device magic-link pending screen ──────────────────────
function _showMagicLinkPending(email) {
  const root = document.getElementById('auth-form-panel') || document.querySelector('.auth-card') || document.querySelector('.auth-wrap') || document.body;

  // Hide all form content
  document.querySelectorAll(
    '.tabs, #tab-login-btn, #tab-register-btn, #form-login, #form-register'
  ).forEach(el => { el.style.display = 'none'; });

  const box = document.createElement('div');
  box.id = 'magic-link-pending';
  box.style.cssText = 'text-align:center;padding:2rem 1rem';
  box.innerHTML = `
    <div style="font-size:2.5rem;margin-bottom:1rem">
      <i class="fa-solid fa-envelope-open-text" style="color:var(--clr-gold)"></i>
    </div>
    <div style="font-size:1.125rem;font-weight:600;margin-bottom:.5rem">
      Verify this device
    </div>
    <div style="font-size:.875rem;color:var(--clr-text-3);margin-bottom:1.25rem">
      We sent a verification link to <strong>${email}</strong>.<br>
      Click the link in your email to confirm this device and sign in.
    </div>
    <div style="font-size:.8125rem;color:var(--clr-text-3);margin-bottom:1rem">
      You only need to do this once per device.
    </div>
    <button id="ml-resend-btn" class="btn btn--outline" style="margin-bottom:.75rem;width:100%">
      Resend verification link
    </button>
    <div>
      <a href="/login" style="font-size:.8125rem;color:var(--clr-gold)">
        ← Back to sign in
      </a>
    </div>
  `;
  root.appendChild(box);

  let resendCooldown = false;
  document.getElementById('ml-resend-btn')?.addEventListener('click', async () => {
    if (resendCooldown) return;
    resendCooldown = true;
    const rb = document.getElementById('ml-resend-btn');
    if (rb) { rb.disabled = true; rb.textContent = 'Sending…'; }
    const sb = getSupabase();
    if (sb) {
      await sb.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: `${window.location.origin}/login`,
        },
      }).catch(() => {});
    }
    toast.info('Link resent', `A new verification link was sent to ${email}`);
    setTimeout(() => {
      resendCooldown = false;
      if (rb) { rb.disabled = false; rb.textContent = 'Resend verification link'; }
    }, 30000);
  });
}



function initProductionFlow() {
  // Inject the full production UI into the page containers
  _initProductionTabs();
  _initPasswordToggles();
  _initSignInFlow();
  _initRegisterFlow();
  _initGoogleAuth();
}

// ── Tab switcher ──────────────────────────────────────────────
function _initProductionTabs() {
  const loginTab = document.getElementById('tab-login-btn');
  const regTab   = document.getElementById('tab-register-btn');
  const loginBox = document.getElementById('form-login');
  const regBox   = document.getElementById('form-register');

  const showSignIn = () => {
    if (loginBox) loginBox.style.display = '';
    if (regBox)   regBox.style.display   = 'none';
    loginTab?.classList.add('active');
    regTab?.classList.remove('active');
  };
  const showRegister = () => {
    if (loginBox) loginBox.style.display = 'none';
    if (regBox)   regBox.style.display   = '';
    regTab?.classList.add('active');
    loginTab?.classList.remove('active');
  };

  loginTab?.addEventListener('click', showSignIn);
  regTab?.addEventListener('click', showRegister);

  // Cross-links inside each panel
  document.addEventListener('click', e => {
    if (e.target.closest('#prod-go-register')) { e.preventDefault(); showRegister(); }
    if (e.target.closest('#prod-go-login'))    { e.preventDefault(); showSignIn();  }
  });
}

// ── Password toggle (data-toggle-pw attribute) ────────────────
function _initPasswordToggles() {
  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-toggle-pw]');
    if (!btn) return;
    const input = document.getElementById(btn.dataset.togglePw);
    if (!input) return;
    const hidden = input.type === 'password';
    input.type = hidden ? 'text' : 'password';
    const icon = btn.querySelector('i');
    if (icon) icon.className = hidden ? 'fa-regular fa-eye-slash' : 'fa-regular fa-eye';
  });
}

// ── Sign In flow ──────────────────────────────────────────────
let _loginEmail = '';
let _loginTimerHandle = null;

// ── Sign In flow — email + password ──────────────────────────
function _initSignInFlow() {
  const doSignIn = async () => {
    const email    = document.getElementById('pli-email')?.value.trim();
    const password = document.getElementById('pli-password')?.value;
    const errEl    = document.getElementById('pli-err-1');
    const errMsg   = document.getElementById('pli-err-1-msg');
    const btn      = document.getElementById('pli-btn');
    if (!errEl || !btn) return;

    errEl.style.display = 'none';
    if (!email)    { _showErr(errEl, errMsg, 'Please enter your email address.'); return; }
    if (!password) { _showErr(errEl, errMsg, 'Please enter your password.'); return; }

    // ── hCaptcha check ───────────────────────────────────────
    const captchaToken = getWidgetToken(_hcapLoginId);
    // Allow through if captcha widget failed to load (hcapLoginId === null)
    if (_hcapLoginId !== null && !captchaToken) {
      _showErr(errEl, errMsg, 'Please complete the captcha check.');
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Verifying…';

    try {
      // Validate credentials → send magic link (never direct password login)
      const result = await validateAndSendLoginOtp(email, password);

      if (!result.success) {
        const msg = result.error || 'Sign in failed. Please try again.';
        _showErr(errEl, errMsg, msg);

        // If the email isn't confirmed yet, show a helpful tip below the error
        if (result.resent) {
          const tip = document.createElement('div');
          tip.style.cssText = 'margin-top:.5rem;font-size:.8125rem;color:var(--clr-text-3)';
          tip.innerHTML = '<i class="fa-solid fa-envelope" style="color:var(--clr-gold);margin-right:.3rem"></i>Check your spam folder if you don\'t see it.';
          errEl.parentNode?.insertBefore(tip, errEl.nextSibling);
          setTimeout(() => tip.remove(), 8000);
        }

        resetWidget(_hcapLoginId);
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send Sign-In Link';
        return;
      }

      // Credentials valid — magic link sent — show "check your inbox" screen
      _showMagicLinkSent(email);

    } catch (err) {
      // Safety net: ensure button is always re-enabled on any unexpected error
      console.error('[Auth] doSignIn unexpected error:', err);
      _showErr(errEl, errMsg, 'An unexpected error occurred. Please try again.');
      resetWidget(_hcapLoginId);
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send Sign-In Link';
    }
  };

  document.getElementById('pli-btn')?.addEventListener('click', doSignIn);
  document.getElementById('pli-email')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('pli-password')?.focus();
  });
  document.getElementById('pli-password')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') doSignIn();
  });
}

// ── Magic-link sent confirmation screen ───────────────────────
function _showMagicLinkSent(email) {
  const root = document.getElementById('auth-form-panel') || document.querySelector('.auth-card') || document.querySelector('.auth-wrap') || document.body;

  document.querySelectorAll(
    '.tabs, #tab-login-btn, #tab-register-btn, #form-login, #form-register'
  ).forEach(el => { el.style.display = 'none'; });

  // Detect likely email provider for the "Open inbox" shortcut
  const domain = (email.split('@')[1] || '').toLowerCase();
  const inboxUrl =
    domain.includes('gmail')     ? 'https://mail.google.com' :
    domain.includes('yahoo')     ? 'https://mail.yahoo.com'  :
    domain.includes('outlook') ||
    domain.includes('hotmail') ||
    domain.includes('live')      ? 'https://outlook.live.com' :
    domain.includes('proton')    ? 'https://mail.proton.me'   :
    domain.includes('icloud')    ? 'https://www.icloud.com/mail' : null;

  const box = document.createElement('div');
  box.id = 'magic-link-sent';
  box.innerHTML = `
    <div class="mls-icon-wrap">
      <div class="mls-icon-ring mls-ring-1"></div>
      <div class="mls-icon-ring mls-ring-2"></div>
      <div class="mls-icon-core">
        <i class="fa-solid fa-envelope-open-text"></i>
      </div>
    </div>

    <h2 class="mls-title">Check your email</h2>
    <p class="mls-sub">We sent a magic sign-in link to</p>
    <div class="mls-email">${email}</div>

    <div class="mls-steps">
      <div class="mls-step">
        <div class="mls-step-num">1</div>
        <div class="mls-step-text">Open the email from <strong>Manarize</strong></div>
      </div>
      <div class="mls-step">
        <div class="mls-step-num">2</div>
        <div class="mls-step-text">Click <strong>Sign in to Manarize</strong></div>
      </div>
      <div class="mls-step">
        <div class="mls-step-num">3</div>
        <div class="mls-step-text">You'll be logged in automatically</div>
      </div>
    </div>

    ${inboxUrl ? `
    <a href="${inboxUrl}" target="_blank" rel="noopener" class="btn btn-primary btn-block mls-open-btn">
      <i class="fa-solid fa-inbox"></i> Open my inbox
    </a>` : ''}

    <div class="mls-resend-wrap">
      <span class="mls-resend-label">Didn't receive it?</span>
      <button id="mls-resend-btn" class="mls-resend-btn" disabled>
        Resend link
        <span id="mls-countdown" class="mls-countdown">(60s)</span>
      </button>
    </div>

    <p class="mls-spam-note">
      <i class="fa-solid fa-triangle-exclamation" style="color:var(--clr-gold);font-size:.75rem"></i>
      Check your <strong>spam or junk folder</strong> if you don't see it.
      The link expires in <strong>60 minutes</strong>.
    </p>

    <div class="mls-footer">
      <a href="/login" class="mls-back-link">
        <i class="fa-solid fa-arrow-left" style="font-size:.7rem"></i> Use a different email
      </a>
    </div>
  `;
  root.appendChild(box);

  // ── Countdown timer on resend button ──────────────────────
  const RESEND_WAIT = 60;
  let remaining = RESEND_WAIT;
  let cooldown = true;

  const rb          = document.getElementById('mls-resend-btn');
  const countdownEl = document.getElementById('mls-countdown');

  const tick = setInterval(() => {
    remaining--;
    if (countdownEl) countdownEl.textContent = remaining > 0 ? `(${remaining}s)` : '';
    if (remaining <= 0) {
      clearInterval(tick);
      cooldown = false;
      if (rb) { rb.disabled = false; rb.classList.add('mls-resend-ready'); }
      if (countdownEl) countdownEl.textContent = '';
    }
  }, 1000);

  rb?.addEventListener('click', async () => {
    if (cooldown) return;
    cooldown = true;
    if (rb) { rb.disabled = true; rb.classList.remove('mls-resend-ready'); }

    // Animate the icon briefly
    const core = box.querySelector('.mls-icon-core');
    if (core) { core.style.transform = 'scale(.9)'; setTimeout(() => { core.style.transform = ''; }, 200); }

    const sb = getSupabase();
    if (sb) {
      await sb.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: `${window.location.origin}/login`,
        },
      }).catch(() => {});
    }
    toast.success('Link sent!', `A new magic link was sent to ${email}`);

    // Restart the 30s cooldown after resend
    remaining = 30;
    if (countdownEl) countdownEl.textContent = `(${remaining}s)`;
    const tick2 = setInterval(() => {
      remaining--;
      if (countdownEl) countdownEl.textContent = remaining > 0 ? `(${remaining}s)` : '';
      if (remaining <= 0) {
        clearInterval(tick2);
        cooldown = false;
        if (rb) { rb.disabled = false; rb.classList.add('mls-resend-ready'); }
        if (countdownEl) countdownEl.textContent = '';
      }
    }, 1000);
  });
}

// ── Create Account flow — link-based verification ─────────────
let _regEmail = '';
let _regName  = '';

function _initRegisterFlow() {
  // Password strength hint
  document.addEventListener('input', e => {
    if (e.target.id !== 'preg-password') return;
    const hint = document.getElementById('preg-pw-strength');
    if (!hint) return;
    const v = e.target.value;
    if (!v) { hint.textContent = ''; return; }
    const strength = _pwStrength(v);
    hint.innerHTML = `Strength: <strong style="color:${strength.color}">${strength.label}</strong>`;
  });

  document.getElementById('preg-btn')?.addEventListener('click', async () => {
    const name     = document.getElementById('preg-name')?.value.trim();
    const email    = document.getElementById('preg-email')?.value.trim();
    const phone    = getPhoneValue(document.getElementById('preg-phone')) || '';
    const password = document.getElementById('preg-password')?.value;
    const confirm  = document.getElementById('preg-confirm')?.value;
    const errEl    = document.getElementById('preg-err-1');
    const errMsg   = document.getElementById('preg-err-1-msg');
    const btn      = document.getElementById('preg-btn');
    if (!errEl || !btn) return;

    errEl.style.display = 'none';
    if (!name)             { _showErr(errEl, errMsg, 'Please enter your full name.');        return; }
    if (!email)            { _showErr(errEl, errMsg, 'Please enter your email address.');    return; }
    if (!phone)            { _showErr(errEl, errMsg, 'Please enter your phone number.');     return; }
    if (!/^\+94\d{9}$/.test(phone.replace(/\s/g,''))) { _showErr(errEl, errMsg, 'Enter a valid Sri Lanka number (+94 + 9 digits).'); return; }
    if (!password)         { _showErr(errEl, errMsg, 'Please create a password.');           return; }
    if (password.length < 8) { _showErr(errEl, errMsg, 'Password must be at least 8 characters.'); return; }
    if (password !== confirm) { _showErr(errEl, errMsg, 'Passwords do not match.');          return; }

    // ── hCaptcha check — skip gracefully if widget failed to load ──
    const captchaToken = getWidgetToken(_hcapRegisterId);
    if (_hcapRegisterId !== null && !captchaToken) {
      _showErr(errEl, errMsg, 'Please complete the captcha check.');
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creating account…';

    try {
      const result = await signUpWithPassword(name, email, password, phone);

      if (!result.success) {
        _showErr(errEl, errMsg, result.error);
        resetWidget(_hcapRegisterId);
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-user-plus"></i> Create Account';
        return;
      }

      // Success — show "check your email for the link" screen
      _regEmail = email;
      _regName  = name;
      document.getElementById('preg-step-1').style.display = 'none';
      document.getElementById('preg-step-2').style.display = '';
      const sentTo = document.getElementById('preg-sent-to');
      if (sentTo) sentTo.textContent = email;

      // Start the 60s cooldown on the registration resend button
      _startRegResendCooldown(60);

    } catch (err) {
      console.error('[Auth] Register unexpected error:', err);
      _showErr(errEl, errMsg, 'An unexpected error occurred. Please try again.');
      resetWidget(_hcapRegisterId);
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-user-plus"></i> Create Account';
    }
  });

  // Resend confirmation link — countdown-gated, always sends a link not an OTP code
  document.addEventListener('click', async e => {
    if (!e.target.closest('#preg-resend-btn')) return;
    const rb = document.getElementById('preg-resend-btn');
    if (!rb || rb.disabled) return;
    rb.disabled = true;
    rb.classList.remove('mls-resend-ready');

    const sb = getSupabase();
    if (sb) {
      await sb.auth.resend({
        type: 'signup',
        email: _regEmail,
        options: { emailRedirectTo: `${window.location.origin}/login` },
      }).catch(() => {});
    }
    toast.success('Link sent!', `A new confirmation link was sent to ${_regEmail}`);
    _startRegResendCooldown(30);
  });

  // Back to form
  document.addEventListener('click', e => {
    if (!e.target.closest('#preg-back-btn')) return;
    document.getElementById('preg-step-2').style.display = 'none';
    document.getElementById('preg-step-1').style.display = '';
    const btn = document.getElementById('preg-btn');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-user-plus"></i> Create Account'; }
  });

  // Phone input enhancement
  const phoneInput = document.getElementById('preg-phone');
  if (phoneInput) initPhoneInput(phoneInput);
}

// ── Registration resend countdown ────────────────────────────
function _startRegResendCooldown(seconds) {
  const rb  = document.getElementById('preg-resend-btn');
  const cdEl = document.getElementById('preg-countdown');
  if (!rb) return;
  rb.disabled = true;
  rb.classList.remove('mls-resend-ready');
  let remaining = seconds;
  if (cdEl) cdEl.textContent = `(${remaining}s)`;

  const t = setInterval(() => {
    remaining--;
    if (cdEl) cdEl.textContent = remaining > 0 ? `(${remaining}s)` : '';
    if (remaining <= 0) {
      clearInterval(t);
      rb.disabled = false;
      rb.classList.add('mls-resend-ready');
      if (cdEl) cdEl.textContent = '';
    }
  }, 1000);
}

// ── Shared helpers ────────────────────────────────────────────
function _showErr(container, msgEl, text) {
  if (msgEl) msgEl.textContent = text;
  if (container) container.style.display = 'flex';
}

function _startTimer(timerId, btnId, seconds = 30) {
  const btn = document.getElementById(btnId);
  if (btn) { btn.disabled = true; btn.innerHTML = `Resend in <span id="${timerId}">${seconds}</span>s`; }

  let remaining = seconds;
  const handle = setInterval(() => {
    remaining--;
    const t = document.getElementById(timerId);
    if (t) t.textContent = remaining;
    if (remaining <= 0) {
      clearInterval(handle);
      const rb = document.getElementById(btnId);
      if (rb) { rb.disabled = false; rb.textContent = 'Resend code'; }
    }
  }, 1000);
  // Store handle on the button element so Back can clear it
  if (btn) btn._timerHandle = handle;
}

function _pwStrength(pw) {
  let score = 0;
  if (pw.length >= 8)  score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (score <= 1) return { label: 'Weak',   color: 'var(--clr-error,#ef4444)' };
  if (score <= 3) return { label: 'Fair',   color: '#f59e0b' };
  if (score === 4) return { label: 'Good',  color: '#22c55e' };
  return              { label: 'Strong', color: '#16a34a' };
}

// ══════════════════════════════════════════════════════════════
//  DEMO MODE — classic email / password (DEMO_MODE = true)
// ══════════════════════════════════════════════════════════════

function initTabs() {
  const loginTab  = document.getElementById('tab-login-btn');
  const regTab    = document.getElementById('tab-register-btn');
  const loginForm = document.getElementById('form-login');
  const regForm   = document.getElementById('form-register');

  const showLogin = () => {
    if (loginForm) loginForm.style.display = '';
    if (regForm)   regForm.style.display   = 'none';
    loginTab?.classList.add('active');
    regTab?.classList.remove('active');
  };
  const showReg = () => {
    if (loginForm) loginForm.style.display = 'none';
    if (regForm)   regForm.style.display   = '';
    regTab?.classList.add('active');
    loginTab?.classList.remove('active');
  };

  loginTab?.addEventListener('click', showLogin);
  regTab?.addEventListener('click', showReg);
  document.getElementById('switch-to-register')?.addEventListener('click', e => { e.preventDefault(); showReg(); });
  document.getElementById('switch-to-login')?.addEventListener('click',    e => { e.preventDefault(); showLogin(); });
}

function initPasswordToggle() {
  [['toggle-password',    'login-password'],
   ['toggle-reg-password','reg-password'],
   ['toggle-reg-confirm', 'reg-confirm'],
  ].forEach(([btnId, inputId]) => {
    const btn   = document.getElementById(btnId);
    const input = document.getElementById(inputId);
    if (!btn || !input) return;
    btn.addEventListener('click', () => {
      const hidden = input.type === 'password';
      input.type = hidden ? 'text' : 'password';
      const icon = btn.querySelector('i');
      if (icon) icon.className = hidden ? 'fa-regular fa-eye-slash' : 'fa-regular fa-eye';
    });
  });
}

function initDemoLoginForm() {
  const btn   = document.getElementById('pli-btn');
  const errEl = document.getElementById('pli-err-1');
  const errMsg = document.getElementById('pli-err-1-msg');
  if (!btn) return;

  const doLogin = async () => {
    if (errEl) errEl.style.display = 'none';

    // ── hCaptcha check ─────────────────────────────────────
    // Mirror the production-mode guard: if the widget failed to load
    // (_hcapLoginId === null), fail open so hCaptcha outages don't
    // lock users out. Only enforce when the widget actually rendered.
    if (_hcapLoginId !== null && !getWidgetToken(_hcapLoginId)) {
      if (errEl && errMsg) { errMsg.textContent = 'Please complete the captcha check.'; errEl.style.display = 'flex'; }
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Verifying…';

    const email    = document.getElementById('pli-email')?.value.trim();
    const password = document.getElementById('pli-password')?.value;

    const result = await login(email, password);
    if (result.success) {
      toast.success('Welcome back!', result.user.name || email);
      setTimeout(() => window.location.href = getReturnUrl(), 800);
    } else {
      if (errEl && errMsg) { errMsg.textContent = result.error; errEl.style.display = 'flex'; }
      resetWidget(_hcapLoginId);
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send Sign-In Link';
    }
  };

  btn.addEventListener('click', doLogin);
  document.getElementById('pli-password')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') doLogin();
  });
}

function initDemoRegisterForm() {
  const btn   = document.getElementById('preg-btn');
  const errEl = document.getElementById('preg-err-1');
  const errMsg = document.getElementById('preg-err-1-msg');
  if (!btn) return;

  const phoneInput = document.getElementById('preg-phone');
  if (phoneInput) initPhoneInput(phoneInput);

  btn.addEventListener('click', async () => {
    if (errEl) errEl.style.display = 'none';
    const name     = document.getElementById('preg-name')?.value.trim();
    const email    = document.getElementById('preg-email')?.value.trim();
    const password = document.getElementById('preg-password')?.value;
    const confirm  = document.getElementById('preg-confirm')?.value;
    const phone    = getPhoneValue(document.getElementById('preg-phone')) || '';

    if (!name)    { if (errEl && errMsg) { errMsg.textContent = 'Please enter your name.'; errEl.style.display = 'flex'; } return; }
    if (!email)   { if (errEl && errMsg) { errMsg.textContent = 'Please enter your email.'; errEl.style.display = 'flex'; } return; }
    if (!phone)   { if (errEl && errMsg) { errMsg.textContent = 'Please enter your phone number.'; errEl.style.display = 'flex'; } return; }
    if (!/^\+94\d{9}$/.test(phone.replace(/\s/g,''))) { if (errEl && errMsg) { errMsg.textContent = 'Enter a valid Sri Lanka number (+94 + 9 digits).'; errEl.style.display = 'flex'; } return; }
    if (password !== confirm) { if (errEl && errMsg) { errMsg.textContent = 'Passwords do not match.'; errEl.style.display = 'flex'; } return; }
    if (password.length < 6)  { if (errEl && errMsg) { errMsg.textContent = 'Password must be at least 6 characters.'; errEl.style.display = 'flex'; } return; }

    // ── hCaptcha check ───────────────────────────────────────
    if (_hcapRegisterId !== null && !getWidgetToken(_hcapRegisterId)) {
      if (errEl && errMsg) { errMsg.textContent = 'Please complete the captcha check.'; errEl.style.display = 'flex'; }
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creating account…';

    const result = await register(name, email, password, phone);
    if (result.success) {
      toast.success('Account created!', `Welcome, ${name}!`);
      setTimeout(() => window.location.href = getReturnUrl(), 800);
    } else {
      if (errEl && errMsg) { errMsg.textContent = result.error; errEl.style.display = 'flex'; }
      resetWidget(_hcapRegisterId);
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-user-plus"></i> Create Account';
    }
  });
}

// ── Google OAuth ──────────────────────────────────────────────
function _initGoogleAuth() {
  document.querySelectorAll('.btn-google').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Redirecting to Google…';
      const result = await signInWithGoogle();
      if (!result.success) {
        toast.error('Google sign-in failed', result.error || 'Please try again.');
        btn.disabled = false;
        btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/><path fill="none" d="M0 0h48v48H0z"/></svg> Continue with Google';
      }
      // On success the browser navigates away — no need to re-enable.
    });
  });
}

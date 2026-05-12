import { withLoader } from '../../js/loader.js';
    import { adminLogin, getAdminSession } from '../../js/admin/admin-auth.js';
    import toast from '../../js/toast.js';

    withLoader(async () => {
      if (getAdminSession()) { window.location.href = 'dashboard.html'; return; }

      // ── UI helpers ────────────────────────────────────────────
      const showStep = step => {
        document.getElementById('admin-login-form').style.display    = step === 1 ? '' : 'none';
        document.getElementById('magic-link-step').style.display     = step === 2 ? '' : 'none';
      };

      const setLoginError = (msg) => {
        const el = document.getElementById('login-error');
        document.getElementById('login-error-text').textContent = msg;
        el.style.display = msg ? 'flex' : 'none';
      };

      // ── Step 1: email + password ──────────────────────────────
      document.getElementById('admin-login-form').addEventListener('submit', async e => {
        e.preventDefault();
        setLoginError('');
        const btn = document.getElementById('login-btn');
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Signing in…';

        const email    = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;
        const result   = await adminLogin(email, password);

        if (!result.success) {
          setLoginError(result.error || 'Invalid credentials.');
          btn.disabled = false;
          btn.innerHTML = '<i class="fa-solid fa-lock"></i> Sign In to Admin';
          return;
        }

        if (result.magicLinkPending) {
          // Supabase admin path: show "check your email" screen
          document.getElementById('magic-email-display').textContent = result.email;
          showStep(2);
          toast.success('Magic link sent', `Check ${result.email} for your sign-in link`);
        } else {
          // Legacy env-admin: session already set in sessionStorage
          toast.success('Welcome!', 'Redirecting to dashboard…');
          setTimeout(() => window.location.href = 'dashboard.html', 700);
        }
      });

      // ── Back to step 1 ────────────────────────────────────────
      document.getElementById('magic-back-btn').addEventListener('click', () => {
        showStep(1);
        const loginBtn = document.getElementById('login-btn');
        loginBtn.disabled = false;
        loginBtn.innerHTML = '<i class="fa-solid fa-lock"></i> Sign In to Admin';
      });
    });

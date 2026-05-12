import { withLoader } from '../loader.js';
    import { injectLayout } from '../layout.js';
    import { LS, EMAILJS } from '../config.js';
    import { addMessage } from '../contact-messages.js';
    import toast from '../toast.js';
    import { initPhoneInput, isPhoneValid, getPhoneValue } from '../phone-input.js';
    import { initCaptcha, getWidgetToken, resetWidget } from '../recaptcha.js';

    withLoader(async () => {
      injectLayout({ activePage: 'Contact' });

      /* ── Load contact info from admin settings ───────────── */
      let settings = {};
      try {
        const { DEMO_MODE } = await import('../config.js');
        if (!DEMO_MODE) {
          const { getSiteSettings } = await import('../supabase-store.js');
          const remote = await getSiteSettings();
          // Flatten {v: value} wrapper if present
          const flat = {};
          Object.entries(remote).forEach(([k, v]) => {
            flat[k] = (v && typeof v === 'object' && 'v' in v) ? v.v : v;
          });
          settings = flat;
          // Cache for offline/fast load
          if (Object.keys(flat).length) localStorage.setItem(LS.siteSettings, JSON.stringify(flat));
        } else {
          settings = JSON.parse(localStorage.getItem(LS.siteSettings) || '{}');
        }
      } catch {
        try { settings = JSON.parse(localStorage.getItem(LS.siteSettings) || '{}'); } catch {}
      }

      const phone = settings.phone || '+94 77 123 4567';
      const email = settings.email || 'hello@manarize.lk';
      const address = settings.address || 'Colombo 03, Sri Lanka';
      const waPhone = settings.waPhone || '94771234567';

      const contactData = [
        { icon: 'fa-solid fa-phone', label: 'Phone', value: phone, href: `tel:${phone}` },
        { icon: 'fa-solid fa-envelope', label: 'Email', value: email, href: `mailto:${email}` },
        { icon: 'fa-brands fa-whatsapp', label: 'WhatsApp', value: phone, href: `https://wa.me/${waPhone}` },
        { icon: 'fa-solid fa-location-dot', label: 'Address', value: address, href: null },
      ];

      const contactInfoEl = document.getElementById('contact-info-list');
      if (contactInfoEl) {
        contactInfoEl.innerHTML = contactData.map(item => `
          <div class="contact-info-item">
            <div class="contact-icon"><i class="${item.icon}"></i></div>
            <div>
              <strong style="display:block;margin-bottom:.25rem;color:var(--clr-text)">${item.label}</strong>
              ${item.href
            ? `<a href="${item.href}" style="color:var(--clr-text-2)" ${item.href.startsWith('http') ? 'target="_blank" rel="noopener"' : ''}>${item.value}</a>`
            : `<p style="color:var(--clr-text-2);margin:0">${item.value}</p>`
          }
            </div>
          </div>`).join('');
      }

      /* ── WhatsApp CTA ────────────────────────────────────── */
      const waCta = document.getElementById('wa-cta');
      if (waCta) waCta.href = `https://wa.me/${waPhone}?text=Hi%20Manarize!%20I%20need%20help.`;

      /* ── Business hours ──────────────────────────────────── */
      const bizHours = [
        { day: 'Monday – Friday', hours: settings.biz_mon_fri || '9:00 AM – 6:00 PM', closed: settings.biz_mon_fri_closed === 'true' },
        { day: 'Saturday', hours: settings.biz_sat || '10:00 AM – 4:00 PM', closed: settings.biz_sat_closed === 'true' },
        { day: 'Sunday', hours: settings.biz_sun || 'Closed', closed: settings.biz_sun_closed !== 'false' },
      ];
      const bizHoursEl = document.getElementById('biz-hours');
      if (bizHoursEl) {
        bizHoursEl.innerHTML = `<div style="display:flex;flex-direction:column;gap:.75rem">` +
          bizHours.map(({ day, hours, closed }) => `
            <div style="display:flex;justify-content:space-between;padding:.625rem 0;border-bottom:1px solid var(--clr-border);font-size:.875rem">
              <span style="color:var(--clr-text-2)">${day}</span>
              <span style="color:${closed ? 'var(--clr-error)' : 'var(--clr-success)'};font-weight:600">${closed ? 'Closed' : hours}</span>
            </div>`).join('') + '</div>';
      }

      /* ── Contact form ────────────────────────────────────── */
      // ── Init phone input ─────────────────────────────────────
      const phoneInput = document.querySelector('#contact-form input[name="phone"]');
      if (phoneInput) initPhoneInput(phoneInput);

      // ── Init hCaptcha ─────────────────────────────────────────
      const hcapContactId = await initCaptcha('hcap-contact');

      document.getElementById('contact-form')?.addEventListener('submit', async e => {
        e.preventDefault();
        toast.dismissAll();
        const form = e.target;
        const btn = form.querySelector('button[type="submit"]');

        // Collect fields
        const data = {
          firstName: form.firstName.value.trim(),
          lastName: form.lastName.value.trim(),
          email: form.email.value.trim(),
          phone: getPhoneValue(phoneInput),
          subject: form.subject.value.trim(),
          message: form.message.value.trim(),
        };

        // Basic validation
        if (!data.firstName || !data.email || !data.subject || !data.message) {
          toast.error('Missing fields', 'Please fill in all required fields.');
          return;
        }
        if (data.phone && !isPhoneValid(phoneInput)) {
          toast.error('Invalid phone', 'Enter a valid number: +94 followed by 9 digits.');
          return;
        }

        // ── hCaptcha check ─────────────────────────────────────
        const captchaToken = getWidgetToken(hcapContactId);
        if (!captchaToken) {
          toast.error('Captcha required', 'Please complete the captcha check.');
          return;
        }

        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending…';

        // ── 1. Save to localStorage (always, instant) ─────────
        addMessage(data);

        // ── 2. Send via EmailJS (if configured) ───────────────
        const ejsConfigured = EMAILJS.publicKey && !EMAILJS.publicKey.startsWith('YOUR_');
        if (ejsConfigured) {
          try {
            // Lazy-load EmailJS SDK
            if (!window.emailjs) {
              await new Promise((res, rej) => {
                const s = document.createElement('script');
                s.src = 'https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js';
                s.onload = res; s.onerror = rej;
                document.head.appendChild(s);
              });
              window.emailjs.init({ publicKey: EMAILJS.publicKey });
            }
            await window.emailjs.send(EMAILJS.serviceId, EMAILJS.templateId, {
              from_name: `${data.firstName} ${data.lastName}`,
              from_email: data.email,
              phone: data.phone || 'Not provided',
              subject: data.subject,
              message: data.message,
              reply_to: data.email,
              admin_email: EMAILJS.adminEmail,
            });
          } catch (err) {
            // EmailJS failed — message is still saved locally, so just warn
            console.warn('[Manarize] EmailJS send failed:', err);
            toast.warning('Saved locally', 'Email delivery failed — our team will still see your message in the admin panel.');
            form.reset();
            resetWidget(hcapContactId);
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send Message';
            return;
          }
        }

        toast.success('Message Sent!', 'We\'ll get back to you within 24 hours.');
        form.reset();
        resetWidget(hcapContactId);
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send Message';
      });
    });

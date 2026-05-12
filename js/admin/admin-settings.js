/* ============================================================
   ZENMARKET — ADMIN SETTINGS  (fixed)
   ============================================================ */
import { requireAdmin }      from './admin-auth.js';
import { injectAdminLayout } from './admin-layout.js';
import { withLoader }        from '../loader.js';
import { LS }                from '../config.js';
import toast                 from '../toast.js';
import { changeAdminPassword } from './admin-auth.js';

const DEFAULTS = {
  storeName:    'Manarize',
  phone:        '+94 77 123 4567',
  email:        'hello@manarize.lk',
  address:      'Colombo 03, Sri Lanka',
  waPhone:      '94771234567',
  codEnabled:     true,
  payhereEnabled: true,
  bankEnabled:    true,
  freeShip:     5000,
  shipRate:     350,
  facebook:     'https://facebook.com/manarize',
  instagram:    'https://instagram.com/manarize',
  tiktok:       'https://tiktok.com/@manarize',
  youtube:      'https://youtube.com/@manarize',
  payhereId:    '',
  supabaseUrl:  '',
  supabaseKey:  '',
  // Bank account
  bankName:      'Bank of Ceylon',
  accountName:   'Manarize (Pvt) Ltd',
  accountNumber: '1234567890',
  branchName:    'Colombo Main Branch',
  branchCode:    '001',
  swiftCode:     'BCEYLKLX',
  // Business hours
  biz_mon_fri:        '9:00 AM – 6:00 PM',
  biz_sat:            '10:00 AM – 4:00 PM',
  biz_sun:            'Closed',
  biz_mon_fri_closed: 'false',
  biz_sat_closed:     'false',
  biz_sun_closed:     'true',
  // Promo banner
  promoEnabled:   true,
  promoEyebrow:   'Limited Time Offer',
  promoTitle:     'Mega Sale — Up to 30% Off',
  promoDesc:      "Don't miss out on our biggest sale of the season. Premium products at unbeatable prices.",
  promoBtnText:   'Shop the Sale',
  promoBtnUrl:    'shop.html',
  promoEndDate:   '',   // ISO datetime string or '' for rolling 24h
};

async function loadSettings() {
  try {
    const { DEMO_MODE } = await import('../config.js');
    if (!DEMO_MODE) {
      const { getSiteSettings } = await import('../supabase-store.js');
      const remote = await getSiteSettings();
      // site_settings stores each key as { key, value:{...} } — flatten
      const flat = {};
      Object.entries(remote).forEach(([k, v]) => {
        flat[k] = (v && typeof v === 'object' && 'v' in v) ? v.v : v;
      });
      return { ...DEFAULTS, ...flat };
    }
  } catch {}
  try {
    const raw = localStorage.getItem(LS.siteSettings);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch { return { ...DEFAULTS }; }
}

async function saveSettings(data) {
  try {
    const { DEMO_MODE } = await import('../config.js');
    if (!DEMO_MODE) {
      const { saveSiteSettings } = await import('../supabase-store.js');
      await saveSiteSettings(data);
      // Also cache locally so public pages (contact, etc.) stay in sync
      localStorage.setItem(LS.siteSettings, JSON.stringify(data));
      return;
    }
  } catch {}
  localStorage.setItem(LS.siteSettings, JSON.stringify(data));
}

// ── Map field id → settings key ───────────────────────────────
const FIELD_MAP = {
  's-name':          'storeName',
  's-phone':         'phone',
  's-email':         'email',
  's-address':       'address',
  's-wa':            'waPhone',
  's-free-ship':     'freeShip',
  's-ship-rate':     'shipRate',
  's-fb':            'facebook',
  's-ig':            'instagram',
  's-tt':            'tiktok',
  's-yt':            'youtube',
  // Bank account
  's-bank-name':      'bankName',
  's-account-name':   'accountName',
  's-account-number': 'accountNumber',
  's-branch-name':    'branchName',
  's-branch-code':    'branchCode',
  's-swift-code':     'swiftCode',
  // Business hours text fields
  's-biz-mon-fri': 'biz_mon_fri',
  's-biz-sat':     'biz_sat',
  's-biz-sun':     'biz_sun',
  // Promo banner
  's-promo-eyebrow':  'promoEyebrow',
  's-promo-title':    'promoTitle',
  's-promo-desc':     'promoDesc',
  's-promo-btn-text': 'promoBtnText',
  's-promo-btn-url':  'promoBtnUrl',
  's-promo-end-date': 'promoEndDate',
};

const TOGGLE_MAP = {
  's-payhere':      'payhereEnabled',
  's-cod':          'codEnabled',
  's-bank':         'bankEnabled',
  's-promo-enabled':'promoEnabled',
};

// Business hours closed checkboxes (store as string 'true'/'false')
const BIZ_CLOSED_MAP = {
  's-biz-mon-fri-closed': 'biz_mon_fri_closed',
  's-biz-sat-closed':     'biz_sat_closed',
  's-biz-sun-closed':     'biz_sun_closed',
};

function fillForm(settings) {
  Object.entries(FIELD_MAP).forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (el && settings[key] !== undefined) el.value = settings[key];
  });
  Object.entries(TOGGLE_MAP).forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (el) el.checked = settings[key] !== false && settings[key] !== 'false';
  });
  Object.entries(BIZ_CLOSED_MAP).forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (el) el.checked = settings[key] === 'true';
  });
}

function readForm() {
  const data = {};
  Object.entries(FIELD_MAP).forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (el) data[key] = el.value.trim();
  });
  Object.entries(TOGGLE_MAP).forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (el) data[key] = el.checked;
  });
  Object.entries(BIZ_CLOSED_MAP).forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (el) data[key] = String(el.checked);
  });
  // Parse numbers
  data.freeShip = parseFloat(data.freeShip) || 0;
  data.shipRate  = parseFloat(data.shipRate)  || 350;
  return data;
}

// ── Wire closed-checkbox → grey-out hours input ──────────────
function bindBizClosedToggles() {
  [
    ['s-biz-mon-fri-closed', 's-biz-mon-fri'],
    ['s-biz-sat-closed',     's-biz-sat'],
    ['s-biz-sun-closed',     's-biz-sun'],
  ].forEach(([checkId, inputId]) => {
    const check = document.getElementById(checkId);
    const input = document.getElementById(inputId);
    if (!check || !input) return;
    const update = () => {
      input.disabled = check.checked;
      input.style.opacity = check.checked ? '.35' : '1';
      if (check.checked) input.placeholder = 'Closed';
    };
    check.addEventListener('change', update);
    update();
  });
}

withLoader(async () => {
  if (!requireAdmin()) return;
  await injectAdminLayout('Settings');

  // Load and fill
  const settings = await loadSettings();
  fillForm(settings);
  bindBizClosedToggles();

  // Save on submit
  document.getElementById('settings-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const data = readForm();
    await saveSettings(data);

    toast.success('Saved!', 'Settings updated successfully');

    const statusEl = document.getElementById('save-status');
    if (statusEl) {
      statusEl.style.display = 'inline-flex';
      setTimeout(() => { statusEl.style.display = 'none'; }, 3000);
    }
  });

  // ── Live promo preview ──────────────────────────────────────
  bindPromoPreview();

  // ── Password change ─────────────────────────────────────────
  bindPasswordChange();
});

// ── Password change ───────────────────────────────────────────
function bindPasswordChange() {
  // Show/hide password toggle (eye icon)
  document.querySelectorAll('.pw-eye').forEach(btn => {
    btn.addEventListener('click', () => {
      const inp = document.getElementById(btn.dataset.target);
      if (!inp) return;
      inp.type = inp.type === 'password' ? 'text' : 'password';
      btn.querySelector('i').className =
        inp.type === 'password' ? 'fa-regular fa-eye' : 'fa-regular fa-eye-slash';
    });
  });

  // Strength meter on new-password field
  document.getElementById('pw-new')?.addEventListener('input', e => {
    const val = e.target.value;
    const bar = document.getElementById('pw-strength-bar');
    const lbl = document.getElementById('pw-strength-label');
    let score = 0;
    if (val.length >= 8)           score++;
    if (/[A-Z]/.test(val))         score++;
    if (/[0-9]/.test(val))         score++;
    if (/[^A-Za-z0-9]/.test(val))  score++;
    const colors = ['', '#ef4444', '#f97316', '#eab308', '#22c55e'];
    const labels = ['', 'Weak', 'Fair', 'Good', 'Strong'];
    if (bar) { bar.style.width = `${score * 25}%`; bar.style.background = colors[score] || ''; }
    if (lbl) lbl.textContent = val ? (labels[score] || '') : '';
  });

  // Submit handler
  document.getElementById('pw-change-btn')?.addEventListener('click', async () => {
    const cur = document.getElementById('pw-current')?.value?.trim() || '';
    const nw  = document.getElementById('pw-new')?.value || '';
    const cfm = document.getElementById('pw-confirm')?.value || '';

    if (!cur || !nw || !cfm) {
      toast.error('Required', 'Please fill in all password fields.');
      return;
    }
    if (nw !== cfm) {
      toast.error('Mismatch', 'New passwords do not match.');
      document.getElementById('pw-confirm')?.focus();
      return;
    }

    const result = await changeAdminPassword(cur, nw);
    if (result.success) {
      toast.success('Password Updated', 'Password changed. Please log in again with your new password.');
      // Session was invalidated by changeAdminPassword — redirect to login
      setTimeout(() => { window.location.href = '/'; }, 1800);
      ['pw-current', 'pw-new', 'pw-confirm'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.value = ''; el.type = 'password'; }
      });
      document.querySelectorAll('.pw-eye i').forEach(i => i.className = 'fa-regular fa-eye');
      const bar = document.getElementById('pw-strength-bar');
      const lbl = document.getElementById('pw-strength-label');
      if (bar) bar.style.width = '0';
      if (lbl) lbl.textContent = '';
    } else {
      toast.error('Error', result.error);
      document.getElementById('pw-current')?.focus();
    }
  });
}

function bindPromoPreview() {
  const map = {
    's-promo-eyebrow':  'prev-eyebrow',
    's-promo-title':    'prev-title',
    's-promo-desc':     'prev-desc',
    's-promo-btn-text': 'prev-btn',
  };
  Object.entries(map).forEach(([inputId, previewId]) => {
    const input   = document.getElementById(inputId);
    const preview = document.getElementById(previewId);
    if (!input || !preview) return;
    input.addEventListener('input', () => {
      preview.textContent = input.value || input.placeholder;
    });
  });

  // Countdown preview from end date field
  const endDateInput = document.getElementById('s-promo-end-date');
  let previewTimer;
  const tickPreview = () => {
    const val = endDateInput?.value;
    const end = val ? new Date(val).getTime() : Date.now() + 23 * 3600000 + 59 * 60000 + 59000;
    const diff = Math.max(0, end - Date.now());
    const pad  = n => String(Math.floor(n)).padStart(2,'0');
    const hEl  = document.getElementById('prev-h');
    const mEl  = document.getElementById('prev-m');
    const sEl  = document.getElementById('prev-s');
    if (hEl) hEl.textContent = pad(diff / 3600000);
    if (mEl) mEl.textContent = pad((diff % 3600000) / 60000);
    if (sEl) sEl.textContent = pad((diff % 60000) / 1000);
  };
  tickPreview();
  previewTimer = setInterval(tickPreview, 1000);

  // Hide/show preview when toggle changes
  document.getElementById('s-promo-enabled')?.addEventListener('change', e => {
    const preview = document.getElementById('promo-preview');
    if (preview) preview.style.opacity = e.target.checked ? '1' : '0.35';
  });
};

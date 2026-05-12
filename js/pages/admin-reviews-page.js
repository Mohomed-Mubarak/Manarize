import { adminConfirm }      from "../../js/admin/admin-confirm.js";
    import { withLoader }        from "../../js/loader.js";
    import { requireAdmin }      from "../../js/admin/admin-auth.js";
    import { sendReviewApprovedNotification } from "../../js/notifications.js";
    import { getProducts } from "../../js/store-adapter.js";
    import { injectAdminLayout } from "../../js/admin/admin-layout.js";
    import toast                 from "../../js/toast.js";
    import { getAllReviews, getAllReviewsFlat, approveReview, rejectReview, deleteReview } from "../../js/reviews.js";
    import { LS }                from "../../js/config.js";

    const LS_ADMIN_REVIEWS = "zm_admin_reviews";
    const LS_HP            = "zm_homepage_reviews";

    // ── No demo reviews — production data comes from Supabase ──
    const DEFAULT_ADMIN_REVIEWS = [];

    function loadAdminReviews() {
      try { const r = localStorage.getItem(LS_ADMIN_REVIEWS); return r ? JSON.parse(r) : []; }
      catch { return []; }
    }
    function saveAdminReviews(r) {
      localStorage.setItem(LS_ADMIN_REVIEWS, JSON.stringify(r));
      // Async sync to Supabase site_settings (non-blocking)
      import('../../js/config.js').then(({ DEMO_MODE }) => {
        if (DEMO_MODE) return;
        import('../../js/supabase-store.js').then(({ saveSiteSettings }) => {
          saveSiteSettings({ zm_admin_reviews: r }).catch(e => console.warn('[saveAdminReviews] Supabase sync:', e.message));
        });
      });
    }
    function loadHpCfg()  { try { return JSON.parse(localStorage.getItem(LS_HP) || '{}'); } catch { return {}; } }
    function saveHpCfg(c) { localStorage.setItem(LS_HP, JSON.stringify(c)); }

    function starsHtml(n) {
      return Array.from({length:5}, (_,i) => `<i class="fa-${i < n ? 'solid' : 'regular'} fa-star"></i>`).join('');
    }
    function _esc(str) {
      return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    // ── Normalize both stores into one unified shape ──────────
    async function loadAllUnified() {
      // --- source: 'admin' (zm_admin_reviews — always localStorage) ---
      const adminRows = loadAdminReviews().map(r => ({
        _source:  'admin',
        _raw:     r,
        id:       r.id,
        customer: r.customer,
        email:    r.email || '',
        product:  r.product,
        productId: null,
        rating:   r.rating,
        title:    '',
        text:     r.text,
        verified: false,
        editedAt: null,
        status:   r.status,
        dateRaw:  r.date,
        dateStr:  r.date,
      }));

      // --- source: 'product' (Supabase in Live mode, localStorage in Demo) ---
      // getAllReviewsFlat() is async and handles both modes correctly
      let prods = [];
      try { prods = await getProducts(); } catch(e) { console.warn('loadAllUnified getProducts:', e); }
      const productNameMap = {};
      prods.forEach(p => { productNameMap[p.id] = p.name; });

      let flatReviews = [];
      try { flatReviews = await getAllReviewsFlat(); } catch(e) { console.warn('loadAllUnified:', e); }

      const productRows = flatReviews.map(r => {
        const pid = r.productId;
        let status = 'pending';
        if (r.approved)      status = 'approved';
        else if (r.rejected) status = 'rejected';
        return {
          _source:  'product',
          _raw:     r,
          id:       r.id,
          customer: r.userName || 'Anonymous',
          email:    '',
          product:  productNameMap[pid] || pid,
          productId: pid,
          rating:   r.rating,
          title:    r.title || '',
          text:     r.text,
          verified: r.verified,
          editedAt: r.editedAt,
          status,
          dateRaw:  r.createdAt,
          dateStr:  new Date(r.createdAt).toLocaleDateString('en-LK', {year:'numeric',month:'short',day:'numeric'}),
        };
      });

      // Merge + sort newest first
      const all = [...adminRows, ...productRows];
      all.sort((a, b) => new Date(b.dateRaw) - new Date(a.dateRaw));
      return all;
    }

    // ── Homepage Panel ────────────────────────────────────────
    async function initHpPanel() {
      document.getElementById('hp-hdr')?.addEventListener('click', () => {
        const body    = document.getElementById('hp-body');
        const chevron = document.getElementById('hp-chevron');
        const open    = body.classList.toggle('open');
        chevron.classList.toggle('open', open);
      });
      const cfg = loadHpCfg();
      const get = id => document.getElementById(id);
      if(get('hp-enabled')) get('hp-enabled').checked = cfg.enabled !== false && cfg.enabled !== 'false';
      const sv = (id,v,fb) => { const el=get(id); if(el) el.value=v||fb||''; };
      sv('hp-title',    cfg.title,    'What Our Customers Say');
      sv('hp-subtitle', cfg.subtitle, 'Real experiences from real shoppers');
      if(get('hp-max')) get('hp-max').value = cfg.maxCount || 3;
      if(get('hp-show-cta')) get('hp-show-cta').checked = cfg.showCta === true;
      sv('hp-cta-text', cfg.ctaText, 'Shop Now');
      await renderFeaturedList(cfg.pinnedIds || cfg.featuredIds || []);
      updateBadge(get('hp-enabled')?.checked);
      get('hp-enabled')?.addEventListener('change', () => updateBadge(get('hp-enabled').checked));
      get('hp-save')?.addEventListener('click', saveHpSettings);
    }

    function updateBadge(on) {
      const b = document.getElementById('hp-badge');
      if(!b) return;
      b.className = 'live-badge'+(on?'':' off');
      b.innerHTML = `<i class="fa-solid fa-circle" style="font-size:.4rem"></i> ${on?'Live on Homepage':'Hidden'}`;
    }

    async function renderFeaturedList(selectedIds) {
      const wrap = document.getElementById('hp-feat-list');
      if(!wrap) return;
      const approved = (await loadAllUnified()).filter(r => r.status === 'approved');
      if(!approved.length) {
        wrap.innerHTML = '<p style="font-size:.8rem;color:var(--clr-text-3);padding:.5rem">No approved reviews yet. Approve some reviews below first.</p>';
        return;
      }
      wrap.innerHTML = approved.map(r => {
        const chk = selectedIds.includes(r.id) ? 'checked' : '';
        const sel = selectedIds.includes(r.id) ? ' selected' : '';
        return `<label class="feat-item${sel}" data-id="${r.id}">
          <input type="checkbox" value="${r.id}" ${chk} class="hp-feat-cb">
          <div class="feat-item__info">
            <div class="feat-item__name">${_esc(r.customer)}</div>
            <div class="feat-item__prod">${_esc(r.product)}</div>
          </div>
          <div class="feat-item__stars">${starsHtml(r.rating)}</div>
        </label>`;
      }).join('');
      wrap.querySelectorAll('.feat-item').forEach(item => {
        item.addEventListener('change', () => item.classList.toggle('selected', item.querySelector('input').checked));
      });
    }

    async function saveHpSettings() {
      const cfg = loadHpCfg();
      const get = id => document.getElementById(id);
      cfg.enabled    = get('hp-enabled')?.checked;
      cfg.title      = get('hp-title')?.value.trim()    || 'What Our Customers Say';
      cfg.subtitle   = get('hp-subtitle')?.value.trim() || 'Real experiences from real shoppers';
      cfg.maxCount   = parseInt(get('hp-max')?.value, 10) || 3;
      cfg.showCta    = get('hp-show-cta')?.checked;
      cfg.ctaText    = get('hp-cta-text')?.value.trim() || 'Shop Now';
      // Save under both keys so home.js (pinnedIds) and legacy code (featuredIds) both work
      const _selectedIds = Array.from(document.querySelectorAll('.hp-feat-cb:checked')).map(cb => cb.value);
      cfg.featuredIds = _selectedIds;
      cfg.pinnedIds   = _selectedIds;
      // Persist to localStorage (fast local read)
      saveHpCfg(cfg);
      // Persist to Supabase site_settings so all browsers/sessions see the config
      try {
        const { DEMO_MODE } = await import('../../js/config.js');
        if (!DEMO_MODE) {
          const { saveSiteSettings } = await import('../../js/supabase-store.js');
          await saveSiteSettings({ zm_homepage_reviews: cfg });
        }
      } catch(e) { console.warn('[saveHpSettings] Supabase sync failed:', e.message); }
      updateBadge(cfg.enabled);
      const s = document.getElementById('hp-save-status');
      if(s){ s.classList.add('visible'); setTimeout(() => s.classList.remove('visible'), 2500); }
      toast.success('Saved', 'Homepage reviews section updated');
    }

    // ── Unified Reviews Table ─────────────────────────────────
    let _filter = 'all';

    function getSelectedIds() {
      return Array.from(document.querySelectorAll('.row-cb:checked')).map(cb => cb.dataset.id);
    }

    function updateBulkBar() {
      const checked = document.querySelectorAll('.row-cb:checked');
      const bar     = document.getElementById('bulk-bar');
      const cnt     = document.getElementById('bulk-count');
      if (!bar) return;
      if (checked.length > 0) {
        bar.style.display = 'flex';
        cnt.textContent = `${checked.length} review${checked.length !== 1 ? 's' : ''} selected`;
      } else {
        bar.style.display = 'none';
      }
      // Sync select-all checkbox state
      const allCbs  = document.querySelectorAll('.row-cb');
      const selAll  = document.getElementById('select-all-cb');
      if (selAll) {
        selAll.indeterminate = checked.length > 0 && checked.length < allCbs.length;
        selAll.checked = allCbs.length > 0 && checked.length === allCbs.length;
      }
    }

    async function renderReviews(filter) {
      if (filter !== undefined) _filter = filter;

      let rows = await loadAllUnified();

      // Pending count badge
      const pendingCount = rows.filter(r => r.status === 'pending').length;
      const badge = document.getElementById('pending-badge');
      if (badge) { badge.textContent = pendingCount || ''; badge.style.display = pendingCount ? '' : 'none'; }

      // Filter
      if (_filter !== 'all') rows = rows.filter(r => r.status === _filter);

      const tbody = document.getElementById('reviews-tbody');
      const cEl   = document.getElementById('reviews-count');
      if (!tbody) return;
      if (cEl) cEl.textContent = `${rows.length} review${rows.length !== 1 ? 's' : ''}`;

      if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--clr-text-3)">No ${_filter !== 'all' ? _filter + ' ' : ''}reviews found</td></tr>`;
        // Reset bulk bar
        const bar = document.getElementById('bulk-bar');
        if (bar) bar.style.display = 'none';
        return;
      }

      tbody.innerHTML = rows.map(r => {
        const statusBadge = r.status === 'approved'
          ? `<span class="badge badge-green">Approved</span>`
          : r.status === 'rejected'
            ? `<span class="badge badge-red">Rejected</span>`
            : `<span class="badge badge-amber">Pending</span>`;

        // Source tag — small pill to distinguish live vs demo
        const sourceTag = r._source === 'product'
          ? `<span style="display:inline-block;font-size:.65rem;font-weight:600;padding:.1rem .4rem;border-radius:4px;background:rgba(59,158,255,.1);color:#3b9eff;border:1px solid rgba(59,158,255,.2);margin-left:.35rem;vertical-align:middle">Live</span>`
          : '';

        const approveBtn = r.status !== 'approved'
          ? `<button class="btn btn-ghost btn-sm u-approve" data-src="${r._source}" data-id="${r.id}" data-pid="${r.productId||''}" style="color:var(--clr-success)" title="Approve"><i class="fa-solid fa-circle-check"></i></button>`
          : '';
        const rejectBtn  = r.status !== 'rejected'
          ? `<button class="btn btn-ghost btn-sm u-reject"  data-src="${r._source}" data-id="${r.id}" data-pid="${r.productId||''}" style="color:var(--clr-warning)" title="Reject"><i class="fa-solid fa-ban"></i></button>`
          : '';
        const deleteBtn  = `<button class="btn btn-ghost btn-sm u-delete"  data-src="${r._source}" data-id="${r.id}" data-pid="${r.productId||''}" style="color:var(--clr-error)" title="Delete"><i class="fa-solid fa-trash"></i></button>`;

        const editedNote = r.editedAt ? `<span style="font-size:.7rem;color:var(--clr-text-3);margin-left:.3rem">(edited)</span>` : '';

        return `
          <tr data-id="${r.id}" data-src="${r._source}" data-pid="${r.productId||''}" data-status="${r.status}">
            <td style="padding-left:1rem;width:2.5rem">
              <input type="checkbox" class="row-cb" data-id="${r.id}" data-src="${r._source}" data-pid="${r.productId||''}" data-status="${r.status}"
                style="accent-color:var(--clr-gold);width:1rem;height:1rem;cursor:pointer">
            </td>
            <td>
              <div style="font-weight:500;color:var(--clr-text);font-size:.875rem">${_esc(r.customer)}${sourceTag}</div>
              ${r.email    ? `<div style="font-size:.75rem;color:var(--clr-text-3)">${_esc(r.email)}</div>` : ''}
              ${r.verified ? `<div style="font-size:.7rem;color:var(--clr-text-3)">✓ Verified Buyer</div>` : ''}
            </td>
            <td style="font-size:.8125rem;color:var(--clr-text-2);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${_esc(r.product)}">${_esc(r.product)}</td>
            <td><span style="color:var(--clr-warning);font-size:.8125rem">${starsHtml(r.rating)}</span></td>
            <td style="font-size:.8125rem;color:var(--clr-text-2);max-width:240px">
              ${r.title ? `<div style="font-weight:600;margin-bottom:.1rem">${_esc(r.title)}</div>` : ''}
              <div style="overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${_esc(r.text)}</div>
            </td>
            <td>${statusBadge}</td>
            <td style="color:var(--clr-text-3);font-size:.8125rem;white-space:nowrap">${_esc(r.dateStr)}${editedNote}</td>
            <td><div style="display:flex;gap:.375rem;flex-wrap:wrap">${approveBtn}${rejectBtn}${deleteBtn}</div></td>
          </tr>`;
      }).join('');

      // ── Row checkbox listeners ────────────────────────────────
      tbody.querySelectorAll('.row-cb').forEach(cb => {
        cb.addEventListener('change', () => {
          const row = cb.closest('tr');
          if (row) row.style.background = cb.checked ? 'rgba(201,168,76,.07)' : '';
          updateBulkBar();
        });
      });

      // ── Click entire row to toggle checkbox ───────────────────
      tbody.querySelectorAll('tr').forEach(row => {
        row.addEventListener('click', e => {
          // Don't toggle if they clicked a button or the checkbox itself
          if (e.target.closest('button') || e.target.classList.contains('row-cb')) return;
          const cb = row.querySelector('.row-cb');
          if (!cb) return;
          cb.checked = !cb.checked;
          row.style.background = cb.checked ? 'rgba(201,168,76,.07)' : '';
          updateBulkBar();
        });
        row.style.cursor = 'pointer';
      });

      // ── Approve ───────────────────────────────────────────────
      tbody.querySelectorAll('.u-approve').forEach(btn => {
        btn.addEventListener('click', async () => {
          const { src, id, pid } = btn.dataset;
          if (src === 'admin') {
            const all = loadAdminReviews();
            const r   = all.find(x => x.id === id);
            if (!r) return;
            r.status = 'approved';
            saveAdminReviews(all);
            toast.success('Approved', `${r.customer}'s review is now live`);
          } else {
            try {
              await approveReview(pid, id);
              toast.success('Approved', 'Review is now live on the product page');
            } catch(e) {
              console.error('approveReview error:', e);
              toast.error('Error', e.message || 'Could not approve review');
              return;
            }
            // Notify the reviewer
            try {
              const flatReviews = await getAllReviewsFlat();
              const rev = flatReviews.find(x => x.id === id);
              if (rev?.userId) {
                const prods = await getProducts();
                const prod  = prods.find(p => p.id === pid);
                sendReviewApprovedNotification(rev.userId, prod ? prod.name : pid);
              }
            } catch(e) { console.warn('notify reviewer:', e); }
          }
          await renderReviews();
          const _cfg = loadHpCfg(); await renderFeaturedList(_cfg.pinnedIds || _cfg.featuredIds || []);
        });
      });

      // ── Reject ────────────────────────────────────────────────
      tbody.querySelectorAll('.u-reject').forEach(btn => {
        btn.addEventListener('click', async () => {
          const { src, id, pid } = btn.dataset;
          if (src === 'admin') {
            const all = loadAdminReviews();
            const r   = all.find(x => x.id === id);
            if (!r) return;
            r.status = 'rejected';
            saveAdminReviews(all);
          } else {
            try {
              await rejectReview(pid, id);
            } catch(e) {
              console.error('rejectReview error:', e);
              toast.error('Error', e.message || 'Could not reject review');
              return;
            }
          }
          toast.info('Rejected', 'Review hidden from store');
          await renderReviews();
          const _cfg = loadHpCfg(); await renderFeaturedList(_cfg.pinnedIds || _cfg.featuredIds || []);
        });
      });

      // ── Delete ────────────────────────────────────────────────
      tbody.querySelectorAll('.u-delete').forEach(btn => {
        btn.addEventListener('click', async () => {
          const ok = await adminConfirm({ title: 'Delete review?', message: 'This review will be permanently removed.', confirm: 'Delete', danger: true });
          if (!ok) return;
          const { src, id, pid } = btn.dataset;
          if (src === 'admin') {
            saveAdminReviews(loadAdminReviews().filter(r => r.id !== id));
          } else {
            try {
              await deleteReview(pid, id);
            } catch(e) {
              console.error('deleteReview error:', e);
              toast.error('Error', e.message || 'Could not delete review');
              return;
            }
          }
          toast.success('Deleted', 'Review removed');
          await renderReviews();
          const _cfg = loadHpCfg(); await renderFeaturedList(_cfg.pinnedIds || _cfg.featuredIds || []);
        });
      });
    }

    // ── Bulk Actions ──────────────────────────────────────────
    async function applyBulkAction(action) {
      const cbs = Array.from(document.querySelectorAll('.row-cb:checked'));
      if (!cbs.length) return;

      // Build list of items from checked checkboxes
      const items = cbs.map(cb => ({ src: cb.dataset.src, id: cb.dataset.id, pid: cb.dataset.pid, status: cb.dataset.status }));

      if (action === 'approve') {
        let prodsCache = null;
        for (const { src, id, pid, status } of items) {
          if (status === 'approved') continue;
          if (src === 'admin') {
            const all = loadAdminReviews();
            const r = all.find(x => x.id === id);
            if (r) { r.status = 'approved'; saveAdminReviews(all); }
          } else {
            try {
              await approveReview(pid, id);
            } catch(e) { console.warn('bulk approve error:', e); continue; }
            try {
              const flatReviews = await getAllReviewsFlat();
              const rev = flatReviews.find(x => x.id === id);
              if (rev?.userId) {
                if (!prodsCache) prodsCache = await getProducts();
                const prod = prodsCache.find(p => p.id === pid);
                sendReviewApprovedNotification(rev.userId, prod ? prod.name : pid);
              }
            } catch(e) { console.warn('bulk notify reviewer:', e); }
          }
        }
        toast.success('Bulk Approved', `${items.length} review${items.length !== 1 ? 's' : ''} approved`);
        await renderReviews();
        const _cfg = loadHpCfg(); await renderFeaturedList(_cfg.pinnedIds || _cfg.featuredIds || []);
      }

      if (action === 'reject') {
        items.forEach(async ({ src, id, pid, status }) => {
          if (status === 'rejected') return;
          if (src === 'admin') {
            const all = loadAdminReviews();
            const r = all.find(x => x.id === id);
            if (r) { r.status = 'rejected'; saveAdminReviews(all); }
          } else {
            try { await rejectReview(pid, id); } catch(e) { console.warn('bulk reject error:', e); }
          }
        });
        toast.info('Bulk Rejected', `${items.length} review${items.length !== 1 ? 's' : ''} hidden from store`);
        await renderReviews();
        const _cfg = loadHpCfg(); await renderFeaturedList(_cfg.pinnedIds || _cfg.featuredIds || []);
      }

      if (action === 'delete') {
        // Group admin and product items
        const adminIds   = items.filter(i => i.src === 'admin').map(i => i.id);
        const productItems = items.filter(i => i.src === 'product');
        if (adminIds.length) saveAdminReviews(loadAdminReviews().filter(r => !adminIds.includes(r.id)));
        for (const { pid, id } of productItems) {
          try { await deleteReview(pid, id); } catch(e) { console.warn('bulk delete error:', e); }
        }
        toast.success('Bulk Deleted', `${items.length} review${items.length !== 1 ? 's' : ''} removed`);
        await renderReviews();
        const _cfg = loadHpCfg(); await renderFeaturedList(_cfg.pinnedIds || _cfg.featuredIds || []);
      }
    }

    // ── Boot ──────────────────────────────────────────────────────────────
    withLoader(async () => {
      if (!requireAdmin()) return;
      await injectAdminLayout('Customer Reviews');
      await initHpPanel();

      try {
        await renderReviews();
      } catch(e) {
        console.error('[Reviews] renderReviews boot error:', e);
        const tbody = document.getElementById('reviews-tbody');
        if (tbody) tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--clr-text-3)">Could not load reviews — please refresh the page.</td></tr>`;
      }

      document.getElementById('filter-status')?.addEventListener('change', async e => await renderReviews(e.target.value));
      document.getElementById('review-search')?.addEventListener('input', e => {
        const q = e.target.value.toLowerCase();
        document.querySelectorAll('#reviews-tbody tr').forEach(row => {
          row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
        });
      });

      // Select-all checkbox
      document.getElementById('select-all-cb')?.addEventListener('change', e => {
        document.querySelectorAll('.row-cb').forEach(cb => {
          cb.checked = e.target.checked;
          const row = cb.closest('tr');
          if (row) row.style.background = e.target.checked ? 'rgba(201,168,76,.07)' : '';
        });
        updateBulkBar();
      });

      // Bulk action buttons
      document.getElementById('bulk-approve')?.addEventListener('click', () => applyBulkAction('approve'));
      document.getElementById('bulk-reject')?.addEventListener('click',  () => applyBulkAction('reject'));
      document.getElementById('bulk-delete')?.addEventListener('click',  async () => {
        const n = document.querySelectorAll('.row-cb:checked').length;
        const ok = await adminConfirm({ title: `Delete ${n} review${n !== 1 ? 's' : ''}?`, message: 'These reviews will be permanently removed.', confirm: 'Delete', danger: true });
        if (ok) applyBulkAction('delete');
      });
      document.getElementById('bulk-clear')?.addEventListener('click', () => {
        document.querySelectorAll('.row-cb').forEach(cb => { cb.checked = false; const row = cb.closest('tr'); if (row) row.style.background = ''; });
        const selAll = document.getElementById('select-all-cb'); if (selAll) { selAll.checked = false; selAll.indeterminate = false; }
        updateBulkBar();
      });
    });

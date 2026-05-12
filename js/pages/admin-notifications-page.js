import { withLoader }        from '../../js/loader.js';
import { adminConfirm }      from '../../js/admin/admin-confirm.js';
import { requireAdmin }      from '../../js/admin/admin-auth.js';
import { injectAdminLayout } from '../../js/admin/admin-layout.js';
import { getOrders, getProducts, getNewsletterSubscribers, deleteNewsletterSubscriber } from '../../js/store-adapter.js';
import { getMessages, markRead, markAllRead, deleteMessage, unreadCount } from '../../js/contact-messages.js';
import toast from '../../js/toast.js';

// ── Helpers ──────────────────────────────────────────────────
function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function fmtTime(iso) {
  try { return new Date(iso).toLocaleString('en-LK', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }); }
  catch { return iso; }
}
function fmtRelative(iso) {
  const diff  = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins  < 1)  return 'Just now';
  if (mins  < 60) return mins + 'm ago';
  if (hours < 24) return hours + 'h ago';
  if (days  < 7)  return days + 'd ago';
  return fmtTime(iso);
}
function setBadge(id, count, hide0 = true) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = count > 9 ? '9+' : String(count || '');
  el.style.display = (hide0 && !count) ? 'none' : '';
}

// ── Tab switching ─────────────────────────────────────────────
let activeTab = 'alerts';
function switchTab(tab) {
  activeTab = tab;
  ['alerts','messages','newsletter'].forEach(t => {
    const panel = document.getElementById('tab-' + t);
    const btn   = document.querySelector(`.n-tab[data-tab="${t}"]`);
    if (panel) panel.style.display = t === tab ? '' : 'none';
    btn?.classList.toggle('active', t === tab);
  });
}

// ── ALERTS ────────────────────────────────────────────────────
async function renderAlerts() {
  const orders   = await getOrders();
  const products = await getProducts();
  const items    = [];

  const COLOR = { warning: 'var(--clr-warning)', error: 'var(--clr-error)', success: 'var(--clr-success)', gold: 'var(--clr-gold)', info: 'var(--clr-info,#3498db)' };
  const BG    = { warning: 'var(--clr-warning-bg)', error: 'var(--clr-error-bg)', success: 'var(--clr-success-bg)', gold: 'var(--clr-gold-bg)', info: 'var(--clr-info-bg,rgba(52,152,219,.12))' };

  orders.filter(o => o.status === 'pending').slice(0, 5).forEach(o => items.push({
    type: 'warning', icon: 'fa-solid fa-clock',
    title: 'Pending order: ' + o.id,
    desc:  esc(o.customerName) + ' · Rs. ' + (o.total||0).toLocaleString() + ' · ' + (o.paymentMethod === 'cod' ? 'COD' : o.paymentMethod === 'bank' ? 'Bank Transfer' : 'PayHere'),
    time: o.createdAt, link: 'order-detail.html?id=' + o.id, badge: 'Pending',
  }));

  orders.filter(o => o.paymentMethod === 'bank' && o.paymentStatus === 'pending').forEach(o => items.push({
    type: 'gold', icon: 'fa-solid fa-building-columns',
    title: 'Bank transfer pending verification: ' + o.id,
    desc:  esc(o.customerName) + ' · Rs. ' + (o.total||0).toLocaleString() + (o.paymentSlip ? ' · Slip uploaded' : ' · No slip yet'),
    time: o.createdAt, link: 'order-detail.html?id=' + o.id, badge: 'Verify',
  }));

  products.filter(p => p.active !== false && p.stock > 0 && p.stock <= 10).forEach(p => items.push({
    type: 'warning', icon: 'fa-solid fa-triangle-exclamation',
    title: 'Low stock: ' + esc(p.name),
    desc:  'Only ' + p.stock + ' unit' + (p.stock !== 1 ? 's' : '') + ' remaining — restock soon',
    time: new Date().toISOString(), link: 'product-edit.html?id=' + p.id, badge: 'Low Stock',
  }));

  products.filter(p => p.active !== false && p.stock === 0).forEach(p => items.push({
    type: 'error', icon: 'fa-solid fa-circle-xmark',
    title: 'Out of stock: ' + esc(p.name),
    desc:  '0 units remaining — update inventory to keep selling',
    time: new Date().toISOString(), link: 'product-edit.html?id=' + p.id, badge: 'OOS',
  }));

  orders.filter(o => o.status === 'delivered').slice(0, 3).forEach(o => items.push({
    type: 'success', icon: 'fa-solid fa-circle-check',
    title: 'Delivered: ' + o.id,
    desc:  esc(o.customerName) + ' · Rs. ' + (o.total||0).toLocaleString(),
    time: o.updatedAt || o.createdAt, link: 'order-detail.html?id=' + o.id, badge: 'Delivered',
  }));

  items.sort((a, b) => new Date(b.time) - new Date(a.time));

  setBadge('alert-badge', items.length);
  const info = document.getElementById('alert-info');
  if (info) info.textContent = items.length + ' alert' + (items.length !== 1 ? 's' : '');

  const container = document.getElementById('alerts-list');
  if (!container) return;

  if (!items.length) {
    container.innerHTML = `
      <div class="n-empty">
        <div class="n-empty__icon"><i class="fa-solid fa-bell-slash"></i></div>
        <h3>All clear!</h3>
        <p>No alerts right now — everything is running smoothly.</p>
      </div>`;
    return;
  }

  container.innerHTML = items.map(n => `
    <div class="alert-item">
      <div class="alert-icon" style="background:${BG[n.type]};color:${COLOR[n.type]}">
        <i class="${n.icon}"></i>
      </div>
      <div class="alert-body">
        <div class="alert-title">
          ${n.title}
          <span class="badge" style="background:${BG[n.type]};color:${COLOR[n.type]};font-size:.68rem;margin-left:.5rem">${n.badge}</span>
        </div>
        <div class="alert-desc">${n.desc}</div>
        <div class="alert-foot">
          <span class="alert-time">${fmtRelative(n.time)}</span>
          ${n.link ? `<a href="${n.link}" class="alert-link">View details →</a>` : ''}
        </div>
      </div>
    </div>`).join('');
}

// ── MESSAGES ──────────────────────────────────────────────────
async function renderMessages() {
  const msgs   = await getMessages();
  const unread = msgs.filter(m => !m.read).length;

  setBadge('msg-badge', unread);

  const info    = document.getElementById('msg-info');
  const actions = document.getElementById('msg-actions');
  const list    = document.getElementById('msg-list');
  if (!list) return;

  if (info) info.textContent = msgs.length
    ? msgs.length + ' message' + (msgs.length !== 1 ? 's' : '') + (unread ? ' · ' + unread + ' unread' : ' · all read')
    : '';

  if (actions) {
    actions.innerHTML = '';
    if (unread) {
      const markBtn = document.createElement('button');
      markBtn.className = 'btn btn-ghost btn-sm';
      markBtn.innerHTML = '<i class="fa-solid fa-check-double"></i> Mark all read';
      markBtn.addEventListener('click', async () => {
        await markAllRead();
        await renderMessages();
        toast.success('Done', 'All messages marked as read.');
      });
      actions.appendChild(markBtn);
    }
    if (msgs.length) {
      const clrBtn = document.createElement('button');
      clrBtn.className = 'btn btn-ghost btn-sm';
      clrBtn.style.color = 'var(--clr-error)';
      clrBtn.innerHTML = '<i class="fa-solid fa-trash"></i> Delete all';
      clrBtn.addEventListener('click', async () => {
        const ok = await adminConfirm({ title: 'Delete all messages?', message: 'This will permanently remove every contact message.', confirm: 'Delete All', danger: true });
        if (!ok) return;
        const all = await getMessages();
        await Promise.all(all.map(m => deleteMessage(m.id)));
        await renderMessages();
        toast.success('Cleared', 'All messages deleted.');
      });
      actions.appendChild(clrBtn);
    }
  }

  if (!msgs.length) {
    list.innerHTML = `
      <div class="n-empty">
        <div class="n-empty__icon"><i class="fa-solid fa-envelope-open"></i></div>
        <h3>No messages yet</h3>
        <p>Contact form submissions will appear here.</p>
      </div>`;
    return;
  }

  list.innerHTML = msgs.map(msg => {
    const initials = ((msg.firstName || '?')[0] + (msg.lastName || '')[0]).toUpperCase();
    return `
    <div class="msg-card${msg.read ? '' : ' unread'}" data-id="${esc(msg.id)}">
      <div class="msg-card__header">
        ${!msg.read ? '<div class="msg-card__dot"></div>' : '<div style="width:8px;flex-shrink:0"></div>'}
        <div class="msg-card__avatar">${initials}</div>
        <div class="msg-card__info">
          <div class="msg-card__name">${esc(msg.firstName)} ${esc(msg.lastName)}</div>
          <div class="msg-card__subject">${esc(msg.subject)} <span style="color:var(--clr-text-3)">· ${esc(msg.email)}</span></div>
        </div>
        <span class="msg-card__time">${fmtRelative(msg.createdAt)}</span>
        <div class="msg-card__actions">
          <button class="icon-btn del msg-del-btn" title="Delete" data-id="${esc(msg.id)}">
            <i class="fa-solid fa-trash"></i>
          </button>
          <i class="fa-solid fa-chevron-down msg-card__chevron"></i>
        </div>
      </div>
      <div class="msg-card__body">
        <div class="msg-card__body-inner">
          ${msg.phone ? `<div class="msg-field"><span class="msg-field__label">Phone</span><a href="tel:${esc(msg.phone)}" class="msg-field__val" style="color:var(--clr-gold)">${esc(msg.phone)}</a></div>` : ''}
          <div class="msg-field"><span class="msg-field__label">Email</span><a href="mailto:${esc(msg.email)}" class="msg-field__val" style="color:var(--clr-gold)">${esc(msg.email)}</a></div>
          <div class="msg-field"><span class="msg-field__label">Subject</span><span class="msg-field__val">${esc(msg.subject)}</span></div>
          <div class="msg-field"><span class="msg-field__label">Sent</span><span class="msg-field__val">${fmtTime(msg.createdAt)}</span></div>
          <div class="msg-message">${esc(msg.message)}</div>
          <div class="msg-card__footer">
            <a href="mailto:${esc(msg.email)}?subject=${encodeURIComponent('Re: ' + msg.subject)}" class="btn btn-primary btn-sm">
              <i class="fa-solid fa-reply"></i> Reply via Email
            </a>
            ${msg.phone ? `<a href="tel:${esc(msg.phone)}" class="btn btn-ghost btn-sm"><i class="fa-solid fa-phone"></i> Call</a>` : ''}
            <button class="btn btn-ghost btn-sm msg-del-btn" data-id="${esc(msg.id)}" style="margin-left:auto;color:var(--clr-error)">
              <i class="fa-solid fa-trash"></i> Delete
            </button>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');

  // ── Event delegation for the messages list ──────────────
  list.addEventListener('click', async (e) => {
    const delBtn = e.target.closest('.msg-del-btn');
    if (delBtn) {
      e.stopPropagation();
      const id = delBtn.dataset.id;
      const ok = await adminConfirm({ title: 'Delete message?', message: 'This contact message will be permanently removed.', confirm: 'Delete', danger: true });
      if (!ok) return;
      await deleteMessage(id);
      await renderMessages();
      toast.success('Deleted', 'Message removed.');
      return;
    }

    const header = e.target.closest('.msg-card__header');
    if (header) {
      const card    = header.closest('.msg-card');
      if (!card) return;
      const id      = card.dataset.id;
      const body    = card.querySelector('.msg-card__body');
      const chevron = card.querySelector('.msg-card__chevron');
      const isOpen  = body?.classList.toggle('open');
      chevron?.classList.toggle('open', isOpen);

      if (isOpen && !card.classList.contains('read-done')) {
        card.classList.add('read-done');
        markRead(id);
        card.classList.remove('unread');
        card.querySelector('.msg-card__dot')?.remove();
        const freshMsgs = await getMessages();
        setBadge('msg-badge', freshMsgs.filter(m => !m.read).length);
        const info = document.getElementById('msg-info');
        if (info) {
          const unread2 = freshMsgs.filter(m => !m.read).length;
          info.textContent = freshMsgs.length + ' message' + (freshMsgs.length !== 1 ? 's' : '') + (unread2 ? ' · ' + unread2 + ' unread' : ' · all read');
        }
      }
    }
  }, false);
}

// ── NEWSLETTER ────────────────────────────────────────────────
async function renderNewsletter() {
  const container = document.getElementById('nl-list');
  if (!container) return;

  let subs = [];
  try {
    // Use admin API (service-role) so RLS is bypassed and all rows are returned
    const token = sessionStorage.getItem('zm_admin_api_token') || '';
    const res = await fetch('/api/admin/newsletter', {
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
    });
    if (res.ok) {
      const body = await res.json();
      subs = (body.subscribers || []).map(s => ({
        ...s,
        subscribedAt: s.subscribed_at || s.subscribedAt,
      }));
    } else {
      throw new Error('API error');
    }
  } catch {
    // Fallback: anon Supabase client
    try {
      subs = await getNewsletterSubscribers();
      subs = subs.map(s => ({ ...s, subscribedAt: s.subscribed_at || s.subscribedAt }));
    } catch {
      // Last resort: localStorage (demo / offline)
      try { subs = JSON.parse(localStorage.getItem('zm_newsletter_emails') || '[]'); } catch {}
    }
  }
  subs.sort((a, b) => new Date(b.subscribedAt) - new Date(a.subscribedAt));

  setBadge('nl-badge', subs.length);
  const info   = document.getElementById('nl-info');
  const expBtn = document.getElementById('nl-export-btn');
  if (info)   info.textContent = subs.length + ' subscriber' + (subs.length !== 1 ? 's' : '');
  if (expBtn) expBtn.style.display = subs.length ? '' : 'none';

  if (!subs.length) {
    container.innerHTML = `
      <div class="n-empty">
        <div class="n-empty__icon"><i class="fa-solid fa-paper-plane"></i></div>
        <h3>No subscribers yet</h3>
        <p>Newsletter sign-ups from your store will appear here.</p>
      </div>`;
    return;
  }

  container.innerHTML = `
    <div class="admin-table-wrap">
      <table class="admin-table" style="width:100%">
        <thead><tr>
          <th style="width:2.5rem">#</th>
          <th>Email Address</th>
          <th>Subscribed</th>
          <th style="width:3rem"></th>
        </tr></thead>
        <tbody>
          ${subs.map((s, i) => `
            <tr>
              <td class="nl-num">${i + 1}</td>
              <td class="nl-email">${esc(s.email)}</td>
              <td class="nl-date">${fmtTime(s.subscribedAt)}</td>
              <td>
                <button class="icon-btn del nl-del-btn" data-email="${esc(s.email)}" title="Remove subscriber">
                  <i class="fa-solid fa-trash"></i>
                </button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  container.querySelectorAll('.nl-del-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const email = btn.dataset.email;
      try {
        // Try admin API first (service-role)
        const token = sessionStorage.getItem('zm_admin_api_token') || '';
        const res = await fetch(`/api/admin/newsletter?email=${encodeURIComponent(email)}`, {
          method: 'DELETE',
          headers: { 'X-Admin-Token': token },
        });
        if (!res.ok) throw new Error('API error');
      } catch {
        // Fallback: anon Supabase or localStorage
        try {
          await deleteNewsletterSubscriber(email);
        } catch {
          let subs2 = [];
          try { subs2 = JSON.parse(localStorage.getItem('zm_newsletter_emails') || '[]'); } catch {}
          subs2 = subs2.filter(s => s.email !== email);
          localStorage.setItem('zm_newsletter_emails', JSON.stringify(subs2));
        }
      }
      await renderNewsletter();
      toast.success('Removed', email + ' removed from newsletter.');
    });
  });
}

// ── Export CSV ────────────────────────────────────────────────
async function exportNewsletter() {
  let subs = [];
  try {
    const token = sessionStorage.getItem('zm_admin_api_token') || '';
    const res = await fetch('/api/admin/newsletter', {
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
    });
    if (res.ok) {
      const body = await res.json();
      subs = (body.subscribers || []).map(s => ({ ...s, subscribedAt: s.subscribed_at || s.subscribedAt }));
    } else throw new Error('API error');
  } catch {
    try {
      subs = await getNewsletterSubscribers();
      subs = subs.map(s => ({ ...s, subscribedAt: s.subscribed_at || s.subscribedAt }));
    } catch {
      try { subs = JSON.parse(localStorage.getItem('zm_newsletter_emails') || '[]'); } catch {}
    }
  }
  if (!subs.length) { toast.info('Empty', 'No subscribers to export.'); return; }
  const csv  = 'Email,Subscribed At\n' + subs.map(s => `"${s.email}","${s.subscribedAt || s.subscribed_at || ''}"`).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a    = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'newsletter-subscribers.csv';
  a.click();
  toast.success('Exported', subs.length + ' subscribers exported.');
}

// ── Init ──────────────────────────────────────────────────────
withLoader(async () => {
  if (!requireAdmin()) return;
  await injectAdminLayout('Messages');

  // Render all tabs (messages tab is async — awaited so names load before paint)
  await renderAlerts();
  await renderMessages();
  await renderNewsletter();

  // Tab buttons
  document.querySelectorAll('.n-tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Refresh button
  document.getElementById('refresh-btn')?.addEventListener('click', async () => {
    await renderAlerts();
    await renderMessages();
    await renderNewsletter();
    toast.success('Refreshed', 'Data updated.');
  });

  // Newsletter export
  document.getElementById('nl-export-btn')?.addEventListener('click', exportNewsletter);
});

/* ============================================================
   ZENMARKET — CONTACT MESSAGES
   Admin reads  → /api/admin/contact-messages (service-role, bypasses RLS)
   Public write → Supabase anon client (or localStorage fallback)
   ============================================================ */
import { DEMO_MODE } from './config.js';
import { getAdminToken } from './admin-api.js';

export const LS_KEY = 'zm_contact_messages';

async function _store() {
  if (DEMO_MODE) return null;
  return import('./supabase-store.js');
}

function _lsLoad() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]').sort((a,b) => new Date(b.createdAt)-new Date(a.createdAt)); }
  catch { return []; }
}
function _lsSave(arr) { localStorage.setItem(LS_KEY, JSON.stringify(arr)); }

// ── Admin reads via service-role API ─────────────────────────
async function _adminFetch(path, options = {}) {
  const token = getAdminToken();
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token, ...(options.headers || {}) },
  });
  let body = {};
  try { body = await res.json(); } catch {}
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

export async function getMessages() {
  // Try admin API first (service-role — bypasses RLS so all rows are returned)
  try {
    const token = getAdminToken();
    if (token) {
      const data = await _adminFetch('/api/admin/contact-messages');
      return data.messages || [];
    }
  } catch (e) { console.warn('[getMessages] Admin API failed:', e.message); }

  // Fallback: anon Supabase client
  try {
    const store = await _store();
    if (store) return store.getContactMessages();
  } catch (e) { console.warn('[getMessages] Supabase failed:', e.message); }

  return _lsLoad();
}

export async function addMessage(fields) {
  const msg = {
    id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2,7),
    firstName: fields.firstName || '', lastName: fields.lastName || '',
    email: fields.email || '', phone: fields.phone || '',
    subject: fields.subject || '', message: fields.message || '',
    createdAt: new Date().toISOString(), read: false,
  };
  try {
    const store = await _store();
    if (store) {
      await store.saveContactMessage({
        id: msg.id, first_name: msg.firstName, last_name: msg.lastName,
        email: msg.email, phone: msg.phone, subject: msg.subject,
        message: msg.message, read: false,
      });
      return msg;
    }
  } catch (e) { console.warn('[addMessage] Supabase failed:', e.message); }
  // localStorage fallback
  const all = _lsLoad(); all.unshift(msg); _lsSave(all); return msg;
}

export async function markRead(id) {
  // Try admin API (service-role)
  try {
    const token = getAdminToken();
    if (token) {
      await _adminFetch(`/api/admin/contact-messages?id=${encodeURIComponent(id)}`, { method: 'PUT' });
      return;
    }
  } catch (e) { console.warn('[markRead] Admin API failed:', e.message); }

  try {
    const store = await _store();
    if (store) { await store.markContactMessageRead(id); return; }
  } catch (e) { console.warn('[markRead] Supabase failed:', e.message); }

  const all = _lsLoad(); const idx = all.findIndex(m=>m.id===id);
  if (idx !== -1) { all[idx].read=true; _lsSave(all); }
}

export async function deleteMessage(id) {
  // Try admin API (service-role)
  try {
    const token = getAdminToken();
    if (token) {
      await _adminFetch(`/api/admin/contact-messages?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      return;
    }
  } catch (e) { console.warn('[deleteMessage] Admin API failed:', e.message); }

  try {
    const store = await _store();
    if (store) { await store.deleteContactMessage(id); return; }
  } catch (e) { console.warn('[deleteMessage] Supabase failed:', e.message); }

  _lsSave(_lsLoad().filter(m=>m.id!==id));
}

export async function markAllRead() {
  try {
    const token = getAdminToken();
    if (token) {
      const data = await _adminFetch('/api/admin/contact-messages');
      const unread = (data.messages || []).filter(m => !m.read);
      await Promise.all(unread.map(m =>
        _adminFetch(`/api/admin/contact-messages?id=${encodeURIComponent(m.id)}`, { method: 'PUT' })
      ));
      return;
    }
  } catch (e) { console.warn('[markAllRead] Admin API failed:', e.message); }

  try {
    const store = await _store();
    if (store) {
      const msgs = await store.getContactMessages();
      await Promise.all(msgs.filter(m=>!m.read).map(m=>store.markContactMessageRead(m.id)));
      return;
    }
  } catch (e) { console.warn('[markAllRead] Supabase failed:', e.message); }

  _lsSave(_lsLoad().map(m=>({...m,read:true})));
}

export async function unreadCount() {
  return (await getMessages()).filter(m => !m.read).length;
}


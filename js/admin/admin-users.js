/* ============================================================
   ZENMARKET — ADMIN USERS  (v3 — Supabase backend)
   ============================================================ */
import { adminConfirm }      from './admin-confirm.js';
import { requireAdmin }      from './admin-auth.js';
import { injectAdminLayout } from './admin-layout.js';
import { withLoader }        from '../loader.js';
import { getSupabase }       from '../supabase.js';
import { formatPrice }       from '../utils.js';
import AdminAPI              from '../admin-api.js';
import toast from '../toast.js';
import { esc } from '../security-utils.js';

let allUsers = [];

// ── Supabase helpers ──────────────────────────────────────────
async function fetchUsersFromSupabase() {
  const sb = getSupabase();
  if (!sb) {
    const { getUsers } = await import('../store.js');
    return getUsers();
  }

  // Use the serverless API (service role key) so RLS is bypassed
  // and ALL profile rows are returned — not just the current user's.
  try {
    const result = await AdminAPI.users.list();
    return result.users || [];
  } catch (err) {
    console.error('[AdminUsers] API fetch error:', err);
    toast.error('Error', 'Failed to load users from database');
    return [];
  }
}

async function saveUserToSupabase(user) {
  // Use the serverless API (service role key) so RLS is bypassed.
  // Direct Supabase client upsert would fail due to RLS on profiles table.
  try {
    await AdminAPI.users.update(user.id, {
      name:   user.name,
      email:  user.email,
      phone:  user.phone || '',
      role:   user.role,
      active: user.active !== false,
    });
  } catch (err) {
    // If you see "row-level security" in this error, run the SQL migration at
    // supabase/migrations/fix_profiles_rls.sql in your Supabase SQL Editor.
    throw err;
  }
}

async function deleteUserFromSupabase(id) {
  const sb = getSupabase();
  if (!sb) {
    // Demo / localStorage mode — just remove from local list
    const { saveUsers } = await import('../store.js');
    allUsers = allUsers.filter(u => u.id !== id);
    saveUsers(allUsers);
    return;
  }

  // Call the serverless endpoint which uses the service role key to
  // call auth.admin.deleteUser(). This removes the row from auth.users
  // so the account is fully gone and the user can no longer log in.
  // The profiles table has ON DELETE CASCADE, so no second query is needed.
  await AdminAPI.users.delete(id);
}

// ── Render table ──────────────────────────────────────────────
function renderTable(filter = '') {
  const shown = filter
    ? allUsers.filter(u =>
        (u.name  || '').toLowerCase().includes(filter) ||
        (u.email || '').toLowerCase().includes(filter) ||
        (u.phone || '').includes(filter))
    : allUsers;

  const tbody   = document.getElementById('users-tbody');
  const countEl = document.getElementById('users-count');
  if (!tbody) return;
  if (countEl) countEl.textContent = `${allUsers.length} users`;

  if (!shown.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--clr-text-3)">No users found</td></tr>`;
    return;
  }

  tbody.innerHTML = shown.map(u => `
    <tr style="${u.active === false ? 'opacity:.5' : ''}">
      <td>
        <div style="display:flex;align-items:center;gap:.75rem">
          <div style="width:38px;height:38px;border-radius:50%;background:var(--clr-gold-bg);
               display:flex;align-items:center;justify-content:center;
               color:var(--clr-gold);font-weight:700;font-size:.9375rem;flex-shrink:0">
            ${((u.name || u.email || '?')[0]).toUpperCase()}
          </div>
          <div>
            <div style="font-weight:500;color:var(--clr-text);font-size:.9375rem">${esc(u.name)}</div>
            <div style="font-size:.75rem;color:var(--clr-text-3);font-family:var(--ff-mono)">${esc(u.id)}</div>
          </div>
        </div>
      </td>
      <td style="color:var(--clr-text-2)">${esc(u.email)}</td>
      <td style="color:var(--clr-text-2)">${esc(u.phone) || '—'}</td>
      <td>
        <span class="badge ${u.role === 'admin' ? 'badge-gold' : 'badge-blue'}">${u.role}</span>
      </td>
      <td>
        <span class="badge ${u.active !== false ? 'badge-green' : 'badge-gray'}">
          ${u.active !== false ? 'Active' : 'Suspended'}
        </span>
      </td>
      <td style="font-family:var(--ff-mono);color:var(--clr-text-2)">${u.orders || 0}</td>
      <td style="font-family:var(--ff-mono);color:var(--clr-gold)">${formatPrice(u.totalSpent || 0)}</td>
      <td>
        <div style="display:flex;gap:.5rem;align-items:center">
          <button class="btn btn-ghost btn-sm edit-user-btn" data-id="${esc(u.id)}" title="Edit user">
            <i class="fa-solid fa-pen-to-square"></i>
          </button>
          <button class="btn btn-ghost btn-sm toggle-status-btn" data-id="${esc(u.id)}"
            title="${u.active !== false ? 'Suspend' : 'Restore'}"
            style="color:${u.active !== false ? 'var(--clr-warning)' : 'var(--clr-success)'}">
            <i class="fa-solid ${u.active !== false ? 'fa-ban' : 'fa-circle-check'}"></i>
          </button>
          ${u.role !== 'admin' ? `
            <button class="btn btn-ghost btn-sm delete-user-btn" data-id="${esc(u.id)}" data-name="${esc(u.name)}"
              title="Delete user" style="color:var(--clr-error)">
              <i class="fa-solid fa-trash"></i>
            </button>` : ''}
        </div>
      </td>
    </tr>`).join('');

  tbody.querySelectorAll('.edit-user-btn').forEach(btn => {
    btn.addEventListener('click', () => openEditModal(btn.dataset.id));
  });

  tbody.querySelectorAll('.toggle-status-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx = allUsers.findIndex(u => u.id === btn.dataset.id);
      if (idx < 0) return;
      if (allUsers[idx].role === 'admin') { toast.error('Blocked', 'Cannot suspend admin account'); return; }
      allUsers[idx].active = allUsers[idx].active === false ? true : false;
      try {
        await saveUserToSupabase(allUsers[idx]);
        toast.info('Updated', `${allUsers[idx].name} ${allUsers[idx].active ? 'restored' : 'suspended'}`);
        renderTable(document.getElementById('user-search')?.value.toLowerCase() || '');
      } catch (e) { toast.error('Error', e.message); }
    });
  });

  tbody.querySelectorAll('.delete-user-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const { id, name } = btn.dataset;
      const ok = await adminConfirm({
        title: `Delete user "${name}"?`,
        message: 'This will permanently remove the account. Cannot be undone.',
        confirm: 'Delete', danger: true,
      });
      if (!ok) return;
      try {
        await deleteUserFromSupabase(id);
        allUsers = allUsers.filter(u => u.id !== id);
        toast.success('Deleted', `${name} has been removed`);
        renderStats();
        renderTable(document.getElementById('user-search')?.value.toLowerCase() || '');
      } catch (e) { toast.error('Error', e.message); }
    });
  });
}

// ── Edit Modal ────────────────────────────────────────────────
function openEditModal(id) {
  const user = allUsers.find(u => u.id === id);
  if (!user) return;

  document.getElementById('user-edit-modal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'user-edit-modal';
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal modal-sm" style="max-width:520px">
      <div class="modal-header">
        <h3 class="modal-title">Edit User</h3>
        <button class="modal-close" id="close-user-modal" aria-label="Close">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">Full Name</label>
          <input class="form-control" type="text" id="edit-name" value="${esc(user.name)}">
        </div>
        <div class="form-group">
          <label class="form-label">Email</label>
          <input class="form-control" type="email" id="edit-email" value="${esc(user.email)}"
            disabled style="opacity:.6;cursor:not-allowed"
            title="Email is managed by Supabase Auth">
        </div>
        <div class="form-group">
          <label class="form-label">Phone</label>
          <input class="form-control" type="tel" id="edit-phone" value="${esc(user.phone) || ''}">
        </div>
        <div class="form-group">
          <label class="form-label">Role</label>
          <select class="form-control" id="edit-role">
            <option value="customer" ${user.role === 'customer' ? 'selected' : ''}>Customer</option>
            <option value="admin"    ${user.role === 'admin'    ? 'selected' : ''}>Admin</option>
          </select>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" id="cancel-user-edit">Cancel</button>
        <button class="btn btn-primary" id="save-user-edit">
          <i class="fa-solid fa-circle-check"></i> Save Changes
        </button>
      </div>
    </div>`;

  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add('open'));

  const close = () => { modal.classList.remove('open'); setTimeout(() => modal.remove(), 300); };
  document.getElementById('close-user-modal')?.addEventListener('click', close);
  document.getElementById('cancel-user-edit')?.addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });

  document.getElementById('save-user-edit')?.addEventListener('click', async () => {
    const name  = document.getElementById('edit-name')?.value.trim();
    const phone = document.getElementById('edit-phone')?.value.trim();
    const role  = document.getElementById('edit-role')?.value;
    if (!name) { toast.error('Required', 'Name is required'); return; }

    const idx = allUsers.findIndex(u => u.id === id);
    if (idx >= 0) {
      allUsers[idx] = { ...allUsers[idx], name, phone, role, updatedAt: new Date().toISOString() };
      try {
        await saveUserToSupabase(allUsers[idx]);
        toast.success('Saved', `${name} updated successfully`);
        close();
        renderStats();
        renderTable(document.getElementById('user-search')?.value.toLowerCase() || '');
      } catch (e) { toast.error('Error', e.message); }
    }
  });
}

// ── Add User Modal ────────────────────────────────────────────
function openAddModal() {
  document.getElementById('user-add-modal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'user-add-modal';
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal modal-sm">
      <div class="modal-header">
        <h3 class="modal-title">Add New User</h3>
        <button class="modal-close" id="close-add-modal" aria-label="Close">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label required">Full Name</label>
          <input class="form-control" type="text" id="add-name" placeholder="e.g. Dinusha Perera">
        </div>
        <div class="form-group">
          <label class="form-label required">Email Address</label>
          <input class="form-control" type="email" id="add-email" placeholder="user@email.com">
        </div>
        <div class="form-group">
          <label class="form-label required">Password</label>
          <div style="position:relative">
            <input class="form-control" type="password" id="add-password" placeholder="Min 8 characters" style="padding-right:2.75rem">
            <button type="button" id="toggle-add-password"
              style="position:absolute;right:.75rem;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:var(--clr-text-3);padding:0;line-height:1">
              <i class="fa-solid fa-eye"></i>
            </button>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Phone Number</label>
          <div style="position:relative;display:flex;align-items:center">
            <span style="position:absolute;left:.875rem;color:var(--clr-text-2);font-size:.9375rem;pointer-events:none;z-index:1">+94</span>
            <input class="form-control" type="tel" id="add-phone"
              placeholder="7X XXX XXXX"
              maxlength="12"
              style="padding-left:3rem">
          </div>
          <div id="add-phone-hint" style="font-size:.75rem;color:var(--clr-text-3);margin-top:.35rem">9 digits after +94 &bull; e.g. 71 234 5678</div>
        </div>
        <div class="form-group">
          <label class="form-label">Role</label>
          <select class="form-control" id="add-role">
            <option value="customer">Customer</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <div id="add-user-error" style="display:none;background:var(--clr-error-bg);color:var(--clr-error);padding:.75rem;border-radius:var(--r-md);font-size:.875rem"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" id="cancel-add-user">Cancel</button>
        <button class="btn btn-primary" id="confirm-add-user">
          <i class="fa-solid fa-user-plus"></i> Add User
        </button>
      </div>
    </div>`;

  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add('open'));

  const close = () => { modal.classList.remove('open'); setTimeout(() => modal.remove(), 300); };
  document.getElementById('close-add-modal')?.addEventListener('click', close);
  document.getElementById('cancel-add-user')?.addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });


  // Phone: digits only, real-time validation
  const phoneInp  = document.getElementById('add-phone');
  const phoneHint = document.getElementById('add-phone-hint');
  phoneInp?.addEventListener('input', () => {
    phoneInp.value = phoneInp.value.replace(/\D/g, '');
    const len = phoneInp.value.length;
    if (len === 0) {
      phoneHint.style.color = 'var(--clr-text-3)';
      phoneHint.textContent = '9 digits after +94 \u2022 e.g. 71 234 5678';
    } else if (len < 9) {
      phoneHint.style.color = 'var(--clr-warning, #f59e0b)';
      phoneHint.textContent = `${9 - len} more digit${9 - len > 1 ? 's' : ''} needed`;
    } else {
      phoneHint.style.color = 'var(--clr-success, #22c55e)';
      phoneHint.textContent = '\u2713 Valid Sri Lanka number';
    }
  });
  phoneInp?.addEventListener('keydown', e => {
    if (['Backspace','Delete','Tab','ArrowLeft','ArrowRight'].includes(e.key)) return;
    if (!/^\d$/.test(e.key)) e.preventDefault();
  });

  // Toggle password visibility
  document.getElementById('toggle-add-password')?.addEventListener('click', () => {
    const inp = document.getElementById('add-password');
    const ico = document.querySelector('#toggle-add-password i');
    if (!inp) return;
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    ico.className = show ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
  });

  document.getElementById('confirm-add-user')?.addEventListener('click', async () => {
    const name     = document.getElementById('add-name')?.value.trim();
    const email    = document.getElementById('add-email')?.value.trim();
    const password = document.getElementById('add-password')?.value;
    const phoneRaw = document.getElementById('add-phone')?.value.replace(/\D/g, '') || '';
    const phone    = phoneRaw ? '+94' + phoneRaw : '';
    const role     = document.getElementById('add-role')?.value;
    const errEl    = document.getElementById('add-user-error');

    if (!name || !email) { errEl.textContent = 'Name and email are required'; errEl.style.display = 'block'; return; }
    if (!password || password.length < 8) { errEl.textContent = 'Password must be at least 8 characters'; errEl.style.display = 'block'; return; }
    if (phoneRaw && phoneRaw.length !== 9) { errEl.textContent = 'Phone number must be 9 digits after +94 (e.g. 71 234 5678)'; errEl.style.display = 'block'; return; }
    if (allUsers.find(u => u.email === email)) { errEl.textContent = 'A user with this email already exists'; errEl.style.display = 'block'; return; }

    errEl.style.display = 'none';
    const btn = document.getElementById('confirm-add-user');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Adding…';

    try {
      // Use the serverless API (service role) to create the auth user + profile.
      // Direct Supabase insert would be blocked by RLS.
      const result = await AdminAPI.users.create({ name, email, password, phone, role });
      const newUser = {
        id: result.user.id,
        name, email,
        phone: phone || '',
        role: result.user.role || role,
        orders: 0, totalSpent: 0, active: true,
        createdAt: new Date().toISOString(),
      };
      allUsers.unshift(newUser);
      toast.success('Added', `${name} has been added and can log in immediately.`);
      close();
      renderStats();
      renderTable(document.getElementById('user-search')?.value.toLowerCase() || '');
    } catch (e) {
      errEl.textContent = e.message;
      errEl.style.display = 'block';
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-user-plus"></i> Add User';
    }
  });
}

// ── Stats cards ───────────────────────────────────────────────
function renderStats() {
  const customers = allUsers.filter(u => u.role === 'customer').length;
  const admins    = allUsers.filter(u => u.role === 'admin').length;
  const suspended = allUsers.filter(u => u.active === false).length;

  const statsEl = document.getElementById('user-stats');
  if (!statsEl) return;
  statsEl.innerHTML = `
    <div class="kpi-card">
      <div class="kpi-icon" style="background:var(--clr-info-bg);color:var(--clr-info)"><i class="fa-solid fa-users"></i></div>
      <div class="kpi-label">Total Users</div>
      <div class="kpi-value">${allUsers.length}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon" style="background:var(--clr-success-bg);color:var(--clr-success)"><i class="fa-regular fa-circle-user"></i></div>
      <div class="kpi-label">Customers</div>
      <div class="kpi-value">${customers}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon" style="background:var(--clr-gold-bg);color:var(--clr-gold)"><i class="fa-solid fa-shield-halved"></i></div>
      <div class="kpi-label">Admins</div>
      <div class="kpi-value">${admins}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon" style="background:var(--clr-error-bg);color:var(--clr-error)"><i class="fa-solid fa-ban"></i></div>
      <div class="kpi-label">Suspended</div>
      <div class="kpi-value">${suspended}</div>
    </div>`;
}

// ── Init ──────────────────────────────────────────────────────
withLoader(async () => {
  if (!requireAdmin()) return;
  await injectAdminLayout('Users');

  allUsers = await fetchUsersFromSupabase();
  renderStats();
  renderTable();

  document.getElementById('user-search')?.addEventListener('input', e => {
    renderTable(e.target.value.toLowerCase());
  });

  document.getElementById('add-user-btn')?.addEventListener('click', openAddModal);
});

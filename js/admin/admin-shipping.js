/* ============================================================
   ZENMARKET — ADMIN DELIVERY / SHIPPING ZONES  (grid card layout)
   ============================================================ */
import { requireAdmin }      from './admin-auth.js';
import { injectAdminLayout } from './admin-layout.js';
import { withLoader }        from '../loader.js';
import { getShippingZones, saveShippingZones } from '../store-adapter.js';
import { formatPrice }       from '../utils.js';
import toast from '../toast.js';
import { esc } from '../security-utils.js';

let zones = [];

// ── KPI row ───────────────────────────────────────────────────
function renderKpis() {
  const kpiEl = document.getElementById('shipping-kpis');
  if (!kpiEl) return;
  const avg  = zones.reduce((s, z) => s + z.rate, 0) / (zones.length || 1);
  const minR = Math.min(...zones.map(z => z.rate));
  const maxR = Math.max(...zones.map(z => z.rate));
  const allD = zones.flatMap(z => z.districts);
  kpiEl.innerHTML = `
    <div class="kpi-card">
      <div class="kpi-icon" style="background:var(--clr-info-bg);color:var(--clr-info)"><i class="fa-solid fa-map"></i></div>
      <div class="kpi-label">Total Zones</div>
      <div class="kpi-value">${zones.length}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon" style="background:var(--clr-gold-bg);color:var(--clr-gold)"><i class="fa-solid fa-location-dot"></i></div>
      <div class="kpi-label">Districts Covered</div>
      <div class="kpi-value">${allD.length}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon" style="background:var(--clr-success-bg);color:var(--clr-success)"><i class="fa-solid fa-arrow-down"></i></div>
      <div class="kpi-label">Lowest Rate</div>
      <div class="kpi-value">${formatPrice(minR)}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon" style="background:var(--clr-warning-bg);color:var(--clr-warning)"><i class="fa-solid fa-arrow-up"></i></div>
      <div class="kpi-label">Highest Rate</div>
      <div class="kpi-value">${formatPrice(maxR)}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon" style="background:var(--clr-error-bg);color:var(--clr-error)"><i class="fa-solid fa-coins"></i></div>
      <div class="kpi-label">Avg Rate</div>
      <div class="kpi-value">${formatPrice(Math.round(avg))}</div>
    </div>`;
}

// ── Zone grid cards ───────────────────────────────────────────
function renderGrid() {
  const grid = document.getElementById('zones-grid');
  if (!grid) return;

  grid.innerHTML = zones.map((z, idx) => `
    <div class="zone-card" data-idx="${idx}" id="zone-card-${idx}">

      <div class="zone-card-header">
        <div>
          <div class="zone-card-name">${esc(z.name)}</div>
          <div class="zone-card-id">${esc(z.id)}</div>
        </div>
        <i class="fa-solid fa-truck-fast" style="color:var(--clr-gold);opacity:.6;font-size:1.1rem"></i>
      </div>

      <div class="zone-fields">
        <div class="zone-field" style="grid-column:1/-1">
          <label>Delivery Cost</label>
          <div class="field-wrap">
            <span class="field-prefix">Rs.</span>
            <input type="number" class="zone-rate-input" data-idx="${idx}"
              value="${z.rate}" min="0" step="50" aria-label="Delivery rate for ${esc(z.name)}">
          </div>
        </div>
        <div class="zone-field">
          <label>From (days)</label>
          <div class="field-wrap">
            <input type="number" class="zone-min-input" data-idx="${idx}"
              value="${z.minDays || 1}" min="1" max="${z.maxDays || 7}" aria-label="Min delivery days">
          </div>
        </div>
        <div class="zone-field">
          <label>To (days)</label>
          <div class="field-wrap">
            <input type="number" class="zone-max-input" data-idx="${idx}"
              value="${z.maxDays || 7}" min="${z.minDays || 1}" max="30" aria-label="Max delivery days">
          </div>
        </div>
      </div>

      <div class="zone-districts">
        ${z.districts.map(d => `<span class="district-tag">${esc(d)}</span>`).join('')}
      </div>

      <div class="zone-card-footer">
        <button class="btn btn-success btn-sm save-zone-btn" data-idx="${idx}"
          style="font-size:.75rem;padding:.3rem .85rem">
          <i class="fa-solid fa-circle-check"></i> Save
        </button>
      </div>
    </div>`).join('');

  // Per-card save button
  grid.querySelectorAll('.save-zone-btn').forEach(btn => {
    btn.addEventListener('click', () => saveZone(parseInt(btn.dataset.idx)));
  });

  // Live cross-validation: keep min <= max as user types
  grid.querySelectorAll('.zone-min-input').forEach(minIn => {
    const idx    = minIn.dataset.idx;
    const maxIn  = grid.querySelector(`.zone-max-input[data-idx="${idx}"]`);
    minIn.addEventListener('input', () => {
      const minVal = parseInt(minIn.value) || 1;
      if (maxIn && parseInt(maxIn.value) < minVal) maxIn.value = minVal;
      if (maxIn) minIn.max = maxIn.value;
    });
  });

  grid.querySelectorAll('.zone-max-input').forEach(maxIn => {
    const idx   = maxIn.dataset.idx;
    const minIn = grid.querySelector(`.zone-min-input[data-idx="${idx}"]`);
    maxIn.addEventListener('input', () => {
      const maxVal = parseInt(maxIn.value) || 1;
      if (minIn && parseInt(minIn.value) > maxVal) minIn.value = maxVal;
      if (minIn) maxIn.min = minIn.value;
    });
  });

  // Enter key on any input saves that card
  grid.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') saveZone(parseInt(inp.dataset.idx));
    });
  });
}

// ── Read current values from DOM for a given zone index ───────
function readZoneFromDOM(idx) {
  const rateIn = document.querySelector(`.zone-rate-input[data-idx="${idx}"]`);
  const minIn  = document.querySelector(`.zone-min-input[data-idx="${idx}"]`);
  const maxIn  = document.querySelector(`.zone-max-input[data-idx="${idx}"]`);
  // Use ?? not || so a rate of 0 is preserved correctly
  const rate    = Math.max(0, parseInt(rateIn?.value) ?? 0);
  const minDays = Math.max(1, parseInt(minIn?.value)  ?? 1);
  const maxDays = Math.max(minDays, parseInt(maxIn?.value) ?? 7);
  return { rate, minDays, maxDays };
}

// ── Per-zone save ─────────────────────────────────────────────
async function saveZone(idx) {
  const btn = document.querySelector(`.save-zone-btn[data-idx="${idx}"]`);

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving\u2026';
  }

  try {
    const { rate, minDays, maxDays } = readZoneFromDOM(idx);
    zones[idx] = { ...zones[idx], rate, minDays, maxDays };
    await saveShippingZones(zones);
    renderKpis();
    toast.success('Saved', `${zones[idx].name} updated`);

    const card = document.getElementById(`zone-card-${idx}`);
    if (card) {
      card.classList.add('flash-ok');
      setTimeout(() => card.classList.remove('flash-ok'), 1200);
    }
  } catch (err) {
    console.error('[saveZone] error:', err);
    toast.error('Save failed', err.message || 'Could not update zone. Check your connection and try again.');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-circle-check"></i> Save';
    }
  }
}

// ── Save all at once ──────────────────────────────────────────
async function saveAll() {
  const saveAllBtn = document.getElementById('save-all-btn');
  if (saveAllBtn) {
    saveAllBtn.disabled = true;
    saveAllBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving\u2026';
  }

  try {
    const updates = [];
    document.querySelectorAll('.zone-rate-input').forEach(inp => {
      const idx = parseInt(inp.dataset.idx);
      const { rate, minDays, maxDays } = readZoneFromDOM(idx);
      updates.push({ idx, rate, minDays, maxDays });
    });

    updates.forEach(({ idx, rate, minDays, maxDays }) => {
      zones[idx] = { ...zones[idx], rate, minDays, maxDays };
    });

    await saveShippingZones(zones);
    renderKpis();
    toast.success('All saved', 'All delivery zone settings updated');
  } catch (err) {
    console.error('[saveAll] error:', err);
    toast.error('Save failed', err.message || 'Could not save zones. Check your connection and try again.');
  } finally {
    if (saveAllBtn) {
      saveAllBtn.disabled = false;
      saveAllBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save All';
    }
  }
}

// ── Reset to defaults ─────────────────────────────────────────
async function resetDefaults() {
  if (!confirm('Reset all zones to default rates and delivery days?')) return;
  try {
    zones = await getShippingZones();
  } catch (err) {
    toast.error('Reset failed', err.message || 'Could not reload zones.');
    return;
  }
  renderKpis();
  renderGrid();
  toast.info('Reset', 'Delivery zones restored to defaults');
}

// ── Init ──────────────────────────────────────────────────────
withLoader(async () => {
  if (!requireAdmin()) return;
  await injectAdminLayout('Delivery');
  try {
    zones = await getShippingZones();
  } catch (err) {
    console.error('[admin-shipping] load error:', err);
    toast.error('Load failed', err.message || 'Could not load shipping zones.');
    zones = [];
  }
  renderKpis();
  renderGrid();
  document.getElementById('save-all-btn')?.addEventListener('click', saveAll);
  document.getElementById('reset-defaults-btn')?.addEventListener('click', resetDefaults);
});

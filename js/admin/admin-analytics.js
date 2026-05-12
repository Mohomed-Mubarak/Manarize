/* ============================================================
   ZENMARKET — ADMIN ANALYTICS PAGE
   ============================================================ */
import { requireAdmin }      from './admin-auth.js';
import { injectAdminLayout } from './admin-layout.js';
import { getProducts } from '../store-adapter.js';
import AdminAPI from '../admin-api.js';
import { getSupabase } from '../supabase.js';
import { formatPrice }       from '../utils.js';
import { withLoader }        from '../loader.js';

withLoader(async () => {
  if (!requireAdmin()) return;
  await injectAdminLayout('Analytics');

  const [allOrders, products] = await Promise.all([
    (async () => {
      const mapO = row => ({
        id: row.id, customerId: row.customer_id, customerName: row.customer_name || '',
        items: row.items || [], subtotal: row.subtotal || 0, shipping: row.shipping || 0,
        discount: row.discount || 0, total: row.total || 0, status: row.status || 'pending',
        paymentStatus: row.payment_status || 'pending', paymentMethod: row.payment_method || '',
        createdAt: row.created_at,
      });
      try {
        const sb = getSupabase();
        if (!sb) throw new Error('no client');
        const { data, error } = await sb.from('orders').select('*').order('created_at', { ascending: false });
        if (error) throw new Error(error.message);
        return (data || []).map(mapO);
      } catch (_) {}
      try { const r = await AdminAPI.orders.list({ limit: 1000 }); return (r.data || []).map(mapO); }
      catch (_) { return []; }
    })(),
    getProducts({ adminMode: true }),
  ]);
  const paidOrders = allOrders.filter(o => o.paymentStatus === 'paid');
  const revenue    = paidOrders.reduce((s, o) => s + (o.total || 0), 0);
  const aov        = paidOrders.length ? Math.round(revenue / paidOrders.length) : 0;
  const convRate   = allOrders.length
    ? ((paidOrders.length / allOrders.length) * 100).toFixed(1) + '%'
    : '0%';

  // ── KPIs ────────────────────────────────────────────────────
  setText('an-revenue',    formatPrice(revenue));
  setText('an-orders',     paidOrders.length);
  setText('an-aov',        formatPrice(aov));
  setText('an-conversion', convRate);

  // ── Category breakdown ───────────────────────────────────────
  const catMap   = {};
  allOrders.forEach(o => {
    (o.items || []).forEach(i => {
      const p = products.find(x => x.id === i.productId);
      if (p) {
        const cat = p.category || 'Uncategorized';
        catMap[cat] = (catMap[cat] || 0) + (i.price || p.price || 0) * (i.qty || 1);
      }
    });
  });

  const catEl = document.getElementById('cat-breakdown');
  if (catEl) {
    const entries = Object.entries(catMap).sort((a, b) => b[1] - a[1]);
    const total   = entries.reduce((s, [, v]) => s + v, 0) || 1;

    if (!entries.length) {
      catEl.innerHTML = `<p style="color:var(--clr-text-3);text-align:center;font-size:.875rem;padding:1.5rem">No category data yet</p>`;
    } else {
      catEl.innerHTML = entries.map(([cat, val]) => `
        <div style="margin-bottom:.875rem">
          <div style="display:flex;justify-content:space-between;font-size:.875rem;margin-bottom:.3rem;color:var(--clr-text)">
            <span>${esc(cat)}</span>
            <span style="font-family:var(--ff-mono);color:var(--clr-gold)">${formatPrice(val)}</span>
          </div>
          <div style="background:var(--clr-border);border-radius:4px;height:6px">
            <div style="background:var(--clr-gold);border-radius:4px;height:6px;width:${Math.round(val / total * 100)}%;transition:width .4s ease"></div>
          </div>
        </div>`).join('');
    }
  }

  // ── Payment method breakdown ─────────────────────────────────
  const pmMap = {};
  allOrders.forEach(o => {
    const m = o.paymentMethod || 'unknown';
    pmMap[m] = (pmMap[m] || 0) + 1;
  });
  const pmEl = document.getElementById('payment-breakdown');
  if (pmEl) {
    const pmLabels = { payhere: 'PayHere', bank: 'Bank Transfer', cod: 'Cash on Delivery' };
    const pmIcons  = { payhere: 'fa-credit-card', bank: 'fa-building-columns', cod: 'fa-money-bill-wave' };
    pmEl.innerHTML = Object.entries(pmMap).map(([method, count]) => `
      <div style="background:var(--clr-bg-2);border:1px solid var(--clr-border);border-radius:var(--r-md);padding:1rem;text-align:center">
        <i class="fa-solid ${pmIcons[method] || 'fa-circle-question'}" style="color:var(--clr-gold);font-size:1.25rem;margin-bottom:.5rem;display:block"></i>
        <div style="font-weight:700;font-size:1.25rem;color:var(--clr-text)">${count}</div>
        <div style="font-size:.75rem;color:var(--clr-text-3);margin-top:.25rem">${pmLabels[method] || esc(method)}</div>
      </div>`).join('') || `<p style="color:var(--clr-text-3);font-size:.875rem;grid-column:1/-1;text-align:center;padding:1rem">No orders yet</p>`;
  }

  // ── Top products ─────────────────────────────────────────────
  const productSales = {};
  allOrders.forEach(o => {
    (o.items || []).forEach(i => {
      if (!productSales[i.productId]) productSales[i.productId] = { qty: 0, revenue: 0, name: i.name || i.productId };
      productSales[i.productId].qty     += (i.qty || 1);
      productSales[i.productId].revenue += (i.price || 0) * (i.qty || 1);
    });
  });

  const topProducts = Object.entries(productSales)
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .slice(0, 8);

  const tbody = document.getElementById('top-products');
  if (tbody) {
    if (!topProducts.length) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:2rem;color:var(--clr-text-3)">No sales data yet</td></tr>`;
    } else {
      tbody.innerHTML = topProducts.map(([id, data], i) => `
        <tr>
          <td style="color:var(--clr-text-3);font-weight:600">#${i + 1}</td>
          <td style="color:var(--clr-text);font-weight:500">${esc(data.name)}</td>
          <td style="font-family:var(--ff-mono)">${data.qty}</td>
          <td style="font-family:var(--ff-mono);color:var(--clr-gold)">${formatPrice(data.revenue)}</td>
        </tr>`).join('');
    }
  }

  // ── Revenue chart ─────────────────────────────────────────────
  const ctx = document.getElementById('analytics-chart');
  if (ctx) {
    try {
      // Wait for Chart.js if still loading
      if (typeof Chart === 'undefined') {
        await new Promise((resolve, reject) => {
          const deadline = Date.now() + 3000;
          const poll = () => {
            if (typeof Chart !== 'undefined') return resolve();
            if (Date.now() > deadline) return reject(new Error('Chart.js timeout'));
            requestAnimationFrame(poll);
          };
          poll();
        });
      }

      const months         = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const revenueByMonth = Array(12).fill(0);
      const ordersCount    = Array(12).fill(0);

      allOrders.forEach(o => {
        const m = new Date(o.createdAt).getMonth();
        if (o.paymentStatus === 'paid') revenueByMonth[m] += (o.total || 0);
        ordersCount[m]++;
      });

      requestAnimationFrame(() => {
        new Chart(ctx, {
          type: 'bar',
          data: {
            labels: months,
            datasets: [
              {
                label: 'Revenue (LKR)',
                data: revenueByMonth,
                backgroundColor: 'rgba(201,168,76,.55)',
                borderColor: '#c9a84c',
                borderWidth: 1,
                borderRadius: 4,
                yAxisID: 'y',
              },
              {
                label: 'Orders',
                type: 'line',
                data: ordersCount,
                borderColor: 'rgba(59,158,255,.7)',
                backgroundColor: 'rgba(59,158,255,.08)',
                fill: false,
                tension: 0.4,
                pointRadius: 3,
                pointHoverRadius: 5,
                borderWidth: 1.5,
                yAxisID: 'y2',
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
              legend: {
                display: true,
                position: 'top',
                labels: { color: '#9aa5b8', font: { family: 'DM Sans', size: 12 }, boxWidth: 12, padding: 16 },
              },
              tooltip: {
                backgroundColor: '#1e2330',
                borderColor: '#2a3147',
                borderWidth: 1,
                titleColor: '#e8eaf0',
                bodyColor: '#9aa5b8',
                callbacks: {
                  label: c => c.datasetIndex === 0
                    ? `  Revenue: Rs. ${(c.raw || 0).toLocaleString('en-LK')}`
                    : `  Orders: ${c.raw}`,
                },
              },
            },
            scales: {
              x: {
                grid:  { color: 'rgba(255,255,255,.04)' },
                ticks: { color: '#667080', font: { family: 'DM Sans', size: 11 } },
              },
              y: {
                position: 'left',
                grid:  { color: 'rgba(255,255,255,.04)' },
                ticks: { color: '#667080', font: { family: 'DM Sans', size: 11 }, callback: v => `Rs.${(v / 1000).toFixed(0)}k` },
              },
              y2: {
                position: 'right',
                grid: { drawOnChartArea: false },
                ticks: { color: '#667080', font: { family: 'DM Sans', size: 11 }, precision: 0 },
              },
            },
          },
        });
      });
    } catch (err) {
      console.warn('[Analytics] Chart error:', err);
      ctx.parentElement.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--clr-text-3);font-size:.875rem;gap:.5rem">
          <i class="fa-solid fa-chart-bar" style="opacity:.3;font-size:1.5rem"></i>
          <span>Chart unavailable — requires internet for Chart.js</span>
        </div>`;
    }
  }
});

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

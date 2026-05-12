/**
 * ADMIN-ANALYTICS.JS — Analytics Chart Initialisation (legacy/inline)
 * Not directly imported — kept for reference.
 */
export function initAnalyticsChart(getOrders) {
  const ctx = document.getElementById('analytics-chart');
  if (!ctx) return;
  try {
    if (typeof Chart === 'undefined') throw new Error('Chart.js not loaded');
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const rev = Array(12).fill(0);
    getOrders().filter(o => o.paymentStatus === 'paid').forEach(o => {
      const m = new Date(o.createdAt).getMonth();
      rev[m] += (o.total || 0);
    });
    requestAnimationFrame(() => {
      new Chart(ctx, {
        type: 'bar',
        data: {
          labels: months,
          datasets: [{
            label: 'Revenue (LKR)',
            data: rev,
            backgroundColor: 'rgba(201,168,76,.55)',
            borderColor: '#c9a84c',
            borderWidth: 1,
            borderRadius: 4,
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: '#1e2330',
              borderColor: '#2a3147',
              borderWidth: 1,
              callbacks: { label: c => `  Rs. ${(c.raw||0).toLocaleString('en-LK')}` }
            }
          },
          scales: {
            x: { grid: { color: 'rgba(255,255,255,.05)' }, ticks: { color: '#667080' } },
            y: { grid: { color: 'rgba(255,255,255,.05)' }, ticks: { color: '#667080', callback: v => `Rs.${(v/1000).toFixed(0)}k` } }
          }
        }
      });
    });
  } catch (err) {
    console.warn('Chart.js failed to load:', err);
    ctx.parentElement.innerHTML = '<p style="color:var(--clr-text-3);padding:2rem;text-align:center">Chart unavailable</p>';
  }
}

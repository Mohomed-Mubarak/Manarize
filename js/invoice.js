/* ============================================================
   ZENMARKET — INVOICE  (fixed)
   - Print: popup window approach (no CSS conflicts, works locally)
   - PDF: browser print-to-PDF via popup (no jsPDF CDN needed)
   ============================================================ */
import { STORE } from './config.js';
import { formatPrice, formatDate } from './utils.js';

// ── HTML escape helper (prevents XSS in the invoice popup) ───
function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── Build full invoice HTML string ────────────────────────────
function buildInvoiceHTML(order) {
  const addr = order.address || {};
  const itemRows = (order.items || []).map(item => `
    <tr>
      <td>${escHtml(item.name)}${item.variant ? ` <small>(${escHtml(item.variant)})</small>` : ''}</td>
      <td class="center">${item.qty}</td>
      <td class="right">Rs. ${Number(item.price).toLocaleString('en-LK')}</td>
      <td class="right">Rs. ${Number(item.price * item.qty).toLocaleString('en-LK')}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Invoice ${order.id} — Manarize</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 13px; color: #222; background: #fff; padding: 40px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #c9a84c; padding-bottom: 20px; margin-bottom: 28px; }
  .logo { font-size: 26px; font-weight: 700; color: #111; font-family: Georgia, serif; }
  .logo span { color: #c9a84c; }
  .store-info { font-size: 11px; color: #666; margin-top: 6px; line-height: 1.7; }
  .invoice-label { font-size: 28px; font-weight: 700; color: #c9a84c; text-transform: uppercase; letter-spacing: .05em; }
  .invoice-num { font-size: 12px; color: #666; font-family: monospace; margin-top: 4px; }
  .invoice-date { font-size: 11px; color: #888; margin-top: 2px; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 28px; padding: 20px; background: #fafaf8; border-radius: 6px; border: 1px solid #eee; }
  .meta-label { font-size: 9px; text-transform: uppercase; letter-spacing: .1em; color: #999; margin-bottom: 6px; font-weight: 600; }
  .meta-value { font-size: 12px; line-height: 1.8; color: #333; }
  .meta-value strong { color: #111; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  thead th { background: #f5f0e8; font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: #666; padding: 10px 12px; text-align: left; border-bottom: 2px solid #e8e0d0; }
  thead th.right { text-align: right; }
  thead th.center { text-align: center; }
  tbody tr { border-bottom: 1px solid #f0ede8; }
  tbody tr:last-child { border-bottom: none; }
  tbody td { padding: 10px 12px; font-size: 12px; color: #444; vertical-align: middle; }
  tbody td small { color: #999; font-size: 11px; }
  td.right { text-align: right; font-family: monospace; }
  td.center { text-align: center; }
  .totals { display: flex; justify-content: flex-end; margin-bottom: 28px; }
  .totals-box { min-width: 260px; border: 1px solid #eee; border-radius: 6px; overflow: hidden; }
  .total-row { display: flex; justify-content: space-between; padding: 8px 16px; font-size: 12px; border-bottom: 1px solid #f0ede8; color: #555; }
  .total-row:last-child { border-bottom: none; }
  .total-row.grand { background: #c9a84c; color: #fff; font-weight: 700; font-size: 15px; padding: 12px 16px; }
  .total-row .val { font-family: monospace; }
  .payment-box { padding: 14px 18px; background: #fafaf8; border: 1px solid #eee; border-radius: 6px; font-size: 12px; line-height: 2; color: #555; margin-bottom: 28px; }
  .payment-box strong { color: #333; }
  .footer { text-align: center; font-size: 11px; color: #bbb; padding-top: 20px; border-top: 1px solid #eee; }
  .footer strong { color: #c9a84c; }
  @media print {
    body { padding: 20px; }
    @page { margin: 15mm; size: A4; }
  }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="logo">Manarize</div>
      <div class="store-info">
        ${STORE.address}<br>
        ${STORE.phone} &nbsp;·&nbsp; ${STORE.email}
      </div>
    </div>
    <div style="text-align:right">
      <div class="invoice-label">Invoice</div>
      <div class="invoice-num"># ${order.id}</div>
      <div class="invoice-date">Date: ${formatDate(order.createdAt)}</div>
    </div>
  </div>

  <div class="meta">
    <div>
      <div class="meta-label">Bill To</div>
      <div class="meta-value">
        <strong>${escHtml(order.customerName)}</strong><br>
        ${escHtml(order.customerEmail)}<br>
        ${escHtml(order.customerPhone)}
      </div>
    </div>
    <div>
      <div class="meta-label">Delivery Address</div>
      <div class="meta-value">
        ${escHtml(addr.line1 || '')}${addr.line2 ? '<br>' + escHtml(addr.line2) : ''}<br>
        ${escHtml(addr.city || '')}, ${escHtml(addr.district || '')}<br>
        ${escHtml(addr.province || '')} Province ${addr.zip ? '· ' + escHtml(addr.zip) : ''}
      </div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Item</th>
        <th class="center">Qty</th>
        <th class="right">Unit Price</th>
        <th class="right">Total</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows}
    </tbody>
  </table>

  <div class="totals">
    <div class="totals-box">
      <div class="total-row"><span>Subtotal</span><span class="val">Rs. ${Number(order.subtotal).toLocaleString('en-LK')}</span></div>
      <div class="total-row"><span>Shipping</span><span class="val">Rs. ${Number(order.shipping).toLocaleString('en-LK')}</span></div>
      ${order.discount > 0 ? `<div class="total-row" style="color:#e74c3c"><span>Discount</span><span class="val">-Rs. ${Number(order.discount).toLocaleString('en-LK')}</span></div>` : ''}
      <div class="total-row grand"><span>TOTAL</span><span class="val">Rs. ${Number(order.total).toLocaleString('en-LK')}</span></div>
    </div>
  </div>

  <div class="payment-box">
    <strong>Payment Method:</strong>
    ${order.paymentMethod === 'cod'  ? 'Cash on Delivery'       :
      order.paymentMethod === 'bank' ? 'Bank Transfer'           :
                                       'PayHere Online Payment'}
    &nbsp;&nbsp;
    <strong>Status:</strong> ${escHtml((order.paymentStatus || 'pending').charAt(0).toUpperCase() + (order.paymentStatus || 'pending').slice(1))}
    ${order.notes ? `<br><strong>Notes:</strong> ${escHtml(order.notes)}` : ''}
  </div>

  <div class="footer">
    Thank you for shopping with <strong>Manarize</strong>! &nbsp;·&nbsp; manarize.lk<br>
    This is a computer-generated invoice — no signature required.
  </div>
</body>
</html>`;
}

// ── Open invoice in a popup window ────────────────────────────
// Uses URL.createObjectURL(Blob) instead of document.write so the HTML
// is loaded as a separate origin-opaque resource — inline scripts from
// any unescaped content cannot reach the parent page's DOM or cookies.
function openInvoiceWindow(order) {
  const html    = buildInvoiceHTML(order);
  const blob    = new Blob([html], { type: 'text/html;charset=utf-8' });
  const blobUrl = URL.createObjectURL(blob);

  const win = window.open(blobUrl, '_blank', 'width=900,height=700,scrollbars=yes,resizable=yes');
  if (!win) {
    URL.revokeObjectURL(blobUrl);
    import('./toast.js').then(({ default: toast }) => {
      toast.error('Pop-up Blocked', 'Please allow pop-ups for this site to print invoices.');
    });
    return null;
  }

  // Revoke the object URL once the window has loaded to free memory
  win.addEventListener('load', () => URL.revokeObjectURL(blobUrl), { once: true });
  return win;
}

// ── Print Invoice (popup approach — no CSS conflicts) ─────────
export function printInvoice(order) {
  const win = openInvoiceWindow(order);
  if (!win) return;
  // Wait for images/fonts to load before printing
  win.onload = () => {
    setTimeout(() => {
      win.focus();
      win.print();
      // Don't close — let user close after print dialog
    }, 300);
  };
  // Fallback if onload already fired
  setTimeout(() => {
    try { win.focus(); win.print(); } catch (e) { /* already closed */ }
  }, 800);
}

// ── Download as PDF (via browser print-to-PDF, no CDN needed) ─
export async function downloadInvoicePDF(order) {
  const btn = document.getElementById('btn-download-pdf');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Opening PDF…';
  }

  try {
    const win = openInvoiceWindow(order);
    if (!win) return;

    win.onload = () => {
      setTimeout(() => {
        win.focus();
        win.print(); // Browser "Save as PDF" works here
      }, 400);
    };
    // Show a helper toast
    const { default: toast } = await import('./toast.js');
    toast.info(
      'Print to PDF',
      'In the print dialog, select "Save as PDF" as the destination.'
    );
  } catch (err) {
    console.error('PDF open error:', err);
    const { default: toast } = await import('./toast.js');
    toast.error('Could Not Open', 'Please check if pop-ups are allowed in your browser.');
  } finally {
    if (btn) {
      setTimeout(() => {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-file-pdf"></i> Download PDF';
      }, 1500);
    }
  }
}

// ── Legacy renderInvoice kept for admin order-detail ──────────
// (admin uses an inline div; we keep this for compatibility)
export function renderInvoice(order) {
  const el = document.getElementById('invoice-print');
  if (!el || !order) return;
  el.innerHTML = buildInvoiceHTML(order)
    .replace(/<!DOCTYPE[^>]*>/i, '')
    .replace(/<html[^>]*>/i, '')
    .replace(/<\/html>/i, '')
    .replace(/<head>[\s\S]*?<\/head>/i, '')
    .replace(/<\/?body[^>]*>/gi, '');
}

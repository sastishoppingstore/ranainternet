'use strict';
/*
 * Minimal dependency-free PDF writer (A4, Helvetica) — enough for a clean
 * branded invoice: rectangles, lines, text, and QR code as filled cells.
 */

const A4 = { w: 595.28, h: 841.89 };

class Pdf {
  constructor() {
    this.ops = [];
    this.y = A4.h - 40;
  }
  _esc(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  }
  text(x, y, str, { size = 10, font = 'F1', color = [0.1, 0.15, 0.25], align = 'left' } = {}) {
    let tx = x;
    if (align === 'right') tx = x - this.textWidth(str, size);
    if (align === 'center') tx = x - this.textWidth(str, size) / 2;
    const c = color.map((v) => v.toFixed(3)).join(' ');
    this.ops.push(`${c} rg BT /${font} ${size} Tf ${tx.toFixed(1)} ${y.toFixed(1)} Td (${this._esc(str)}) Tj ET`);
  }
  textWidth(str, size) {
    // approximate Helvetica widths (average 0.52em)
    return String(str).length * size * 0.52;
  }
  rect(x, y, w, h, { fill = null, stroke = null, lw = 0.5 } = {}) {
    if (fill) {
      const c = fill.map((v) => v.toFixed(3)).join(' ');
      this.ops.push(`${c} rg ${x.toFixed(1)} ${y.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)} re f`);
    }
    if (stroke) {
      const c = stroke.map((v) => v.toFixed(3)).join(' ');
      this.ops.push(`${c} RG ${lw} w ${x.toFixed(1)} ${y.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)} re S`);
    }
  }
  line(x1, y1, x2, y2, { color = [0.7, 0.75, 0.8], lw = 0.6 } = {}) {
    const c = color.map((v) => v.toFixed(3)).join(' ');
    this.ops.push(`${c} RG ${lw} w ${x1.toFixed(1)} ${y1.toFixed(1)} m ${x2.toFixed(1)} ${y2.toFixed(1)} l S`);
  }
  qr(x, y, modules, size) {
    // modules: 2D array 0/1 from qrcode lib
    const n = modules.length;
    const cell = size / n;
    this.ops.push('0 0 0 rg');
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (modules[r][c]) {
          const px = x + c * cell;
          const py = y + (n - 1 - r) * cell;
          this.ops.push(`${px.toFixed(2)} ${py.toFixed(2)} ${cell.toFixed(2)} ${cell.toFixed(2)} re f`);
        }
      }
    }
  }
  build() {
    const objs = [];
    const content = this.ops.join('\n');
    objs.push('<< /Type /Catalog /Pages 2 0 R >>');
    objs.push(`<< /Type /Pages /Kids [3 0 R] /Count 1 >>`);
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.w} ${A4.h}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>`);
    objs.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
    objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

    let pdf = '%PDF-1.4\n';
    const offsets = [];
    objs.forEach((body, i) => {
      offsets.push(pdf.length);
      pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xrefPos = pdf.length;
    pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
    pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
    return Buffer.from(pdf, 'binary');
  }
}

const NAVY = [0.07, 0.15, 0.3];
const LIGHT = [0.93, 0.95, 0.98];
const GRAY = [0.45, 0.5, 0.58];

function escapeWinAnsi(s) {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[\u2026]/g, '...')
    .replace(/[\u20A4]/g, 'Rs.')
    .replace(/[^\x20-\x7E\n]/g, '');
}

/**
 * Render an invoice PDF.
 * inv: { invoice_no, customer:{name,address,phone,cnic}, items[], total, paid, balance, due_date, period_from, period_to, currency, notes }
 * company: { name, address, phone, email, footer }
 * qrModules: optional 2D array (0/1)
 */
function invoicePdf(inv, company, qrModules = null) {
  const p = new Pdf();
  const M = 40; // margin
  const w = A4.w - M * 2;

  // header band
  p.rect(0, A4.h - 92, A4.w, 92, { fill: NAVY });
  p.text(M, A4.h - 42, escapeWinAnsi(company.name || 'RANA INTERNET'), { size: 22, font: 'F2', color: [1, 1, 1] });
  p.text(M, A4.h - 60, 'Fiber Internet Service Provider', { size: 9, color: [0.75, 0.82, 0.95] });
  p.text(M, A4.h - 74, escapeWinAnsi(company.address || ''), { size: 8, color: [0.75, 0.82, 0.95] });
  p.text(M, A4.h - 86, escapeWinAnsi([company.phone, company.email].filter(Boolean).join('  |  ')), { size: 8, color: [0.75, 0.82, 0.95] });

  p.text(A4.w - M, A4.h - 42, 'INVOICE', { size: 20, font: 'F2', color: [1, 1, 1], align: 'right' });
  p.text(A4.w - M, A4.h - 60, `No: ${inv.invoice_no}`, { size: 9, color: [0.85, 0.9, 0.98], align: 'right' });
  p.text(A4.w - M, A4.h - 72, `Due Date: ${inv.due_date || '-'}`, { size: 9, color: [0.85, 0.9, 0.98], align: 'right' });

  let y = A4.h - 120;
  // customer block
  p.rect(M, y - 58, w / 2, 66, { fill: LIGHT });
  p.text(M + 8, y - 12, 'CUSTOMER', { size: 7, font: 'F2', color: GRAY });
  p.text(M + 8, y - 26, escapeWinAnsi(inv.customer.name), { size: 10, font: 'F2' });
  p.text(M + 8, y - 38, escapeWinAnsi(inv.customer.address || ''), { size: 8 });
  p.text(M + 8, y - 49, escapeWinAnsi(`Phone: ${inv.customer.phone || '-'}`), { size: 8 });
  if (inv.customer.cnic) p.text(M + 8, y - 60, escapeWinAnsi(`CNIC: ${inv.customer.cnic}`), { size: 8 });

  p.text(A4.w - M, y - 12, `Billing Period:`, { size: 8, color: GRAY, align: 'right' });
  p.text(A4.w - M, y - 24, escapeWinAnsi(`${inv.period_from || '-'}  to  ${inv.period_to || '-'}`), { size: 9, align: 'right' });
  p.text(A4.w - M, y - 38, `Status: ${inv.status.toUpperCase()}`, { size: 9, font: 'F2', align: 'right' });
  p.text(A4.w - M, y - 50, `Balance Due:`, { size: 9, color: GRAY, align: 'right' });

  y -= 78;

  // items table header
  p.rect(M, y - 18, w, 20, { fill: NAVY });
  p.text(M + 8, y - 11, 'DESCRIPTION', { size: 7.5, font: 'F2', color: [1, 1, 1] });
  p.text(M + w - 130, y - 11, 'QTY', { size: 7.5, font: 'F2', color: [1, 1, 1], align: 'right' });
  p.text(A4.w - M - 8, y - 11, 'AMOUNT', { size: 7.5, font: 'F2', color: [1, 1, 1], align: 'right' });
  y -= 28;

  const fmtAmt = (v) => `${(v / 100).toLocaleString('en-PK', { minimumFractionDigits: 2 })}`;
  for (const it of inv.items) {
    const neg = it.amount < 0;
    p.text(M + 8, y, escapeWinAnsi(it.description), { size: 8.5 });
    p.text(M + w - 130, y, String(it.qty ?? 1), { size: 8.5, align: 'right', color: neg ? [0.6, 0.2, 0.2] : [0.2, 0.25, 0.35] });
    p.text(A4.w - M - 8, y, `${neg ? '(' : ''}${fmtAmt(Math.abs(it.amount))}${neg ? ')' : ''}`, { size: 8.5, align: 'right', color: neg ? [0.6, 0.2, 0.2] : [0.2, 0.25, 0.35] });
    p.line(M, y - 5, A4.w - M, y - 5, { color: [0.85, 0.87, 0.9], lw: 0.4 });
    y -= 17;
  }

  // totals
  const totalLine = (label, val, bold, color = [0.1, 0.15, 0.25]) => {
    p.text(A4.w - M - 150, y, label, { size: 9, font: bold ? 'F2' : 'F1', color: bold ? color : GRAY, align: 'right' });
    p.text(A4.w - M - 8, y, fmtAmt(val), { size: 9, font: bold ? 'F2' : 'F1', color: bold ? color : [0.2, 0.25, 0.35], align: 'right' });
    y -= 15;
  };
  totalLine('Subtotal', inv.subtotal, false);
  if (inv.discount) totalLine('Discount', inv.discount, false, [0.6, 0.2, 0.2]);
  if (inv.paid) totalLine('Paid (from payments)', inv.paid, false, [0.1, 0.4, 0.2]);
  p.line(A4.w - M - 160, y + 3, A4.w - M, y + 3, { color: NAVY, lw: 1 });
  totalLine('TOTAL DUE', inv.balance, true);

  // QR + payment instructions
  y -= 14;
  if (qrModules) {
    p.qr(A4.w - M - 90, y - 88, qrModules, 88);
    p.text(A4.w - M - 90, y - 96, 'Scan to pay / reference', { size: 6.5, color: GRAY });
  }
  p.rect(M, y - 92, 300, 96, { fill: LIGHT });
  p.text(M + 8, y - 10, 'PAYMENT INSTRUCTIONS', { size: 7, font: 'F2', color: GRAY });
  const instr = [
    '1. Cash at Rana Internet office or via assigned collection agent.',
    '2. Bank transfer / JazzCash / Easypaisa / Raast: mention invoice number as reference.',
    '3. Payments without invoice reference may be delayed in matching.',
    `4. Late fee applies after the grace period per company policy.`,
  ];
  instr.forEach((t, i) => p.text(M + 8, y - 24 - i * 12, escapeWinAnsi(t), { size: 7.5, color: [0.25, 0.3, 0.4] }));

  // footer
  p.line(M, 52, A4.w - M, 52, { color: NAVY, lw: 0.8 });
  p.text(A4.w / 2, 40, escapeWinAnsi(company.footer || 'Thank you for choosing Rana Internet'), { size: 8, color: GRAY, align: 'center' });
  p.text(A4.w / 2, 30, 'This is a computer generated invoice.', { size: 7, color: GRAY, align: 'center' });

  return p.build();
}

module.exports = { Pdf, invoicePdf };

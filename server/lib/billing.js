'use strict';
/*
 * Billing engine: invoice generation, proration, late fees, customer ledger,
 * aging/recovery. All amounts in integer paise. Financial writes go through
 * the double-entry journal and post exactly once.
 */
const { db, tx } = require('../db');
const { postJournal, logTransaction, accountByCategory } = require('./accounting');
const { addDays, todayPKT, daysBetween, nextSeq, toPaise } = require('./util');

/* ---------------- invoices ---------------- */
function invoiceNo() {
  return nextSeq(db, 'invoices', 'id', 'RI-', 6);
}

function customerLedger(customerId) {
  const rows = db.prepare(
    `SELECT * FROM ledgers WHERE customer_id=? ORDER BY at, id`
  ).all(customerId);
  let balance = 0;
  for (const r of rows) {
    balance += r.direction === 'debit' ? r.amount : -r.amount;
    r.balance = balance;
  }
  return rows;
}

function ledgerEntry(customerId, entryType, direction, amount, memo, invoiceId = null, paymentId = null) {
  db.prepare(
    `INSERT INTO ledgers(customer_id, entry_type, direction, amount, memo, invoice_id, payment_id)
     VALUES(?,?,?,?,?,?,?)`
  ).run(customerId, entryType, direction, amount, memo, invoiceId, paymentId);
}

/**
 * Create an invoice for a customer.
 * items: [{item_type, description, qty, amount}] amounts signed paise.
 * Returns the invoice.
 */
function createInvoice({ customerId, items, periodFrom, periodTo, dueDate, notes = '', generatedBy = 'manual' }) {
  return tx((d) => {
    const customer = d.prepare('SELECT * FROM customers WHERE id=?').get(customerId);
    if (!customer) throw new Error('Customer not found');
    const invNo = invoiceNo();
    const subtotalItems = items.filter((i) => i.item_type !== 'discount' && i.item_type !== 'advance_adjustment' && i.item_type !== 'previous_balance');
    const subtotal = subtotalItems.reduce((s, i) => s + i.amount, 0);
    const discount = Math.abs(items.filter((i) => i.item_type === 'discount').reduce((s, i) => s + i.amount, 0));
    const advances = items.filter((i) => i.item_type === 'advance_adjustment').reduce((s, i) => s + i.amount, 0);
    const prevBal = items.filter((i) => i.item_type === 'previous_balance').reduce((s, i) => s + i.amount, 0);
    const other = subtotal + prevBal + advances - discount;
    const total = Math.max(other, 0);
    const info = d.prepare(
      `INSERT INTO invoices(invoice_no, customer_id, period_from, period_to, due_date, status,
        subtotal, discount, tax, total, paid, balance, generated_by, notes)
       VALUES(?,?,?,?,?,?,?,?,?,?,0,?,?,?)`
    ).run(invNo, customerId, periodFrom, periodTo, dueDate, total > 0 ? 'unpaid' : 'paid',
      subtotal, discount, 0, total, total, generatedBy, notes);
    const invId = Number(info.lastInsertRowid);
    const insItem = d.prepare(
      'INSERT INTO invoice_items(invoice_id, item_type, description, qty, amount) VALUES(?,?,?,?,?)'
    );
    for (const it of items) insItem.run(invId, it.item_type, it.description, it.qty ?? 1, it.amount);
    // journal: Dr AR / Cr Income (only the net chargeable total)
    if (total > 0) {
      const ar = accountByCategory('receivable', 'asset');
      const rev = accountByCategory('revenue', 'income');
      const inst = accountByCategory('revenue', 'income'); // installation income same bucket in CoA; keep revenue
      postJournalTx(d, {
        entryDate: dueDate ? dueDate : todayPKT(),
        memo: `Invoice ${invNo} — ${customer.name}`,
        source: 'invoice', refId: invId,
        lines: [
          { account_id: ar, debit: total, credit: 0 },
          { account_id: rev, debit: 0, credit: total },
        ],
      });
      logTransaction('invoice', 'invoices', invId, total, ar);
    }
    if (total > 0) {
      ledgerEntry(customerId, 'invoice', 'debit', total, `Invoice ${invNo}`, invId);
    }
    return getInvoice(invId);
  });
}

function postJournalTx(d, entry) {
  const totalDr = entry.lines.reduce((s, l) => s + (l.debit || 0), 0);
  const totalCr = entry.lines.reduce((s, l) => s + (l.credit || 0), 0);
  if (totalDr !== totalCr || totalDr === 0) throw new Error('Unbalanced journal entry');
  const entryNo = nextSeq(d, 'journal_entries', 'id', 'JE-', 6);
  const info = d.prepare(
    'INSERT INTO journal_entries(entry_no, entry_date, memo, source, ref_id, created_by) VALUES(?,?,?,?,?,NULL)'
  ).run(entryNo, entry.entryDate, entry.memo, entry.source, entry.refId);
  const lineIns = d.prepare('INSERT INTO journal_lines(entry_id, account_id, debit, credit) VALUES(?,?,?,?)');
  for (const l of entry.lines) lineIns.run(info.lastInsertRowid, l.account_id, l.debit || 0, l.credit || 0);
  return entryNo;
}

function getInvoice(invId) {
  const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(invId);
  if (!inv) return null;
  inv.items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id=? ORDER BY id').all(invId);
  const c = db.prepare('SELECT customer_code, name, phone, address, cnic FROM customers WHERE id=?').get(inv.customer_id);
  inv.customer = c;
  inv.payments = db.prepare(
    `SELECT * FROM payments WHERE invoice_id=? AND status IN ('approved','refunded','reversed') ORDER BY id`
  ).all(invId);
  return inv;
}

function markInvoiceStatus(inv) {
  let status = inv.total === 0 ? 'paid' : 'unpaid';
  const paidNow = inv.payments.reduce((s, p) => s + (p.status === 'approved' ? p.amount : 0), 0);
  inv.paid = paidNow;
  inv.balance = inv.total - paidNow;
  if (inv.balance <= 0 && inv.total > 0) status = 'paid';
  else if (paidNow > 0) status = 'partial';
  db.prepare('UPDATE invoices SET paid=?, balance=?, status=?, paid_at=? WHERE id=?')
    .run(inv.paid, inv.balance, status, status === 'paid' ? (inv.paid_at || new Date().toISOString().replace('T', ' ').slice(0, 19)) : null, inv.id);
}

/* ---------------- late fee & aging ---------------- */
function lateFeeAmount(inv) {
  const cfg = safeGet('billing');
  const daysOver = daysBetween(inv.due_date, todayPKT());
  if (daysOver <= 0) return 0;
  const grace = invGraceDays(inv.customer_id);
  if (daysOver <= grace) return 0;
  const perDay = cfg?.late_fee_per_day || 0;
  return perDay > 0 ? Math.min(perDay * (daysOver - grace), inv.balance) : 0;
}
function invGraceDays(customerId) {
  const row = db.prepare(
    `SELECT p.grace_days FROM packages p JOIN customers c ON c.package_id=p.id WHERE c.id=?`
  ).get(customerId);
  return row ? row.grace_days : 0;
}
function safeGet(key) {
  try { return require('../config').getSetting(key); } catch { return null; }
}

/** All unpaid/partial invoices with aging bucket. Buckets configurable: [7, 15]. */
function outstandingInvoices() {
  const cfg = safeGet('billing') || {};
  const b1 = cfg.aging_bucket1_days || 7;
  const b2 = cfg.aging_bucket2_days || 15;
  const today = todayPKT();
  const rows = db.prepare(
    `SELECT i.*, c.customer_code, c.name, c.phone, c.whatsapp, c.status cstatus, c.area_id
     FROM invoices i JOIN customers c ON c.id = i.customer_id
     WHERE i.status IN ('unpaid','partial') AND c.archived_at IS NULL
     ORDER BY i.due_date`
  ).all();
  for (const r of rows) {
    const daysOver = Math.max(daysBetween(r.due_date, today), 0);
    r.days_overdue = daysOver;
    r.bucket = daysOver === 0 ? 'due_today' : daysOver <= b1 ? `1-${b1}` : daysOver <= b2 ? `${b1 + 1}-${b2}` : `${b2 + 1}+`;
  }
  return rows;
}

/* ---------------- proration ---------------- */
/**
 * Prorated adjustment when package changes mid-cycle.
 * Returns paise adjustment (negative = customer credit) computed as:
 *   (newPrice - oldPrice) * remainingDays / cycleDays
 */
function prorateChange(oldPkg, newPkg, effectiveDate) {
  if (!oldPkg) return 0;
  const cycle = oldPkg.cycle_days || 30;
  const lastInvoice = db.prepare(
    `SELECT period_from, period_to FROM invoices WHERE customer_id=? AND status != 'void'
     ORDER BY id DESC LIMIT 1`
  ).get(oldPkg.__customerId);
  if (!lastInvoice) return 0;
  const start = new Date(lastInvoice.period_from);
  const end = new Date(lastInvoice.period_to);
  const eff = new Date(effectiveDate);
  const remaining = Math.max(Math.round((end - eff) / 86400000), 0);
  const total = Math.max(cycle, 1);
  const perDayOld = oldPkg.price_monthly / total;
  const perDayNew = (newPkg ? newPkg.price_monthly : 0) / (newPkg ? newPkg.cycle_days || 30 : total);
  return Math.round((perDayNew - perDayOld) * remaining);
}

/* ---------------- auto invoice generation ---------------- */
/** Generate invoices for active customers whose billing day is today. */
function generateDueInvoices(userId = null) {
  const today = todayPKT();
  const day = parseInt(today.slice(8, 10), 10);
  const cfg = safeGet('billing') || {};
  const graceDays = cfg.default_grace_days ?? 3;
  const customers = db.prepare(
    `SELECT * FROM customers WHERE status='active' AND package_id IS NOT NULL
     AND billing_day = ? AND archived_at IS NULL`
  ).all(day);
  const created = [];
  for (const c of customers) {
    const last = db.prepare(
      `SELECT * FROM invoices WHERE customer_id=? AND status != 'void' ORDER BY id DESC LIMIT 1`
    ).get(c.id);
    if (last) {
      const periodEnd = last.period_to ? addDays(last.period_to, 1) : today;
      const periodStart = last.period_to ? addDays(last.period_to, 1) : today;
      const nextDue = addDays(periodStart, cfg.due_days_after_invoice ?? graceDays + 7);
      if (periodStart > today) continue; // not due yet
      created.push(buildCycleInvoice(c, periodStart, today, addDays(today, cfg.due_days_after_invoice ?? 10)));
    } else {
      // no invoice yet (e.g. activated without first invoice)
      created.push(buildCycleInvoice(c, today, today, addDays(today, cfg.due_days_after_invoice ?? 10)));
    }
  }
  return created;
}

function buildCycleInvoice(c, periodFrom, periodTo, dueDate) {
  const pkg = db.prepare('SELECT * FROM packages WHERE id=?').get(c.package_id);
  if (!pkg) return null;
  const cfg = safeGet('billing') || {};
  const items = [
    { item_type: 'package', description: `${pkg.name} (${pkg.download_mbps}Mbps) — ${periodFrom} to ${periodTo}`, qty: 1, amount: pkg.price_monthly },
  ];
  // late fee on previous balance
  const prev = db.prepare(
    `SELECT * FROM invoices WHERE customer_id=? AND status IN ('unpaid','partial') ORDER BY id DESC LIMIT 1`
  ).get(c.id);
  if (prev && prev.balance > 0) {
    const lf = lateFeeAmount(prev);
    if (lf > 0) items.push({ item_type: 'late_fee', description: `Late fee on ${prev.invoice_no} (${prev.balance}p)`, qty: 1, amount: lf });
  }
  // customer discount setting
  if (c.discount > 0) {
    items.push({ item_type: 'discount', description: 'Customer discount', qty: 1, amount: -c.discount });
  }
  // advance adjustment: apply credit balance up to the total
  const base = items.reduce((s, i) => s + (i.item_type === 'discount' ? 0 : i.amount), 0);
  if (c.advance > 0) {
    const apply = Math.min(c.advance, base);
    items.push({ item_type: 'advance_adjustment', description: 'Advance balance adjustment', qty: 1, amount: -apply });
    db.prepare('UPDATE customers SET advance = advance - ? WHERE id=?').run(apply, c.id);
  }
  // previous balance carried (informational line; amount excluded from chargeable total above)
  if (prev && prev.balance > 0) {
    items.push({ item_type: 'previous_balance', description: `Previous balance from ${prev.invoice_no}`, qty: 1, amount: prev.balance });
  }
  const inv = createInvoice({
    customerId: c.id, items, periodFrom, periodTo, dueDate,
    generatedBy: 'auto', notes: 'Auto-generated by scheduler',
  });
  return inv;
}

module.exports = {
  createInvoice, getInvoice, markInvoiceStatus, customerLedger,
  lateFeeAmount, outstandingInvoices, prorateChange,
  generateDueInvoices, buildCycleInvoice, ledgerEntry,
};

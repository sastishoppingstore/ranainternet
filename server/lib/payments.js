'use strict';
/*
 * Payments: recording with duplicate transaction-ref detection, approval /
 * rejection / refund with exactly-once journal posting, auto-reactivation.
 */
const { db, tx } = require('../db');
const { postJournal, logTransaction, accountByCategory, accountIdForBank } = require('./accounting');
const { getInvoice, markInvoiceStatus, ledgerEntry } = require('./billing');
const { nowUTC, nextSeq } = require('./util');

function paymentRef() { return nextSeq(db, 'payments', 'id', 'PMT-', 6); }

/** Duplicate transaction/reference id check (across all payment methods). */
function findDuplicateRef(ref, excludeId = null) {
  if (!ref || !String(ref).trim()) return null;
  const r = String(ref).trim();
  const row = db.prepare(
    `SELECT * FROM payments WHERE transaction_ref = ? ${excludeId ? 'AND id != ?' : ''}
     ORDER BY id DESC LIMIT 1`
  ).get(...(excludeId ? [r, excludeId] : [r]));
  return row || null;
}

/**
 * Record a payment (status pending).
 * opts: { customerId, invoiceId, amount (paise), method, transactionRef,
 *         accountId, receivedBy, notes, attachmentPath, force }
 * Returns { payment } or throws { code: 'DUPLICATE_REF', existing }.
 */
function recordPayment(opts, userId) {
  const dup = findDuplicateRef(opts.transactionRef);
  if (dup && !opts.force) {
    const err = new Error(`Duplicate transaction/reference ID "${opts.transactionRef}" — already used by ${dup.payment_ref}`);
    err.code = 'DUPLICATE_REF';
    err.existing = { paymentRef: dup.payment_ref, amount: dup.amount, date: dup.created_at, status: dup.status };
    throw err;
  }
  const ref = paymentRef();
  const info = db.prepare(
    `INSERT INTO payments(payment_ref, method, customer_id, invoice_id, amount, fee, transaction_ref,
      account_id, status, received_by, notes, attachment_path)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(ref, opts.method, opts.customerId, opts.invoiceId || null, opts.amount,
    opts.fee || 0, opts.transactionRef || null, opts.accountId || null,
    'pending', opts.receivedBy || null, opts.notes || null, opts.attachmentPath || null);
  return getPayment(Number(info.lastInsertRowid));
}

function getPayment(id) {
  const p = db.prepare('SELECT * FROM payments WHERE id=?').get(id);
  if (!p) return null;
  p.customer = db.prepare('SELECT customer_code, name, phone FROM customers WHERE id=?').get(p.customer_id);
  p.invoice = p.invoice_id ? { id: p.invoice_id, invoice_no: db.prepare('SELECT invoice_no FROM invoices WHERE id=?').get(p.invoice_id).invoice_no } : null;
  p.approvals = db.prepare('SELECT * FROM payment_approvals WHERE payment_id=? ORDER BY id').all(id);
  return p;
}

/**
 * Approve a payment. Posts journal EXACTLY ONCE (guarded by `posted` flag).
 * Dr cash/bank account, Cr Accounts Receivable (or revenue credit if advance w/o invoice).
 * Advances an advance payment (no invoice) to customers.advance.
 */
function approvePayment(paymentId, userId, reason = null) {
  return tx((d) => {
    const p = d.prepare('SELECT * FROM payments WHERE id=?').get(paymentId);
    if (!p) throw new Error('Payment not found');
    if (p.status !== 'pending') throw new Error(`Payment already ${p.status}`);
    d.prepare(`UPDATE payments SET status='approved', approved_at=? WHERE id=?`).run(nowUTC(), paymentId);
    d.prepare('INSERT INTO payment_approvals(payment_id, user_id, action, reason) VALUES(?,?,?,?)')
      .run(paymentId, userId, 'approve', reason);

    const cashAcctId = p.account_id ? accountIdForBank(p.account_id) : accountByCategory('cash', 'asset');
    const arId = accountByCategory('receivable', 'asset');

    if (p.invoice_id) {
      postJournalInTx(d, {
        entryDate: nowUTC().slice(0, 10),
        memo: `Payment ${p.payment_ref} for invoice ${p.invoice_no || ''}`,
        source: 'payment', refId: paymentId,
        lines: [
          { account_id: cashAcctId, debit: p.amount, credit: 0 },
          { account_id: arId, debit: 0, credit: p.amount },
        ],
      });
      logTransaction('payment', 'payments', paymentId, p.amount, cashAcctId);
      ledgerEntry(p.customer_id, 'payment', 'credit', p.amount, `Payment ${p.payment_ref}`, p.invoice_id, paymentId);
      const inv = getInvoice(p.invoice_id);
      markInvoiceStatus(inv);
    } else {
      // advance payment
      d.prepare('UPDATE customers SET advance = advance + ? WHERE id=?').run(p.amount, p.customer_id);
      postJournalInTx(d, {
        entryDate: nowUTC().slice(0, 10),
        memo: `Advance payment ${p.payment_ref}`,
        source: 'payment', refId: paymentId,
        lines: [
          { account_id: cashAcctId, debit: p.amount, credit: 0 },
          { account_id: arId, debit: 0, credit: p.amount },
        ],
      });
      logTransaction('advance', 'payments', paymentId, p.amount, cashAcctId);
      ledgerEntry(p.customer_id, 'payment', 'credit', p.amount, `Advance ${p.payment_ref}`, null, paymentId);
    }

    d.prepare('UPDATE payments SET posted=1 WHERE id=?').run(paymentId);

    // Auto-reactivation if suspended for dues and enabled in settings
    try {
      const cfg = require('../config').getSetting('automation') || {};
      const customer = d.prepare('SELECT * FROM customers WHERE id=?').get(p.customer_id);
      if (customer && customer.status === 'suspended' && cfg.auto_reactivate === true) {
        require('./devices').queueCommand({
          deviceKind: 'router', customerId: p.customer_id,
          action: 'enable_user', initiatedBy: userId,
          source: 'auto_reactivate',
        });
        d.prepare(`UPDATE customers SET device_status='pending_sync' WHERE id=?`).run(p.customer_id);
      }
    } catch (e) {
      console.error('[payments] auto-reactivation queue failed:', e.message);
    }

    return getPayment(paymentId);
  });
}

function postJournalInTx(d, entry) {
  const totalDr = entry.lines.reduce((s, l) => s + (l.debit || 0), 0);
  const totalCr = entry.lines.reduce((s, l) => s + (l.credit || 0), 0);
  if (totalDr !== totalCr || totalDr === 0) throw new Error('Unbalanced journal entry');
  const entryNo = nextSeq(d, 'journal_entries', 'id', 'JE-', 6);
  const info = d.prepare(
    'INSERT INTO journal_entries(entry_no, entry_date, memo, source, ref_id, created_by) VALUES(?,?,?,?,?,?)'
  ).run(entryNo, entry.entryDate, entry.memo, entry.source, entry.refId, entry.createdBy || null);
  const lineIns = d.prepare('INSERT INTO journal_lines(entry_id, account_id, debit, credit) VALUES(?,?,?,?)');
  for (const l of entry.lines) lineIns.run(info.lastInsertRowid, l.account_id, l.debit || 0, l.credit || 0);
}

function rejectPayment(paymentId, userId, reason) {
  if (!reason) throw new Error('Rejection reason is required');
  return tx((d) => {
    const p = d.prepare('SELECT * FROM payments WHERE id=?').get(paymentId);
    if (!p) throw new Error('Payment not found');
    if (p.status !== 'pending') throw new Error(`Payment already ${p.status}`);
    d.prepare(`UPDATE payments SET status='rejected', reject_reason=? WHERE id=?`).run(reason, paymentId);
    d.prepare('INSERT INTO payment_approvals(payment_id, user_id, action, reason) VALUES(?,?,?,?)')
      .run(paymentId, userId, 'reject', reason);
    return getPayment(paymentId);
  });
}

function refundPayment(paymentId, userId, reason) {
  if (!reason) throw new Error('Refund reason is required');
  return tx((d) => {
    const p = d.prepare('SELECT * FROM payments WHERE id=?').get(paymentId);
    if (!p) throw new Error('Payment not found');
    if (p.status !== 'approved' || p.posted !== 1) throw new Error('Only posted approved payments can be refunded');
    d.prepare(`UPDATE payments SET status='refunded', reject_reason=? WHERE id=?`).run(reason, paymentId);
    d.prepare('INSERT INTO payment_approvals(payment_id, user_id, action, reason) VALUES(?,?,?,?)')
      .run(paymentId, userId, 'refund', reason);
    // reversal journal: Dr AR / Cr cash (reverse of approval)
    const cashAcctId = p.account_id ? accountIdForBank(p.account_id) : accountByCategory('cash', 'asset');
    const arId = accountByCategory('receivable', 'asset');
    postJournalInTx(d, {
      entryDate: nowUTC().slice(0, 10),
      memo: `Refund of ${p.payment_ref} — ${reason}`,
      source: 'adjustment', refId: paymentId,
      lines: [
        { account_id: arId, debit: p.amount, credit: 0 },
        { account_id: cashAcctId, debit: 0, credit: p.amount },
      ],
    });
    if (!p.invoice_id) {
      d.prepare('UPDATE customers SET advance = MAX(advance - ?, 0) WHERE id=?').run(p.amount, p.customer_id);
    }
    ledgerEntry(p.customer_id, 'refund', 'debit', p.amount, `Refund of ${p.payment_ref} — ${reason}`, p.invoice_id, paymentId);
    if (p.invoice_id) {
      const inv = getInvoice(p.invoice_id);
      markInvoiceStatus(inv);
    }
    return getPayment(paymentId);
  });
}

module.exports = {
  recordPayment, getPayment, approvePayment, rejectPayment, refundPayment, findDuplicateRef,
};

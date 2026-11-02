'use strict';
/*
 * Double-entry accounting engine.
 * Every financial event posts a BALANCED journal entry (total debit == total credit).
 * Corrections are done via reversal/adjustment entries — never silent edits.
 */
const { db, tx } = require('../db');
const { nowUTC, nextSeq } = require('./util');

/** Seed the standard chart of accounts (idempotent). */
function ensureChart() {
  const std = [
    ['1000', 'Cash on Hand', 'asset', 'cash', 1],
    ['1010', 'Bank Account (Primary)', 'asset', 'bank', 1],
    ['1100', 'Accounts Receivable', 'asset', 'receivable', 1],
    ['1200', 'Inventory Stock', 'asset', 'inventory', 1],
    ['1300', 'Suppliers Payable (Inventory)', 'liability', 'supplier', 1],
    ['2000', 'Upstream Provider Payable', 'liability', 'provider', 1],
    ['3000', 'Owner Capital', 'equity', 'capital', 1],
    ['3100', 'Opening Balance Equity', 'equity', 'capital', 1],
    ['4000', 'Internet Service Revenue', 'income', 'revenue', 1],
    ['4100', 'Installation & Other Income', 'income', 'revenue', 1],
    ['5000', 'Upstream Bandwidth Cost', 'expense', 'upstream', 1],
    ['5100', 'Salaries & Wages', 'expense', 'salary', 1],
    ['5200', 'Rent', 'expense', 'rent', 1],
    ['5300', 'Electricity', 'expense', 'electricity', 1],
    ['5400', 'Fuel & Transport', 'expense', 'fuel', 1],
    ['5500', 'Maintenance & Repairs', 'expense', 'maintenance', 1],
    ['5600', 'Fiber & Network Materials', 'expense', 'material', 1],
    ['5700', 'Miscellaneous Expense', 'expense', 'misc', 1],
    ['5800', 'Late Fee Income', 'income', 'revenue', 1],
  ];
  const ins = db.prepare('INSERT OR IGNORE INTO accounts(code, name, type, category, is_system) VALUES(?,?,?,?,?)');
  for (const s of std) ins.run(...s);
}
function accountByCategory(category, type) {
  const row = db.prepare('SELECT id FROM accounts WHERE category=? AND type=? ORDER BY id LIMIT 1').get(category, type);
  return row ? row.id : null;
}
function accountIdForBank(bankAccountId) {
  const row = db.prepare('SELECT account_id FROM bank_accounts WHERE id=?').get(bankAccountId);
  return row && row.account_id ? row.account_id : accountByCategory('cash', 'asset');
}

/**
 * Post a balanced journal entry.
 * lines: [{account_id, debit, credit}] in paise. Throws if unbalanced.
 */
function postJournal({ entryDate, memo, source, refId = null, createdBy = null, lines }) {
  return tx((d) => {
    const totalDr = lines.reduce((s, l) => s + (l.debit || 0), 0);
    const totalCr = lines.reduce((s, l) => s + (l.credit || 0), 0);
    if (totalDr !== totalCr || totalDr === 0) {
      throw new Error(`Unbalanced journal entry: debit ${totalDr} != credit ${totalCr}`);
    }
    const entryNo = nextSeq(d, 'journal_entries', 'id', 'JE-', 6);
    const info = d.prepare(
      'INSERT INTO journal_entries(entry_no, entry_date, memo, source, ref_id, created_by) VALUES(?,?,?,?,?,?)'
    ).run(entryNo, entryDate, memo, source, refId, createdBy);
    const lineIns = d.prepare('INSERT INTO journal_lines(entry_id, account_id, debit, credit) VALUES(?,?,?,?)');
    for (const l of lines) lineIns.run(info.lastInsertRowid, l.account_id, l.debit || 0, l.credit || 0);
    return { entryNo, id: Number(info.lastInsertRowid), total: totalDr };
  });
}

/**
 * Post a balanced entry on an ALREADY-OPEN transaction handle `d`
 * (used by composite operations like purchases/salaries/provider payments).
 */
function postJournalInTxSafe(d, entry) {
  const totalDr = entry.lines.reduce((s, l) => s + (l.debit || 0), 0);
  const totalCr = entry.lines.reduce((s, l) => s + (l.credit || 0), 0);
  if (totalDr !== totalCr || totalDr === 0) throw new Error('Unbalanced journal entry');
  const entryNo = nextSeq(d, 'journal_entries', 'id', 'JE-', 6);
  const info = d.prepare(
    'INSERT INTO journal_entries(entry_no, entry_date, memo, source, ref_id, created_by) VALUES(?,?,?,?,?,?)'
  ).run(entryNo, entry.entryDate, entry.memo, entry.source, entry.refId, entry.createdBy || null);
  const lineIns = d.prepare('INSERT INTO journal_lines(entry_id, account_id, debit, credit) VALUES(?,?,?,?)');
  for (const l of entry.lines) lineIns.run(info.lastInsertRowid, l.account_id, l.debit || 0, l.credit || 0);
  return { entryNo, id: Number(info.lastInsertRowid) };
}

/** Record a financial event in the transaction log. */
function logTransaction(ftype, refTable, refId, amount, accountId = null) {
  db.prepare('INSERT INTO financial_transactions(ftype, ref_table, ref_id, amount, account_id) VALUES(?,?,?,?,?)')
    .run(ftype, refTable, refId, amount, accountId);
}

/** Account balance = debits - credits (assets/expenses); liabilities/equity/income shown inverted. */
function accountBalance(accountId, atDate = null) {
  const row = db.prepare(
    `SELECT COALESCE(SUM(jl.debit),0) dr, COALESCE(SUM(jl.credit),0) cr
     FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
     WHERE jl.account_id = ? ${atDate ? 'AND je.entry_date <= ?' : ''}`
  ).get(...(atDate ? [accountId, atDate] : [accountId]));
  return (row.dr - row.cr);
}

/** Trial balance at a date (or latest). */
function trialBalance(atDate = null) {
  ensureChart();
  const accounts = db.prepare('SELECT * FROM accounts ORDER BY code').all();
  const agg = atDate
    ? db.prepare(`SELECT jl.account_id, SUM(jl.debit) dr, SUM(jl.credit) cr
                  FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
                  WHERE je.entry_date <= ? GROUP BY jl.account_id`).all(atDate)
    : db.prepare(`SELECT jl.account_id, SUM(jl.debit) dr, SUM(jl.credit) cr
                  FROM journal_lines jl GROUP BY jl.account_id`).all();
  const map = new Map(agg.map((r) => [r.account_id, r]));
  const rows = accounts.map((a) => {
    const m = map.get(a.id) || { dr: 0, cr: 0 };
    const diff = m.dr - m.cr;
    // trial balance columns follow the balance direction of every account
    return {
      code: a.code, name: a.name, type: a.type, category: a.category,
      debit: Math.max(diff, 0),
      credit: Math.max(-diff, 0),
    };
  });
  const totals = rows.reduce((t, r) => ({ dr: t.dr + r.debit, cr: t.cr + r.credit }), { dr: 0, cr: 0 });
  return { rows, totals, balanced: totals.dr === totals.cr, at: atDate };
}

/** Cashbook / bankbook for a bank_account. */
function cashbook(bankAccountId, from = null, to = null) {
  const acctId = accountIdForBank(bankAccountId);
  let sql = `
    SELECT je.id, je.entry_no, je.entry_date, je.memo, je.source,
           CASE WHEN jl.debit > 0 THEN jl.debit ELSE jl.credit END AS amount,
           CASE WHEN jl.debit > 0 THEN 'in' ELSE 'out' END AS dir
    FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
    WHERE jl.account_id = ?`;
  const args = [acctId];
  if (from) { sql += ' AND je.entry_date >= ?'; args.push(from); }
  if (to) { sql += ' AND je.entry_date <= ?'; args.push(to); }
  sql += ' ORDER BY je.entry_date, je.id';
  return db.prepare(sql).all(...args);
}

/** Account ledger (all journals touching the chart account). */
function accountLedger(accountId, from = null, to = null) {
  let sql = `
    SELECT je.entry_no, je.entry_date, je.memo, je.source, jl.debit, jl.credit
    FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
    WHERE jl.account_id = ?`;
  const args = [accountId];
  if (from) { sql += ' AND je.entry_date >= ?'; args.push(from); }
  if (to) { sql += ' AND je.entry_date <= ?'; args.push(to); }
  sql += ' ORDER BY je.entry_date, je.id';
  const rows = db.prepare(sql).all(...args);
  let run = 0;
  for (const r of rows) { run += (r.debit || 0) - (r.credit || 0); r.balance = run; }
  return rows;
}

/** Daily closing summary per cash/bank account. */
function dailyClose(dateStr) {
  const bps = db.prepare('SELECT * FROM bank_accounts WHERE is_active=1').all();
  const rows = bps.map((bp) => {
    const entries = db.prepare(
      `SELECT CASE WHEN jl.debit>0 THEN jl.debit ELSE jl.credit END amt,
              CASE WHEN jl.debit>0 THEN 1 ELSE 0 END dir
       FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
       WHERE jl.account_id = (SELECT account_id FROM bank_accounts WHERE id=?)
         AND je.entry_date = ?`
    ).all(bp.id, dateStr);
    const inAmt = entries.filter((e) => e.dir === 1).reduce((s, e) => s + e.amt, 0);
    const outAmt = entries.filter((e) => e.dir === 0).reduce((s, e) => s + e.amt, 0);
    return { bank_account: bp, in: inAmt, out: outAmt, net: inAmt - outAmt, balance: accountBalance(accountIdForBank(bp.id), dateStr) };
  });
  return { date: dateStr, accounts: rows };
}

module.exports = {
  ensureChart, postJournal, postJournalInTxSafe, logTransaction, accountBalance,
  trialBalance, cashbook, accountLedger, dailyClose,
  accountByCategory, accountIdForBank,
};

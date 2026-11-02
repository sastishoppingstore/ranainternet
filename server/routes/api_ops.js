'use strict';
/*
 * Owner API — Part 2: invoices, payments, ledger, recovery, network
 * inventory, installations, tickets, inventory, staff, accounts/journal,
 * providers, P&L, devices, settings, backups, templates, audit, reports.
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const busboy = require('busboy');
const QRCode = require('qrcode');
const { db, tx } = require('../db');
const { getSetting, setSetting, config } = require('../config');
const { requireOwner, requireCsrf, audit, encryptSecret, decryptSecret } = require('../lib/auth');
const { toPaise, fmtMoney, todayPKT, addDays, nextSeq, toCsv, daysBetween, sniffMime } = require('../lib/util');
const { createInvoice, getInvoice, markInvoiceStatus, customerLedger, outstandingInvoices, generateDueInvoices } = require('../lib/billing');
const { recordPayment, getPayment, approvePayment, rejectPayment, refundPayment } = require('../lib/payments');
const ac = require('../lib/accounting');
const devices = require('../lib/devices');
const { sendNotification } = require('../lib/notify');
const { invoicePdf } = require('../lib/pdf');

const router = express.Router();
router.use(requireOwner);

const J = express.json({ limit: '2mb' });

/* ============================ INVOICES ============================ */
router.get('/invoices', (req, res) => {
  const { status, customer_id, from, to, page = 1 } = req.query;
  const perPage = 25;
  let where = 'WHERE 1=1';
  const args = [];
  if (status) { where += ' AND i.status=?'; args.push(status); }
  if (customer_id) { where += ' AND i.customer_id=?'; args.push(customer_id); }
  if (from) { where += ' AND i.due_date >= ?'; args.push(from); }
  if (to) { where += ' AND i.due_date <= ?'; args.push(to); }
  const total = db.prepare(`SELECT COUNT(*) c FROM invoices i ${where}`).get(...args).c;
  const rows = db.prepare(
    `SELECT i.*, c.name customer_name, c.customer_code, p.name package_name
     FROM invoices i JOIN customers c ON c.id=i.customer_id LEFT JOIN packages p ON p.id=c.package_id
     ${where} ORDER BY i.id DESC LIMIT ? OFFSET ?`
  ).all(...args, perPage, (parseInt(page, 10) - 1) * perPage);
  res.json({ rows, total, page: parseInt(page, 10), pages: Math.ceil(total / perPage) });
});

router.get('/invoices/:id', (req, res) => {
  const inv = getInvoice(Number(req.params.id));
  if (!inv) return res.status(404).json({ error: 'Not found' });
  res.json(inv);
});

router.get('/invoices/:id/pdf', async (req, res) => {
  const inv = getInvoice(Number(req.params.id));
  if (!inv) return res.status(404).end();
  const company = getSetting('company') || {};
  let qr = null;
  try {
    qr = await QRCode.create(`RANA-INTERNET|${inv.invoice_no}|${(inv.balance / 100).toFixed(2)}`, { errorCorrectionLevel: 'M' });
    qr = qr.modules;
  } catch { /* QR optional */ }
  const buf = invoicePdf(inv, company, qr && qr.data ? qr : null);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${inv.invoice_no}.pdf"`);
  res.send(buf);
});

router.post('/invoices', J, requireCsrf, (req, res) => {
  const b = req.body;
  if (!b.customer_id) return res.status(422).json({ error: 'Customer required' });
  const items = Array.isArray(b.items) ? b.items : [];
  if (!items.length) return res.status(422).json({ error: 'At least one line item required' });
  const inv = createInvoice({
    customerId: Number(b.customer_id),
    items: items.map((i) => ({
      item_type: ['package', 'installation', 'discount', 'advance_adjustment', 'previous_balance', 'late_fee', 'other'].includes(i.item_type) ? i.item_type : 'other',
      description: String(i.description || 'Charge'), qty: parseFloat(i.qty) || 1, amount: toPaise(i.amount),
    })),
    periodFrom: b.period_from || todayPKT(), periodTo: b.period_to || todayPKT(),
    dueDate: /^\d{4}-\d{2}-\d{2}$/.test(b.due_date || '') ? b.due_date : addDays(todayPKT(), 10),
    notes: b.notes || 'Manually created invoice', generatedBy: `user:${req.user.id}`,
  });
  audit(req.user.id, 'invoice_created', 'invoices', inv.id, { no: inv.invoice_no, total: inv.total, customer: b.customer_id }, req.ip);
  res.status(201).json(inv);
});

router.post('/invoices/generate-now', J, requireCsrf, (req, res) => {
  const created = generateDueInvoices(req.user.id);
  audit(req.user.id, 'invoices_generated', 'invoices', null, { count: created.length }, req.ip);
  res.json({ created: created.length, invoices: created.map((i) => ({ id: i.id, no: i.invoice_no, total: i.total })) });
});

/* ============================ PAYMENTS ============================ */
router.get('/payments', (req, res) => {
  const { status, method, customer_id, from, to, page = 1 } = req.query;
  const perPage = 25;
  let where = 'WHERE 1=1';
  const args = [];
  if (status) { where += ' AND p.status=?'; args.push(status); }
  if (method) { where += ' AND p.method=?'; args.push(method); }
  if (customer_id) { where += ' AND p.customer_id=?'; args.push(customer_id); }
  if (from) { where += ' AND p.created_at >= ?'; args.push(from); }
  if (to) { where += ' AND p.created_at <= ?'; args.push(to + ' 23:59:59'); }
  const total = db.prepare(`SELECT COUNT(*) c FROM payments p ${where}`).get(...args).c;
  const rows = db.prepare(
    `SELECT p.*, c.name customer_name, c.customer_code, i.invoice_no
     FROM payments p JOIN customers c ON c.id=p.customer_id LEFT JOIN invoices i ON i.id=p.invoice_id
     ${where} ORDER BY p.id DESC LIMIT ? OFFSET ?`
  ).all(...args, perPage, (parseInt(page, 10) - 1) * perPage);
  res.json({ rows, total, page: parseInt(page, 10), pages: Math.ceil(total / perPage) });
});

router.get('/payments/:id', (req, res) => {
  const p = getPayment(Number(req.params.id));
  if (!p) return res.status(404).json({ error: 'Not found' });
  res.json(p);
});

router.post('/payments', J, requireCsrf, (req, res) => {
  const b = req.body;
  const amount = toPaise(b.amount);
  if (!b.customer_id || amount <= 0) return res.status(422).json({ error: 'Customer and positive amount required' });
  const methods = ['cash', 'bank_transfer', 'jazzcash', 'easypaisa', 'raast', 'other'];
  const method = methods.includes(b.method) ? b.method : 'cash';
  const customer = db.prepare('SELECT * FROM customers WHERE id=?').get(Number(b.customer_id));
  if (!customer) return res.status(404).json({ error: 'Customer not found' });
  let invoiceId = b.invoice_id ? Number(b.invoice_id) : null;
  if (invoiceId) {
    const inv = db.prepare('SELECT * FROM invoices WHERE id=? AND customer_id=?').get(invoiceId, customer.id);
    if (!inv) return res.status(422).json({ error: 'Invoice not found for this customer' });
    if (amount > inv.balance + 0.01 * 100 && b.allow_overpay !== true) {
      return res.status(422).json({ error: `Amount exceeds invoice balance (${fmtMoney(inv.balance)})` });
    }
  }
  try {
    const p = recordPayment({
      customerId: customer.id, invoiceId, amount, method,
      transactionRef: b.transaction_ref || null, accountId: b.account_id ? Number(b.account_id) : null,
      receivedBy: b.received_by || req.user.name, notes: b.notes || null,
      attachmentPath: null, force: b.force === true,
    }, req.user.id);
    audit(req.user.id, 'payment_recorded', 'payments', p.id, { ref: p.payment_ref, amount, method, customer: customer.name, invoice: invoiceId }, req.ip);
    res.status(201).json(p);
  } catch (e) {
    if (e.code === 'DUPLICATE_REF') return res.status(409).json({ error: e.message, duplicate: e.existing });
    throw e;
  }
});

/** Payment attachment (receipt screenshot) after creation. */
router.post('/payments/:id/attachment', requireCsrf, (req, res) => {
  const p = db.prepare('SELECT * FROM payments WHERE id=?').get(Number(req.params.id));
  if (!p) return res.status(404).json({ error: 'Not found' });
  const bb = busboy({ headers: req.headers, limits: { fileSize: config.maxUploadBytes } });
  let done = false;
  bb.on('file', (field, file) => {
    const dest = path.join(config.dataDir, 'uploads', `pay-${p.id}-${Date.now()}.bin`);
    const ws = fs.createWriteStream(dest);
    const chunks = [];
    file.on('data', (d) => chunks.push(d));
    file.pipe(ws);
    ws.on('finish', () => {
      const buf = Buffer.concat(chunks);
      const mime = sniffMime(buf);
      if (!mime) { fs.unlinkSync(dest); if (!done) { done = true; res.status(422).json({ error: 'Unsupported file type' }); } return; }
      const ext = mime.includes('pdf') ? 'pdf' : mime.split('/')[1];
      const rel = path.join('uploads', `pay-${p.id}-${Date.now()}.${ext}`);
      fs.renameSync(dest, path.join(config.dataDir, rel));
      db.prepare('UPDATE payments SET attachment_path=? WHERE id=?').run(rel, p.id);
      audit(req.user.id, 'payment_attachment', 'payments', p.id, null, req.ip);
      if (!done) { done = true; res.json({ ok: true }); }
    });
  });
  bb.on('close', () => { if (!done) { done = true; res.json({ ok: true, count: 0 }); } });
  bb.on('error', (e) => { if (!done) { done = true; res.status(400).json({ error: e.message }); } });
  req.pipe(bb);
});

router.get('/files/payment/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM payments WHERE id=?').get(Number(req.params.id));
  if (!p || !p.attachment_path) return res.status(404).end();
  const fp = path.join(config.dataDir, p.attachment_path);
  if (!fs.existsSync(fp)) return res.status(404).end();
  res.sendFile(fp);
});

router.post('/payments/:id/approve', J, requireCsrf, (req, res) => {
  try {
    const p = approvePayment(Number(req.params.id), req.user.id, req.body.reason || null);
    audit(req.user.id, 'payment_approved', 'payments', p.id, { ref: p.payment_ref, amount: p.amount }, req.ip);
    const customer = db.prepare('SELECT * FROM customers WHERE id=?').get(p.customer_id);
    if (customer) sendNotification({ templateKey: 'payment_approved', customerId: customer.id, toAddress: customer.whatsapp || customer.phone, vars: { customer_name: customer.name, amount: fmtMoney(p.amount) } });
    res.json(p);
  } catch (e) { res.status(422).json({ error: e.message }); }
});
router.post('/payments/:id/reject', J, requireCsrf, (req, res) => {
  try {
    const p = rejectPayment(Number(req.params.id), req.user.id, String(req.body.reason || '').trim());
    audit(req.user.id, 'payment_rejected', 'payments', p.id, { reason: req.body.reason }, req.ip);
    res.json(p);
  } catch (e) { res.status(422).json({ error: e.message }); }
});
router.post('/payments/:id/refund', J, requireCsrf, (req, res) => {
  try {
    const p = refundPayment(Number(req.params.id), req.user.id, String(req.body.reason || '').trim());
    audit(req.user.id, 'payment_refunded', 'payments', p.id, { reason: req.body.reason }, req.ip);
    res.json(p);
  } catch (e) { res.status(422).json({ error: e.message }); }
});

/* ============================ LEDGER & RECOVERY ============================ */
router.get('/ledger', (req, res) => {
  const { customer_id, from, to } = req.query;
  if (customer_id) return res.json(customerLedger(Number(customer_id)));
  // global AR summary
  const rows = db.prepare(
    `SELECT c.id, c.customer_code, c.name, c.phone, c.status,
      COALESCE((SELECT SUM(i.balance) FROM invoices i WHERE i.customer_id=c.id AND i.status IN ('unpaid','partial')),0) dues,
      COALESCE(c.advance,0) credit
     FROM customers c WHERE c.archived_at IS NULL
     HAVING dues > 0 OR credit > 0 ORDER BY dues DESC LIMIT 500`
  ).all(from || null, to || null);
  res.json(rows);
});

router.get('/recovery', (req, res) => {
  const { bucket, area_id, assigned, page = 1 } = req.query;
  const perPage = 25;
  let rows = outstandingInvoices();
  if (bucket) rows = rows.filter((r) => r.bucket === bucket);
  if (area_id) rows = rows.filter((r) => r.area_id === parseInt(area_id, 10));
  const assign = new Map(db.prepare('SELECT customer_id, staff_id, notes, at FROM recovery_assignments ORDER BY id DESC').all().map((a) => [a.customer_id, a]));
  if (assigned) rows = rows.filter((r) => assign.get(r.customer_id)?.staff_id === parseInt(assigned, 10));
  const promises = new Map(db.prepare('SELECT customer_id, promise_date, amount, notes FROM promises_to_pay WHERE fulfilled=0').all().map((p) => [p.customer_id, p]));
  const enriched = rows.map((r) => ({
    ...r,
    assignment: assign.get(r.customer_id) || null,
    promise: promises.get(r.customer_id) || null,
  }));
  const totals = {
    outstanding: rows.reduce((s, r) => s + r.balance, 0),
    overdue: rows.filter((r) => r.days_overdue > 0).reduce((s, r) => s + r.balance, 0),
    buckets: {
      '1-7': rows.filter((r) => r.bucket === '1-7').reduce((s, r) => s + r.balance, 0),
      '8-15': rows.filter((r) => r.bucket === '8-15').reduce((s, r) => s + r.balance, 0),
      '16+': rows.filter((r) => r.bucket === '16+').reduce((s, r) => s + r.balance, 0),
    },
  };
  res.json({ rows: enriched.slice((page - 1) * perPage, page * perPage), total: rows.length, totals });
});

router.post('/recovery/assign', J, requireCsrf, (req, res) => {
  const { customer_id, staff_id, notes } = req.body;
  if (!customer_id) return res.status(422).json({ error: 'customer_id required' });
  db.prepare('INSERT INTO recovery_assignments(customer_id, staff_id, assigned_by, notes) VALUES(?,?,?,?)')
    .run(Number(customer_id), staff_id ? Number(staff_id) : null, req.user.id, notes || null);
  audit(req.user.id, 'recovery_assigned', 'recovery_assignments', customer_id, { staff_id }, req.ip);
  res.json({ ok: true });
});

router.post('/promises', J, requireCsrf, (req, res) => {
  const { customer_id, promise_date, amount, notes } = req.body;
  if (!customer_id || !promise_date) return res.status(422).json({ error: 'customer_id and promise_date required' });
  db.prepare('INSERT INTO promises_to_pay(customer_id, promise_date, amount, notes) VALUES(?,?,?,?)')
    .run(Number(customer_id), promise_date, toPaise(amount), notes || null);
  audit(req.user.id, 'promise_to_pay', 'promises_to_pay', customer_id, { promise_date, amount: toPaise(amount) }, req.ip);
  res.json({ ok: true });
});

/* ============================ NETWORK INVENTORY ============================ */
function crud(name, table, fields, { delGuard = null } = {}) {
  router.get(`/${name}`, (req, res) => {
    res.json(db.prepare(`SELECT * FROM ${table} ORDER BY id DESC`).all());
  });
  router.post(`/${name}`, J, requireCsrf, (req, res) => {
    const b = req.body;
    const vals = fields.map((f) => {
      const v = b[f];
      if (v === undefined || v === '') return null;
      if (['int', 'money'].includes(f.type)) return f.type === 'money' ? toPaise(v) : parseInt(v, 10) || 0;
      if (f.type === 'float') return parseFloat(v) || null;
      return String(v).slice(0, 500);
    });
    try {
      const info = db.prepare(
        `INSERT INTO ${table}(${fields.map((f) => f.key).join(',')}) VALUES(${fields.map(() => '?').join(',')})`
      ).run(...vals);
      audit(req.user.id, `${name.slice(0, -1)}_created`, table, Number(info.lastInsertRowid), b, req.ip);
      res.status(201).json({ id: Number(info.lastInsertRowid) });
    } catch (e) {
      res.status(409).json({ error: e.message });
    }
  });
  router.put(`/${name}/:id`, J, requireCsrf, (req, res) => {
    const row = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'Not found' });
    const b = req.body;
    const sets = fields.map((f) => `${f.key}=?`);
    const vals = fields.map((f) => {
      if (!(f.key in b)) return row[f.key];
      const v = b[f.key];
      if (v === '') return null;
      if (['int', 'money'].includes(f.type)) return f.type === 'money' ? toPaise(v) : parseInt(v, 10) || 0;
      if (f.type === 'float') return parseFloat(v) || null;
      return String(v).slice(0, 500);
    });
    try {
      db.prepare(`UPDATE ${table} SET ${sets.join(',')} WHERE id=?`).run(...vals, row.id);
      audit(req.user.id, `${name.slice(0, -1)}_updated`, table, row.id, b, req.ip);
      res.json({ ok: true });
    } catch (e) { res.status(409).json({ error: e.message }); }
  });
  router.delete(`/${name}/:id`, requireCsrf, (req, res) => {
    const row = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (delGuard) {
      const g = delGuard(row);
      if (g) return res.status(409).json({ error: g });
    }
    try {
      db.prepare(`DELETE FROM ${table} WHERE id=?`).run(row.id);
      audit(req.user.id, `${name.slice(0, -1)}_deleted`, table, row.id, null, req.ip);
      res.json({ ok: true });
    } catch (e) { res.status(409).json({ error: 'Cannot delete — records depend on it' }); }
  });
}

crud('areas', 'areas', [
  { key: 'name', type: 'str' }, { key: 'zone', type: 'str' },
  { key: 'description', type: 'str' }, { key: 'lat', type: 'float' }, { key: 'lng', type: 'float' },
  { key: 'is_active', type: 'int' },
]);

crud('pops', 'pops', [
  { key: 'name', type: 'str' }, { key: 'area_id', type: 'int' },
  { key: 'address', type: 'str' }, { key: 'lat', type: 'float' }, { key: 'lng', type: 'float' }, { key: 'notes', type: 'str' },
]);

crud('olts', 'olts', [
  { key: 'name', type: 'str' }, { key: 'device_id', type: 'int' }, { key: 'pop_id', type: 'int' },
  { key: 'pon_count', type: 'int' }, { key: 'vendor', type: 'str' }, { key: 'model', type: 'str' },
  { key: 'driver_status', type: 'str' }, { key: 'notes', type: 'str' },
], {
  delGuard: (row) => db.prepare('SELECT COUNT(*) c FROM pon_ports WHERE olt_id=?').get(row.id).c > 0
    ? 'OLT has PON ports — delete those first' : null,
});

/** PON ports under an OLT. */
router.get('/olts/:id/pon-ports', (req, res) => {
  const rows = db.prepare('SELECT * FROM pon_ports WHERE olt_id=? ORDER BY port_no').all(Number(req.params.id));
  res.json(rows);
});
router.post('/olts/:id/pon-ports', J, requireCsrf, (req, res) => {
  const olt = db.prepare('SELECT * FROM olts WHERE id=?').get(Number(req.params.id));
  if (!olt) return res.status(404).json({ error: 'OLT not found' });
  const portNo = parseInt(req.body.port_no, 10);
  if (!portNo) return res.status(422).json({ error: 'port_no required' });
  try {
    const info = db.prepare(
      `INSERT INTO pon_ports(olt_id, port_no, name, profile, status) VALUES(?,?,?,?,?)`
    ).run(olt.id, portNo, req.body.name || `PON ${portNo}`, req.body.profile || 'default', 'available');
    audit(req.user.id, 'pon_port_created', 'pon_ports', Number(info.lastInsertRowid), null, req.ip);
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  } catch (e) { res.status(409).json({ error: 'Port number already exists on this OLT' }); }
});
router.put('/pon-ports/:id', J, requireCsrf, (req, res) => {
  const p = db.prepare('SELECT * FROM pon_ports WHERE id=?').get(Number(req.params.id));
  if (!p) return res.status(404).json({ error: 'Not found' });
  const statuses = ['available', 'occupied', 'disabled'];
  db.prepare('UPDATE pon_ports SET name=?, profile=?, status=? WHERE id=?')
    .run(req.body.name ?? p.name, req.body.profile ?? p.profile, statuses.includes(req.body.status) ? req.body.status : p.status, p.id);
  res.json({ ok: true });
});
router.delete('/pon-ports/:id', requireCsrf, (req, res) => {
  const p = db.prepare('SELECT * FROM pon_ports WHERE id=?').get(Number(req.params.id));
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (p.status === 'occupied') return res.status(409).json({ error: 'Port is occupied — reassign customers first' });
  db.prepare('DELETE FROM pon_ports WHERE id=?').run(p.id);
  res.json({ ok: true });
});

crud('splitters', 'splitters', [
  { key: 'name', type: 'str' }, { key: 'ratio', type: 'str' }, { key: 'capacity', type: 'int' },
  { key: 'pop_id', type: 'int' }, { key: 'pon_port_id', type: 'int' }, { key: 'area_id', type: 'int' },
  { key: 'lat', type: 'float' }, { key: 'lng', type: 'float' }, { key: 'notes', type: 'str' },
]);

crud('fiber-boxes', 'fiber_boxes', [
  { key: 'name', type: 'str' }, { key: 'area_id', type: 'int' }, { key: 'pon_port_id', type: 'int' },
  { key: 'splitter_id', type: 'int' }, { key: 'capacity', type: 'int' },
  { key: 'lat', type: 'float' }, { key: 'lng', type: 'float' }, { key: 'notes', type: 'str' },
], {
  delGuard: (row) => db.prepare('SELECT COUNT(*) c FROM customers WHERE box_id=? AND archived_at IS NULL').get(row.id).c > 0
    ? 'Box has mapped customers' : null,
});

/** Box ports with occupancy. */
router.get('/fiber-boxes/:id/ports', (req, res) => {
  const box = db.prepare('SELECT * FROM fiber_boxes WHERE id=?').get(Number(req.params.id));
  if (!box) return res.status(404).json({ error: 'Box not found' });
  const ports = db.prepare('SELECT * FROM box_ports WHERE box_id=? ORDER BY port_no').all(box.id);
  const used = new Map(db.prepare(
    `SELECT box_port_no, id cid, name, customer_code FROM customers WHERE box_id=? AND archived_at IS NULL`
  ).all(box.id).map((r) => [r.box_port_no, r]));
  res.json(ports.map((p) => ({ ...p, customer: used.get(p.port_no) || null })));
});
router.post('/fiber-boxes/:id/ports', J, requireCsrf, (req, res) => {
  const box = db.prepare('SELECT * FROM fiber_boxes WHERE id=?').get(Number(req.params.id));
  if (!box) return res.status(404).json({ error: 'Box not found' });
  const portNo = parseInt(req.body.port_no, 10);
  if (!portNo) return res.status(422).json({ error: 'port_no required' });
  try {
    const info = db.prepare('INSERT INTO box_ports(box_id, port_no, status) VALUES(?,?, \'free\')').run(box.id, portNo);
    audit(req.user.id, 'box_port_created', 'box_ports', Number(info.lastInsertRowid), null, req.ip);
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  } catch { res.status(409).json({ error: 'Port number already exists on this box' }); }
});
router.put('/box-ports/:id', J, requireCsrf, (req, res) => {
  const p = db.prepare('SELECT * FROM box_ports WHERE id=?').get(Number(req.params.id));
  if (!p) return res.status(404).json({ error: 'Not found' });
  const statuses = ['free', 'occupied', 'faulty'];
  db.prepare('UPDATE box_ports SET status=? WHERE id=?')
    .run(statuses.includes(req.body.status) ? req.body.status : p.status, p.id);
  res.json({ ok: true });
});

crud('onus', 'onus', [
  { key: 'serial', type: 'str' }, { key: 'mac', type: 'str' }, { key: 'customer_id', type: 'int' },
  { key: 'box_port_id', type: 'int' }, { key: 'status', type: 'str' }, { key: 'rx_power', type: 'float' }, { key: 'notes', type: 'str' },
]);

/** Visual hierarchy: POP → OLT → PON → splitter → fiber box → port → customer */
router.get('/network/tree', (req, res) => {
  const pops = db.prepare('SELECT * FROM pops ORDER BY name').all();
  const olts = db.prepare('SELECT * FROM olts ORDER BY name').all();
  const onus = db.prepare('SELECT * FROM onus').all();
  const tree = pops.map((p) => ({
    pop: p,
    olts: olts.filter((o) => o.pop_id === p.id).map((o) => ({
      olt: o,
      pon_ports: db.prepare('SELECT * FROM pon_ports WHERE olt_id=? ORDER BY port_no').all(o.id).map((pon) => ({
        pon,
        splitters: db.prepare('SELECT * FROM splitters WHERE pon_port_id=?').all(pon.id).map((sp) => ({
          splitter: sp,
          boxes: db.prepare('SELECT * FROM fiber_boxes WHERE splitter_id=?').all(sp.id).map((b) => boxWithCustomers(b)),
        })),
        directBoxes: db.prepare('SELECT * FROM fiber_boxes WHERE pon_port_id=? AND splitter_id IS NULL').all(pon.id).map((b) => boxWithCustomers(b)),
      })),
    })),
    unassignedOlts: olts.filter((o) => o.pop_id == null && o.id).slice(0, 0),
  }));
  const orphanBoxes = db.prepare('SELECT * FROM fiber_boxes WHERE pon_port_id IS NULL AND splitter_id IS NULL').all().map((b) => boxWithCustomers(b));
  const orphanOlts = olts.filter((o) => !o.pop_id).map((o) => ({ olt: o, pon_ports: [] }));
  res.json({ tree, orphanBoxes, orphanOlts, onuCount: onus.length });
});
function boxWithCustomers(box) {
  const ports = db.prepare('SELECT * FROM box_ports WHERE box_id=? ORDER BY port_no').all(box.id);
  const custs = new Map(db.prepare(
    'SELECT box_port_no, id, name, customer_code, status, package_id, device_status FROM customers WHERE box_id=? AND archived_at IS NULL'
  ).all(box.id).map((c) => [c.box_port_no, c]));
  return {
    box,
    usage: ports.filter((p) => p.status === 'occupied').length,
    capacity: box.capacity,
    ports: ports.map((p) => ({ port: p, customer: custs.get(p.port_no) || null })),
  };
}

/** Fault tracing: affected customers for a box or PON port. */
router.get('/network/faults', (req, res) => {
  const scope = String(req.query.scope || ''); // box:ID | pon:ID | olt:ID
  const [kind, id] = scope.split(':');
  let customers = [];
  if (kind === 'box') {
    customers = db.prepare('SELECT id, name, customer_code, phone, whatsapp, status, box_port_no FROM customers WHERE box_id=? AND archived_at IS NULL').all(id);
  } else if (kind === 'pon') {
    customers = db.prepare('SELECT id, name, customer_code, phone, whatsapp, status FROM customers WHERE pon_port_id=? AND archived_at IS NULL').all(id);
  } else if (kind === 'olt') {
    customers = db.prepare('SELECT id, name, customer_code, phone, whatsapp, status FROM customers WHERE olt_id=? AND archived_at IS NULL').all(id);
  }
  res.json({ customers: customers.filter((c) => c.status === 'active' || c.status === 'suspended') });
});

router.post('/network/notify-affected', J, requireCsrf, (req, res) => {
  const { scope, message, area_name } = req.body;
  const [kind, id] = String(scope || '').split(':');
  const rows = kind === 'box'
    ? db.prepare('SELECT id, name, whatsapp, phone FROM customers WHERE box_id=? AND archived_at IS NULL AND status IN (\'active\',\'suspended\')').all(id)
    : kind === 'pon'
      ? db.prepare('SELECT id, name, whatsapp, phone FROM customers WHERE pon_port_id=? AND archived_at IS NULL AND status IN (\'active\',\'suspended\')').all(id)
      : [];
  let count = 0;
  for (const c of rows) {
    sendNotification({
      templateKey: 'area_fault', customerId: c.id, toAddress: c.whatsapp || c.phone,
      bodyOverride: String(message || '').trim() || null,
      vars: { area_name: area_name || '' },
    });
    count++;
  }
  audit(req.user.id, 'affected_notified', 'network', scope, { count, message: message?.slice(0, 200) }, req.ip);
  res.json({ notified: count, note: 'Messages logged for manual delivery (no provider configured).' });
});

/** Map points (customers, POPs, boxes, OLTs, splitters). */
router.get('/map/points', (req, res) => {
  const { area_id, status, types } = req.query;
  const list = String(types || 'customers,pops,boxes,olts,splitters').split(',');
  const out = [];
  if (list.includes('customers')) {
    let sql = `SELECT id, name, customer_code, status, area_id, lat, lng FROM customers WHERE lat IS NOT NULL AND lng IS NOT NULL AND archived_at IS NULL`;
    const args = [];
    if (area_id) { sql += ' AND area_id=?'; args.push(area_id); }
    if (status) { sql += ' AND status=?'; args.push(status); }
    out.push(...db.prepare(sql).all(...args).map((r) => ({ type: 'customer', ...r })));
  }
  if (list.includes('pops')) out.push(...db.prepare('SELECT id, name, lat, lng FROM pops WHERE lat IS NOT NULL').all().map((r) => ({ type: 'pop', ...r })));
  if (list.includes('boxes')) out.push(...db.prepare('SELECT id, name, lat, lng FROM fiber_boxes WHERE lat IS NOT NULL').all().map((r) => ({ type: 'box', ...r })));
  if (list.includes('olts')) {
    out.push(...db.prepare(
      `SELECT o.id, o.name, p.lat, p.lng FROM olts o LEFT JOIN pops p ON p.id=o.pop_id WHERE p.lat IS NOT NULL`
    ).all().map((r) => ({ type: 'olt', ...r })));
  }
  if (list.includes('splitters')) out.push(...db.prepare('SELECT id, name, lat, lng FROM splitters WHERE lat IS NOT NULL').all().map((r) => ({ type: 'splitter', ...r })));
  res.json(out);
});

/* ============================ INSTALLATIONS & TICKETS ============================ */
router.get('/installations', (req, res) => {
  const rows = db.prepare(
    `SELECT i.*, c.name customer_name, c.customer_code, s.name staff_name
     FROM installations i JOIN customers c ON c.id=i.customer_id LEFT JOIN staff s ON s.id=i.staff_id
     ORDER BY i.id DESC LIMIT 200`
  ).all();
  res.json(rows.map((r) => ({ ...r, materials: r.materials ? JSON.parse(r.materials) : [] })));
});
router.post('/installations/:id/status', J, requireCsrf, (req, res) => {
  const i = db.prepare('SELECT * FROM installations WHERE id=?').get(Number(req.params.id));
  if (!i) return res.status(404).json({ error: 'Not found' });
  const allowed = ['scheduled', 'in_progress', 'completed', 'cancelled'];
  const st = allowed.includes(req.body.status) ? req.body.status : i.status;
  db.prepare('UPDATE installations SET status=?, completed_at=? WHERE id=?')
    .run(st, st === 'completed' ? new Date().toISOString().replace('T', ' ').slice(0, 19) : i.completed_at, i.id);
  if (st === 'in_progress' && !i.staff_id && req.body.staff_id) {
    db.prepare('UPDATE installations SET staff_id=? WHERE id=?').run(req.body.staff_id, i.id);
  }
  audit(req.user.id, 'installation_status', 'installations', i.id, { status: st }, req.ip);
  res.json({ ok: true });
});

router.get('/tickets', (req, res) => {
  const { status, category, page = 1 } = req.query;
  const perPage = 25;
  let where = 'WHERE 1=1';
  const args = [];
  if (status) { where += ' AND t.status=?'; args.push(status); }
  if (category) { where += ' AND t.category=?'; args.push(category); }
  const total = db.prepare(`SELECT COUNT(*) c FROM tickets t ${where}`).get(...args).c;
  const rows = db.prepare(
    `SELECT t.*, c.name customer_name, c.phone, s.name assigned_name, b.name box_name
     FROM tickets t LEFT JOIN customers c ON c.id=t.customer_id LEFT JOIN staff s ON s.id=t.assigned_to
     LEFT JOIN fiber_boxes b ON b.id=t.box_id ${where} ORDER BY t.id DESC LIMIT ? OFFSET ?`
  ).all(...args, perPage, (parseInt(page, 10) - 1) * perPage);
  res.json({ rows, total, page: parseInt(page, 10), pages: Math.ceil(total / perPage) });
});
router.post('/tickets', J, requireCsrf, (req, res) => {
  const b = req.body;
  if (!b.summary) return res.status(422).json({ error: 'Summary required' });
  const no = nextSeq(db, 'tickets', 'id', 'TKT-', 5);
  const cats = ['no_internet', 'slow_speed', 'onu_issue', 'fiber_damage', 'router_issue', 'billing', 'shifting', 'other'];
  const info = db.prepare(
    `INSERT INTO tickets(ticket_no, customer_id, category, priority, summary, details, box_id, pon_port_id, assigned_to)
     VALUES(?,?,?,?,?,?,?,?,?)`
  ).run(no, b.customer_id ? Number(b.customer_id) : null,
    cats.includes(b.category) ? b.category : 'other',
    ['low', 'medium', 'high', 'urgent'].includes(b.priority) ? b.priority : 'medium',
    b.summary, b.details || null, b.box_id ? Number(b.box_id) : null, b.pon_port_id ? Number(b.pon_port_id) : null,
    b.assigned_to ? Number(b.assigned_to) : null);
  db.prepare('INSERT INTO ticket_updates(ticket_id, status, note, by) VALUES(?,?,?,?)').run(Number(info.lastInsertRowid), 'open', 'Ticket created', req.user.id);
  audit(req.user.id, 'ticket_created', 'tickets', Number(info.lastInsertRowid), { no, summary: b.summary }, req.ip);
  res.status(201).json({ id: Number(info.lastInsertRowid), no });
});
router.get('/tickets/:id', (req, res) => {
  const t = db.prepare('SELECT * FROM tickets WHERE id=?').get(Number(req.params.id));
  if (!t) return res.status(404).json({ error: 'Not found' });
  t.customer = t.customer_id ? db.prepare('SELECT * FROM customers WHERE id=?').get(t.customer_id) : null;
  t.updates = db.prepare('SELECT u.*, s.name by_name FROM ticket_updates u LEFT JOIN staff s ON s.id=u.by WHERE u.ticket_id=? ORDER BY u.id').all(t.id);
  t.affected = t.box_id
    ? db.prepare('SELECT id, name, customer_code, status FROM customers WHERE box_id=? AND archived_at IS NULL').all(t.box_id)
    : [];
  res.json(t);
});
router.put('/tickets/:id', J, requireCsrf, (req, res) => {
  const t = db.prepare('SELECT * FROM tickets WHERE id=?').get(Number(req.params.id));
  if (!t) return res.status(404).json({ error: 'Not found' });
  const b = req.body;
  const statuses = ['open', 'in_progress', 'pending', 'resolved', 'closed'];
  const newStatus = statuses.includes(b.status) ? b.status : t.status;
  db.prepare(
    `UPDATE tickets SET status=?, priority=?, assigned_to=?, resolved_at=?, closed_at=? WHERE id=?`
  ).run(newStatus, b.priority || t.priority, b.assigned_to ? Number(b.assigned_to) : t.assigned_to,
    newStatus === 'resolved' ? (t.resolved_at || new Date().toISOString().replace('T', ' ').slice(0, 19)) : t.resolved_at,
    newStatus === 'closed' ? (t.closed_at || new Date().toISOString().replace('T', ' ').slice(0, 19)) : t.closed_at, t.id);
  if (b.note) db.prepare('INSERT INTO ticket_updates(ticket_id, status, note, by) VALUES(?,?,?,?)').run(t.id, newStatus, b.note, req.user.id);
  audit(req.user.id, 'ticket_updated', 'tickets', t.id, { status: newStatus }, req.ip);
  res.json({ ok: true });
});
router.delete('/tickets/:id', requireCsrf, (req, res) => {
  const t = db.prepare('SELECT * FROM tickets WHERE id=?').get(Number(req.params.id));
  if (!t) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM tickets WHERE id=?').run(t.id);
  res.json({ ok: true });
});

/* ============================ INVENTORY ============================ */
router.get('/inventory/items', (req, res) => {
  const rows = db.prepare(
    `SELECT i.*, COALESCE(SUM(CASE WHEN m.mtype IN ('purchase','adjust_in','return') THEN m.qty ELSE -m.qty END),0) stock
     FROM inventory_items i LEFT JOIN inventory_movements m ON m.item_id=i.id
     GROUP BY i.id ORDER BY i.name`
  ).all();
  res.json(rows.map((r) => ({ ...r, low: r.stock <= r.reorder_level, value: r.stock * r.unit_cost })));
});
crud('inventory-items', 'inventory_items', [
  { key: 'name', type: 'str' }, { key: 'category', type: 'str' }, { key: 'unit', type: 'str' },
  { key: 'reorder_level', type: 'int' }, { key: 'unit_cost', type: 'money' },
]);
crud('suppliers', 'suppliers', [
  { key: 'name', type: 'str' }, { key: 'phone', type: 'str' }, { key: 'address', type: 'str' },
  { key: 'account_no', type: 'str' }, { key: 'notes', type: 'str' }, { key: 'is_active', type: 'int' },
]);

router.post('/inventory/purchase', J, requireCsrf, (req, res) => {
  const b = req.body;
  const item = db.prepare('SELECT * FROM inventory_items WHERE id=?').get(Number(b.item_id));
  if (!item) return res.status(422).json({ error: 'Item not found' });
  const qty = parseInt(b.qty, 10) || 0;
  if (qty <= 0) return res.status(422).json({ error: 'Quantity must be positive' });
  const unitCost = toPaise(b.unit_cost ?? item.unit_cost / 100);
  const total = qty * unitCost;
  tx((d) => {
    const pinfo = d.prepare(
      `INSERT INTO purchases(supplier_id, item_id, qty, unit_cost, total, invoice_no) VALUES(?,?,?,?,?,?)`
    ).run(b.supplier_id ? Number(b.supplier_id) : null, item.id, qty, unitCost, total, b.invoice_no || null);
    d.prepare(`INSERT INTO inventory_movements(item_id, mtype, qty, unit_cost, supplier_id, notes) VALUES(?, 'purchase', ?, ?, ?, ?)`)
      .run(item.id, qty, unitCost, b.supplier_id ? Number(b.supplier_id) : null, b.notes || `Purchase${b.invoice_no ? ' ' + b.invoice_no : ''}`);
    d.prepare('UPDATE inventory_items SET unit_cost=? WHERE id=?').run(unitCost, item.id);
    if (!b.paid || b.paid === false) {
      // supplier payable journal: Dr Inventory (asset) / Cr Suppliers Payable
      ac.postJournalInTxSafe(d, {
        entryDate: todayPKT(), memo: `Purchase ${qty} x ${item.name} from supplier`, source: 'purchase', refId: Number(pinfo.lastInsertRowid),
        lines: [
          { account_id: ac.accountByCategory('inventory', 'asset'), debit: total, credit: 0 },
          { account_id: ac.accountByCategory('supplier', 'liability'), debit: 0, credit: total },
        ],
      });
    } else if (b.account_id) {
      ac.postJournalInTxSafe(d, {
        entryDate: todayPKT(), memo: `Purchase (paid) ${qty} x ${item.name}`, source: 'purchase', refId: Number(pinfo.lastInsertRowid),
        lines: [
          { account_id: ac.accountByCategory('inventory', 'asset'), debit: total, credit: 0 },
          { account_id: ac.accountIdForBank(Number(b.account_id)), debit: 0, credit: total },
        ],
      });
    }
  });
  audit(req.user.id, 'purchase_recorded', 'purchases', item.id, { item: item.name, qty, total }, req.ip);
  res.json({ ok: true });
});

router.post('/inventory/issue', J, requireCsrf, (req, res) => {
  const b = req.body;
  const item = db.prepare('SELECT * FROM inventory_items WHERE id=?').get(Number(b.item_id));
  if (!item) return res.status(422).json({ error: 'Item not found' });
  const qty = parseInt(b.qty, 10) || 0;
  const stock = db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN mtype IN ('purchase','adjust_in','return') THEN qty ELSE -qty END),0) s
     FROM inventory_movements WHERE item_id=?`
  ).get(item.id).s;
  if (qty > stock) return res.status(409).json({ error: `Insufficient stock (available: ${stock})` });
  db.prepare(
    `INSERT INTO inventory_movements(item_id, mtype, qty, installation_id, customer_id, notes) VALUES(?, 'issue', ?, ?, ?, ?)`
  ).run(item.id, qty, b.installation_id ? Number(b.installation_id) : null, b.customer_id ? Number(b.customer_id) : null, b.notes || null);
  audit(req.user.id, 'stock_issued', 'inventory', item.id, { qty, installation: b.installation_id }, req.ip);
  res.json({ ok: true });
});

router.post('/inventory/adjust', J, requireCsrf, (req, res) => {
  const b = req.body;
  const item = db.prepare('SELECT * FROM inventory_items WHERE id=?').get(Number(b.item_id));
  if (!item) return res.status(422).json({ error: 'Item not found' });
  const delta = parseInt(b.qty, 10);
  if (!delta) return res.status(422).json({ error: 'Non-zero adjustment required (+ or -)' });
  const mtype = delta > 0 ? 'adjust_in' : 'adjust_out';
  db.prepare(
    `INSERT INTO inventory_movements(item_id, mtype, qty, notes) VALUES(?, ?, ?, ?)`
  ).run(item.id, mtype, Math.abs(delta), b.reason || 'Stock adjustment');
  audit(req.user.id, 'stock_adjusted', 'inventory', item.id, { delta, reason: b.reason }, req.ip);
  res.json({ ok: true });
});

router.get('/inventory/movements', (req, res) => {
  const { item_id } = req.query;
  let sql = `SELECT m.*, i.name item_name, s.name supplier_name FROM inventory_movements m
             JOIN inventory_items i ON i.id=m.item_id LEFT JOIN suppliers s ON s.id=m.supplier_id`;
  const args = [];
  if (item_id) { sql += ' WHERE m.item_id=?'; args.push(item_id); }
  sql += ' ORDER BY m.id DESC LIMIT 300';
  res.json(db.prepare(sql).all(...args));
});

router.get('/inventory/valuation', (req, res) => {
  const rows = db.prepare(
    `SELECT i.id, i.name, i.unit, i.unit_cost,
      COALESCE(SUM(CASE WHEN m.mtype IN ('purchase','adjust_in','return') THEN m.qty ELSE -m.qty END),0) stock
     FROM inventory_items i LEFT JOIN inventory_movements m ON m.item_id=i.id GROUP BY i.id`
  ).all();
  const total = rows.reduce((s, r) => s + r.stock * r.unit_cost, 0);
  res.json({ rows, total });
});

/* supplier payables + payments */
router.get('/supplier-payables', (req, res) => {
  const rows = db.prepare(
    `SELECT s.id, s.name, COALESCE(SUM(p.total - p.paid),0) payable
     FROM suppliers s LEFT JOIN purchases p ON p.supplier_id=s.id
     GROUP BY s.id HAVING payable > 0`
  ).all();
  res.json(rows);
});
router.post('/supplier-pay', J, requireCsrf, (req, res) => {
  const b = req.body;
  const purchase = db.prepare('SELECT * FROM purchases WHERE id=?').get(Number(b.purchase_id));
  if (!purchase) return res.status(404).json({ error: 'Purchase not found' });
  const amount = toPaise(b.amount);
  tx((d) => {
    const info = d.prepare('INSERT INTO purchase_payments(purchase_id, amount, account_id, transaction_ref) VALUES(?,?,?,?)')
      .run(purchase.id, amount, b.account_id ? Number(b.account_id) : null, b.transaction_ref || null);
    d.prepare('UPDATE purchases SET paid = paid + ? WHERE id=?').run(amount, purchase.id);
    ac.postJournalInTxSafe(d, {
      entryDate: todayPKT(), memo: `Supplier payment for purchase #${purchase.id}`, source: 'manual', refId: Number(info.lastInsertRowid),
      lines: [
        { account_id: ac.accountByCategory('supplier', 'liability'), debit: amount, credit: 0 },
        { account_id: ac.accountIdForBank(b.account_id ? Number(b.account_id) : null) || ac.accountByCategory('cash', 'asset'), debit: 0, credit: amount },
      ],
    });
  });
  audit(req.user.id, 'supplier_paid', 'purchase_payments', purchase.id, { amount }, req.ip);
  res.json({ ok: true });
});

/* ============================ STAFF ============================ */
crud('staff', 'staff', [
  { key: 'name', type: 'str' }, { key: 'role', type: 'str' }, { key: 'phone', type: 'str' },
  { key: 'joined_at', type: 'str' }, { key: 'base_salary', type: 'money' }, { key: 'notes', type: 'str' }, { key: 'is_active', type: 'int' },
]);
router.get('/staff/:id', (req, res) => {
  const s = db.prepare('SELECT * FROM staff WHERE id=?').get(Number(req.params.id));
  if (!s) return res.status(404).json({ error: 'Not found' });
  s.transactions = db.prepare('SELECT * FROM staff_transactions WHERE staff_id=? ORDER BY id DESC').all(s.id);
  s.assignments = db.prepare(
    `SELECT i.id, i.status, c.name customer_name FROM installations i JOIN customers c ON c.id=i.customer_id WHERE i.staff_id=? ORDER BY i.id DESC`
  ).all(s.id);
  res.json(s);
});
router.post('/staff/:id/pay', J, requireCsrf, (req, res) => {
  const s = db.prepare('SELECT * FROM staff WHERE id=?').get(Number(req.params.id));
  if (!s) return res.status(404).json({ error: 'Not found' });
  const b = req.body;
  const types = ['salary', 'advance', 'deduction', 'advance_refund'];
  const t = types.includes(b.type) ? b.type : 'salary';
  const amount = toPaise(b.amount);
  if (amount <= 0) return res.status(422).json({ error: 'Positive amount required' });
  tx((d) => {
    const info = d.prepare('INSERT INTO staff_transactions(staff_id, stype, amount, account_id, notes) VALUES(?,?,?,?,?)')
      .run(s.id, t, amount, b.account_id ? Number(b.account_id) : null, b.notes || null);
    const cashAcct = ac.accountIdForBank(b.account_id ? Number(b.account_id) : null) || ac.accountByCategory('cash', 'asset');
    if (t === 'salary' || t === 'advance' || t === 'advance_refund') {
      ac.postJournalInTxSafe(d, {
        entryDate: todayPKT(), memo: `${t} — ${s.name}`, source: 'salary', refId: Number(info.lastInsertRowid),
        lines: [
          { account_id: ac.accountByCategory('salary', 'expense'), debit: amount, credit: 0 },
          { account_id: cashAcct, debit: 0, credit: amount },
        ],
      });
    } else {
      ac.postJournalInTxSafe(d, {
        entryDate: todayPKT(), memo: `Deduction — ${s.name}`, source: 'salary', refId: Number(info.lastInsertRowid),
        lines: [
          { account_id: cashAcct, debit: amount, credit: 0 },
          { account_id: ac.accountByCategory('salary', 'expense'), debit: 0, credit: amount },
        ],
      });
    }
    if (t === 'advance') d.prepare('UPDATE staff SET advance_balance = advance_balance + ? WHERE id=?').run(amount, s.id);
    if (t === 'advance_refund') d.prepare('UPDATE staff SET advance_balance = advance_balance - ? WHERE id=?').run(amount, s.id);
  });
  audit(req.user.id, 'staff_payment', 'staff', s.id, { type: t, amount }, req.ip);
  res.json({ ok: true });
});

/* ============================ FINANCE ============================ */
router.get('/accounts', (req, res) => {
  ac.ensureChart();
  const rows = db.prepare('SELECT * FROM accounts ORDER BY code').all();
  for (const r of rows) r.balance = ac.accountBalance(r.id);
  res.json(rows);
});
crud('accounts', 'accounts', [
  { key: 'code', type: 'str' }, { key: 'name', type: 'str' }, { key: 'type', type: 'str' },
  { key: 'category', type: 'str' }, { key: 'description', type: 'str' },
]);

router.get('/cash-accounts', (req, res) => {
  ac.ensureChart();
  const rows = db.prepare('SELECT * FROM bank_accounts WHERE is_active=1 ORDER BY id').all();
  for (const r of rows) {
    r.balance = ac.accountBalance(r.account_id || ac.accountByCategory('cash', 'asset'));
    const a = r.account_id ? db.prepare('SELECT name FROM accounts WHERE id=?').get(r.account_id) : null;
    r.chart_name = a ? a.name : (r.kind === 'cash' ? 'Cash on Hand' : 'Bank Account');
  }
  res.json(rows);
});
router.post('/cash-accounts', J, requireCsrf, (req, res) => {
  const b = req.body;
  if (!b.name) return res.status(422).json({ error: 'Name required' });
  const kind = b.kind === 'bank' ? 'bank' : 'cash';
  // create linked chart account if none provided
  let acctId = b.account_id ? Number(b.account_id) : null;
  if (!acctId) {
    const code = '1' + String(Date.now()).slice(-6);
    const info = db.prepare('INSERT INTO accounts(code, name, type, category) VALUES(?,?,?,?)')
      .run(code, b.name, 'asset', kind);
    acctId = Number(info.lastInsertRowid);
  }
  const opening = toPaise(b.opening_balance || 0);
  tx((d) => {
    const info = d.prepare(
      `INSERT INTO bank_accounts(name, bank, account_no, kind, account_id, opening_balance) VALUES(?,?,?,?,?,?)`
    ).run(b.name, b.bank || null, b.account_no || null, kind, acctId, opening);
    if (opening) {
      ac.postJournalInTxSafe(d, {
        entryDate: todayPKT(), memo: `Opening balance — ${b.name}`, source: 'opening', refId: Number(info.lastInsertRowid),
        lines: [
          { account_id: acctId, debit: opening, credit: 0 },
          { account_id: ac.accountByCategory('capital', 'equity'), debit: 0, credit: opening },
        ],
      });
    }
  });
  audit(req.user.id, 'cash_account_created', 'bank_accounts', b.name, { opening }, req.ip);
  res.json({ ok: true });
});
router.post('/cash-accounts/:id/move', J, requireCsrf, (req, res) => {
  const bp = db.prepare('SELECT * FROM bank_accounts WHERE id=?').get(Number(req.params.id));
  if (!bp) return res.status(404).json({ error: 'Not found' });
  const amount = toPaise(req.body.amount);
  const dir = req.body.direction === 'withdraw' ? 'withdraw' : 'deposit';
  if (amount <= 0) return res.status(422).json({ error: 'Positive amount required' });
  const memo = req.body.notes || (dir === 'deposit' ? 'Cash/Bank deposit' : 'Cash/Bank withdrawal');
  const fromAcct = ac.accountByCategory('cash', 'asset');
  const toAcct = ac.accountIdForBank(bp.id) || fromAcct;
  if (dir === 'deposit') {
    ac.postJournal({ entryDate: todayPKT(), memo, source: 'manual', lines: [
      { account_id: toAcct, debit: amount, credit: 0 },
      { account_id: fromAcct === toAcct ? ac.accountByCategory('capital', 'equity') : fromAcct, debit: 0, credit: amount },
    ]});
  } else {
    ac.postJournal({ entryDate: todayPKT(), memo, source: 'manual', lines: [
      { account_id: fromAcct === toAcct ? ac.accountByCategory('capital', 'equity') : fromAcct, debit: amount, credit: 0 },
      { account_id: toAcct, debit: 0, credit: amount },
    ]});
  }
  audit(req.user.id, 'cash_move', 'bank_accounts', bp.id, { dir, amount }, req.ip);
  res.json({ ok: true });
});

router.post('/transfers', J, requireCsrf, (req, res) => {
  const { from_id, to_id, amount, notes } = req.body;
  const a = db.prepare('SELECT * FROM bank_accounts WHERE id=?').get(Number(from_id));
  const b = db.prepare('SELECT * FROM bank_accounts WHERE id=?').get(Number(to_id));
  if (!a || !b) return res.status(404).json({ error: 'Account not found' });
  const amt = toPaise(amount);
  if (amt <= 0) return res.status(422).json({ error: 'Positive amount required' });
  ac.postJournal({
    entryDate: todayPKT(), memo: notes || `Transfer ${a.name} → ${b.name}`, source: 'transfer',
    lines: [
      { account_id: ac.accountIdForBank(b.id), debit: amt, credit: 0 },
      { account_id: ac.accountIdForBank(a.id), debit: 0, credit: amt },
    ],
  });
  audit(req.user.id, 'transfer', 'bank_accounts', null, { from: a.name, to: b.name, amount: amt }, req.ip);
  res.json({ ok: true });
});

router.get('/journal', (req, res) => {
  const { from, to, account_id, source, page = 1 } = req.query;
  const perPage = 25;
  let where = 'WHERE 1=1';
  const args = [];
  if (from) { where += ' AND je.entry_date >= ?'; args.push(from); }
  if (to) { where += ' AND je.entry_date <= ?'; args.push(to); }
  if (source) { where += ' AND je.source=?'; args.push(source); }
  if (account_id) { where += ' AND EXISTS (SELECT 1 FROM journal_lines jl WHERE jl.entry_id=je.id AND jl.account_id=?)'; args.push(account_id); }
  const total = db.prepare(`SELECT COUNT(DISTINCT je.id) c FROM journal_entries je ${where}`).get(...args).c;
  const rows = db.prepare(
    `SELECT je.* FROM journal_entries je ${where} ORDER BY je.id DESC LIMIT ? OFFSET ?`
  ).all(...args, perPage, (parseInt(page, 10) - 1) * perPage);
  for (const r of rows) {
    r.lines = db.prepare(
      `SELECT jl.*, a.name account_name, a.code, a.type FROM journal_lines jl JOIN accounts a ON a.id=jl.account_id WHERE jl.entry_id=? ORDER BY jl.id`
    ).all(r.id);
  }
  res.json({ rows, total, page: parseInt(page, 10), pages: Math.ceil(total / perPage) });
});

router.post('/journal', J, requireCsrf, (req, res) => {
  const b = req.body;
  if (!Array.isArray(b.lines) || b.lines.length < 2) return res.status(422).json({ error: 'At least two journal lines required' });
  const lines = b.lines.map((l) => ({
    account_id: Number(l.account_id), debit: toPaise(l.debit || 0), credit: toPaise(l.credit || 0),
  }));
  const dr = lines.reduce((s, l) => s + l.debit, 0);
  const cr = lines.reduce((s, l) => s + l.credit, 0);
  if (dr !== cr || dr === 0) return res.status(422).json({ error: `Entry is unbalanced (Dr ${dr} vs Cr ${cr})` });
  if (!b.memo) return res.status(422).json({ error: 'Memo is required for manual entries' });
  try {
    const r = ac.postJournal({ entryDate: /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : todayPKT(), memo: b.memo, source: 'manual', createdBy: req.user.id, lines });
    audit(req.user.id, 'manual_journal', 'journal_entries', r.id, { no: r.entryNo, total: r.total, memo: b.memo }, req.ip);
    res.status(201).json({ entryNo: r.entryNo });
  } catch (e) { res.status(422).json({ error: e.message }); }
});

router.get('/trial-balance', (req, res) => {
  ac.ensureChart();
  res.json(ac.trialBalance(req.query.at || null));
});
router.get('/cashbook', (req, res) => {
  const { account_id, from, to } = req.query;
  if (!account_id) return res.json({ rows: [], note: 'Select an account' });
  res.json({ rows: ac.cashbook(Number(account_id), from || null, to || null) });
});
router.get('/account-ledger', (req, res) => {
  res.json(ac.accountLedger(Number(req.query.account_id), req.query.from || null, req.query.to || null));
});
router.get('/daily-close', (req, res) => {
  ac.ensureChart();
  res.json(ac.dailyClose(/^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : todayPKT()));
});

/* expenses */
router.get('/expenses', (req, res) => {
  const { from, to, category, page = 1 } = req.query;
  const perPage = 25;
  let where = 'WHERE 1=1';
  const args = [];
  if (from) { where += ' AND e.expense_date >= ?'; args.push(from); }
  if (to) { where += ' AND e.expense_date <= ?'; args.push(to); }
  if (category) { where += ' AND e.category=?'; args.push(category); }
  const total = db.prepare(`SELECT COUNT(*) c FROM expenses e ${where}`).get(...args).c;
  const rows = db.prepare(
    `SELECT e.*, a.name account_name, bp.name pay_account FROM expenses e
     LEFT JOIN accounts a ON a.id=e.account_id LEFT JOIN bank_accounts bp ON bp.id=e.pay_account_id
     ${where} ORDER BY e.id DESC LIMIT ? OFFSET ?`
  ).all(...args, perPage, (parseInt(page, 10) - 1) * perPage);
  res.json({ rows, total, page: parseInt(page, 10), pages: Math.ceil(total / perPage) });
});
router.post('/expenses', J, requireCsrf, (req, res) => {
  const b = req.body;
  const amount = toPaise(b.amount);
  if (!amount || !b.category) return res.status(422).json({ error: 'amount and category required' });
  const cats = ['upstream', 'salary', 'fuel', 'rent', 'electricity', 'maintenance', 'material', 'misc'];
  const cat = cats.includes(b.category) ? b.category : 'misc';
  const acctId = b.account_id ? Number(b.account_id) : ac.accountByCategory(cat, 'expense');
  const payAcct = b.pay_account_id ? Number(b.pay_account_id) : null;
  tx((d) => {
    const info = d.prepare(
      `INSERT INTO expenses(category, account_id, pay_account_id, amount, description, transaction_ref, expense_date, created_by)
       VALUES(?,?,?,?,?,?,?,?)`
    ).run(cat, acctId, payAcct, amount, b.description || null, b.transaction_ref || null,
      /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : todayPKT(), req.user.id);
    ac.postJournalInTxSafe(d, {
      entryDate: /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : todayPKT(),
      memo: b.description || `Expense: ${cat}`, source: 'expense', refId: Number(info.lastInsertRowid),
      lines: [
        { account_id: acctId, debit: amount, credit: 0 },
        { account_id: ac.accountIdForBank(payAcct) || ac.accountByCategory('cash', 'asset'), debit: 0, credit: amount },
      ],
    });
  });
  audit(req.user.id, 'expense_recorded', 'expenses', b.category, { amount, category: cat }, req.ip);
  res.json({ ok: true });
});

/* ============================ PROVIDERS (UPSTREAM) ============================ */
crud('providers', 'providers', [
  { key: 'company', type: 'str' }, { key: 'contact_name', type: 'str' }, { key: 'phone', type: 'str' },
  { key: 'email', type: 'str' }, { key: 'account_no', type: 'str' },
  { key: 'service_description', type: 'str' }, { key: 'notes', type: 'str' }, { key: 'is_active', type: 'int' },
]);
router.get('/providers/summary', (req, res) => {
  const providers = db.prepare('SELECT * FROM providers WHERE is_active=1').all();
  const plans = db.prepare('SELECT * FROM bandwidth_plans WHERE is_active=1').all();
  const invoices = db.prepare(
    `SELECT pi.*, p.company FROM provider_invoices pi JOIN providers p ON p.id=pi.provider_id ORDER BY pi.id DESC`
  ).all();
  const payments = db.prepare(
    `SELECT pp.*, pi.period, p.company FROM provider_payments pp
     JOIN provider_invoices pi ON pi.id=pp.provider_invoice_id JOIN providers p ON p.id=pi.provider_id
     ORDER BY pp.id DESC`
  ).all();
  const monthStart = todayPKT().slice(0, 8) + '01';
  const monthCost = db.prepare(
    `SELECT COALESCE(SUM(jl.debit),0) s FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id
     JOIN accounts a ON a.id=jl.account_id WHERE a.category='upstream' AND je.entry_date >= ?`
  ).get(monthStart).s;
  const totalCapacity = plans.reduce((s, p) => s + p.capacity_mbps, 0);
  const totalCost = plans.reduce((s, p) => s + p.monthly_cost, 0);
  const outstanding = invoices.reduce((s, i) => s + (i.amount - i.paid), 0);
  // usage from last device poll (if any)
  const peak = db.prepare(`SELECT data FROM status_history WHERE scope='sessions' ORDER BY id DESC LIMIT 1`).get();
  let usage = null;
  if (peak) {
    try { usage = JSON.parse(peak.data); } catch { /* ignore */ }
  }
  res.json({ providers, plans, invoices, payments, monthCost, totalCapacity, totalCost, costPerMbps: totalCapacity ? totalCost / totalCapacity : 0, outstanding, usage });
});
router.post('/providers/:id/plans', J, requireCsrf, (req, res) => {
  const p = db.prepare('SELECT * FROM providers WHERE id=?').get(Number(req.params.id));
  if (!p) return res.status(404).json({ error: 'Provider not found' });
  const b = req.body;
  db.prepare(
    `INSERT INTO bandwidth_plans(provider_id, capacity_mbps, monthly_cost, billing_period, started_at, notes) VALUES(?,?,?,?,?,?)`
  ).run(p.id, parseInt(b.capacity_mbps, 10) || 0, toPaise(b.monthly_cost), b.billing_period || 'monthly',
    /^\d{4}-\d{2}-\d{2}$/.test(b.started_at || '') ? b.started_at : todayPKT(), b.notes || null);
  audit(req.user.id, 'bandwidth_plan_added', 'bandwidth_plans', p.id, { capacity: b.capacity_mbps, cost: toPaise(b.monthly_cost) }, req.ip);
  res.json({ ok: true });
});
router.post('/providers/invoices', J, requireCsrf, (req, res) => {
  const b = req.body;
  const provider = db.prepare('SELECT * FROM providers WHERE id=?').get(Number(b.provider_id));
  if (!provider) return res.status(404).json({ error: 'Provider not found' });
  const amount = toPaise(b.amount);
  if (!amount) return res.status(422).json({ error: 'amount required' });
  tx((d) => {
    const info = d.prepare(
      `INSERT INTO provider_invoices(provider_id, period, amount, due_date, invoice_no, notes) VALUES(?,?,?,?,?,?)`
    ).run(provider.id, b.period || null, amount, b.due_date || null, b.invoice_no || null, b.notes || null);
    // Dr Upstream expense / Cr Provider payable
    ac.postJournalInTxSafe(d, {
      entryDate: todayPKT(), memo: `Upstream invoice ${b.invoice_no || ''} — ${provider.company} (${b.period || ''})`,
      source: 'provider', refId: Number(info.lastInsertRowid),
      lines: [
        { account_id: ac.accountByCategory('upstream', 'expense'), debit: amount, credit: 0 },
        { account_id: ac.accountByCategory('provider', 'liability'), debit: 0, credit: amount },
      ],
    });
  });
  audit(req.user.id, 'provider_invoice', 'provider_invoices', provider.id, { amount, period: b.period }, req.ip);
  res.json({ ok: true });
});
router.post('/providers/pay', J, requireCsrf, (req, res) => {
  const b = req.body;
  const inv = db.prepare('SELECT * FROM provider_invoices WHERE id=?').get(Number(b.provider_invoice_id));
  if (!inv) return res.status(404).json({ error: 'Provider invoice not found' });
  const amount = toPaise(b.amount);
  if (amount > inv.amount - inv.paid) return res.status(422).json({ error: 'Amount exceeds outstanding on provider invoice' });
  tx((d) => {
    d.prepare('INSERT INTO provider_payments(provider_invoice_id, amount, account_id, transaction_ref) VALUES(?,?,?,?)')
      .run(inv.id, amount, b.account_id ? Number(b.account_id) : null, b.transaction_ref || null);
    const newPaid = inv.paid + amount;
    d.prepare(`UPDATE provider_invoices SET paid=?, status=? WHERE id=?`)
      .run(newPaid, newPaid >= inv.amount ? 'paid' : 'partial', inv.id);
    ac.postJournalInTxSafe(d, {
      entryDate: todayPKT(), memo: `Upstream payment — ${b.transaction_ref || 'ref'}`, source: 'provider', refId: inv.id,
      lines: [
        { account_id: ac.accountByCategory('provider', 'liability'), debit: amount, credit: 0 },
        { account_id: ac.accountIdForBank(b.account_id ? Number(b.account_id) : null) || ac.accountByCategory('cash', 'asset'), debit: 0, credit: amount },
      ],
    });
  });
  audit(req.user.id, 'provider_paid', 'provider_invoices', inv.id, { amount }, req.ip);
  res.json({ ok: true });
});

/* ============================ PROFIT & LOSS ============================ */
router.get('/pl', (req, res) => {
  const today = todayPKT();
  const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : today;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : to.slice(0, 8) + '01';
  const range = (f, t) => {
    const income = db.prepare(
      `SELECT COALESCE(SUM(jl.credit),0) s FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id
       JOIN accounts a ON a.id=jl.account_id WHERE a.type='income' AND je.entry_date BETWEEN ? AND ?`
    ).get(f, t).s;
    const incomeByCat = db.prepare(
      `SELECT a.category, COALESCE(SUM(jl.credit),0) s FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id
       JOIN accounts a ON a.id=jl.account_id WHERE a.type='income' AND je.entry_date BETWEEN ? AND ? GROUP BY a.category`
    ).all(f, t);
    const expense = db.prepare(
      `SELECT COALESCE(SUM(jl.debit),0) s FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id
       JOIN accounts a ON a.id=jl.account_id WHERE a.type='expense' AND je.entry_date BETWEEN ? AND ?`
    ).get(f, t).s;
    const expenseByCat = db.prepare(
      `SELECT a.category, a.name, COALESCE(SUM(jl.debit),0) s FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id
       JOIN accounts a ON a.id=jl.account_id WHERE a.type='expense' AND je.entry_date BETWEEN ? AND ? GROUP BY a.id ORDER BY s DESC`
    ).all(f, t);
    const cashIn = db.prepare(
      `SELECT COALESCE(SUM(jl.debit),0) s FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id
       JOIN accounts a ON a.id=jl.account_id WHERE a.type='asset' AND a.category IN ('cash','bank') AND je.entry_date BETWEEN ? AND ?`
    ).get(f, t).s;
    const cashOut = db.prepare(
      `SELECT COALESCE(SUM(jl.credit),0) s FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id
       JOIN accounts a ON a.id=jl.account_id WHERE a.type='asset' AND a.category IN ('cash','bank') AND je.entry_date BETWEEN ? AND ?`
    ).get(f, t).s;
    const receivable = db.prepare(
      `SELECT COALESCE(SUM(jl.debit - jl.credit),0) s FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id
       JOIN accounts a ON a.id=jl.account_id WHERE a.category='receivable' AND je.entry_date <= ?`
    ).get(t).s;
    const payable = db.prepare(
      `SELECT COALESCE(SUM(jl.credit - jl.debit),0) s FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id
       JOIN accounts a ON a.id=jl.account_id WHERE a.type='liability' AND je.entry_date <= ?`
    ).get(t).s;
    return { income, expense, operating: income - expense, margin: income ? Math.round(((income - expense) / income) * 1000) / 10 : 0, cashIn, cashOut, receivable, payable, incomeByCat, expenseByCat };
  };
  const cur = range(from, to);
  let prev = null;
  if (req.query.compare !== '0') {
    const d = new Date(from); d.setMonth(d.getMonth() - 1);
    const pFrom = d.toISOString().slice(0, 10);
    const pTo = new Date(d); pTo.setDate(pTo.getDate() + (daysBetween(from, to) || 0));
    prev = range(pFrom, pTo.toISOString().slice(0, 10));
  }
  res.json({
    from, to, cur, prev,
    basis: 'accrual (posted journal entries). Cash figures shown separately. This is a management estimate, not audited.',
  });
});

/* ============================ DEVICES ============================ */
router.get('/devices', (req, res) => {
  const rows = db.prepare('SELECT * FROM devices ORDER BY id DESC').all();
  for (const r of rows) {
    r.hasCreds = !!db.prepare('SELECT id FROM device_credentials WHERE device_id=?').get(r.id);
    r.credentials = null; // secrets never exposed
    r.commands = db.prepare(`SELECT COUNT(*) c FROM command_logs WHERE device_id=? AND status IN ('queued','running','pending_sync')`).get(r.id).c;
    r.identity = r.identity ? JSON.parse(r.identity) : null;
  }
  res.json(rows);
});
router.post('/devices', J, requireCsrf, (req, res) => {
  const b = req.body;
  if (!b.name) return res.status(422).json({ error: 'Name required' });
  const drivers = ['mock', 'mikrotik', 'snmp'];
  const kinds = ['router', 'olt', 'other'];
  const info = db.prepare(
    `INSERT INTO devices(name, vendor, model, kind, driver, host, port, protocol, safe_mode, status, notes)
     VALUES(?,?,?,?,?,?,?,?,?,?,?)`
  ).run(b.name.trim(), b.vendor || null, b.model || null, kinds.includes(b.kind) ? b.kind : 'router',
    drivers.includes(b.driver) ? b.driver : 'mock', b.host || null, b.port ? parseInt(b.port, 10) : null,
    b.protocol || (b.driver === 'mikrotik' ? 'api' : 'snmp'), b.safe_mode ? 1 : 0, 'disabled', b.notes || null);
  const devId = Number(info.lastInsertRowid);
  if (b.username || b.password) {
    db.prepare('INSERT INTO device_credentials(device_id, credential_type, username, secret_enc) VALUES(?,?,?,?)')
      .run(devId, b.driver === 'mikrotik' ? 'api' : 'snmp_community', b.username || null, b.password ? encryptSecret(b.password) : null);
  }
  audit(req.user.id, 'device_added', 'devices', devId, { name: b.name, driver: b.driver, kind: b.kind }, req.ip);
  res.status(201).json({ id: devId, note: 'Device added in disabled state — test the connection, then enable it.' });
});
router.put('/devices/:id', J, requireCsrf, (req, res) => {
  const d = db.prepare('SELECT * FROM devices WHERE id=?').get(Number(req.params.id));
  if (!d) return res.status(404).json({ error: 'Not found' });
  const b = req.body;
  db.prepare(
    `UPDATE devices SET name=?, vendor=?, model=?, kind=?, driver=?, host=?, port=?, protocol=?, safe_mode=?, notes=? WHERE id=?`
  ).run(b.name ?? d.name, b.vendor ?? d.vendor, b.model ?? d.model, b.kind ?? d.kind,
    b.driver ?? d.driver, b.host ?? d.host, b.port ? parseInt(b.port, 10) : d.port, b.protocol ?? d.protocol,
    b.safe_mode === undefined ? d.safe_mode : (b.safe_mode ? 1 : 0), b.notes ?? d.notes, d.id);
  if (b.username !== undefined || b.password !== undefined) {
    const cred = db.prepare('SELECT * FROM device_credentials WHERE device_id=?').get(d.id);
    if (cred) {
      db.prepare('UPDATE device_credentials SET username=?, secret_enc=? WHERE id=?')
        .run(b.username ?? cred.username, b.password ? encryptSecret(b.password) : cred.secret_enc, cred.id);
    } else {
      db.prepare('INSERT INTO device_credentials(device_id, credential_type, username, secret_enc) VALUES(?,?,?,?)')
        .run(d.id, 'api', b.username || null, b.password ? encryptSecret(b.password) : null);
    }
  }
  audit(req.user.id, 'device_updated', 'devices', d.id, { name: b.name }, req.ip);
  res.json({ ok: true, note: 'Saved passwords are encrypted and never shown again.' });
});
router.post('/devices/:id/test', async (req, res) => {
  try {
    const dev = db.prepare('SELECT * FROM devices WHERE id=?').get(Number(req.params.id));
    const result = await devices.testDevice(dev.id);
    audit(req.user.id, 'device_test', 'devices', dev.id, { ok: true }, req.ip);
    res.json({ ok: true, result, simulated: dev.driver === 'mock' });
  } catch (e) {
    db.prepare(`UPDATE devices SET status='error' WHERE id=?`).run(Number(req.params.id));
    audit(req.user.id, 'device_test_failed', 'devices', Number(req.params.id), { error: e.message }, req.ip);
    res.status(422).json({ error: `Connection failed: ${e.message}` });
  }
});
router.post('/devices/:id/enable', requireCsrf, (req, res) => {
  devices.setDevice(Number(req.params.id), { status: 'enabled', safeMode: null });
  audit(req.user.id, 'device_enabled', 'devices', Number(req.params.id), null, req.ip);
  res.json({ ok: true });
});
router.post('/devices/:id/disable', requireCsrf, (req, res) => {
  devices.setDevice(Number(req.params.id), { status: 'disabled', safeMode: null });
  audit(req.user.id, 'device_disabled', 'devices', Number(req.params.id), null, req.ip);
  res.json({ ok: true });
});
router.post('/devices/:id/command', J, requireCsrf, (req, res) => {
  const b = req.body;
  const actions = ['test_connection', 'info', 'list_sessions', 'list_onus', 'enable_user', 'disable_user', 'disconnect_session', 'add_secret', 'remove_secret', 'set_profile', 'onu_enable', 'onu_disable', 'onu_reboot'];
  if (!actions.includes(b.action)) return res.status(422).json({ error: 'Unknown action' });
  if (devices.DESTRUCTIVE.has(b.action) && !b.confirm) return res.status(422).json({ error: 'Destructive action — set confirm=true' });
  const device = db.prepare('SELECT * FROM devices WHERE id=?').get(Number(req.params.id));
  if (!device) return res.status(404).json({ error: 'Device not found' });
  if (devices.DESTRUCTIVE.has(b.action) && (devices.safeModeOn() || device.safe_mode)) {
    return res.status(422).json({ error: 'Safe mode is ON (read-only) — destructive device commands are blocked. Turn off safe mode in Settings → Devices to allow.' });
  }
  try {
    const cmd = db.prepare(
      `INSERT INTO command_logs(device_id, customer_id, action, payload, status, correlation_id, initiated_by)
       VALUES(?,?,?,?,'queued',(SELECT hex(randomblob(4)) FROM (SELECT 1)),?)`
    ).run(device.id, b.customer_id ? Number(b.customer_id) : null, b.action, JSON.stringify(b.payload || {}), req.user.id);
    const cmdId = Number(cmd.lastInsertRowid);
    audit(req.user.id, 'device_command', 'command_logs', cmdId, { action: b.action, device: device.name }, req.ip);
    devices.tickCommands();
    res.json({ ok: true, command: db.prepare('SELECT * FROM command_logs WHERE id=?').get(cmdId) });
  } catch (e) { res.status(422).json({ error: e.message }); }
});
router.get('/device-commands', (req, res) => {
  const { device_id, status, page = 1 } = req.query;
  const perPage = 30;
  let where = 'WHERE 1=1';
  const args = [];
  if (device_id) { where += ' AND cl.device_id=?'; args.push(device_id); }
  if (status) { where += ' AND cl.status=?'; args.push(status); }
  const total = db.prepare(`SELECT COUNT(*) c FROM command_logs cl ${where}`).get(...args).c;
  const rows = db.prepare(
    `SELECT cl.*, d.name device_name, d.driver, c.name customer_name, c.pppoe_username
     FROM command_logs cl JOIN devices d ON d.id=cl.device_id LEFT JOIN customers c ON c.id=cl.customer_id
     ${where} ORDER BY cl.id DESC LIMIT ? OFFSET ?`
  ).all(...args, perPage, (parseInt(page, 10) - 1) * perPage);
  for (const r of rows) {
    r.payload = r.payload ? JSON.parse(r.payload) : null;
    r.response = r.response ? JSON.parse(r.response) : null;
  }
  res.json({ rows, total, page: parseInt(page, 10), pages: Math.ceil(total / perPage) });
});
router.get('/device-status-history', (req, res) => {
  const rows = db.prepare(
    `SELECT h.*, d.name device_name FROM status_history h LEFT JOIN devices d ON d.id=h.device_id
     ORDER BY h.id DESC LIMIT 100`
  ).all();
  for (const r of rows) r.data = r.data ? JSON.parse(r.data) : null;
  res.json(rows);
});
router.post('/devices/safe-mode', J, requireCsrf, (req, res) => {
  const cfg = getSetting('devices') || {};
  cfg.global_safe_mode = !!req.body.enabled;
  setSetting('devices', cfg);
  audit(req.user.id, 'safe_mode', 'devices', null, { enabled: cfg.global_safe_mode }, req.ip);
  res.json({ ok: true, enabled: cfg.global_safe_mode });
});

/* ============================ SETTINGS ============================ */
router.get('/settings', (req, res) => {
  const groups = ['company', 'billing', 'payments', 'notifications', 'devices', 'automation', 'backup', 'map', 'system'];
  const out = {};
  for (const g of groups) out[g] = getSetting(g);
  const u = db.prepare('SELECT totp_enabled FROM users WHERE id=?').get(req.user.id);
  out._auth = { totpEnabled: !!u?.totp_enabled };
  res.json(out);
});
router.put('/settings/:group', J, requireCsrf, (req, res) => {
  const groups = ['company', 'billing', 'payments', 'notifications', 'devices', 'automation', 'backup', 'map', 'system'];
  const g = req.params.group;
  if (!groups.includes(g)) return res.status(404).json({ error: 'Unknown settings group' });
  const cur = getSetting(g) || {};
  const next = { ...cur, ...req.body };
  if (g === 'company') {
    for (const k of ['name', 'address', 'phone', 'whatsapp', 'email', 'tagline']) if (next[k] !== undefined) next[k] = String(next[k]).slice(0, 300);
  }
  setSetting(g, next);
  audit(req.user.id, 'settings_updated', 'settings', g, { keys: Object.keys(req.body) }, req.ip);
  res.json({ ok: true, value: next });
});
router.post('/settings/logo', requireCsrf, (req, res) => {
  const bb = busboy({ headers: req.headers, limits: { fileSize: 2 * 1024 * 1024 } });
  let done = false;
  bb.on('file', (f, file) => {
    const dest = path.join(config.dataDir, 'uploads', `logo-${Date.now()}.bin`);
    const ws = fs.createWriteStream(dest);
    const chunks = [];
    file.on('data', (d) => chunks.push(d));
    file.pipe(ws);
    ws.on('finish', () => {
      const buf = Buffer.concat(chunks);
      const mime = sniffMime(buf);
      if (!mime || !mime.startsWith('image/')) { fs.unlinkSync(dest); if (!done) { done = true; res.status(422).json({ error: 'Image file required (jpg/png/webp)' }); } return; }
      const rel = path.join('uploads', path.basename(dest).replace('.bin', mime.split('/')[1] === 'jpeg' ? '.jpg' : '.' + mime.split('/')[1]));
      fs.renameSync(dest, path.join(config.dataDir, rel));
      const company = getSetting('company') || {};
      company.logo_path = rel;
      setSetting('company', company);
      audit(req.user.id, 'logo_uploaded', 'settings', 'company', null, req.ip);
      if (!done) { done = true; res.json({ ok: true, logo_path: rel }); }
    });
  });
  bb.on('close', () => { if (!done) { done = true; res.json({ ok: true, count: 0 }); } });
  req.pipe(bb);
});
router.get('/files/public/:name', (req, res) => {
  const name = path.basename(req.params.name);
  const p = path.join(config.dataDir, 'uploads', name);
  if (!fs.existsSync(p)) return res.status(404).end();
  res.sendFile(p);
});

/* backups */
router.get('/backups', (req, res) => {
  const dir = path.join(config.dataDir, 'backups');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sqlite')).sort().reverse().map((f) => {
    const st = fs.statSync(path.join(dir, f));
    return { name: f, size: st.size, at: st.mtime.toISOString() };
  });
  res.json(files);
});
router.post('/backups', async (req, res) => {
  const { runBackup } = require('../scheduler');
  const file = await runBackup();
  audit(req.user.id, 'backup_created', 'backups', null, null, req.ip);
  res.json({ ok: true, file: file ? path.basename(file) : null });
});
router.get('/backups/:name', (req, res) => {
  const name = path.basename(req.params.name);
  const p = path.join(config.dataDir, 'backups', name);
  if (!fs.existsSync(p)) return res.status(404).end();
  res.download(p);
});

/* notification templates */
router.get('/notification-templates', (req, res) => {
  res.json(db.prepare('SELECT * FROM notification_templates ORDER BY id').all());
});
router.put('/notification-templates/:id', J, requireCsrf, (req, res) => {
  const t = db.prepare('SELECT * FROM notification_templates WHERE id=?').get(Number(req.params.id));
  if (!t) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE notification_templates SET body=?, subject=?, channel=?, is_active=? WHERE id=?')
    .run(req.body.body ?? t.body, req.body.subject ?? t.subject, req.body.channel ?? t.channel,
      req.body.is_active === undefined ? t.is_active : (req.body.is_active ? 1 : 0), t.id);
  audit(req.user.id, 'template_updated', 'notification_templates', t.id, { key: t.tkey }, req.ip);
  res.json({ ok: true });
});
router.get('/notification-logs', (req, res) => {
  const rows = db.prepare(
    `SELECT l.*, c.name customer_name FROM notification_logs l LEFT JOIN customers c ON c.id=l.customer_id
     ORDER BY l.id DESC LIMIT 200`
  ).all();
  res.json(rows);
});

/* ============================ AUDIT ============================ */
router.get('/audit', (req, res) => {
  const { entity, action, from, to, page = 1, csv } = req.query;
  const perPage = 30;
  let where = 'WHERE 1=1';
  const args = [];
  if (entity) { where += ' AND entity=?'; args.push(entity); }
  if (action) { where += ' AND action=?'; args.push(action); }
  if (from) { where += ' AND at >= ?'; args.push(from); }
  if (to) { where += ' AND at <= ?'; args.push(to + ' 23:59:59'); }
  if (csv) {
    const rows = db.prepare(`SELECT a.*, u.name user_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ${where} ORDER BY a.id DESC LIMIT 5000`).all(...args);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="audit-log.csv"');
    res.send(toCsv(rows, [
      { key: 'at', label: 'Time' }, { key: 'user_name', label: 'User' },
      { key: 'action', label: 'Action' }, { key: 'entity', label: 'Entity' },
      { key: 'entity_id', label: 'Entity ID' }, { key: 'ip', label: 'IP' },
      { key: 'details', label: 'Details' },
    ]));
    return;
  }
  const total = db.prepare(`SELECT COUNT(*) c FROM audit_logs a ${where}`).get(...args).c;
  const rows = db.prepare(
    `SELECT a.*, u.name user_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ${where}
     ORDER BY a.id DESC LIMIT ? OFFSET ?`
  ).all(...args, perPage, (parseInt(page, 10) - 1) * perPage);
  for (const r of rows) r.details = r.details ? JSON.parse(r.details) : null;
  res.json({ rows, total, page: parseInt(page, 10), pages: Math.ceil(total / perPage) });
});

/* ============================ REPORTS ============================ */
const reports = {
  collections: (f) => ({
    title: 'Collections',
    rows: db.prepare(
      `SELECT substr(p.approved_at,1,10) day, c.name customer, p.method, p.amount
       FROM payments p JOIN customers c ON c.id=p.customer_id
       WHERE p.status='approved' AND (p.approved_at >= ? OR ?='') AND (p.approved_at <= ? OR ?='')
       ORDER BY p.approved_at`
    ).all(f.from || '', f.from || '', (f.to || '') + ' 23:59:59', (f.to || '') + ' 23:59:59'),
  }),
  invoices: (f) => ({
    title: 'Invoices',
    rows: db.prepare(
      `SELECT i.invoice_no, i.due_date, i.status, i.total, i.paid, i.balance, c.name customer
       FROM invoices i JOIN customers c ON c.id=i.customer_id
       WHERE (i.due_date >= ? OR ?='') AND (i.due_date <= ? OR ?='') ORDER BY i.id DESC`
    ).all(f.from || '', f.from || '', f.to || '', f.to || ''),
  }),
  dues_aging: () => ({
    title: 'Outstanding Dues (Aging)',
    rows: outstandingInvoices().map((r) => ({
      customer: r.name, code: r.customer_code, phone: r.phone, invoice: r.invoice_no,
      due: r.due_date, days_overdue: r.days_overdue, bucket: r.bucket, balance: r.balance,
    })),
  }),
  customers: (f) => ({
    title: 'Customers',
    rows: db.prepare(
      `SELECT c.customer_code, c.name, c.phone, c.status, a.name area, p.name pkg, c.created_at
       FROM customers c LEFT JOIN areas a ON a.id=c.area_id LEFT JOIN packages p ON p.id=c.package_id
       WHERE c.archived_at IS NULL AND (?='' OR a.name LIKE ?) AND (?='' OR c.status=?) ORDER BY c.id DESC`
    ).all(f.area || '', f.area || '' ? `%${f.area}%` : '', f.status || '', f.status || ''),
  }),
  expenses: (f) => ({
    title: 'Expenses',
    rows: db.prepare(
      `SELECT expense_date, category, description, amount, transaction_ref FROM expenses
       WHERE (expense_date >= ? OR ?='') AND (expense_date <= ? OR ?='') ORDER BY expense_date DESC`
    ).all(f.from || '', f.from || '', f.to || '', f.to || ''),
  }),
  provider_payables: () => ({
    title: 'Upstream Provider Payables',
    rows: db.prepare(
      `SELECT p.company, pi.period, pi.invoice_no, pi.amount, pi.paid, (pi.amount-pi.paid) outstanding, pi.due_date
       FROM provider_invoices pi JOIN providers p ON p.id=pi.provider_id WHERE pi.amount > pi.paid ORDER BY pi.id DESC`
    ).all(),
  }),
  tickets: (f) => ({
    title: 'Tickets',
    rows: db.prepare(
      `SELECT t.ticket_no, t.category, t.priority, t.status, t.created_at, t.resolved_at, c.name customer
       FROM tickets t LEFT JOIN customers c ON c.id=t.customer_id
       WHERE (t.created_at >= ? OR ?='') ORDER BY t.id DESC LIMIT 1000`
    ).all(f.from || '', f.from || ''),
  }),
  inventory: () => ({
    title: 'Inventory Valuation',
    rows: db.prepare(
      `SELECT i.name, i.unit, i.unit_cost, i.reorder_level,
        COALESCE(SUM(CASE WHEN m.mtype IN ('purchase','adjust_in','return') THEN m.qty ELSE -m.qty END),0) stock
       FROM inventory_items i LEFT JOIN inventory_movements m ON m.item_id=i.id GROUP BY i.id`
    ).all(),
  }),
  bandwidth: () => {
    const rows = db.prepare(`SELECT * FROM status_history WHERE scope='sessions' ORDER BY id DESC LIMIT 50`).all();
    return {
      title: 'Bandwidth / Active Sessions (device polls)',
      rows: rows.map((r) => {
        let d = {};
        try { d = JSON.parse(r.data); } catch { /* ignore */ }
        return { at: r.at, sessions: (d.sessions || []).length, simulated: !!d.simulated };
      }),
    };
  },
};
router.get('/reports/:name', (req, res) => {
  const fn = reports[req.params.name];
  if (!fn) return res.status(404).json({ error: 'Unknown report' });
  const f = req.query;
  const out = fn(f);
  if (f.csv === '1') {
    const cols = out.rows.length
      ? Object.keys(out.rows[0]).map((k) => ({ key: k, label: k }))
      : [];
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.name}.csv"`);
    res.send(toCsv(out.rows, cols));
    return;
  }
  const total = out.rows.reduce((s, r) => s + (Number(r.amount) || Number(r.balance) || Number(r.outstanding) || 0), 0);
  res.json({ title: out.title, rows: out.rows.slice(0, 500), total });
});

module.exports = { opRouter: router };

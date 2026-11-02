'use strict';
/*
 * Owner/Super Admin JSON API — Part 1:
 * auth, dashboard, global search, applications workflow, customers, packages.
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const busboy = require('busboy');
const { db, tx } = require('../db');
const { getSetting, setSetting, config } = require('../config');
const {
  hashPassword, verifyPassword, createSession, getSession, destroySession,
  requireOwner, requireCsrf, cookie, audit, loginBlocked, recordFailedLogin,
  verifyTotp, base32Encode, encryptSecret, decryptSecret,
} = require('../lib/auth');
const {
  toPaise, fmtMoney, fmtDate, fmtDateTime, todayPKT, addDays, nextSeq, newId,
  cleanPhone, cleanCnic, validCnic, toCsv, parseCsv, sniffMime, UPLOAD_TYPES,
} = require('../lib/util');
const { sendNotification } = require('../lib/notify');
const { createInvoice, getInvoice, customerLedger, prorateChange } = require('../lib/billing');
const { recordPayment, getPayment, approvePayment, rejectPayment, refundPayment } = require('../lib/payments');
const { accountByCategory } = require('../lib/accounting');
const devices = require('../lib/devices');

const router = express.Router();
const { opRouter } = require('./api_ops');

/* ============================ AUTH ============================ */
router.post('/login', express.json(), (req, res) => {
  const ip = req.ip || 'unknown';
  if (loginBlocked(ip)) return res.status(429).json({ error: 'Too many failed attempts. Try again in 15 minutes.' });
  const { email, password, code } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(String(email || '').trim().toLowerCase());
  if (!user || !verifyPassword(String(password || ''), user.password_hash)) {
    recordFailedLogin(ip);
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  if (user.totp_enabled) {
    if (!code || !verifyTotp(user.totp_secret, code)) {
      recordFailedLogin(ip);
      return res.status(401).json({ error: 'Invalid 2FA code', two_factor: true });
    }
  }
  const sess = createSession(user.id, ip);
  audit(user.id, 'login', 'users', user.id, null, ip);
  res.setHeader('Set-Cookie', `rana_session=${sess.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${config.sessionDays * 86400}`);
  res.json({ ok: true, csrf: sess.csrf, user: { id: user.id, name: user.name, email: user.email } });
});

// everything below /login requires an authenticated owner session
router.use(requireOwner);

router.post('/logout', requireOwner, requireCsrf, (req, res) => {
  audit(req.user.id, 'logout', 'users', req.user.id, null, req.ip);
  destroySession(req.sessionToken);
  res.setHeader('Set-Cookie', 'rana_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
});

router.get('/me', requireOwner, (req, res) => {
  res.json({ user: { id: req.user.id, name: req.user.name, email: req.user.email }, csrf: req.user.csrf, totpEnabled: !!req.user.totp_enabled });
});

router.post('/password', requireOwner, requireCsrf, express.json(), (req, res) => {
  const { current, next } = req.body || {};
  if (!next || String(next).length < 8) return res.status(422).json({ error: 'New password must be at least 8 characters' });
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!verifyPassword(String(current || ''), u.password_hash)) return res.status(401).json({ error: 'Current password is incorrect' });
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(String(next)), u.id);
  audit(u.id, 'password_change', 'users', u.id, null, req.ip);
  res.json({ ok: true });
});

/* 2FA */
router.get('/totp/setup', requireOwner, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  const secret = u.totp_secret || (() => {
    const s = base32Encode(require('crypto').randomBytes(20));
    db.prepare('UPDATE users SET totp_secret=? WHERE id=?').run(s, u.id);
    return s;
  })();
  const otpurl = `otpauth://totp/Rana%20Internet:${u.email}?secret=${secret}&issuer=Rana%20Internet&digits=6&period=30`;
  res.json({ secret, otpauth_url: otpurl, enabled: !!u.totp_enabled });
});
router.post('/totp/enable', requireOwner, requireCsrf, express.json(), (req, res) => {
  const { code } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!u.totp_secret || !verifyTotp(u.totp_secret, code)) return res.status(422).json({ error: 'Invalid verification code' });
  db.prepare('UPDATE users SET totp_enabled=1 WHERE id=?').run(u.id);
  audit(u.id, 'totp_enabled', 'users', u.id, null, req.ip);
  res.json({ ok: true });
});
router.post('/totp/disable', requireOwner, requireCsrf, express.json(), (req, res) => {
  const { code, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (u.totp_enabled && !verifyTotp(u.totp_secret, code)) return res.status(422).json({ error: 'Invalid 2FA code' });
  if (!verifyPassword(String(password || ''), u.password_hash)) return res.status(401).json({ error: 'Password required' });
  db.prepare('UPDATE users SET totp_enabled=0 WHERE id=?').run(u.id);
  audit(u.id, 'totp_disabled', 'users', u.id, null, req.ip);
  res.json({ ok: true });
});

/* ============================ DASHBOARD ============================ */
router.get('/dashboard', requireOwner, (req, res) => {
  const dbq = db;
  const counts = (status) => dbq.prepare('SELECT COUNT(*) c FROM customers WHERE status=? AND archived_at IS NULL').get(status).c;
  const totals = {
    total: dbq.prepare('SELECT COUNT(*) c FROM customers WHERE archived_at IS NULL').get().c,
    application: counts('application'), pending: counts('pending'),
    active: counts('active'), suspended: counts('suspended'),
    disconnected: counts('disconnected'), terminated: counts('terminated'),
  };

  const monthStart = todayPKT().slice(0, 8) + '01';
  const today = todayPKT();
  const monthCollections = dbq.prepare(
    `SELECT COALESCE(SUM(amount),0) s FROM payments WHERE status='approved' AND approved_at >= ?`
  ).get(monthStart).s;
  const todayCollections = dbq.prepare(
    `SELECT COALESCE(SUM(amount),0) s FROM payments WHERE status='approved' AND substr(approved_at,1,10)=?`
  ).get(today).s;
  const monthRevenue = dbq.prepare(
    `SELECT COALESCE(SUM(jl.credit),0) s FROM journal_lines jl
     JOIN journal_entries je ON je.id=jl.entry_id
     JOIN accounts a ON a.id=jl.account_id AND a.type='income'
     WHERE je.entry_date >= ?`
  ).get(monthStart).s;
  const monthExpenses = dbq.prepare(
    `SELECT COALESCE(SUM(jl.debit),0) s FROM journal_lines jl
     JOIN journal_entries je ON je.id=jl.entry_id
     JOIN accounts a ON a.id=jl.account_id AND a.type='expense'
     WHERE je.entry_date >= ?`
  ).get(monthStart).s;
  const outstanding = dbq.prepare(`SELECT COALESCE(SUM(balance),0) s FROM invoices WHERE status IN ('unpaid','partial')`).get().s;

  const pendingPayments = dbq.prepare(`SELECT COUNT(*) c FROM payments WHERE status='pending'`).get().c;
  const newApps = dbq.prepare(`SELECT COUNT(*) c FROM applications WHERE status IN ('new','surveyed')`).get().c;
  const openTickets = dbq.prepare(`SELECT COUNT(*) c FROM tickets WHERE status IN ('open','in_progress','pending')`).get().c;
  const overdue = dbq.prepare(`SELECT COUNT(*) c, COALESCE(SUM(balance),0) s FROM invoices WHERE status IN ('unpaid','partial') AND due_date < ?`).get(today);

  // device overview
  const deviceCfg = getSetting('devices') || {};
  const demoMode = (getSetting('system') || {}).demo_data === true;
  const devRows = dbq.prepare(
    `SELECT d.id, d.name, d.driver, d.kind, d.status, d.safe_mode, d.last_sync_at, d.identity,
      (SELECT COUNT(*) FROM command_logs cl WHERE cl.device_id=d.id AND cl.status IN ('queued','running','pending_sync')) pending
     FROM devices d ORDER BY d.id`
  ).all();
  const onlineSessions = dbq.prepare(`SELECT COUNT(*) c FROM customers WHERE device_status='online' AND archived_at IS NULL`).get().c;
  const onuCounts = {
    total: dbq.prepare('SELECT COUNT(*) c FROM onus').get().c,
    online: dbq.prepare(`SELECT COUNT(*) c FROM onus WHERE status='online'`).get().c,
  };
  const peak = dbq.prepare(`SELECT data FROM status_history WHERE scope='sessions' ORDER BY id DESC LIMIT 1`).get();
  let bandwidth = null;
  if (peak) {
    try {
      const d = JSON.parse(peak.data);
      bandwidth = {
        sessions: (d.sessions || []).length,
        simulated: !!d.simulated,
        at: peak.at,
      };
    } catch { /* ignore */ }
  }

  // alerts
  const alerts = [];
  const lowStock = dbq.prepare(
    `SELECT i.name, i.unit, COALESCE(SUM(CASE WHEN m.mtype IN ('purchase','adjust_in','return') THEN m.qty ELSE -m.qty END),0) stock, i.reorder_level
     FROM inventory_items i LEFT JOIN inventory_movements m ON m.item_id=i.id
     GROUP BY i.id HAVING stock <= i.reorder_level ORDER BY stock`
  ).all();
  for (const l of lowStock.slice(0, 5)) alerts.push({ type: 'low_stock', text: `Low stock: ${l.name} (${l.stock} ${l.unit} left)` });
  const boxAlerts = dbq.prepare(
    `SELECT f.name, f.capacity, COUNT(bp.id) used FROM fiber_boxes f
     JOIN box_ports bp ON bp.box_id=f.id AND bp.status='occupied'
     GROUP BY f.id HAVING used >= f.capacity - 1`
  ).all();
  for (const b of boxAlerts.slice(0, 5)) alerts.push({ type: 'port_capacity', text: `Fiber box "${b.name}" near capacity (${b.used}/${b.capacity} ports used)` });
  if (overdue.c) alerts.push({ type: 'overdue', text: `${overdue.c} invoices overdue totaling ${fmtMoney(overdue.s)}` });
  for (const d of devRows) {
    if (d.status === 'error') alerts.push({ type: 'device', text: `Device "${d.name}" reports error` });
    else if (d.pending) alerts.push({ type: 'device', text: `Device "${d.name}" has ${d.pending} pending commands` });
  }

  // charts: last 6 months collections + customer growth + package distribution
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setMonth(d.getMonth() - i);
    months.push(d.toISOString().slice(0, 7));
  }
  const collections = months.map((m) => ({
    month: m,
    amount: dbq.prepare(`SELECT COALESCE(SUM(amount),0) s FROM payments WHERE status='approved' AND substr(approved_at,1,7)=?`).get(m).s,
  }));
  const growth = months.map((m) => ({
    month: m,
    customers: dbq.prepare(`SELECT COUNT(*) c FROM customers WHERE substr(created_at,1,7) <= ?`).get(m).c,
  }));
  const pkgDist = dbq.prepare(
    `SELECT COALESCE(p.name,'No package') name, COUNT(c.id) c
     FROM customers c LEFT JOIN packages p ON p.id=c.package_id
     WHERE c.archived_at IS NULL AND c.status IN ('active','suspended') GROUP BY p.name ORDER BY c DESC`
  ).all();

  const recent = dbq.prepare(
    `SELECT a.action, a.entity, a.details, a.at FROM audit_logs a ORDER BY a.id DESC LIMIT 8`
  ).all().map((r) => ({ ...r, details: r.details ? JSON.parse(r.details) : null }));

  res.json({
    totals,
    finance: { todayCollections, monthCollections, monthRevenue, monthExpenses, outstanding, operatingProfit: monthRevenue - monthExpenses },
    counts: { pendingPayments, newApps, openTickets, overdue: overdue.c, overdueAmount: overdue.s },
    devices: { demoMode, pollEnabled: !!deviceCfg.poll_enabled, globalSafeMode: !!deviceCfg.global_safe_mode, devices: devRows, onlineSessions, onus: onuCounts, bandwidth },
    alerts,
    charts: { collections, growth, pkgDist },
    recent,
    company: getSetting('company') || {},
  });
});

/* ============================ GLOBAL SEARCH ============================ */
router.get('/search', requireOwner, (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ results: [] });
  const like = `%${q}%`;
  const customers = db.prepare(
    `SELECT id, customer_code, name, phone, cnic, status FROM customers
     WHERE name LIKE ? OR phone LIKE ? OR cnic LIKE ? OR customer_code LIKE ? OR pppoe_username LIKE ?
     AND archived_at IS NULL LIMIT 8`
  ).all(like, like, like, like, like);
  const invoices = db.prepare(
    `SELECT i.id, i.invoice_no, i.balance, i.status, c.name FROM invoices i JOIN customers c ON c.id=i.customer_id
     WHERE i.invoice_no LIKE ? LIMIT 5`
  ).all(like);
  const tickets = db.prepare(
    `SELECT t.id, t.ticket_no, t.status, t.summary, c.name FROM tickets t LEFT JOIN customers c ON c.id=t.customer_id
     WHERE t.ticket_no LIKE ? OR t.summary LIKE ? LIMIT 5`
  ).all(like, like);
  const onus = db.prepare(
    `SELECT o.id, o.serial, o.mac, o.status, c.name FROM onus o LEFT JOIN customers c ON c.id=o.customer_id
     WHERE o.serial LIKE ? OR o.mac LIKE ? LIMIT 5`
  ).all(like, like);
  res.json({ results: { customers, invoices, tickets, onus } });
});

/* ============================ APPLICATIONS ============================ */
function appDetail(id) {
  const a = db.prepare('SELECT * FROM applications WHERE id=?').get(id);
  if (!a) return null;
  a.customer = db.prepare('SELECT * FROM customers WHERE id=?').get(a.customer_id);
  a.package = a.requested_package_id ? db.prepare('SELECT * FROM packages WHERE id=?').get(a.requested_package_id) : null;
  a.installation = db.prepare('SELECT * FROM installations WHERE customer_id=? ORDER BY id DESC LIMIT 1').get(a.customer_id);
  a.timeline = db.prepare(
    `SELECT action, entity, entity_id, details, at FROM audit_logs
     WHERE (entity='applications' AND entity_id=?) OR (entity='customers' AND entity_id=?)
     ORDER BY id DESC LIMIT 30`
  ).all(a.id, a.customer_id).map((r) => ({ ...r, details: r.details ? JSON.parse(r.details) : null }));
  return a;
}

router.get('/applications', requireOwner, (req, res) => {
  const { status, q } = req.query;
  let sql = `SELECT a.*, c.name, c.phone, c.customer_code, c.area_id, p.name pkg FROM applications a
             JOIN customers c ON c.id=a.customer_id LEFT JOIN packages p ON p.id=a.requested_package_id WHERE 1=1`;
  const args = [];
  if (status) { sql += ' AND a.status=?'; args.push(status); }
  if (q) { sql += ' AND (c.name LIKE ? OR c.phone LIKE ? OR a.ref LIKE ?)'; args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  sql += ' ORDER BY a.id DESC LIMIT 300';
  res.json(db.prepare(sql).all(...args));
});

router.post('/applications', requireOwner, requireCsrf, express.json(), (req, res) => {
  const b = req.body;
  const name = String(b.name || '').trim();
  if (name.length < 3) return res.status(422).json({ error: 'Customer name required' });
  const cnic = cleanCnic(b.cnic);
  if (cnic && !validCnic(cnic)) return res.status(422).json({ error: 'Invalid CNIC (13 digits)' });
  const code = nextSeq(db, 'customers', 'id', 'RI-', 6);
  const info = db.prepare(
    `INSERT INTO customers(customer_code, name, father_name, cnic, phone, whatsapp, email, address, area_id, status, notes)
     VALUES(?,?,?,?,?,?,?,?,?,'pending',?)`
  ).run(code, name, b.father_name || null, cnic || null, cleanPhone(b.phone), cleanPhone(b.whatsapp || b.phone),
    b.email || null, b.address || null, parseInt(b.area_id, 10) || null, b.notes || null);
  const cid = Number(info.lastInsertRowid);
  const ref = newId('APP', 6);
  const appInfo = db.prepare(
    `INSERT INTO applications(ref, customer_id, requested_package_id, channel, status) VALUES(?,?,?,?, 'new')`
  ).run(ref, cid, parseInt(b.package_id, 10) || null, 'owner');
  audit(req.user.id, 'application_created', 'applications', Number(appInfo.lastInsertRowid), { ref, name }, req.ip);
  res.status(201).json({ id: Number(appInfo.lastInsertRowid), ref, customer_id: cid });
});

router.get('/applications/:id', requireOwner, (req, res) => {
  const a = appDetail(Number(req.params.id));
  if (!a) return res.status(404).json({ error: 'Not found' });
  res.json(a);
});

router.post('/applications/:id/survey', requireOwner, requireCsrf, express.json(), (req, res) => {
  const a = db.prepare('SELECT * FROM applications WHERE id=?').get(Number(req.params.id));
  if (!a) return res.status(404).json({ error: 'Not found' });
  const b = req.body;
  const feasibility = ['feasible', 'not_feasible', 'pending'].includes(b.feasibility) ? b.feasibility : 'pending';
  db.prepare(
    `UPDATE applications SET feasibility=?, survey_notes=?, proposed_route=?, est_charges=?, status='surveyed', updated_at=datetime('now') WHERE id=?`
  ).run(feasibility, b.survey_notes || null, b.proposed_route || null, toPaise(b.est_charges), a.id);
  audit(req.user.id, 'application_survey', 'applications', a.id, { feasibility, est_charges: toPaise(b.est_charges) }, req.ip);
  res.json({ ok: true });
});

router.post('/applications/:id/install', requireOwner, requireCsrf, express.json(), (req, res) => {
  const a = db.prepare('SELECT * FROM applications WHERE id=?').get(Number(req.params.id));
  if (!a) return res.status(404).json({ error: 'Not found' });
  const b = req.body;
  if (!b.staff_id) return res.status(422).json({ error: 'Assign a staff member (installation tech)' });
  db.prepare(
    `INSERT INTO installations(customer_id, staff_id, status, scheduled_at, notes) VALUES(?,?, 'scheduled', ?, ?)`
  ).run(a.customer_id, b.staff_id, /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : todayPKT(), b.notes || null);
  db.prepare(`UPDATE applications SET status='in_installation', updated_at=datetime('now') WHERE id=?`).run(a.id);
  audit(req.user.id, 'installation_scheduled', 'applications', a.id, { staff_id: b.staff_id, date: b.date }, req.ip);
  res.json({ ok: true });
});

/**
 * Complete installation: cable meters, materials (stock issued), ONU serial/MAC,
 * box/port assignment (double-assignment prevented), PPPoE username, photos.
 */
router.post('/installations/:id/complete', requireOwner, requireCsrf, express.json(), (req, res) => {
  const inst = db.prepare('SELECT * FROM installations WHERE id=?').get(Number(req.params.id));
  if (!inst) return res.status(404).json({ error: 'Installation not found' });
  const b = req.body;
  const app = db.prepare('SELECT * FROM applications WHERE customer_id=? ORDER BY id DESC LIMIT 1').get(inst.customer_id);
  const customer = db.prepare('SELECT * FROM customers WHERE id=?').get(inst.customer_id);

  // feasibility gate with override
  if (app && app.feasibility === 'not_feasible' && !b.override_reason) {
    return res.status(422).json({ error: 'Feasibility was marked NOT feasible. Provide an override reason to continue.' });
  }
  if (!b.onu_serial && !b.override_reason) {
    return res.status(422).json({ error: 'ONU serial number is required to complete installation (or provide override reason).' });
  }

  let onuId = null;
  if (b.onu_serial) {
    const serial = String(b.onu_serial).trim();
    const existingOnu = db.prepare('SELECT id FROM onus WHERE serial=?').get(serial);
    if (existingOnu) {
      const usedBy = db.prepare('SELECT customer_id FROM onus WHERE id=?').get(existingOnu.id).customer_id;
      if (usedBy && usedBy !== inst.customer_id) {
        return res.status(409).json({ error: `ONU serial ${serial} is already registered to another customer` });
      }
      onuId = existingOnu.id;
    }
  }

  // box / port assignment
  let boxPortId = null;
  if (b.box_id) {
    const portNo = parseInt(b.box_port_no, 10);
    const box = db.prepare('SELECT * FROM fiber_boxes WHERE id=?').get(b.box_id);
    if (!box) return res.status(422).json({ error: 'Selected fiber box not found' });
    const port = db.prepare('SELECT * FROM box_ports WHERE box_id=? AND port_no=?').get(box.id, portNo);
    if (!port) return res.status(422).json({ error: `Port ${portNo} does not exist on box "${box.name}"` });
    if (port.status === 'occupied') {
      const occ = db.prepare(
        `SELECT c.name, c.customer_code FROM customers c WHERE c.box_id=? AND c.box_port_no=? AND c.archived_at IS NULL`
      ).get(box.id, portNo);
      return res.status(409).json({ error: `Port ${portNo} on "${box.name}" is already occupied${occ ? ` by ${occ.name}` : ''}` });
    }
    boxPortId = port.id;
  }

  const pppoe = b.pppoe_username ? String(b.pppoe_username).trim().replace(/\s/g, '').toLowerCase() : null;
  if (pppoe) {
    const clash = db.prepare('SELECT id FROM customers WHERE pppoe_username=? AND id != ?').get(pppoe, inst.customer_id);
    if (clash) return res.status(409).json({ error: `PPPoE username "${pppoe}" is already in use` });
  }
  if (!pppoe && !b.override_reason) return res.status(422).json({ error: 'PPPoE username is required (or override reason)' });

  // material issues
  const materials = [];
  for (const m of Array.isArray(b.materials) ? b.materials : []) {
    const item = db.prepare('SELECT * FROM inventory_items WHERE id=?').get(Number(m.item_id));
    if (!item) continue;
    const qty = parseInt(m.qty, 10) || 0;
    if (qty <= 0) continue;
    materials.push({ item_id: item.id, name: item.name, qty });
  }

  tx((d) => {
    const isu = d.prepare(
      `INSERT INTO inventory_movements(item_id, mtype, qty, installation_id, customer_id, notes) VALUES(?, 'issue', ?, ?, ?, ?)`
    );
    for (const m of materials) isu.run(m.item_id, m.qty, inst.id, inst.customer_id, 'Installation material issue');
    if (onuId) {
      d.prepare(`UPDATE onus SET customer_id=?, box_port_id=?, status='registered' WHERE id=?`)
        .run(inst.customer_id, boxPortId || null, onuId);
    } else if (b.onu_serial) {
      const info = d.prepare(
        `INSERT INTO onus(serial, mac, customer_id, box_port_id, status) VALUES(?,?,?,?, 'registered')`
      ).run(String(b.onu_serial).trim(), b.onu_mac ? String(b.onu_mac).trim().toUpperCase() : null, inst.customer_id, boxPortId || null);
      onuId = Number(info.lastInsertRowid);
    }
    if (boxPortId) d.prepare(`UPDATE box_ports SET status='occupied' WHERE id=?`).run(boxPortId);
    d.prepare(
      `UPDATE customers SET pppoe_username=?, onu_id=?, box_id=?, box_port_no=?, pop_id=?, olt_id=?, pon_port_id=?, splitter_id=?,
       installed_at=datetime('now'), status='pending', updated_at=datetime('now') WHERE id=?`
    ).run(pppoe, onuId, b.box_id || null, b.box_id ? parseInt(b.box_port_no, 10) : null,
      b.pop_id || null, b.olt_id || null, b.pon_port_id || null, b.splitter_id || null, inst.customer_id);
    if (b.olt_id) {
      d.prepare(`UPDATE pon_ports SET status='occupied' WHERE id=?`).run(b.pon_port_id);
    }
    d.prepare(
      `INSERT INTO customer_connections(customer_id, pop_id, olt_id, pon_port_id, splitter_id, box_id, box_port_no, pppoe_username, status)
       VALUES(?,?,?,?,?,?,?,?,'current')`
    ).run(inst.customer_id, b.pop_id || null, b.olt_id || null, b.pon_port_id || null, b.splitter_id || null,
      b.box_id || null, b.box_id ? parseInt(b.box_port_no, 10) : null, pppoe);
    d.prepare(`UPDATE installations SET status='completed', completed_at=datetime('now'), cable_meters=?, materials=? WHERE id=?`)
      .run(parseFloat(b.cable_meters) || null, JSON.stringify(materials), inst.id);
    if (app) d.prepare(`UPDATE applications SET status='completed', updated_at=datetime('now') WHERE id=?`).run(app.id);
    // create ONU device command (queued) so integration can register
    try {
      const drv = d.prepare(`SELECT id, driver FROM devices WHERE status='enabled' ORDER BY id DESC LIMIT 1`).get();
      if (drv && pppoe) {
        d.prepare(
          `INSERT INTO command_logs(device_id, customer_id, action, payload, status, correlation_id, initiated_by)
           VALUES(?,?, 'add_secret', ?, 'queued', ?, ?)`
        ).run(drv.id, inst.customer_id, JSON.stringify({ username: pppoe, password: b.pppoe_password || 'auto' }), newId('CMD'), req.user.id);
      }
    } catch { /* optional */ }
  });
  audit(req.user.id, 'installation_completed', 'installations', inst.id,
    { customer: customer.name, cable_meters: b.cable_meters, materials, pppoe, override_reason: b.override_reason || null }, req.ip);
  res.json({ ok: true, onu_id: onuId });
});

/** Activate: set active, first invoice, device enable command. */
router.post('/applications/:id/activate', requireOwner, requireCsrf, express.json(), (req, res) => {
  const a = db.prepare('SELECT * FROM applications WHERE id=?').get(Number(req.params.id));
  if (!a) return res.status(404).json({ error: 'Not found' });
  const customer = db.prepare('SELECT * FROM customers WHERE id=?').get(a.customer_id);
  const b = req.body;

  const pkg = db.prepare('SELECT * FROM packages WHERE id=?').get(parseInt(b.package_id, 10) || customer.package_id || a.requested_package_id);
  if (!pkg) return res.status(422).json({ error: 'Select a package for activation' });
  if (customer.status !== 'pending' && customer.status !== 'application') {
    return res.status(409).json({ error: `Customer is already ${customer.status}` });
  }

  const advance = toPaise(b.advance || 0);
  const firstInvoice = b.first_invoice !== false;

  tx((d) => {
    d.prepare(
      `UPDATE customers SET status='active', package_id=?, billing_day=?, install_charges=?, advance=advance+?,
       updated_at=datetime('now') WHERE id=?`
    ).run(pkg.id, parseInt(b.billing_day, 10) || 5, toPaise(b.install_charges || 0), advance, customer.id);
    d.prepare(`UPDATE applications SET status='activated', updated_at=datetime('now') WHERE id=?`).run(a.id);
  });

  let invoice = null;
  if (firstInvoice) {
    const periodFrom = todayPKT();
    const periodTo = addDays(periodFrom, pkg.cycle_days - 1);
    const items = [
      { item_type: 'package', description: `${pkg.name} (${pkg.download_mbps}Mbps) — first cycle ${periodFrom} to ${periodTo}`, qty: 1, amount: pkg.price_monthly },
    ];
    if (customer.install_charges > 0 || b.install_charges) {
      items.push({ item_type: 'installation', description: `Installation charges — ${pkg.name}`, qty: 1, amount: toPaise(b.install_charges) || customer.install_charges });
    }
    if (advance > 0) {
      const base = items.reduce((s, i) => s + i.amount, 0);
      const apply = Math.min(advance, base);
      if (apply > 0) {
        items.push({ item_type: 'advance_adjustment', description: 'Advance applied', qty: 1, amount: -apply });
        db.prepare('UPDATE customers SET advance=advance-? WHERE id=?').run(apply, customer.id);
      }
    }
    invoice = createInvoice({
      customerId: customer.id, items, periodFrom, periodTo,
      dueDate: addDays(todayPKT(), (getSetting('billing') || {}).due_days_after_invoice ?? 10),
      generatedBy: `user:${req.user.id}`,
    });
  }

  let command = null;
  if (customer.pppoe_username) {
    try {
      command = devices.queueCommand({ driver: 'mock', customerId: customer.id, action: 'enable_user', initiatedBy: req.user.id, source: 'activation' });
    } catch (e) {
      command = { error: e.message };
    }
  }

  audit(req.user.id, 'customer_activated', 'customers', customer.id,
    { package: pkg.name, advance, first_invoice: invoice?.invoice_no || null, command: command?.status || command?.error || null }, req.ip);
  sendNotification({ templateKey: 'application_approved', customerId: customer.id, toAddress: customer.whatsapp || customer.phone, vars: { customer_name: customer.name, ref: customer.application_ref || '' } });
  res.json({ ok: true, invoice, command });
});

router.post('/applications/:id/reject', requireOwner, requireCsrf, express.json(), (req, res) => {
  const a = db.prepare('SELECT * FROM applications WHERE id=?').get(Number(req.params.id));
  if (!a) return res.status(404).json({ error: 'Not found' });
  const reason = String(req.body.reason || '').trim();
  if (!reason) return res.status(422).json({ error: 'Rejection reason is required' });
  db.prepare(`UPDATE applications SET status='rejected', reject_reason=?, updated_at=datetime('now') WHERE id=?`).run(reason, a.id);
  db.prepare(`UPDATE customers SET status='terminated', notes=COALESCE(notes,'') || ? , updated_at=datetime('now') WHERE id=?`)
    .run(` [Application rejected: ${reason}]`, a.customer_id);
  audit(req.user.id, 'application_rejected', 'applications', a.id, { reason }, req.ip);
  res.json({ ok: true });
});

/* ============================ CUSTOMERS ============================ */
router.get('/customers', requireOwner, (req, res) => {
  const { status, area_id, package_id, q, page = 1, sort = 'id', dir = 'desc' } = req.query;
  const perPage = 25;
  let where = 'WHERE c.archived_at IS NULL';
  const args = [];
  if (status) { where += ' AND c.status=?'; args.push(status); }
  if (area_id) { where += ' AND c.area_id=?'; args.push(area_id); }
  if (package_id) { where += ' AND c.package_id=?'; args.push(package_id); }
  if (q) { where += ' AND (c.name LIKE ? OR c.phone LIKE ? OR c.cnic LIKE ? OR c.customer_code LIKE ? OR c.pppoe_username LIKE ?)'; args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
  const allowedSort = ['id', 'name', 'created_at', 'status', 'phone'];
  const s = allowedSort.includes(sort) ? sort : 'id';
  const d = dir === 'asc' ? 'asc' : 'desc';
  const total = db.prepare(`SELECT COUNT(*) c FROM customers c ${where}`).get(...args).c;
  const rows = db.prepare(
    `SELECT c.*, p.name package_name, a.name area_name,
      (SELECT COALESCE(SUM(i.balance),0) FROM invoices i WHERE i.customer_id=c.id AND i.status IN ('unpaid','partial')) dues
     FROM customers c LEFT JOIN packages p ON p.id=c.package_id LEFT JOIN areas a ON a.id=c.area_id
     ${where} ORDER BY c.${s} ${d} LIMIT ? OFFSET ?`
  ).all(...args, perPage, (parseInt(page, 10) - 1) * perPage);
  res.json({ rows, total, page: parseInt(page, 10), pages: Math.ceil(total / perPage) });
});

function customerDetail(id) {
  const c = db.prepare('SELECT * FROM customers WHERE id=?').get(id);
  if (!c) return null;
  c.package = c.package_id ? db.prepare('SELECT * FROM packages WHERE id=?').get(c.package_id) : null;
  c.area = c.area_id ? db.prepare('SELECT * FROM areas WHERE id=?').get(c.area_id) : null;
  c.box = c.box_id ? db.prepare('SELECT * FROM fiber_boxes WHERE id=?').get(c.box_id) : null;
  c.onu = c.onu_id ? db.prepare('SELECT * FROM onus WHERE id=?').get(c.onu_id) : null;
  c.invoices = db.prepare('SELECT * FROM invoices WHERE customer_id=? ORDER BY id DESC LIMIT 20').all(id);
  c.payments = db.prepare('SELECT * FROM payments WHERE customer_id=? ORDER BY id DESC LIMIT 20').all(id);
  c.ledger = customerLedger(id);
  c.documents = db.prepare('SELECT * FROM customer_documents WHERE customer_id=? ORDER BY id DESC').all(id);
  c.tickets = db.prepare('SELECT * FROM tickets WHERE customer_id=? ORDER BY id DESC LIMIT 10').all(id);
  c.installations = db.prepare('SELECT * FROM installations WHERE customer_id=? ORDER BY id DESC').all(id);
  c.commands = db.prepare('SELECT * FROM command_logs WHERE customer_id=? ORDER BY id DESC LIMIT 10').all(id);
  c.timeline = db.prepare(
    `SELECT action, entity, details, at FROM audit_logs WHERE entity='customers' AND entity_id=? ORDER BY id DESC LIMIT 40`
  ).all(id).map((r) => ({ ...r, details: r.details ? JSON.parse(r.details) : null }));
  const last = db.prepare(`SELECT * FROM invoices WHERE customer_id=? AND status != 'void' ORDER BY id DESC LIMIT 1`).get(id);
  c.lastInvoice = last || null;
  c.dues = db.prepare(`SELECT COALESCE(SUM(balance),0) s FROM invoices WHERE customer_id=? AND status IN ('unpaid','partial')`).get(id).s;
  return c;
}

/* CSV export */
router.get('/customers/export.csv', requireOwner, (req, res) => {
  const rows = db.prepare(
    `SELECT c.*, p.name package_name, a.name area_name FROM customers c
     LEFT JOIN packages p ON p.id=c.package_id LEFT JOIN areas a ON a.id=c.area_id
     WHERE c.archived_at IS NULL`
  ).all();
  const csv = toCsv(rows, [
    { key: 'customer_code', label: 'Customer ID' }, { key: 'name', label: 'Name' },
    { key: 'father_name', label: 'Father Name' }, { key: 'cnic', label: 'CNIC' },
    { key: 'phone', label: 'Phone' }, { key: 'whatsapp', label: 'WhatsApp' },
    { key: 'address', label: 'Address' }, { key: 'area_name', label: 'Area' },
    { key: 'status', label: 'Status' }, { key: 'package_name', label: 'Package' },
    { key: 'pppoe_username', label: 'PPPoE' }, { key: 'created_at', label: 'Created' },
  ]);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="customers.csv"');
  res.send(csv);
});

/* CSV import with validation + duplicate detection + error report */
router.post('/customers/import', requireOwner, requireCsrf, express.json({ limit: '5mb' }), (req, res) => {
  const text = req.body.text;
  if (!text) return res.status(422).json({ error: 'CSV text required. Expected columns: name,father_name,cnic,phone,whatsapp,address,area,package,status' });
  const rows = parseCsv(text);
  if (rows.length < 2) return res.status(422).json({ error: 'CSV must have a header row and data rows' });
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (n) => head.indexOf(n);
  const iName = idx('name'), iFather = idx('father_name'), iCnic = idx('cnic'), iPhone = idx('phone');
  const iWhats = idx('whatsapp'), iAddr = idx('address'), iArea = idx('area'), iPkg = idx('package'), iStatus = idx('status');
  if (iName < 0) return res.status(422).json({ error: 'Missing "name" column' });
  const created = [];
  const skipped = [];
  const errors = [];
  const knownAreas = new Map(db.prepare('SELECT name, id FROM areas').all().map((a) => [a.name.toLowerCase(), a.id]));
  const knownPkgs = new Map(db.prepare('SELECT name, id FROM packages').all().map((a) => [a.name.toLowerCase(), a.id]));
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const name = (row[iName] || '').trim();
    const cnic = cleanCnic(row[iCnic] || '');
    const phone = cleanPhone(row[iPhone] || '');
    if (name.length < 3) { errors.push({ row: r + 1, error: 'Missing/short name' }); continue; }
    if (cnic && !validCnic(cnic)) { errors.push({ row: r + 1, error: 'Invalid CNIC' }); continue; }
    const dup = (cnic && db.prepare('SELECT name FROM customers WHERE cnic=?').get(cnic))
      || (phone && db.prepare('SELECT name FROM customers WHERE phone=?').get(phone));
    if (dup) { skipped.push({ row: r + 1, name, reason: `Duplicate — matches existing ${dup.name}` }); continue; }
    const status = iStatus >= 0 && row[iStatus] ? row[iStatus].trim().toLowerCase() : 'pending';
    const code = nextSeq(db, 'customers', 'id', 'RI-', 6);
    db.prepare(
      `INSERT INTO customers(customer_code, name, father_name, cnic, phone, whatsapp, address, area_id, status)
       VALUES(?,?,?,?,?,?,?,?,?)`
    ).run(code, name, iFather >= 0 ? (row[iFather] || '').trim() : null, cnic || null, phone || null,
      iWhats >= 0 ? cleanPhone(row[iWhats]) : null, iAddr >= 0 ? (row[iAddr] || '').trim() : null,
      iArea >= 0 && knownAreas.get((row[iArea] || '').toLowerCase()) || null, status);
    created.push(name);
  }
  audit(req.user.id, 'customers_imported', 'customers', null, { created: created.length, skipped: skipped.length, errors: errors.length }, req.ip);
  res.json({ created: created.length, createdNames: created.slice(0, 20), skipped, errors });
});


router.get('/customers/:id', requireOwner, (req, res) => {
  const c = customerDetail(Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Customer not found' });
  res.json(c);
});

router.post('/customers', requireOwner, requireCsrf, express.json(), (req, res) => {
  const b = req.body;
  const name = String(b.name || '').trim();
  if (name.length < 3) return res.status(422).json({ error: 'Name required' });
  const cnic = cleanCnic(b.cnic);
  if (cnic) {
    if (!validCnic(cnic)) return res.status(422).json({ error: 'Invalid CNIC' });
    const dup = db.prepare('SELECT * FROM customers WHERE cnic=? AND archived_at IS NULL').get(cnic);
    if (dup) return res.status(409).json({ error: `Duplicate CNIC — already used by ${dup.name} (${dup.customer_code})`, duplicate: { name: dup.name, code: dup.customer_code } });
  }
  const phone = cleanPhone(b.phone);
  if (phone) {
    const dupP = db.prepare('SELECT * FROM customers WHERE phone=? AND archived_at IS NULL').get(phone);
    if (dupP) return res.status(409).json({ error: `Duplicate phone — already used by ${dupP.name} (${dupP.customer_code})`, duplicate: { name: dupP.name, code: dupP.customer_code } });
  }
  const code = nextSeq(db, 'customers', 'id', 'RI-', 6);
  const status = ['application', 'pending', 'active', 'suspended', 'disconnected', 'terminated'].includes(b.status) ? b.status : 'pending';
  const info = db.prepare(
    `INSERT INTO customers(customer_code, name, father_name, cnic, phone, whatsapp, email, address, area_id, lat, lng,
      status, package_id, billing_day, payment_terms, install_charges, discount, advance, pppoe_username, notes)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(code, name, b.father_name || null, cnic || null, phone || null, cleanPhone(b.whatsapp) || null, b.email || null,
    b.address || null, parseInt(b.area_id, 10) || null, parseFloat(b.lat) || null, parseFloat(b.lng) || null,
    status, parseInt(b.package_id, 10) || null, parseInt(b.billing_day, 10) || 5, b.payment_terms || 'monthly',
    toPaise(b.install_charges), toPaise(b.discount), toPaise(b.advance), b.pppoe_username || null, b.notes || null);
  audit(req.user.id, 'customer_created', 'customers', Number(info.lastInsertRowid), { name, status }, req.ip);
  res.status(201).json({ id: Number(info.lastInsertRowid), code });
});

router.put('/customers/:id', requireOwner, requireCsrf, express.json(), (req, res) => {
  const c = db.prepare('SELECT * FROM customers WHERE id=?').get(Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Not found' });
  const b = req.body;
  const cnic = cleanCnic(b.cnic);
  if (cnic && cnic !== c.cnic) {
    if (!validCnic(cnic)) return res.status(422).json({ error: 'Invalid CNIC' });
    const dup = db.prepare('SELECT id FROM customers WHERE cnic=? AND id != ? AND archived_at IS NULL').get(cnic, c.id);
    if (dup) return res.status(409).json({ error: 'Duplicate CNIC' });
  }
  db.prepare(
    `UPDATE customers SET name=?, father_name=?, cnic=?, phone=?, whatsapp=?, email=?, address=?, area_id=?, lat=?, lng=?,
     package_id=?, billing_day=?, payment_terms=?, discount=?, notes=?, updated_at=datetime('now') WHERE id=?`
  ).run(String(b.name || c.name).trim(), b.father_name || null, cnic || null, cleanPhone(b.phone) || null,
    cleanPhone(b.whatsapp) || null, b.email || null, b.address || null, parseInt(b.area_id, 10) || null,
    parseFloat(b.lat) || null, parseFloat(b.lng) || null, parseInt(b.package_id, 10) || null,
    parseInt(b.billing_day, 10) || 5, b.payment_terms || c.payment_terms, toPaise(b.discount ?? 0), b.notes || null, c.id);
  audit(req.user.id, 'customer_updated', 'customers', c.id, { name: b.name }, req.ip);
  res.json({ ok: true });
});

/** Manual status change — mandatory reason + audit + optional device command. */
router.post('/customers/:id/status', requireOwner, requireCsrf, express.json(), (req, res) => {
  const c = db.prepare('SELECT * FROM customers WHERE id=?').get(Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Not found' });
  const status = req.body.status;
  const reason = String(req.body.reason || '').trim();
  const allowed = ['pending', 'active', 'suspended', 'disconnected', 'terminated'];
  if (!allowed.includes(status)) return res.status(422).json({ error: 'Invalid status' });
  if (!reason) return res.status(422).json({ error: 'Reason is mandatory for status change' });
  if (status === c.status) return res.json({ ok: true, unchanged: true });
  db.prepare(`UPDATE customers SET status=?, updated_at=datetime('now') WHERE id=?`).run(status, c.id);
  audit(req.user.id, 'status_change', 'customers', c.id, { from: c.status, to: status, reason }, req.ip);
  sendNotification({
    templateKey: status === 'suspended' ? 'suspended' : status === 'active' ? 'reactivated' : null,
    customerId: c.id, toAddress: c.whatsapp || c.phone,
    vars: { customer_name: c.name, amount: fmtMoney(c.dues || 0) },
  }).catch?.(() => {});
  // device command (best effort, queued)
  let command = null;
  if (c.pppoe_username) {
    try {
      if (status === 'active') command = devices.queueCommand({ driver: 'mock', customerId: c.id, action: 'enable_user', initiatedBy: req.user.id });
      else if (status === 'suspended' || status === 'disconnected') command = devices.queueCommand({ driver: 'mock', customerId: c.id, action: 'disable_user', initiatedBy: req.user.id });
    } catch (e) { command = { error: e.message }; }
  }
  res.json({ ok: true, command });
});

/** Package change — effective next cycle by default, optional proration. */
router.post('/customers/:id/package', requireOwner, requireCsrf, express.json(), (req, res) => {
  const c = db.prepare('SELECT * FROM customers WHERE id=?').get(Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Not found' });
  const pkg = db.prepare('SELECT * FROM packages WHERE id=? AND is_active=1').get(parseInt(req.body.package_id, 10));
  if (!pkg) return res.status(422).json({ error: 'Package not found' });
  if (pkg.id === c.package_id) return res.json({ ok: true, unchanged: true });
  const proRata = req.body.pro_rata === true;
  let adjustment = null;
  if (proRata) {
    const oldPkg = c.package_id ? db.prepare('SELECT * FROM packages WHERE id=?').get(c.package_id) : null;
    const adj = prorateChange(oldPkg ? { ...oldPkg, __customerId: c.id } : null, pkg, todayPKT());
    if (Math.abs(adj) > 0) {
      const inv = createInvoice({
        customerId: c.id,
        items: [{ item_type: 'other', description: `Pro-rata adjustment: ${oldPkg ? oldPkg.name : 'none'} → ${pkg.name} (effective ${todayPKT()})`, qty: 1, amount: adj }],
        periodFrom: todayPKT(), periodTo: todayPKT(),
        dueDate: addDays(todayPKT(), 7),
        generatedBy: `user:${req.user.id}`,
        notes: 'Package change pro-rata adjustment',
      });
      adjustment = { invoice: inv.invoice_no, amount: adj };
    }
  }
  db.prepare(`UPDATE customers SET package_id=?, updated_at=datetime('now') WHERE id=?`).run(pkg.id, c.id);
  audit(req.user.id, 'package_change', 'customers', c.id,
    { from: c.package_id, to: pkg.id, pkg: pkg.name, pro_rata: adjustment }, req.ip);
  // speed profile update queued if device available
  let command = null;
  if (c.pppoe_username && pkg.device_profile) {
    try { command = devices.queueCommand({ driver: 'mock', customerId: c.id, action: 'set_profile', payload: { profile: pkg.device_profile }, initiatedBy: req.user.id }); }
    catch (e) { command = { error: e.message }; }
  }
  res.json({ ok: true, adjustment, command });
});

router.post('/customers/:id/archive', requireOwner, requireCsrf, (req, res) => {
  const c = db.prepare('SELECT * FROM customers WHERE id=?').get(Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Not found' });
  if (db.prepare(`SELECT COALESCE(SUM(balance),0) s FROM invoices WHERE customer_id=? AND status IN ('unpaid','partial')`).get(c.id).s > 0) {
    return res.status(409).json({ error: 'Customer has outstanding dues — settle before archiving' });
  }
  db.prepare(`UPDATE customers SET archived_at=datetime('now'), updated_at=datetime('now') WHERE id=?`).run(c.id);
  audit(req.user.id, 'customer_archived', 'customers', c.id, { code: c.customer_code }, req.ip);
  res.json({ ok: true });
});

/* documents */
router.post('/customers/:id/documents', requireOwner, requireCsrf, (req, res) => {
  const c = db.prepare('SELECT * FROM customers WHERE id=?').get(Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Not found' });
  const bb = busboy({ headers: req.headers, limits: { fileSize: config.maxUploadBytes, files: 3 } });
  const files = [];
  bb.on('file', (field, file, info) => {
    const dest = path.join(config.dataDir, 'uploads', `${Date.now()}-${Math.random().toString(36).slice(2)}.${info.extension || 'bin'}`);
    const ws = fs.createWriteStream(dest);
    file.pipe(ws);
    const entry = { field, file, dest, info, buffer: [] };
    files.push(entry);
    file.on('data', (d) => entry.buffer.push(d));
    ws.on('finish', () => file.close());
  });
  let docType = 'other';
  bb.on('field', (n, v) => { if (n === 'doc_type') docType = v; });
  bb.on('close', () => {
    try {
      for (const f of files) {
        const buf = Buffer.concat(f.buffer);
        const mime = sniffMime(buf);
        if (!mime) return res.status(422).json({ error: `Unsupported file type for ${f.info.originalname}` });
        if (buf.length > config.maxUploadBytes) return res.status(413).json({ error: 'File too large (max 5 MB)' });
        const rel = path.join('uploads', path.basename(f.dest));
        fs.renameSync(f.dest, path.join(config.dataDir, 'uploads', path.basename(f.dest)));
        db.prepare(
          `INSERT INTO customer_documents(customer_id, doc_type, file_path, original_name, size, mime) VALUES(?,?,?,?,?,?)`
        ).run(c.id, docType, rel, f.info.originalname, buf.length, mime);
        audit(req.user.id, 'document_uploaded', 'customer_documents', c.id, { type: docType, name: f.info.originalname }, req.ip);
      }
      res.json({ ok: true, count: files.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  bb.on('error', (e) => res.status(400).json({ error: e.message }));
  req.pipe(bb);
});

router.get('/files/customer/:docId', requireOwner, (req, res) => {
  const doc = db.prepare('SELECT * FROM customer_documents WHERE id=?').get(Number(req.params.docId));
  if (!doc) return res.status(404).end();
  const p = path.join(config.dataDir, doc.file_path.replace(/^uploads\//, 'uploads/'));
  if (!fs.existsSync(p)) return res.status(404).end();
  res.setHeader('Content-Type', doc.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${doc.original_name || 'document'}"`);
  fs.createReadStream(p).pipe(res);
});

router.delete('/customer-documents/:id', requireOwner, requireCsrf, (req, res) => {
  const doc = db.prepare('SELECT * FROM customer_documents WHERE id=?').get(Number(req.params.id));
  if (!doc) return res.status(404).json({ error: 'Not found' });
  try { fs.unlinkSync(path.join(config.dataDir, doc.file_path.replace(/^uploads\//, 'uploads/'))); } catch { /* ignore */ }
  db.prepare('DELETE FROM customer_documents WHERE id=?').run(doc.id);
  audit(req.user.id, 'document_deleted', 'customer_documents', doc.id, { customer: doc.customer_id }, req.ip);
  res.json({ ok: true });
});

/* ============================ PACKAGES ============================ */
router.get('/packages', requireOwner, (req, res) => {
  const inc = req.query.include_archived === '1';
  res.json(db.prepare(`SELECT * FROM packages ${inc ? '' : 'WHERE is_active=1'} ORDER BY price_monthly`).all());
});
router.post('/packages', requireOwner, requireCsrf, express.json(), (req, res) => {
  const b = req.body;
  if (!b.name || !b.download_mbps || !b.price_monthly) return res.status(422).json({ error: 'name, download_mbps and price_monthly required' });
  const info = db.prepare(
    `INSERT INTO packages(name, download_mbps, upload_mbps, price_monthly, install_fee, cycle_days, data_limit_mb, grace_days, device_profile, description)
     VALUES(?,?,?,?,?,?,?,?,?,?)`
  ).run(b.name.trim(), parseInt(b.download_mbps, 10), parseInt(b.upload_mbps, 10) || Math.round(parseInt(b.download_mbps, 10) / 4),
    toPaise(b.price_monthly), toPaise(b.install_fee), parseInt(b.cycle_days, 10) || 30,
    b.data_limit_mb ? parseInt(b.data_limit_mb, 10) : null, parseInt(b.grace_days, 10) || 0,
    b.device_profile || null, b.description || null);
  audit(req.user.id, 'package_created', 'packages', Number(info.lastInsertRowid), { name: b.name }, req.ip);
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});
router.put('/packages/:id', requireOwner, requireCsrf, express.json(), (req, res) => {
  const p = db.prepare('SELECT * FROM packages WHERE id=?').get(Number(req.params.id));
  if (!p) return res.status(404).json({ error: 'Not found' });
  const b = req.body;
  db.prepare(
    `UPDATE packages SET name=?, download_mbps=?, upload_mbps=?, price_monthly=?, install_fee=?, cycle_days=?,
     data_limit_mb=?, grace_days=?, device_profile=?, description=? WHERE id=?`
  ).run(b.name || p.name, parseInt(b.download_mbps, 10) || p.download_mbps, parseInt(b.upload_mbps, 10) || p.upload_mbps,
    toPaise(b.price_monthly ?? p.price_monthly / 100), toPaise(b.install_fee ?? p.install_fee / 100),
    parseInt(b.cycle_days, 10) || p.cycle_days, b.data_limit_mb ? parseInt(b.data_limit_mb, 10) : null,
    parseInt(b.grace_days, 10) ?? p.grace_days, b.device_profile ?? p.device_profile, b.description ?? p.description, p.id);
  audit(req.user.id, 'package_updated', 'packages', p.id, { name: b.name || p.name }, req.ip);
  res.json({ ok: true });
});
router.post('/packages/:id/archive', requireOwner, requireCsrf, (req, res) => {
  const p = db.prepare('SELECT * FROM packages WHERE id=?').get(Number(req.params.id));
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (db.prepare('SELECT COUNT(*) c FROM customers WHERE package_id=? AND archived_at IS NULL').get(p.id).c > 0) {
    return res.status(409).json({ error: 'Package is in use by customers — reassign them first' });
  }
  db.prepare('UPDATE packages SET is_active=0 WHERE id=?').run(p.id);
  audit(req.user.id, 'package_archived', 'packages', p.id, { name: p.name }, req.ip);
  res.json({ ok: true });
});

/* mount ops part (network, finance, devices, settings, reports, audit) */
router.use('/', opRouter);

module.exports = router;

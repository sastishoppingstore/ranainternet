'use strict';
/*
 * Public customer website API: company info, packages, areas,
 * connection applications (rate-limited), and application tracking.
 */
const express = require('express');
const { db } = require('../db');
const { getSetting } = require('../config');
const { toPaise, fmtMoney, validCnic, cleanCnic, cleanPhone, todayPKT, newId, nextSeq } = require('../lib/util');
const { sendNotification, ensureTemplates } = require('../lib/notify');
const { audit } = require('../lib/auth');

const router = express.Router();

/* simple in-memory rate limiter (per IP) */
const buckets = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const b = buckets.get(key) || { count: 0, reset: now + windowMs };
  if (now > b.reset) { b.count = 0; b.reset = now + windowMs; }
  b.count++;
  buckets.set(key, b);
  return b.count <= max;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (now > b.reset) buckets.delete(k);
}, 60000).unref();

router.get('/api/public/company', (req, res) => {
  const s = getSetting('company') || {};
  res.json({
    name: s.name || 'Rana Internet',
    tagline: s.tagline || 'Fiber internet for every home',
    address: s.address || '',
    phone: s.phone || '',
    whatsapp: s.whatsapp || '',
    email: s.email || '',
    logo: s.logo_path ? `/files/public/${s.logo_path}` : null,
    currency: s.currency || 'PKR',
    hours: s.hours || '9:00 AM - 9:00 PM',
  });
});

router.get('/api/public/packages', (req, res) => {
  const rows = db.prepare(
    `SELECT id, name, download_mbps, upload_mbps, price_monthly, install_fee, data_limit_mb, description
     FROM packages WHERE is_active=1 ORDER BY price_monthly`
  ).all();
  res.json(rows.map((r) => ({
    id: r.id,
    name: r.name,
    download: r.download_mbps,
    upload: r.upload_mbps,
    price: r.price_monthly / 100,
    priceText: fmtMoney(r.price_monthly),
    installFee: r.install_fee / 100,
    dataLimit: r.data_limit_mb ? `${r.data_limit_mb >= 1000 ? (r.data_limit_mb / 1000).toLocaleString() + ' GB' : r.data_limit_mb + ' MB'}` : 'Unlimited',
    description: r.description || '',
  })));
});

router.get('/api/public/areas', (req, res) => {
  res.json(db.prepare(`SELECT name, zone FROM areas WHERE is_active=1 ORDER BY name`).all());
});

router.post('/api/public/application', express.json({ limit: '1mb' }), (req, res) => {
  const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
  if (!rateLimit(`app:${ip}`, 5, 60 * 60 * 1000)) {
    return res.status(429).json({ error: 'Too many applications from this network. Please try again later or visit our office.' });
  }
  const b = req.body || {};
  const name = String(b.name || '').trim().slice(0, 80);
  const fatherName = String(b.father_name || '').trim().slice(0, 80);
  const cnic = cleanCnic(b.cnic);
  const phone = cleanPhone(b.phone);
  const whatsapp = cleanPhone(b.whatsapp || b.phone);
  const address = String(b.address || '').trim().slice(0, 300);
  const areaId = parseInt(b.area_id, 10) || null;
  const packageId = parseInt(b.package_id, 10) || null;
  const preferredDate = /^\d{4}-\d{2}-\d{2}$/.test(b.preferred_date || '') ? b.preferred_date : null;
  const notes = String(b.notes || '').trim().slice(0, 500);

  const errors = [];
  if (name.length < 3) errors.push('Full name is required (at least 3 characters).');
  if (!validCnic(cnic)) errors.push('CNIC must be 13 digits (e.g. 42101-1234567-1).');
  if (!/^(\+92|0)?3\d{9}$/.test(phone)) errors.push('A valid mobile number is required (03XX-XXXXXXX).');
  if (address.length < 8) errors.push('Full address with area/mohalla is required.');
  if (errors.length) return res.status(422).json({ error: 'Please fix the following:', errors });

  const dup = db.prepare('SELECT id FROM customers WHERE cnic=? AND archived_at IS NULL').get(cnic);
  if (dup) {
    return res.status(409).json({
      error: 'An account already exists with this CNIC.',
      message: 'Shayad aapka pehle se account maujood hai. Please contact our office at ' + ((getSetting('company') || {}).phone || '') + '.',
    });
  }

  const code = nextSeq(db, 'customers', 'id', 'RI-', 6);
  const ref = newId('APP', 6);
  const info = db.prepare(
    `INSERT INTO customers(customer_code, name, father_name, cnic, phone, whatsapp, address, area_id,
      status, application_ref, application_at, notes)
     VALUES(?,?,?,?,?,?,?,?,'application',?,?,?)`
  ).run(code, name, fatherName, cnic, phone, whatsapp, address, areaId, ref, todayPKT(), `Website application. Preferred date: ${preferredDate || '-'}${notes ? ' | ' + notes : ''}`);
  const customerId = Number(info.lastInsertRowid);

  const appInfo = db.prepare(
    `INSERT INTO applications(ref, customer_id, requested_package_id, channel, source_ip, status)
     VALUES(?,?,?,?, 'website', 'new')`
  ).run(ref, customerId, packageId, ip);

  const pkg = packageId ? db.prepare('SELECT name FROM packages WHERE id=?').get(packageId) : null;
  try {
    sendNotification({
      templateKey: 'application_received',
      customerId, toAddress: whatsapp,
      vars: { customer_name: name, ref },
    });
  } catch { /* non-fatal */ }
  audit(null, 'application_created', 'applications', Number(appInfo.lastInsertRowid),
    { ref, customer: name, phone, channel: 'website', pkg: pkg?.name || null }, ip);

  res.status(201).json({
    ref,
    message: 'Application received! Our team will contact you within 24 hours for a site survey.',
  });
});

/** Track an application by reference + phone (no full PII exposure). */
router.get('/api/public/track/:ref', (req, res) => {
  const ref = String(req.params.ref || '').toUpperCase();
  const phone = cleanPhone(req.query.phone);
  const app = db.prepare('SELECT * FROM applications WHERE UPPER(ref)=?').get(ref);
  if (!app) return res.status(404).json({ error: 'Application not found. Check your reference code.' });
  const c = db.prepare('SELECT * FROM customers WHERE id=?').get(app.customer_id);
  if (c.phone !== phone) {
    return res.status(403).json({ error: 'Phone number does not match this application.' });
  }
  const statusMap = {
    new: { label: 'Received', detail: 'Your application is under review.' },
    surveyed: { label: 'Surveyed', detail: 'Site survey completed. Installation is being scheduled.' },
    in_installation: { label: 'Installation Scheduled', detail: 'Our technician is assigned. We will call before installation.' },
    completed: { label: 'Installation Completed', detail: 'Connection installed. Activation in progress.' },
    activated: { label: 'ACTIVE — Enjoy!', detail: 'Your connection is active. First bill will be generated on your billing date.' },
    rejected: { label: 'Not Approved', detail: 'Unfortunately your application could not be approved.' + (app.reject_reason ? ' Reason: ' + app.reject_reason : '') },
  };
  const s = statusMap[app.status] || { label: app.status, detail: '' };
  res.json({ ref: app.ref, status: app.status, label: s.label, detail: s.detail, appliedOn: app.created_at.slice(0, 10) });
});

module.exports = router;

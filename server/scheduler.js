'use strict';
/*
 * Scheduler: runs in-process.
 *  - hourly:  device command worker tick + device polling (if enabled)
 *  - daily:   invoice generation, due reminders, auto-suspend, database backup
 * Timestamps tracked in settings so restarts don't double-run a day's jobs.
 */
const { db } = require('./db');
const { getSetting, setSetting, config } = require('./config');
const { todayPKT, fmtMoney, toPaise } = require('./lib/util');
const { generateDueInvoices, outstandingInvoices } = require('./lib/billing');
const { sendNotification } = require('./lib/notify');
const { tickCommands, pollDevice, safeModeOn } = require('./lib/devices');
const { audit } = require('./lib/auth');

const state = { hourlyAt: 0 };

function lastRun(key) {
  try {
    const r = JSON.parse(db.prepare('SELECT value FROM settings WHERE key=?').get(`sched:${key}`)?.value || 'null');
    return r || null;
  } catch { return null; }
}
function markRun(key) {
  setSetting(`sched:${key}`, todayPKT());
}

function runInvoices() {
  const created = generateDueInvoices();
  if (created.length) {
    console.log(`[scheduler] generated ${created.length} invoices`);
    for (const inv of created) {
      try {
        sendNotification({
          templateKey: 'invoice_issued',
          customerId: inv.customer_id,
          toAddress: null,
          vars: {
            customer_name: inv.customer.name,
            invoice_no: inv.invoice_no,
            amount: fmtMoney(inv.total),
            due_date: inv.due_date,
            package_name: '',
          },
        });
      } catch { /* log-only */ }
    }
  }
  return created.length;
}

function runReminders() {
  const today = todayPKT();
  const rows = outstandingInvoices();
  let count = 0;
  for (const r of rows) {
    if (r.due_date === today) {
      sendNotification({ templateKey: 'reminder_due', customerId: r.customer_id, toAddress: r.whatsapp || r.phone, vars: { customer_name: r.name, invoice_no: r.invoice_no, amount: fmtMoney(r.balance) } });
      count++;
    } else if (r.days_overdue === 1) {
      sendNotification({ templateKey: 'reminder_overdue', customerId: r.customer_id, toAddress: r.whatsapp || r.phone, vars: { customer_name: r.name, invoice_no: r.invoice_no, amount: fmtMoney(r.balance), days_overdue: r.days_overdue } });
      count++;
    }
  }
  return count;
}

function runAutoSuspend() {
  const cfg = getSetting('automation') || {};
  if (cfg.auto_suspend !== true || !cfg.auto_suspend_days) return 0;
  const today = todayPKT();
  const rows = outstandingInvoices().filter((r) =>
    r.cstatus === 'active' && r.days_overdue > cfg.auto_suspend_days
  );
  const exceptAreas = cfg.suspend_exempt_areas || [];
  let count = 0;
  for (const r of rows) {
    if (r.area_id && exceptAreas.includes(r.area_id)) continue;
    db.prepare(`UPDATE customers SET status='suspended', updated_at=datetime('now') WHERE id=? AND status='active'`).run(r.customer_id);
    audit(null, 'status_change', 'customers', r.customer_id, { status: 'suspended', reason: `auto-suspend after ${cfg.auto_suspend_days} overdue days (invoice ${r.invoice_no})` });
    try {
      sendNotification({ templateKey: 'suspended', customerId: r.customer_id, toAddress: r.whatsapp || r.phone, vars: { customer_name: r.name, amount: fmtMoney(r.balance) } });
      const cu = db.prepare('SELECT pppoe_username FROM customers WHERE id=?').get(r.customer_id);
      if (cu?.pppoe_username && !safeModeOn()) {
        tickCommands(); // queue handled next tick
        require('./lib/devices').queueCommand({ driver: 'mock', customerId: r.customer_id, action: 'disable_user', source: 'auto_suspend' });
        tickCommands();
      }
    } catch { /* manual fallback: status already changed */ }
    count++;
  }
  return count;
}

function runBackup() {
  const { backup } = require('node:sqlite');
  const fs = require('fs');
  const path = require('path');
  const file = path.join(config.dataDir, 'backups', `backup-${todayPKT()}-${Date.now()}.sqlite`);
  return backup(db, file).then(() => {
    // retention: keep latest N
    const N = (getSetting('backup') || {}).retention || 14;
    const files = fs.readdirSync(path.join(config.dataDir, 'backups')).filter((f) => f.endsWith('.sqlite')).sort();
    while (files.length > N) {
      fs.unlinkSync(path.join(config.dataDir, 'backups', files.shift()));
    }
    console.log('[scheduler] backup written:', file);
    return file;
  }).catch((e) => {
    console.error('[scheduler] backup failed:', e.message);
    return null;
  });
}

async function tickHourly() {
  const now = Date.now();
  if (now - state.hourlyAt < 60000) return;
  state.hourlyAt = now;

  // command worker — every minute
  tickCommands();

  // device polling every 5 min when devices enabled and mode B
  const devCfg = getSetting('devices') || {};
  if (devCfg.poll_enabled) {
    const devices = db.prepare(`SELECT id FROM devices WHERE status='enabled'`).all();
    for (const d of devices) await pollDevice(d.id);
  }
}

async function tickDaily() {
  const today = todayPKT();
  if (lastRun('invoices') !== today) {
    try { runInvoices(); markRun('invoices'); } catch (e) { console.error('[scheduler] invoices:', e.message); }
  }
  if (lastRun('reminders') !== today) {
    try { runReminders(); markRun('reminders'); } catch (e) { console.error('[scheduler] reminders:', e.message); }
  }
  if (lastRun('autosuspend') !== today) {
    try { runAutoSuspend(); markRun('autosuspend'); } catch (e) { console.error('[scheduler] autosuspend:', e.message); }
  }
  if (lastRun('backup') !== today) {
    await runBackup();
    markRun('backup');
  }
}

let started = false;
function startScheduler() {
  if (started) return () => {};
  started = true;
  const h = setInterval(() => tickHourly().catch(() => {}), 60000);
  const d = setInterval(() => tickDaily().catch(() => {}), 15 * 60000);
  // run daily jobs once on startup (idempotent via lastRun)
  setTimeout(() => tickDaily().catch(() => {}), 5000);
  setTimeout(() => tickHourly().catch(() => {}), 2000);
  console.log('[scheduler] started (hourly device tick, daily billing/reminders/suspend/backup)');
  return () => { clearInterval(h); clearInterval(d); };
}

module.exports = { startScheduler, runInvoices, runReminders, runAutoSuspend, runBackup };

'use strict';
/*
 * Notification templates + provider adapters.
 * Provider "manual" (default): messages are rendered and stored in
 * notification_logs with status 'manual' — the owner copies/shares them.
 * No automated delivery is claimed unless a real provider adapter is configured.
 */
const { db } = require('../db');

const DEFAULT_TEMPLATES = [
  ['invoice_issued', 'Invoice Issued', 'whatsapp', '',
   'Assalam-o-Alaikum {customer_name}, invoice {invoice_no} of {amount} for Rana Internet is due on {due_date}. Package: {package_name}. Please pay on time. Shukriya!'],
  ['reminder_before_due', 'Reminder (Before Due)', 'whatsapp', '',
   'Reminder: your Rana Internet bill {amount} (invoice {invoice_no}) is due on {due_date}. Pay via JazzCash/Easypaisa/Raast to avoid service interruption.'],
  ['reminder_due', 'Reminder (Due Date)', 'whatsapp', '',
   'Your Rana Internet bill {amount} (invoice {invoice_no}) is due today. Please pay at your earliest convenience.'],
  ['reminder_overdue', 'Overdue Notice', 'whatsapp', '',
   'Dear {customer_name}, your Rana Internet bill {amount} (invoice {invoice_no}) is {days_overdue} days overdue. Service may be suspended after the grace period.'],
  ['payment_approved', 'Payment Confirmed', 'whatsapp', '',
   'Payment of {amount} received and approved for {customer_name}. Thank you for choosing Rana Internet.'],
  ['payment_rejected', 'Payment Rejected', 'whatsapp', '',
   'Your payment of {amount} could not be approved. Reason: {reason}. Please contact Rana Internet office.'],
  ['suspended', 'Service Suspended', 'whatsapp', '',
   'Dear {customer_name}, your Rana Internet service has been suspended due to overdue bill {amount}. Pay to reactivate.'],
  ['reactivated', 'Service Reactivated', 'whatsapp', '',
   'Good news {customer_name}! Your Rana Internet service has been reactivated. Enjoy your connection.'],
  ['application_received', 'Application Received', 'whatsapp', '',
   'Shukriya {customer_name}! Your Rana Internet application {ref} is received. Our team will contact you soon for the survey.'],
  ['application_approved', 'Application Approved', 'whatsapp', '',
   'Khushamabadi {customer_name}! Your Rana Internet connection is approved. Installation will be scheduled shortly.'],
  ['area_fault', 'Area Fault Notice', 'whatsapp', '',
   'Dear customer, there is a fiber fault in {area_name}. Our team is working on it. Expected restoration: {eta}. Sorry for the inconvenience.'],
];

function ensureTemplates() {
  const ins = db.prepare(
    'INSERT OR IGNORE INTO notification_templates(tkey, name, channel, subject, body) VALUES(?,?,?,?,?)'
  );
  for (const t of DEFAULT_TEMPLATES) ins.run(...t);
}

function render(template, vars) {
  let out = String(template || '');
  for (const [k, v] of Object.entries(vars || {})) out = out.replaceAll(`{${k}}`, v == null ? '' : String(v));
  return out;
}

function getTemplate(key) {
  return db.prepare('SELECT * FROM notification_templates WHERE tkey=?').get(key);
}

/**
 * Send a notification through the configured provider.
 * Returns the log row. Provider 'manual' always (default) — message text is
 * produced for the owner to copy/share; logs are kept for history.
 */
function sendNotification({ templateKey, vars = {}, toAddress = null, customerId = null, channel = null, bodyOverride = null }) {
  const cfg = safeGet('notifications') || {};
  const provider = cfg.provider || 'manual';
  const tpl = getTemplate(templateKey);
  const body = bodyOverride || (tpl ? render(tpl.body, vars) : '');
  const ch = channel || (tpl ? tpl.channel : 'manual');
  let status = 'manual';
  let response = 'No delivery provider configured — message logged for manual delivery.';
  if (provider !== 'manual') {
    // Future adapters (twilio_sms / whatsapp_cloud / smtp) plug in here.
    // Until configured, we must NOT claim automated delivery.
    status = 'manual';
    response = `Provider "${provider}" selected but no credentials configured — message logged for manual delivery.`;
  }
  const info = db.prepare(
    `INSERT INTO notification_logs(template_key, channel, to_address, customer_id, body, status, provider_response)
     VALUES(?,?,?,?,?,?,?)`
  ).run(templateKey, ch, toAddress, customerId, body, status, response);
  return { id: Number(info.lastInsertRowid), body, status };
}

function safeGet(key) {
  try { return require('../config').getSetting(key); } catch { return null; }
}

module.exports = { ensureTemplates, render, getTemplate, sendNotification };

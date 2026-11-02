'use strict';
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'backups'), { recursive: true });

const config = {
  root: ROOT,
  dataDir: DATA_DIR,
  dbFile: process.env.DB_FILE || path.join(DATA_DIR, 'rana.sqlite'),
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  baseUrl: process.env.BASE_URL || 'http://localhost:3000',
  sessionDays: parseInt(process.env.SESSION_DAYS || '14', 10),
  timezone: 'Asia/Karachi',
  currency: 'PKR',
  maxUploadBytes: 5 * 1024 * 1024,
  // demo seed flag — seed data is clearly labeled; set SEED_DEMO=0 to start empty
  seedDemo: (process.env.SEED_DEMO || '1') !== '0',
};

// APP_SECRET: required for credential encryption + session hardening.
// In production set it via environment. In dev we persist a generated one.
if (!process.env.APP_SECRET) {
  const secretFile = path.join(DATA_DIR, '.dev_secret');
  let secret;
  try { secret = fs.readFileSync(secretFile, 'utf8').trim(); } catch { secret = null; }
  if (!secret) {
    secret = require('crypto').randomBytes(32).toString('hex');
    fs.writeFileSync(secretFile, secret, { mode: 0o600 });
    console.warn('[config] APP_SECRET not set — generated a development secret at data/.dev_secret (set APP_SECRET in production)');
  }
  process.env.APP_SECRET = secret;
}

function getSetting(key, fallback = null) {
  try {
    const { db } = require('./db');
    const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
    if (!row) return fallback;
    return JSON.parse(row.value);
  } catch {
    return fallback;
  }
}
function setSetting(key, value) {
  const { db } = require('./db');
  db.prepare(
    'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
  ).run(key, JSON.stringify(value));
}

module.exports = { config, getSetting, setSetting };

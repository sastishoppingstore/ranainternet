'use strict';
const crypto = require('crypto');
const { db, tx } = require('../db');
const { config, getSetting } = require('../config');
const { nowUTC } = require('./util');

/* ---------------- password hashing (scrypt) ---------------- */
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}
function verifyPassword(pw, stored) {
  try {
    const [scheme, salt, hash] = String(stored).split(':');
    if (scheme !== 'scrypt') return false;
    const test = crypto.scryptSync(pw, salt, 64);
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), test);
  } catch { return false; }
}

/* ---------------- TOTP (RFC 6238) ---------------- */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(buf) {
  let bits = 0, val = 0, out = '';
  for (const b of buf) {
    val = (val << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
function base32Decode(s) {
  s = s.replace(/=+$/, '').toUpperCase();
  let bits = 0, val = 0; const out = [];
  for (const ch of s) {
    const idx = B32.indexOf(ch);
    if (idx < 0) continue;
    val = (val << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}
function totpCode(secret, step = 30, digits = 6, time = Date.now()) {
  const counter = Math.floor(time / 1000 / step);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const off = h[h.length - 1] & 0x0f;
  const code = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(code % 10 ** digits).padStart(digits, '0');
}
function verifyTotp(secret, code, window = 1) {
  const now = Date.now();
  for (let w = -window; w <= window; w++) {
    if (totpCode(secret, 30, 6, now + w * 30000) === String(code).padStart(6, '0')) return true;
  }
  return false;
}

/* ---------------- device secret encryption (AES-256-GCM) ---------------- */
function secretKey() {
  const k = process.env.APP_SECRET;
  if (!k) throw new Error('APP_SECRET env var is required');
  return crypto.createHash('sha256').update(k).digest();
}
function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', secretKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${enc.toString('hex')}`;
}
function decryptSecret(stored) {
  if (!stored) return null;
  try {
    const [ivHex, tagHex, dataHex] = String(stored).split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', secretKey(), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
  } catch { return null; }
}

/* ---------------- audit log ---------------- */
function audit(userId, action, entity = null, entityId = null, details = null, ip = null) {
  const n = (v) => (v === undefined ? null : v);
  try {
    db.prepare(
      'INSERT INTO audit_logs(user_id, action, entity, entity_id, details, ip) VALUES(?,?,?,?,?,?)'
    ).run(n(userId), action, n(entity), entityId == null ? null : String(entityId),
      details ? JSON.stringify(details) : null, n(ip));
  } catch (e) {
    console.error('[audit] failed to write audit log:', e.message);
  }
}

/* ---------------- sessions ---------------- */
function createSession(userId, ip) {
  const token = crypto.randomBytes(32).toString('hex');
  const csrf = crypto.randomBytes(24).toString('hex');
  const expires = new Date(Date.now() + config.sessionDays * 86400000).toISOString().replace('T', ' ').slice(0, 19);
  db.prepare('INSERT INTO sessions(token, user_id, csrf, ip, expires_at) VALUES(?,?,?,?,?)')
    .run(token, userId, csrf, ip, expires);
  return { token, csrf, expires };
}
function getSession(token) {
  if (!token) return null;
  const row = db.prepare(
    `SELECT s.*, u.email, u.name, u.totp_enabled, u.id AS id FROM sessions s
     JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?`
  ).get(token, nowUTC());
  return row || null;
}
function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token=?').run(token);
}
function rotateCsrf(token) {
  const csrf = crypto.randomBytes(24).toString('hex');
  db.prepare('UPDATE sessions SET csrf=? WHERE token=?').run(csrf, token);
  return csrf;
}

/* ---------------- login throttling ---------------- */
const THROTTLE_WINDOW = 15 * 60 * 1000;
const THROTTLE_MAX = 10;
function loginBlocked(ip) {
  const cutoff = new Date(Date.now() - THROTTLE_WINDOW).toISOString().replace('T', ' ').slice(0, 19);
  const row = db.prepare('SELECT COUNT(*) c FROM login_attempts WHERE ip=? AND at>?').get(ip, cutoff);
  return row.c >= THROTTLE_MAX;
}
function recordFailedLogin(ip) {
  db.prepare('INSERT INTO login_attempts(ip, at) VALUES(?,?)').run(ip, nowUTC());
}

/* ---------------- middleware ---------------- */
function cookie(req) {
  const raw = req.headers.cookie || '';
  const out = {};
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function requireOwner(req, res, next) {
  const session = getSession(cookie(req).rana_session);
  if (!session) return res.status(401).json({ error: 'Not authenticated' });
  req.user = session;
  req.sessionToken = cookie(req).rana_session;
  next();
}

function requireCsrf(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const session = getSession(cookie(req).rana_session);
  const token = req.headers['x-csrf-token'] || (req.body && req.body._csrf);
  if (!session || !token || token !== session.csrf) {
    return res.status(403).json({ error: 'CSRF token missing or invalid' });
  }
  next();
}

module.exports = {
  hashPassword, verifyPassword,
  totpCode, verifyTotp, base32Encode,
  encryptSecret, decryptSecret,
  audit,
  createSession, getSession, destroySession, rotateCsrf,
  loginBlocked, recordFailedLogin,
  requireOwner, requireCsrf, cookie,
};

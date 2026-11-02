'use strict';
const crypto = require('crypto');

const TZ = 'Asia/Karachi';

/** Money helpers — all amounts are integer paise (1 PKR = 100). */
const toPaise = (v) => Math.round((Number(v) || 0) * 100);
const fmtMoney = (paise, currency = 'PKR') =>
  `${currency} ${((paise || 0) / 100).toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

const TZ_FMT = (opts) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, ...opts });
const dateFmt = TZ_FMT({ year: 'numeric', month: '2-digit', day: '2-digit' });
const dateTimeFmt = TZ_FMT({ year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

/** Today's date YYYY-MM-DD in Asia/Karachi. */
function todayPKT(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const g = (t) => parts.find((p) => p.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}
function nowUTC() { return new Date().toISOString().replace('T', ' ').slice(0, 19); }
function fmtDate(s) { return s ? dateFmt.format(new Date(s.endsWith('Z') || s.includes('+') ? s : s + 'Z').toString().replace(' ', 'T')) : ''; }
function fmtDateTime(s) { return s ? dateTimeFmt.format(new Date(s.endsWith('Z') || s.includes('+') ? s : s + 'Z').toString().replace(' ', 'T')) : ''; }

function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function newId(prefix, len = 8) {
  return `${prefix}-${crypto.randomBytes(Math.ceil(len / 2)).toString('hex').slice(0, len).toUpperCase()}`;
}

function nextSeq(db, table, column, prefix, width = 6) {
  const row = db.prepare(`SELECT COUNT(*) c FROM ${table}`).get();
  return `${prefix}${String(row.c + 1).padStart(width, '0')}`;
}

function cleanPhone(p) { return String(p || '').replace(/[^\d+]/g, '').slice(0, 20); }
function cleanCnic(c) { return String(c || '').replace(/\D/g, '').slice(0, 13); }
const validCnic = (c) => /^\d{13}$/.test(cleanCnic(c));

/** CSV helpers */
function toCsv(rows, columns) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map((c) => esc(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => esc(typeof c.get === 'function' ? c.get(r) : r[c.key ?? c.label])).join(',')).join('\n');
  return head + '\n' + body;
}
function parseCsv(text) {
  const rows = [];
  let row = [], cur = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}

const UPLOAD_TYPES = {
  'image/jpeg': { ext: 'jpg', magic: [0xff, 0xd8] },
  'image/png': { ext: 'png', magic: [0x89, 0x50, 0x4e, 0x47] },
  'image/webp': { ext: 'webp', magic: [0x52, 0x49, 0x46, 0x46] },
  'application/pdf': { ext: 'pdf', magic: [0x25, 0x50, 0x44, 0x46] },
};
function sniffMime(buf) {
  for (const [mime, info] of Object.entries(UPLOAD_TYPES)) {
    if (info.magic.every((b, i) => buf[i] === b)) return mime;
  }
  return null;
}

module.exports = {
  TZ, toPaise, fmtMoney, fmtDate, fmtDateTime, todayPKT, nowUTC,
  daysBetween, addDays, newId, nextSeq, cleanPhone, cleanCnic, validCnic,
  toCsv, parseCsv, UPLOAD_TYPES, sniffMime,
};

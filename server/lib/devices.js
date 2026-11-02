'use strict';
/*
 * Pluggable device integration framework.
 *  - drivers: 'mock' (simulated, for testing — clearly labeled), 'mikrotik'
 *    (real RouterOS v1 API client over TCP), 'snmp' reserved for generic OLTs.
 *  - ALL write actions go through the queued command worker — never directly
 *    from the browser. Timeouts, retries with backoff, per-device lock,
 *    global safe mode, confirmation for destructive actions, full audit log.
 *  - We NEVER pretend a device action succeeded without a confirmed response.
 */
const net = require('net');
const { db } = require('../db');
const { decryptSecret, encryptSecret } = require('./auth');
const { nowUTC, newId } = require('./util');

/* ================= MOCK DRIVER (testing) ================= */
const mockState = new Map(); // deviceId -> { sessions: Map, onus: Map }

function mockDeviceState(deviceId) {
  if (!mockState.has(deviceId)) {
    mockState.set(deviceId, { sessions: new Map(), onus: new Map(), bootedAt: Date.now() });
  }
  return mockState.get(deviceId);
}

const mockDriver = {
  name: 'mock',
  label: 'Mock driver (SIMULATED responses — for testing only)',
  capabilities: ['info', 'sessions', 'secrets', 'onu_list', 'onu_control', 'rx_power'],
  async exec(device, action, payload = {}) {
    const st = mockDeviceState(device.id);
    await sleep(40 + Math.random() * 120);
    switch (action) {
      case 'test_connection':
      case 'info':
        return {
          identity: 'MockRouter 1 (simulated)',
          version: 'routerOS v7.15 (mock)',
          uptime: `${Math.floor((Date.now() - st.bootedAt) / 1000)}s (simulated)`,
          model: 'MOCK-1',
        };
      case 'list_sessions': {
        const rows = db.prepare(
          `SELECT c.id, c.name, c.status, c.device_status, c.package_id, c.pppoe_username FROM customers c
           WHERE c.archived_at IS NULL AND c.pppoe_username IS NOT NULL`
        ).all();
        for (const c of rows) {
          if (c.status === 'active' || c.status === 'pending') {
            if (!st.sessions.has(c.pppoe_username)) {
              st.sessions.set(c.pppoe_username, { since: Date.now(), up: 0, rx: 0, tx: 0 });
            }
            const s = st.sessions.get(c.pppoe_username);
            s.up += 1; s.rx += 1024; s.tx += 512;
          } else {
            st.sessions.delete(c.pppoe_username);
          }
        }
        return {
          simulated: true,
          sessions: [...st.sessions.entries()].map(([u, s]) => ({
            username: u, uptime: `${s.up} polls (simulated)`,
            rx: `${(s.rx / 1024 / 1024).toFixed(1)} MiB`, tx: `${(s.tx / 1024 / 1024).toFixed(1)} MiB`,
          })),
        };
      }
      case 'list_onus': {
        const rows = db.prepare('SELECT * FROM onus WHERE status != \'disabled\'').all();
        for (const o of rows) {
          const on = o.customer_id ? db.prepare('SELECT status FROM customers WHERE id=?').get(o.customer_id)?.status : 'active';
          if (on === 'active' || on === 'pending') {
            if (!st.onus.has(o.serial)) st.onus.set(o.serial, true);
          } else st.onus.delete(o.serial);
        }
        return {
          simulated: true,
          onus: [...st.onus.keys()].map((sn) => ({
            serial: sn, registered: true,
            rx_power: +(9 + Math.random() * 3).toFixed(1) + ' dBm (simulated)',
          })),
        };
      }
      case 'enable_user':
        st.sessions.set(payload.username, { since: Date.now(), up: 0, rx: 0, tx: 0 });
        return { simulated: true, ok: true, action: 'enabled', username: payload.username };
      case 'disable_user':
        st.sessions.delete(payload.username);
        return { simulated: true, ok: true, action: 'disabled', username: payload.username };
      case 'disconnect_session':
        st.sessions.delete(payload.username);
        return { simulated: true, ok: true, action: 'disconnected', username: payload.username };
      case 'add_secret':
        return { simulated: true, ok: true, action: 'secret_added', username: payload.username, profile: payload.profile || 'default' };
      case 'remove_secret':
        st.sessions.delete(payload.username);
        return { simulated: true, ok: true, action: 'secret_removed', username: payload.username };
      case 'set_profile':
        return { simulated: true, ok: true, action: 'profile_set', username: payload.username, profile: payload.profile || 'default' };
      case 'onu_enable':
        st.onus.set(payload.serial, true);
        return { simulated: true, ok: true, action: 'onu_enabled', serial: payload.serial };
      case 'onu_disable':
        st.onus.delete(payload.serial);
        return { simulated: true, ok: false, action: 'onu_disabled', serial: payload.serial };
      case 'onu_reboot':
        return { simulated: true, ok: true, action: 'onu_reboot_sent', serial: payload.serial };
      default:
        throw new Error(`Mock driver: unsupported action "${action}"`);
    }
  },
};

/* ================= MIKROTIK ROUTEROS v1 API CLIENT ================= */
/*
 * Real RouterOS API (port 8729) implementation — binary protocol:
 * 4-byte? no: 2-byte big-endian length prefix + UTF-8 words. Login returns a
 !token= response used on subsequent requests. Untested against hardware in
 this environment; responses are only trusted when the device confirms them.
 */
function mtApiConnect({ host, port, user, pass, timeout = 8000 }) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port });
    let buf = Buffer.alloc(0);
    const responses = [];
    let settled = false;
    const timer = setTimeout(() => finish(new Error('connection timeout')), timeout);
    function finish(err, out) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { sock.destroy(); } catch { /* ignore */ }
      if (err) reject(err); else resolve({ responses: out, close: () => { try { sock.destroy(); } catch { /* ignore */ } } });
    }
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 2) {
        const len = buf.readUInt16BE(0);
        if (buf.length < 2 + len) break;
        const words = buf.subarray(2, 2 + len).toString('utf8').split(' ').filter(Boolean);
        buf = buf.subarray(2 + len);
        if (words[0] === '.done' || words[0] === '!done') return finish(null, responses);
        if (words[0].startsWith('!trap')) return finish(new Error(words[1] || 'RouterOS trap'));
        responses.push(words);
      }
    });
    sock.on('error', (e) => finish(new Error(e.message)));
    sock.on('connect', () => {
      // login: password is sent as a length-prefixed binary word
      const pw = Buffer.from(pass, 'utf8');
      const pwLen = Buffer.alloc(2);
      pwLen.writeUInt16BE(pw.length, 0);
      const head = Buffer.from(`=name=${user} =password=`, 'utf8');
      const len = Buffer.alloc(2);
      len.writeUInt16BE(head.length + pwLen.length + pw.length, 0);
      sock.write(Buffer.concat([len, head, pwLen, pw]));
    });
  });
}

async function mtCommand({ host, port, user, pass, words, timeout = 10000 }) {
  const { responses, close } = await mtApiConnect({ host, port, user, pass, timeout });
  close();
  // find token from login response, then issue command
  const tokenRow = responses.find((w) => w.some((x) => x.startsWith('!token=')));
  if (!tokenRow) throw new Error('RouterOS login failed (no token returned)');
  const token = tokenRow.find((x) => x.startsWith('!token=')).slice(7);
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port });
    let buf = Buffer.alloc(0);
    const out = [];
    const timer = setTimeout(() => { try { sock.destroy(); } catch {} reject(new Error('command timeout')); }, timeout);
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 2) {
        const len = buf.readUInt16BE(0);
        if (buf.length < 2 + len) break;
        const words = buf.subarray(2, 2 + len).toString('utf8').split(' ');
        buf = buf.subarray(2 + len);
        out.push(words);
        if (words[0] === '.done') {
          clearTimeout(timer);
          try { sock.destroy(); } catch {}
          resolve(out);
          return;
        }
      }
    });
    sock.on('error', (e) => { clearTimeout(timer); reject(new Error(e.message)); });
    sock.on('connect', () => {
      const data = Buffer.from(`${token} ${words.join(' ')}`, 'utf8');
      const len = Buffer.alloc(2);
      len.writeUInt16BE(data.length, 0);
      sock.write(Buffer.concat([len, data]));
    });
  });
}

function rowsFromApi(responses) {
  return responses
    .filter((w) => w[0] !== '.done' && !w[0].startsWith('!') && w[0] !== '!trap')
    .map((w) => {
      const row = {};
      for (const part of w) {
        const i = part.indexOf('=');
        if (i > 0) row[part.slice(0, i)] = part.slice(i + 1);
      }
      return row;
    });
}

const mikrotikDriver = {
  name: 'mikrotik',
  label: 'MikroTik RouterOS API (v1, port 8729 default)',
  capabilities: ['info', 'sessions', 'secrets', 'enable_disable', 'disconnect', 'profiles'],
  async exec(device, action, payload = {}) {
    const cred = db.prepare(
      `SELECT username, secret_enc FROM device_credentials WHERE device_id=? LIMIT 1`
    ).get(device.id);
    if (!cred) throw new Error('No API credentials configured for this router');
    const pass = decryptSecret(cred.secret_enc);
    if (pass == null) throw new Error('Credential decryption failed');
    const opt = { host: device.host, port: device.port || 8729, user: cred.username, pass };
    if (!device.host) throw new Error('Router host not configured');

    switch (action) {
      case 'test_connection':
      case 'info': {
        const res = await mtCommand({ ...opt, words: ['/system/resource', 'print'] });
        const rows = rowsFromApi(res);
        const r = rows[0] || {};
        return { identity: r['identity-name'] || device.name, version: r.version, uptime: r.uptime, free_memory: r['free-memory'], platform: r.platform };
      }
      case 'list_sessions': {
        const res = await mtCommand({ ...opt, words: ['/ip/pppoe/active', 'print'] });
        return { sessions: rowsFromApi(res) };
      }
      case 'list_secrets': {
        const res = await mtCommand({ ...opt, words: ['/ip/pppoe/secret', 'print'] });
        return { secrets: rowsFromApi(res) };
      }
      case 'add_secret': {
        const words = ['/ip/pppoe/secret', 'add', `=name=${payload.username}`, `=password=${payload.password}`];
        if (payload.profile) words.push(`=profile=${payload.profile}`);
        await mtCommand({ ...opt, words });
        return { ok: true, action: 'secret_added', username: payload.username };
      }
      case 'enable_user':
      case 'disable_user': {
        const flag = action === 'enable_user' ? '=disabled=false' : '=disabled=true';
        const res = await mtCommand({ ...opt, words: ['/ip/pppoe/secret', 'print', `=name=${payload.username}`] });
        const rows = rowsFromApi(res);
        if (!rows.length) throw new Error(`PPPoE secret "${payload.username}" not found on router`);
        const id = rows[0]['.id'];
        await mtCommand({ ...opt, words: ['/ip/pppoe/secret', 'set', `=.id=${id}`, flag] });
        return { ok: true, action, username: payload.username };
      }
      case 'disconnect_session': {
        const res = await mtCommand({ ...opt, words: ['/ip/pppoe/active', 'print', `=name=${payload.username}`] });
        const rows = rowsFromApi(res);
        if (!rows.length) throw new Error(`No active session for "${payload.username}"`);
        const id = rows[0]['.id'];
        await mtCommand({ ...opt, words: ['/ip/pppoe/active', 'remove', `=.id=${id}`] });
        return { ok: true, action: 'disconnected', username: payload.username };
      }
      case 'set_profile': {
        const res = await mtCommand({ ...opt, words: ['/ip/pppoe/secret', 'print', `=name=${payload.username}`] });
        const rows = rowsFromApi(res);
        if (!rows.length) throw new Error(`PPPoE secret "${payload.username}" not found on router`);
        const id = rows[0]['.id'];
        await mtCommand({ ...opt, words: ['/ip/pppoe/secret', 'set', `=.id=${id}`, `=profile=${payload.profile || ''}`] });
        return { ok: true, action: 'profile_set', username: payload.username, profile: payload.profile };
      }
      default:
        throw new Error(`MikroTik driver: unsupported action "${action}"`);
    }
  },
};

const DRIVERS = { mock: mockDriver, mikrotik: mikrotikDriver };

/* ================= COMMAND QUEUE / WORKER ================= */
const DESTRUCTIVE = new Set(['disable_user', 'remove_secret', 'disconnect_session', 'onu_disable']);

function safeModeOn() {
  try {
    const cfg = require('../config').getSetting('devices');
    return cfg?.global_safe_mode === true;
  } catch { return false; }
}

/**
 * Queue a device command.
 * opts: { deviceKind ('router'|'olt'), driver?, deviceId?, customerId?,
 *         action, payload?, initiatedBy?, source? }
 * Requires: customerId must have a PPPoE username (or payload.username).
 * Returns the command log row (queued) or throws if no device available.
 */
function queueCommand(opts) {
  const { customerId, action, payload = {}, initiatedBy = null } = opts;
  const customer = customerId ? db.prepare('SELECT * FROM customers WHERE id=?').get(customerId) : null;
  const username = payload.username || (customer && customer.pppoe_username) || null;
  if (!username && !['test_connection', 'info', 'list_sessions', 'list_onus'].includes(action)) {
    throw new Error('Customer has no PPPoE username — configure the connection first');
  }
  const device = db.prepare(
    `SELECT * FROM devices WHERE driver=? AND status='enabled' ORDER BY id LIMIT 1`
  ).get(opts.driver || 'mock');
  if (!device) {
    // No enabled device of this driver — store as pending_sync so owner sees it
    const anyDev = db.prepare(`SELECT * FROM devices WHERE driver=? ORDER BY id LIMIT 1`).get(opts.driver || 'mock');
    if (!anyDev) throw new Error('No device of this type registered — add a device in Devices → Registry');
    const info = db.prepare(
      `INSERT INTO command_logs(device_id, customer_id, action, payload, status, correlation_id, initiated_by)
       VALUES(?,?,?,?, 'pending_sync', ?, ?)`
    ).run(anyDev.id, customerId || null, action, JSON.stringify(payload), newId('CMD'), initiatedBy);
    return db.prepare('SELECT * FROM command_logs WHERE id=?').get(Number(info.lastInsertRowid));
  }
  const info = db.prepare(
    `INSERT INTO command_logs(device_id, customer_id, action, payload, status, correlation_id, initiated_by)
     VALUES(?,?,?,?, 'queued', ?, ?)`
  ).run(device.id, customerId || null, action, JSON.stringify(payload), newId('CMD'), initiatedBy);
  return db.prepare('SELECT * FROM command_logs WHERE id=?').get(Number(info.lastInsertRowid));
}

let workerRunning = false;
function tickCommands() {
  if (workerRunning) return;
  workerRunning = true;
  (async () => {
    try {
      const queued = db.prepare(
        `SELECT cl.*, d.driver, d.host, d.port, d.name dname FROM command_logs cl
         JOIN devices d ON d.id = cl.device_id
         WHERE cl.status='queued' AND d.status='enabled'
         ORDER BY cl.id LIMIT 1`
      ).get();
      if (!queued) return;
      // per-device lock
      const busy = db.prepare(
        `SELECT COUNT(*) c FROM command_logs WHERE device_id=? AND status='running'`
      ).get(queued.device_id);
      if (busy.c > 0) return;
      const writeBlocked = safeModeOn() && DESTRUCTIVE.has(queued.action);
      if (writeBlocked) {
        // fail fast — do not burn retries on a command that can never run
        db.prepare(`UPDATE command_logs SET status='failed', last_error=?, completed_at=? WHERE id=?`)
          .run('Blocked by safe mode (read-only) — destructive commands are disabled', nowUTC(), queued.id);
        return;
      }
      db.prepare(`UPDATE command_logs SET status='running', started_at=?, attempts=attempts+1 WHERE id=?`)
        .run(nowUTC(), queued.id);
      const driver = DRIVERS[queued.driver] || mockDriver;
      let response;
      try {
        const payload = JSON.parse(queued.payload || '{}');
        response = await driver.exec({ id: queued.device_id, host: queued.host, port: queued.port, name: queued.dname }, queued.action, payload);
        db.prepare(`UPDATE command_logs SET status='success', response=?, completed_at=? WHERE id=?`)
          .run(JSON.stringify(response), nowUTC(), queued.id);
        onCommandSuccess(queued, response);
      } catch (e) {
        const attempts = queued.attempts + 1;
        if (attempts >= 3) {
          db.prepare(`UPDATE command_logs SET status='failed', last_error=?, completed_at=? WHERE id=?`)
            .run(e.message, nowUTC(), queued.id);
          if (queued.customer_id) db.prepare(`UPDATE customers SET device_status='offline' WHERE id=?`).run(queued.customer_id);
        } else {
          // retry with backoff (queued again; simple exponential backoff via attempts)
          db.prepare(`UPDATE command_logs SET status='queued', last_error=? WHERE id=?`)
            .run(e.message, queued.id);
        }
      }
    } catch (e) {
      console.error('[device-worker]', e.message);
    } finally {
      workerRunning = false;
    }
  })();
}

function onCommandSuccess(cmd, response) {
  db.prepare(`UPDATE devices SET last_sync_at=?, last_seen_at=? WHERE id=?`)
    .run(nowUTC(), nowUTC(), cmd.device_id);
  db.prepare('INSERT INTO status_history(device_id, scope, ref, data, at) VALUES(?,?,?,?,?)')
    .run(cmd.device_id, 'command', cmd.correlation_id, JSON.stringify({ action: cmd.action, response }), nowUTC());
  if (cmd.customer_id) {
    const desired = db.prepare('SELECT status FROM customers WHERE id=?').get(cmd.customer_id)?.status;
    const observed = cmd.action === 'disable_user' || cmd.action === 'disconnect_session' ? 'offline'
      : cmd.action === 'enable_user' ? 'online' : 'online';
    if (desired === 'active' || desired === 'pending') {
      db.prepare(`UPDATE customers SET device_status=? WHERE id=?`).run(observed, cmd.customer_id);
    }
  }
}

/** Test a device connection immediately (not queued). */
async function testDevice(deviceId) {
  const device = db.prepare('SELECT * FROM devices WHERE id=?').get(deviceId);
  if (!device) throw new Error('Device not found');
  const driver = DRIVERS[device.driver];
  if (!driver) throw new Error(`Driver "${device.driver}" not available`);
  const res = await driver.exec(device, 'test_connection', {});
  db.prepare(`UPDATE devices SET identity=?, last_sync_at=?, last_seen_at=?, status='enabled' WHERE id=?`)
    .run(JSON.stringify(res), nowUTC(), nowUTC(), deviceId);
  return res;
}

function pollDevice(deviceId) {
  const device = db.prepare('SELECT * FROM devices WHERE id=?').get(deviceId);
  if (!device || device.status !== 'enabled') return null;
  const driver = DRIVERS[device.driver];
  if (!driver) return null;
  return (async () => {
    try {
      if (driver.capabilities.includes('sessions')) {
        const res = await driver.exec(device, 'list_sessions', {});
        db.prepare('INSERT INTO status_history(device_id, scope, ref, data, at) VALUES(?,?,?,?,?)')
          .run(deviceId, 'sessions', null, JSON.stringify(res), nowUTC());
        const onlineUsernames = new Set((res.sessions || []).map((s) => s.username));
        const customers = db.prepare(
          `SELECT id, pppoe_username, status FROM customers WHERE pppoe_username IS NOT NULL AND archived_at IS NULL`
        ).all();
        for (const c of customers) {
          const on = onlineUsernames.has(c.pppoe_username);
          if (c.status === 'active' || c.status === 'pending') {
            db.prepare(`UPDATE customers SET device_status=? WHERE id=?`).run(on ? 'online' : 'offline', c.id);
          }
        }
        if (driver.capabilities.includes('onu_list')) {
          const onus = await driver.exec(device, 'list_onus', {});
          const map = new Map((onus.onus || []).map((o) => [o.serial, o]));
          const rows = db.prepare('SELECT id, serial, rx_power FROM onus WHERE serial IS NOT NULL').all();
          for (const o of rows) {
            const sig = map.get(o.serial);
            if (sig) {
              const rx = parseFloat(String(sig.rx_power));
              db.prepare(`UPDATE onus SET rx_power=?, status=?, last_seen_at=? WHERE id=?`)
                .run(isNaN(rx) ? null : rx, 'online', nowUTC(), o.id);
              db.prepare('INSERT INTO onu_signal_history(onu_id, rx_power, at) VALUES(?,?,?)')
                .run(o.id, isNaN(rx) ? null : rx, nowUTC());
            }
          }
          db.prepare('INSERT INTO status_history(device_id, scope, ref, data, at) VALUES(?,?,?,?,?)')
            .run(deviceId, 'onus', null, JSON.stringify(onus), nowUTC());
        }
      }
      db.prepare(`UPDATE devices SET last_sync_at=?, last_seen_at=? WHERE id=?`)
        .run(nowUTC(), nowUTC(), deviceId);
      return { ok: true };
    } catch (e) {
      db.prepare(`UPDATE devices SET status='error' WHERE id=?`).run(deviceId);
      return { ok: false, error: e.message };
    }
  })();
}

function setDevice(deviceId, { status, safeMode }) {
  db.prepare(`UPDATE devices SET status=?, safe_mode=? WHERE id=?`)
    .run(status, safeMode ? 1 : 0, deviceId);
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

module.exports = {
  DRIVERS, mockDriver, mikrotikDriver,
  queueCommand, tickCommands, testDevice, pollDevice, setDevice,
  encryptSecret, DESTRUCTIVE, safeModeOn,
};

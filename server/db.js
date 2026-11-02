'use strict';
const { DatabaseSync } = require('node:sqlite');
const { config } = require('./config');

let _db = null;

function getDb() {
  if (_db) return _db;
  _db = new DatabaseSync(config.dbFile);
  _db.exec('PRAGMA journal_mode = WAL;');
  _db.exec('PRAGMA foreign_keys = ON;');
  _db.exec('PRAGMA busy_timeout = 5000;');
  return _db;
}

/**
 * Tiny transaction helper: runs fn inside BEGIN/COMMIT with rollback.
 */
function tx(fn) {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn(db);
    db.exec('COMMIT');
    return out;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw e;
  }
}

module.exports = {
  get db() { return getDb(); },
  tx,
  close() { if (_db) { try { _db.close(); } catch {} _db = null; } },
};

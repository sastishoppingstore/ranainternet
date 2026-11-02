'use strict';
/*
 * Rana Internet ERP — bootstrap.
 * 1. config  2. schema migration  3. chart of accounts + notification templates
 * 4. demo seed (clearly labeled, SEED_DEMO=1 by default)  5. HTTP server  6. scheduler
 */
const http = require('http');
const { config } = require('./config');
const { db } = require('./db');
const { migrate } = require('./migrate');
const { ensureChart } = require('./lib/accounting');
const { ensureTemplates } = require('./lib/notify');
const { seedDemo, SEED_CREDENTIALS } = require('./seed');
const { createApp } = require('./app');
const { startScheduler } = require('./scheduler');

function main() {
  migrate();
  ensureChart();
  ensureTemplates();

  const userCount = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  if (userCount === 0) {
    // owner account (change password immediately in production)
    const { hashPassword } = require('./lib/auth');
    db.prepare('INSERT INTO users(email, name, password_hash) VALUES(?,?,?)')
      .run(SEED_CREDENTIALS.email, SEED_CREDENTIALS.name, hashPassword(SEED_CREDENTIALS.password));
    db.prepare('INSERT OR IGNORE INTO roles(name) VALUES (\'owner\')').run();
    console.log(`[init] owner account created — ${SEED_CREDENTIALS.email} / ${SEED_CREDENTIALS.password} (CHANGE IN PRODUCTION)`);
  }

  if (config.seedDemo) {
    seedDemo();
  }

  const app = createApp();
  const server = http.createServer(app);
  server.listen(config.port, config.host, () => {
    console.log(`[init] Rana Internet ERP listening on http://${config.host}:${config.port}`);
    console.log(`[init] Customer website:  /`);
    console.log(`[init] Owner panel:       /owner`);
  });

  // last-resort guard: log instead of crashing the whole process
  process.on('uncaughtException', (e) => console.error('[uncaught]', e));
  process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));

  const stopScheduler = startScheduler();
  const shutdown = () => {
    console.log('[init] shutting down…');
    stopScheduler();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();

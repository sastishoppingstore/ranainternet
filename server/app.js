'use strict';
const path = require('path');
const fs = require('fs');
const express = require('express');
const siteRouter = require('./routes/site');
const apiRouter = require('./routes/api');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);

  app.use(express.json({ limit: '2mb' }));

  // static: customer website + owner SPA assets
  const pub = path.join(__dirname, '..', 'public');
  app.use(express.static(pub, { index: 'index.html' }));

  // public (customer) API — mounted BEFORE owner API so /api/public stays open
  app.use(siteRouter);

  // owner/super-admin API
  app.use('/api', apiRouter);

  app.use('/api', (req, res) => res.status(404).json({ error: 'Unknown API endpoint' }));

  // SPA fallback for owner panel
  app.get('/owner', (req, res) => res.sendFile(path.join(pub, 'owner.html')));

  // 404 for unknown HTML routes → landing page
  app.use((req, res) => {
    if (req.method === 'GET' && !req.path.startsWith('/api/')) {
      return res.status(404).sendFile(path.join(pub, '404.html'));
    }
    res.status(404).json({ error: 'Not found' });
  });

  // central error handler
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('[error]', err.message);
    if (res.headersSent) return;
    res.status(err.status || 500).json({ error: err.message || 'Server error' });
  });

  return app;
}

module.exports = { createApp };

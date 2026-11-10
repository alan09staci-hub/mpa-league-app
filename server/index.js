'use strict';
// MPA League App — public rebuild, Phase 1.
// Node + Express, plain HTML/CSS/JS frontend, Postgres.
require('dotenv').config();
const express = require('express');
const path = require('path');
const { migrate } = require('./db');
const api = require('./routes/api');
const peopleRoutes = require('./routes/people');
const auth = require('./lib/auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/api', api);
app.use('/api', peopleRoutes);

// SPA fallback: anything that isn't an API route serves the app shell.
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found.' });
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

async function start() {
  await migrate();
  if (!auth.passcodeConfigured()) {
    console.warn(
      '[warn] ADMIN_PASSCODE is not set — Admin login is disabled. ' +
        'Set ADMIN_PASSCODE in the environment to enable it.'
    );
  }
  return new Promise((resolve) => {
    const server = app.listen(PORT, () => {
      console.log(`[mpa] listening on http://localhost:${server.address().port}`);
      console.log(`[mpa] admin passcode ${auth.passcodeConfigured() ? 'configured' : 'NOT configured'}`);
      resolve(server);
    });
  });
}

if (require.main === module) {
  start().catch((e) => {
    console.error('[fatal]', e);
    process.exit(1);
  });
}

module.exports = { app, start };

'use strict';
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const { query } = require('./db');
const { hash } = require('./auth');
const api = require('./api');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use('/api', api);
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/health', (_req, res) => res.json({ ok: true }));
// SPA fallback
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

async function initDb() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await query(schema);
  // Bootstrap first admin account if there are no users yet.
  const { rows } = await query('SELECT COUNT(*)::int AS n FROM users');
  if (rows[0].n === 0) {
    const email = process.env.ADMIN_EMAIL || 'admin@infreight.local';
    const pw = process.env.ADMIN_PASSWORD || 'changeme';
    const ph = await hash(pw);
    await query('INSERT INTO users(email,name,role,password_hash) VALUES ($1,$2,$3,$4)',
      [email, process.env.ADMIN_NAME || 'Administrator', 'ADMIN', ph]);
    console.log(`Created first admin user: ${email}`);
  }
  // Seed sample reference + demo data once (only if accounts table is empty).
  const acc = await query('SELECT COUNT(*)::int AS n FROM accounts');
  if (acc.rows[0].n === 0) {
    const seed = require('./seed');
    await seed.run();
    console.log('Seeded sample data.');
  }
}

const PORT = process.env.PORT || 3000;
initDb()
  .then(() => app.listen(PORT, () => console.log(`Infreight WMS listening on :${PORT}`)))
  .catch((e) => { console.error('Startup failed:', e); process.exit(1); });

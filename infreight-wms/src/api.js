'use strict';
const express = require('express');
const multer = require('multer');
const { query, tx } = require('./db');
const { requireAuth, login, hash } = require('./auth');
const { reconcileRows, computeLedger } = require('./services/ledger');
const { buildPackingRows, packingListWorkbook, dracoWorkbook } = require('./services/exports');
const { parseUpload } = require('./services/importer');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
const router = express.Router();

const auth = requireAuth();
const adminOnly = requireAuth('ADMIN');

async function logAudit(name, action, detail) {
  await query('INSERT INTO audit_log(user_name, action, detail) VALUES ($1,$2,$3)', [name, action, detail]);
}
const rid = (p) => p + Math.floor(100000 + Math.random() * 900000);
const wrap = (fn) => (req, res) => fn(req, res).catch((e) => {
  console.error(e);
  res.status(e.status || 500).json({ error: e.message || 'Server error' });
});

/* ---------- auth ---------- */
router.post('/login', wrap(async (req, res) => {
  const { email, password } = req.body || {};
  const result = await login(email, password);
  if (!result) return res.status(401).json({ error: 'Invalid email or password' });
  res.json(result);
}));

router.get('/me', auth, (req, res) => res.json({ user: req.user }));

/* ---------- reference data ---------- */
router.get('/accounts', auth, wrap(async (_req, res) => {
  res.json((await query('SELECT * FROM accounts ORDER BY name')).rows);
}));
router.get('/skus', auth, wrap(async (_req, res) => {
  res.json((await query('SELECT * FROM skus ORDER BY sku')).rows);
}));

/* ---------- inbound ---------- */
async function loadInbound() {
  const ships = (await query('SELECT * FROM inbound_shipments ORDER BY created_at DESC, id')).rows;
  const cipl = (await query('SELECT * FROM cipl_lines')).rows;
  const grn = (await query('SELECT * FROM grn_lines')).rows;
  return ships.map((s) => {
    const c = cipl.filter((x) => x.shipment_id === s.id);
    const g = grn.filter((x) => x.shipment_id === s.id);
    const recon = reconcileRows(c, g);
    return {
      ...s,
      ciplLines: c, grnLines: g, recon,
      expectedTotal: c.reduce((a, x) => a + Number(x.expected_pcs), 0),
      actualTotal: g.reduce((a, x) => a + Number(x.actual_pcs), 0),
      hasVariance: recon.some((r) => r.variance !== 0),
    };
  });
}
router.get('/inbound', auth, wrap(async (_req, res) => res.json(await loadInbound())));

router.post('/inbound', auth, wrap(async (req, res) => {
  const b = req.body || {};
  const id = b.id || rid('GR-00');
  await tx(async (c) => {
    await c.query(
      `INSERT INTO inbound_shipments(id,account,cipl_no,cipl_date,po,shipper,vessel,eta,permit,received_date,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Pending review')`,
      [id, b.account, b.cipl_no, b.cipl_date || null, b.po, b.shipper, b.vessel, b.eta, b.permit, b.received_date || null]
    );
    for (const l of b.ciplLines || []) {
      await c.query('INSERT INTO cipl_lines(shipment_id,sku,expected_pcs,ctn) VALUES ($1,$2,$3,$4)',
        [id, l.sku, l.expected_pcs || l.pcs || 0, l.ctn || null]);
    }
    for (const l of b.grnLines || []) {
      await c.query('INSERT INTO grn_lines(shipment_id,sku,loc,actual_pcs,vol) VALUES ($1,$2,$3,$4,$5)',
        [id, l.sku, l.loc || null, l.actual_pcs || l.actual || 0, l.vol || null]);
    }
  });
  await logAudit(req.user.name, 'INBOUND CREATED', `${id} — CIPL ${b.cipl_no || ''}`);
  res.json({ id });
}));

router.post('/inbound/:id/book', auth, wrap(async (req, res) => {
  const id = req.params.id;
  const s = (await query('SELECT * FROM inbound_shipments WHERE id=$1', [id])).rows[0];
  if (!s) return res.status(404).json({ error: 'Shipment not found' });
  if (s.status === 'Booked') return res.status(400).json({ error: 'Already booked' });
  const cipl = (await query('SELECT * FROM cipl_lines WHERE shipment_id=$1', [id])).rows;
  const grn = (await query('SELECT * FROM grn_lines WHERE shipment_id=$1', [id])).rows;
  const recon = reconcileRows(cipl, grn);
  const expected = recon.reduce((a, r) => a + r.booked, 0);
  const variance = recon.some((r) => r.variance !== 0);
  await query('UPDATE inbound_shipments SET status=$1, booked_by=$2, booked_at=now() WHERE id=$3',
    ['Booked', req.user.name, id]);
  await logAudit(req.user.name, 'INBOUND BOOKED',
    `${id} — ${expected} pcs booked from CIPL ${s.cipl_no || ''}${variance ? ' (GRN variance flagged)' : ''}`);
  res.json({ ok: true, booked: expected, variance });
}));

// Parse an uploaded CIPL or GRN spreadsheet and return extracted line records.
router.post('/inbound/import', auth, upload.single('file'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const records = await parseUpload(req.file.buffer, req.file.originalname);
  res.json({ records, count: records.length });
}));

/* ---------- outbound ---------- */
async function loadIssues() {
  const issues = (await query('SELECT * FROM issues ORDER BY created_at DESC, id')).rows;
  const lines = (await query('SELECT * FROM issue_lines')).rows;
  return issues.map((i) => ({ ...i, lines: lines.filter((l) => l.issue_id === i.id) }));
}
router.get('/outbound', auth, wrap(async (_req, res) => res.json(await loadIssues())));

router.post('/outbound', auth, wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.lines || !b.lines.length) return res.status(400).json({ error: 'No pick lines' });
  const id = b.id || rid('GI-');
  const skuMap = await getSkuMap();
  await tx(async (c) => {
    await c.query(
      `INSERT INTO issues(id,account,ship_ref,issue_date,status,deducted_by,deducted_at)
       VALUES ($1,$2,$3,$4,'Deducted',$5,now())`,
      [id, b.account, b.ship_ref, b.issue_date || new Date().toISOString().slice(0, 10), req.user.name]
    );
    for (const l of b.lines) {
      await c.query('INSERT INTO issue_lines(issue_id,sku,descr,qty,uom,permit,uld) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [id, l.sku, (skuMap[l.sku] || {}).descr || l.descr || '', l.qty, l.uom || 'PCS', l.permit || null, l.uld || null]);
    }
  });
  const total = b.lines.reduce((a, l) => a + Number(l.qty), 0);
  await logAudit(req.user.name, 'STOCK DEDUCTED', `${id} — ${total} pcs deducted (${b.ship_ref || ''})`);
  res.json({ id, deducted: total });
}));

router.get('/outbound/:id/packing-list.xlsx', auth, wrap(async (req, res) => {
  const id = req.params.id;
  const issue = (await query(
    `SELECT i.*, a.name AS account_name FROM issues i LEFT JOIN accounts a ON a.code=i.account WHERE i.id=$1`, [id]
  )).rows[0];
  if (!issue) return res.status(404).json({ error: 'Issue not found' });
  const lines = (await query('SELECT * FROM issue_lines WHERE issue_id=$1', [id])).rows;
  const skuMap = await getSkuMap();
  const rows = buildPackingRows(lines, skuMap);
  const wb = await packingListWorkbook(issue, rows);
  await logAudit(req.user.name, 'EXPORT PACKING LIST', `${issue.ship_ref} packing list from ${id}`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="PackingList-${issue.ship_ref || id}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}));

/* ---------- stock ---------- */
router.get('/stock', auth, wrap(async (_req, res) => res.json(await computeLedger())));

router.get('/stock/draco.xlsx', auth, wrap(async (req, res) => {
  const ledger = await computeLedger();
  const skuMap = await getSkuMap();
  const enriched = ledger.map((r) => ({ ...r, ...skuMap[r.sku] }));
  const wb = await dracoWorkbook(enriched, { when: new Date().toISOString().slice(0, 16).replace('T', ' '), by: req.user.name });
  await logAudit(req.user.name, 'EXPORT', 'DRACO stock export generated');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="DRACO-STOCK-export.xlsx"');
  await wb.xlsx.write(res);
  res.end();
}));

/* ---------- audit ---------- */
router.get('/audit', auth, wrap(async (_req, res) => {
  res.json((await query('SELECT * FROM audit_log ORDER BY ts DESC LIMIT 500')).rows);
}));

/* ---------- search ---------- */
router.get('/search', auth, wrap(async (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  if (!q) return res.json([]);
  const like = `%${q}%`;
  const out = [];
  for (const r of (await query(
    `SELECT DISTINCT s.id, s.cipl_no, s.po, s.status FROM inbound_shipments s
     LEFT JOIN cipl_lines c ON c.shipment_id=s.id
     WHERE lower(s.id) LIKE $1 OR lower(coalesce(s.cipl_no,'')) LIKE $1
        OR lower(coalesce(s.po,'')) LIKE $1 OR lower(coalesce(c.sku,'')) LIKE $1 LIMIT 20`, [like]
  )).rows) out.push({ type: 'GR', cat: 'Inbound — GR / CIPL', label: `${r.id} · CIPL ${r.cipl_no || ''}`, meta: `PO ${r.po || ''} · ${r.status}`, page: 'inbound' });

  for (const r of (await query(
    `SELECT DISTINCT i.id, i.ship_ref, i.status FROM issues i
     LEFT JOIN issue_lines l ON l.issue_id=i.id
     WHERE lower(i.id) LIKE $1 OR lower(coalesce(i.ship_ref,'')) LIKE $1 OR lower(coalesce(l.sku,'')) LIKE $1 LIMIT 20`, [like]
  )).rows) out.push({ type: 'GI', cat: 'Outbound — GI / pick / T-ref', label: `${r.id} · ${r.ship_ref || ''}`, meta: r.status, page: 'outbound' });

  for (const r of (await query(
    `SELECT sku, descr FROM skus WHERE lower(sku) LIKE $1 OR lower(descr) LIKE $1 LIMIT 20`, [like]
  )).rows) out.push({ type: 'SKU', cat: 'Items & stock', label: `${r.sku} — ${r.descr}`, meta: 'view stock', page: 'stock', q: r.sku });

  for (const [name, page] of [['draco stock report', 'stock'], ['packing list', 'outbound'], ['audit trail', 'audit'], ['bin location', 'locations']]) {
    if (name.includes(q)) out.push({ type: 'PAGE', cat: 'Reports & pages', label: name, meta: 'open', page });
  }
  res.json(out);
}));

/* ---------- users (admin) ---------- */
router.get('/users', adminOnly, wrap(async (_req, res) => {
  res.json((await query('SELECT id,email,name,role,created_at FROM users ORDER BY id')).rows);
}));
router.post('/users', adminOnly, wrap(async (req, res) => {
  const { email, name, role, password } = req.body || {};
  if (!email || !password || !['ADMIN', 'OPS'].includes(role)) return res.status(400).json({ error: 'email, password and role (ADMIN/OPS) required' });
  const ph = await hash(password);
  const r = await query('INSERT INTO users(email,name,role,password_hash) VALUES ($1,$2,$3,$4) RETURNING id', [email, name || email, role, ph]);
  await logAudit(req.user.name, 'USER CREATED', `${email} (${role})`);
  res.json({ id: r.rows[0].id });
}));
router.delete('/users/:id', adminOnly, wrap(async (req, res) => {
  await query('DELETE FROM users WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

async function getSkuMap() {
  const rows = (await query('SELECT * FROM skus')).rows;
  return Object.fromEntries(rows.map((s) => [s.sku, s]));
}

module.exports = router;

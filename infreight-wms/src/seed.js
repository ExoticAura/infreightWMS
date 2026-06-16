'use strict';
// Seeds sample reference + demo data drawn from the real Infreight documents:
//  - SKU master / carton factors ...... DRACO STOCK
//  - Inbound CIPL A11128 + GRN GR-007874
//  - Outbound picks (T251 / T255)
require('dotenv').config();
const { query, tx } = require('./db');

const accounts = [
  ['KBS', 'KBS / Koehler Bright Star', 'T255'],
  ['ADAMALLYS', "Adamally's", 'T251'],
  ['APEX', 'Apex', 'T252/T253'],
  ['ADAMAR', 'Adamar', 'T254'],
];

const skus = [
  ['15460', '2217 LED WORKSAFE 2-D CELL FLASHLIGHT (PK12)', 'KBS', 12, 0.015651, 2.5],
  ['16460', '2217 ATEX LED WORKSAFE', 'KBS', 12, 0.0156, 2.5],
  ['60160', 'RAZOR LED 3AA FLASHLIGHT', 'KBS', 12, 0.00952, 1.42],
  ['60170', 'WORKSAFE LAMP 60170', 'KBS', 12, 0.0076, 1.42],
  ['89000', 'DISPLAY UNIT 89000', 'APEX', 8, 0.084, 16.84],
  ['200501', 'VISION LED 3AAA HEADLAMP', 'ADAMALLYS', 60, 0.034284, 5.23],
  ['200521', 'LED WORKSAFE (200521)', 'ADAMALLYS', 48, 0.05568, 9.24],
  ['08050', '2206 LED WORKSAFE 4-D CELL LANTERN (PK6)', 'KBS', 6, 0.0333, 5.74],
  ['07050', 'LED WORKSAFE (07050)', 'KBS', 6, 0.0287, 5.74],
  ['15720', 'WORKSAFE 15720', 'KBS', 12, 0.0189, 3],
];

const opening = {
  '15460': 0, '16460': 2256, '60160': 3084, '60170': 468, '89000': 166,
  '200501': 7268, '200521': 1088, '08050': 1868, '07050': 0, '15720': 0,
};

async function run() {
  await tx(async (c) => {
    for (const a of accounts) await c.query('INSERT INTO accounts(code,name,ship_ref) VALUES ($1,$2,$3) ON CONFLICT (code) DO NOTHING', a);
    for (const s of skus) await c.query('INSERT INTO skus(sku,descr,account,pcs_ctn,cbm_ctn,kgs_ctn) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (sku) DO NOTHING', s);
    for (const [sku, pcs] of Object.entries(opening)) await c.query('INSERT INTO opening_balances(sku,pcs) VALUES ($1,$2) ON CONFLICT (sku) DO NOTHING', [sku, pcs]);

    // Inbound 1: CIPL A11128 <-> GRN GR-007874 (Booked, docs match)
    await c.query(
      `INSERT INTO inbound_shipments(id,account,cipl_no,cipl_date,po,shipper,vessel,eta,permit,received_date,status,booked_by,booked_at)
       VALUES ('GR-007874','KBS','A11128','2026-05-26','36056','Flying Dragon Development Ltd (for Koehler-Bright Star)','YM TRUTH V.028W','2026-06-06 Singapore','II6F040827C','2026-06-15','Booked','USER05 (Ops)', now()) ON CONFLICT (id) DO NOTHING`
    );
    await ciplLines(c, 'GR-007874', [['15460', 7500, 157], ['08050', 2700, 113]]);
    const grn1 = [
      ['15460', 'AM-017-001-C', 1200], ['15460', 'AM-016-002-A', 1200], ['15460', 'AM-019-001-A', 1200],
      ['15460', 'AM-020-001-A', 1200], ['15460', 'AM-020-001-C', 1200], ['15460', 'AM-017-001-A', 1200],
      ['15460', 'AM-018-001-C', 192], ['15460', 'AM-018-001-A', 108],
      ['08050', 'AM-016-001-C', 192], ['08050', 'AM-015-002-A', 192], ['08050', 'AM-017-002-C', 192],
      ['08050', 'AM-019-002-C', 192], ['08050', 'AM-016-003-A', 192], ['08050', 'AM-015-001-A', 192],
      ['08050', 'AM-020-003-C', 192], ['08050', 'AM-016-003-C', 192], ['08050', 'AM-020-002-A', 192],
      ['08050', 'AM-017-003-C', 192], ['08050', 'AM-019-002-A', 192], ['08050', 'AM-016-001-A', 192],
      ['08050', 'AM-018-001-C', 192], ['08050', 'AM-018-001-A', 204],
    ];
    await grnLines(c, 'GR-007874', grn1);

    // Inbound 2: CIPL A11203 (Pending review, GRN short 12 on 60170)
    await c.query(
      `INSERT INTO inbound_shipments(id,account,cipl_no,cipl_date,po,shipper,vessel,eta,permit,received_date,status)
       VALUES ('GR-007901','APEX','A11203','2026-06-10','36092','Flying Dragon Development Ltd (for Apex)','COSCO HOPE V.114E','2026-06-15 Singapore','(pending)','2026-06-16','Pending review') ON CONFLICT (id) DO NOTHING`
    );
    await ciplLines(c, 'GR-007901', [['89000', 240, 30], ['60170', 600, 50]]);
    await grnLines(c, 'GR-007901', [['89000', 'AM-021-001-A', 240], ['60170', 'AM-021-002-A', 588]]);

    // Outbound picks
    await c.query(`INSERT INTO issues(id,account,ship_ref,issue_date,status,deducted_by,deducted_at)
      VALUES ('GI-119055','ADAMALLYS','T251','2026-06-12','Deducted','USER05 (Ops)', now()) ON CONFLICT (id) DO NOTHING`);
    await issueLines(c, 'GI-119055', [
      ['08050', '2206 LED WORKSAFE', 12, 'II6D016332S', 'ULDA1414'],
      ['200501', 'VISION LED 3AAA HEADLAMP', 180, 'II6B989835X', 'ULDA1368'],
      ['200501', 'VISION LED 3AAA HEADLAMP', 60, 'RM6A434154C', 'ULDA1366'],
    ]);
    await c.query(`INSERT INTO issues(id,account,ship_ref,issue_date,status,deducted_by,deducted_at)
      VALUES ('GI-122693','KBS','T255','2026-06-14','Deducted','USER05 (Ops)', now()) ON CONFLICT (id) DO NOTHING`);
    await issueLines(c, 'GI-122693', [['16460', '2217 ATEX LED WORKSAFE', 72, 'II6D016332S', 'ULDA1414']]);

    await c.query(`INSERT INTO audit_log(user_name,action,detail) VALUES
      ('USER05 (Ops)','INBOUND BOOKED','GR-007874 — 10,200 pcs booked from CIPL A11128'),
      ('USER05 (Ops)','STOCK DEDUCTED','GI-119055 — 252 pcs deducted (T251)'),
      ('USER05 (Ops)','STOCK DEDUCTED','GI-122693 — 72 pcs deducted (T255)')`);
  });
}

function ciplLines(c, id, rows) {
  return Promise.all(rows.map((r) => c.query('INSERT INTO cipl_lines(shipment_id,sku,expected_pcs,ctn) VALUES ($1,$2,$3,$4)', [id, r[0], r[1], r[2]])));
}
function grnLines(c, id, rows) {
  return Promise.all(rows.map((r) => c.query('INSERT INTO grn_lines(shipment_id,sku,loc,actual_pcs) VALUES ($1,$2,$3,$4)', [id, r[0], r[1], r[2]])));
}
function issueLines(c, id, rows) {
  return Promise.all(rows.map((r) => c.query('INSERT INTO issue_lines(issue_id,sku,descr,qty,permit,uld) VALUES ($1,$2,$3,$4,$5,$6)', [id, r[0], r[1], r[2], r[3], r[4]])));
}

if (require.main === module) {
  run().then(() => { console.log('Seed complete'); process.exit(0); }).catch((e) => { console.error(e); process.exit(1); });
}
module.exports = { run };

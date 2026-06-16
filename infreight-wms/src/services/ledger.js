'use strict';
const { query } = require('../db');

// Reconcile a single shipment: CIPL expected vs GRN actual, per SKU.
// Business rule (confirmed with Infreight): stock is booked on the CIPL
// (expected) quantity; the GRN difference is flagged for ULD to resolve.
function reconcileRows(ciplLines, grnLines) {
  const m = {};
  for (const l of ciplLines) {
    m[l.sku] = m[l.sku] || { sku: l.sku, expected: 0, actual: 0, locs: [] };
    m[l.sku].expected += Number(l.expected_pcs);
  }
  for (const l of grnLines) {
    m[l.sku] = m[l.sku] || { sku: l.sku, expected: 0, actual: 0, locs: [] };
    m[l.sku].actual += Number(l.actual_pcs);
    if (l.loc) m[l.sku].locs.push(l.loc);
  }
  return Object.values(m).map((r) => ({
    sku: r.sku,
    expected: r.expected,
    actual: r.actual,
    variance: r.actual - r.expected,
    booked: r.expected, // booked on CIPL expected
    locs: [...new Set(r.locs)],
  }));
}

// Compute the perpetual stock ledger across all SKUs.
// closing = opening + stockIn(booked CIPL) - stockOut(issues)
async function computeLedger() {
  const skus = (await query('SELECT * FROM skus ORDER BY sku')).rows;
  const opening = {};
  for (const r of (await query('SELECT * FROM opening_balances')).rows) {
    opening[r.sku] = Number(r.pcs);
  }
  // booked inbound -> stock in (CIPL expected)
  const inRows = (
    await query(
      `SELECT c.sku, SUM(c.expected_pcs) AS pcs
       FROM cipl_lines c
       JOIN inbound_shipments s ON s.id = c.shipment_id
       WHERE s.status = 'Booked'
       GROUP BY c.sku`
    )
  ).rows;
  const stockIn = {};
  for (const r of inRows) stockIn[r.sku] = Number(r.pcs);

  // issues -> stock out, also broken down by shipment ref
  const outRows = (
    await query(
      `SELECT il.sku, i.ship_ref, SUM(il.qty) AS qty
       FROM issue_lines il JOIN issues i ON i.id = il.issue_id
       GROUP BY il.sku, i.ship_ref`
    )
  ).rows;
  const stockOut = {};
  const byShip = {};
  for (const r of outRows) {
    stockOut[r.sku] = (stockOut[r.sku] || 0) + Number(r.qty);
    byShip[r.sku] = byShip[r.sku] || {};
    byShip[r.sku][r.ship_ref] = (byShip[r.sku][r.ship_ref] || 0) + Number(r.qty);
  }

  return skus.map((s) => {
    const op = opening[s.sku] || 0;
    const si = stockIn[s.sku] || 0;
    const so = stockOut[s.sku] || 0;
    const closing = op + si - so;
    const ctn = s.pcs_ctn ? closing / Number(s.pcs_ctn) : 0;
    return {
      sku: s.sku,
      descr: s.descr,
      account: s.account,
      opening: op,
      stockIn: si,
      stockOut: so,
      closing,
      cbm: s.cbm_ctn ? ctn * Number(s.cbm_ctn) : 0,
      kgs: s.kgs_ctn ? ctn * Number(s.kgs_ctn) : 0,
      byShip: byShip[s.sku] || {},
    };
  });
}

module.exports = { reconcileRows, computeLedger };

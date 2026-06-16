'use strict';
const ExcelJS = require('exceljs');

// Build packing-list rows from an issue's lines, deriving carton qty / CBM / GW
// from SKU factors. Mirrors the Koehler SAMPLE PACKING LIST.xlsx layout.
function buildPackingRows(issueLines, skuMap) {
  const agg = {};
  for (const l of issueLines) {
    agg[l.sku] = (agg[l.sku] || 0) + Number(l.qty);
  }
  return Object.entries(agg).map(([sku, pcs]) => {
    const s = skuMap[sku] || {};
    const pcsCtn = Number(s.pcs_ctn) || 0;
    const ctn = pcsCtn ? Math.ceil(pcs / pcsCtn) : 0;
    return {
      sku,
      descr: s.descr || '',
      pcs,
      ctn,
      cbm: ctn * (Number(s.cbm_ctn) || 0),
      gw: ctn * (Number(s.kgs_ctn) || 0),
    };
  });
}

// Generate an export packing list .xlsx in the Koehler template layout.
async function packingListWorkbook(issue, rows) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Infreight WMS';
  const ws = wb.addWorksheet('PACKING LIST', {
    pageSetup: { orientation: 'portrait', fitToPage: true },
  });
  ws.columns = [
    { width: 16 }, { width: 12 }, { width: 11 }, { width: 34 },
    { width: 10 }, { width: 14 }, { width: 12 }, { width: 14 },
  ];

  const title = (text, size, bold) => {
    const r = ws.addRow([text]);
    ws.mergeCells(`A${r.number}:H${r.number}`);
    r.getCell(1).font = { bold: !!bold, size: size || 11 };
    r.getCell(1).alignment = { horizontal: 'center' };
    return r;
  };
  title('KOEHLER BRIGHT STAR LLC', 16, true);
  title('380 STEWART ROAD, HANOVER TOWNSHIP, PA 18706   TEL:(570) 825-1900', 9);
  ws.addRow([]);
  title('PACKING LIST', 13, true);
  ws.addRow([`NO .: ${issue.ship_ref}`, '', '', `Date: ${issue.issue_date || ''}`]);
  ws.addRow([`Customer: ${issue.account_name || issue.account || ''}`]);
  ws.addRow([]);

  const header = ws.addRow([
    'PO#', 'KBS PO#', 'ITEM #', 'PRODUCT DESCRIPTION',
    'QTY (PCS)', 'CARTON QTY (CTNS)', 'CBM', 'G.W.(KGS)',
  ]);
  header.eachCell((c) => {
    c.font = { bold: true };
    c.alignment = { horizontal: 'center', wrapText: true };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEEEEE' } };
    c.border = box();
  });

  let tot = { pcs: 0, ctn: 0, cbm: 0, gw: 0 };
  for (const r of rows) {
    const row = ws.addRow(['', '', r.sku, r.descr, r.pcs, r.ctn, round(r.cbm, 3), round(r.gw, 2)]);
    row.eachCell((c, col) => {
      c.border = box();
      if (col >= 5) c.alignment = { horizontal: 'right' };
    });
    tot.pcs += r.pcs; tot.ctn += r.ctn; tot.cbm += r.cbm; tot.gw += r.gw;
  }
  const totalRow = ws.addRow(['', '', '', 'TOTAL', tot.pcs, tot.ctn, round(tot.cbm, 3), round(tot.gw, 2)]);
  totalRow.eachCell((c, col) => {
    c.border = box();
    c.font = { bold: true };
    if (col >= 5) c.alignment = { horizontal: 'right' };
  });
  ws.addRow([]);
  ws.addRow(['THE COUNTRY OF ORIGIN : MADE IN CHINA']);

  return wb;
}

// Generate the DRACO stock report .xlsx from the computed ledger.
async function dracoWorkbook(ledger, meta) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Infreight WMS';
  const ws = wb.addWorksheet('STOCK', { views: [{ state: 'frozen', ySplit: 4 }] });
  ws.addRow(['INFREIGHT WMS — DRACO STOCK EXPORT']).getCell(1).font = { bold: true, size: 14 };
  ws.addRow([`Generated ${meta.when} by ${meta.by}`]);
  ws.addRow([]);
  const header = ws.addRow([
    'NO.', 'ITEM NO', 'PCS/CTN', 'CBM/CTN', 'KGS/CTN', 'BAL C/F', 'STOCK IN',
    'STOCK OUT', 'CLS BAL', 'CBM', 'KGS', 'BY SHIPMENT',
  ]);
  header.eachCell((c) => {
    c.font = { bold: true };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEEEEE' } };
    c.border = box();
  });
  ws.columns.forEach((c, i) => (c.width = [6, 12, 9, 10, 9, 10, 10, 11, 10, 10, 10, 24][i] || 12));

  ledger.forEach((r, i) => {
    ws.addRow([
      i + 1, r.sku, num(r.pcs_ctn), num(r.cbm_ctn), num(r.kgs_ctn),
      r.opening, r.stockIn, r.stockOut, r.closing,
      round(r.cbm, 4), round(r.kgs, 2),
      Object.entries(r.byShip || {}).map(([k, v]) => `${k}:${v}`).join(' '),
    ]).eachCell((c) => (c.border = box()));
  });
  return wb;
}

function box() {
  const s = { style: 'thin', color: { argb: 'FF999999' } };
  return { top: s, bottom: s, left: s, right: s };
}
function round(n, d) { const f = Math.pow(10, d); return Math.round((Number(n) || 0) * f) / f; }
function num(n) { return n == null ? '' : Number(n); }

module.exports = { buildPackingRows, packingListWorkbook, dracoWorkbook };

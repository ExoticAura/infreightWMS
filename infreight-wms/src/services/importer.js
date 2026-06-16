'use strict';
const ExcelJS = require('exceljs');
const { parse } = require('csv-parse/sync');

// Normalise a header label to a canonical field name.
function canon(h) {
  const s = String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (s.includes('sku') || s.includes('item')) return 'sku';
  if (s.includes('desc')) return 'descr';
  if (s.includes('expected') || (s.includes('qty') && !s.includes('carton')) || s === 'pcs' || s.includes('quantity')) return 'pcs';
  if (s.includes('actual')) return 'actual';
  if (s.includes('carton') || s === 'ctn' || s.includes('ctns')) return 'ctn';
  if (s.includes('loc') || s.includes('bin') || s.includes('paloc')) return 'loc';
  return null;
}

function rowsToRecords(matrix) {
  // find header row (first row containing a recognised column)
  let headerIdx = -1, map = {};
  for (let i = 0; i < matrix.length; i++) {
    const m = {};
    matrix[i].forEach((cell, c) => { const k = canon(cell); if (k) m[k] = c; });
    if (m.sku != null && (m.pcs != null || m.actual != null)) { headerIdx = i; map = m; break; }
  }
  if (headerIdx === -1) throw new Error('Could not find a header row with SKU and a quantity column.');
  const out = [];
  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const r = matrix[i];
    const sku = r[map.sku];
    if (sku == null || String(sku).trim() === '') continue;
    const rec = { sku: String(sku).trim() };
    if (map.descr != null) rec.descr = r[map.descr];
    if (map.pcs != null) rec.pcs = toNum(r[map.pcs]);
    if (map.actual != null) rec.actual = toNum(r[map.actual]);
    if (map.ctn != null) rec.ctn = toNum(r[map.ctn]);
    if (map.loc != null) rec.loc = r[map.loc];
    if ((rec.pcs || rec.actual)) out.push(rec);
  }
  return out;
}

function toNum(v) {
  if (v == null) return 0;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? 0 : n;
}

async function parseUpload(buffer, filename) {
  const name = (filename || '').toLowerCase();
  if (name.endsWith('.csv') || name.endsWith('.txt')) {
    const records = parse(buffer.toString('utf8'), { skip_empty_lines: true, relax_column_count: true });
    return rowsToRecords(records);
  }
  // xlsx / xls
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  const matrix = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const arr = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => { arr[col - 1] = cell.value; });
    matrix.push(arr);
  });
  return rowsToRecords(matrix);
}

module.exports = { parseUpload };

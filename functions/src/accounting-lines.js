/*
 * Accounting Numbers, the extra lines (Joe 11-7-26: the route cost app needs more of the P&L than three numbers).
 *
 * Read from the same monthly accounting package as accounting.js, tab by tab, next to the four numbers Over the Road uses
 * (those are read by otr-core.js and are not changed here). Saved on the same accountingMonthly/<yyyy-mm> document:
 *   delivery_lines       {"<P&L line>": amount}  P&L Expenses by Dept, DELIVERY column (DM + GAR + DIC), every line not 0
 *   garage_lines         {"<P&L line>": amount}  the same lines, GAR column only (the garage's own share)
 *   delivery_garage_cost amount                  GAR column TOTALS
 *   net_sales            amount                  P&L Comparison vs. last month (or vs. last year), Net Sales, whole dollars
 *   material_cost        amount                  the same, Cost of Material
 *   gallons_sales        gallons                 Gallon Comparison, Milk & Soft Serve block, Sales column
 *   gallons_transfers    gallons                 the same, Transfers column (gallons_sold stays their total)
 * Line names are column A as accounting types them, trimmed ("Depreciation ", "Supplies " -> "Depreciation", "Supplies").
 * Every amount is for the month itself, never the year to date.
 */
'use strict';

const OTR = require('./otr-core');

const EXTRA_KEYS = ['delivery_lines', 'garage_lines', 'delivery_garage_cost', 'net_sales', 'material_cost', 'gallons_sales', 'gallons_transfers'];
const DELIVERY_DEPTS = ['DM', 'GAR', 'DIC'];

const str = (v) => String(v == null ? '' : v).trim();
const lineName = (v) => str(v).replace(/\s+/g, ' ');
const round2 = (n) => Math.round(n * 100) / 100;

/** P&L Expenses by Dept month tab -> delivery_lines, garage_lines, delivery_garage_cost. */
function expenses(values, tabName) {
  for (let h = 0; h < Math.min(values.length, 15); h++) {
    const heads = (values[h] || []).map(c => str(c).toUpperCase());
    const del = heads.indexOf('DELIVERY'), gar = heads.indexOf('GAR');
    if (del < 0 || !DELIVERY_DEPTS.some(d => heads.indexOf(d) >= 0)) continue;
    let when = null;
    for (let t = 0; t <= h && !when; t++) when = OTR.otrTitleMonth_(str((values[t] || [])[0]));
    if (!when) when = OTR.otrTitleMonth_(tabName);
    if (!when) return [];
    const lines = {}, garage = {};
    let garTotal = null, total = null;
    for (let r = h + 1; r < values.length; r++) {
      const row = values[r] || [], name = lineName(row[0]);
      if (!name || /:$/.test(name)) continue;
      if (/^totals$/i.test(name)) { total = OTR.otrNum_(row[del]); garTotal = gar >= 0 ? OTR.otrNum_(row[gar]) : null; break; }
      if (name in lines || name in garage) continue; // a line typed twice: the first one, as the four numbers do
      const d = OTR.otrNum_(row[del]), g = gar >= 0 ? OTR.otrNum_(row[gar]) : null;
      if (d) lines[name] = round2(d);
      if (g) garage[name] = round2(g);
    }
    if (total == null) return [];
    const fig = (key, value) => ({ year: when.y, month: when.m, key, value });
    const out = [fig('delivery_lines', lines), fig('garage_lines', garage)];
    if (garTotal != null) out.push(fig('delivery_garage_cost', round2(garTotal)));
    return out;
  }
  return [];
}

/**
 * P&L Comparison (vs. last month or vs. last year) month tab: two month columns under a row of dates -> net_sales and
 * material_cost. The newest month on the tab is that tab's own month; the other column is a copy kept only as a fallback.
 */
function comparison(values) {
  if (!/p\s*&\s*l\s*comparison/i.test(str((values[0] || [])[0]) + ' ' + str((values[1] || [])[0]))) return [];
  for (let h = 1; h < Math.min(values.length, 10); h++) {
    const cols = [];
    (values[h] || []).forEach((c, i) => { const m = i > 0 && c instanceof Date ? OTR.otrCellMonth_(c) : null; if (m) cols.push({ i, m }); });
    if (!cols.length) continue;
    const newest = cols.reduce((a, b) => (b.m.y * 12 + b.m.m > a.m.y * 12 + a.m.m ? b : a));
    const want = { net_sales: /^net\s*sales$/i, material_cost: /^cost\s*of\s*material$/i }, out = [];
    for (let r = h + 1; r < Math.min(values.length, h + 20); r++) {
      const label = str((values[r] || [])[0]);
      Object.keys(want).forEach(k => {
        if (!want[k].test(label)) return;
        cols.forEach(c => {
          const v = OTR.otrNum_((values[r] || [])[c.i]);
          if (v != null && v !== 0) out.push({ year: c.m.y, month: c.m.m, key: k, value: round2(v), weak: c !== newest });
        });
      });
    }
    return out;
  }
  return [];
}

/** Gallon Comparison (first block, Milk & Soft Serve): Sales and Transfers by month under each year. */
function gallons(values) {
  for (let h = 1; h < Math.min(values.length, 20); h++) {
    const heads = (values[h] || []).map(c => str(c).toLowerCase());
    if (heads.indexOf('sales') < 0 || heads.indexOf('transfers') < 0) continue;
    let yearRow = null;
    for (let y = h - 1; y >= 0 && yearRow == null; y--) {
      if ((values[y] || []).filter(c => /^(19|20)\d{2}$/.test(str(c))).length >= 2) yearRow = y;
    }
    if (yearRow == null) continue;
    const blocks = [];
    heads.forEach((c, i) => {
      if (c !== 'sales' || heads[i + 1] !== 'transfers') return;
      for (let k = i + 2; k >= 0; k--) { const yv = str((values[yearRow] || [])[k]); if (/^(19|20)\d{2}$/.test(yv)) { blocks.push({ col: i, year: Number(yv) }); return; } }
    });
    const out = [];
    let seen = 0;
    for (let r = h + 1; r < values.length && seen < 12; r++) {
      const m = OTR.otrMonthName_(str((values[r] || [])[0]));
      if (!m) { if (seen) break; continue; }
      seen++;
      blocks.slice(0, 2).forEach((b, bi) => {
        const s = OTR.otrNum_((values[r] || [])[b.col]), t = OTR.otrNum_((values[r] || [])[b.col + 1]);
        if (s != null && s > 0) out.push({ year: b.year, month: m, key: 'gallons_sales', value: s, weak: bi > 0 });
        if (s != null && s > 0 && t != null) out.push({ year: b.year, month: m, key: 'gallons_transfers', value: t, weak: bi > 0 });
      });
    }
    if (out.length) return out;
  }
  return [];
}

/** One tab -> [{year, month, key, value, weak?}] for the extra keys. */
function readTab(values, tabName) {
  values = values || [];
  const e = expenses(values, tabName);
  if (e.length) return e;
  const c = comparison(values);
  if (c.length) return c;
  return gallons(values);
}

/** Many tabs' figures -> one per month and key; a tab's own month beats a copy ("weak") from another tab. */
function merge(lists) {
  const figs = {};
  lists.forEach(list => list.forEach(f => {
    const k = f.year + '-' + f.month + '|' + f.key, old = figs[k];
    if (!old || old.weak || !f.weak) figs[k] = f;
  }));
  return Object.keys(figs).map(k => figs[k]);
}

/** Same value? Maps are compared line by line. */
function same(a, b) {
  if (a == null || b == null) return a == null && b == null;
  if (typeof a === 'object' || typeof b === 'object') {
    if (typeof a !== 'object' || typeof b !== 'object') return false;
    const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
    return ka.length === kb.length && ka.every((k, i) => k === kb[i] && Math.abs(Number(a[k]) - Number(b[k])) < 0.005);
  }
  return Math.abs(Number(a) - Number(b)) < 0.005;
}

module.exports = { EXTRA_KEYS, readTab, merge, same, expenses, comparison, gallons };

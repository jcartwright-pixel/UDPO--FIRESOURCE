/*
 * Daily load by route (the BOL, Joe 11-6-26: "You just gather the information and store it, and the other programs will
 * gather the data they need from your storage area"). Vicki's 4:00 PM email "Daily Load By Route" carries a Crystal report
 * PDF (Daily Load UT.pdf): one line per item for each stop on each route, from the orders keyed for that load date:
 *   LoadDate  RtNo  LoadSeq  CusChn  CusNo  CusName  ItemNo  Descrip  Qty
 * The Hub reads it once (routereports.js checks the mailbox for both reports) and keeps each load date in
 * dailyLoads/<yyyy-mm-dd> in the company (Uniontown) database: every line, plus totals by route. A newer email for the same
 * load date replaces it (orders keyed later). Any app reads it from there; nothing else writes it.
 *
 * The PDF is read with pdf.js (pdfjs-dist): each field is its own piece of text, so lines are put back together by height
 * on the page and each piece goes to the column whose heading it sits under. A line with the left columns blank belongs to
 * the stop above it.
 */
'use strict';

const MAX_BYTES = 15 * 1024 * 1024;
const COLS = ['LoadDate', 'RtNo', 'LoadSeq', 'CusChn', 'CusNo', 'CusName', 'ItemNo', 'Descrip', 'Qty'];
const fail = (code, message) => require('./admin').fail(code, message);
const dayText = (v) => require('./logic').dateText(v);
const num = (s) => { const v = Number(String(s).replace(/,/g, '')); return isFinite(v) ? v : null; };

let pdfjs = null;
async function loadPdfjs() {
  // Found with require.resolve so the hub's tests (which load this file with their own packages) find it too.
  if (!pdfjs) pdfjs = await import(require('url').pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
  return pdfjs;
}

/** Every page's text pieces grouped into lines: [[{x, s}], ...] top to bottom, each line left to right. */
async function pdfLines(buffer) {
  const lib = await loadPdfjs();
  let doc;
  try { doc = await lib.getDocument({ data: new Uint8Array(buffer), disableFontFace: true, useSystemFonts: false, isEvalSupported: false, verbosity: 0 }).promise; }
  catch (e) { return null; }
  const out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    const rows = new Map();
    for (const it of tc.items) {
      const s = String(it.str || '').trim();
      if (!s) continue;
      const y = Math.round(it.transform[5]);
      const key = [...rows.keys()].find(k => Math.abs(k - y) <= 2);
      const k = key === undefined ? y : key;
      (rows.get(k) || rows.set(k, []).get(k)).push({ x: it.transform[4], s });
    }
    [...rows.keys()].sort((a, b) => b - a).forEach(k => out.push(rows.get(k).sort((a, b) => a.x - b.x)));
  }
  await doc.destroy();
  return out;
}

/** Reads one Daily Load By Route PDF: {load_date, lines: [...]}; throws (BAD_REQUEST) in plain words. */
async function readLoadPdf(buffer, fileName) {
  const name = String(fileName || 'file');
  if (!buffer || !buffer.length) fail('BAD_REQUEST', 'The file is empty');
  if (buffer.length > MAX_BYTES) fail('BAD_REQUEST', 'The file is too big (more than 15 MB)');
  if (!/\.pdf$/i.test(name)) fail('BAD_REQUEST', 'Pick the Daily Load By Route PDF');
  const rows = await pdfLines(buffer);
  if (!rows) fail('BAD_REQUEST', name + ' is not a PDF that can be read');
  let edges = null, last = null;
  const lines = [], dates = new Set();
  for (const row of rows) {
    const words = row.map(r => r.s);
    if (COLS.every(c => words.indexOf(c) >= 0)) {
      // The heading line (on every page): a piece belongs to the heading it is closest to on the left, with the
      // boundary halfway between two headings (numbers sit right-aligned under them, names start a little before).
      const xs = COLS.map(c => row.find(r => r.s === c).x);
      edges = xs.slice(1).map((x, i) => (xs[i] + x) / 2);
      continue;
    }
    if (!edges) continue;
    const f = {};
    for (const r of row) {
      let i = edges.findIndex(e => r.x < e);
      if (i < 0) i = COLS.length - 1;
      f[COLS[i]] = f[COLS[i]] ? f[COLS[i]] + ' ' + r.s : r.s;
    }
    // A long description runs into the quantity as one piece (VENTURA ... TOTE 37059): the last number is the quantity.
    if (!f.Qty && f.Descrip) { const t = /^(.*\S)\s+(-?[\d,]+(?:\.\d+)?)$/.exec(f.Descrip); if (t) { f.Descrip = t[1]; f.Qty = t[2]; } }
    const qty = num(f.Qty), item = num(f.ItemNo);
    if (qty === null || item === null || !f.Descrip) continue;
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(f.LoadDate || ''));
    if (m) {
      last = { date: m[3] + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0'), route: num(f.RtNo), seq: num(f.LoadSeq) || 0,
        chain: num(f.CusChn) || 0, customer_no: num(f.CusNo), customer: String(f.CusName || '').trim() };
    } else if (!last || f.RtNo || f.CusNo) continue;
    if (last.route === null || last.customer_no === null) continue;
    dates.add(last.date);
    lines.push({ route: last.route, seq: last.seq, chain: last.chain, customer_no: last.customer_no, customer: last.customer,
      item_no: item, item: String(f.Descrip).trim(), qty });
  }
  if (!lines.length) fail('BAD_REQUEST', name + ' is not the Daily Load By Route report');
  if (dates.size > 1) fail('BAD_REQUEST', name + ' has more than one load date (' + [...dates].sort().map(dayText).join(', ') + ')');
  return { load_date: [...dates][0], lines };
}

/** Totals by route: stops (customers), lines and quantity. */
function routeTotals(lines) {
  const by = new Map();
  for (const l of lines) {
    const t = by.get(l.route) || { route: l.route, stops: new Set(), lines: 0, qty: 0 };
    t.stops.add(l.chain + ':' + l.customer_no); t.lines++; t.qty += l.qty;
    by.set(l.route, t);
  }
  return [...by.values()].sort((a, b) => a.route - b.route).map(t => ({ route: t.route, stops: t.stops.size, lines: t.lines, qty: Math.round(t.qty * 1000) / 1000 }));
}

/** Saves one load date; a later email replaces an earlier one, an older one never replaces a newer one. */
async function saveLoadDay(db, read, how) {
  const ref = db.collection('dailyLoads').doc(read.load_date);
  const old = await ref.get();
  const received = how.received || how.stamp;
  if (old.exists && old.data().received && old.data().received > received) return { date: read.load_date, dateText: dayText(read.load_date), changed: false, older: true, lines: read.lines.length };
  const same = old.exists && JSON.stringify(old.data().lines) === JSON.stringify(read.lines);
  const routes = routeTotals(read.lines);
  if (!same) {
    await ref.set({ load_date: read.load_date, lines: read.lines, routes, route_count: routes.length,
      stops: routes.reduce((a, r) => a + r.stops, 0), qty: Math.round(read.lines.reduce((a, l) => a + l.qty, 0) * 1000) / 1000,
      file: String(how.file || '').slice(0, 120), source: how.source, received, savedAt: how.stamp, savedBy: how.by });
  }
  return { date: read.load_date, dateText: dayText(read.load_date), changed: !same, lines: read.lines.length, routes: routes.length };
}

async function recentDays(db) {
  const snap = await db.collection('dailyLoads').select('load_date', 'route_count', 'stops', 'qty', 'file', 'source', 'received', 'savedAt').get();
  return snap.docs.map(d => d.data()).sort((a, b) => a.load_date < b.load_date ? 1 : -1).slice(0, 14);
}

module.exports = { readLoadPdf, saveLoadDay, routeTotals, recentDays, COLS };

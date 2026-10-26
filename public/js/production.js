// Plant Production (Joe 10/11: our own RedZone): what the Line Targets page, the line tablet and the production TV read.
// The lines are the plant's machines (Plant Operations); each line's products, speeds, targets, UPCs and shelf lives are the
// plant's Products list (Administration > Products); the shift is the plant's Plant Production shift (Plant Shifts).
import { collection, doc, query, where, onSnapshot } from './firebase.js';
import { watchProducts } from './products.js';

const U = () => window.UDPlant, R = () => window.UDProduction;
const plantOf = (d) => String(d.facilityId || '').trim() || 'fac_uniontown';

// cb(data) each time something changes: {lines, products, counters, shifts, runs, shift}. The shift's runs are re-read when the
// shift changes (checked each minute). nowFn lets a test set the clock.
export function watchProduction(db, facilityId, cb, fail, nowFn) {
  const now = nowFn || (() => Date.now());
  const data = { setup: [], products: {}, counters: {}, lineInfo: {}, shifts: [], runs: {}, prevRuns: {}, shift: null, prevShift: null, read: { setup: false, products: false } };
  const send = () => {
    const lines = U().productionLines(data.setup.filter(d => plantOf(d) === facilityId));
    cb(Object.assign({}, data, { lines }));
  };
  let stopRuns = null, stopPrev = null;
  const watchRuns = () => {
    const s = R().shiftNow(data.shifts, now()), prev = R().shiftNow(data.shifts, Date.parse(s.start) - 60000);
    // The plant's own shifts can arrive after the first read: the shift before can change while this one keeps its key.
    if (data.shift && data.shift.key === s.key && data.prevShift && data.prevShift.key === prev.key) { data.shift = s; return; }
    data.shift = s;
    if (stopRuns) stopRuns();
    if (stopPrev) stopPrev();
    data.runs = {}; data.prevRuns = {};
    // The shift before this one (Joe 10/14, mock-up F): its notes for this shift.
    data.prevShift = prev;
    stopPrev = onSnapshot(query(collection(db, 'productionRuns'), where('shiftKey', '==', data.prevShift.key)), q => {
      data.prevRuns = {};
      q.docs.forEach(d => { const v = d.data(); if (plantOf(v) === facilityId) data.prevRuns[v.operationId] = v; });
      send();
    }, () => {});
    stopRuns = onSnapshot(query(collection(db, 'productionRuns'), where('shiftKey', '==', s.key)), q => {
      data.runs = {};
      q.docs.forEach(d => { const v = d.data(); if (plantOf(v) === facilityId) data.runs[v.operationId] = v; });
      send();
    }, fail);
  };
  watchRuns();
  const subs = [
    onSnapshot(collection(db, 'plantSetup'), s => { data.setup = s.docs.map(d => d.data()); data.read.setup = true; send(); }, fail),
    watchProducts(db, p => { data.products = p; data.read.products = true; send(); }, fail),
    onSnapshot(collection(db, 'productionLines'), s => { data.counters = {}; data.lineInfo = {}; s.docs.forEach(d => { const v = d.data(); data.counters[v.operationId] = v.counter; data.lineInfo[v.operationId] = v; }); send(); }, () => {}),
    onSnapshot(doc(db, 'plantShifts', facilityId), s => { data.shifts = s.exists() ? s.data().shifts || [] : []; watchRuns(); send(); }, () => {})
  ];
  const tick = setInterval(() => { watchRuns(); send(); }, 30000);
  return () => { clearInterval(tick); subs.forEach(u => u()); if (stopRuns) stopRuns(); if (stopPrev) stopPrev(); };
}

// The plant's Blow Mold's latest head weights (Joe 10/14: the Gallon Filler's empty jug is their average).
function blowHeads(data, line) {
  const fac = plantOf((data.lineInfo || {})[line.operationId] || line);
  return Object.values(data.lineInfo || {}).filter(x => x && x.headsLast && R().lineKind(x.line) === 'BLOWMOLD' && plantOf(x) === fac)
    .map(x => x.headsLast).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0] || null;
}
// Joe 10/14: the lines feeding a packing line (Line Targets "Fed by"), with what each made this shift.
function feeders(data, line, nowMs) {
  const ids = ((data.lineInfo || {})[line.operationId] || {}).fedBy;
  if (!Array.isArray(ids) || !ids.length) return [];
  return (data.lines || []).filter(l => ids.indexOf(l.operationId) >= 0).map(l => {
    const run = (data.runs || {})[l.operationId] || null;
    return { operationId: l.operationId, name: l.name, made: run ? R().lineNow(run, R().targetsFor(data.products[l.operationId] || []), nowMs).made : 0 };
  });
}
// One line now: the line, its targets (its products), how it is counted and lineNow() for this shift.
export function lineView(data, line, nowMs) {
  const targets = R().targetsFor(data.products[line.operationId] || []);
  const run = data.runs[line.operationId] || null;
  // Joe 10/14 (mock-ups A to H): lineMore() adds the changeover, CIP, waste, checks, crew, efficiency and the HTST and Blow Mold readings.
  const kind = R().lineKind(line.name), prev = (data.prevRuns || {})[line.operationId] || null;
  const v = Object.assign({ line, targets, counter: data.counters[line.operationId] || 'TABLET', run, prevRun: prev, prevShift: data.prevShift || null, prevNote: prev ? String(prev.note || '').trim() : '', prevNoteBy: prev ? prev.noteBy || '' : '' },
    R().lineMore(run, targets, nowMs, kind, (data.lineInfo || {})[line.operationId] || {}, { blowHeads: blowHeads(data, line), lineName: line.name, feeders: feeders(data, line, nowMs) }));
  // Before the shift's first tap, today's code is still the shift's day plus the product's shelf life.
  if (!v.expectedCode && v.target && data.shift) v.expectedCode = R().codeDate(data.shift.date, v.target.shelfLifeDays);
  return v;
}

export const fmt = (n) => (n === null || n === undefined || n === '' ? '' : Number(n).toLocaleString('en-US'));
export const clock = (iso) => { const t = Date.parse(iso || ''); return isFinite(t) ? new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''; };
const twelve = (hhmm) => { const m = /^(\d\d):(\d\d)$/.exec(hhmm || ''); if (!m) return ''; const h = Number(m[1]); return ((h + 11) % 12 + 1) + ':' + m[2] + ' ' + (h < 12 ? 'AM' : 'PM'); };
// "First Shift 6:00 AM to 2:30 PM" from a shiftNow() result.
export function shiftText(s) {
  if (!s) return '';
  if (s.name === 'Today') return 'All day';
  const t = (iso) => { const d = new Date(iso); return twelve(String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')); };
  return s.name + ' ' + t(s.start) + ' to ' + t(s.end);
}

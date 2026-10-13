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
  const data = { setup: [], products: {}, counters: {}, lineInfo: {}, shifts: [], runs: {}, shift: null, read: { setup: false, products: false } };
  const send = () => {
    const lines = U().productionLines(data.setup.filter(d => plantOf(d) === facilityId));
    cb(Object.assign({}, data, { lines }));
  };
  let stopRuns = null;
  const watchRuns = () => {
    const s = R().shiftNow(data.shifts, now());
    if (data.shift && data.shift.key === s.key) { data.shift = s; return; }
    data.shift = s;
    if (stopRuns) stopRuns();
    data.runs = {};
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
  return () => { clearInterval(tick); subs.forEach(u => u()); if (stopRuns) stopRuns(); };
}

// One line now: the line, its targets (its products), how it is counted and lineNow() for this shift.
export function lineView(data, line, nowMs) {
  const targets = R().targetsFor(data.products[line.operationId] || []);
  const run = data.runs[line.operationId] || null;
  const v = Object.assign({ line, targets, counter: data.counters[line.operationId] || 'TABLET', run }, R().lineNow(run, targets, nowMs));
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

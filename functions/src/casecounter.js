/*
 * Case counters (Joe 10/22, United_Dairy_Case_Counter_Hookup_Guide.pdf): a counter box (a CLICK PLC with a laser and a
 * photo-eye) keeps a running total of the cases it has seen. The plant PC reads that total, READ-ONLY, with the same program
 * as a machine controller (tools/device-bridge --controller) and sends it to deviceReads with the counter's key.
 *
 *   PALLETIZER     right before the palletizer: the cases go on the Case loadout's load being loaded now.
 *   RETURNS        the case returns coming out of a trailer: the cases go on the trailer being unloaded now.
 *
 * Joe 10/23 ("the cases need to be put in prior to loading. And then the case counter counts and does a comparison"): the
 * counter never changes Cases Out or Cases In. What it counted is kept on its own (caseCounts), and Daily Case Loadout and
 * Unloading & Washing show it beside the typed number: matches, short or over.
 *
 *   caseCounters/{id}  the counter's setup (Administration > Case Counters): brand, IP address, port, unit id, where the
 *                      running total is; its last total, when the PC last sent, and cases counted with nothing loading.
 *   caseCounts/{id}    what one counter counted on one load (LOAD) or one unload (UNLOAD), with the day it is shown on.
 */
'use strict';

const L = require('./logic');
const R = require('./plant-rules');
const P = require('./production-rules');
// plant.js reaches this file through weightjoin.js and reader.js, so it is read when first needed.
const plant = () => require('./plant');

const text = (v) => (v === null || v === undefined ? '' : String(v).trim());
const docId = (id) => String(id).replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 200);
const numOrNull = (v) => (v === null || v === undefined || text(v) === '' || !isFinite(Number(v)) ? null : Number(v));
const when = (v) => { const t = Date.parse(v || ''); return isFinite(t) ? t : 0; };

const COUNTERS = Object.freeze({
  palletizer: { id: 'palletizer', name: 'Palletizer', kind: 'LOAD', where: 'Right before the palletizer. Counts the cases on the Case load being loaded.' },
  case_returns: { id: 'case_returns', name: 'Case Returns', kind: 'UNLOAD', where: 'Where the case returns come out of the trailer. Counts the cases on the trailer being unloaded.' }
});
// The boxes on Administration > Case Counters. The counter box is read like a machine controller with one reading.
const FIELDS = ['brand', 'ip', 'port', 'unit', 'wordOrder', 'countTag', 'countSize'];
// A jump this big is a new counter box or a wrong register, not cases counted in seconds: count from here.
const BIG_JUMP = 5000;
const BY = 'case counter';

class CounterError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function counterOf(id) {
  const c = COUNTERS[text(id)];
  if (!c) throw new CounterError('BAD_REQUEST', 'Pick the Palletizer or the Case Returns counter.');
  return c;
}

// What the plant PC needs: where the counter box is and where its running total is (reader.js configOut's shape).
function configOut(cfg) {
  const c = cfg || {};
  if (!text(c.brand) || !text(c.ip)) return null;
  const readings = text(c.countTag) ? { count: { tag: text(c.countTag), size: numOrNull(c.countSize) || 32 } } : {};
  return { brand: text(c.brand), ip: text(c.ip), port: numOrNull(c.port), slot: numOrNull(c.slot), rack: numOrNull(c.rack), unit: numOrNull(c.unit), wordOrder: text(c.wordOrder) || 'HIGH_FIRST', readings };
}

// The Case load being loaded now: today's and yesterday's still-open Case loads that are loading (not paused); with two
// loading at once, the one started last (the palletizer feeds the load the crew just started).
async function loadingCaseLoad(tx, db, now) {
  const today = L.operatingDay(now), dates = [today, L.addDays(today, -1)];
  const weeks = [...new Set(dates.flatMap(d => L.weeksForLoadDate(d)))];
  const runs = (await tx.get(db.collection('runs').where('weekStart', 'in', weeks))).docs.map(d => Object.assign({}, d.data(), { id: d.id }));
  let best = null;
  runs.forEach(run => {
    if (text(run.routeStatus || 'ACTIVE').toUpperCase() !== 'ACTIVE' || run.active === false) return;
    dates.forEach(d => L.loadBlocksFor(run, d).forEach(b => {
      const day = run.days[b.prefix];
      if (plant().runAreaOf(run, b.prefix) !== 'CASE' || !plant().dayLoadingNow(day)) return;
      const started = when(day.plantStartedAt);
      if (!best || started > best.started) best = { started, run, prefix: b.prefix, date: d };
    }));
  });
  if (!best) return null;
  return { id: docId('LOAD_' + best.run.id + '_' + best.prefix), kind: 'LOAD', date: best.date, runDocId: best.run.id, day: best.prefix, route: text(best.run.route), run: text(best.run.run) };
}
// The trailer being unloaded now (one unload at a time, as Unloading & Washing allows), today's or yesterday's.
async function unloadingNow(tx, db, now) {
  const today = L.operatingDay(now), dates = [today, L.addDays(today, -1)];
  const docs = (await tx.get(db.collection('plantJournal').where('date', 'in', dates))).docs.map(d => d.data());
  for (const date of dates) {
    const all = R.latestUnloads(docs, date), key = Object.keys(all).find(k => all[k].startedAt && !all[k].completedAt);
    if (key) return { id: docId('UNLOAD_' + key), kind: 'UNLOAD', date, unloadKey: key, route: all[key].route, run: all[key].run };
  }
  return null;
}

// One reading from the plant PC: the cases counted since the last reading go on the load (or unload) going on now.
async function applyCount(db, id, r, opts) {
  const o = Object.assign({ now: () => new Date() }, opts || {});
  const counter = counterOf(id);
  return db.runTransaction(async (tx) => {
    const ref = db.collection('caseCounters').doc(counter.id), cd = (await tx.get(ref)).data() || {};
    const now = o.now(), stamp = now.toISOString(), ms = now.getTime();
    const value = numOrNull(r && r.count), last = cd.last && numOrNull(cd.last.value) !== null ? numOrNull(cd.last.value) : null;
    let delta = 0;
    // The counter box's total only goes up; a smaller number means it was reset, so that number is all new cases.
    if (value !== null && value >= 0 && last !== null) {
      delta = value >= last ? value - last : value;
      if (delta > BIG_JUMP) delta = 0;
    }
    const errors = r && r.errors && typeof r.errors === 'object' ? Object.keys(r.errors).filter(k => text(r.errors[k])).map(k => text(r.errors[k]).slice(0, 200)).join(' · ') : '';
    const target = delta > 0 ? await (counter.kind === 'LOAD' ? loadingCaseLoad(tx, db, now) : unloadingNow(tx, db, now)) : null;
    const countRef = target ? db.collection('caseCounts').doc(target.id) : null;
    const had = countRef ? (await tx.get(countRef)).data() : null;
    // All reads done.
    const upd = {};
    if (value !== null && value !== last) upd.last = { value, at: stamp };
    if (!when(cd.heardAt) || ms - when(cd.heardAt) >= 60000 || errors !== text(cd.error)) { upd.heardAt = stamp; upd.error = errors; }
    let counted = null;
    if (target) {
      counted = (had ? Number(had.counted) || 0 : 0) + delta;
      tx.set(countRef, Object.assign({}, target, { counterId: counter.id, counted, firstAt: (had && had.firstAt) || stamp, lastAt: stamp, updatedBy: BY }));
    } else if (delta > 0) {
      // Cases with nothing loading (or unloading): kept for the day, so they are not lost from the day's total.
      const today = L.operatingDay(now), was = cd.noLoad && cd.noLoad.date === today ? Number(cd.noLoad.cases) || 0 : 0;
      upd.noLoad = { date: today, cases: was + delta, at: stamp };
    }
    if (Object.keys(upd).length) tx.set(ref, upd, { merge: true });
    return { counted: delta, on: target ? (target.route + ' ' + target.run).trim() : '', total: counted };
  });
}

// The plant PC's call for a case counter (reader.js handleReads): its reading and any Test read answer; back come the setup
// and any Test read asked for, so the PC needs only its key.
async function counterReads(db, id, b, opts) {
  const o = Object.assign({ now: () => new Date() }, opts || {});
  const counter = counterOf(id), ref = db.collection('caseCounters').doc(counter.id);
  if (b.test && typeof b.test === 'object' && text(b.test.askAt)) {
    const value = numOrNull(b.test.value);
    await ref.set({ controller: { testResult: { askAt: text(b.test.askAt).slice(0, 40), reading: 'count', value, error: value === null ? text(b.test.error).slice(0, 300) || 'No number came back.' : '', at: o.now().toISOString() } } }, { merge: true });
  }
  let out = {};
  if (b.controller && typeof b.controller === 'object') out = await applyCount(db, counter.id, b.controller, o);
  const cfg = ((await ref.get()).data() || {}).controller || {};
  const ask = cfg.testAsk && text(cfg.testAsk.at) ? { at: text(cfg.testAsk.at), reading: 'count' } : null;
  return Object.assign({ ok: true, counter: counter.id, config: configOut(cfg), testAsk: ask, count: out.total === undefined ? null : out.total }, out);
}

// Administration > Case Counters, administrators only (reader.js readerCall checks): the setup one box at a time, the
// counter's key, a Test read, and what each counter is doing now.
async function counterCall(db, email, input, opts) {
  const o = Object.assign({ now: () => new Date(), key: null, hash: null }, opts || {});
  const i = input || {}, op = text(i.op), at = o.now().toISOString();
  if (op === 'counters') {
    const today = L.operatingDay(o.now());
    const snaps = await Promise.all(Object.keys(COUNTERS).map(k => db.collection('caseCounters').doc(k).get()));
    return { ok: true, today, counters: Object.keys(COUNTERS).map((k, n) => Object.assign({}, COUNTERS[k], snaps[n].data() || {}, { id: k })) };
  }
  const counter = counterOf(i.counter), ref = db.collection('caseCounters').doc(counter.id);
  if (op === 'makeKey') {
    const key = o.key();
    await db.collection('private').doc('readDevices').set({ [counter.id]: { hash: o.hash(key), at, by: email, facilityId: 'fac_uniontown', area: 'CASE_COUNTER', kind: 'CONTROLLER', reads: 'COUNT', target: counter.id, name: counter.name } }, { merge: true });
    await ref.set({ keyAt: at, keyBy: email }, { merge: true });
    return { ok: true, key, message: 'New key for the ' + counter.name + ' counter. Copy it into the plant PC now: it is not shown again, and the old key stops working.' };
  }
  if (op === 'saveCounter') {
    const field = text(i.field);
    if (FIELDS.indexOf(field) < 0) throw new CounterError('BAD_REQUEST', 'Unknown box.');
    const cur = ((await ref.get()).data() || {}).controller || {};
    const r = P.controllerField(field, i.value, field === 'brand' ? text(i.value) : text(cur.brand));
    if (r.error) throw new CounterError('BAD_REQUEST', r.error);
    await ref.set({ controller: { [field]: r.value, updatedAt: at, updatedBy: email } }, { merge: true });
    return { ok: true, message: '' };
  }
  if (op === 'testRead') {
    const cfg = ((await ref.get()).data() || {}).controller || {};
    if (!text(cfg.brand) || !text(cfg.ip)) throw new CounterError('BAD_REQUEST', 'Pick the brand and type the IP address first.');
    if (!text(cfg.countTag)) throw new CounterError('BAD_REQUEST', 'Type where the case total is first.');
    await ref.set({ controller: { testAsk: { at, by: email, reading: 'count' } } }, { merge: true });
    return { ok: true, message: 'Asked the plant PC to read the ' + counter.name + ' counter. The number shows here in a few seconds.' };
  }
  throw new CounterError('BAD_REQUEST', 'Unknown case counter request.');
}

module.exports = { COUNTERS, FIELDS, BIG_JUMP, CounterError, configOut, applyCount, counterReads, counterCall, loadingCaseLoad, unloadingNow };

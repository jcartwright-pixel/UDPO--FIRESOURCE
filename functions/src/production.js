/*
 * Plant Production (Joe 10/11: our own RedZone): the line tablet's entries and each line's counter.
 *
 * saveLineEntry: one tap on a line tablet, for the line's shift (productionRuns/{operationId}__{shiftKey}):
 *   product  the product now running (a new run of the shift starts from now);
 *   count    the total made this shift so far (typed by the operator until a sensor or label reader sends it);
 *   stop     the line stopped (from now);       run     the line is running again (the open stop ends now);
 *   reason   why a stop happened (stopIndex = which stop).
 * The shift is worked out on the tablet (production-rules.js shiftNow) and sent with the entry; times are the server's.
 * saveLineCounter: how a line is counted (TABLET, SENSOR or READER), Line Targets (productionLines/{operationId}).
 * The products, their speeds, targets, UPCs and shelf lives are the plant's Products list (plantProducts), not kept here.
 */
'use strict';

const P = require('./production-rules');

const text = (v) => (v === null || v === undefined ? '' : String(v).trim());
const docId = (id) => String(id).replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 200);
const OPS = ['product', 'count', 'stop', 'run', 'reason'];
const STOP_LIMIT = 300, COUNT_LIMIT = 400, RUN_LIMIT = 100;

function lineId(v, SaveError) {
  const id = text(v).slice(0, 120);
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new SaveError('BAD_REQUEST', 'Pick a line.');
  return id;
}
async function lineOf(tx, db, operationId, SaveError) {
  const s = await tx.get(db.collection('plantSetup').doc(docId(operationId))), d = s.exists ? s.data() : null;
  if (!d || d.type !== 'PRODUCTION_AREA' || d.status !== 'ACTIVE') throw new SaveError('NOT_FOUND', 'That line is not set up for this plant.');
  return { name: text(d.name) || text(d.area) || operationId, facilityId: text(d.facilityId) || 'fac_uniontown' };
}

function validateLineEntry(input, SaveError) {
  const op = text(input.op).toLowerCase();
  if (OPS.indexOf(op) < 0) throw new SaveError('BAD_REQUEST', 'Unknown line tablet entry.');
  const shift = input.shift && typeof input.shift === 'object' ? input.shift : {};
  const out = { operationId: lineId(input.operationId, SaveError), op, shift: { key: text(shift.key).slice(0, 80), name: text(shift.name).slice(0, 40), date: text(shift.date), start: text(shift.start), end: text(shift.end) } };
  if (!/^\d{4}-\d\d-\d\d_[a-z0-9_]*$/.test(out.shift.key) || !/^\d{4}-\d\d-\d\d$/.test(out.shift.date) || !Date.parse(out.shift.start) || !Date.parse(out.shift.end)) throw new SaveError('BAD_REQUEST', 'The tablet did not send the shift. Reload the page.');
  if (op === 'product') {
    out.product = text(input.product).slice(0, 120);
    out.sku = text(input.sku).slice(0, 40);
    if (!out.product) throw new SaveError('BAD_REQUEST', 'Pick the product running.');
  }
  if (op === 'count') {
    const n = Number(input.count);
    if (text(input.count) === '' || !Number.isInteger(n) || n < 0 || n > 9999999) throw new SaveError('BAD_REQUEST', 'Type the number made this shift (a whole number).');
    out.count = n;
  }
  if (op === 'reason') {
    out.reason = text(input.reason).slice(0, 60);
    out.stopIndex = Number(input.stopIndex);
    if (!out.reason) throw new SaveError('BAD_REQUEST', 'Pick why the line stopped.');
    if (!Number.isInteger(out.stopIndex) || out.stopIndex < 0) throw new SaveError('BAD_REQUEST', 'Pick which stop.');
  }
  return out;
}
async function saveLineEntry(tx, db, req, email, stamp, logRef, mode, SaveError) {
  const line = await lineOf(tx, db, req.operationId, SaveError);
  const ref = db.collection('productionRuns').doc(docId(P.runId(req.operationId, req.shift.key))), had = await tx.get(ref);
  const before = had.exists ? had.data() : null;
  const run = before ? JSON.parse(JSON.stringify(before)) : { operationId: req.operationId, line: line.name, facilityId: line.facilityId, shiftKey: req.shift.key, shiftName: req.shift.name,
    date: req.shift.date, shiftStart: req.shift.start, shiftEnd: req.shift.end, product: '', sku: '', count: 0, counts: [], runs: [], stops: [], createdAt: stamp, createdBy: email };
  ['counts', 'runs', 'stops'].forEach(k => { if (!Array.isArray(run[k])) run[k] = []; });
  const open = run.stops.filter(s => !s.end)[0] || null;
  let message = line.name + ' saved.';
  if (req.op === 'product') {
    if (run.runs.length >= RUN_LIMIT) throw new SaveError('BAD_REQUEST', 'This shift has too many product changes to keep.');
    run.product = req.product; run.sku = req.sku;
    run.runs.push({ product: req.product, sku: req.sku, from: stamp, by: email });
    message = line.name + ' is running ' + req.product + '.';
  } else if (req.op === 'count') {
    run.count = req.count; run.countAt = stamp; run.countBy = email;
    run.counts.push({ at: stamp, count: req.count });
    if (run.counts.length > COUNT_LIMIT) run.counts = run.counts.slice(-COUNT_LIMIT);
    message = line.name + ': ' + req.count.toLocaleString('en-US') + ' made this shift.';
  } else if (req.op === 'stop') {
    if (open) throw new SaveError('CONFLICT', line.name + ' is already stopped.');
    if (run.stops.length >= STOP_LIMIT) throw new SaveError('BAD_REQUEST', 'This shift has too many stops to keep.');
    run.stops.push({ start: stamp, end: null, reason: '', by: email });
    message = line.name + ' stopped.';
  } else if (req.op === 'run') {
    if (!open) throw new SaveError('CONFLICT', line.name + ' is already running.');
    open.end = stamp; open.endBy = email;
    message = line.name + ' is running again.';
  } else {
    const s = run.stops[req.stopIndex];
    if (!s) throw new SaveError('NOT_FOUND', 'That stop is not on this shift.');
    s.reason = req.reason; s.reasonBy = email;
    message = line.name + ' stop: ' + req.reason + '.';
  }
  run.updatedAt = stamp; run.updatedBy = email;
  tx.set(ref, run);
  const result = { ok: true, requestId: req.requestId, operationId: req.operationId, shiftKey: req.shift.key, op: req.op, message };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, operationId: req.operationId, shiftKey: req.shift.key, op: req.op, before: before ? { product: before.product, count: before.count, stops: (before.stops || []).length } : null,
    after: { product: run.product, count: run.count, stops: run.stops.length }, result });
  return result;
}

function validateLineCounter(input, SaveError) {
  const counter = text(input.counter).toUpperCase();
  if (P.COUNTERS.indexOf(counter) < 0) throw new SaveError('BAD_REQUEST', 'Pick how this line is counted.');
  return { operationId: lineId(input.operationId, SaveError), counter };
}
async function saveLineCounter(tx, db, req, email, stamp, logRef, mode, SaveError) {
  const line = await lineOf(tx, db, req.operationId, SaveError);
  const ref = db.collection('productionLines').doc(docId(req.operationId)), had = await tx.get(ref);
  tx.set(ref, { operationId: req.operationId, line: line.name, facilityId: line.facilityId, counter: req.counter, updatedAt: stamp, updatedBy: email }, { merge: true });
  const result = { ok: true, requestId: req.requestId, operationId: req.operationId, counter: req.counter, message: line.name + ': ' + P.COUNTER_LABEL[req.counter] + '.' };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, operationId: req.operationId, before: had.exists ? had.data().counter || null : null, after: req.counter, result });
  return result;
}

module.exports = { validateLineEntry, saveLineEntry, validateLineCounter, saveLineCounter };

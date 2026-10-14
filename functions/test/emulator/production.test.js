'use strict';
// Plant Production (Joe 10/11): the line tablet's taps for a line's shift (product, count, stop, running again, why it
// stopped) and how each line is counted. Plant people may tap; only a manager or administrator sets how a line is counted.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const { applyAction } = require('../../src/actions');
const D = require('../../src/demo-sheets');
const PD = require('../fixtures/plant-demo');
const P = require('../../src/production-rules');

let n = 0;
const rid = () => 'line-request-' + (++n) + '-' + Date.now();
const MANAGER = 'manager.test@uniteddairy.com', DISPATCHER = 'dispatch.test@uniteddairy.com';
const LINE = 'ut_prod_gallon_filler';
const SHIFT = { key: '2026-10-08_first_shift', name: 'First Shift', date: '2026-10-08', start: '2026-10-08T10:00:00.000Z', end: '2026-10-08T18:30:00.000Z' };
const at = (iso) => () => new Date(iso);
const tap = (op, fields, when, email) => applyAction(db(), { email: email || MANAGER }, Object.assign({ action: 'saveLineEntry', requestId: rid(), operationId: LINE, op, shift: SHIFT }, fields || {}), when ? at(when) : undefined);
const run = async () => (await db().collection('productionRuns').doc(P.runId(LINE, SHIFT.key)).get()).data();

test.beforeEach(async () => {
  await clear();
  await runTransfer({ db: db(), reader: D.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date('2026-10-08T14:00:00Z') });
});

test('A shift on the Gallon Filler: product, counts, a stop and its reason, all on one record with server times', async () => {
  await tap('product', { product: 'Broughton 2% Gallon', sku: '50305' }, '2026-10-08T10:05:00Z');
  await tap('count', { count: 1000 }, '2026-10-08T11:00:00Z');
  await tap('stop', {}, '2026-10-08T11:10:00Z');
  await assert.rejects(tap('stop', {}, '2026-10-08T11:11:00Z'), /already stopped/);
  await tap('run', {}, '2026-10-08T11:18:00Z');
  await assert.rejects(tap('run', {}, '2026-10-08T11:19:00Z'), /already running/);
  await tap('reason', { reason: 'Caser jam', stopIndex: 0 }, '2026-10-08T11:20:00Z');
  await tap('count', { count: 2400 }, '2026-10-08T11:40:00Z');
  const r = await run();
  assert.equal(r.line, 'GALLON FILLER');
  assert.equal(r.shiftKey, SHIFT.key);
  assert.equal(r.product, 'Broughton 2% Gallon');
  assert.equal(r.count, 2400);
  assert.deepEqual(r.counts.map(c => c.count), [1000, 2400]);
  assert.deepEqual(r.stops.map(s => [s.start, s.end, s.reason]), [['2026-10-08T11:10:00.000Z', '2026-10-08T11:18:00.000Z', 'Caser jam']]);
  const v = P.lineNow(r, P.targetsFor([{ name: 'Broughton 2% Gallon', ratePerMin: 74, targetPct: 57.3, minSpeed: 60, maxSpeed: 70 }]), Date.parse('2026-10-08T11:40:00Z'));
  assert.equal(v.speed, 35, '1,400 in 40 minutes');
  assert.equal(v.speedFlag, 'UNDER');
  assert.equal(v.downMin, 8);
  const log = (await db().collection('actions').where('action', '==', 'saveLineEntry').get()).docs.length;
  assert.equal(log, 6, 'each saved tap is logged; the two refused ones are not');
});

test('Refused: an unknown line, no shift, a bad count, no reason and a stop not on the shift', async () => {
  await assert.rejects(applyAction(db(), { email: MANAGER }, { action: 'saveLineEntry', requestId: rid(), operationId: 'nope', op: 'stop', shift: SHIFT }), /not set up/);
  await assert.rejects(tap('stop', { shift: {} }), /did not send the shift/);
  await assert.rejects(tap('count', { count: 'lots' }), /whole number/);
  await assert.rejects(tap('reason', { reason: '', stopIndex: 0 }), /why the line stopped/);
  await assert.rejects(tap('reason', { reason: 'Other', stopIndex: 3 }), /not on this shift/);
});

test('A manager sets how a line is counted; a dispatcher may not', async () => {
  const done = await applyAction(db(), { email: MANAGER }, { action: 'saveLineCounter', requestId: rid(), operationId: LINE, counter: 'READER' });
  assert.match(done.message, /Label reader/);
  assert.equal((await db().collection('productionLines').doc(LINE).get()).data().counter, 'READER');
  await assert.rejects(applyAction(db(), { email: MANAGER }, { action: 'saveLineCounter', requestId: rid(), operationId: LINE, counter: 'MAGIC' }), /how this line is counted/);
  await assert.rejects(applyAction(db(), { email: DISPATCHER }, { action: 'saveLineCounter', requestId: rid(), operationId: LINE, counter: 'TABLET' }), /does not have a role/);
});

// Joe 10/14 ("all of your picks", mock-ups C to H): the tablet's six new buttons save on the same shift record.
test('Joe 10/14: changeover with its checklist, CIP wash, waste, a quality check, crew, notes and up next', async () => {
  await tap('product', { product: 'Broughton 2% Gallon', sku: '50305' }, '2026-10-08T10:05:00Z');
  await tap('changeover', { sub: 'start', to: '' }, '2026-10-08T11:00:00Z');
  await assert.rejects(tap('changeover', { sub: 'start' }, '2026-10-08T11:01:00Z'), /already in a changeover/);
  await tap('changeover', { sub: 'to', to: 'GV 2% Gallon' }, '2026-10-08T11:01:00Z');
  await tap('cocheck', { key: 'purge', done: true }, '2026-10-08T11:03:00Z');
  await tap('cocheck', { key: 'labels', done: true }, '2026-10-08T11:05:00Z');
  await tap('cocheck', { key: 'labels', done: false }, '2026-10-08T11:06:00Z');
  await assert.rejects(tap('cocheck', { key: 'Bad Key' }), /checklist line/);
  await tap('changeover', { sub: 'done' }, '2026-10-08T11:22:00Z');
  await assert.rejects(tap('changeover', { sub: 'done' }, '2026-10-08T11:23:00Z'), /not in a changeover/);
  await tap('cip', { sub: 'start' }, '2026-10-08T12:00:00Z');
  await tap('cip', { sub: 'done', result: 'PASS' }, '2026-10-08T12:40:00Z');
  await tap('waste', { reason: 'Leaker', qty: 12 }, '2026-10-08T13:00:00Z');
  await tap('waste', { reason: 'Bad cap', qty: 3 }, '2026-10-08T13:01:00Z');
  await tap('waste', { reason: 'Bad cap', qty: 0 }, '2026-10-08T13:02:00Z');
  await assert.rejects(tap('waste', { reason: 'Leaker', qty: 'a lot' }), /whole number/);
  await tap('check', { slot: 1, field: 'w1', value: '8.62' }, '2026-10-08T12:10:00Z');
  await tap('check', { slot: 1, field: 'capSeal', value: 'OK' }, '2026-10-08T12:11:00Z');
  await assert.rejects(tap('check', { slot: 1, field: 'w2', value: 'heavy' }), /number, or pick OK/);
  await tap('crew', { name: 'J. Myers', on: true }, '2026-10-08T10:00:00Z');
  await tap('crew', { name: 'C. Bell', on: true }, '2026-10-08T10:01:00Z');
  await tap('crew', { name: 'c. bell', on: false }, '2026-10-08T12:00:00Z');
  await tap('note', { text: 'Valve 14 sticking.' }, '2026-10-08T18:00:00Z');
  await tap('next', { product: 'GV Whole Gallon', qty: 4000 }, '2026-10-08T18:01:00Z');
  const r = await run();
  assert.equal(r.product, 'GV 2% Gallon', 'changeover done switches the product');
  assert.deepEqual(r.runs.map(x => [x.product, x.from]), [['Broughton 2% Gallon', '2026-10-08T10:05:00.000Z'], ['GV 2% Gallon', '2026-10-08T11:22:00.000Z']]);
  assert.deepEqual(Object.keys(r.changeovers[0].checks), ['purge']);
  assert.deepEqual([r.changeovers[0].from, r.changeovers[0].to, r.changeovers[0].end], ['Broughton 2% Gallon', 'GV 2% Gallon', '2026-10-08T11:22:00.000Z']);
  assert.deepEqual(r.cips.map(c => [c.result, c.end]), [['PASS', '2026-10-08T12:40:00.000Z']]);
  assert.deepEqual(r.waste, { Leaker: 12 });
  assert.deepEqual([r.checks['1'].w1, r.checks['1'].capSeal], ['8.62', 'OK']);
  assert.deepEqual(r.crew.map(c => [c.name, c.on]), [['J. Myers', true], ['C. Bell', false]]);
  assert.equal(r.note, 'Valve 14 sticking.');
  const line = (await db().collection('productionLines').doc(LINE).get()).data();
  assert.equal(line.lastCipAt, '2026-10-08T12:40:00.000Z', 'a CIP wash that passed is the line\'s last CIP');
  assert.deepEqual([line.next.product, line.next.qty], ['GV Whole Gallon', 4000]);
  assert.equal(r.next, undefined, 'up next is kept on the line, not the shift');
});

test('Joe 10/14: the HTST\'s divert, silo and tanks; the Blow Mold\'s resin lot and jugs ahead', async () => {
  await tap('divert', { sub: 'start', reason: 'Low temperature' }, '2026-10-08T11:00:00Z');
  await assert.rejects(tap('divert', { sub: 'start', reason: 'Test' }, '2026-10-08T11:01:00Z'), /already in divert/);
  await tap('divert', { sub: 'forward' }, '2026-10-08T11:04:00Z');
  await assert.rejects(tap('divert', { sub: 'forward' }, '2026-10-08T11:05:00Z'), /already in forward flow/);
  await tap('source', { from: 'Silo 3', to: 'Gallon Filler' }, '2026-10-08T11:06:00Z');
  await tap('lot', { lot: 'R-2291' }, '2026-10-08T11:07:00Z');
  await tap('stock', { count: 2300 }, '2026-10-08T11:08:00Z');
  await assert.rejects(tap('stock', { count: '' }), /how many jugs/);
  const r = await run();
  assert.deepEqual(r.diverts.map(d => [d.reason, d.start, d.end]), [['Low temperature', '2026-10-08T11:00:00.000Z', '2026-10-08T11:04:00.000Z']]);
  assert.deepEqual([r.source, r.lot, r.stock], [{ from: 'Silo 3', to: 'Gallon Filler' }, 'R-2291', 2300]);
  assert.equal((await db().collection('productionLines').doc(LINE).get()).data().lastDivertAt, '2026-10-08T11:00:00.000Z');
});

test('Joe 10/14: a manager sets the changeover standard and CIP hours; a dispatcher may not', async () => {
  await applyAction(db(), { email: MANAGER }, { action: 'saveLineCounter', requestId: rid(), operationId: LINE, counter: 'SENSOR' });
  await applyAction(db(), { email: MANAGER }, { action: 'saveLineSetup', requestId: rid(), operationId: LINE, changeoverMin: '20' });
  await applyAction(db(), { email: MANAGER }, { action: 'saveLineSetup', requestId: rid(), operationId: LINE, cipHours: '10' });
  let line = (await db().collection('productionLines').doc(LINE).get()).data();
  assert.deepEqual([line.changeoverMin, line.cipHours, line.counter], [20, 10, 'SENSOR'], 'each box saves alone and keeps the rest');
  await applyAction(db(), { email: MANAGER }, { action: 'saveLineSetup', requestId: rid(), operationId: LINE, cipHours: '' });
  line = (await db().collection('productionLines').doc(LINE).get()).data();
  assert.deepEqual([line.changeoverMin, line.cipHours], [20, null]);
  await assert.rejects(applyAction(db(), { email: MANAGER }, { action: 'saveLineSetup', requestId: rid(), operationId: LINE, changeoverMin: '9000' }), /from 0 to 600/);
  await assert.rejects(applyAction(db(), { email: DISPATCHER }, { action: 'saveLineSetup', requestId: rid(), operationId: LINE, changeoverMin: '15' }), /does not have a role/);
});

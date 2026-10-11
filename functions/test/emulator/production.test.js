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

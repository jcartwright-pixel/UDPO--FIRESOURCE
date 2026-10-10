'use strict';
// Unloading & Washing, Product Returns and Truck Washing saves (plant.js), on the made-up plant day (plant-demo.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const { applyAction } = require('../../src/actions');
const R = require('../../src/plant-rules');
const D = require('../../src/demo-sheets');
const PD = require('../fixtures/plant-demo');

const DISPATCHER = { email: 'dispatch.test@uniteddairy.com' };
const DATE = PD.PLANT_DATE;
let n = 0;
const rid = () => 'plant-request-' + (++n) + '-' + Date.now();
const tick = () => new Date('2026-10-08T16:00:00Z');
const copy = () => runTransfer({ db: db(), reader: D.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: tick });
const unload = (route, run, fields, extra) => applyAction(db(), DISPATCHER, Object.assign({ action: 'saveUnloading', requestId: rid(), date: DATE, route, run, fields }, extra || {}));
const journal = async () => (await db().collection('plantJournal').where('date', '==', DATE).get()).docs.map(d => d.data());

test.beforeEach(async () => { await clear(); await copy(); });

test('Unloading: one at a time, End needs the count, the count goes on the Live week, a typed trailer is T-', async () => {
  const r811 = '2026-10-04__run_p811';
  await assert.rejects(unload('811', 'UT DSD MILK', { start: true }), /Stop unloading 805 · UT DSD MILK before starting another/);
  await assert.rejects(unload('805', 'UT DSD MILK', { end: true }), /Enter the quantity before ending/);
  const counted = await unload('805', 'UT DSD MILK', { casesIn: '25' }, { runDocId: '2026-10-04__run_p805', day: 'thu' });
  assert.equal(counted.status, 'UNLOADING');
  assert.equal((await db().collection('runs').doc('2026-10-04__run_p805').get()).data().days.thu.plantCaseReturn, 25);
  assert.equal((await unload('805', 'UT DSD MILK', { end: true })).status, 'COMPLETE');
  assert.equal((await unload('811', 'UT DSD MILK', { start: true, }, { runDocId: r811, day: 'thu' })).status, 'UNLOADING');
  await unload('811', 'UT DSD MILK', { trailer: '977' }, { runDocId: r811, day: 'thu' });
  const now = R.latestUnloads(await journal(), DATE);
  assert.equal(now[DATE + '|805|UT DSD MILK'].casesIn, '25');
  assert.equal(now[DATE + '|805|UT DSD MILK'].status, 'COMPLETE');
  assert.equal(now[DATE + '|811|UT DSD MILK'].trailer, 'T-977');
  assert.equal(now[DATE + '|811|UT DSD MILK'].status, 'UNLOADING');
  // The next copy from the sheets keeps what the app saved.
  await copy();
  assert.equal(R.latestUnloads(await journal(), DATE)[DATE + '|811|UT DSD MILK'].trailer, 'T-977');
});

test('RTA: the dock\'s returns and the driver check-in\'s return go back to the cooler; an unknown return is refused', async () => {
  await unload('805', 'UT DSD MILK', { returnIds: ['ret805'] });
  await unload('811', 'UT DSD MILK', { returnIds: ['CHECKIN|2026-10-04__run_p811|thu'] }, { runDocId: '2026-10-04__run_p811', day: 'thu' });
  await assert.rejects(unload('811', 'UT DSD MILK', { returnIds: ['ret805'] }, { runDocId: '2026-10-04__run_p811', day: 'thu' }), /no longer matches this run/);
  const now = R.latestUnloads(await journal(), DATE);
  assert.deepEqual(now[DATE + '|805|UT DSD MILK'].removed, ['ret805']);
  assert.deepEqual(now[DATE + '|811|UT DSD MILK'].removed, ['CHECKIN|2026-10-04__run_p811|thu']);
  // RTA alone does not start or end the unload.
  assert.equal(now[DATE + '|811|UT DSD MILK'].status, 'WAITING');
});

test('Wash: closes the trailer\'s requests and records the wash; another trailer\'s request is refused', async () => {
  const out = await applyAction(db(), DISPATCHER, { action: 'completeWash', requestId: rid(), date: DATE, trailer: '951', close: [{ list: 'plantWash', id: 'wash_d1' }] });
  assert.deepEqual(out.closed, ['wash_d1']);
  const w = (await db().collection('plantWash').doc('wash_d1').get()).data();
  assert.equal(w.status, 'COMPLETE');
  assert.equal(w.completed_by, DISPATCHER.email);
  const done = R.washesDone(await journal());
  assert.ok(done['951'], 'the wash of T-951 is recorded');
  await assert.rejects(applyAction(db(), DISPATCHER, { action: 'completeWash', requestId: rid(), date: DATE, trailer: '951', close: [{ list: 'plantWash', id: 'wash_d2' }] }), /for trailer T-960/);
  // + Add Wash: a trailer with no request is recorded washed too.
  await applyAction(db(), DISPATCHER, { action: 'completeWash', requestId: rid(), date: DATE, trailer: 'T-993' });
  assert.ok(R.washesDone(await journal())['993']);
  // The copy keeps the wash done (the sheet still says OPEN until the write-back writes it).
  await copy();
  assert.equal((await db().collection('plantWash').doc('wash_d1').get()).data().status, 'COMPLETE');
});

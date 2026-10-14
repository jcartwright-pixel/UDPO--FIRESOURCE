'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const { applyAction } = require('../../src/actions');
const F = require('../fixtures/fake-sheets');

const MANAGER = { email: 'manager.test@uniteddairy.com' };
const DISPATCHER = { email: 'dispatch.test@uniteddairy.com' };
let n = 0;
const rid = () => 'otr-' + (++n) + '-' + Date.now();
const now = () => new Date('2026-10-04T16:00:00Z');

test.beforeEach(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now });
});

test('Over the Road: a manager ticks a run, types a month figure and fixes a day; a dispatcher cannot', async () => {
  await assert.rejects(applyAction(db(), DISPATCHER, { action: 'saveOtr', requestId: rid(), op: 'route', runId: 'run_t801', include: true, destination: 'SAL' }, now), /role/);
  await assert.rejects(applyAction(db(), MANAGER, { action: 'saveOtr', requestId: rid(), op: 'route', runId: 'run_t801', include: true, destination: '' }, now), /Pick where this route goes/);
  await applyAction(db(), MANAGER, { action: 'saveOtr', requestId: rid(), op: 'route', runId: 'run_t801', include: true, destination: 'save a lot' }, now);
  const route = (await db().collection('otrRoutes').doc('run_t801').get()).data();
  assert.equal(route.include, true);
  assert.equal(route.destination, 'SAL', 'destination names are matched like the current app');

  await assert.rejects(applyAction(db(), MANAGER, { action: 'saveOtr', requestId: rid(), op: 'figure', year: 2026, month: 9, key: 'gallons_sold', value: 'lots' }, now), /not a number/);
  await applyAction(db(), MANAGER, { action: 'saveOtr', requestId: rid(), op: 'figure', year: 2026, month: 9, key: 'gallons_sold', value: '1,250,000' }, now);
  await applyAction(db(), MANAGER, { action: 'saveOtr', requestId: rid(), op: 'figure', year: 2026, month: 9, key: 'distribution_cost', value: '$400,000' }, now);
  const sept = (await db().collection('otrMonthly').doc('2026-09').get()).data();
  assert.equal(sept.gallons_sold, 1250000);
  assert.equal(sept.distribution_cost, 400000, 'two figures for one month land on the same record');

  await applyAction(db(), MANAGER, { action: 'saveOtr', requestId: rid(), op: 'day', date: '2026-10-04', destination: 'Jersey', runs: 2 }, now);
  const day = (await db().collection('otrDaily').doc('2026-10-04__Jersey').get()).data();
  assert.equal(day.runs, 2);
  assert.equal(day.source, 'MANUAL');
});

test('Over the Road: a manager adds a By Date column (Darden), counts a day in it, and renames or removes it only while nothing uses it', async () => {
  const save = (f) => applyAction(db(), MANAGER, Object.assign({ action: 'saveOtr', requestId: rid() }, f), now);
  await assert.rejects(applyAction(db(), DISPATCHER, { action: 'saveOtr', requestId: rid(), op: 'column', verb: 'add', name: 'Darden' }, now), /role/);
  await assert.rejects(save({ op: 'column', verb: 'add', name: 'jersey' }), /already a column/);
  await assert.rejects(save({ op: 'day', date: '2026-10-04', destination: 'Darden', runs: 1 }), /from the list/);
  await save({ op: 'column', verb: 'add', name: 'Darden' });
  await assert.rejects(save({ op: 'column', verb: 'add', name: 'DARDEN' }), /already a column/);
  assert.equal((await db().collection('otrColumns').doc('DARDEN').get()).data().name, 'Darden');
  await save({ op: 'column', verb: 'rename', name: 'Darden', newName: 'Darden Foods' });
  assert.equal((await db().collection('otrColumns').doc('DARDEN').get()).exists, false);
  assert.equal((await db().collection('otrColumns').doc('DARDENFOODS').get()).data().name, 'Darden Foods');
  await save({ op: 'route', runId: 'run_t801', include: true, destination: 'Darden Foods', deliveredBy: 'Carrier Pickup' });
  await assert.rejects(save({ op: 'column', verb: 'remove', name: 'Darden Foods' }), /picked for a run/);
  await save({ op: 'route', runId: 'run_t801', include: false, destination: 'SAL', deliveredBy: 'Carrier Pickup' });
  await save({ op: 'day', date: '2026-10-04', destination: 'Darden Foods', runs: 2 });
  await assert.rejects(save({ op: 'column', verb: 'rename', name: 'Darden Foods', newName: 'Darden' }), /runs on the By Date tab/);
  await save({ op: 'day', date: '2026-10-04', destination: 'Darden Foods', runs: 0 });
  await save({ op: 'column', verb: 'remove', name: 'Darden Foods' });
  assert.equal((await db().collection('otrColumns').get()).size, 0);
  await assert.rejects(save({ op: 'column', verb: 'remove', name: 'Jersey' }), /workbook's own columns/);
});

test('Over the Road miles: held on the live app until config/app.otrMilesToRouteMaster is on; the Route Editor is not held', async () => {
  const keep = { R: process.env.READ_UNIONTOWN_SHEETS, S: process.env.SOURCES_JSON, D: process.env.DEMO_DATA };
  const miles = (from) => applyAction(db(), MANAGER, Object.assign({ action: 'saveRoute', requestId: rid(), runId: 'run_t801', fields: {}, days: { mon: { miles: '412' } } }, from ? { from } : {}), now);
  try {
    await miles('otr');
    assert.equal((await db().collection('routes').doc('run_t801').get()).data().days.mon.miles, 412, 'the test copy saves at once');
    process.env.READ_UNIONTOWN_SHEETS = '1'; delete process.env.SOURCES_JSON; delete process.env.DEMO_DATA;
    await assert.rejects(miles('otr'), /not switched on yet/);
    await miles('');
    await db().collection('config').doc('app').set({ otrMilesToRouteMaster: { enabled: true } }, { merge: true });
    await miles('otr');
  } finally {
    ['READ_UNIONTOWN_SHEETS', 'SOURCES_JSON', 'DEMO_DATA'].forEach((k, i) => { const v = [keep.R, keep.S, keep.D][i]; if (v === undefined) delete process.env[k]; else process.env[k] = v; });
  }
});

test('Driver Scorecard settings: a manager changes a point value and the call-off reasons; a bad number is refused', async () => {
  await assert.rejects(applyAction(db(), DISPATCHER, { action: 'saveScorecard', requestId: rid(), key: 'callOff', value: 5 }, now), /role/);
  await assert.rejects(applyAction(db(), MANAGER, { action: 'saveScorecard', requestId: rid(), key: 'callOff', value: 'x' }, now), /number/);
  await assert.rejects(applyAction(db(), MANAGER, { action: 'saveScorecard', requestId: rid(), key: 'nope', value: 1 }, now), /Unknown setting/);
  await applyAction(db(), MANAGER, { action: 'saveScorecard', requestId: rid(), key: 'callOff', value: '5' }, now);
  await applyAction(db(), MANAGER, { action: 'saveScorecard', requestId: rid(), callOffReasons: ['CALLED OFF', 'SICK DAY'] }, now);
  const s = (await db().collection('scorecard').doc('settings').get()).data();
  assert.equal(s.callOff, 5);
  assert.deepEqual(s.callOffReasons, ['CALLED OFF', 'SICK DAY']);
});

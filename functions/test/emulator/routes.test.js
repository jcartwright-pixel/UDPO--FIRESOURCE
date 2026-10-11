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
const rid = () => 'route-request-' + (++n) + '-' + Date.now();
const route = async (id) => (await db().collection('routes').doc(id).get()).data();

test.beforeEach(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: () => new Date('2026-10-09T12:00:00Z') });
});

test('Route Master is copied with every Route Editor column and the seven days', async () => {
  const r = await route('run_t801');
  assert.equal(r.loadType, 'Case Loadout');
  assert.equal(r.coverageOwner, 'Uniontown');
  assert.equal(r.days.mon.dispatchTime, 240);
  assert.equal(r.days.mon.miles, 140);
  assert.equal(r.days.mon.hours, '9:30');
  assert.equal(r.days.mon.loadDayOffset, -1);
  assert.equal(r.days.mon.trailer, 'T-901');
  assert.equal(r.days.wed.active, false);
  assert.equal((await route('run_t810')).sleeper, true);
});

test("a manager edits a run's standards, adds a run and drags the load order; a dispatcher cannot", async () => {
  await applyAction(db(), MANAGER, { action: 'saveRoute', requestId: rid(), runId: 'run_t801', fields: { loadType: 'Tote', displayPlant: false },
    days: { wed: { active: true, dispatchTime: '5 AM', miles: '150', trailer: '903', loadDayOffset: '-1' } } });
  const r = await route('run_t801');
  assert.equal(r.loadType, 'Tote');
  assert.equal(r.displayPlant, false);
  assert.deepEqual([r.days.wed.active, r.days.wed.dispatchTime, r.days.wed.miles, r.days.wed.trailer, r.days.wed.loadDayOffset], [true, 300, 150, 'T-903', -1]);
  assert.equal(r.days.mon.miles, 140, 'other days are kept');
  await assert.rejects(applyAction(db(), MANAGER, { action: 'saveRoute', requestId: rid(), runId: 'run_t801', days: { mon: { dispatchTime: 'early' } } }), /5 AM or 5:30 PM/);
  await assert.rejects(applyAction(db(), MANAGER, { action: 'saveRoute', requestId: rid(), runId: 'run_t801', days: { mon: { loadDayOffset: 2 } } }), /0 \(same day\) to -6/);
  await assert.rejects(applyAction(db(), DISPATCHER, { action: 'saveRoute', requestId: rid(), runId: 'run_t801', fields: { routeNotes: 'x' } }), /does not have a role/);

  const out = await applyAction(db(), MANAGER, { action: 'saveRoute', requestId: rid(), fields: { route: '805', routeName: 'NEW STOP', run: 'MARIETTA', coverageOwner: 'Marietta' }, days: { thu: { active: true } } });
  const added = await route(out.runId);
  assert.equal(added.createdInApp, true);
  assert.equal(added.days.thu.active, true);
  assert.equal(added.days.mon.active, false);
  // The minute copy keeps a run made in the new app.
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: () => new Date('2026-10-09T12:05:00Z') });
  assert.ok(await route(out.runId));

  await applyAction(db(), MANAGER, { action: 'reorderRouteDay', requestId: rid(), day: 'mon', runIds: ['run_t801', 'run_t802'] });
  assert.equal((await route('run_t801')).days.mon.loadOrder, 10);
  assert.equal((await route('run_t802')).days.mon.loadOrder, 20);
});

test('Show / Hide Rules: flipping Show Weekly in the Route Editor moves the run on Weekly at once', async () => {
  const L = require('../../src/logic');
  const runs = async () => (await db().collection('runs').where('runId', '==', 'run_t801').get()).docs.map(d => d.data());
  assert.ok((await runs()).length > 0, 'the fixture has Live rows for run_t801');
  await applyAction(db(), MANAGER, { action: 'saveRoute', requestId: rid(), runId: 'run_t801', fields: { displayWeekly: false }, days: {} });
  assert.equal((await route('run_t801')).displayWeekly, false);
  (await runs()).forEach(r => { assert.equal(r.weeklyShowMaster, false); assert.equal(L.weeklyRows([r], r.weekStart).length, 0); });
  await applyAction(db(), MANAGER, { action: 'saveRoute', requestId: rid(), runId: 'run_t801', fields: { displayWeekly: true }, days: {} });
  (await runs()).forEach(r => assert.equal(L.weeklyRows([r], r.weekStart).length, 1));
});

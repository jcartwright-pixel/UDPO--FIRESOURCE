'use strict';
// Joe 10/19 (800 Specials: "could be totes, could be cases, could be anything ... so it goes to the appropriate loading place"):
// a day's load type is picked on Daily Dispatch > Edit, and the Route Editor's Loadout Type reaches the days not loaded yet.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const { applyAction } = require('../../src/actions');
const F = require('../fixtures/fake-sheets');

const MANAGER = { email: 'manager.test@uniteddairy.com' };
const DISPATCHER = { email: 'dispatch.test@uniteddairy.com' };
let n = 0;
const rid = () => 'specials-' + (++n) + '-' + Date.now();
// Friday 10/9, 8 AM in New York: the Current week is 10/4, the Next week 10/11.
const NOW = () => new Date('2026-10-09T12:00:00Z');
const save = (user, input) => applyAction(db(), user, Object.assign({ requestId: rid() }, input), NOW);
const run = async (id) => (await db().collection('runs').doc(id).get()).data();
const NEXT = '2026-10-11__run_t801';

test.beforeEach(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: NOW });
});

test('Daily Dispatch sets one day\'s load type; blank goes back to the route\'s; nothing goes to the Live sheet', async () => {
  await db().collection('config').doc('app').set({ writeBack: { enabled: true } }, { merge: true });
  await save(DISPATCHER, { action: 'setLoadType', runDocId: NEXT, day: 'mon', loadType: 'Totes' });
  let r = await run(NEXT);
  assert.equal(r.days.mon.loadType, 'TOTES');
  assert.equal(r.days.mon.loadTypeByHand, true);
  assert.equal(r.loadType, 'Case Loadout', 'the route\'s own type is unchanged');
  assert.equal(r.days.tue.loadType, undefined, 'only that day changes');
  const cells = (await db().collection('outbox').get()).docs.map(d => d.data().cells || {});
  assert.ok(cells.every(c => !Object.keys(c).some(k => /load_?type/.test(k))), 'the load type stays in the app');
  await assert.rejects(save(DISPATCHER, { action: 'setLoadType', runDocId: NEXT, day: 'mon', loadType: 'Pallets' }), /Case, Totes, Boxes or Tanker/);
  await save(DISPATCHER, { action: 'setLoadType', runDocId: NEXT, day: 'mon', loadType: '' });
  r = await run(NEXT);
  assert.equal(r.days.mon.loadType, '');
  assert.equal(r.days.mon.loadTypeByHand, false);
});

test('the day\'s load type is kept when the run is copied again from the sheet', async () => {
  await save(DISPATCHER, { action: 'setLoadType', runDocId: NEXT, day: 'mon', loadType: 'BOXING' });
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: NOW, force: true });
  assert.equal((await run(NEXT)).days.mon.loadType, 'BOXING');
});

test('a Route Editor Loadout Type change reaches the days not loaded yet; a day picked on Daily keeps its type', async () => {
  await save(DISPATCHER, { action: 'setLoadType', runDocId: NEXT, day: 'mon', loadType: 'TANKER' });
  await save(MANAGER, { action: 'saveRoute', runId: 'run_t801', fields: { loadType: 'Tote' }, days: {} });
  const next = await run(NEXT);
  assert.equal(next.days.mon.loadType, 'TANKER', 'picked by hand on Daily');
  assert.equal(next.days.tue.loadType, 'TOTES');
  // The Current week: Monday 10/5 is already loaded and stays as it was.
  assert.equal((await run('2026-10-04__run_t801')).days.mon.loadType, undefined);
  // None: the days not loaded yet leave the plant's loadouts.
  await save(MANAGER, { action: 'saveRoute', runId: 'run_t801', fields: { loadType: 'None' }, days: {} });
  assert.equal((await run(NEXT)).days.tue.loadType, 'NONE');
  // A save that does not touch the Loadout Type leaves the days alone.
  await save(DISPATCHER, { action: 'setLoadType', runDocId: NEXT, day: 'tue', loadType: '' });
  await save(MANAGER, { action: 'saveRoute', runId: 'run_t801', fields: {}, days: { tue: { dispatchTime: '3 AM' } } });
  assert.equal((await run(NEXT)).days.tue.loadType, '');
});

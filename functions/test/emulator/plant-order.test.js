'use strict';
// Loadout Center loading order (reorderPlantLoads): the plant drags today's loads into a new order, saved as each day's
// load_sequence_override (the same numbers the loads had, smallest first). Only today's operating day can be changed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const { applyAction } = require('../../src/actions');
const D = require('../../src/demo-sheets');
const PD = require('../fixtures/plant-demo');

const LOADER = { email: 'viewer.test@uniteddairy.com' };   // a plant employee
const DATE = PD.PLANT_DATE;
let n = 0;
const rid = () => 'plant-order-' + (++n) + '-' + Date.now();
const noon = () => new Date(DATE + 'T16:00:00Z');           // noon in Uniontown on the plant day
const id = (route) => '2026-10-04__run_p' + route;
const order = (routes, loadDate, now) => applyAction(db(), LOADER, { action: 'reorderPlantLoads', requestId: rid(), loadDate: loadDate || DATE, order: routes.map(r => ({ runDocId: id(r), day: 'fri' })) }, now || noon);
const override = async (route) => (await db().collection('runs').doc(id(route)).get()).data().days.fri.loadSequenceOverride;

test.beforeEach(async () => {
  await clear();
  await runTransfer({ db: db(), reader: D.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date(DATE + 'T14:00:00Z') });
});

test('A plant employee reorders today\'s loads: the loads keep their order numbers, in the new order', async () => {
  const out = await order(['811', '808', '812']);
  assert.equal(out.ok, true);
  assert.deepEqual([await override('811'), await override('808'), await override('812')], [40, 50, 60]);
  const log = (await db().collection('actions').where('action', '==', 'reorderPlantLoads').get()).docs.map(d => d.data());
  assert.equal(log.length, 1);
  assert.equal(log[0].by, LOADER.email);
});

test('Only today: another day is refused, and so is a load that does not load today', async () => {
  // Joe 10/11: a coming day may be reordered too (here 10/09 has no Friday-delivery loads for these runs); a past day may not.
  await assert.rejects(order(['811', '808'], '2026-10-09'), /does not load on/);
  await assert.rejects(order(['811', '808'], DATE, () => new Date('2026-10-09T11:00:00Z')), /only be changed for today or a coming day/);
  // Before 6 AM the operating day is still the day before.
  assert.equal((await order(['812', '811'], DATE, () => new Date('2026-10-09T09:30:00Z'))).ok, true);
  await assert.rejects(applyAction(db(), LOADER, { action: 'reorderPlantLoads', requestId: rid(), loadDate: DATE, order: [{ runDocId: id('811'), day: 'thu' }, { runDocId: id('808'), day: 'fri' }] }, noon), /does not load on/);
});

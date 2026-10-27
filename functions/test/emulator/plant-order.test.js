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

test('Joe 10/16: a Skip (or a drag) marks the load that was moved with how and who; it stays in the app after a sheet read', async () => {
  const out = await applyAction(db(), LOADER, { action: 'reorderPlantLoads', requestId: rid(), loadDate: DATE, order: ['808', '812', '811'].map(r => ({ runDocId: id(r), day: 'fri' })),
    moved: { runDocId: id('811'), day: 'fri', how: 'SKIP' } }, noon);
  assert.equal(out.ok, true);
  const day = async (r) => (await db().collection('runs').doc(id(r)).get()).data().days.fri;
  const m = (await day('811')).moveMark;
  assert.deepEqual([m.how, m.by, m.via, m.station], ['SKIP', LOADER.email, 'DESK', '']);
  assert.ok(m.savedAt);
  assert.equal((await day('812')).moveMark, undefined, 'only the load that was moved is marked');
  const log = (await db().collection('actions').where('action', '==', 'reorderPlantLoads').get()).docs.map(d => d.data());
  assert.deepEqual(log[0].moved, { runDocId: id('811'), day: 'fri', how: 'SKIP' });
  // A Plant Station tablet names its station; a drag is DRAG.
  await applyAction(db(), LOADER, { action: 'reorderPlantLoads', requestId: rid(), loadDate: DATE, order: ['812', '808'].map(r => ({ runDocId: id(r), day: 'fri' })),
    moved: { runDocId: id('812'), day: 'fri', how: 'drag' }, station: 'Case Loadout' }, noon);
  assert.deepEqual([(await day('812')).moveMark.how, (await day('812')).moveMark.via, (await day('812')).moveMark.station], ['DRAG', 'TABLET', 'Case Loadout']);
  // The next read of the sheet keeps it (app-only, no Live sheet column).
  await runTransfer({ db: db(), reader: D.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date(DATE + 'T15:00:00Z') });
  assert.equal((await day('811')).moveMark.how, 'SKIP');
  await assert.rejects(applyAction(db(), LOADER, { action: 'reorderPlantLoads', requestId: rid(), loadDate: DATE, order: [{ runDocId: id('808'), day: 'fri' }], moved: { runDocId: id('811'), day: 'fri', how: 'SKIP' } }, noon), /not in the order/);
});

test('Joe 10/27: a Skip moves the load down one place whatever order the screen sent, and at most 2 times in a row', async () => {
  const CASE = ['801', '802', '805', '808', '811', '812', '815', '6301_1', '6302', '8302_1', '8303_1'];
  const day = async (r) => (await db().collection('runs').doc(id(r)).get()).data().days.fri;
  const skip = (r, sent, now) => applyAction(db(), LOADER, { action: 'reorderPlantLoads', requestId: rid(), loadDate: DATE, order: (sent || CASE).map(x => ({ runDocId: id(x), day: 'fri' })),
    moved: { runDocId: id(r), day: 'fri', how: 'SKIP' } }, now || noon);
  const shown = async () => (await Promise.all(CASE.map(async r => ({ r, n: (await day(r)).loadSequenceOverride })))).sort((a, b) => a.n - b.n).map(x => x.r);
  // The screen sent 811 at the bottom (the way it went "clear down to the bottom"): it goes down one place only, after 812.
  await skip('811', CASE.filter(r => r !== '811').concat('811'));
  assert.deepEqual(await shown(), ['801', '802', '805', '808', '812', '811', '815', '6301_1', '6302', '8302_1', '8303_1']);
  assert.equal((await day('811')).moveMark.skips, 1);
  await skip('811');
  assert.deepEqual((await shown()).slice(4, 7), ['812', '815', '811']);
  assert.equal((await day('811')).moveMark.skips, 2);
  // A third Skip in a row is refused, and the order stays as it was.
  await assert.rejects(skip('811'), /Route 811 was already skipped 2 times in a row\. Load it next\./);
  assert.deepEqual((await shown()).slice(4, 7), ['812', '815', '811']);
  // Once another load starts loading, the count starts again.
  await db().collection('runs').doc(id('812')).update({ 'days.fri.plantStartedAt': DATE + 'T16:30:00Z' });
  await skip('811', null, () => new Date(DATE + 'T16:40:00Z'));
  assert.deepEqual((await shown()).slice(4, 8), ['812', '815', '6301_1', '811']);
  assert.equal((await day('811')).moveMark.skips, 1);
  // A load already loading, and the last load still to load, have no Skip.
  await assert.rejects(skip('808'), /Route 808 is already loading/);
  await assert.rejects(skip('8303_1'), /Route 8303 is the last load still to load/);
  // A drag is not a skip: the next Skip counts from 1 again.
  await applyAction(db(), LOADER, { action: 'reorderPlantLoads', requestId: rid(), loadDate: DATE, order: CASE.map(x => ({ runDocId: id(x), day: 'fri' })), moved: { runDocId: id('815'), day: 'fri', how: 'DRAG' } }, noon);
  assert.equal((await day('815')).moveMark.skips, undefined);
});

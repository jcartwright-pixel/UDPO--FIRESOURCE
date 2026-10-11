'use strict';
// Plant Shifts (Joe 10/10): Administration keeps each plant's shifts; Plant Reports compare the shifts by these times. A manager
// or administrator saves them; a dispatcher may not, and every shift needs a name and a start and end time.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const { applyAction } = require('../../src/actions');
const D = require('../../src/demo-sheets');
const PD = require('../fixtures/plant-demo');

let n = 0;
const rid = () => 'shifts-request-' + (++n) + '-' + Date.now();
const act = (email, fields) => applyAction(db(), { email }, Object.assign({ action: 'savePlantShifts', requestId: rid() }, fields));
const MANAGER = 'manager.test@uniteddairy.com', DISPATCHER = 'dispatch.test@uniteddairy.com';
const UNIONTOWN = [{ name: 'First Shift', start: '06:00', end: '14:30' }, { name: 'Second Shift', start: '14:00', end: '22:30' }, { name: 'Third Shift', start: '22:00', end: '05:30' }];

test.beforeEach(async () => {
  await clear();
  await runTransfer({ db: db(), reader: D.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date('2026-10-08T16:00:00Z') });
});

test('A manager saves Uniontown\'s three shifts and the change is logged', async () => {
  const done = await act(MANAGER, { facilityId: 'fac_uniontown', shifts: UNIONTOWN });
  assert.equal(done.count, 3);
  const saved = (await db().collection('plantShifts').doc('fac_uniontown').get()).data();
  // Joe 10/11: a shift sent with no side is a Distribution shift.
  assert.deepEqual(saved.shifts, UNIONTOWN.map(x => Object.assign({}, x, { side: 'DISTRIBUTION' })));
  assert.equal(saved.updatedBy, MANAGER);
  const log = (await db().collection('actions').where('action', '==', 'savePlantShifts').get()).docs.map(d => d.data());
  assert.equal(log.length, 1);
});

test('Joe 10/11: a plant keeps Distribution and Plant Production shifts; the same name may be on both sides', async () => {
  const both = UNIONTOWN.map(x => Object.assign({}, x, { side: 'DISTRIBUTION' })).concat([{ name: 'First Shift', start: '07:00', end: '15:30', side: 'PRODUCTION' }]);
  const done = await act(MANAGER, { facilityId: 'fac_uniontown', shifts: both });
  assert.equal(done.count, 4);
  assert.deepEqual((await db().collection('plantShifts').doc('fac_uniontown').get()).data().shifts, both);
  await assert.rejects(act(MANAGER, { facilityId: 'fac_uniontown', shifts: [Object.assign({}, UNIONTOWN[0], { side: 'NIGHTS' })] }), /Distribution or Plant Production/);
});

test('Refused: a dispatcher, no name, a missing time, a name twice, no plant', async () => {
  await assert.rejects(act(DISPATCHER, { facilityId: 'fac_uniontown', shifts: UNIONTOWN }), /does not have a role/);
  await assert.rejects(act(MANAGER, { facilityId: 'fac_uniontown', shifts: [{ name: '', start: '06:00', end: '14:30' }] }), /needs a name/);
  await assert.rejects(act(MANAGER, { facilityId: 'fac_uniontown', shifts: [{ name: 'Day', start: '06:00', end: '' }] }), /start and end times/);
  await assert.rejects(act(MANAGER, { facilityId: 'fac_uniontown', shifts: [UNIONTOWN[0], Object.assign({}, UNIONTOWN[1], { name: 'first shift' })] }), /on the list twice/);
  await assert.rejects(act(MANAGER, { facilityId: '', shifts: UNIONTOWN }), /Pick a plant/);
});

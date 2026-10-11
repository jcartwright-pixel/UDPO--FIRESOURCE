'use strict';
// Daily Dispatch: a truck or trailer number typed in the cell (review item D4). The current app took any number: one that is
// on Equipment Master is used as that unit (same checks); one that is not is kept as typed, trailers as T-###.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const { applyAction } = require('../../src/actions');
const F = require('../fixtures/fake-sheets');

const DISPATCHER = { email: 'dispatch.test@uniteddairy.com' };
const RUN = '2026-10-04__run_t802';
let n = 0;
const rid = () => 'typed-unit-' + (++n) + '-' + Date.now();
test.beforeEach(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: () => new Date('2026-10-09T12:00:00Z') });
});
const day = async () => (await db().collection('runs').doc(RUN).get()).data().days.tue;

test('a typed unit not on Equipment Master is kept as typed; trailers get T-', async () => {
  await applyAction(db(), DISPATCHER, { action: 'assignTruck', requestId: rid(), runDocId: RUN, day: 'tue', equipmentId: '', unit: ' 223893 ' });
  await applyAction(db(), DISPATCHER, { action: 'assignTrailer', requestId: rid(), runDocId: RUN, day: 'tue', equipmentId: '', unit: '777' });
  const d = await day();
  assert.equal(d.truck, '223893');
  assert.equal(d.truckId, '');
  assert.equal(d.trailer, 'T-777');
  assert.equal(d.trailerId, '');
});

test('a typed unit that is on Equipment Master is used as that unit, with its checks', async () => {
  await applyAction(db(), DISPATCHER, { action: 'assignTrailer', requestId: rid(), runDocId: RUN, day: 'tue', equipmentId: '', unit: 't901' });
  const d = await day();
  assert.equal(d.trailerId, 'veh_trailer_t_901');
  assert.equal(d.trailer, 'T-901');
  await assert.rejects(applyAction(db(), DISPATCHER, { action: 'assignTrailer', requestId: rid(), runDocId: RUN, day: 'tue', equipmentId: '', unit: '903' }), /INACTIVE/);
});

test('an empty pick still clears the unit', async () => {
  await applyAction(db(), DISPATCHER, { action: 'assignTruck', requestId: rid(), runDocId: RUN, day: 'tue', equipmentId: '' });
  assert.equal((await day()).truck, '');
});

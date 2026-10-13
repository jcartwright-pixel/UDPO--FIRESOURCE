'use strict';
// Joe 10/13: a manager rates a driver's truck cleanliness 1 to 5 on the Driver Scorecard (about once a month).
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { applyAction } = require('../../src/actions');
const { runTransfer } = require('../../src/transfer');
const F = require('../fixtures/fake-sheets');

const MANAGER = { email: 'manager.test@uniteddairy.com' };
const DISPATCHER = { email: 'dispatch.test@uniteddairy.com' };
let n = 0;
const rid = () => 'clean-' + (++n) + '-' + Date.now();
const now = () => new Date('2026-10-13T16:00:00Z');

test('truck cleanliness: a manager saves a 1-5 rating with a note; a second one that day replaces it; bad ratings and dispatchers refused', async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now });
  const base = { action: 'rateTruckClean', driverKey: 'DRV_TEST_ADAMS', driver: 'ADAMS, PAT', date: '2026-10-13', truck: '223893' };
  const out = await applyAction(db(), MANAGER, Object.assign({ requestId: rid(), rating: 2, note: 'trash in the cab' }, base), now);
  assert.equal(out.ok, true);
  await applyAction(db(), MANAGER, Object.assign({ requestId: rid(), rating: 4, note: 'cleaned up' }, base), now);
  const all = (await db().collection('scorecardRatings').get()).docs.map(d => d.data());
  assert.equal(all.length, 1);
  assert.deepEqual([all[0].rating, all[0].note, all[0].truck, all[0].ratedBy], [4, 'cleaned up', '223893', MANAGER.email]);
  await assert.rejects(applyAction(db(), MANAGER, Object.assign({ requestId: rid(), rating: 6 }, base), now), /1 to 5/);
  await assert.rejects(applyAction(db(), DISPATCHER, Object.assign({ requestId: rid(), rating: 3 }, base), now), /role/);
});

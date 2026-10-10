'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const { applyAction } = require('../../src/actions');
const { runMasterWriteBack } = require('../../src/masterwrite');
const MAINT = require('../../src/maintenance');
const F = require('../fixtures/fake-sheets');

const DISPATCHER = { email: 'dispatch.test@uniteddairy.com' };
const RUN = '2026-10-04__run_t801';
let n = 0;
const rid = () => 'mq-request-' + (++n) + '-' + Date.now();
const tick = () => new Date('2026-10-09T12:00:00Z');
const TARGETS = {};
Object.keys(MAINT.LISTS).forEach(k => { TARGETS[MAINT.LISTS[k]] = { spreadsheetId: 'fake-live', tab: MAINT.TABS[k] }; });

let tabs, sheets;
test.beforeEach(async () => {
  await clear();
  tabs = F.fakeSheets();
  sheets = F.fakeWritableSheets(tabs);
  await runTransfer({ db: db(), reader: sheets, sources: F.SOURCES, now: tick });
});

test('"none" or "ok" makes no record; a real problem does, matched to the unit', () => {
  assert.equal(MAINT.noWriteUp('None'), true);
  assert.equal(MAINT.noWriteUp('no issues to report'), true);
  assert.equal(MAINT.noWriteUp('ok'), true);
  assert.equal(MAINT.noWriteUp('Brake light out'), false);
  const eq = [{ id: 'veh_trailer_t_901', unit: 'T-901', type: 'TRAILER', status: 'ACTIVE' }, { id: 'veh_trailer_t_903', unit: 'T-903', type: 'TRAILER', status: 'INACTIVE' }];
  assert.equal(MAINT.resolveUnit('901', 'TRAILER', eq).id, 'veh_trailer_t_901');
  assert.equal(MAINT.resolveUnit('1', 'TRUCK', [{ id: 'veh_truck_900001', unit: '900001', type: 'TRUCK', status: 'ACTIVE' }]).id, 'veh_truck_900001', 'a short number matches the end of the unit');
  assert.equal(MAINT.resolveUnit('555', 'TRAILER', eq).resolved, false);
});

test('a check-in feeds the maintenance queues once, and with the write-back on they reach the sandbox tabs', async () => {
  await db().collection('config').doc('app').set({ writeBack: { enabled: true } }, { merge: true });
  // 801 Monday: ADAMS, truck 900001, trailer T-901.
  const out = await applyAction(db(), DISPATCHER, { action: 'saveCheckIn', requestId: rid(), runDocId: RUN, day: 'mon', casesDelivered: 400,
    tractorIssues: 'Check engine light', trailerIssues: 'none', palletJackIssues: 'wheel squeaks', trailerNeedsCleaned: true, refusedReturned: '2 cs', refusedReturnedSource: 'Store 14' });
  assert.deepEqual(out.maintenance.map(id => id.split('|').pop()).sort(), ['cleaning', 'pallet', 'refusedreturned', 'tractor']);
  const recs = (await db().collection('maintenance').get()).docs.map(d => d.data());
  const truck = recs.find(r => r.kind === 'TRUCK'), fork = recs.find(r => r.kind === 'FORK_TRUCK');
  assert.deepEqual([truck.truck_id, truck.truck_number, truck.status, truck.driver], ['veh_truck_900001', '900001', 'OPEN', 'ADAMS, PAT']);
  assert.equal(fork.status, 'NEEDS_REVIEW', 'no pallet jack unit on the load: the garage reviews it');
  assert.equal(recs.find(r => r.kind === 'WASH').equipment_id, 'veh_trailer_t_901');
  // Fixing the check-in does not add the records again.
  const again = await applyAction(db(), DISPATCHER, { action: 'saveCheckIn', requestId: rid(), runDocId: RUN, day: 'mon', casesDelivered: 401, tractorIssues: 'Check engine light' });
  assert.deepEqual(again.maintenance, []);
  assert.equal((await db().collection('maintenance').get()).size, 4);

  const wb = await runMasterWriteBack({ db: db(), sheets, targets: TARGETS, now: tick });
  assert.equal(wb.conflicts, 0);
  assert.equal(wb.added, 4);
  const truckTab = tabs["'TRUCK LIVE'"], h = truckTab[0];
  assert.equal(truckTab.length, 2);
  assert.equal(truckTab[1][h.indexOf('issue_details')], 'Check engine light');
  assert.equal(truckTab[1][h.indexOf('truck_number')], '900001');
  assert.equal(truckTab[1][h.indexOf('record_id')], 'APP|' + RUN + '|mon|tractor');
  const ret = tabs["'REFUSALS / RETURNS LIVE'"];
  assert.equal(ret[1][ret[0].indexOf('disposition')], 'PENDING_REVIEW');
});

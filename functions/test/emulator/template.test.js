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
const rid = () => 'tpl-' + (++n) + '-' + Date.now();
// Sunday 10/4 at noon: the whole week of 10/4 is today or later.
const now = () => new Date('2026-10-04T16:00:00Z');

test.beforeEach(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now });
});

const driver = async (id) => (await db().collection('drivers').doc(id).get()).data();
const run = async (id) => (await db().collection('runs').doc(id).get()).data();

test('Driver Weekly Template: a run belongs to one driver a day; Off and runs save to Driver Master and reach the Live weeks', async () => {
  await assert.rejects(applyAction(db(), DISPATCHER, { action: 'saveDriverTemplate', requestId: rid(), driverId: 'drv_test_brook', day: 'mon', status: 'OFF' }, now), /role/);
  await assert.rejects(applyAction(db(), MANAGER, { action: 'saveDriverTemplate', requestId: rid(), driverId: 'drv_test_brook', day: 'mon', status: 'ASSIGNMENT', runIds: ['run_t801'] }, now), /already ADAMS/);
  await assert.rejects(applyAction(db(), MANAGER, { action: 'saveDriverTemplate', requestId: rid(), driverId: 'drv_test_brook', day: 'wed', status: 'ASSIGNMENT', runIds: ['run_t801'] }, now), /does not run on Wednesday/);

  await applyAction(db(), MANAGER, { action: 'saveDriverTemplate', requestId: rid(), driverId: 'drv_test_adams', day: 'tue', status: 'OFF' }, now);
  let adams = await driver('drv_test_adams');
  assert.equal(adams.cells.tue_available, 'FALSE');
  assert.equal(adams.cells.tue_assignments_json, '[]');

  await applyAction(db(), MANAGER, { action: 'saveDriverTemplate', requestId: rid(), driverId: 'drv_test_brook', day: 'tue', status: 'ASSIGNMENT', runIds: ['run_t801'] }, now);
  const brook = await driver('drv_test_brook');
  assert.equal(brook.cells.tue_available, 'TRUE');
  assert.equal(JSON.parse(brook.cells.tue_assignments_json)[0].runId, 'run_t801');
  assert.equal(brook.cells.tue_default_route_id, 'rte_t801');
  const live = await run('2026-10-04__run_t801');
  assert.equal(live.days.tue.driverId, 'drv_test_brook', 'the Live week took the new template driver');
});

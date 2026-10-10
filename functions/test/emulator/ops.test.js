'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const { applyAction } = require('../../src/actions');
const F = require('../fixtures/fake-sheets');

const DISPATCHER = { email: 'dispatch.test@uniteddairy.com' };
const MANAGER = { email: 'manager.test@uniteddairy.com' };
const RUN = '2026-10-04__run_t802';
let n = 0;
const rid = () => 'ops-request-' + (++n) + '-' + Date.now();
const tick = () => new Date('2026-10-09T12:00:00Z');
const day = async () => (await db().collection('runs').doc(RUN).get()).data().days.mon;

test.beforeEach(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: tick });
});

test('Operational Assignments: a built-in name is a driver choice; a manager adds one and turns one off', async () => {
  await applyAction(db(), DISPATCHER, { action: 'assignDriver', requestId: rid(), runDocId: RUN, day: 'mon', driverId: '__CVG__:Fairmont' });
  assert.equal((await day()).driver, 'Fairmont');
  assert.equal((await day()).driverId, '');
  await assert.rejects(applyAction(db(), DISPATCHER, { action: 'assignDriver', requestId: rid(), runDocId: RUN, day: 'mon', driverId: '__CVG__:Beckley' }), /not an active Operational Assignment/);
  await assert.rejects(applyAction(db(), MANAGER, { action: 'saveOpsAssignment', requestId: rid(), assignment: '', sequence: 5 }), /Type the assignment name/);
  await assert.rejects(applyAction(db(), MANAGER, { action: 'saveOpsAssignment', requestId: rid(), assignment: 'Beckley', sequence: 0 }), /1 to 999/);
  await applyAction(db(), MANAGER, { action: 'saveOpsAssignment', requestId: rid(), assignment: ' Beckley ', sequence: 5 });
  const saved = (await db().collection('opsAssignments').doc('BECKLEY').get()).data();
  assert.equal(saved.assignment, 'Beckley');
  assert.equal(saved.active, true);
  assert.equal(saved.updatedBy, MANAGER.email);
  await applyAction(db(), DISPATCHER, { action: 'assignDriver', requestId: rid(), runDocId: RUN, day: 'mon', driverId: '__CVG__:beckley' });
  assert.equal((await day()).driver, 'Beckley');
  await applyAction(db(), MANAGER, { action: 'saveOpsAssignment', requestId: rid(), assignment: 'Marietta', active: false, sequence: 3 });
  await assert.rejects(applyAction(db(), DISPATCHER, { action: 'assignDriver', requestId: rid(), runDocId: RUN, day: 'mon', driverId: '__CVG__:Marietta' }), /not an active/);
});

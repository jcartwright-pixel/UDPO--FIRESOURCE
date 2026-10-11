'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const { applyAction } = require('../../src/actions');
const L = require('../../src/logic');
const F = require('../fixtures/fake-sheets');

const DISPATCHER = { email: 'dispatch.test@uniteddairy.com' };
const RUN = '2026-10-04__run_t801';
let n = 0;
const rid = () => 'iss-request-' + (++n) + '-' + Date.now();
const tick = () => new Date('2026-10-09T12:00:00Z');

test.beforeEach(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: tick });
});

const records = async () => (await db().collection('maintenance').get()).docs.map(d => Object.assign({ id: d.id }, d.data()));

test('Equipment Issues: To garage once, Repaired takes it off the open list, Remove keeps the row as REMOVED, Reviewed only for NEEDS_REVIEW', async () => {
  await applyAction(db(), DISPATCHER, { action: 'saveCheckIn', requestId: rid(), runDocId: RUN, day: 'mon', casesDelivered: 400,
    tractorIssues: 'Check engine light', palletJackIssues: 'wheel squeaks' });
  let open = L.issueRows(await records(), 'TRUCK');
  assert.equal(open.length, 1);
  const truck = open[0];
  assert.equal(truck.text, 'Check engine light');
  assert.equal(truck.atGarage, false);

  await applyAction(db(), DISPATCHER, { action: 'updateIssue', requestId: rid(), recordId: truck.recordId, step: 'garage' });
  const twice = await applyAction(db(), DISPATCHER, { action: 'updateIssue', requestId: rid(), recordId: truck.recordId, step: 'garage' });
  assert.match(twice.message, /Already sent/);
  open = L.issueRows(await records(), 'TRUCK');
  assert.equal(open[0].atGarage, true);
  assert.equal((open[0].garageBy), DISPATCHER.email);

  await assert.rejects(applyAction(db(), DISPATCHER, { action: 'updateIssue', requestId: rid(), recordId: truck.recordId, step: 'reviewed' }), /needs review/);

  await applyAction(db(), DISPATCHER, { action: 'updateIssue', requestId: rid(), recordId: truck.recordId, step: 'repaired', note: 'New sensor' });
  const all = await records();
  assert.equal(L.issueRows(all, 'TRUCK').length, 0, 'repaired leaves the open list');
  const done = all.find(r => r.record_id === truck.recordId);
  assert.equal(done.status, 'COMPLETE');
  assert.equal(done.completed_by, DISPATCHER.email);
  assert.equal(done.resolution_notes, 'New sensor');
  assert.equal(L.issueRows(all, 'TRUCK').repairedLast30, 1);

  const jack = L.issueRows(all, 'FORK_TRUCK')[0];
  await applyAction(db(), DISPATCHER, { action: 'updateIssue', requestId: rid(), recordId: jack.recordId, step: 'remove', note: 'Not ours' });
  const removed = (await records()).find(r => r.record_id === jack.recordId);
  assert.equal(removed.status, 'REMOVED');
  assert.match(removed.notes, /Removed by dispatch\.test@uniteddairy\.com/);
  assert.equal(L.issueRows(await records(), 'FORK_TRUCK').length, 0);
});

test('Equipment Issues: repeat reports on one unit within 90 days count up; text that says nothing is wrong is left out', () => {
  const recs = [
    { record_id: 'a', kind: 'TRUCK', truck_number: '954', issue_details: 'door', opened_at: '2026-07-01T00:00:00Z', status: 'COMPLETE', completed_at: '2026-07-02T00:00:00Z' },
    { record_id: 'b', kind: 'TRUCK', truck_number: '954', issue_details: 'light out', opened_at: '2026-09-21T00:00:00Z', status: 'OPEN' },
    { record_id: 'c', kind: 'TRUCK', truck_number: '0954', issue_details: 'mirror', opened_at: '2026-10-05T00:00:00Z', status: 'NEEDS_REVIEW' },
    { record_id: 'd', kind: 'TRUCK', truck_number: '877', issue_details: 'NO+', opened_at: '2026-09-22T00:00:00Z', status: 'OPEN' }
  ];
  const open = L.issueRows(recs, 'TRUCK', Date.parse('2026-10-09T00:00:00Z'));
  assert.deepEqual(open.map(r => [r.recordId, r.occurrences]), [['c', 2], ['b', 2]], 'the July report is more than 90 days before the October one');
  const n = L.issueNumbers(open, Date.parse('2026-10-09T00:00:00Z'));
  assert.equal(n.needReview, 1);
  assert.equal(n.repeat, 2);
  assert.equal(n.oldestDays, 18);
});

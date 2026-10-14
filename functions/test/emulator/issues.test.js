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
  // Joe 10/14: Garage makes the write-up's work order (Garage Station, Fleet Service, the hub's Garage count), once.
  let orders = (await db().collection('workOrders').get()).docs.map(d => d.data());
  assert.equal(orders.length, 1, 'one work order, however many times it is sent');
  assert.deepEqual([orders[0].source, orders[0].source_kind, orders[0].source_id, orders[0].status, orders[0].problem, orders[0].sent_by], ['WRITE_UP', 'trucks', truck.recordId, 'NEW', 'Check engine light', DISPATCHER.email]);
  assert.equal(twice.workOrderId, orders[0].work_order_id);
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
  orders = (await db().collection('workOrders').get()).docs.map(d => d.data());
  assert.deepEqual([orders.length, orders[0].status, orders[0].completed_by, orders[0].fixed_note], [1, 'DONE', DISPATCHER.email, 'Marked repaired on Truck Issues'], 'Repaired closes the work order too');

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

test('Truck Issues Garage and the Garage Station: one work order per write-up; Remove closes it and stops a running clock; sent before work orders gets one', async () => {
  await applyAction(db(), DISPATCHER, { action: 'saveCheckIn', requestId: rid(), runDocId: RUN, day: 'mon', casesDelivered: 400, tractorIssues: 'Mirror cracked' });
  const truck = L.issueRows(await records(), 'TRUCK')[0];
  const sent = await applyAction(db(), DISPATCHER, { action: 'updateIssue', requestId: rid(), recordId: truck.recordId, step: 'garage' });
  const ref = db().collection('workOrders').doc(sent.workOrderId);
  // A mechanic's clock is running on it when the office removes the write-up.
  await ref.update({ status: 'WORKING', labor: [{ tech_id: 'TECH-JT', name: 'JT', start: '2026-10-09T11:00:00.000Z', end: '', minutes: 0 }], on_now: 'JT' });
  await db().collection('garageClocks').doc('TECH-JT').set({ techId: 'TECH-JT', name: 'JT', workOrderId: sent.workOrderId, since: '2026-10-09T11:00:00.000Z' });
  const gone = await applyAction(db(), DISPATCHER, { action: 'updateIssue', requestId: rid(), recordId: truck.recordId, step: 'remove', note: 'Duplicate' });
  assert.deepEqual(gone.workOrdersClosed, [sent.workOrderId]);
  const o = (await ref.get()).data();
  assert.deepEqual([o.status, o.fixed_note, o.on_now, !!o.labor[0].end], ['DONE', 'Write-up removed on Truck Issues', '', true]);
  assert.equal((await db().collection('garageClocks').doc('TECH-JT').get()).exists, false, 'the clock stops');

  // A write-up marked "Sent to garage" before Garage made work orders: sending again makes its one work order.
  const old = { recordId: 'TRK-OLD-1' };
  await db().collection('maintenance').doc(old.recordId).set({ record_id: old.recordId, kind: 'TRUCK', truck_number: '223881', issue_details: 'Horn out', status: 'OPEN', opened_at: '2026-10-08T09:00:00Z',
    notes: 'Sent to garage 2026-10-08T10:00:00Z by dispatch.test@uniteddairy.com' });
  const again = await applyAction(db(), DISPATCHER, { action: 'updateIssue', requestId: rid(), recordId: old.recordId, step: 'garage' });
  assert.match(again.message, /Already sent to the garage\. Work order WO-[0-9A-F]{8} made\./);
  const third = await applyAction(db(), DISPATCHER, { action: 'updateIssue', requestId: rid(), recordId: old.recordId, step: 'garage' });
  assert.equal(third.message, 'Already sent to the garage.');
  assert.equal((await db().collection('workOrders').where('source_id', '==', old.recordId).get()).size, 1);
});

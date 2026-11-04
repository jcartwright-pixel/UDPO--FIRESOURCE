'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('the repair email reads in plain words: Reported as 10-24-26 2:28 PM (Joe 10/25, the 877 email)', () => {
  const A = require('../../src/admintools');
  const m = A.repairMessage({ kind: 'TRUCK', truck_number: '223877', issue_details: 'FUEL CAP WONT THRED ON', opened_at: '2026-10-24T18:28:46.000Z', driver: 'Chad Herman' }, '');
  assert.equal(m.subject, 'United Dairy Truck Repair Request - 223877');
  assert.equal(m.text, 'United Dairy Plant Operations\n\nTruck 223877\nIssue: FUEL CAP WONT THRED ON\nReported: 10-24-26 2:28 PM\nDriver: Chad Herman\n\nPlease review this repair request.');
  assert.equal(A.reportedText('2026-10-25'), '10-25-26');
  assert.equal(A.reportedText(''), '');
});

test('a repair email sent before the blank-body fix (time ending in Z) counts as not sent, so Lessor sends it again', () => {
  const L = require('../../src/logic'), A = require('../../src/admintools');
  const blank = 'Sent to lessor Idealease 2026-10-25T19:24:16.180Z by joe@uniteddairy.com\nRepair email sent 2026-10-25T19:24:17.784Z to meaton@hillidealease.com';
  assert.equal(L.repairEmailSent(blank), null);
  assert.ok(L.repairEmailSent(blank + '\nRepair email sent ' + A.nyIso(new Date('2026-10-26T13:00:00Z')) + ' to meaton@hillidealease.com'));
  assert.ok(L.repairEmailSent('Repair email sent 2026-10-09T22:24:56-04:00 to meaton@hillidealease.com'), 'the old app\'s emails had a body');
  assert.equal(A.nyIso(new Date('2026-10-25T19:24:17.784Z')), '2026-10-25T15:24:17-04:00');
  assert.equal(A.nyIso(new Date('2026-12-25T19:24:17Z')), '2026-12-25T14:24:17-05:00');
  const row = L.issueRows([{ record_id: 'x', kind: 'TRUCK', truck_number: '223877', issue_details: 'FUEL CAP', status: 'OPEN', notes: blank }], 'TRUCK', Date.parse('2026-10-25T21:00:00Z'));
  const r = (row.rows || row)[0] || {};
  assert.equal(r.emailed, false); assert.equal(r.emailBlank, true); assert.equal(r.toLessor, true);
});

test('Truck Issues says why a lessor email did not go, and when it waits for the once-a-day email (Joe 11/4, 224001)', () => {
  const L = require('../../src/logic');
  const base = 'Sent to lessor Idealease 2026-11-03T21:10:00-05:00 by joe@uniteddairy.com';
  const row = (notes) => L.issueRows([{ record_id: 'x', kind: 'TRUCK', truck_number: '224001', issue_details: 'Need 4 rear dual tires', status: 'OPEN', notes }], 'TRUCK', Date.parse('2026-11-04T03:00:00Z'))[0];
  const failed = row(base + '\nRepair email not sent 2026-11-03T21:10:02-05:00: Outbound email is turned off');
  assert.equal(failed.emailed, false); assert.equal(failed.emailWhy, 'Outbound email is turned off'); assert.equal(failed.emailQueued, false);
  const sentAfter = row(base + '\nRepair email not sent 2026-11-03T21:10:02-05:00: Outbound email is turned off\nRepair email sent 2026-11-03T21:20:00-05:00 to repairs@example.com');
  assert.equal(sentAfter.emailed, true); assert.equal(sentAfter.emailWhy, '');
  const queued = row(base + '\nRepair email queued for the daily digest 2026-11-04T02:10:02.000Z (Idealease)');
  assert.equal(queued.emailQueued, true); assert.equal(queued.emailWhy, '');
  assert.equal(row(base).emailWhy, ''); assert.equal(row(base).emailQueued, false);
});

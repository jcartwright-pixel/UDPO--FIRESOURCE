'use strict';
/* Truck / Trailer / Fork Truck Issues (Joe 10/18): only real problems, and one email is one row. */
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../../src/logic');
const G = require('../../src/garage');

test('a Pre Trip / Post Trip answer that only says yes or no is not a write-up', () => {
  for (const v of ['YES-NO', 'yes-no', 'YS', 'Y/N', 'Yes/No', 'yes - none', 'YE S', 'Ytes', 'NO', 'UYES', 'yess', 'TES', 'YRS', 'yse', 'UYES-NO', 'yesno']) assert.equal(L.noWriteUp(v), true, v);
  for (const v of ['YES-POST- AIR LEAK', 'no good', 'yes no brakes', 'air conditioner in tractor don\'t work', 'NO+ mirror', 'eyes', 'UYES flat tire', 'yes leak']) assert.equal(L.noWriteUp(v), false, v);
});

// Copies of one email, as on TRUCK LIVE 10/18: the old app's (one per answer) and the new reader's (read again 10/15).
const mail = (id, key, unit, text, status, opened, day) => ({ record_id: 'MAIL|' + id + '|' + key, kind: 'TRUCK', truck_number: unit, issue_details: text, source_type: 'GMAIL', source_id: id,
  status, opened_at: opened, service_date: day || opened.slice(0, 10) });
const NOW = Date.parse('2026-10-18T22:00:00Z');

test('one email is one row: its copies are joined, dated when the email came in, and counted once', () => {
  const rows = L.issueRows([
    mail('c', 'concerns', '225061', 'store 2318- she threatening', 'NEEDS_REVIEW', '2026-10-14T18:01:25.000Z'),
    mail('c', 'tractor', '225061', 'store 2318- she threatening; yes-no', 'NEEDS_REVIEW', '2026-10-15T02:21:03.810Z', '2026-10-14'),
    mail('d', 'tractor', '225061', 'Air leak', 'OPEN', '2026-10-16T15:00:00.000Z')
  ], 'TRUCK', NOW);
  assert.equal(rows.length, 2);
  const store = rows.find(r => /store/.test(r.text));
  assert.deepEqual([store.text, store.reported.slice(0, 10), store.occurrences, store.recordIds], ['store 2318- she threatening', '2026-10-14', 1, ['MAIL|c|concerns', 'MAIL|c|tractor']]);
  assert.deepEqual(store.reviewIds, ['MAIL|c|concerns', 'MAIL|c|tractor']);
  // A different email about the same truck is a new report.
  assert.equal(rows.find(r => r.text === 'Air leak').occurrences, 2);
});

test('a copy repaired or removed closes the same email\'s other copy; a removed "YS" copy does not hide a real problem', () => {
  const rows = L.issueRows([
    mail('a', 'writeupdefects', '223878', 'Back Door On 826 Needs Fixed', 'COMPLETE', '2026-10-11T13:11:22.000Z'),
    mail('a', 'tractor', '223878', 'Back Door On 826 Needs Fixed; YES BACK DOOR ON 826 NEEDS FIXED', 'NEEDS_REVIEW', '2026-10-15T02:21:03.810Z', '2026-10-11'),
    mail('b', 'writeupdefects', '223880', 'Tractor Ac Doesnt Work', 'REMOVED', '2026-10-14T21:37:47.000Z'),
    mail('b', 'tractor', '223880', 'Tractor Ac Doesnt Work', 'OPEN', '2026-10-15T02:21:03.810Z', '2026-10-14'),
    mail('e', 'posttrip', '223881', 'YS', 'REMOVED', '2026-10-16T21:00:00.000Z'),
    mail('e', 'concerns', '223881', 'mirror broken', 'OPEN', '2026-10-16T21:00:00.000Z')
  ], 'TRUCK', NOW);
  assert.deepEqual(rows.map(r => [r.unit, r.text]), [['223881', 'mirror broken']]);
});

test('the Garage Station lists one job for one email', () => {
  const jobs = G.garageJobs([], [
    mail('c', 'concerns', '900001', 'horn weak', 'OPEN', '2026-10-14T18:01:25.000Z'),
    mail('c', 'tractor', '900001', 'horn weak; yes-no', 'OPEN', '2026-10-15T02:21:03.810Z', '2026-10-14')
  ], []);
  assert.equal(jobs.length, 1);
});

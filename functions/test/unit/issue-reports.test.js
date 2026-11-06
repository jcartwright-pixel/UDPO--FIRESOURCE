'use strict';
/* Truck / Trailer / Fork Truck Issues (Joe 10/18): only real problems, and one email is one row. */
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../../src/logic');
const G = require('../../src/garage');

test('a Pre Trip / Post Trip answer that only says yes or no is not a write-up', () => {
  for (const v of ['YES-NO', 'yes-no', 'YS', 'Y/N', 'Yes/No', 'yes - none', 'YE S', 'Ytes', 'NO', 'UYES', 'yess', 'TES', 'YRS', 'yse', 'UYES-NO', 'yesno', 'YES - NO WRITE UPS', 'yes, no issues', 'NO WRITE UPS - YES', 'Yes no defects found', 'NO WRITES', 'YES - NO WRITES']) assert.equal(L.noWriteUp(v), true, v);
  for (const v of ['YES-POST- AIR LEAK', 'no good', 'yes no brakes', 'air conditioner in tractor don\'t work', 'NO+ mirror', 'eyes', 'UYES flat tire', 'yes leak', 'YES - WRITE UP BRAKES', 'yes no write ups, mirror broken']) assert.equal(L.noWriteUp(v), false, v);
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

// Joe 10/22: truck 225061 showed 3 times on 10-22, from a check-in and two DVIRs sent minutes apart.
const app = (source, key, unit, text, opened) => ({ record_id: 'APP|' + source + '|' + key, kind: 'TRUCK', truck_number: unit, issue_details: text, source_type: 'ROUTE_APP', source_id: source,
  status: 'OPEN', opened_at: opened, service_date: opened.slice(0, 10), driver: 'Pat Lee' });

test('reports on one truck on the same day are one row, counted once', () => {
  const rows = L.issueRows([
    app('2026-10-18__run_x|thu', 'tractor', '225061', 'Wiper blades', '2026-10-22T18:22:29.203Z'),
    app('DVIR_app_aaa_1', 'dvir-tractor', '225061', 'Wiper blades  need replaced', '2026-10-22T18:24:36.290Z'),
    app('DVIR_app_bbb_1', 'dvir-tractor', '225061', 'Wiper blades need replaced', '2026-10-22T18:26:32.599Z'),
    app('DVIR_app_ccc_1', 'dvir-tractor', '225061', 'Mirror loose', '2026-10-20T12:00:00.000Z'),
    app('DVIR_app_ddd_1', 'dvir-tractor', '223880', 'Wiper blades need replaced', '2026-10-22T18:30:00.000Z')
  ], 'TRUCK', Date.parse('2026-10-22T19:00:00Z'));
  assert.deepEqual(rows.map(r => [r.unit, r.text, r.occurrences]), [['223880', 'Wiper blades need replaced', 1], ['225061', 'Wiper blades', 2], ['225061', 'Mirror loose', 1]]);
  const wipers = rows[1];
  assert.deepEqual([wipers.reported, wipers.checkinId, wipers.recordIds.length], ['2026-10-22T18:22:29.203Z', '2026-10-18__run_x|thu', 3]);
});

test('the Garage Station lists one job for one email', () => {
  const jobs = G.garageJobs([], [
    mail('c', 'concerns', '900001', 'horn weak', 'OPEN', '2026-10-14T18:01:25.000Z'),
    mail('c', 'tractor', '900001', 'horn weak; yes-no', 'OPEN', '2026-10-15T02:21:03.810Z', '2026-10-14')
  ], []);
  assert.equal(jobs.length, 1);
});

// Joe 11/6 ("825 was in the garage ... it should at least let me know that it's been in there"): the Garage column ticks however
// the unit got to the garage, and the write-up stays open until Repaired.
test('a write-up is at the garage when a work order points at it or the unit was in the garage since it was reported', () => {
  const up = (id, unit, opened, notes) => ({ record_id: id, kind: 'TRAILER', trailer_number: unit, issue_details: 'Light out', status: 'OPEN', opened_at: opened, notes: notes || '' });
  const records = [up('W1', 'T-826', '2026-11-03T12:00:00Z'), up('W2', '843', '2026-11-04T12:00:00Z'), up('W3', 'T-887', '2026-11-05T12:00:00Z'),
    up('W4', 'T-893', '2026-11-05T12:00:00Z'), up('W5', 'T-954', '2026-11-05T12:00:00Z'), up('W6', 'T-965', '2026-11-03T12:00:00Z', 'Sent to garage 2026-11-03T13:00:00Z by joe'),
    up('W7', 'T-543', '2026-11-05T12:00:00Z'), up('W8', 'T-956', '2026-11-03T12:00:00Z')];
  const orders = [
    // Started on the Garage Station from the listed write-up: points at it.
    { work_order_id: '224100', unit: 'T-826', unit_type: 'TRAILER', source: 'WRITE_UP', source_kind: 'trailers', source_id: 'W1', status: 'WORKING', started_at: '2026-11-04T14:00:00Z', techs: 'Sam Tester' },
    // The unit's other write-up's work order, finished after this one was reported.
    { work_order_id: '224101', unit: 'T-843', unit_type: 'TRAILER', source: 'TECH', status: 'DONE', created_at: '2026-11-01T10:00:00Z', completed_at: '2026-11-05T16:00:00Z', completed_by: 'Sam Tester' },
    // Finished before T-887's write-up: not this problem.
    { work_order_id: '224102', unit: 'T-887', unit_type: 'TRAILER', source: 'TECH', status: 'DONE', completed_at: '2026-11-02T16:00:00Z' },
    // Sent from the office and waiting.
    { work_order_id: '224103', unit: 'T-893', unit_type: 'TRAILER', source: 'OFFICE', status: 'NEW', created_at: '2026-11-05T15:00:00Z', created_by: 'office@example.com' },
    // A service coming due that the app made by itself and nobody started: not at the garage.
    { work_order_id: '224104', unit: 'T-954', unit_type: 'TRAILER', source: 'SERVICE', status: 'NEW', created_at: '2026-11-05T15:00:00Z', created_by: 'Fleet Service' },
    // A truck with the same number is another unit.
    { work_order_id: '224105', unit: '543', unit_type: 'TRUCK', source: 'TECH', status: 'WORKING', started_at: '2026-11-05T15:00:00Z' },
    // A work order made from 2 write-ups names the other in also_ids; waiting on parts.
    { work_order_id: '224106', unit: 'T-999', unit_type: 'TRAILER', source: 'WRITE_UP', source_kind: 'trailers', source_id: 'OTHER', also_ids: ['W8'], status: 'PARTS', started_at: '2026-11-04T09:00:00Z' }];
  const rows = L.issueGarageVisits(L.issueRows(records, 'TRAILER', Date.parse('2026-11-06T20:00:00Z')), orders, 'TRAILER');
  const by = (u) => rows.find(r => r.unit === u);
  assert.equal(rows.length, 8, 'every write-up stays on the list until Repaired');
  assert.deepEqual([by('T-826').atGarage, by('T-826').garageOrder, by('T-826').garageHow, by('T-826').garageBy], [true, '224100', 'working', 'Sam Tester']);
  assert.deepEqual([by('843').atGarage, by('843').garageOrder, by('843').garageHow, by('843').garageAt], [true, '224101', 'done', '2026-11-05T16:00:00Z']);
  assert.equal(by('T-887').atGarage, false);
  assert.deepEqual([by('T-893').atGarage, by('T-893').garageHow], [true, 'waiting']);
  assert.equal(by('T-954').atGarage, false);
  assert.equal(by('T-543').atGarage, false);
  assert.deepEqual([by('T-956').atGarage, by('T-956').garageHow], [true, 'parts']);
  // The To garage button's own note still wins.
  assert.deepEqual([by('T-965').atGarage, by('T-965').garageOrder, by('T-965').garageBy], [true, undefined, 'joe']);
  assert.equal(L.issueNumbers(rows).atGarage, 5);
});

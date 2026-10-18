'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const { garageJobs, garageLists, garageUnits } = require('../../src/garage');
const F = require('../fixtures/fake-sheets');
const { sheets, SOURCES } = require('../fixtures/garage-demo');

// Joe 10/18 (screen speed: "the bigger the file, I don't want it to start getting slower"): the Garage Station and Fleet
// Service read only the work orders and write-ups the garage list needs, and the list is the same as reading every one.
test('the garage list from the needed records is the same as from every record, with a year of finished history', async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(sheets({})), sources: SOURCES, now: () => new Date('2026-10-06T12:00:00Z') });
  const d = db(), batch = d.batch(), DAY = 86400000, now = Date.parse('2026-10-18T12:00:00Z');
  for (let i = 0; i < 300; i++) {
    const at = new Date(now - (i + 1) * DAY).toISOString();
    batch.set(d.collection('maintenance').doc('old_' + i), { record_id: 'OLD-' + i, kind: 'TRUCK', status: i % 2 ? 'COMPLETE' : 'REPAIRED', opened_at: at, issue_details: 'Brake light out', truck_number: '900001' });
    batch.set(d.collection('workOrders').doc('WO-OLD-' + i), { work_order_id: 'WO-OLD-' + i, status: 'DONE', unit: '900001', created_at: at, completed_at: at, source_kind: 'trucks', source_id: 'OLD-' + i });
  }
  // A write-up still open from long ago, with a finished work order pointing at it (so it stays off the list), and one with
  // no work order (on the list); a work order still open from long ago.
  batch.set(d.collection('maintenance').doc('ancient_open'), { record_id: 'ANC-1', kind: 'TRUCK', status: 'OPEN', opened_at: '2025-01-05T08:00:00Z', issue_details: 'Mirror cracked', truck_number: '900001' });
  batch.set(d.collection('workOrders').doc('WO-ANC-1'), { work_order_id: 'WO-ANC-1', status: 'DONE', unit: '900001', created_at: '2025-01-06T08:00:00Z', source_kind: 'trucks', source_id: 'ANC-1' });
  batch.set(d.collection('maintenance').doc('ancient_open2'), { record_id: 'ANC-2', kind: 'TRAILER', status: 'NEEDS_REVIEW', opened_at: '2025-02-05T08:00:00Z', issue_details: 'Door seal torn', trailer_number: 'T-901' });
  batch.set(d.collection('workOrders').doc('WO-ANC-3'), { work_order_id: 'WO-ANC-3', status: 'PARTS', unit: '900001', created_at: '2025-03-01T08:00:00Z', problem: 'Waiting on a starter' });
  await batch.commit();
  const units = garageUnits((await d.collection('equipment').get()).docs.map(x => x.data()));
  const allOrders = (await d.collection('workOrders').get()).docs.map(x => x.data());
  const allRecords = (await d.collection('maintenance').where('kind', 'in', ['TRUCK', 'TRAILER', 'FORK_TRUCK']).get()).docs.map(x => x.data());
  const needed = await garageLists(d, now);
  assert.deepEqual(garageJobs(needed.orders, needed.records, units), garageJobs(allOrders, allRecords, units));
  // Only the last 120 days of finished history are read (in case one has no status), not the whole year.
  assert.ok(needed.orders.length < 130 && needed.records.length < 130, 'the year of finished history is not read: ' + needed.orders.length + ' work orders, ' + needed.records.length + ' write-ups');
  const list = garageJobs(needed.orders, needed.records, units).map(j => j.id || j.writeUp);
  assert.ok(list.includes('WO-ANC-3') && list.includes('trailers|ANC-2') && !list.includes('trucks|ANC-1'), JSON.stringify(list));
});

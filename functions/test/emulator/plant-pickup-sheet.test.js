'use strict';
// Joe 10/12 ("turn all 8 sheets on"): pickups also go to the Plant Operations workbook's LIVE PLANT OPERATIONS tab (a sandbox
// copy here), in the current app's columns, found by pickup_id.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const { applyAction } = require('../../src/actions');
const { runMasterWriteBack } = require('../../src/masterwrite');
const D = require('../../src/demo-sheets');
const F = require('../fixtures/fake-sheets');
const PD = require('../fixtures/plant-demo');

const DISPATCHER = { email: 'dispatch.test@uniteddairy.com' };
const TAB = "'LIVE PLANT OPERATIONS'";
const TARGETS = { pickups: { spreadsheetId: 'fake-plant', tab: 'LIVE PLANT OPERATIONS' } };
let n = 0;
const rid = () => 'pickup-sheet-' + (++n) + '-' + Date.now();
const tick = () => new Date('2026-10-08T16:00:00Z');

let tabs, sheets, before;
test.beforeEach(async () => {
  before = process.env.WRITEBACK_JSON;
  process.env.WRITEBACK_JSON = JSON.stringify({ plant: TARGETS });
  await clear();
  tabs = PD.plantSheets();
  sheets = F.fakeWritableSheets(tabs);
  await runTransfer({ db: db(), reader: D.fakeReader(tabs), sources: PD.PLANT_SOURCES, now: tick });
  await db().collection('config').doc('app').set({ writeBack: { enabled: true } }, { merge: true });
});
test.afterEach(() => { if (before === undefined) delete process.env.WRITEBACK_JSON; else process.env.WRITEBACK_JSON = before; });

const row = (id) => {
  const v = tabs[TAB], h = v[0], rows = v.filter((r, i) => i > 0 && r[h.indexOf('pickup_id')] === id);
  assert.equal(rows.length, 1, 'one row for ' + id);
  return Object.fromEntries(h.map((k, i) => [k, rows[0][i] === undefined ? '' : String(rows[0][i])]));
};

test('a pickup added and completed in the new app is written to LIVE PLANT OPERATIONS', async () => {
  const added = await applyAction(db(), DISPATCHER, { action: 'addPickup', requestId: rid(), runDocId: '2026-10-04__run_p805', day: 'thu', date: PD.PLANT_DATE, item: 'Quart chocolate', quantity: '8', notes: 'short on the line' });
  await applyAction(db(), DISPATCHER, { action: 'completePickup', requestId: rid(), pickupId: 'pu_demo_1' });
  const out = await runMasterWriteBack({ db: db(), sheets, targets: TARGETS, now: tick });
  assert.equal(out.conflicts, 0);
  assert.equal(out.added, 1);
  const r = row(added.pickupId);
  assert.equal(r.operation_type, 'PICKUP');
  assert.equal(r.service_date, PD.PLANT_DATE);
  assert.equal(r.route, '805');
  assert.equal(r.run, 'UT DSD MILK');
  assert.equal(r.item, 'Quart chocolate');
  assert.equal(r.quantity, '8');
  assert.equal(r.status, 'PENDING');
  assert.equal(r.created_by, 'dispatch.test@uniteddairy.com');
  const done = row('pu_demo_1');
  assert.equal(done.status, 'COMPLETE');
  assert.equal(done.completed_by, 'dispatch.test@uniteddairy.com');
  assert.equal(done.item, '12 Gallon whole', 'the rest of the row is kept');
  // The next copy reads it back as the same pickup, not a second one.
  await runTransfer({ db: db(), reader: D.fakeReader(tabs), sources: PD.PLANT_SOURCES, now: tick });
  const list = (await db().collection('pickups').get()).docs.map(d => d.data()).filter(p => p.item === 'Quart chocolate');
  assert.equal(list.length, 1);
});

test('a pickup changed in the sheet since the copy read it is not overwritten; it goes to Sheet Conflicts', async () => {
  const h = tabs[TAB][0], r = tabs[TAB].findIndex(x => x[h.indexOf('pickup_id')] === 'pu_demo_1');
  tabs[TAB][r][h.indexOf('status')] = 'CANCELLED';
  await applyAction(db(), DISPATCHER, { action: 'completePickup', requestId: rid(), pickupId: 'pu_demo_1' });
  const out = await runMasterWriteBack({ db: db(), sheets, targets: TARGETS, now: tick });
  assert.ok(out.conflicts >= 1);
  assert.equal(row('pu_demo_1').status, 'CANCELLED');
  const conflicts = (await db().collection('conflicts').where('list', '==', 'pickups').get()).docs.map(d => d.data());
  assert.ok(conflicts.some(c => c.column === 'status' && c.sheetValue === 'CANCELLED'));
});

test('without a Plant Operations copy in the write-back, pickups are not queued for a sheet', async () => {
  process.env.WRITEBACK_JSON = JSON.stringify({});
  await applyAction(db(), DISPATCHER, { action: 'addPickup', requestId: rid(), runDocId: '2026-10-04__run_p805', day: 'thu', date: PD.PLANT_DATE, item: 'Pint 2%', quantity: '3' });
  const queued = (await db().collection('masterOutbox').where('list', '==', 'pickups').get()).size;
  assert.equal(queued, 0);
});

test('a copy the server cannot write (not shared as Editor) waits; the other sheets are still written', async () => {
  const MANAGER = { email: 'manager.test@uniteddairy.com' };
  const targets = Object.assign({ drivers: PD.PLANT_SOURCES.masters.drivers }, TARGETS);
  const refused = Object.assign({}, sheets, { batchUpdate: (id, u) => (id === 'fake-plant' ? Promise.reject(new Error('The caller does not have permission')) : sheets.batchUpdate(id, u)) });
  const added = await applyAction(db(), DISPATCHER, { action: 'addPickup', requestId: rid(), runDocId: '2026-10-04__run_p805', day: 'thu', date: PD.PLANT_DATE, item: 'Gallon skim', quantity: '2' });
  await applyAction(db(), MANAGER, { action: 'saveDriver', requestId: rid(), driverId: 'drv_test_casey', name: 'CASEY, LEE B', hireDate: '2025-12-01', seniorityDate: '2025-12-01', truck: '', relief: true });
  const out = await runMasterWriteBack({ db: db(), sheets: refused, targets, now: tick });
  assert.ok(out.failed && out.failed.pickups, 'the Plant Operations copy is reported');
  const drv = tabs["'DRIVERS_MASTER'"], dh = drv[0];
  assert.equal(drv.find(r => r[dh.indexOf('driver_id')] === 'drv_test_casey')[dh.indexOf('name')], 'CASEY, LEE B', 'Driver Master was still written');
  const waiting = (await db().collection('masterOutbox').where('list', '==', 'pickups').get()).docs.map(d => d.data());
  assert.deepEqual(waiting.map(w => w.status), ['pending']);
  assert.match(waiting[0].lastError, /permission/);
  await runMasterWriteBack({ db: db(), sheets, targets, now: tick });
  assert.equal(row(added.pickupId).item, 'Gallon skim', 'written on the next pass once the copy can be written');
});

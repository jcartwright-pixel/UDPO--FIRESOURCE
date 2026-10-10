'use strict';
// The plant side's rules (src/plant.js): load areas, the Start / End / status rule, typed units, pickups and the journal copy.
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../../src/plant');
const { SaveError } = require('../../src/actions');

const tx = (equipment) => ({ get: async () => ({ docs: (equipment || []).map(e => ({ id: e.id, data: () => e })) }) });
const db = { collection: () => ({}) };
const STAMP = '2026-10-08T12:00:00.000Z';
const values = (day, fields, equipment) => P.loadValues(tx(equipment), db, { plant: P.validateLoad({ fields }, SaveError) }, day, STAMP, SaveError);

test('load types map to the four plant areas like the current app', () => {
  assert.equal(P.areaOf('Case Loadout'), 'CASE');
  assert.equal(P.areaOf('totes'), 'TOTES');
  assert.equal(P.areaOf('Box Loadout'), 'BOXING');
  assert.equal(P.areaOf('TANKER'), 'TANKER');
  assert.equal(P.areaOf('NONE'), '');
});

test('Start, End and the status picker follow the current app\'s rule', async () => {
  assert.deepEqual(await values({}, { startedAt: '2026-10-08T10:00:00Z' }), { plantStartedAt: '2026-10-08T10:00:00.000Z', loadStatus: 'LOADING' });
  assert.deepEqual(await values({ plantStartedAt: 'x' }, { completedAt: '2026-10-08T10:40:00Z' }), { completeTime: '2026-10-08T10:40:00.000Z', loadStatus: 'COMPLETE' });
  // Clearing the End goes back to Loading (a Start is still there) or Waiting.
  assert.deepEqual(await values({ plantStartedAt: 'x', completeTime: 'y' }, { completedAt: '' }), { completeTime: '', loadStatus: 'LOADING' });
  // Done from the picker on a load never started: End now, and Start the same.
  assert.deepEqual(await values({}, { status: 'COMPLETE' }), { completeTime: STAMP, plantStartedAt: STAMP, loadStatus: 'COMPLETE' });
  // Waiting clears both times.
  assert.deepEqual(await values({ plantStartedAt: 'x', completeTime: 'y' }, { status: 'NOT_STARTED' }), { completeTime: '', plantStartedAt: '', loadStatus: 'NOT_STARTED' });
  assert.throws(() => P.validateLoad({ fields: { startedAt: '2026-10-08T10:00:00Z', completedAt: '2026-10-08T09:00:00Z' } }, SaveError), /End Time cannot be before Start Time/);
  assert.throws(() => P.validateLoad({ fields: { status: 'MAYBE' } }, SaveError), /Waiting, Loading or Done/);
  assert.throws(() => P.validateLoad({ fields: {} }, SaveError), /Nothing to save/);
});

test('counts, temperature, notes and Ended Up Not Running', async () => {
  assert.deepEqual(await values({}, { quantity: '1,240', temperature: '36.5', notes: ' short 2 ', shift: 'FIRST SHIFT' }), { casesOut: 1240, loadTemperature: 36.5, plantNotes: 'short 2', plantShift: 'FIRST SHIFT' });
  assert.deepEqual(await values({}, { runs: false }), { runs: false });
  assert.throws(() => P.validateLoad({ fields: { quantity: 'lots' } }, SaveError), /Quantity must be a number/);
  assert.throws(() => P.validateLoad({ fields: { runs: true } }, SaveError), /only be marked as not running/);
});

test('typed trucks and trailers match Equipment Master; an unknown trailer number is kept as T- plus the number', async () => {
  const eq = [{ id: 'veh_trailer_t_901', type: 'TRAILER', unit: 'T-901', status: 'ACTIVE' }, { id: 'veh_truck_223870', type: 'TRUCK', unit: '223870', status: 'ACTIVE' }];
  assert.deepEqual(await values({}, { trailer: '901', truck: '223870' }, eq), { truck: '223870', truckId: 'veh_truck_223870', trailer: 'T-901', trailerId: 'veh_trailer_t_901' });
  assert.deepEqual(await values({}, { trailer: '977' }, eq), { trailer: 'T-977', trailerId: '' });
  assert.deepEqual(await values({}, { trailer: '' }, eq), { trailer: '', trailerId: '' });
});

test('pickups need a product and a quantity', () => {
  assert.throws(() => P.validatePickup('addPickup', { runDocId: 'r', day: 'fri', date: '2026-10-08', quantity: 3 }, SaveError), /product or item/);
  assert.throws(() => P.validatePickup('addPickup', { runDocId: 'r', day: 'fri', date: '2026-10-08', item: 'Milk' }, SaveError), /quantity/);
  assert.deepEqual(P.validatePickup('addPickup', { runDocId: 'r', day: 'fri', date: '2026-10-08', item: 'Milk', quantity: '4' }, SaveError), { runDocId: 'r', day: 'fri', date: '2026-10-08', item: 'Milk', quantity: 4, notes: '' });
});

test('the plant journal keeps the last row of each record and only the plant record types', () => {
  const h = ['record_id', 'business_date', 'record_type', 'route', 'run', 'status', 'payload_json'];
  const docs = P.parseJournal([h, ['u1', '10/8/2026', 'UNLOADING', '801', 'MILK', 'WAITING', ''], ['u1', '10/8/2026', 'UNLOADING', '801', 'MILK', 'COMPLETE', '{"casesIn":40}'], ['d1', '10/8/2026', 'DVIR', '', '', '', '']]);
  assert.deepEqual(Object.keys(docs), ['UNLOADING_u1']);
  assert.equal(docs.UNLOADING_u1.status, 'COMPLETE');
  assert.equal(docs.UNLOADING_u1.date, '2026-10-08');
  assert.deepEqual(docs.UNLOADING_u1.payload, { casesIn: 40 });
  const pu = P.parsePickups([P.PICKUP_HEADERS, ['pu_1', 'fac', '2026-10-08', '', 'run_1', '801', 'MILK', 'PICKUP', 'Gallon', '4'], ['x', 'fac', '2026-10-08', '', '', '', '', 'OTHER']]);
  assert.deepEqual(Object.keys(pu), ['pu_1']);
  assert.equal(pu.pu_1.status, 'PENDING');
});

test('a plant tab that cannot be read is skipped and the rest are read', async () => {
  const reader = { async batchGet(id, ranges) { if (/WASH/.test(ranges[0])) throw new Error('no such tab'); return [[['record_id'], ['r1']]]; } };
  const out = await P.readPlant(reader, { live: { spreadsheetId: 'live', plant: true }, plant: {} });
  assert.deepEqual(Object.keys(out.lists).sort(), ['plantJournal', 'plantReturns']);
  assert.equal(out.skipped.length, 2);
  // Without live.plant nothing in the Live workbook is read for the plant.
  assert.deepEqual(Object.keys((await P.readPlant(reader, { live: { spreadsheetId: 'live' } })).lists), []);
});

const fs = require('node:fs');
const path = require('node:path');
const R = require('../../src/plant-rules');

test('the screens and the server load the same plant rules file', () => {
  assert.equal(fs.readFileSync(path.join(__dirname, '../../src/plant-rules.js'), 'utf8'), fs.readFileSync(path.join(__dirname, '../../../public/js/plant-rules.js'), 'utf8'));
});

test('the newest unloading record is the unloading now, and returns put back add up', () => {
  const docs = [
    { type: 'UNLOADING', date: '2026-10-08', recordedAt: '2026-10-08T15:00:00Z', payload: { unloadKey: '2026-10-08|801|MILK', startedAt: 'a', productReturnRemovedIds: ['r1'] } },
    { type: 'UNLOADING', date: '2026-10-08', recordedAt: '2026-10-08T15:30:00Z', payload: { unloadKey: '2026-10-08|801|MILK', startedAt: 'a', completedAt: 'b', casesIn: '40', productReturnRemovedIds: [] } },
    // The app's own record wins over the sheet's even with an older clock.
    { type: 'UNLOADING', date: '2026-10-08', recordedAt: '2026-10-08T14:00:00Z', createdInApp: true, route: '802', run: 'MILK', payload: { route: '802', run: 'MILK', trailer: 'T-9' } },
    { type: 'UNLOADING', date: '2026-10-08', recordedAt: '2026-10-08T14:30:00Z', route: '802', run: 'MILK', payload: { route: '802', run: 'MILK', trailer: 'T-1' } },
    { type: 'RETURN', date: '2026-10-08', payload: {} }
  ];
  const u = R.latestUnloads(docs, '2026-10-08');
  assert.deepEqual(Object.keys(u).sort(), ['2026-10-08|801|MILK', '2026-10-08|802|MILK']);
  assert.equal(u['2026-10-08|801|MILK'].status, 'COMPLETE');
  assert.equal(u['2026-10-08|801|MILK'].casesIn, '40');
  assert.deepEqual(u['2026-10-08|801|MILK'].removed, ['r1']);
  assert.equal(u['2026-10-08|802|MILK'].trailer, 'T-9');
  assert.equal(u['2026-10-08|802|MILK'].status, 'WAITING');
});

test('trailer numbers, washes and wash statuses', () => {
  assert.equal(R.trailerText(' 977 '), 'T-977');
  assert.equal(R.trailerText('t-977'), 'T-977');
  assert.equal(R.unitKey('T-977'), R.unitKey('977'));
  const done = R.washesDone([{ type: 'WASHING', trailer: 'T-9', status: 'COMPLETE', completedAt: '2026-10-08T10:00:00Z' }, { type: 'WASHING', payload: { trailer: '9', status: 'COMPLETE', completedAt: '2026-10-08T12:00:00Z' } }]);
  assert.equal(done['9'].completedAt, '2026-10-08T12:00:00Z');
  assert.equal(R.washOpen('REQUESTED'), true);
  assert.equal(R.washOpen('COMPLETE'), false);
});

test('unloading saves: whole quantities, T- trailers, one press at a time', () => {
  const v = (fields) => P.validateUnload({ date: '2026-10-08', route: '801', run: 'MILK', fields }, SaveError).unload;
  assert.deepEqual(v({ casesIn: '1,240', trailer: '977' }), { casesIn: '1240', trailer: 'T-977' });
  assert.deepEqual(v({ casesIn: '0' }), { casesIn: '0' });
  assert.throws(() => v({ casesIn: '3.5' }), /whole quantity/);
  assert.throws(() => v({ start: true, end: true }), /two presses/);
  assert.throws(() => v({}), /Nothing to save/);
  assert.throws(() => P.validateUnload({ date: 'x', route: '801', run: 'M', fields: { start: true } }, SaveError), /yyyy-mm-dd/);
  assert.deepEqual(P.validateWash({ date: '2026-10-08', trailer: '951', close: [{ list: 'plantWash', id: 'w1' }] }, SaveError), { date: '2026-10-08', trailer: 'T-951', close: [{ list: 'plantWash', id: 'w1' }] });
  assert.throws(() => P.validateWash({ date: '2026-10-08', trailer: '951', close: [{ list: 'runs', id: 'x' }] }, SaveError), /wash request/);
  assert.throws(() => P.validateWash({ date: '2026-10-08', trailer: '' }, SaveError), /trailer number/);
});

/* ---------- the Plant Operations Scheduler ---------- */

test('scheduler: pickup times, the newest copy of a load, deleted loads off, Sunday-first holidays', () => {
  assert.equal(R.time24('6:00 AM'), '06:00');
  assert.equal(R.time24('12:15 am'), '00:15');
  assert.equal(R.time24('13:05'), '13:05');
  assert.equal(R.time24('25:00'), '');
  const sheet = { recordId: 'S1', type: 'PLANT_SCHEDULE', date: '2026-10-08', status: 'SCHEDULED', route: '892', run: 'GARBER', payload: { pickupTime: '7:00 AM', scheduleType: 'ROUTE' }, recordedAt: '2026-10-08T10:00:00Z' };
  const app = Object.assign({}, sheet, { date: '2026-10-09', payload: { pickupTime: '08:00', scheduleType: 'CARRIER', poNumber: '9' }, recordedAt: '2026-10-01T00:00:00Z', createdInApp: true });
  assert.deepEqual(R.scheduleEntries([sheet], 'SHIPPING').map(x => [x.date, x.pickupTime, x.scheduleType]), [['2026-10-08', '07:00', 'ROUTE']]);
  // The app's copy wins even with an older clock, and a load moved to another day shows once.
  assert.deepEqual(R.scheduleEntries([app, sheet], 'SHIPPING').map(x => [x.date, x.pickupTime, x.scheduleType]), [['2026-10-09', '08:00', 'CARRIER']]);
  assert.deepEqual(R.scheduleEntries([sheet, Object.assign({}, app, { status: 'DELETED' })], 'SHIPPING'), []);
  assert.deepEqual(R.scheduleEntries([sheet], 'RECEIVING'), [], 'Receiving never sees Shipping loads');
  assert.equal(R.holidayName('2026-11-26'), 'Thanksgiving');
  assert.equal(R.holidayName('2026-05-25'), 'Memorial Day');
  assert.equal(R.holidayName('2026-10-12'), '');
});

test('scheduler: customers are Route Master\'s plant runs, an as-needed customer listed once; suppliers start with five', () => {
  const PD = require('../fixtures/plant-demo');
  const routes = PD.CUSTOMERS.map(r => ({ runId: r.run_id, routeId: r.route_id, route: r.route, run: r.run, routeName: r.route_name, routeStatus: r.route_status, active: r.active === 'TRUE', displayPlant: r.display_plant_distribution === 'TRUE' }));
  const list = R.scheduleCustomers(routes);
  assert.deepEqual(list.map(r => r.route + ' ' + r.run), ['849 SUN VALLEY', '892 GARBER', '905 ALDI - CHARLESTON', '907_1 FAIRMONT TRANSFER', '6302 UT WALMART']);
  assert.equal(list.find(r => r.route === '905').slots, 2);
  assert.equal(list.find(r => r.route === '905').runId, 'run_c905_1');
  const sup = R.scheduleSuppliers([{ recordId: 'SUP-m1', type: 'PLANT_SUPPLIER', routeId: 'SUP-m1', route: 'S06', run: 'MOUNTAIN STATE SUGAR', notes: 'Mountain Sugar', status: 'ACTIVE' }]);
  assert.deepEqual(sup.map(s => s.route), ['S01', 'S02', 'S03', 'S04', 'S05', 'S06']);
  assert.equal(sup[5].name, 'Mountain Sugar');
});

test('scheduler: Save Load checks what the current app checks', () => {
  const ok = { lane: 'shipping', date: '2026-10-08', fields: { routeId: 'r', runId: 'n', route: '892', run: 'GARBER', pickupTime: '07:00' } };
  const bad = (change, re) => assert.throws(() => P.validateSchedule(Object.assign({}, ok, { fields: Object.assign({}, ok.fields, change) }), SaveError), re);
  assert.equal(P.validateSchedule(ok, SaveError).lane, 'SHIPPING');
  bad({ pickupTime: '' }, /pickup time/);
  bad({ routeId: '' }, /route \/ run/);
  bad({ scheduleType: 'CARRIER' }, /PO number/);
  bad({ cases: '12.5' }, /whole number/);
  bad({ loadDate: '2026-10-09' }, /after the delivery date/);
  bad({ trailer: 'T-9<1' }, /trailer/);
  assert.throws(() => P.validateSchedule({ lane: 'SHIPPING', op: 'addSupplier', name: 'X' }, SaveError), /Suppliers are on Receiving/);
  assert.throws(() => P.validateSchedule({ lane: 'RECEIVING', op: 'addSupplier', name: 'X', code: 'TOO-LONG-1' }, SaveError), /up to 8/);
});

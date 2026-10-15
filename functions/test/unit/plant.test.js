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
  assert.throws(() => P.validateLoad({ fields: { status: 'MAYBE' } }, SaveError), /Waiting, Loading, Paused or Done/);
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
  assert.equal(list.find(r => r.route === '905').slots.length, 2);
  assert.equal(list.find(r => r.route === '905').runId, 'run_c905_1');
  const sup = R.scheduleSuppliers([{ recordId: 'SUP-m1', type: 'PLANT_SUPPLIER', routeId: 'SUP-m1', route: 'S06', run: 'MOUNTAIN STATE SUGAR', notes: 'Mountain Sugar', status: 'ACTIVE' }]);
  assert.deepEqual(sup.map(s => s.route), ['S06'], 'no sample suppliers (Joe 10/13)');
  assert.equal(sup[0].name, 'Mountain Sugar');
});

test('scheduler: a customer\'s loads on one day are Load 1, 2, 3 by pickup time, Load N on its LOAD N run (Joe 10/14)', () => {
  const customers = R.scheduleCustomers([1, 2].map(n => ({ runId: 'c905_' + n, routeId: 'rt905', route: '905_' + n, run: 'ALDI - CHARLESTON LOAD ' + n, displayPlant: true }))
    .concat([{ runId: 'g892', routeId: 'rt892', route: '892', run: 'GARBER', displayPlant: true }]));
  const e = (id, date, pickupTime, runId) => ({ id, date, pickupTime, runId: runId || 'c905_1', route: '905_1', run: 'ALDI - CHARLESTON LOAD 1' });
  const out = R.numberLoads([e('a', '2026-10-15', '09:00'), e('b', '2026-10-15', '05:30'), e('c', '2026-10-15', '08:05'), e('d', '2026-10-16', '07:00'), e('g', '2026-10-15', '07:00', 'g892')], customers);
  const by = Object.fromEntries(out.map(x => [x.id, x]));
  assert.deepEqual(['b', 'c', 'a'].map(id => by[id].loadNo), [1, 2, 3]);
  assert.deepEqual(['b', 'c', 'a'].map(id => by[id].slot.runId), ['c905_1', 'c905_2', 'c905_2'], 'the third shares the last slot');
  assert.deepEqual(['b', 'c', 'a'].map(id => by[id].overSlots), [false, false, true]);
  assert.equal(by.d.loadNo, 1, 'numbered per delivery day');
  assert.equal(by.g.loadNo, 1, 'a single load is Load 1');
  assert.equal(by.g.slot, null, 'a customer with no LOAD runs is numbered on screen only');
  assert.equal(R.loadNumberName('ALDI - CHARLESTON LOAD 1', 3), 'ALDI - CHARLESTON Load 3');
  assert.equal(R.loadNumberName('Garber', 1), 'Garber Load 1');
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
  assert.throws(() => P.validateSchedule({ lane: 'RECEIVING', op: 'editSupplier', name: 'X' }, SaveError), /Pick the supplier/);
  assert.throws(() => P.validateSchedule({ lane: 'RECEIVING', op: 'editSupplier', id: 'SUP-START-1', name: '' }, SaveError), /Type the supplier name/);
  assert.deepEqual(P.validateSchedule({ lane: 'RECEIVING', op: 'removeSupplier', id: 'SUP-START-2' }, SaveError), { lane: 'RECEIVING', op: 'removeSupplier', id: 'SUP-START-2' });
});

test('yard checks: a loaded trailer is on the yard until its dispatch time; a check locks it for 2 hours; Left Yard takes the load off', () => {
  const at = (s) => Date.parse(s);
  // Wednesday 10/7 loads: Jersey (done 11:33 AM, dispatch 1 PM, delivers Thursday), an early Walmart load for Saturday,
  // a waiting load (not loaded), and a load with no trailer.
  const runs = [{ id: 'w1', weekStart: '2026-10-04', sheetRow: 7, route: '852', run: 'JERSEY 1', days: {
    thu: { loadDate: '2026-10-07', deliveryDate: '2026-10-08', trailer: '901', dispatchTime: 13 * 60, completeTime: '2026-10-07T15:33:00Z' },
    sat: { loadDate: '2026-10-07', deliveryDate: '2026-10-10', trailer: 'T-955', dispatchTime: 3 * 60, loadStatus: 'COMPLETE' } } },
  { id: 'w2', weekStart: '2026-10-04', sheetRow: 8, route: '805', run: 'UT DSD MILK', days: {
    thu: { loadDate: '2026-10-07', deliveryDate: '2026-10-08', trailer: 'T-960', dispatchTime: 2 * 60 },
    fri: { loadDate: '2026-10-07', deliveryDate: '2026-10-09', trailer: '', dispatchTime: 2 * 60, loadStatus: 'COMPLETE' } } }];
  const holds = R.yardHolds(runs, '2026-10-07');
  assert.deepEqual(holds.map(h => h.trailer), ['T-901', 'T-955']);
  // Wednesday noon: both on the yard, never checked, due now; at 1 PM Jersey has left.
  let q = R.yardQueue(runs, [], '2026-10-07', at('2026-10-07T16:00:00Z'));
  assert.deepEqual(q.rows.map(r => [r.trailer, r.minutesUntilDue, r.routeRun]), [['T-901', 0, 'JERSEY 1'], ['T-955', 0, 'JERSEY 1']]);
  q = R.yardQueue(runs, [], '2026-10-07', at('2026-10-07T17:05:00Z'));
  assert.deepEqual(q.rows.map(r => r.trailer), ['T-955']);
  // The early Saturday load waits until 3 AM Saturday (the operating day before its departure date), so it is still there Friday.
  assert.equal(R.yardQueue(runs, [], '2026-10-09', at('2026-10-09T20:00:00Z')).rows.length, 1);
  assert.equal(R.yardQueue(runs, [], '2026-10-09', at('2026-10-10T07:10:00Z')).rows.length, 0);
  // A check at 12:10 PM locks T-955 for 2 hours; it is due again after.
  const check = { type: 'YARD_CHECK', date: '2026-10-07', recordedAt: '2026-10-07T16:10:00Z', recordedBy: 'yard@uniteddairy.com',
    payload: { trailer: 'T-955', temperature: '34', fuelLevel: '3/4', notes: 'ok', status: 'COMPLETE' } };
  q = R.yardQueue(runs, [check], '2026-10-07', at('2026-10-07T17:10:00Z'));
  assert.deepEqual([q.rows.length, q.locked.length, q.locked[0].minutesUntilDue, q.locked[0].temperature, q.locked[0].fuelLevel], [0, 1, 60, '34', '3/4']);
  q = R.yardQueue(runs, [check], '2026-10-08', at('2026-10-08T16:20:00Z'));
  assert.deepEqual([q.rows.length, q.rows[0].recordedAt, q.rows[0].temperature], [1, '2026-10-07T16:10:00Z', '34']);
  assert.equal(R.yardLockLeft([check], '2026-10-07', '955', at('2026-10-07T17:10:00Z')), 60);
  assert.equal(R.yardLockLeft([check], '2026-10-07', '955', at('2026-10-07T18:11:00Z')), 0);
  // Left Yard (trailer + run) takes that load off.
  const left = { type: 'YARD_CHECK', date: '2026-10-08', recordedAt: '2026-10-08T12:00:00Z', payload: { trailer: 'T-955', run: 'JERSEY 1', notes: 'Left the yard', status: 'DEPARTED' } };
  assert.equal(R.yardQueue(runs, [check, left], '2026-10-08', at('2026-10-08T16:20:00Z')).rows.length, 0);
  // History: both, newest first, within 24 hours.
  assert.deepEqual(R.yardHistory([check, left], '2026-10-08', at('2026-10-08T16:20:00Z')).map(h => h.status), ['DEPARTED']);
  assert.deepEqual(R.yardHistory([check, left], '2026-10-08', at('2026-10-08T12:20:00Z')).map(h => h.status), ['DEPARTED', 'COMPLETE']);
  assert.equal(R.yardTrailer(' t 961 '), 'T-961');
  assert.equal(R.wallMinutes('10/7/2026 11:33:00 AM') % 1440, 11 * 60 + 33);
});

test('yard checks save: trailer required, fuel Full, 3/4, 1/2 or Empty', () => {
  assert.throws(() => P.validateYard({ date: '2026-10-07', trailer: '' }, SaveError), /Trailer is required/);
  assert.throws(() => P.validateYard({ date: '2026-10-07', trailer: '955', fuelLevel: '1/4' }, SaveError), /Fuel level/);
  const ok = P.validateYard({ date: '2026-10-07', trailer: '955', fuelLevel: 'full', temperature: '34', notes: 'x'.repeat(900) }, SaveError);
  assert.deepEqual([ok.trailer, ok.fuelLevel, ok.notes.length, ok.departed], ['T-955', 'FULL', 800, false]);
});

test('quality: the active lines in view order with their last check; each line records only its own fields', () => {
  const PDX = require('../fixtures/plant-demo');
  const sheets = PDX.plantSheets(), setup = Object.values(P.parseSetup(sheets["'PLANT_OPERATIONS_MASTER'"]));
  assert.ok(setup.length >= 7, 'the setup tab is read');
  const status = Object.values(P.parseLineStatus(sheets["'PLANT LINE STATUS'"]));
  const app = { type: 'PRODUCTION_QUALITY', recordedAt: '2026-10-08T19:00:00Z', recordedBy: 'qa@uniteddairy.com', payload: { operationId: 'ut_prod_boxing', area: 'BOXING', product: 'Skim', status: 'DOWN', qualityCheck: 'FAIL' } };
  const lines = R.qualityLines(setup, [app], status, Date.parse('2026-10-08T20:00:00Z'));
  assert.deepEqual(lines.map(l => l.name), ['BOXING', 'TOTES', 'HTST #1', 'GALLON FILLER', 'BLOW MOLD']);
  assert.deepEqual([lines[0].last.product, lines[0].last.status, lines[0].today], ['Skim', 'DOWN', 2]);
  assert.deepEqual([lines[4].last.status, lines[4].last.cycleTime, lines[1].last.status], ['REVIEW', '7.8', undefined]);
  assert.deepEqual(R.qualityHistory([app], status, Date.parse('2026-10-08T20:00:00Z')).map(h => h.area), ['BOXING', 'BLOW MOLD', 'BOXING']);
  // Joe 10/10 (typed): Totes have no tip test; Raypak keeps it.
  assert.deepEqual([R.qualitySkip('Boxing'), R.qualitySkip('TOTES'), R.qualitySkip('RAYPAK'), R.qualitySkip('HTST #2'), R.qualitySkip('GALLON FILLER')],
    [{ cycle: true }, { cycle: true, weight: true, tip: true }, { cycle: true, weight: true }, { cycle: true, weight: true, tip: true }, {}]);
  assert.equal(R.weightText({ head1: '55.3', head2: '58.5' }), 'H1 55.3 · H2 58.5 · H3 — · H4 — · H5 — · H6 —');
  assert.throws(() => P.validateQuality({ operationId: 'ut_prod_boxing', status: 'BROKEN' }, SaveError), /Status must be Running, Review, Changeover, Down, or Finished/);
  assert.deepEqual(P.validateQuality({ operationId: 'ut_prod_boxing', weights: { result: '3990', evil: 'x' } }, SaveError).weights, { result: '3990' });
});

test('Shift Notes: shift by New York hour, the 24-hour log with reviews under their entry, and the save checks', () => {
  assert.deepEqual(['2026-10-08T11:00:00Z', '2026-10-08T19:00:00Z', '2026-10-09T05:00:00Z'].map(t => R.shiftAt(Date.parse(t))), ['FIRST SHIFT', 'SECOND SHIFT', 'THIRD SHIFT']);
  const rec = (id, at, values, follow, extra) => Object.assign({ type: 'SHIFT_REPORT', recordId: id, recordedAt: at, recordedBy: 'sup@uniteddairy.com', area: 'HANDOFF', payload: { entryId: id, section: 'HANDOFF', values, notes: '', followUpStatus: follow } }, extra);
  const journal = [
    rec('SHIFT-1', '2026-10-08T12:00:00Z', { Entry: 'Dock 3 door stuck', Type: 'Breakdown', Equipment: 'Dock 3 door' }, 'OPEN'),
    rec('SHIFT-2', '2026-10-08T13:00:00Z', { Entry: 'Called door company', Type: 'REVIEW', ParentId: 'SHIFT-1' }, 'MONITOR'),
    rec('SHIFT-3', '2026-10-08T15:00:00Z', { Entry: 'Fixed', Type: 'REVIEW', ParentId: 'SHIFT-1' }, 'RESOLVED'),
    rec('SHIFT-4', '2026-10-08T16:00:00Z', { Entry: 'Wet floor', Type: 'Safety', Equipment: 'Cooler' }, 'OPEN'),
    rec('SHIFT-5', '2026-10-06T16:00:00Z', { Entry: 'Too old', Type: 'Other' }, 'OPEN'),
    rec('SHIFT-6', '2026-10-08T16:00:00Z', { Entry: '40F', Type: '' }, 'OPEN', { area: 'TEMPERATURES', payload: { entryId: 'SHIFT-6', section: 'TEMPERATURES', values: { Entry: '40F' } } })];
  const log = R.shiftLog(journal, Date.parse('2026-10-08T20:00:00Z'));
  assert.deepEqual(log.map(r => [r.entryId, r.status, r.reviews.map(x => x.entry)]), [['SHIFT-4', 'OPEN', []], ['SHIFT-1', 'RESOLVED', ['Called door company', 'Fixed']]]);
  assert.deepEqual(['OPEN', 'MONITOR', 'RESOLVED', ''].map(R.followLabel), ['Needs attention', 'Monitor', 'Resolved', 'Needs attention']);
  assert.throws(() => P.validateShiftNote({ values: { Type: 'Breakdown' } }, SaveError), /Enter report information before saving/);
  assert.throws(() => P.validateShiftNote({ values: { ParentId: 'SHIFT-1' } }, SaveError), /Enter the review note before adding it/);
  assert.throws(() => P.validateShiftNote({ values: { Entry: 'x', Type: 'Party' } }, SaveError), /Type must be/);
  assert.throws(() => P.validateShiftNote({ values: { Entry: 'x', Type: 'Other' }, followUpStatus: 'LATER' }, SaveError), /Follow-up must be/);
  const ok = P.validateShiftNote({ values: { Entry: 'Belt slipping', Type: 'Breakdown', Equipment: 'Palletizer' }, notes: 'Watch it', shift: 'first shift', followUpStatus: 'monitor' }, SaveError);
  assert.deepEqual([ok.type, ok.equipment, ok.shift, ok.followUpStatus], ['Breakdown', 'Palletizer', 'FIRST SHIFT', 'MONITOR']);
  assert.equal(P.validateShiftNote({ values: { Entry: 'y'.repeat(900), ParentId: 'SHIFT-1' } }, SaveError).entry.length, 500);
});

test('Temperatures: locations in view order with their limits, HIGH / LOW / RECORDED, the 2-hour lock, and the save checks', () => {
  const sheets = require('../fixtures/plant-demo').plantSheets();
  const setup = Object.values(P.parseSetup(sheets["'PLANT_OPERATIONS_MASTER'"]));
  assert.deepEqual(R.tempLocations(setup).map(l => [l.location, l.lowLimit, l.highLimit]), [['Cooler North', 33, 41], ['Cooler Middle', '', '']]);
  const north = R.tempLocations(setup)[0];
  assert.deepEqual(['45', '30', '38', 'x'].map(t => R.tempStatus(north, t)), ['HIGH', 'LOW', 'RECORDED', '']);
  const reading = (at, temp, status) => ({ type: 'PLANT_TEMPERATURE_CHECK', recordId: 'T' + at, recordedAt: at, recordedBy: 'sup@uniteddairy.com', payload: { locationId: 'ut_temp_cooler_north', location: 'Cooler North', manualTemperature: temp, status } });
  const journal = [reading('2026-10-08T17:00:00Z', 45, 'HIGH'), reading('2026-10-08T19:30:00Z', 38, 'RECORDED'), reading('2026-10-07T10:00:00Z', 36, 'RECORDED')];
  const now = Date.parse('2026-10-08T20:00:00Z');
  const rows = R.tempRows(setup, journal, now);
  assert.deepEqual([rows[0].status, rows[0].lastManualTemperature, rows[0].lastStatus, rows[0].locked, rows[0].minutesUntilDue], ['MANUAL ONLY', 38, 'RECORDED', true, 90]);
  assert.deepEqual([rows[1].locked, rows[1].lastCheckedAt], [false, '']);
  assert.deepEqual(R.tempHistory(journal, now).map(h => h.manualTemperature), [38, 45]);
  assert.equal(R.tempLockLeft(journal, north, Date.parse('2026-10-08T21:31:00Z')), 0);
  assert.throws(() => P.validateTemperature({ locationId: 'ut_temp_cooler_north', manualTemperature: 'cold' }, SaveError), /Enter a valid manual temperature/);
  assert.throws(() => P.validateTemperature({ manualTemperature: '38' }, SaveError), /not configured/);
  assert.equal(P.validateTemperature({ locationId: 'ut_temp_cooler_north', manualTemperature: ' 38.5 ' }, SaveError).manualTemperature, 38.5);
});

test('Manager Center: scheduler, quality, temperature and shift-note numbers, and the Send Current Report text', () => {
  const e = (date, extra) => Object.assign({ date, pickupTime: '', scheduleType: 'ROUTE', trailer: '', status: 'SCHEDULED' }, extra);
  // Thursday 10/8: the week runs Sunday 10/4 to Saturday 10/10.
  const s = R.managerSchedule([e('2026-10-08', { pickupTime: '09:00' }), e('2026-10-08', { pickupTime: '06:30', trailer: 'T-5' }), e('2026-10-10', { scheduleType: 'CARRIER' }), e('2026-10-04'), e('2026-10-11'), e('2026-09-30')], '2026-10-08');
  assert.deepEqual(s, { month: 5, monthKey: '2026-10', week: 4, today: 2, next: '06:30', needTrailer: 1 });
  const q = R.managerQuality([{ last: { status: 'DOWN' } }, { last: { status: 'RUNNING', qualityCheck: 'FAIL' } }, { last: {} }],
    [{ tipTest: 'PASS', recordedAt: '2026-10-08T12:00:00Z' }, { tipTest: 'Fail', weights: { result: '3990' }, recordedAt: '2026-10-08T11:00:00Z' }, { weights: { head1: '' } }]);
  assert.deepEqual(q, { lines: 3, down: 2, tipTests: 2, tipFails: 1, lastWeight: '2026-10-08T11:00:00Z', history: 3 });
  assert.deepEqual(R.managerTemps([{ status: 'MANUAL ONLY', lastStatus: 'HIGH', lastCheckedAt: '2026-10-08T10:00:00Z', sensorId: 'x' }, { status: 'MANUAL ONLY', lastStatus: 'RECORDED', lastCheckedAt: '2026-10-08T12:00:00Z' }], [1, 2]),
    { sensors: 1, offline: 0, alerts: 1, lastManual: '2026-10-08T12:00:00Z', history: 2 });
  assert.deepEqual(R.managerNotes([{ type: 'Handoff', status: 'RESOLVED' }, { type: 'Breakdown', status: 'OPEN' }, { type: 'Safety', status: 'MONITOR' }]), { handoff: 1, issues: 2, open: 2, history: 3 });
  // 10:00 AM in New York: 799 (yesterday, not loaded) is behind; 801 (depart 10:15) is inside the 45-minute grace, so next with 803
  // (depart noon); 802 is loaded.
  const now = Date.parse('2026-10-08T14:00:00Z');
  const load = (route, state, dispatchTime, seq, extra) => Object.assign({ route, run: route, area: 'CASE', state, dispatchTime, loadDate: '2026-10-08', loadSequence: seq, truck: '', trailer: '' }, extra);
  const r = R.plantReport({
    loads: [load('801', 'WAITING', 615, 2, { trailer: 'T-12' }), load('802', 'DONE', 300, 1), load('803', 'LOADING', 720, 3, { area: 'TOTES' }), load('799', 'WAITING', 600, 0, { prior: true, loadDate: '2026-10-07' })],
    pickups: [{ route: '801', run: '801', item: 'Chocolate milk', quantity: '3', status: 'PENDING' }, { route: '802', status: 'COMPLETE' }],
    shiftLog: [{ type: 'Breakdown', equipment: 'Palletizer', entry: 'Jammed', status: 'OPEN', recordedAt: '2026-10-08T13:00:00Z', shift: 'FIRST SHIFT' }, { type: 'Breakdown', status: 'RESOLVED' }],
    lines: [{ name: 'BOXING', last: { status: 'DOWN', product: 'Skim', notes: 'Belt' } }],
    temps: [{ location: 'Cooler North', status: 'MANUAL ONLY', lastManualTemperature: 44.5, lastStatus: 'HIGH', lowLimit: 33, highLimit: 41, sensorTemp: '', locked: true }, { location: 'Cooler Middle', status: 'MANUAL ONLY', lastManualTemperature: '', lastStatus: '', lowLimit: '', highLimit: '', sensorTemp: '', locked: false }]
  }, now);
  assert.equal(r.subject, 'Plant Update 10/8 10:00 AM: 1 route behind');
  assert.deepEqual(r.behind.map(x => [x.route, x.late]), [['799', '24 h 0 min late']]);
  assert.deepEqual([r.nextUp.map(x => x.route), r.loaded.map(x => x.route), r.leftToLoad, r.totalLoads], [['801', '803'], ['802'], 3, 4]);
  assert.deepEqual(r.counts, { behind: 1, leftToLoad: 3, pickups: 1, down: 1, linesDown: 1, tempsOut: 1 });
  assert.match(r.text, /ROUTES BEHIND \(1\)\n {2}799 {2}depart 10:00 AM {2}NOT LOADED {2}24 h 0 min late/);
  assert.match(r.text, /PLANT BREAKDOWNS \(1\)\n {2}Palletizer {2}Jammed {2}logged 9:00 AM first shift {2}OPEN/);
  assert.match(r.text, /STILL TO LOAD: 3 of 4 {3}Case 2 of 3 · Totes 1 of 1/);
  assert.match(r.text, /TEMPERATURES\n {2}Cooler North {2}44\.5°F {2}HIGH \(limit 33–41\)\n {2}Cooler Middle {2}- {2}NO CHECK {2}check due/);
  assert.throws(() => P.validateReport({ subject: '', text: 'x' }, SaveError), /still loading/);
});

test('report route tiles: the run\'s short name (Joe 10/14)', () => {
  const n = (route, run) => R.shortRun({ route, run });
  assert.equal(n('845', 'UT DSD MILK'), 'DSD');
  assert.equal(n('906', 'LANCASTER'), 'Lancaster');
  assert.equal(n('6304', 'UT WALMART'), 'Walmart');
  assert.equal(n('503', 'SUN VALLEY'), 'Sun Valley');
  assert.equal(n('909', 'MARIETTA LOAD 2'), 'Marietta Load 2');
  assert.equal(n('8302_1', '8302_1'), '', 'a run named by its number has no short name');
  assert.equal(n('801', ''), '');
  assert.equal(R.routeNumber('6301_1'), '6301');
});

test('Run Complete: a Finished line is done for its shift; Undo takes it back (Joe 10/14)', () => {
  const now = Date.parse('2026-10-08T19:40:00Z'); // 3:40 PM in New York, second shift
  const fin = { status: 'FINISHED', product: 'Skim', recordedAt: '2026-10-08T19:30:00Z' };
  assert.equal(R.lineDone(fin, now), true);
  assert.equal(R.lineDone(fin, Date.parse('2026-10-09T05:30:00Z')), false, 'the next shift (third, 1:30 AM) opens the line again');
  assert.equal(R.lineDone({ status: 'RUNNING', recordedAt: fin.recordedAt }, now), false);
  const r = R.plantReport({ loads: [], lines: [{ name: 'GALLON FILLER', last: fin }, { name: 'BOXING', last: { status: 'RUNNING', product: 'Skim', recordedAt: '2026-10-08T19:00:00Z' } }], temps: [], roundStart: '2026-10-08T19:35:00Z' }, now);
  assert.deepEqual(r.lines.map(l => [l.line, l.status]), [['GALLON FILLER', 'RUN COMPLETE'], ['BOXING', 'NOT CHECKED']], 'a done line is not "not checked"');
  assert.match(r.text, /GALLON FILLER {2}RUN COMPLETE 3:30 PM/);
  assert.match(R.reportHtml(r, ''), /RUN COMPLETE 3:30 PM/);
  const checks = R.qualityLines([{ type: 'PRODUCTION_AREA', operationId: 'ut_prod_gallon', name: 'GALLON FILLER', status: 'ACTIVE' }],
    [{ type: 'PRODUCTION_QUALITY', recordedAt: '2026-10-08T19:00:00Z', payload: { operationId: 'ut_prod_gallon', status: 'RUNNING' }, _id: 'a' },
      { type: 'PRODUCTION_QUALITY', recordedAt: '2026-10-08T19:30:00Z', payload: { operationId: 'ut_prod_gallon', status: 'FINISHED', undone: true }, _id: 'b' }], [], now);
  assert.equal(checks[0].last.status, 'RUNNING', 'an undone Run Complete is off the line');
  assert.equal(P.validateQuality({ operationId: 'ut_prod_gallon', checkId: 'PRODUCTION_QUALITY_app_x1', undone: true }, SaveError).undone, true);
  assert.throws(() => P.validateQuality({ operationId: 'ut_prod_gallon', undone: true }, SaveError), /Undo needs the check/);
});


test('Loading Rundown: each Start / End keeps who saved it and from where, and a changed time keeps the change', async () => {
  const save = (day, fields, saver) => P.loadValues(tx(), db, { plant: P.validateLoad({ fields }, SaveError), saver }, day, STAMP, SaveError);
  const tablet = { email: 'station:st_1', name: 'Case Loadout', station: 'Case Loadout' }, desk = { email: 'mgr@uniteddairy.com', name: 'Pat Manager', station: '' };
  const a = await save({}, { startedAt: '2026-10-08T10:00:00Z' }, tablet);
  assert.deepEqual(a.startMark, { value: '2026-10-08T10:00:00.000Z', savedAt: STAMP, by: 'station:st_1', name: 'Case Loadout', via: 'TABLET', station: 'Case Loadout' });
  assert.equal(a.timeEdits, undefined);
  // The manager moves the Start at the desk: the new mark is the desk's, and the change keeps the tablet as who had it.
  const b = await save({ plantStartedAt: a.plantStartedAt, startMark: a.startMark }, { startedAt: '2026-10-08T09:30:00Z' }, desk);
  assert.equal(b.startMark.via, 'DESK');
  assert.equal(b.startMark.name, 'Pat Manager');
  assert.equal(b.timeEdits.length, 1);
  assert.deepEqual(Object.assign({}, b.timeEdits[0], { was: null }), { what: 'START', from: '2026-10-08T10:00:00.000Z', to: '2026-10-08T09:30:00.000Z', savedAt: STAMP, by: 'mgr@uniteddairy.com', name: 'Pat Manager', via: 'DESK', station: '', was: null });
  assert.deepEqual(b.timeEdits[0].was, { name: 'Case Loadout', via: 'TABLET', station: 'Case Loadout', savedAt: STAMP });
  // The same time again changes nothing; Done from the picker marks the End (and the Start it fills in).
  assert.equal((await save({ plantStartedAt: '2026-10-08T09:30:00.000Z' }, { startedAt: '2026-10-08T09:30:00Z' }, desk)).startMark, undefined);
  const c = await save({}, { status: 'COMPLETE' }, desk);
  assert.equal(c.endMark.value, STAMP);
  assert.equal(c.startMark.value, STAMP);
  // A station named by a tablet signed in with a UD account comes through validateLoad.
  assert.equal(P.validateLoad({ fields: { completedAt: STAMP }, station: 'Case Loadout <b>' }, SaveError).station, 'Case Loadout b');
});

test('Manager Walkthrough: due after 2 hours, past due 30 minutes later, Run Complete lines skipped, newest check is the last walkthrough', () => {
  const now = Date.parse('2026-10-15T17:00:00Z'), ago = (m) => new Date(now - m * 60000).toISOString();
  const yard = { rows: [{ trailer: '5312', recordedAt: ago(200), recordedBy: 'a@x' }, { trailer: '5307', recordedAt: ago(130), recordedBy: 'a@x' }, { trailer: '5330', recordedAt: '' }],
    locked: [{ trailer: '5320', recordedAt: ago(12), recordedBy: 'mike.a@x' }] };
  const temps = [{ locked: false, lastCheckedAt: ago(300), status: 'MANUAL ONLY', lastStatus: 'HIGH' }, { locked: true, lastCheckedAt: ago(20), lastCheckedBy: 'b@x', status: 'IN RANGE' }];
  const lines = [{ last: { recordedAt: ago(125), status: 'RUNNING', inApp: true } }, { last: { recordedAt: ago(5), status: 'FINISHED', inApp: true, recordedBy: 'c@x' } }, { last: {} }, { last: { recordedAt: ago(30), status: 'RUNNING', inApp: true } }];
  const w = R.managerWalk(yard, temps, lines, now);
  assert.deepEqual(w.yard, { due: 3, late: 2, total: 4 });
  assert.deepEqual(w.coolers, { due: 1, late: 1, out: 1, total: 2 });
  assert.deepEqual(w.quality, { due: 2, late: 1, total: 4 });
  assert.deepEqual(w.last, { at: ago(5), by: 'c@x' });
  assert.deepEqual(R.managerWalk({ rows: [], locked: [] }, [], [], now), { yard: { due: 0, late: 0, total: 0 }, coolers: { due: 0, late: 0, out: 0, total: 0 }, quality: { due: 0, late: 0, total: 0 }, last: null });
});

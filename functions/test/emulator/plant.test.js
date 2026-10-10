'use strict';
// Unloading & Washing, Product Returns and Truck Washing saves (plant.js), on the made-up plant day (plant-demo.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const { applyAction } = require('../../src/actions');
const R = require('../../src/plant-rules');
const D = require('../../src/demo-sheets');
const PD = require('../fixtures/plant-demo');

const DISPATCHER = { email: 'dispatch.test@uniteddairy.com' };
const DATE = PD.PLANT_DATE;
let n = 0;
const rid = () => 'plant-request-' + (++n) + '-' + Date.now();
const tick = () => new Date('2026-10-08T16:00:00Z');
const copy = () => runTransfer({ db: db(), reader: D.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: tick });
const unload = (route, run, fields, extra) => applyAction(db(), DISPATCHER, Object.assign({ action: 'saveUnloading', requestId: rid(), date: DATE, route, run, fields }, extra || {}));
const journal = async () => (await db().collection('plantJournal').where('date', '==', DATE).get()).docs.map(d => d.data());

test.beforeEach(async () => { await clear(); await copy(); });

test('Unloading: one at a time, End needs the count, the count goes on the Live week, a typed trailer is T-', async () => {
  const r811 = '2026-10-04__run_p811';
  await assert.rejects(unload('811', 'UT DSD MILK', { start: true }), /Stop unloading 805 · UT DSD MILK before starting another/);
  await assert.rejects(unload('805', 'UT DSD MILK', { end: true }), /Enter the quantity before ending/);
  const counted = await unload('805', 'UT DSD MILK', { casesIn: '25' }, { runDocId: '2026-10-04__run_p805', day: 'thu' });
  assert.equal(counted.status, 'UNLOADING');
  assert.equal((await db().collection('runs').doc('2026-10-04__run_p805').get()).data().days.thu.plantCaseReturn, 25);
  assert.equal((await unload('805', 'UT DSD MILK', { end: true })).status, 'COMPLETE');
  assert.equal((await unload('811', 'UT DSD MILK', { start: true, }, { runDocId: r811, day: 'thu' })).status, 'UNLOADING');
  await unload('811', 'UT DSD MILK', { trailer: '977' }, { runDocId: r811, day: 'thu' });
  const now = R.latestUnloads(await journal(), DATE);
  assert.equal(now[DATE + '|805|UT DSD MILK'].casesIn, '25');
  assert.equal(now[DATE + '|805|UT DSD MILK'].status, 'COMPLETE');
  assert.equal(now[DATE + '|811|UT DSD MILK'].trailer, 'T-977');
  assert.equal(now[DATE + '|811|UT DSD MILK'].status, 'UNLOADING');
  // The next copy from the sheets keeps what the app saved.
  await copy();
  assert.equal(R.latestUnloads(await journal(), DATE)[DATE + '|811|UT DSD MILK'].trailer, 'T-977');
});

test('RTA: the dock\'s returns and the driver check-in\'s return go back to the cooler; an unknown return is refused', async () => {
  await unload('805', 'UT DSD MILK', { returnIds: ['ret805'] });
  await unload('811', 'UT DSD MILK', { returnIds: ['CHECKIN|2026-10-04__run_p811|thu'] }, { runDocId: '2026-10-04__run_p811', day: 'thu' });
  await assert.rejects(unload('811', 'UT DSD MILK', { returnIds: ['ret805'] }, { runDocId: '2026-10-04__run_p811', day: 'thu' }), /no longer matches this run/);
  const now = R.latestUnloads(await journal(), DATE);
  assert.deepEqual(now[DATE + '|805|UT DSD MILK'].removed, ['ret805']);
  assert.deepEqual(now[DATE + '|811|UT DSD MILK'].removed, ['CHECKIN|2026-10-04__run_p811|thu']);
  // RTA alone does not start or end the unload.
  assert.equal(now[DATE + '|811|UT DSD MILK'].status, 'WAITING');
});

test('Wash: closes the trailer\'s requests and records the wash; another trailer\'s request is refused', async () => {
  const out = await applyAction(db(), DISPATCHER, { action: 'completeWash', requestId: rid(), date: DATE, trailer: '951', close: [{ list: 'plantWash', id: 'wash_d1' }] });
  assert.deepEqual(out.closed, ['wash_d1']);
  const w = (await db().collection('plantWash').doc('wash_d1').get()).data();
  assert.equal(w.status, 'COMPLETE');
  assert.equal(w.completed_by, DISPATCHER.email);
  const done = R.washesDone(await journal());
  assert.ok(done['951'], 'the wash of T-951 is recorded');
  await assert.rejects(applyAction(db(), DISPATCHER, { action: 'completeWash', requestId: rid(), date: DATE, trailer: '951', close: [{ list: 'plantWash', id: 'wash_d2' }] }), /for trailer T-960/);
  // + Add Wash: a trailer with no request is recorded washed too.
  await applyAction(db(), DISPATCHER, { action: 'completeWash', requestId: rid(), date: DATE, trailer: 'T-993' });
  assert.ok(R.washesDone(await journal())['993']);
  // The copy keeps the wash done (the sheet still says OPEN until the write-back writes it).
  await copy();
  assert.equal((await db().collection('plantWash').doc('wash_d1').get()).data().status, 'COMPLETE');
});

/* ---------- the Plant Operations Scheduler ---------- */
const schedule = (fields) => applyAction(db(), DISPATCHER, Object.assign({ action: 'savePlantSchedule', requestId: rid() }, fields));
const lanes = async (lane) => R.scheduleEntries((await db().collection('plantJournal').where('type', '==', R.LOAD_TYPE[lane]).get()).docs.map(d => d.data()), lane);
const GARBER = { routeId: 'rte_c892', runId: 'run_c892', route: '892', run: 'GARBER' };

test('Scheduler: the copy brings the loads; Add, Edit and Delete Load; Plant Route loads reach Weekly Dispatch', async () => {
  const ship = await lanes('SHIPPING');
  assert.deepEqual(ship.map(x => x.id).sort(), ['SCHED-a1', 'SCHED-g1', 'SCHED-g2', 'SCHED-s1', 'SCHED-w1', 'SCHED-w2']);
  assert.equal(ship.find(x => x.id === 'SCHED-w1').pickupTime, '06:30', 'the journal\'s last row is the load now');
  assert.deepEqual((await lanes('RECEIVING')).map(x => x.id).sort(), ['RECV-k1', 'RECV-v1']);
  // Add.
  const added = await schedule({ lane: 'SHIPPING', op: 'save', date: '2026-10-10', fields: Object.assign({ pickupTime: '6:15 AM', loadDate: '2026-10-09', trailer: '961', cases: '40', product: 'Cream' }, GARBER) });
  let x = (await lanes('SHIPPING')).find(e => e.id === added.id);
  assert.deepEqual([x.date, x.pickupTime, x.trailer, x.cases], ['2026-10-10', '06:15', 'T-961', '40']);
  assert.equal((await db().collection('plantLoads').doc(added.id).get()).data().date, '2026-10-10', 'Weekly Dispatch sees the load as needing a driver');
  // Edit a load the sheet has: moved to Friday as a carrier load; it leaves Weekly Dispatch.
  await schedule({ lane: 'SHIPPING', op: 'save', id: 'SCHED-g1', date: '2026-10-09', fields: Object.assign({ pickupTime: '07:30', scheduleType: 'CARRIER', poNumber: 'P-1' }, GARBER) });
  x = (await lanes('SHIPPING')).filter(e => e.id === 'SCHED-g1');
  assert.equal(x.length, 1, 'shown once, on its new day');
  assert.deepEqual([x[0].date, x[0].scheduleType, x[0].poNumber], ['2026-10-09', 'CARRIER', 'P-1']);
  assert.equal((await db().collection('plantLoads').doc('SCHED-g1').get()).exists, false);
  // The next copy from the sheets keeps the app's edit.
  await copy();
  assert.equal((await lanes('SHIPPING')).find(e => e.id === 'SCHED-g1').date, '2026-10-09');
  // Delete.
  await schedule({ lane: 'SHIPPING', op: 'remove', id: 'SCHED-w2', date: '2026-10-06' });
  assert.equal((await lanes('SHIPPING')).some(e => e.id === 'SCHED-w2'), false);
  assert.equal((await db().collection('plantLoads').doc('SCHED-w2').get()).exists, false);
  // A Receiving load is not on Shipping, and a Shipping one cannot be deleted from Receiving.
  await assert.rejects(schedule({ lane: 'RECEIVING', op: 'remove', id: 'SCHED-a1', date: '2026-10-09' }), /no longer on the Receiving schedule/);
  // A run not shown to the plant is refused.
  await assert.rejects(schedule({ lane: 'SHIPPING', op: 'save', date: '2026-10-10', fields: { routeId: 'rte_c951', runId: 'run_c951', route: '951', run: 'NOT PLANT', pickupTime: '07:00' } }), /no longer on the list/);
});

test('Scheduler: Receiving adds a supplier (next S code), refuses a repeat, and books its load', async () => {
  const out = await schedule({ lane: 'RECEIVING', op: 'addSupplier', name: 'Ohio Valley Fruit', label: 'Ohio Fruit' });
  assert.equal(out.supplier.route, 'S07');
  await assert.rejects(schedule({ lane: 'RECEIVING', op: 'addSupplier', name: 'ohio valley fruit' }), /already on the list/);
  await assert.rejects(schedule({ lane: 'RECEIVING', op: 'addSupplier', name: 'Another', code: 'S06' }), /S06 is already used/);
  const load = await schedule({ lane: 'RECEIVING', op: 'save', date: '2026-10-09', fields: { routeId: out.supplier.routeId, runId: out.supplier.runId, route: 'S07', run: 'OHIO VALLEY FRUIT', pickupTime: '11:00', product: 'Strawberries' } });
  const recv = await lanes('RECEIVING');
  assert.equal(recv.find(e => e.id === load.id).product, 'Strawberries');
  assert.equal((await db().collection('plantLoads').doc(load.id).get()).exists, false, 'Receiving loads are not driver loads');
  assert.equal((await lanes('SHIPPING')).some(e => e.id === load.id), false);
});

/* ---------- Yard Checks ---------- */
const yard = (fields) => applyAction(db(), DISPATCHER, Object.assign({ action: 'saveYardCheck', requestId: rid() }, fields));

test('Yard Checks: Record locks the trailer for 2 hours that day, Left Yard takes the load off, the copy keeps the app\'s checks', async () => {
  const loaded = (await db().collection('runs').where('weekStart', '==', '2026-10-04').get()).docs.map(d => Object.assign({ id: d.id }, d.data()));
  const now = Date.parse('2026-10-08T14:00:00Z');
  const before = R.yardQueue(loaded, await journal(), DATE, now).rows;
  assert.ok(before.length > 0, 'loaded trailers wait on the yard');
  const first = before[0];
  const res = await yard({ date: DATE, trailer: first.trailer.replace('T-', ''), routeRun: first.routeRun, temperature: '35', fuelLevel: '1/2', notes: 'Reefer running' });
  assert.equal(res.trailer, first.trailer);
  await assert.rejects(yard({ date: DATE, trailer: first.trailer, routeRun: first.routeRun, temperature: '36' }), /already checked\. It can be checked again in 1[12][0-9] minutes/);
  await assert.rejects(yard({ date: DATE, trailer: first.trailer, fuelLevel: '1/4' }), /Fuel level must be/);
  const left = await yard({ date: DATE, trailer: first.trailer, routeRun: first.routeRun, departed: true });
  assert.equal(left.status, 'DEPARTED');
  await copy();
  const j = await journal(), mine = j.filter(d => d.type === 'YARD_CHECK' && d.createdInApp);
  assert.deepEqual(mine.map(d => d.payload.status).sort(), ['COMPLETE', 'DEPARTED']);
  assert.equal(mine.find(d => d.payload.status === 'COMPLETE').payload.fuelLevel, '1/2');
  assert.ok(!R.yardQueue(loaded, j, DATE, now).rows.concat(R.yardQueue(loaded, j, DATE, now).locked).some(r => r.trailer === first.trailer && r.routeRun === first.routeRun), 'Left Yard takes the load off');
});

/* ---------- Production Line Status & Quality ---------- */
test('Quality: the copy brings the lines and their last checks; Record Quality Check needs a set-up line and a known status', async () => {
  const setup = (await db().collection('plantSetup').get()).docs.map(d => d.data());
  assert.deepEqual(R.productionLines(setup).map(l => l.name), ['BOXING', 'TOTES', 'HTST #1', 'GALLON FILLER', 'BLOW MOLD']);
  assert.equal((await db().collection('plantLineStatus').doc('ut_prod_blow_mold').get()).data().payload.cycleTime, '7.8');
  const q = (fields) => applyAction(db(), DISPATCHER, Object.assign({ action: 'saveQualityCheck', requestId: rid() }, fields));
  await assert.rejects(q({ operationId: 'ut_prod_retired', status: 'RUNNING' }), /Production area is not configured/);
  await assert.rejects(q({ operationId: 'ut_prod_totes', status: 'BROKEN' }), /Status must be/);
  const res = await q({ operationId: 'ut_prod_totes', product: 'Orange drink', status: 'REVIEW', qualityCheck: 'pass', temperature: '38', notes: 'Cap torque low' });
  assert.match(res.message, /TOTES production status updated/);
  await copy();
  const all = (await db().collection('plantJournal').where('type', '==', 'PRODUCTION_QUALITY').get()).docs.map(d => d.data());
  const lines = R.qualityLines(setup, all, (await db().collection('plantLineStatus').get()).docs.map(d => d.data()), Date.now());
  const totes = lines.find(l => l.name === 'TOTES').last;
  assert.deepEqual([totes.product, totes.status, totes.qualityCheck, totes.notes], ['Orange drink', 'REVIEW', 'PASS', 'Cap torque low']);
});

/* ---------- Shift Notes (Incident & Breakdown Log) ---------- */
test('Shift Notes: an entry and a review note under it are saved, kept by the next copy, and show on the 24-hour log', async () => {
  const s = (fields) => applyAction(db(), DISPATCHER, Object.assign({ action: 'saveShiftNote', requestId: rid() }, fields));
  await assert.rejects(s({ values: { Type: 'Breakdown' } }), /Enter report information before saving/);
  await assert.rejects(s({ values: { Entry: 'More', ParentId: 'SHIFT-nothere' } }), /no longer on the log/);
  const first = await s({ values: { Entry: 'Palletizer jammed twice', Type: 'Breakdown', Equipment: 'Palletizer' }, notes: 'Maintenance to look at the infeed', readingTime: '14:20', followUpStatus: 'OPEN' });
  assert.match(first.entryId, /^SHIFT-/);
  assert.ok(R.SHIFTS.indexOf(first.shift) >= 0);
  const review = await s({ values: { Entry: 'Infeed sensor cleaned', ParentId: first.entryId }, followUpStatus: 'RESOLVED' });
  assert.equal(review.message, 'Review note added.');
  await copy();
  const all = (await db().collection('plantJournal').where('type', '==', 'SHIFT_REPORT').get()).docs.map(d => d.data());
  const entry = R.shiftLog(all, Date.now()).find(r => r.entryId === first.entryId);
  assert.deepEqual([entry.type, entry.equipment, entry.notes, entry.status, entry.reviews.map(r => r.entry)], ['Breakdown', 'Palletizer', 'Maintenance to look at the infeed', 'RESOLVED', ['Infeed sensor cleaned']]);
});

/* ---------- Plant Temperatures & Coolers ---------- */
test('Temperatures: a manual reading is saved with HIGH / LOW from the limits and locks its location for 2 hours', async () => {
  const t = (fields) => applyAction(db(), DISPATCHER, Object.assign({ action: 'saveTemperatureCheck', requestId: rid() }, fields));
  await assert.rejects(t({ locationId: 'ut_prod_boxing', manualTemperature: '38' }), /Temperature location is not configured/);
  await assert.rejects(t({ locationId: 'ut_temp_cooler_north', manualTemperature: '' }), /Enter a valid manual temperature/);
  const res = await t({ locationId: 'ut_temp_cooler_north', manualTemperature: '44.5', notes: 'Door left open' });
  assert.equal(res.status, 'HIGH');
  assert.match(res.message, /Cooler North temperature recorded\. This location is locked for 2 hours/);
  await assert.rejects(t({ locationId: 'ut_temp_cooler_north', manualTemperature: '38' }), /Cooler North was already checked\. It can be checked again in 120 minutes/);
  const middle = await t({ locationId: 'ut_temp_cooler_middle', manualTemperature: '36' });
  assert.equal(middle.status, 'RECORDED');
  await copy();
  const all = (await db().collection('plantJournal').where('type', '==', 'PLANT_TEMPERATURE_CHECK').get()).docs.map(d => d.data());
  const rows = R.tempRows((await db().collection('plantSetup').get()).docs.map(d => d.data()), all, Date.now());
  assert.deepEqual(rows.map(r => [r.location, r.lastManualTemperature, r.lastStatus, r.locked]), [['Cooler North', 44.5, 'HIGH', true], ['Cooler Middle', 36, 'RECORDED', true]]);
});

/* ---------- Send Current Report ---------- */
test('Send Current Report: the report is kept as sent and not emailed (email is not set up in the new app)', async () => {
  const res = await applyAction(db(), DISPATCHER, { action: 'sendPlantReport', requestId: rid(), subject: 'Plant Update 10/8 10:00 AM: All routes on time', text: 'ROUTES BEHIND (0)', note: 'Short staffed on second shift' });
  assert.equal(res.sent, false);
  assert.match(res.message, /Report saved\. Email is not set up in the new app yet, so it was not emailed to Plant Managers/);
  const kept = (await db().collection('plantReports').doc(res.reportId).get()).data();
  assert.deepEqual([kept.subject, kept.note, kept.status, kept.emailed], ['Plant Update 10/8 10:00 AM: All routes on time', 'Short staffed on second shift', 'HELD', false]);
});

test('Send Current Report with email set up: the report is SENDING, with the report kept for the email layout', async () => {
  process.env.MAIL_FROM = 'joe@uniteddairy.com';
  try {
    const report = { dayLabel: 'Thursday 10/8', behind: [], loaded: [], nextUp: [], totalLoads: 0, leftToLoad: 0, pickups: [], down: [], lines: [], temperatures: [] };
    const res = await applyAction(db(), DISPATCHER, { action: 'sendPlantReport', requestId: rid(), subject: 'Plant Update 10/8 10:00 AM: All routes on time', text: 'ROUTES BEHIND (0)', note: '', report });
    assert.deepEqual([res.sent, res.sending, res.message], [false, true, 'Report saved. Sending the email…']);
    const kept = (await db().collection('plantReports').doc(res.reportId).get()).data();
    assert.deepEqual([kept.status, kept.emailed, JSON.parse(kept.reportJson).dayLabel], ['SENDING', false, 'Thursday 10/8']);
  } finally { delete process.env.MAIL_FROM; }
});

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

test('Add a return nobody noted: a RETURN on the load (or Unknown) that RTA clears and the next copy keeps', async () => {
  const add = (fields) => applyAction(db(), DISPATCHER, Object.assign({ action: 'addReturn', requestId: rid(), date: DATE }, fields));
  await assert.rejects(add({ route: '811', run: 'UT DSD MILK', cases: '3' }), /Pick the product/);
  await assert.rejects(add({ route: '811', run: 'UT DSD MILK', product: 'Whole Milk Gallon', cases: '' }), /Enter the cases/);
  await assert.rejects(add({ product: 'Whole Milk Gallon', cases: '2' }), /Pick the route/);
  const out = await add({ route: '811', run: 'UT DSD MILK', runDocId: '2026-10-04__run_p811', day: 'thu', trailer: '977', product: 'Whole Milk Gallon', sku: '1001', cases: '4' });
  const unknown = await add({ unknown: true, product: '2% Milk Half Gallon', cases: '2' });
  const rets = (await journal()).filter(d => d.type === 'RETURN' && d.createdInApp);
  const mine = rets.find(d => d.recordId === out.recordId), lost = rets.find(d => d.recordId === unknown.recordId);
  assert.equal(mine.payload.casesReturned, '4');
  assert.equal(mine.payload.notes, 'Whole Milk Gallon');
  assert.equal(mine.trailer, 'T-977');
  assert.equal(lost.route, 'Unknown');
  // RTA clears it the same way as a return the dock noted.
  await unload('811', 'UT DSD MILK', { returnIds: [out.recordId] }, { runDocId: '2026-10-04__run_p811', day: 'thu' });
  await unload('Unknown', 'Route not known', { returnIds: [unknown.recordId] });
  const now = R.latestUnloads(await journal(), DATE);
  assert.deepEqual(now[DATE + '|811|UT DSD MILK'].removed, [out.recordId]);
  await copy();
  assert.equal((await journal()).filter(d => d.type === 'RETURN' && d.createdInApp).length, 2, 'the copy keeps the added returns');
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
  // Joe 10/20: a deleted load stays deleted: a screen still showing it cannot bring it back with Save Load or Start.
  await assert.rejects(schedule({ lane: 'SHIPPING', op: 'save', id: 'SCHED-w2', date: '2026-10-06', fields: { routeId: 'rte_c6302', runId: 'run_c6302', route: '6302', run: 'UT WALMART', pickupTime: '04:00' } }), /deleted from the Scheduler/);
  await assert.rejects(schedule({ lane: 'SHIPPING', op: 'progress', id: 'SCHED-w2', date: '2026-10-06', step: 'start' }), /deleted from the Scheduler/);
  assert.equal((await lanes('SHIPPING')).some(e => e.id === 'SCHED-w2'), false);
  // A Receiving load is not on Shipping, and a Shipping one cannot be deleted from Receiving.
  await assert.rejects(schedule({ lane: 'RECEIVING', op: 'remove', id: 'SCHED-a1', date: '2026-10-09' }), /no longer on the Receiving schedule/);
  // A run not shown to the plant is refused.
  await assert.rejects(schedule({ lane: 'SHIPPING', op: 'save', date: '2026-10-10', fields: { routeId: 'rte_c951', runId: 'run_c951', route: '951', run: 'NOT PLANT', pickupTime: '07:00' } }), /no longer on the list/);
});

test('Scheduler: Receiving adds a supplier (next S code), refuses a repeat, and books its load', async () => {
  const out = await schedule({ lane: 'RECEIVING', op: 'addSupplier', name: 'Ohio Valley Fruit', label: 'Ohio Fruit' });
  assert.equal(out.supplier.route, 'S02', 'the next S code after the one supplier on the list (no sample suppliers since Joe 10/13)');
  await assert.rejects(schedule({ lane: 'RECEIVING', op: 'addSupplier', name: 'ohio valley fruit' }), /already on the list/);
  await assert.rejects(schedule({ lane: 'RECEIVING', op: 'addSupplier', name: 'Another', code: 'S06' }), /S06 is already used/);
  const load = await schedule({ lane: 'RECEIVING', op: 'save', date: '2026-10-09', fields: { routeId: out.supplier.routeId, runId: out.supplier.runId, route: 'S02', run: 'OHIO VALLEY FRUIT', pickupTime: '11:00', product: 'Strawberries' } });
  const recv = await lanes('RECEIVING');
  assert.equal(recv.find(e => e.id === load.id).product, 'Strawberries');
  assert.equal((await db().collection('plantLoads').doc(load.id).get()).exists, false, 'Receiving loads are not driver loads');
  assert.equal((await lanes('SHIPPING')).some(e => e.id === load.id), false);
});

test('Scheduler: no sample suppliers; a supplier can be edited or removed (Joe 10/13); booked loads keep it', async () => {
  const sups = async () => R.scheduleSuppliers((await db().collection('plantJournal').where('type', '==', R.SUPPLIER_TYPE).get()).docs.map(d => d.data()));
  assert.deepEqual((await sups()).map(x => x.run), ['MOUNTAIN STATE SUGAR'], 'only the suppliers the plant added');
  const added = (await schedule({ lane: 'RECEIVING', op: 'addSupplier', name: 'Ohio Valley Fruit' })).supplier;
  const load = await schedule({ lane: 'RECEIVING', op: 'save', date: '2026-10-09', fields: { routeId: 'SUP-m1', runId: 'SUP-m1', route: 'S06', run: 'MOUNTAIN STATE SUGAR', pickupTime: '09:00' } });
  // Edit: same place in the list, new name; a blank code keeps the code.
  await schedule({ lane: 'RECEIVING', op: 'editSupplier', id: 'SUP-m1', name: 'Dean Foods Milk', label: 'Dean' });
  let list = await sups();
  assert.deepEqual(list.map(x => [x.routeId, x.route, x.run, x.name]), [['SUP-m1', 'S06', 'DEAN FOODS MILK', 'Dean'], [added.routeId, added.route, 'OHIO VALLEY FRUIT', 'OHIO VALLEY FRUIT']]);
  await assert.rejects(schedule({ lane: 'RECEIVING', op: 'editSupplier', id: 'SUP-m1', name: 'ohio valley fruit' }), /already on the list/);
  await assert.rejects(schedule({ lane: 'RECEIVING', op: 'editSupplier', id: 'SUP-m1', name: 'X', code: added.route }), /is already used/);
  await schedule({ lane: 'RECEIVING', op: 'editSupplier', id: added.routeId, name: 'Ohio Valley Fruit Co', code: 'OVF' });
  list = await sups();
  assert.deepEqual([list[1].routeId, list[1].route, list[1].run], [added.routeId, 'OVF', 'OHIO VALLEY FRUIT CO']);
  // Remove: off the list, cannot be picked for a new load, but its booked load can still be edited.
  await schedule({ lane: 'RECEIVING', op: 'removeSupplier', id: 'SUP-m1' });
  assert.deepEqual((await sups()).map(x => x.routeId), [added.routeId]);
  await assert.rejects(schedule({ lane: 'RECEIVING', op: 'editSupplier', id: 'SUP-m1', name: 'Back' }), /no longer on the list/);
  await assert.rejects(schedule({ lane: 'RECEIVING', op: 'save', date: '2026-10-10', fields: { routeId: 'SUP-m1', runId: 'SUP-m1', route: 'S06', run: 'DEAN FOODS MILK', pickupTime: '09:00' } }), /no longer on the list/);
  const had = (await lanes('RECEIVING')).find(e => e.id === load.id);
  await schedule({ lane: 'RECEIVING', op: 'save', id: load.id, date: '2026-10-09', fields: { routeId: had.routeId, runId: had.runId, route: had.route, run: had.run, pickupTime: '10:00', product: 'Cream' } });
  const now = (await lanes('RECEIVING')).find(e => e.id === load.id);
  assert.deepEqual([now.runId, now.pickupTime, now.product], ['SUP-m1', '10:00', 'Cream']);
  // A load booked with an old sample supplier can still be edited.
  const old = (await lanes('RECEIVING')).find(e => e.runId === 'SUP-START-1');
  await schedule({ lane: 'RECEIVING', op: 'save', id: old.id, date: old.date, fields: { routeId: old.routeId, runId: old.runId, route: old.route, run: old.run, pickupTime: '07:30' } });
  assert.equal((await lanes('RECEIVING')).find(e => e.id === old.id).pickupTime, '07:30');
  // Shipping has no suppliers.
  await assert.rejects(schedule({ lane: 'SHIPPING', op: 'removeSupplier', id: added.routeId }), /Suppliers are on Receiving/);
});

test('Scheduler: a station loads a Shipping load and receives a Receiving load (Joe 10/12, Boxing); a finished one stays finished', async () => {
  const work = async (lane, id) => (await lanes(lane)).find(e => e.id === id).work;
  assert.equal((await work('SHIPPING', 'SCHED-s1')).state, 'WAITING');
  // Joe 10/22: typing a trailer (or a count) on a load not yet started saves it and leaves the load waiting.
  await schedule({ lane: 'SHIPPING', op: 'progress', id: 'SCHED-s1', date: '2026-10-08', step: 'save', fields: { trailer: 'T-969', count: '10' } });
  const typed = (await lanes('SHIPPING')).find(e => e.id === 'SCHED-s1');
  assert.deepEqual([typed.work.state, typed.work.startedAt, typed.trailer, typed.work.count], ['WAITING', '', 'T-969', '10'], 'a typed trailer does not start the load');
  await schedule({ lane: 'SHIPPING', op: 'progress', id: 'SCHED-s1', date: '2026-10-08', step: 'start' });
  assert.equal((await work('SHIPPING', 'SCHED-s1')).state, 'WORKING');
  await schedule({ lane: 'SHIPPING', op: 'progress', id: 'SCHED-s1', date: '2026-10-08', step: 'save', fields: { count: '412', temperature: '34', trailer: 'T-970' } });
  await schedule({ lane: 'SHIPPING', op: 'progress', id: 'SCHED-s1', date: '2026-10-08', step: 'complete' });
  const done = (await lanes('SHIPPING')).find(e => e.id === 'SCHED-s1');
  assert.deepEqual([done.work.state, done.work.count, done.work.temperature, done.trailer, done.work.completedBy], ['COMPLETE', '412', '34', 'T-970', 'dispatch.test@uniteddairy.com']);
  assert.equal(done.poNumber, '4471', 'the rest of the load is kept');
  await assert.rejects(schedule({ lane: 'SHIPPING', op: 'progress', id: 'SCHED-s1', date: '2026-10-08', step: 'save', fields: { count: '1' } }), /already complete/);
  await assert.rejects(schedule({ lane: 'SHIPPING', op: 'progress', id: 'SCHED-a1', date: '2026-10-09', step: 'save', fields: { count: 'ten' } }), /Boxes must be a whole number/);
  await schedule({ lane: 'RECEIVING', op: 'progress', id: 'RECV-k1', date: '2026-10-09', step: 'complete', fields: { count: '38', notes: 'Two pallets short' } });
  const got = (await lanes('RECEIVING')).find(e => e.id === 'RECV-k1');
  assert.deepEqual([got.work.state, got.work.count, got.work.notes], ['COMPLETE', '38', 'Two pallets short']);
  await assert.rejects(schedule({ lane: 'RECEIVING', op: 'progress', id: 'RECV-k1', date: '2026-10-09', step: 'complete' }), /already received/);
  // The next copy from the sheets keeps the station's work.
  await copy();
  assert.equal((await work('SHIPPING', 'SCHED-s1')).state, 'COMPLETE');
});

/* ---------- Loading limit (Joe 10/12) ---------- */
// Case Loadout loads at most 2 at the same time and Boxing at most 3 (its Scheduler shipments too). A paused load does not
// count; resuming one needs room under the limit.
const plantLoad = (runDocId, day, fields) => applyAction(db(), DISPATCHER, { action: 'savePlantLoad', requestId: rid(), runDocId, day, fields }, tick);
const PLANT = require('../../src/plant');
async function areaLoads(area) {
  const L = require('../../src/logic'), out = [];
  (await db().collection('runs').get()).docs.forEach(d => {
    const run = d.data(), a = PLANT.areaOf(run.loadType || (run.masterShow && run.masterShow.loadType));
    // Today's loads and yesterday's still open (the station lists both).
    if (a === area) [DATE, L.addDays(DATE, -1)].forEach(day => L.loadBlocksFor(run, day).forEach(b => { if (day === DATE || !run.days[b.prefix].completeTime) out.push({ runDocId: d.id, day: b.prefix, d: run.days[b.prefix] }); }));
  });
  return out;
}
const isLoading = (d) => !d.completeTime && String(d.loadStatus || '').toUpperCase() !== 'PAUSED' && (!!d.plantStartedAt || String(d.loadStatus || '').toUpperCase() === 'LOADING');
const isWaiting = (d) => !d.completeTime && !d.plantStartedAt && ['LOADING', 'PAUSED'].indexOf(String(d.loadStatus || '').toUpperCase()) < 0;
test('Loading limit: Case Loadout loads 2 at a time; a paused one does not count; resuming needs room', async () => {
  // The made-up day has two case loads loading (808 today, 6303 still open from yesterday).
  const all = await areaLoads('CASE'), going = all.filter(x => isLoading(x.d)), [a, c] = all.filter(x => isWaiting(x.d));
  assert.equal(going.length, 2);
  const p808 = going.find(x => x.runDocId.endsWith('p808'));
  await assert.rejects(plantLoad(a.runDocId, a.day, { startedAt: '2026-10-08T15:00:00.000Z' }), /2 loads are already loading\. Finish or pause one first\./);
  await assert.rejects(plantLoad(a.runDocId, a.day, { status: 'LOADING' }), /2 loads are already loading/);
  await assert.rejects(plantLoad(p808.runDocId, p808.day, { status: 'PAUSED' }), /A pause reason is required/);
  await plantLoad(p808.runDocId, p808.day, { status: 'PAUSED', pauseReason: 'Waiting on product' });
  const paused = (await db().collection('runs').doc(p808.runDocId).get()).data().days[p808.day];
  assert.equal(paused.loadStatus, 'PAUSED');
  assert.match(paused.plantNotes, /Paused .*: Waiting on product$/);
  await plantLoad(a.runDocId, a.day, { startedAt: '2026-10-08T15:00:00.000Z' });
  await assert.rejects(plantLoad(p808.runDocId, p808.day, { status: 'LOADING' }), /2 loads are already loading/, 'resuming needs room');
  await assert.rejects(plantLoad(c.runDocId, c.day, { status: 'LOADING' }), /2 loads are already loading/);
  await plantLoad(a.runDocId, a.day, { quantity: 40 }); // saving the cases on a running load is not a start
  await plantLoad(a.runDocId, a.day, { status: 'COMPLETE' });
  await plantLoad(p808.runDocId, p808.day, { status: 'LOADING' });
  const resumed = (await db().collection('runs').doc(p808.runDocId).get()).data().days[p808.day];
  assert.deepEqual([resumed.loadStatus, resumed.plantStartedAt], ['LOADING', '2026-10-08T05:27:00.000Z'], 'resuming keeps the start time');
  // Joe 10/22: the pause was timed, so its minutes do not count as loading time.
  assert.equal(paused.pauseMark.at !== '', true, 'the pause start is kept');
  assert.equal(resumed.pauseMark.at, '');
  assert.ok(resumed.pauseMark.minutes >= 0 && resumed.pauseMark.minutes === Math.round(resumed.pauseMark.minutes), 'the paused minutes are added up on resume');
});

// Joe 10/13: a manager may go past the limit from the Loadout Center (it asks with overLimit); a dispatcher, a Plant Station
// tablet (even signed in as a manager, it never asks) and a station code alone stay limited.
test('Loading limit: a manager on the Loadout Center may go past it; everyone else stays limited', async () => {
  const ADMIN = { email: 'admin.test@uniteddairy.com' };
  const all = await areaLoads('CASE'), [w1, w2] = all.filter(x => isWaiting(x.d));
  assert.equal(all.filter(x => isLoading(x.d)).length, 2);
  const as = (user, x, extra) => applyAction(db(), user, Object.assign({ action: 'savePlantLoad', requestId: rid(), runDocId: x.runDocId, day: x.day, fields: { status: 'LOADING' } }, extra || {}), tick);
  await assert.rejects(as(DISPATCHER, w1, { overLimit: true }), /2 loads are already loading/, 'a dispatcher is not a manager');
  await assert.rejects(as(ADMIN, w1), /2 loads are already loading/, 'a station tablet does not ask to go past it');
  await assert.rejects(as({ email: 'station@uniteddairy.com', station: { name: 'Case Loadout' } }, w1, { overLimit: true }), /2 loads are already loading/, 'a station code alone is never a manager');
  await as(ADMIN, w1, { overLimit: true });
  assert.equal((await areaLoads('CASE')).filter(x => isLoading(x.d)).length, 3, 'the manager made it 3');
  await assert.rejects(as(DISPATCHER, w2), /3 loads are already loading/, 'still limited for everyone else');
});

test('Loading limit: Boxing loads 3 at a time, its Scheduler shipments included; a paused shipment does not count', async () => {
  const box = await areaLoads('BOXING');
  const loading = box.filter(x => isLoading(x.d)).length, waiting = box.filter(x => isWaiting(x.d));
  // Fill Boxing to 2 with box loads, then the Aldi shipment makes 3.
  for (const x of waiting.slice(0, Math.max(0, 2 - loading))) await plantLoad(x.runDocId, x.day, { status: 'LOADING' });
  const ship = (step, extra) => applyAction(db(), DISPATCHER, Object.assign({ action: 'savePlantSchedule', requestId: rid(), lane: 'SHIPPING', op: 'progress', id: 'SCHED-a1', date: '2026-10-09', step }, extra || {}), tick);
  await ship('start');
  const more = (await areaLoads('BOXING')).find(x => isWaiting(x.d));
  if (more) await assert.rejects(plantLoad(more.runDocId, more.day, { status: 'LOADING' }), /3 loads are already loading/);
  await assert.rejects(ship('pause'), /A pause reason is required/);
  await ship('pause', { pauseReason: 'Carrier late' });
  assert.equal((await lanes('SHIPPING')).find(e => e.id === 'SCHED-a1').work.state, 'PAUSED');
  assert.match((await lanes('SHIPPING')).find(e => e.id === 'SCHED-a1').work.notes, /Paused .*: Carrier late/);
  assert.ok((await lanes('SHIPPING')).find(e => e.id === 'SCHED-a1').work.pauseMark.at, 'Joe 10/22: the shipment\'s pause is timed');
  if (more) {
    await plantLoad(more.runDocId, more.day, { status: 'LOADING' });
    await assert.rejects(ship('start'), /3 loads are already loading/, 'resuming the shipment needs room');
  }
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

/* ---------- Shift Notes ---------- */
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
  assert.match(res.message, /Report saved\. Email is not set up in Operations yet, so it was not emailed to Plant Managers/);
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

// Joe 10/20: the forecast in the next report says how much time was made up or lost since the shift's earlier report.
test('Send Current Report: the forecast keeps the earlier report\'s time and how far behind it was', async () => {
  const report = (asOf, lateBy) => ({ dayLabel: 'Today', behind: [], loaded: [], nextUp: [], totalLoads: 0, leftToLoad: 0, pickups: [], down: [], lines: [], temperatures: [],
    forecast: { asOf, late: 1, loads: [{ late: true, lateBy }] } });
  const send = (asOf, lateBy) => applyAction(db(), DISPATCHER, { action: 'sendPlantReport', requestId: rid(), subject: 'Plant Update ' + asOf, text: 'ROUTES BEHIND (0)', note: '', report: report(asOf, lateBy) });
  const kept = async (res) => JSON.parse((await db().collection('plantReports').doc(res.reportId).get()).data().reportJson).forecast;
  const first = await send('8:42 AM', 858);
  const second = await send('10:42 AM', 778);
  assert.deepEqual((await kept(second)).before, { asOf: '8:42 AM', behind: 860 });
  assert.match(R.forecastSummary(await kept(second)).changeText, /^Made up 1 hr 20 min since the 8:42 AM report$/);
  assert.ok(!(await kept(first)).before || (await kept(first)).before.asOf !== '10:42 AM', 'an earlier report never compares with a later one');
});

// Joe 10/15 (Loading Rundown): each Start / End keeps who saved it and whether from a Plant Station tablet or the desk; a change
// keeps the old time; the next copy from the sheets keeps all of it (app-only fields).
test('Loading Rundown: the tablet and the desk are told apart, a changed time is kept, and the copy keeps them', async () => {
  const [w] = (await areaLoads('CASE')).filter(x => isWaiting(x.d));
  const ADMIN = { email: 'admin.test@uniteddairy.com' };
  const save = (user, fields, extra) => applyAction(db(), user, Object.assign({ action: 'savePlantLoad', requestId: rid(), runDocId: w.runDocId, day: w.day, fields, overLimit: true }, extra || {}), tick);
  await save(ADMIN, { startedAt: '2026-10-08T15:00:00.000Z' }, { station: 'Case Loadout' });
  let d = (await db().collection('runs').doc(w.runDocId).get()).data().days[w.day];
  assert.deepEqual([d.startMark.via, d.startMark.station, d.startMark.value, d.startMark.by], ['TABLET', 'Case Loadout', '2026-10-08T15:00:00.000Z', 'admin.test@uniteddairy.com']);
  await save(ADMIN, { startedAt: '2026-10-08T14:30:00.000Z', completedAt: '2026-10-08T15:20:00.000Z' });
  d = (await db().collection('runs').doc(w.runDocId).get()).data().days[w.day];
  assert.equal(d.startMark.via, 'DESK');
  assert.equal(d.endMark.value, '2026-10-08T15:20:00.000Z');
  assert.equal(d.timeEdits.length, 1);
  assert.deepEqual([d.timeEdits[0].what, d.timeEdits[0].from, d.timeEdits[0].to, d.timeEdits[0].via, d.timeEdits[0].was.via], ['START', '2026-10-08T15:00:00.000Z', '2026-10-08T14:30:00.000Z', 'DESK', 'TABLET']);
  // A Plant Station signed in by its code alone is the tablet, named by its station.
  await save({ email: 'station:st_x', station: { name: 'Case Loadout 2' } }, { completedAt: '2026-10-08T15:25:00.000Z' });
  d = (await db().collection('runs').doc(w.runDocId).get()).data().days[w.day];
  assert.deepEqual([d.endMark.via, d.endMark.station, d.timeEdits.length], ['TABLET', 'Case Loadout 2', 2]);
  await copy();
  const kept = (await db().collection('runs').doc(w.runDocId).get()).data().days[w.day];
  assert.deepEqual([kept.startMark.via, kept.endMark.station, kept.timeEdits.length], ['DESK', 'Case Loadout 2', 2]);
});

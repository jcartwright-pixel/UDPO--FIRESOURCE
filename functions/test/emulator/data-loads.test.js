'use strict';
// Joe 10/13: his 20 Receiving suppliers, loaded once on each app; only missing names are added, nothing is changed or removed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { applyAction } = require('../../src/actions');
const R = require('../../src/plant-rules');
const DL = require('../../src/data-loads');

const MANAGER = { email: 'manager.test@uniteddairy.com' };
const tick = () => new Date('2026-10-08T16:00:00Z');
const suppliers = async () => R.scheduleSuppliers((await db().collection('plantJournal').where('type', '==', R.SUPPLIER_TYPE).get()).docs.map(d => d.data()));

test('Joe\'s 20 Receiving suppliers load once: missing ones added in his spelling and order, one already there skipped', async () => {
  await clear();
  const { runTransfer } = require('../../src/transfer');
  const D = require('../../src/demo-sheets');
  const PD = require('../fixtures/plant-demo');
  await runTransfer({ db: db(), reader: D.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: tick });
  // One of them typed by hand already (in another spelling), and one other supplier the plant uses.
  await applyAction(db(), MANAGER, { action: 'savePlantSchedule', requestId: 'data-load-test-1', lane: 'RECEIVING', op: 'addSupplier', name: 'west rock', label: 'WestRock', code: '' }, tick);
  await applyAction(db(), MANAGER, { action: 'savePlantSchedule', requestId: 'data-load-test-2', lane: 'RECEIVING', op: 'addSupplier', name: 'Keystone Paper', label: '', code: 'K1' }, tick);
  const before = await suppliers();

  const first = await DL.runDataLoads(db(), { now: tick });
  const r = first[DL.RECEIVING_SUPPLIERS_ID];
  assert.equal(r.added.length, 19);
  assert.deepEqual(r.skipped, ['West Rock']);
  const after = await suppliers();
  assert.equal(after.length, before.length + 19);
  before.forEach(b => assert.ok(after.some(a => a.routeId === b.routeId && a.run === b.run && a.name === b.name), 'kept ' + b.run));
  const added = after.filter(a => /^SUP-LOAD-/.test(a.routeId));
  assert.deepEqual(added.map(a => a.name), DL.RECEIVING_SUPPLIERS.filter(x => x !== 'West Rock'), 'his spelling, in his order');
  assert.deepEqual(added.slice(0, 2).map(a => a.run), ['CHARLES STUBE', 'DAIRY INGREDIENT']);
  assert.equal(new Set(after.map(a => a.route)).size, after.length, 'every code is different');

  // A second run (another deploy, or the job again) changes nothing, even after someone removed one by hand.
  const sig = added.find(a => a.name === 'Sig');
  await applyAction(db(), MANAGER, { action: 'savePlantSchedule', requestId: 'data-load-test-3', lane: 'RECEIVING', op: 'removeSupplier', id: sig.routeId }, tick);
  const again = await DL.runDataLoads(db(), { now: tick });
  assert.deepEqual(again[DL.RECEIVING_SUPPLIERS_ID], { skipped: true });
  assert.equal((await suppliers()).length, after.length - 1, 'Sig stays removed');
  // A load can be picked on a Receiving delivery like any supplier.
  const crest = added.find(a => a.name === 'Crest');
  const res = await applyAction(db(), MANAGER, { action: 'savePlantSchedule', requestId: 'data-load-test-4', lane: 'RECEIVING', op: 'save', date: '2026-10-09', fields: { routeId: crest.routeId, runId: crest.runId, route: crest.route, run: crest.run, pickupTime: '08:00' } }, tick);
  assert.equal(res.ok, true);
});

test('Joe\'s four garage technicians load once by name only: one already listed in the sheet\'s spelling is skipped, no login IDs', async () => {
  await clear();
  const { garageCall } = require('../../src/garage');
  const { runTransfer } = require('../../src/transfer');
  const D = require('../../src/demo-sheets');
  const PD = require('../fixtures/plant-demo');
  await runTransfer({ db: db(), reader: D.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: tick });
  await db().collection('garageTechs').get().then(s => Promise.all(s.docs.map(d => d.ref.delete())));
  // Sean Martin is already on the list the way the GARAGE TECHNICIANS sheet writes names.
  await db().collection('garageTechs').doc('TECH-SM').set({ tech_id: 'TECH-SM', name: 'MARTIN Sean', active: 'YES' });
  const first = await DL.runDataLoads(db(), { now: tick });
  const r = first[DL.GARAGE_TECHS_ID];
  assert.deepEqual(r.added, ['TOM JELLICK', 'JOHN MYERS', 'JAXON NARD']);
  assert.deepEqual(r.skipped, ['Shaun Martin']);
  const techs = (await db().collection('garageTechs').get()).docs.map(d => d.data());
  assert.equal(techs.length, 4);
  techs.filter(t => t.dataLoad).forEach(t => assert.deepEqual([t.active, t.facility_id, /^TECH-[0-9A-F]{8}$/.test(t.tech_id)], ['YES', 'fac_uniontown', true]));
  assert.equal((await db().collection('garageLogins').get()).size, 0, 'no login IDs are loaded');
  // They show on the Garage Station; each needs a login ID before signing in, and Set login ID works on them.
  const read = await garageCall(db(), { op: 'read', tokens: [] }, tick);
  assert.deepEqual(read.techs.map(t => t.name), ['JAXON NARD', 'JOHN MYERS', 'MARTIN Sean', 'TOM JELLICK']);
  const tom = techs.find(t => t.name === 'TOM JELLICK');
  await assert.rejects(garageCall(db(), { op: 'signIn', techId: tom.tech_id, loginId: '48213' }, tick), /no login ID yet/);
  await applyAction(db(), MANAGER, { action: 'saveGarageTech', requestId: 'data-load-tech-1', op: 'LOGIN', techId: tom.tech_id, loginId: '48213' }, tick);
  assert.equal((await garageCall(db(), { op: 'signIn', techId: tom.tech_id, loginId: '48213' }, tick)).name, 'TOM JELLICK');
  // A second run changes nothing.
  assert.deepEqual((await DL.runDataLoads(db(), { now: tick }))[DL.GARAGE_TECHS_ID], { skipped: true });
  assert.equal((await db().collection('garageTechs').get()).size, 4);
});

// Joe 10/13: "input all the mileages in to our units that we have now. So then I can start adjusting those also."
test('Fleet Service starting miles load once from the GPS odometers: a typed number stays, a unit with no reading stays blank', async () => {
  await clear();
  const d = db(), stamp = '2026-10-13T20:00:00.000Z', SB = { now: tick, project: 'ud-distribution-sandbox' };
  const unit = (id, u, type, extra) => d.collection('equipment').doc(id).set(Object.assign({ unit: u, type, status: 'ACTIVE', facilityId: 'fac_uniontown' }, extra || {}));
  await unit('veh_1', '223893', 'TRUCK'); await unit('veh_2', '223894', 'TRUCK'); await unit('veh_3', '223895', 'TRUCK'); await unit('veh_4', 'T-2893', 'TRAILER');
  await unit('veh_5', '223896', 'TRUCK', { facilityId: 'fac_charleston' });
  await d.collection('fleetSetup').doc('223894').set({ unit: '223894', last_service_miles: '100000' });
  // Nothing read from Fleet yet: the load waits.
  assert.deepEqual((await DL.runDataLoads(d, SB))[DL.FLEET_MILES_ID], { waiting: 'no GPS odometers read yet' });
  const gps = (tag, odometerMiles, engineHours) => d.collection('gpsTrucks').doc(tag).set({ tag, odometerMiles, engineHours, lastReport: stamp });
  await gps('223893', 114720.6, 9000); await gps('223894', 120000, 0); await gps('T-2893', null, 1950.4); await gps('223896', 5000, 0);
  assert.match((await DL.runDataLoads(d, { now: tick }))[DL.FLEET_MILES_ID].skipped, /test copy only/, 'nothing on the live app');
  assert.equal((await d.collection('fleetSetup').doc('223893').get()).exists, false, 'the live app is not touched');
  const r = (await DL.runDataLoads(d, SB))[DL.FLEET_MILES_ID];
  assert.deepEqual(r, { set: 2, kept: 1, noReading: 1 });
  assert.equal((await d.collection('fleetSetup').doc('223893').get()).data().last_service_miles, '114721');
  assert.equal((await d.collection('fleetSetup').doc('223894').get()).data().last_service_miles, '100000', 'a typed number stays');
  assert.equal((await d.collection('fleetSetup').doc('T-2893').get()).data().last_service_hours, '1950', 'a trailer gets its reefer hours');
  assert.equal((await d.collection('fleetSetup').doc('223895').get()).exists, false, 'no Fleet reading, left blank');
  assert.equal((await d.collection('fleetSetup').doc('223896').get()).exists, false, 'another plant\'s truck is not touched');
  const mark = (await d.collection('dataLoads').doc(DL.FLEET_MILES_ID).get()).data();
  assert.deepEqual(mark.set.map(x => x.unit), ['223893', 'T-2893']);
  assert.deepEqual((await DL.runDataLoads(d, SB))[DL.FLEET_MILES_ID], { skipped: true });
});

test('Garage work orders load (test copy only): each open write-up already sent to the garage gets one work order, once', async () => {
  await clear();
  const d = db(), w = (id, extra) => d.collection('maintenance').doc(id).set(Object.assign({ record_id: id, kind: 'TRUCK', truck_number: '223881', issue_details: 'Clearance light out', status: 'OPEN', opened_at: '2026-10-13T12:00:00Z' }, extra));
  await w('TRK-A', { notes: 'Sent to garage 2026-10-13T13:00:00Z by joe' });
  await w('TRK-B', { notes: 'Sent to garage 2026-10-13T13:00:00Z by joe', truck_number: '223879' });
  await w('TRK-C', { notes: 'Sent to garage 2026-10-13T13:00:00Z by joe', status: 'COMPLETE' });
  await w('TRK-D', { notes: '' });
  await d.collection('workOrders').doc('WO-KEPT0001').set({ work_order_id: 'WO-KEPT0001', source: 'WRITE_UP', source_kind: 'trucks', source_id: 'TRK-B', status: 'WORKING' });
  assert.match((await DL.runDataLoads(d, { now: tick }))[DL.GARAGE_ORDERS_ID].skipped, /test copy only/, 'nothing on the live app');
  assert.equal((await d.collection('dataLoads').doc(DL.GARAGE_ORDERS_ID).get()).exists, false);
  const r = (await DL.runDataLoads(d, { now: tick, project: 'ud-distribution-sandbox' }))[DL.GARAGE_ORDERS_ID];
  assert.deepEqual(r, { made: 1, kept: 1 });
  const orders = (await d.collection('workOrders').get()).docs.map(x => x.data());
  assert.deepEqual(orders.map(o => o.source_id).sort(), ['TRK-A', 'TRK-B']);
  const made = orders.find(o => o.source_id === 'TRK-A');
  assert.deepEqual([made.unit, made.unit_type, made.status, made.problem], ['223881', 'TRUCK', 'NEW', 'Clearance light out']);
  assert.deepEqual((await DL.runDataLoads(d, { now: tick, project: 'ud-distribution-sandbox' }))[DL.GARAGE_ORDERS_ID], { skipped: true });
});

test('Half gallon label readers load (test copy only): both half gallon fillers counted by their UPC scanner, once; another setting is kept', async () => {
  await clear();
  const d = db(), line = (id, name) => d.collection('plantSetup').doc(id).set({ operationId: id, type: 'PRODUCTION_AREA', status: 'ACTIVE', name, area: name, facilityId: 'fac_uniontown', viewSequence: 60 });
  await line('ut_prod_new_half_gallon', 'NEW 1/2 GALLON');
  assert.match((await DL.runDataLoads(d, { now: tick }))[DL.HALF_READERS_ID].skipped, /test copy only/, 'nothing on the live app');
  assert.match((await DL.runDataLoads(d, { now: tick, project: 'ud-distribution-sandbox' }))[DL.HALF_READERS_ID].waiting, /not set up/, 'waits for both lines');
  await line('ut_prod_old_half_gallon', 'OLD 1/2 GALLON');
  await line('ut_prod_gallon_filler', 'GALLON FILLER');
  await d.collection('productionLines').doc('ut_prod_old_half_gallon').set({ operationId: 'ut_prod_old_half_gallon', counter: 'SENSOR', tareGrams: 38 });
  const r = (await DL.runDataLoads(d, { now: tick, project: 'ud-distribution-sandbox' }))[DL.HALF_READERS_ID];
  assert.deepEqual(r, { set: ['NEW 1/2 GALLON'], kept: ['OLD 1/2 GALLON SENSOR'] });
  assert.equal((await d.collection('productionLines').doc('ut_prod_new_half_gallon').get()).data().counter, 'READER');
  assert.deepEqual((await d.collection('productionLines').doc('ut_prod_old_half_gallon').get()).data(), { operationId: 'ut_prod_old_half_gallon', counter: 'SENSOR', tareGrams: 38 });
  assert.equal((await d.collection('productionLines').doc('ut_prod_gallon_filler').get()).exists, false, 'only the half gallon fillers');
  assert.deepEqual((await DL.runDataLoads(d, { now: tick, project: 'ud-distribution-sandbox' }))[DL.HALF_READERS_ID], { skipped: true });
});

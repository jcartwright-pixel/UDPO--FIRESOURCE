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

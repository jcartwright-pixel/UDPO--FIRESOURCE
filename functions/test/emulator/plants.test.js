'use strict';
// Joe 10/26: "All three locations have completely separate... technically, no shared information in between plants." Each plant
// keeps its things in its own database (src/plants.js); the Users list stays one list, and each other plant's database gets a
// copy of only the people given that plant.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, plantDb, clear } = require('./helpers');
const P = require('../../src/plants');
const { applyAction } = require('../../src/actions');

const UT = 'fac_uniontown', CH = 'fac_charleston', MF = 'fac_martins_ferry';
const UNA = 'una@uniteddairy.com', CARL = 'carl@uniteddairy.com', ADA = 'ada@uniteddairy.com';
const dbs = () => ({ [UT]: plantDb(UT), [CH]: plantDb(CH), [MF]: plantDb(MF) });
let n = 0;
const rid = () => 'plants-test-' + (++n);

test.beforeEach(async () => {
  await clear();
  await db().collection('users').doc(UNA).set({ status: 'ACTIVE', roles: ['MANAGER'], facilities: [UT] });
  await db().collection('users').doc(CARL).set({ status: 'ACTIVE', roles: ['MANAGER'], facilities: [CH] });
  await db().collection('users').doc(ADA).set({ status: 'ACTIVE', roles: ['ADMINISTRATOR'], facilities: [] });
});

test('each plant\'s database gets only its own people; plantAccess says who has which plant everywhere', async () => {
  await P.mirrorAll(db(), dbs());
  const ids = async (pdb, coll) => (await pdb.collection(coll).get()).docs.map(d => d.id).sort();
  assert.deepEqual(await ids(plantDb(CH), 'users'), [ADA, CARL], 'Charleston: Carl and the Administrator for every plant');
  assert.deepEqual(await ids(plantDb(MF), 'users'), [ADA], 'Martins Ferry: only the Administrator');
  assert.deepEqual(await ids(db(), 'users'), [ADA, CARL, UNA], 'the Users list itself is unchanged');
  assert.deepEqual((await plantDb(MF).collection('plantAccess').doc(CARL).get()).data(), { plants: [CH] });
  assert.deepEqual((await db().collection('plantAccess').doc(UNA).get()).data(), { plants: [UT] });
  // Carl moves to Martins Ferry: his Charleston copy goes, a Martins Ferry one comes.
  await db().collection('users').doc(CARL).set({ status: 'ACTIVE', roles: ['MANAGER'], facilities: [MF] });
  await P.mirrorAll(db(), dbs());
  assert.deepEqual(await ids(plantDb(CH), 'users'), [ADA]);
  assert.deepEqual(await ids(plantDb(MF), 'users'), [ADA, CARL]);
  // Taken off the Users list: no copies left anywhere.
  await db().collection('users').doc(CARL).delete();
  await P.mirrorAll(db(), dbs());
  assert.deepEqual(await ids(plantDb(MF), 'users'), [ADA]);
  assert.equal((await plantDb(MF).collection('plantAccess').doc(CARL).get()).exists, false);
  // A quiet run changes nothing.
  assert.equal((await P.mirrorAll(db(), dbs())).changed, false);
});

test('a call works only at a plant the caller has', async () => {
  assert.equal(await P.callPlant(db(), {}, { email: UNA }), UT, 'no plant named = Uniontown, as before');
  await assert.rejects(P.callPlant(db(), { udPlant: CH }, { email: UNA }), /not set up for Charleston/);
  assert.equal(await P.callPlant(db(), { udPlant: CH }, { email: CARL }), CH);
  assert.equal(await P.callPlant(db(), { facilityId: MF }, { email: ADA }), MF, 'a screen\'s own plant box names the plant');
  await assert.rejects(P.callPlant(db(), { udPlant: UT, facilityId: CH }, { email: ADA }), /This is Uniontown/, 'one call never mixes two plants');
  await assert.rejects(P.callPlant(db(), { udPlant: CH }, { station: { facilityId: UT } }), /signed in for Uniontown only/);
  await assert.rejects(P.callPlant(db(), { udPlant: 'fac_nowhere' }, { email: ADA }), /Pick a plant/);
});

test('a save at Charleston lands in Charleston\'s database only, checked against the one Users list', async () => {
  // Carl has no copy in Charleston's database yet (the server copies people after a deploy): his save still works.
  const at = () => new Date('2026-10-26T14:00:00Z');
  await applyAction(plantDb(CH), { email: CARL }, { action: 'saveLocationAreas', requestId: rid(), facilityId: CH, areas: [{ key: 'ch_plant', name: 'Plant', subs: [] }] }, at);
  assert.equal((await plantDb(CH).collection('locationAreas').doc(CH).get()).exists, true);
  assert.equal((await db().collection('locationAreas').doc(CH).get()).exists, false, 'nothing of Charleston\'s in Uniontown\'s database');
  assert.equal((await plantDb(MF).collection('locationAreas').get()).size, 0);
});

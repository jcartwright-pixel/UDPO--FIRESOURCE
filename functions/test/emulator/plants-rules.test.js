'use strict';
// Joe 10/26: "All three locations have completely separate... technically, no shared information in between plants." Each plant
// keeps its things in its own database, and the database rules let a person into a plant's database only when People & Roles
// gives them that plant (the server's copy in plantAccess / users there, src/plants.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, collection, getDocs } = require('firebase/firestore');
const { PROJECT } = require('./helpers');

let env;
const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
// A signed-in person's view of one plant's database ('(default)' is Uniontown's).
const opened = new Map();
function as(email, database, claims) {
  const key = email + '|' + database + '|' + JSON.stringify(claims || {});
  if (!opened.has(key)) {
    const uid = email.replace(/[^a-z]/g, '') + (claims ? 'x' : '');
    const token = Object.assign({ email, email_verified: true }, claims || {});
    const base = env.authenticatedContext(uid, token).firestore();
    if (database === '(default)') opened.set(key, base);
    else {
      // Another database of the same app, signed in the same way (the test sign-in rides on the emulator connection).
      const f = getFirestore(base.app, database);
      connectFirestoreEmulator(f, host, Number(port), { mockUserToken: Object.assign({ sub: uid, user_id: uid }, token) });
      opened.set(key, f);
    }
  }
  return opened.get(key);
}
// The server writes (firebase-admin, past the rules) into a plant's database.
const { db: homeDb } = require('./helpers');
const { getFirestore: adminDb } = require('firebase-admin/firestore');
async function seed(database, path_, data) {
  homeDb();
  await (database === '(default)' ? adminDb() : adminDb(database)).doc(path_).set(data);
}

test.before(async () => {
  env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { host, port: Number(port), rules: fs.readFileSync(path.join(__dirname, '../../../firestore.rules'), 'utf8') } });
  for (const d of ['(default)', 'charleston', 'martins-ferry']) {
    await fetch('http://' + process.env.FIRESTORE_EMULATOR_HOST + '/emulator/v1/projects/' + PROJECT + '/databases/' + d + '/documents', { method: 'DELETE' });
  }
  // The Users list (Uniontown's database): Una works at Uniontown, Carl at Charleston, Ada is an Administrator for every plant.
  await seed('(default)', 'users/una@uniteddairy.com', { status: 'ACTIVE', roles: ['MANAGER'], facilities: ['fac_uniontown'] });
  await seed('(default)', 'users/carl@uniteddairy.com', { status: 'ACTIVE', roles: ['MANAGER'], facilities: ['fac_charleston'] });
  await seed('(default)', 'users/ada@uniteddairy.com', { status: 'ACTIVE', roles: ['ADMINISTRATOR'], facilities: [] });
  await seed('(default)', 'users/old@uniteddairy.com', { status: 'ACTIVE', roles: ['MANAGER'] });
  // What the server copies (src/plants.js): plantAccess in every database, the person's entry in each other plant they have.
  for (const d of ['(default)', 'charleston', 'martins-ferry']) {
    await seed(d, 'plantAccess/una@uniteddairy.com', { plants: ['fac_uniontown'] });
    await seed(d, 'plantAccess/carl@uniteddairy.com', { plants: ['fac_charleston'] });
    await seed(d, 'plantAccess/ada@uniteddairy.com', { plants: ['fac_uniontown', 'fac_charleston', 'fac_martins_ferry'] });
  }
  await seed('charleston', 'users/carl@uniteddairy.com', { status: 'ACTIVE', roles: ['MANAGER'], facilities: ['fac_charleston'] });
  await seed('charleston', 'users/ada@uniteddairy.com', { status: 'ACTIVE', roles: ['ADMINISTRATOR'], facilities: [] });
  await seed('martins-ferry', 'users/ada@uniteddairy.com', { status: 'ACTIVE', roles: ['ADMINISTRATOR'], facilities: [] });
  await seed('(default)', 'runs/u1', { route: '801' });
  await seed('charleston', 'runs/c1', { route: '412' });
  await seed('martins-ferry', 'runs/m1', { route: '603' });
});
test.after(async () => { if (env) await env.cleanup(); });

test('a Uniontown person reads Uniontown only', async () => {
  await assertSucceeds(getDoc(doc(as('una@uniteddairy.com', '(default)'), 'runs/u1')));
  await assertSucceeds(getDocs(collection(as('una@uniteddairy.com', '(default)'), 'runs')));
  await assertFails(getDoc(doc(as('una@uniteddairy.com', 'charleston'), 'runs/c1')));
  await assertFails(getDocs(collection(as('una@uniteddairy.com', 'charleston'), 'runs')));
  await assertFails(getDocs(collection(as('una@uniteddairy.com', 'martins-ferry'), 'runs')));
});

test('a Charleston person reads Charleston only, not Uniontown', async () => {
  await assertSucceeds(getDocs(collection(as('carl@uniteddairy.com', 'charleston'), 'runs')));
  await assertFails(getDoc(doc(as('carl@uniteddairy.com', '(default)'), 'runs/u1')));
  await assertFails(getDocs(collection(as('carl@uniteddairy.com', '(default)'), 'runs')));
  await assertFails(getDocs(collection(as('carl@uniteddairy.com', 'martins-ferry'), 'runs')));
  // Their own Users entry still opens in Uniontown's database, where the one Users list is, so the app can see their plants.
  await assertSucceeds(getDoc(doc(as('carl@uniteddairy.com', '(default)'), 'users/carl@uniteddairy.com')));
});

test('an Administrator for every plant reads all three (the Home overview)', async () => {
  await assertSucceeds(getDocs(collection(as('ada@uniteddairy.com', '(default)'), 'runs')));
  await assertSucceeds(getDocs(collection(as('ada@uniteddairy.com', 'charleston'), 'runs')));
  await assertSucceeds(getDocs(collection(as('ada@uniteddairy.com', 'martins-ferry'), 'runs')));
});

test('someone the server has not copied yet keeps Uniontown, as before, and no other plant', async () => {
  await assertSucceeds(getDocs(collection(as('old@uniteddairy.com', '(default)'), 'runs')));
  await assertFails(getDocs(collection(as('old@uniteddairy.com', 'charleston'), 'runs')));
});

test("a plant tablet signed in by its code reads its own plant's database only", async () => {
  await seed('(default)', 'stationAccess/fac_uniontown', { on: true, keys: { s1: 'v1' } });
  await seed('charleston', 'stationAccess/fac_charleston', { on: true, keys: { s2: 'v2' } });
  await seed('(default)', 'plantJournal/j1', { at: 'x' });
  await seed('charleston', 'plantJournal/j2', { at: 'x' });
  const ut = (d) => as('station-s1@x', d, { udStation: 's1', udVersion: 'v1', udPlant: 'fac_uniontown', email: undefined, email_verified: undefined });
  const ch = (d) => as('station-s2@x', d, { udStation: 's2', udVersion: 'v2', udPlant: 'fac_charleston', email: undefined, email_verified: undefined });
  await assertSucceeds(getDoc(doc(ut('(default)'), 'plantJournal/j1')));
  await assertFails(getDoc(doc(ut('charleston'), 'plantJournal/j2')));
  await assertSucceeds(getDoc(doc(ch('charleston'), 'plantJournal/j2')));
  await assertFails(getDoc(doc(ch('(default)'), 'plantJournal/j1')));
});

test('the plant lists are written by the server only', async () => {
  await assertFails(setDoc(doc(as('ada@uniteddairy.com', 'charleston'), 'plantAccess/una@uniteddairy.com'), { plants: ['fac_charleston'] }));
  await assertFails(getDoc(doc(as('una@uniteddairy.com', '(default)'), 'plantAccess/carl@uniteddairy.com')));
  assert.ok(true);
});

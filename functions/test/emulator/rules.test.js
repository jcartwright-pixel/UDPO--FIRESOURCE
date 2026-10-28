'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, collection, getDocs } = require('firebase/firestore');
const { PROJECT } = require('./helpers');

let env;
test.before(async () => {
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { host, port: Number(port), rules: fs.readFileSync(path.join(__dirname, '../../../firestore.rules'), 'utf8') } });
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'runs/2026-10-04__run_t801'), { route: '801' });
    await setDoc(doc(ctx.firestore(), 'users/joe@uniteddairy.com'), { status: 'ACTIVE', roles: ['ADMINISTRATOR'] });
    await setDoc(doc(ctx.firestore(), 'users/other@uniteddairy.com'), { status: 'ACTIVE', roles: ['MANAGER'] });
    await setDoc(doc(ctx.firestore(), 'users/gone@uniteddairy.com'), { status: 'INACTIVE', roles: ['MANAGER'] });
    await setDoc(doc(ctx.firestore(), 'actions/x'), { by: 'joe@uniteddairy.com' });
    await setDoc(doc(ctx.firestore(), 'conflicts/c1'), { open: true, at: '2026-10-09T12:00:00.000Z' });
    await setDoc(doc(ctx.firestore(), 'outbox/o1'), { status: 'pending' });
    await setDoc(doc(ctx.firestore(), 'personRights/joe@uniteddairy.com'), { screenAccess: { fac_uniontown: ['daily'] } });
    await setDoc(doc(ctx.firestore(), 'personRights/other@uniteddairy.com'), { screenAccess: null });
  });
});
test.after(async () => { if (env) await env.cleanup(); });

const ud = () => env.authenticatedContext('joe', { email: 'joe@uniteddairy.com', email_verified: true }).firestore();

test('a signed-in United Dairy account can read the dispatch data', async () => {
  await assertSucceeds(getDoc(doc(ud(), 'runs/2026-10-04__run_t801')));
  await assertSucceeds(getDocs(collection(ud(), 'runs')));
  await assertSucceeds(getDocs(collection(ud(), 'driverPhones')));
  await assertSucceeds(getDocs(collection(ud(), 'driverBackups')));
  await assertSucceeds(getDoc(doc(ud(), 'users/joe@uniteddairy.com')));
});

test('nobody else can read it', async () => {
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'runs/2026-10-04__run_t801')));
  await assertFails(getDoc(doc(env.authenticatedContext('g', { email: 'joe@gmail.com', email_verified: true }).firestore(), 'runs/2026-10-04__run_t801')));
  await assertFails(getDoc(doc(env.authenticatedContext('u', { email: 'joe@uniteddairy.com', email_verified: false }).firestore(), 'runs/2026-10-04__run_t801')));
  await assertFails(getDoc(doc(env.authenticatedContext('e', { email: 'joe@uniteddairy.com.evil.com', email_verified: true }).firestore(), 'runs/2026-10-04__run_t801')));
});

test('screens cannot write anything directly, and see only their own user entry and no save log', async () => {
  await assertFails(setDoc(doc(ud(), 'runs/2026-10-04__run_t801'), { route: 'X' }));
  await assertFails(setDoc(doc(ud(), 'users/joe@uniteddairy.com'), { roles: ['ADMINISTRATOR'] }));
  await assertFails(getDoc(doc(ud(), 'users/other@uniteddairy.com')));
  await assertFails(getDoc(doc(ud(), 'actions/x')));
});

test('the sheet conflict list is readable by United Dairy accounts only, and the write-back queue by nobody', async () => {
  await assertSucceeds(getDoc(doc(ud(), 'conflicts/c1')));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'conflicts/c1')));
  await assertFails(setDoc(doc(ud(), 'conflicts/c1'), { open: false }));
  await assertFails(getDoc(doc(ud(), 'outbox/o1')));
});

test('a United Dairy account that is not ACTIVE in the Users list sees no dispatch data, only its own entry', async () => {
  const gone = env.authenticatedContext('gone', { email: 'gone@uniteddairy.com', email_verified: true }).firestore();
  await assertFails(getDoc(doc(gone, 'runs/2026-10-04__run_t801')));
  await assertSucceeds(getDoc(doc(gone, 'users/gone@uniteddairy.com')));
  const stranger = env.authenticatedContext('new', { email: 'new.hire@uniteddairy.com', email_verified: true }).firestore();
  await assertFails(getDocs(collection(stranger, 'drivers')));
  // Joe 10/15: drivers' mobile phones and the Schedule Texts log.
  await assertFails(getDocs(collection(stranger, 'driverPhones')));
  await assertFails(getDocs(collection(stranger, 'driverBackups')));
  await assertFails(getDocs(collection(stranger, 'textLog')));
  await assertFails(getDoc(doc(stranger, 'conflicts/c1')));
});

// Joe 10/12: a Plant Station signed in by its code alone (index.js stationSignIn) reads only the plant-floor lists, and only
// while its plant's switch is On and its code is current (stationAccess, kept by the server).
test('a no-account Plant Station reads only the plant-floor lists, while On and on its current code', async () => {
  const station = (version) => env.authenticatedContext('station-case', { udStation: 'case', udVersion: version, udPlant: 'fac_uniontown', udName: 'Case Loadout' }).firestore();
  const setAccess = (data) => env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'stationAccess/fac_uniontown'), data));
  await assertFails(getDoc(doc(station('v1'), 'runs/2026-10-04__run_t801')), 'no stationAccess yet');
  await setAccess({ on: true, keys: { case: 'v1' } });
  await assertSucceeds(getDoc(doc(station('v1'), 'runs/2026-10-04__run_t801')));
  await assertSucceeds(getDocs(collection(station('v1'), 'pickups')));
  await assertSucceeds(getDoc(doc(station('v1'), 'config/app')));
  // Joe 10/27 (gy): Route Master too, read only (Case Unloading shows drop-and-hook loads by name).
  await assertSucceeds(getDocs(collection(station('v1'), 'routes')));
  await assertFails(setDoc(doc(station('v1'), 'routes/x'), { route: '1' }));
  // Never a person's entry, the dispatch weeks, drivers or anything else.
  await assertFails(getDoc(doc(station('v1'), 'users/joe@uniteddairy.com')));
  await assertFails(getDocs(collection(station('v1'), 'weeks')));
  await assertFails(getDocs(collection(station('v1'), 'drivers')));
  await assertFails(getDocs(collection(station('v1'), 'driverPhones')));
  await assertFails(getDocs(collection(station('v1'), 'driverBackups')));
  await assertFails(getDoc(doc(station('v1'), 'stationAccess/fac_uniontown')));
  await assertFails(setDoc(doc(station('v1'), 'runs/x'), { route: '1' }));
  // An old code's token, or the switch Off, is refused.
  await assertFails(getDoc(doc(station('v0'), 'runs/2026-10-04__run_t801')));
  await setAccess({ on: false, keys: { case: 'v1' } });
  await assertFails(getDoc(doc(station('v1'), 'runs/2026-10-04__run_t801')));
});

// Joe 10/16 (Fire Stick): the Driver's Kiosk Station TV signed in by its code (index.js stationSignIn {tv: true}) reads only the
// board's lists, and only while its station keeps the same code (stationAccess/tv, kept by the server).
test('a Driver\'s Kiosk Station TV signed in by its code reads only the board, while its code stays the same', async () => {
  const tv = (version) => env.authenticatedContext('tv-ds', { udTv: 'ds', udTvVersion: version, udPlant: 'fac_uniontown', udName: "Driver's Kiosk Station" }).firestore();
  const setAccess = (data) => env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'stationAccess/tv'), data));
  await assertFails(getDoc(doc(tv('v1'), 'runs/2026-10-04__run_t801')), 'no stationAccess yet');
  await setAccess({ keys: { ds: 'v1' } });
  await assertSucceeds(getDoc(doc(tv('v1'), 'runs/2026-10-04__run_t801')));
  await assertSucceeds(getDocs(collection(tv('v1'), 'pickups')));
  await assertSucceeds(getDocs(collection(tv('v1'), 'drivers')));
  await assertSucceeds(getDoc(doc(tv('v1'), 'config/app')));
  // Never a person's entry, phone numbers, dispatch weeks, plant lists or anything else; never a write.
  await assertFails(getDoc(doc(tv('v1'), 'users/joe@uniteddairy.com')));
  await assertFails(getDocs(collection(tv('v1'), 'driverPhones')));
  await assertFails(getDocs(collection(tv('v1'), 'weeks')));
  await assertFails(getDocs(collection(tv('v1'), 'equipment')));
  await assertFails(getDoc(doc(tv('v1'), 'stationAccess/tv')));
  // Joe 10/27: the TV's Driver Scorecard turn: only the overall scores the server keeps (scorecard/kiosk), never the
  // scorecard's settings or the lists it is built from.
  await assertSucceeds(getDoc(doc(tv('v1'), 'scorecard/kiosk')));
  await assertFails(getDoc(doc(tv('v1'), 'scorecard/settings')));
  await assertFails(getDocs(collection(tv('v1'), 'gpsAlerts')));
  await assertFails(getDocs(collection(tv('v1'), 'driverIncidents')));
  await assertFails(setDoc(doc(tv('v1'), 'runs/x'), { route: '1' }));
  // A new code on the station (or Remove) shuts the old sign-in out.
  await setAccess({ keys: { ds: 'v2' } });
  await assertFails(getDoc(doc(tv('v1'), 'runs/2026-10-04__run_t801')));
});

// Joe 10/14: each person reads their own ticked screens (People & Roles) so their Home and menu show only those; nobody else's.
test('a person reads only their own ticked screens', async () => {
  await assertSucceeds(getDoc(doc(ud(), 'personRights/joe@uniteddairy.com')));
  await assertFails(getDoc(doc(ud(), 'personRights/other@uniteddairy.com')));
  await assertFails(getDocs(collection(ud(), 'personRights')));
  await assertFails(setDoc(doc(ud(), 'personRights/joe@uniteddairy.com'), { screenAccess: null }));
});

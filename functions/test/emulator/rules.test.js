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
  });
});
test.after(async () => { if (env) await env.cleanup(); });

const ud = () => env.authenticatedContext('joe', { email: 'joe@uniteddairy.com', email_verified: true }).firestore();

test('a signed-in United Dairy account can read the dispatch data', async () => {
  await assertSucceeds(getDoc(doc(ud(), 'runs/2026-10-04__run_t801')));
  await assertSucceeds(getDocs(collection(ud(), 'runs')));
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
  await assertFails(getDoc(doc(stranger, 'conflicts/c1')));
});

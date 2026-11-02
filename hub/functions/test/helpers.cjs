'use strict';
/*
 * Test helpers: the local Firestore emulator (db, clear) and the hub call answered in this process, as index.js answers
 * it, with the signed-in person from the auth emulator's token (so the browser tests need no functions emulator).
 */
const admin = require('firebase-admin');
const PROJECT = 'demo-ud-distribution';

function db() {
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  return admin.firestore();
}
async function clear() {
  const res = await fetch('http://' + process.env.FIRESTORE_EMULATOR_HOST + '/emulator/v1/projects/' + PROJECT + '/databases/(default)/documents', { method: 'DELETE' });
  if (!res.ok) throw new Error('could not clear the emulator: ' + res.status);
}
const CODES = { NOT_ALLOWED: 'PERMISSION_DENIED', BAD_REQUEST: 'INVALID_ARGUMENT', NOT_FOUND: 'NOT_FOUND', CHANGED: 'ABORTED' };
async function localCalls(ctx) {
  const { unitedDairyUser } = require('../src/auth');
  const C = require('../src/hub');
  await ctx.route(/:5001\/[^/]+\/[^/]+\/hub$/, async (route) => {
    const req = route.request(), data = (req.postDataJSON() || {}).data || {};
    let token = null;
    try { token = JSON.parse(Buffer.from(String(req.headers().authorization || '').split(' ')[1].split('.')[1], 'base64url').toString()); } catch (e) { /* no sign-in */ }
    const fail = (status, message) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ error: { status, message } }) });
    const user = unitedDairyUser(token && { uid: token.user_id, token });
    if (!user) return fail('PERMISSION_DENIED', 'Sign in with your United Dairy Google account');
    try {
      const result = await C.hubCall(db(), user, data);
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ result }) });
    } catch (e) {
      if (e instanceof C.HubError) return fail(CODES[e.code] || 'FAILED_PRECONDITION', e.message);
      return fail('INTERNAL', 'internal');
    }
  });
}

/*
 * Operations' own admin call (people, savePerson) stands in here as a small copy with the same answers, so the hub's browser
 * tests need no Operations server. Operations' tests cover the real one.
 */
const ROLES = ['VIEWER', 'EMPLOYEE', 'DRIVER', 'DRIVER_CHECKIN', 'PLANT_EMPLOYEE', 'MECHANIC', 'DISPATCHER', 'SUPERVISOR', 'MANAGER', 'ADMINISTRATOR'];
const PLANTS = [{ id: 'fac_uniontown', name: 'Uniontown', status: 'ACTIVE' }, { id: 'fac_charleston', name: 'Charleston', status: 'PLANNED' }, { id: 'fac_martins_ferry', name: 'Martins Ferry', status: 'PLANNED' }];
const rev = (p) => p ? String(p.updatedAt || 'first') : 'new';
async function fakeAdmin(email, data) {
  const users = db().collection('users'), me = (await users.doc(email).get()).data();
  if (!me || me.status !== 'ACTIVE' || !(me.roles || []).some(r => String(r).toUpperCase() === 'ADMINISTRATOR')) throw Object.assign(new Error('Only an administrator can use Administration'), { status: 'PERMISSION_DENIED' });
  if (data.op === 'people') {
    const snap = await users.get();
    return { people: snap.docs.map(d => Object.assign({ email: d.id, grants: [], denials: [], revision: rev(d.data()), primary: d.id === 'pat.admin@uniteddairy.com' }, d.data())), roles: ROLES, plants: PLANTS, newRevision: 'new' };
  }
  if (data.op === 'savePerson') {
    const ref = users.doc(data.email), before = (await ref.get()).data();
    if (!data.isNew && rev(before) !== data.revision) throw Object.assign(new Error('Someone changed this person since you opened them. Reload this person before saving.'), { status: 'ABORTED' });
    await ref.set({ name: data.name, status: data.status, roles: data.roles, facilities: data.facilities, updatedAt: new Date().toISOString(), updatedBy: email }, { merge: true });
    return { ok: true, message: 'Person access saved.', email: data.email };
  }
  throw Object.assign(new Error('Unknown request.'), { status: 'INVALID_ARGUMENT' });
}
async function localAdmin(ctx) {
  await ctx.route(/:5001\/[^/]+\/[^/]+\/admin$/, async (route) => {
    const req = route.request(), data = (req.postDataJSON() || {}).data || {};
    let token = null;
    try { token = JSON.parse(Buffer.from(String(req.headers().authorization || '').split(' ')[1].split('.')[1], 'base64url').toString()); } catch (e) { /* no sign-in */ }
    try { await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ result: await fakeAdmin(token && token.email, data) }) }); }
    catch (e) { await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ error: { status: e.status || 'INTERNAL', message: e.message } }) }); }
  });
}
module.exports = { PROJECT, db, clear, localCalls, localAdmin };

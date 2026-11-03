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
 * Operations' own admin call (people, savePerson, setHomeScreen) stands in here as a small copy with the same answers, so the hub's browser
 * tests need no Operations server. Operations' tests cover the real one.
 */
// The screens, jobs, rights and role defaults are Operations' own (functions/src/logic.js, rights.js), so the hub is tested
// against the real lists.
const L = require('../../../functions/src/logic');
const R = require('../../../functions/src/rights');
const ROLES = R.ROLES.slice();
const PLANTS = [{ id: 'fac_uniontown', name: 'Uniontown', status: 'ACTIVE' }, { id: 'fac_charleston', name: 'Charleston', status: 'PLANNED' }, { id: 'fac_martins_ferry', name: 'Martins Ferry', status: 'PLANNED' }];
const rev = (p) => p ? String(p.updatedAt || 'first') : 'new';
async function fakeAdmin(email, data) {
  const users = db().collection('users'), me = (await users.doc(email).get()).data();
  if (!me || me.status !== 'ACTIVE' || !(me.roles || []).some(r => String(r).toUpperCase() === 'ADMINISTRATOR')) throw Object.assign(new Error('Only an administrator can use Administration'), { status: 'PERMISSION_DENIED' });
  if (data.op === 'people') {
    const snap = await users.get();
    return { people: snap.docs.map(d => Object.assign({ email: d.id, grants: [], denials: [], screenAccess: null, homeScreen: '', revision: rev(d.data()), primary: d.id === 'pat.admin@uniteddairy.com' }, d.data())),
      roles: ROLES, plants: PLANTS, newRevision: 'new', catalog: R.CATALOG, screenAreas: L.SCREEN_AREAS, screenJobs: L.SCREEN_JOBS, defaults: R.DEFAULTS, templates: {} };
  }
  if (data.op === 'savePerson') {
    const ref = users.doc(data.email), before = (await ref.get()).data();
    if (!data.isNew && rev(before) !== data.revision) throw Object.assign(new Error('Someone changed this person since you opened them. Reload this person before saving.'), { status: 'ABORTED' });
    const keep = data.screenAccess === undefined ? (before && before.screenAccess) || null : data.screenAccess;
    await ref.set({ name: data.name, status: data.status, roles: data.roles, facilities: data.facilities, grants: data.grants || [], denials: data.denials || [], screenAccess: keep, updatedAt: new Date().toISOString(), updatedBy: email }, { merge: true });
    return { ok: true, message: 'Person access saved.', email: data.email };
  }
  if (data.op === 'setHomeScreen') {
    const ref = users.doc(data.email), p = (await ref.get()).data();
    if (data.page && !L.homeChoices(p, p.screenAccess || null).some(c => c.page === data.page)) throw Object.assign(new Error('That screen is not one this person can see.'), { status: 'INVALID_ARGUMENT' });
    await ref.set({ homeScreen: data.page, updatedAt: new Date().toISOString() }, { merge: true });
    return { ok: true, email: data.email, homeScreen: data.page };
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

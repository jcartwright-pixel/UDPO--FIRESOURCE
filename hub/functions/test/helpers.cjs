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
 * Operations' own admin call (people, savePerson, setHomeScreen, roleTemplates, saveRoleTemplate, addRole; the Links & Codes calls are the real ones) stands in here as a small copy with the same answers, so the hub's browser
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
  // Role Templates, kept as Operations keeps them (private/roleTemplates: templates, customRoles), with its CHANGED check.
  const tplRef = db().collection('private').doc('roleTemplates');
  const tplOf = async () => { const d = (await tplRef.get()).data() || {}; return { templates: d.templates || {}, customRoles: d.customRoles || [] }; };
  if (data.op === 'roleTemplates') {
    const t = await tplOf();
    return { catalog: R.CATALOG, roles: ROLES.concat(t.customRoles), defaults: R.DEFAULTS, templates: t.templates, meta: {} };
  }
  if (data.op === 'saveRoleTemplate') {
    const t = await tplOf(), role = R.normRole(data.role);
    if (role === 'ADMINISTRATOR') throw Object.assign(new Error('Administrator has protected full access.'), { status: 'PERMISSION_DENIED' });
    if (JSON.stringify((data.expected || []).slice().sort()) !== JSON.stringify(R.templateFor(role, t.templates).slice().sort())) throw Object.assign(new Error('Someone changed this role since you opened it. Reload before saving.'), { status: 'ABORTED' });
    const ordered = R.CATALOG.map(c => c.code).filter(c => (data.rights || []).indexOf(c) >= 0);
    if (JSON.stringify(ordered) === JSON.stringify(R.CATALOG.map(c => c.code).filter(c => (R.DEFAULTS[role] || []).indexOf(c) >= 0))) delete t.templates[role];
    else t.templates[role] = ordered;
    await tplRef.set(t);
    return { ok: true, message: 'Role template saved.' };
  }
  if (data.op === 'addRole') {
    const t = await tplOf(), role = R.normRole(data.name).replace(/[^A-Z0-9_]/g, '');
    if (ROLES.concat(t.customRoles).indexOf(role) >= 0) throw Object.assign(new Error('That is already a role.'), { status: 'ABORTED' });
    t.customRoles.push(role);
    t.templates[role] = R.CATALOG.map(c => c.code).filter(c => (data.rights || []).indexOf(c) >= 0);
    await tplRef.set(t);
    return { ok: true, role, message: data.name + ' added. Give it to people in People & Roles.' };
  }
  // Links & Codes: Operations' real calls (functions/src/admin.js OPS) on the emulator, so the hub is tested against them.
  if (LINK_OPS.indexOf(data.op) >= 0 || EMAIL_OPS.indexOf(data.op) >= 0 || ACCOUNTING_OPS.indexOf(data.op) >= 0) {
    const fn = opsAdmin().OPS[data.op] || opsModule('admintools').OPS[data.op] || opsModule('accounting').OPS[data.op];
    try { return await fn(db(), email, data, new Date().toISOString(), { env: {}, mailDeps: { env: {} }, readMail: async () => { throw new Error('Gmail is not reached in the hub tests'); } }); }
    catch (e) { throw Object.assign(new Error(e.message), { status: CODES[e.code] || 'INTERNAL' }); }
  }
  throw Object.assign(new Error('Unknown request.'), { status: 'INVALID_ARGUMENT' });
}
// Email & Texts: Operations' real email settings calls. Sending is Off on the emulator, so nothing is ever emailed.
const EMAIL_OPS = ['sentLog', 'setSending', 'setForecastEmail', 'reportGroups', 'saveReportGroup', 'salesEmail', 'saveSalesEmail', 'emailSenders', 'saveEmailSenders', 'repairEmail', 'saveRepairEmail', 'checkinEmail', 'saveCheckinEmail'];
// Accounting Numbers: Operations' real calls. Nothing reaches Gmail: the mailbox check answers that it could not be read.
const ACCOUNTING_OPS = ['accountingStatus', 'accountingSaveSettings', 'accountingUpload', 'accountingCheckNow'];
const LINK_OPS = ['appLinks', 'routeCodeNew', 'routeCodeOnOff', 'releaseCodes', 'releaseCodeNew', 'stations', 'stationAdd', 'stationCode', 'stationRemove', 'noAccountSet'];
// Operations' functions/node_modules may not be installed (the hub's own tests install only hub/functions), so its packages
// are found in the hub's node_modules when they are not there.
let ops = null;
function opsAdmin() {
  if (ops) return ops;
  const Module = require('module');
  process.env.NODE_PATH = [require('path').join(__dirname, '..', 'node_modules'), process.env.NODE_PATH].filter(Boolean).join(require('path').delimiter);
  Module._initPaths();
  ops = require('../../../functions/src/admin');
  return ops;
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
/*
 * Keys & Connections: Operations' real gps, redzone, mocreo and sms calls on the emulator. Nothing reaches the outside: every
 * outside request fails here, so a test shows the plain "could not reach" answer.
 */
const KEY_CALLS = {
  gps: () => opsModule('gps').gpsCall, redzone: () => opsModule('redzone').redzoneCall, mocreo: () => opsModule('mocreo').mocreoCall, sms: () => opsModule('sms').smsCall
};
function opsModule(name) { opsAdmin(); return require('../../../functions/src/' + name); }
const offline = { fetch: async () => { throw new Error('no outside network in the hub tests'); }, env: {}, project: 'demo-ud-distribution' };
async function localKeys(ctx) {
  await ctx.route(/:5001\/[^/]+\/[^/]+\/(gps|redzone|mocreo|sms)$/, async (route) => {
    const req = route.request(), data = (req.postDataJSON() || {}).data || {}, name = req.url().split('/').pop();
    let token = null;
    try { token = JSON.parse(Buffer.from(String(req.headers().authorization || '').split(' ')[1].split('.')[1], 'base64url').toString()); } catch (e) { /* no sign-in */ }
    try { await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ result: await KEY_CALLS[name]()(db(), { email: token && token.email }, data, offline) }) }); }
    catch (e) { await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ error: { status: CODES[e.code] || 'INTERNAL', message: e.message } }) }); }
  });
}
module.exports = { PROJECT, db, clear, localCalls, localAdmin, localKeys };

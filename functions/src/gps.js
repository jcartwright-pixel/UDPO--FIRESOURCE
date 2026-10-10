/*
 * GPS Setup (Joe, 10/9): the Verizon Connect (Fleetmatics) API login and a Test connection button, the same steps as the
 * current app's Trucks Today > Setup (231_V7279_GpsServer.gs): GET <address>/token with the API user and password
 * (Basic), then, when a truck's vehicle number is given, GET /rad/v1/vehicles/<number>/location with the App ID, which
 * proves the App ID too.
 *
 * The login is kept in private/gps, which no screen can read (firestore.rules). Only a manager or administrator may save, remove or
 * test it; the screen only ever learns which parts are saved, never the values. Results are in plain words.
 */
'use strict';

const L = require('./logic');
const { COLLECTIONS: C, safeIdPart } = require('./model');

const DEFAULT_BASE = 'https://fim.api.us.fleetmatics.com';
const ROLES = ['ADMINISTRATOR', 'ADMIN', 'MANAGER'];

class GpsError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function checkBase(url, local) {
  const s = String(url || '').trim().replace(/\/+$/, '');
  if (!s) return DEFAULT_BASE;
  // Only Fleetmatics itself (a test on this computer may use a local stand-in).
  if (/^https:\/\/[a-z0-9.-]+\.fleetmatics\.com$/i.test(s)) return s;
  if (local && /^http:\/\/127\.0\.0\.1:\d+$/.test(s)) return s;
  throw new GpsError('BAD_REQUEST', 'The Fleetmatics address must look like ' + DEFAULT_BASE);
}

async function adminOnly(db, user) {
  const email = String(user && user.email || '').toLowerCase();
  const snap = await db.collection(C.users).doc(safeIdPart(email)).get();
  const person = snap.exists ? snap.data() : null;
  if (!person || person.status !== 'ACTIVE' || !L.hasRole(person, ROLES)) throw new GpsError('NOT_ALLOWED', 'Only a manager or administrator can set up or test the GPS login');
  return email;
}

const status = (d) => ({ hasUser: !!d.user, hasPassword: !!d.password, hasAppId: !!d.appId, baseUrl: d.baseUrl || DEFAULT_BASE,
  lastTest: d.lastTest || null, savedAt: d.savedAt || '', savedBy: d.savedBy || '' });

async function test(d, vehicle, fetchFn) {
  if (!d.user || !d.password || !d.appId) return { ok: false, step: 'login', message: 'Not tested: save the API user name, password and App ID first.' };
  let res;
  try {
    res = await fetchFn(d.baseUrl + '/token', { headers: { Authorization: 'Basic ' + Buffer.from(d.user + ':' + d.password).toString('base64') } });
  } catch (e) {
    return { ok: false, step: 'login', message: 'Could not reach Fleetmatics at ' + d.baseUrl + '. Check the address.' };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, step: 'login', message: 'Fleetmatics refused the login (' + res.status + '). Check the API user name and password.' };
  // 400 is what Fleetmatics gives a login that is not an API (REST) user, such as the everyday Reveal login.
  if (res.status === 400) return { ok: false, step: 'login', message: 'Fleetmatics did not accept this as an API login (400). The everyday Reveal login does not work here: Verizon Connect must create an API (REST) user and give its user name, password and App ID.' };
  if (res.status >= 300) return { ok: false, step: 'login', message: 'Fleetmatics answered ' + res.status + ' to the login. Try again in a minute; if it stays, call Verizon Connect.' };
  const token = String(await res.text() || '').trim().replace(/^"|"$/g, '');
  if (!token) return { ok: false, step: 'login', message: 'Fleetmatics accepted the login but sent no key back.' };
  const v = String(vehicle || '').trim();
  if (!v) return { ok: true, step: 'login', message: 'Login works. Type one truck\'s vehicle number and test again to check the App ID too.' };
  let res2;
  try {
    res2 = await fetchFn(d.baseUrl + '/rad/v1/vehicles/' + encodeURIComponent(v) + '/location', {
      headers: { Authorization: 'Atmosphere atmosphere_app_id=' + d.appId + ', Bearer ' + token, Accept: 'application/json' } });
  } catch (e) {
    return { ok: false, step: 'vehicle', message: 'Login works, but Fleetmatics did not answer the truck question.' };
  }
  if (res2.status === 401 || res2.status === 403) return { ok: false, step: 'vehicle', message: 'Login works, but Fleetmatics refused the App ID (' + res2.status + '). Check the App ID.' };
  if (res2.status === 404) return { ok: false, step: 'vehicle', message: 'Login and App ID work, but Fleetmatics does not know vehicle ' + v + '. Use the vehicle number exactly as Reveal shows it.' };
  if (res2.status >= 300) return { ok: false, step: 'vehicle', message: 'Login works; Fleetmatics answered ' + res2.status + ' for vehicle ' + v + '.' };
  return { ok: true, step: 'vehicle', message: 'Connected. Login and App ID work, and Fleetmatics answered for vehicle ' + v + '.' };
}

/* input.op: status | save {user, password, appId, baseUrl} | clear | test {vehicle} */
async function gpsCall(db, user, input, options) {
  input = input || {};
  const o = Object.assign({ fetch: (...a) => fetch(...a), now: () => new Date(), local: false }, options || {});
  const email = await adminOnly(db, user);
  const ref = db.collection('private').doc('gps');
  const d = (await ref.get()).data() || {};
  const op = String(input.op || 'status');
  if (op === 'status') return status(d);
  if (op === 'save') {
    const next = Object.assign({}, d);
    if (String(input.user || '').trim()) next.user = String(input.user).trim().slice(0, 200);
    if (String(input.password || '')) next.password = String(input.password).slice(0, 200);
    if (String(input.appId || '').trim()) next.appId = String(input.appId).trim().slice(0, 300);
    if (Object.prototype.hasOwnProperty.call(input, 'baseUrl')) next.baseUrl = checkBase(input.baseUrl, o.local);
    next.baseUrl = next.baseUrl || DEFAULT_BASE;
    next.savedAt = o.now().toISOString(); next.savedBy = email; next.lastTest = null;
    await ref.set(next);
    return status(next);
  }
  if (op === 'clear') {
    const next = { baseUrl: d.baseUrl || DEFAULT_BASE, savedAt: o.now().toISOString(), savedBy: email, lastTest: null };
    await ref.set(next);
    return status(next);
  }
  if (op === 'test') {
    const result = await test(Object.assign({ baseUrl: DEFAULT_BASE }, d), input.vehicle, o.fetch);
    const lastTest = Object.assign({ at: o.now().toISOString(), by: email }, result);
    await ref.set({ lastTest }, { merge: true });
    return Object.assign(status(Object.assign({}, d, { lastTest })), { result });
  }
  throw new GpsError('BAD_REQUEST', 'Unknown GPS step ' + op.slice(0, 30));
}

module.exports = { gpsCall, GpsError, DEFAULT_BASE };

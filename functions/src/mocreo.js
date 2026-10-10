/*
 * MOCREO cooler sensors, read only (Joe 10/10). The same steps as the current app (026_V731_MocreoService.gs and
 * 040_V740_MocreoNormalizationAssignment.gs): GET https://api.mocreo.com/v1/assets/<asset>/devices with the X-API-Key
 * header, a device's own page when the list has no temperature, and the temperature in hundredths of a degree Celsius.
 *
 * Joe 10/10: an administrator pastes the API key and asset ID in Administration > MOCREO & Sensors (mocreo.html, through
 * mocreoCall below). They are kept in private/mocreo, which no screen can read (firestore.rules); the screen only learns the
 * key's last 4 characters, who saved it and when. The key is never logged and never sent back. The sync starts once a key is
 * saved and Test Connection passes; until then Cooler Temperatures stays manual. (The Secret Manager secrets MOCREO_API_KEY
 * and MOCREO_ASSET_ID are read instead when nothing is saved in the app.)
 *
 * Each sensor goes in sensors/<sensorId> (temperature in °F, battery, online, last reading); config/mocreo holds the last
 * try, the last success and the last error in plain words. Nothing is written to MOCREO or to any sheet.
 */
'use strict';

const { safeIdPart } = require('./model');

const BASE = 'https://api.mocreo.com/v1';
const SECRETS = { key: 'MOCREO_API_KEY', asset: 'MOCREO_ASSET_ID' };

const flat = (k) => String(k).replace(/[_\-\s]/g, '').toLowerCase();
// The first plain value under one of the names, anywhere in the object (sensor models name their fields differently).
function findField(obj, names) {
  const want = names.map(flat), queue = [obj];
  for (let seen = 0; queue.length && seen < 500; seen++) {
    const cur = queue.shift();
    if (!cur || typeof cur !== 'object') continue;
    for (const [k, v] of Object.entries(cur)) if (want.includes(flat(k)) && ['string', 'number', 'boolean'].includes(typeof v)) return v;
    Object.values(cur).forEach(v => { if (v && typeof v === 'object') queue.push(v); });
  }
  return undefined;
}
// A measurement may be a plain value or an object holding it ({value: 345}).
function measurement(obj, names) {
  const want = names.map(flat), queue = [obj];
  for (let seen = 0; queue.length && seen < 500; seen++) {
    const cur = queue.shift();
    if (!cur || typeof cur !== 'object') continue;
    for (const [k, v] of Object.entries(cur)) {
      if (!want.includes(flat(k))) continue;
      if (['string', 'number', 'boolean'].includes(typeof v)) return v;
      if (v && typeof v === 'object') { const n = findField(v, ['value', 'current', 'reading', 'level', 'percent', 'percentage']); if (n !== undefined) return n; }
    }
    Object.values(cur).forEach(v => { if (v && typeof v === 'object') queue.push(v); });
  }
  return undefined;
}
function number(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[^\d.-]/g, ''));
  return isFinite(n) ? n : null;
}
function bool(v) {
  if (v === true || v === false) return v;
  const s = String(v == null ? '' : v).trim().toUpperCase();
  if (['TRUE', 'ONLINE', 'CONNECTED', '1', 'YES', 'OK'].includes(s)) return true;
  if (['FALSE', 'OFFLINE', 'DISCONNECTED', '0', 'NO'].includes(s)) return false;
  return null;
}
function isoTime(v) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number' || /^\d{10,13}$/.test(String(v))) { let n = Number(v); if (n < 100000000000) n *= 1000; const d = new Date(n); return isNaN(d) ? '' : d.toISOString(); }
  const d = new Date(v);
  return isNaN(d) ? String(v) : d.toISOString();
}
// MOCREO sends hundredths of a degree Celsius (345 = 3.45 °C = 38.2 °F).
function fahrenheit(raw) {
  const n = number(raw);
  return n === null ? null : Math.round(((n / 100) * 9 / 5 + 32) * 10) / 10;
}
function normalize(item, details) {
  const both = { list: item || {}, details: details || {} };
  const id = String(findField(both, ['id', 'deviceId', 'device_id', 'sn', 'serialNumber', 'serial']) || '').trim();
  return {
    sensorId: id,
    name: String(findField(both, ['displayName', 'deviceName', 'name', 'alias']) || id).trim(),
    temperatureF: fahrenheit(measurement(both, ['temperature', 'currentTemperature', 'temp'])),
    batteryLevel: number(measurement(both, ['batteryLevel', 'battery', 'batteryPercent', 'batteryPercentage'])),
    online: bool(findField(both, ['online', 'isOnline', 'found', 'connected'])),
    lastReadingAt: isoTime(findField(both, ['lastReadingAt', 'lastReportAt', 'lastSeenAt', 'updatedAt', 'timestamp', 'time'])),
    model: String(findField(both, ['model', 'deviceModel', 'productModel']) || ''),
    error: ''
  };
}

async function request(fetchFn, key, path) {
  const res = await fetchFn(BASE + path, { headers: { 'X-API-Key': key, Accept: 'application/json' } });
  const text = await res.text();
  // The answer is never shown whole: it could echo the request.
  if (!res.ok) throw new Error('MOCREO answered ' + res.status + ' for ' + path.replace(/\/assets\/[^/]+/, '/assets/…'));
  let json;
  try { json = JSON.parse(text); } catch (e) { throw new Error('MOCREO sent something that is not JSON'); }
  if (json && json.success === false) throw new Error('MOCREO said the request failed');
  return json && json.result !== undefined ? json.result : json;
}

async function fetchDevices(fetchFn, key, asset) {
  const at = '/assets/' + encodeURIComponent(asset) + '/devices';
  const list = await request(fetchFn, key, at);
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    const id = String(findField(item, ['id', 'deviceId', 'device_id', 'sn', 'serialNumber', 'serial']) || '').trim();
    if (!id) continue;
    let details = {}, error = '';
    if (measurement(item, ['temperature', 'currentTemperature', 'temp']) === undefined) {
      try { details = await request(fetchFn, key, at + '/' + encodeURIComponent(id)); } catch (e) { error = e.message; }
    }
    const d = normalize(item, details);
    d.error = error;
    out.push(d);
  }
  return out;
}

// The two secrets from Secret Manager; null when either is not there yet.
async function readSecrets({ project, token, fetchFn }) {
  const out = {};
  for (const [k, name] of Object.entries(SECRETS)) {
    const res = await fetchFn('https://secretmanager.googleapis.com/v1/projects/' + project + '/secrets/' + name + '/versions/latest:access', { headers: { Authorization: 'Bearer ' + token } });
    if (res.status === 404) return { missing: name };
    if (res.status === 403) return { denied: name };
    if (!res.ok) throw new Error('Secret Manager answered ' + res.status + ' for ' + name);
    const body = await res.json();
    out[k] = Buffer.from(body.payload && body.payload.data || '', 'base64').toString('utf8').trim();
    if (!out[k]) return { missing: name };
  }
  return out;
}

/*
 * One sync. getSecrets() gives {key, asset}, {missing}, or {denied}. Writes sensors/* and config/mocreo; a sensor MOCREO
 * stops sending is kept, marked not returned.
 */
async function runMocreoSync({ db, getSecrets, fetchFn, now = () => new Date() }) {
  const at = now().toISOString(), statusRef = db.collection('config').doc('mocreo');
  let s;
  try { s = await getSecrets(); } catch (e) { await statusRef.set({ configured: false, lastAttempt: at, lastError: 'Could not read the MOCREO settings: ' + e.message }, { merge: true }); return { ok: false }; }
  if (s.missing || s.denied || s.untested) {
    // Secret Manager is only a fallback (Joe pastes the key in Administration), so a secret the server may not read means
    // the same to him as no key: nothing to fix on his side.
    const why = s.untested ? 'The saved MOCREO key has not passed Test Connection yet; readings are manual.' : 'No MOCREO key saved yet; readings are manual.';
    await statusRef.set({ configured: false, lastAttempt: at, lastError: why }, { merge: true });
    return { ok: false, waiting: true };
  }
  try {
    const devices = await fetchDevices(fetchFn, s.key, s.asset);
    const old = await db.collection('sensors').get(), seen = new Set();
    const batch = db.batch();
    devices.forEach(d => {
      const id = safeIdPart(d.sensorId);
      seen.add(id);
      batch.set(db.collection('sensors').doc(id), Object.assign({}, d, { returned: true, lastSyncAt: at, source: 'MOCREO' }));
    });
    old.docs.filter(x => !seen.has(x.id)).forEach(x => batch.set(x.ref, { returned: false, online: false, lastSyncAt: at }, { merge: true }));
    batch.set(statusRef, { configured: true, lastAttempt: at, lastSuccess: at, lastError: '', sensors: devices.length });
    await batch.commit();
    return { ok: true, sensors: devices.length };
  } catch (e) {
    await statusRef.set({ configured: true, lastAttempt: at, lastError: e.message }, { merge: true });
    return { ok: false, error: e.message };
  }
}

/* ---------- Administration > MOCREO & Sensors (administrators only) ---------- */
class MocreoError extends Error { constructor(code, message) { super(message); this.code = code; } }
const L = require('./logic');
const ends = (v) => { const t = String(v || ''); return t ? t.slice(-4) : ''; };
const view = (d) => ({ hasKey: !!d.apiKey, keyEnds: ends(d.apiKey), hasAsset: !!d.assetId, assetEnds: ends(d.assetId), savedAt: d.savedAt || '', savedBy: d.savedBy || '', lastTest: d.lastTest || null });

// The key saved in the app once its test has passed (the sync waits until then); else the Secret Manager secrets.
async function appSecrets(db, fallback) {
  const d = (await db.collection('private').doc('mocreo').get()).data() || {};
  if (d.apiKey && d.assetId) return d.lastTest && d.lastTest.ok ? { key: d.apiKey, asset: d.assetId } : { untested: true };
  return fallback ? fallback() : { missing: SECRETS.key };
}

const LIMIT = (v) => { const t = String(v === undefined || v === null ? '' : v).trim(); if (t === '') return ''; if (!isFinite(Number(t))) throw new MocreoError('BAD_REQUEST', 'A limit must be a number of °F, or blank.'); return Number(t); };
const clean = (v, n) => String(v === undefined || v === null ? '' : v).trim().slice(0, n);

/* input.op: status | save {apiKey, assetId} | clear | test | location {locationId?, location, area, sensorId, lowLimit, highLimit, active} | removeLocation {locationId} */
async function mocreoCall(db, user, input, options) {
  input = input || {};
  const o = Object.assign({ fetch: (...a) => fetch(...a), now: () => new Date() }, options || {});
  const email = String(user && user.email || '').toLowerCase();
  const person = (await db.collection('users').doc(safeIdPart(email)).get()).data();
  if (!person || person.status !== 'ACTIVE' || !L.isAdmin(person)) throw new MocreoError('NOT_ALLOWED', 'Only an administrator can change the MOCREO connection and the thermometers');
  const ref = db.collection('private').doc('mocreo'), d = (await ref.get()).data() || {}, at = o.now().toISOString(), op = String(input.op || 'status');
  if (op === 'status') return view(d);
  if (op === 'save') {
    const next = Object.assign({}, d), key = String(input.apiKey || '').trim(), asset = String(input.assetId || '').trim();
    if (!key && !asset) throw new MocreoError('BAD_REQUEST', 'Paste the new API key or asset ID first.');
    if (key) next.apiKey = key.slice(0, 300);
    if (asset) next.assetId = asset.slice(0, 200);
    Object.assign(next, { savedAt: at, savedBy: email, lastTest: null });
    await ref.set(next);
    await db.collection('config').doc('mocreo').set({ configured: false, lastError: 'New key saved; press Test Connection.' }, { merge: true });
    return view(next);
  }
  if (op === 'clear') {
    const next = { savedAt: at, savedBy: email, lastTest: null };
    await ref.set(next);
    await db.collection('config').doc('mocreo').set({ configured: false, lastError: 'No MOCREO key saved; readings are manual.' }, { merge: true });
    return view(next);
  }
  if (op === 'test') {
    let result;
    if (!d.apiKey || !d.assetId) result = { ok: false, message: 'Not tested: save the API key and asset ID first.' };
    else {
      try {
        const devices = await fetchDevices(o.fetch, d.apiKey, d.assetId);
        result = { ok: true, message: 'Connected. MOCREO sent ' + devices.length + ' sensor' + (devices.length === 1 ? '' : 's') + '.', sensors: devices.length };
      } catch (e) {
        result = { ok: false, message: /answered 40[13]/.test(e.message) ? 'MOCREO refused the key (' + e.message.replace(/^MOCREO answered (\d+).*/, '$1') + '). Check the API key and asset ID.' : 'Could not read MOCREO: ' + e.message };
      }
    }
    const lastTest = Object.assign({ at, by: email }, result);
    await ref.set({ lastTest }, { merge: true });
    // A passing test reads the sensors at once, so the thermometer list fills in without waiting for the next run.
    if (result.ok) await runMocreoSync({ db, getSecrets: async () => ({ key: d.apiKey, asset: d.assetId }), fetchFn: o.fetch, now: o.now });
    return Object.assign(view(Object.assign({}, d, { lastTest })), { result });
  }
  if (op === 'location') {
    const name = clean(input.location, 80);
    if (!name) throw new MocreoError('BAD_REQUEST', 'Give the thermometer a location name.');
    const id = clean(input.locationId, 120) || 'ut_temp_app_' + safeIdPart(name.toLowerCase()).replace(/[^a-z0-9]+/g, '_').slice(0, 40) + '_' + Date.parse(at).toString(36);
    const low = LIMIT(input.lowLimit), high = LIMIT(input.highLimit);
    if (low !== '' && high !== '' && low > high) throw new MocreoError('BAD_REQUEST', 'The low limit is above the high limit.');
    const doc = { locationId: id, location: name, area: clean(input.area, 80), sensorId: clean(input.sensorId, 120), sensorName: clean(input.sensorName, 120), lowLimit: low, highLimit: high,
      active: input.active !== false, removed: false, facilityId: 'fac_uniontown', updatedAt: at, updatedBy: email };
    if (input.viewSequence !== undefined && isFinite(Number(input.viewSequence))) doc.viewSequence = Number(input.viewSequence);
    await db.collection('tempLocations').doc(safeIdPart(id)).set(doc, { merge: true });
    return { ok: true, location: doc };
  }
  if (op === 'removeLocation') {
    const id = clean(input.locationId, 120);
    if (!id) throw new MocreoError('BAD_REQUEST', 'Which thermometer?');
    await db.collection('tempLocations').doc(safeIdPart(id)).set({ locationId: id, removed: true, active: false, updatedAt: at, updatedBy: email }, { merge: true });
    return { ok: true };
  }
  throw new MocreoError('BAD_REQUEST', 'Unknown MOCREO step ' + op.slice(0, 30));
}

module.exports = { runMocreoSync, readSecrets, fetchDevices, normalize, fahrenheit, SECRETS, mocreoCall, MocreoError, appSecrets };

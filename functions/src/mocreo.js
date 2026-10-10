/*
 * MOCREO cooler sensors, read only (Joe 10/10). The same steps as the current app (026_V731_MocreoService.gs and
 * 040_V740_MocreoNormalizationAssignment.gs): GET https://api.mocreo.com/v1/assets/<asset>/devices with the X-API-Key
 * header, a device's own page when the list has no temperature, and the temperature in hundredths of a degree Celsius.
 *
 * The API key and asset ID are the Secret Manager secrets MOCREO_API_KEY and MOCREO_ASSET_ID of the project the server runs
 * in. They are read when the sync runs, never stored in the database, never logged and never sent to a screen. Until both
 * secrets are there the sync does nothing and Cooler Temperatures stays manual.
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
  if (s.missing || s.denied) {
    const why = s.missing ? s.missing + ' is not in Secret Manager yet; Cooler Temperatures stays manual.' : 'The server may not read ' + s.denied + ' (needs Secret Manager Secret Accessor).';
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

module.exports = { runMocreoSync, readSecrets, fetchDevices, normalize, fahrenheit, SECRETS };

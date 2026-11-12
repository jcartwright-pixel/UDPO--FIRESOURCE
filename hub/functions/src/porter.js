/*
 * The Hub's porter (Joe 11-10-26: "We did design it that everything goes through the hub, and that way the hub is secure").
 * One door for outside calls: an app asks the porter, the porter checks the person on the Users list and their right, takes
 * the key, makes the call, hands back the answer and writes it down in the call log. The key never reaches a browser.
 *
 * First service (Joe 11-12-26, for the MapMaker): HERE, the same key Route & Trip uses (Firestore private/here, saved on
 * Keys & Connections). It moves to Google Secret Manager with the other keys; until then it is read where it is today.
 *
 *   porter { service: 'here', op: 'mapTile', z, x, y, style: 'normal' | 'satellite' }  -> { png }  (256 x 256, base64)
 *   porter { service: 'here', op: 'geocode', rows: [{ id, address }] }  (up to 100)    -> { results: [{ id, lat, lon, matched, score } | { id, notFound }] }
 *   porter { service: 'here', op: 'suggest', text, near: { lat, lon } | null }         -> { results: [{ address }] }
 *   porter { service: 'here', op: 'findPlace', name, near: { lat, lon } | null, town, limit } -> { results: [{ title, address, lat, lon, miles }] }
 *
 * Who may: the MapMaker's people (its People & Access tick, or administrators while no ticks are saved), the same rule
 * the MapMaker's own server uses.
 *
 * Call log: hubPorterLog/<id> { at, email, service, op, ok, ms, count, error } for every call, newest first by at. Map
 * pictures are asked many at a time while the map moves, so they are counted per person, day and style in
 * hubPorterDaily/<yyyy-mm-dd>__<service>__<op>__<email> { day, email, service, op, calls, failed, lastAt } instead of a line each.
 */
'use strict';

class PorterError extends Error { constructor(code, message) { super(message); this.code = code; } }
const fail = (code, message) => { throw new PorterError(code, message); };

const TILE_URL = 'https://maps.hereapi.com/v3/base/mc';
const GEOCODE_URL = 'https://geocode.search.hereapi.com/v1/geocode';
const AUTOCOMPLETE_URL = 'https://autocomplete.search.hereapi.com/v1/autocomplete';
const DISCOVER_URL = 'https://discover.search.hereapi.com/v1/discover';
const STYLES = { normal: 'explore.day', satellite: 'satellite.day' };
const MAX_ROWS = 100;
const MILE = 1609.344;

// Who may use each service: the app tick it belongs to (src/hub.js appsOf).
const SERVICES = { here: { app: 'mapmaker', ops: ['mapTile', 'geocode', 'suggest', 'findPlace'] } };

// A few hundred map pictures kept in memory, so panning back and forth does not ask HERE again.
const TILE_CACHE = new Map();
const TILE_CACHE_MAX = 400;
function cacheTile(k, png) {
  TILE_CACHE.set(k, png);
  if (TILE_CACHE.size > TILE_CACHE_MAX) TILE_CACHE.delete(TILE_CACHE.keys().next().value);
}

const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));
const text = (v, n) => String(v === undefined || v === null ? '' : v).trim().slice(0, n || 200);
const point = (p) => (p && Number.isFinite(num(p.lat)) && Number.isFinite(num(p.lon)) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180 ? { lat: Number(p.lat), lon: Number(p.lon) } : null);

async function hereKey(db) {
  const d = (await db.collection('private').doc('here').get()).data() || {};
  const key = typeof d.apiKey === 'string' ? d.apiKey.trim() : '';
  if (!key) fail('NO_KEY', 'The HERE key is not saved yet. An administrator saves it in the United Dairy Hub, Keys & Connections.');
  return key;
}

/** A plain error for a HERE answer that was not OK (never the key, never the address asked). */
async function refused(r, what) {
  if (r.status === 401 || r.status === 403) return new PorterError('OUTSIDE', 'HERE turned down the key for the ' + what + '. Check the HERE key on Keys & Connections.');
  if (r.status === 429) return new PorterError('OUTSIDE', 'HERE says the usage limit is reached. Try again in a minute.');
  return new PorterError('OUTSIDE', 'HERE could not do the ' + what + ' (' + r.status + '). Try again.');
}
async function ask(fetchFn, url, what, ms, binary) {
  let r;
  try { r = await fetchFn(url.toString(), { headers: { Accept: binary ? 'image/png' : 'application/json' }, signal: AbortSignal.timeout(ms) }); }
  catch (e) { throw new PorterError('OUTSIDE', 'HERE did not answer the ' + what + ' in time. Try again.'); }
  if (!r.ok) throw await refused(r, what);
  if (binary) return Buffer.from(await r.arrayBuffer()).toString('base64');
  try { return await r.json(); } catch (e) { throw new PorterError('OUTSIDE', 'HERE sent an answer to the ' + what + ' that could not be read. Try again.'); }
}

async function mapTile(key, input, fetchFn) {
  const z = num(input.z), x = num(input.x), y = num(input.y), style = text(input.style || 'normal', 20);
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > 20 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) fail('BAD_REQUEST', 'That map picture could not be read.');
  if (!STYLES[style]) fail('BAD_REQUEST', 'That map style is not one the porter knows.');
  const k = style + '/' + z + '/' + x + '/' + y;
  if (TILE_CACHE.has(k)) return { png: TILE_CACHE.get(k), cached: true };
  const url = new URL(TILE_URL + '/' + z + '/' + x + '/' + y + '/png');
  url.searchParams.set('style', STYLES[style]); url.searchParams.set('size', '256'); url.searchParams.set('apiKey', key);
  const png = await ask(fetchFn, url, 'map picture', 15000, true);
  cacheTile(k, png);
  return { png };
}

async function geocodeOne(key, address, fetchFn) {
  const url = new URL(GEOCODE_URL);
  url.searchParams.set('q', address); url.searchParams.set('in', 'countryCode:USA'); url.searchParams.set('limit', '1'); url.searchParams.set('apiKey', key);
  const d = await ask(fetchFn, url, 'address lookup', 15000);
  const it = Array.isArray(d.items) && d.items[0];
  const p = it && it.position;
  if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return null;
  const score = it.scoring && Number.isFinite(it.scoring.queryScore) ? Math.round(it.scoring.queryScore * 100) / 100 : null;
  return { lat: p.lat, lon: p.lng, matched: text(it.address && it.address.label || it.title, 300), score };
}

async function geocode(key, input, fetchFn) {
  const rows = Array.isArray(input.rows) ? input.rows : null;
  if (!rows || !rows.length) fail('BAD_REQUEST', 'Send the addresses to look up.');
  if (rows.length > MAX_ROWS) fail('BAD_REQUEST', 'Up to ' + MAX_ROWS + ' addresses at a time. Send a long list in parts.');
  const results = new Array(rows.length);
  let next = 0, failedHard = null;
  // Eight at a time, so a long list is quick without asking HERE for everything at once.
  async function worker() {
    while (next < rows.length && !failedHard) {
      const i = next++, row = rows[i] || {}, id = text(row.id, 100), address = text(row.address, 300);
      if (!address) { results[i] = { id, notFound: true }; continue; }
      try {
        const hit = await geocodeOne(key, address, fetchFn);
        results[i] = hit ? Object.assign({ id }, hit) : { id, notFound: true };
      } catch (e) {
        // A turned-down key or a usage limit stops the whole list; anything else marks that row only.
        if (/key|usage limit/.test(e.message)) failedHard = e; else results[i] = { id, notFound: true, error: e.message };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(8, rows.length) }, worker));
  if (failedHard) throw failedHard;
  return { results };
}

async function suggest(key, input, fetchFn) {
  const q = text(input.text, 250);
  if (q.length < 3) return { results: [] };
  const url = new URL(AUTOCOMPLETE_URL);
  url.searchParams.set('q', q); url.searchParams.set('in', 'countryCode:USA'); url.searchParams.set('limit', '6'); url.searchParams.set('apiKey', key);
  const near = point(input.near);
  if (near) url.searchParams.set('at', near.lat + ',' + near.lon);
  const d = await ask(fetchFn, url, 'address search', 10000);
  const list = (Array.isArray(d.items) ? d.items : []).map(i => text(i.address && i.address.label || i.title, 300)).filter(Boolean);
  return { results: [...new Set(list)].map(address => ({ address })) };
}

function miles(a, b) {
  const R = 3958.8, r = (d) => d * Math.PI / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function findPlace(key, input, fetchFn) {
  const name = text(input.name, 200), town = text(input.town, 200);
  const limit = Math.max(1, Math.min(5, Math.round(num(input.limit)) || 5));
  if (!name) fail('BAD_REQUEST', 'Type the name to search for.');
  let near = point(input.near);
  if (!near && town) {
    const t = await geocodeOne(key, town, fetchFn);
    if (!t) fail('NOT_FOUND_PLACE', 'HERE could not find the town "' + town + '". Check the spelling, or pick a plant instead.');
    near = { lat: t.lat, lon: t.lon };
  }
  if (!near) fail('BAD_REQUEST', 'Pick a plant or type a town to search near.');
  const url = new URL(DISCOVER_URL);
  url.searchParams.set('q', name); url.searchParams.set('at', near.lat + ',' + near.lon); url.searchParams.set('in', 'countryCode:USA');
  url.searchParams.set('limit', String(limit)); url.searchParams.set('apiKey', key);
  const d = await ask(fetchFn, url, 'place search', 15000);
  const results = (Array.isArray(d.items) ? d.items : []).filter(i => i.position && Number.isFinite(i.position.lat) && Number.isFinite(i.position.lng))
    .map(i => {
      const at = { lat: i.position.lat, lon: i.position.lng };
      const m = Number.isFinite(i.distance) ? i.distance / MILE : miles(near, at);
      return { title: text(i.title, 200), address: text(i.address && i.address.label, 300), lat: at.lat, lon: at.lon, miles: Math.round(m * 10) / 10 };
    })
    .sort((a, b) => a.miles - b.miles).slice(0, limit);
  return { results };
}

const OPS = { mapTile, geocode, suggest, findPlace };

async function writeLog(db, email, service, op, input, ok, ms, error, now) {
  const at = now.toISOString();
  try {
    if (op === 'mapTile') {
      const { FieldValue } = require('firebase-admin/firestore');
      const day = at.slice(0, 10);
      await db.collection('hubPorterDaily').doc([day, service, op, email].join('__')).set(
        { day, email, service, op, calls: FieldValue.increment(1), failed: FieldValue.increment(ok ? 0 : 1), lastAt: at }, { merge: true });
    } else {
      const count = op === 'geocode' && Array.isArray(input.rows) ? input.rows.length : 1;
      await db.collection('hubPorterLog').add({ at, email, service, op, ok, ms, count, error: ok ? '' : text(error, 300) });
    }
  } catch (e) { console.error('porter log', e && e.message); }
}

/**
 * The porter. person: the signed-in person's Users list record; may(app): whether this person has that app's tick.
 * options: { fetchFn, now, log } (log false skips the call log, for tests).
 */
async function porterCall(db, email, input, may, options) {
  const o = options || {}, fetchFn = o.fetchFn || fetch, started = Date.now();
  const service = text((input || {}).service, 40), op = text((input || {}).op, 40);
  const s = SERVICES[service];
  if (!s) fail('BAD_REQUEST', 'The porter does not know that service (unknown service).');
  if (s.ops.indexOf(op) < 0) fail('BAD_REQUEST', 'The porter does not know that request (unknown op).');
  if (!(await may(s.app))) fail('NOT_ALLOWED', 'You do not have the MapMaker. Ask an administrator to tick it for you in the United Dairy Hub, People & Access.');
  let answer, error = '';
  try {
    const key = await hereKey(db);
    answer = await OPS[op](key, input, fetchFn);
  } catch (e) { error = e.message || String(e); if (o.log !== false) await writeLog(db, email, service, op, input, false, Date.now() - started, error, o.now || new Date()); throw e; }
  if (o.log !== false && !answer.cached) await writeLog(db, email, service, op, input, true, Date.now() - started, '', o.now || new Date());
  if (answer.cached) delete answer.cached;
  return answer;
}

module.exports = { porterCall, PorterError, SERVICES, STYLES, TILE_CACHE, hereKey, geocodeOne };

/*
 * Filling in what a customer is missing (Joe 11-12-26: "if it doesn't have an address or you're using the GPS coordinates
 * that I had ... see if we can backfill somehow, get the addresses and fill them in, because there's over 1,000 addresses
 * that I do not have").
 *
 * For every active customer on the Customer List (read only):
 *   - a map point but no street address: the street address at that point, from HERE's reverse lookup through the porter;
 *   - a street address but no map point: the map point for that address, from HERE's address lookup.
 * Each answer is kept in hubAddressFill/<customer key> with what it was found from, so it is looked up once (again only when the
 * customer's map point or address changes). The Hub's customer list (hubCustomers, src/routemaster.js) shows a found value only
 * where the Customer List has none, marked addressFrom 'map point' or pointFrom 'address lookup'; the Customer List's own value
 * always wins and is never changed here. Runs every hour, a share of the lookups at a time, until every customer is done.
 */
'use strict';

const FILL = 'hubAddressFill';
const CUSTOMERS = 'udclCustomers';
const SOURCE = 'udclRouteMaster';
const PER_RUN = 800;

const text = (v) => (v === undefined || v === null ? '' : String(v).trim());
const isOff = (c) => !c || c.inactive === true || c.active === false;
const r5 = (n) => Math.round(Number(n) * 1e5) / 1e5;
function pointOf(c) {
  if (!c || c.lat === null || c.lat === undefined || c.lat === '' || c.lon === null || c.lon === undefined || c.lon === '') return null;
  const lat = Number(c.lat), lon = Number(c.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (!lat && !lon)) return null;
  return { lat: r5(lat), lon: r5(lon) };
}
const addressOf = (c) => [text(c.address), text(c.address2), [text(c.city), [text(c.state), text(c.zip)].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(', ');
const docId = (key) => text(key).replace(/\//g, '_').slice(0, 400);

/** What a customer needs, or null: { need: 'address', lat, lon } or { need: 'point', address }. */
function needOf(c) {
  if (isOff(c) || !text(c.key)) return null;
  const p = pointOf(c), street = text(c.address);
  if (p && !street) return { need: 'address', lat: p.lat, lon: p.lon };
  if (!p && street && (text(c.city) || text(c.zip))) return { need: 'point', address: addressOf(c) };
  return null;
}
/** A kept answer still fits the customer when it was found from the same map point or the same address. */
function stillFits(was, need) {
  if (!was) return false;
  if (need.need === 'address') return was.from === 'map point' && r5(was.fromLat) === need.lat && r5(was.fromLon) === need.lon;
  return was.from === 'address' && text(was.fromAddress) === need.address;
}

/** One plant: looks up what its customers need, up to budget lookups. Returns { looked, found, notFound, left }. */
async function fillPlant(db, plant, key, budget, options) {
  const o = options || {}, P = require('./porter'), fetchFn = o.fetchFn || fetch, at = (o.now || new Date()).toISOString();
  const [cs, fs] = await Promise.all([db.collection(CUSTOMERS).where('plant', '==', plant).get(), db.collection(FILL).where('plant', '==', plant).get()]);
  const kept = {};
  fs.docs.forEach(d => { kept[d.id] = d.data(); });
  const out = { plant, looked: 0, found: 0, notFound: 0, left: 0 };
  const todo = [];
  cs.docs.forEach(d => { const c = d.data(), need = needOf(c); if (need && !stillFits(kept[docId(c.key)], need)) todo.push([c, need]); });
  for (const [c, need] of todo) {
    if (out.looked >= budget) { out.left++; continue; }
    out.looked++;
    let rec;
    try {
      if (need.need === 'address') {
        const hit = await P.reverseOne(key, need.lat, need.lon, fetchFn);
        rec = hit ? { address: hit.street, city: hit.city, state: hit.state, zip: hit.zip, label: hit.label, meters: hit.meters } : { notFound: true };
        Object.assign(rec, { from: 'map point', fromLat: need.lat, fromLon: need.lon });
      } else {
        const hit = await P.geocodeOne(key, need.address, fetchFn);
        rec = hit ? { lat: r5(hit.lat), lon: r5(hit.lon), matched: hit.matched, score: hit.score } : { notFound: true };
        Object.assign(rec, { from: 'address', fromAddress: need.address });
      }
    } catch (e) {
      // A turned-down key or a usage limit stops the run; it carries on next hour.
      if (/key|usage limit/.test(e.message)) { out.stopped = e.message; out.left += todo.length - out.looked; out.looked--; break; }
      out.notFound++; continue;
    }
    if (rec.notFound) out.notFound++; else out.found++;
    await db.collection(FILL).doc(docId(c.key)).set(Object.assign(rec, { plant, key: text(c.key), account: text(c.account), name: text(c.name), at }));
  }
  return out;
}

/** Every plant the Customer List keeps, then the Hub's customer list rebuilt for each plant where something was found. */
async function fill(db, options) {
  const o = options || {}, P = require('./porter');
  let key;
  try { key = await P.hereKey(db); } catch (e) { return { stopped: e.message, plants: [] }; }
  const plants = (await db.collection(SOURCE).get()).docs.map(d => d.id);
  let budget = o.perRun || PER_RUN;
  const res = [];
  for (const plant of plants) {
    const r = await fillPlant(db, plant, key, budget, o);
    budget -= r.looked; res.push(r);
    if (r.looked && !o.noRebuild) await require('./routemaster').rebuildPlant(db, plant);
    if (r.stopped) break;
  }
  const looked = res.reduce((n, r) => n + r.looked, 0);
  if (looked && o.log !== false) {
    try { await db.collection('hubPorterLog').add({ at: (o.now || new Date()).toISOString(), email: 'the Hub (hourly fill)', service: 'here', op: 'addressFill', ok: !res.some(r => r.stopped), ms: 0, count: looked, error: (res.find(r => r.stopped) || {}).stopped || '' }); }
    catch (e) { console.error('fill log', e.message); }
  }
  return { plants: res };
}

/** The kept answers for one plant, by customer key (read by src/routemaster.js). */
async function readPlant(db, plant) {
  const snap = await db.collection(FILL).where('plant', '==', plant).get();
  const out = {};
  snap.docs.forEach(d => { const v = d.data(); if (v && v.key && !v.notFound) out[v.key] = v; });
  return out;
}

module.exports = { fill, fillPlant, readPlant, needOf, FILL };

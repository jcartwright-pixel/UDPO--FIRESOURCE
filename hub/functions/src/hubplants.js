/*
 * The plants' own map points: hubPlants/<plant> { plant, name, address, lat, lon, active } (MapMaker asked 11-12-26, request
 * (d); Joe 11-12-26: "the plant locations, for Miles from a plant"). Every plant, read by the MapMaker (plant pins, Miles from a
 * plant) and any app that needs where a plant is. A plant is data, never written into an app.
 *
 * Which plants: Operations' plants (src/plants.js) and every plant the Hub's customer list has (hubCustomers/<plant>), so the
 * MapMaker never loses a plant's customers. Filled by itself: the address comes from Route & Trip's starting points
 * (routeEstimator/locations, the location whose name has the plant's name), and the map point from the address through the
 * porter's HERE lookup (the same private/here key). Administrators change any of it on Plant Setup; a plant saved there
 * (source 'hub') is never changed by the fill again.
 */
'use strict';
const PL = require('./plants');

const COLLECTION = 'hubPlants';
// Route & Trip's own starting list (ud-route-estimator functions/src/locations.mjs DEFAULT_LOCATIONS), used only while
// Route & Trip has not saved its list, the same as Route & Trip does.
const ROUTE_TRIP_DEFAULT = [
  { name: 'United Dairy Uniontown', address: '47 West Craig Street, Uniontown, PA' },
  { name: 'United Dairy Martins Ferry', address: '300 North 5th Street, Martins Ferry, OH 43935' },
  { name: 'United Dairy Marietta', address: '1701 Greene Street, Marietta, OH 45750' }
];
// Joe 11-13-26: "Look for United Dairy Charleston ... a United Dairy in Lancaster ... a United Dairy in Fairmont." The addresses
// are United Dairy's own (drinkunited.com/locations). Used only where Route & Trip has no address for that place, and never
// over a plant an administrator saved on Plant Setup.
const UNITED_DAIRY_PLACES = [
  { name: 'United Dairy Charleston', address: '508 Roane Street, Charleston, WV 25302' },
  { name: 'United Dairy Lancaster', address: '724 South Columbus Street, Lancaster, OH 43130' },
  { name: 'United Dairy Fairmont', address: '6 Garvin Dairy Road, Fairmont, WV 26554' }
];

class PlantError extends Error { constructor(code, message) { super(message); this.code = code; } }
const fail = (code, message) => { throw new PlantError(code, message); };
const text = (v, n) => String(v === undefined || v === null ? '' : v).trim().slice(0, n || 200);
const basePlant = (id) => text(id, 80).split('__')[0];
const nameOf = (plant) => String(plant).replace(/^fac_/, '').split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
const round = (n) => Math.round(n * 1e6) / 1e6;
function point(lat, lon) {
  if (lat === '' || lat === null || lat === undefined || lon === '' || lon === null || lon === undefined) return null;
  const a = Number(lat), o = Number(lon);
  return Number.isFinite(a) && Number.isFinite(o) && Math.abs(a) <= 90 && Math.abs(o) <= 180 && !(a === 0 && o === 0) ? { lat: round(a), lon: round(o) } : null;
}

async function readAll(db) {
  const snap = await db.collection(COLLECTION).get();
  return snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
}

/** Every plant, by name. */
async function read(db) {
  const plants = (await readAll(db)).map(p => ({ id: p.id, name: text(p.name) || nameOf(p.id), address: text(p.address, 300),
    lat: point(p.lat, p.lon) ? p.lat : null, lon: point(p.lat, p.lon) ? p.lon : null, active: p.active !== false,
    source: p.source || 'auto', matched: text(p.matched, 300), savedBy: p.savedBy || '', updatedAt: p.updatedAt || '' }));
  plants.sort((a, b) => a.name.localeCompare(b.name));
  return { plants };
}

/** Looks an address up through the porter's HERE lookup. null when not found or there is no key; never throws for that. */
async function lookUp(db, address, fetchFn) {
  if (!address) return null;
  const P = require('./porter');
  let key;
  try { key = await P.hereKey(db); } catch (e) { return null; }
  try { return await P.geocodeOne(key, address, fetchFn || fetch); } catch (e) { console.error('hubPlants lookup', e.message); return null; }
}

/** The plant ids to keep: Operations' plants and every plant on the Hub's customer list. */
async function plantIds(db) {
  const ids = new Map(PL.PLANTS.map(p => [p.id, p.name]));
  const refs = await db.collection('hubCustomers').listDocuments();
  for (const r of refs) { const id = basePlant(r.id); if (id && !ids.has(id)) ids.set(id, nameOf(id)); }
  return ids;
}

/** Route & Trip's address for a plant: the location whose name has the plant's name. */
function addressFor(name, locations) {
  const n = String(name || '').toLowerCase();
  const hit = n && locations.find(l => String(l && l.name || '').toLowerCase().indexOf(n) >= 0);
  return hit ? text(hit.address, 300) : '';
}

/**
 * Adds any plant missing from hubPlants and fills a missing address or map point. A plant an administrator saved is left as it
 * is. options: { fetchFn, now }. Returns { added, filled, kept }.
 */
async function fill(db, options) {
  const o = options || {}, at = (o.now || new Date()).toISOString();
  const [ids, have, rt] = await Promise.all([plantIds(db), readAll(db), db.collection('routeEstimator').doc('locations').get()]);
  const saved = rt.exists ? rt.data() || {} : {};
  const fromRt = Array.isArray(saved.list) && saved.list.length ? saved.list : ROUTE_TRIP_DEFAULT;
  const placeName = (l) => text(l && l.name).replace(/^united dairy\s+/i, '').toLowerCase();
  const rtNames = new Set(fromRt.map(placeName));
  const locations = fromRt.concat(UNITED_DAIRY_PLACES.filter(u => !rtNames.has(placeName(u))));
  const byId = new Map(have.map(p => [p.id, p]));
  have.forEach(p => { if (!ids.has(p.id)) ids.set(p.id, text(p.name) || p.id); });
  // A Route & Trip starting point that is not a plant yet (a DC such as a made-up Sampleton) is kept too, so the address
  // check can tell how far a customer is from the DC that serves it.
  const known = new Set([...ids.values()].concat(have.map(p => text(p.name))).map(n => n.toLowerCase()));
  for (const l of locations) {
    const name = text(l && l.name).replace(/^united dairy\s+/i, '');
    const id = 'fac_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (!name || known.has(name.toLowerCase()) || ids.has(id) || !/^fac_[a-z0-9_]{1,60}$/.test(id)) continue;
    ids.set(id, name); known.add(name.toLowerCase());
  }
  const out = { added: [], filled: [], kept: [] };
  for (const [id, opsName] of ids) {
    const was = byId.get(id);
    if (was && was.source === 'hub') { out.kept.push(id); continue; }
    const name = text(was && was.name) || opsName;
    const address = text(was && was.address, 300) || addressFor(name, locations);
    let p = was && point(was.lat, was.lon), matched = text(was && was.matched, 300);
    if (!p && address) { const hit = await lookUp(db, address, o.fetchFn); if (hit) { p = point(hit.lat, hit.lon); matched = text(hit.matched, 300); } }
    const next = { plant: id, name, address, lat: p ? p.lat : null, lon: p ? p.lon : null, matched, active: !(was && was.active === false), source: 'auto' };
    const same = was && Object.keys(next).every(k => (was[k] === undefined ? null : was[k]) === next[k]);
    if (same) { out.kept.push(id); continue; }
    await db.collection(COLLECTION).doc(id).set(Object.assign(next, { updatedAt: at, from: 'Route & Trip starting points' }));
    (was ? out.filled : out.added).push(id);
  }
  return out;
}

/**
 * Administrators: { id?, name, address, lat?, lon?, active }. With no map point typed, the address is looked up. A new plant
 * needs a name; its id is fac_ and the name. Saved plants are never changed by the fill again.
 */
async function save(db, email, input, options) {
  const o = options || {}, at = (o.now || new Date()).toISOString();
  const name = text(input && input.name, 80), address = text(input && input.address, 300);
  if (!name) fail('BAD_REQUEST', 'Give the plant a name.');
  let id = basePlant(input && input.id);
  if (!id) id = 'fac_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!/^fac_[a-z0-9_]{1,60}$/.test(id)) fail('BAD_REQUEST', 'That plant could not be read. Reload the page.');
  const typed = (input.lat !== undefined && input.lat !== '' && input.lat !== null) || (input.lon !== undefined && input.lon !== '' && input.lon !== null);
  let p = point(input.lat, input.lon), matched = '';
  if (typed && !p) fail('BAD_REQUEST', 'The map point could not be read. Type it like 39.9 and -79.7, or leave both empty to look the address up.');
  if (!p) {
    if (!address) fail('BAD_REQUEST', 'Type the plant\'s street address, or its map point.');
    const hit = await lookUp(db, address, o.fetchFn);
    if (!hit) fail('NOT_FOUND', 'That address was not found on the map. Check it, or type the map point.');
    p = point(hit.lat, hit.lon); matched = text(hit.matched, 300);
  }
  const rec = { plant: id, name, address, lat: p.lat, lon: p.lon, matched, active: input.active !== false, source: 'hub', savedBy: email, updatedAt: at };
  await db.collection(COLLECTION).doc(id).set(rec);
  return Object.assign({ id }, rec);
}

module.exports = { read, fill, save, PlantError, ROUTE_TRIP_DEFAULT, UNITED_DAIRY_PLACES, COLLECTION };

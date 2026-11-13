/*
 * Filling in what a customer is missing (Joe 11-12-26: "if it doesn't have an address or you're using the GPS coordinates
 * that I had ... see if we can backfill somehow, get the addresses and fill them in, because there's over 1,000 addresses
 * that I do not have").
 *
 * For every active customer on the Customer List (read only):
 *   - a map point but no street address: the street address at that point, from HERE's reverse lookup through the porter;
 *   - a street address but no map point: the map point for that address, from HERE's address lookup;
 *   - both (Joe 11-12-26: "Is there any way we can check the validity of each address?"): the address is looked up and the
 *     point HERE finds is compared with the customer's own map point.
 * Every answer carries a verdict: 'good', or 'check' with the reason in plain words: HERE could not find the address, only
 * matched part of it (match under 80 out of 100), or the address is more than a quarter mile from the map point.
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
const GOOD_SCORE = 0.8;      // HERE's match out of 1: below this, part of the address did not match
const NEAR_MILES = 0.25;     // an address more than this from the customer's own map point is to check
const MILE = 1609.344;

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

/** What a customer needs, or null: { need: 'address', lat, lon }, { need: 'point', address } or { need: 'check', address, lat, lon }. */
function needOf(c) {
  if (isOff(c) || !text(c.key)) return null;
  const p = pointOf(c), street = text(c.address), full = street && (text(c.city) || text(c.zip));
  if (p && !street) return { need: 'address', lat: p.lat, lon: p.lon };
  if (!p && full) return { need: 'point', address: addressOf(c) };
  if (p && full) return { need: 'check', address: addressOf(c), lat: p.lat, lon: p.lon };
  if (!p && street) return { need: 'check', address: addressOf(c), noTown: true };
  return null;
}
function milesBetween(a, b) {
  const rad = (d) => d * Math.PI / 180, R = 3958.8;
  const x = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
/** The verdict on one answer: { verdict: 'good' | 'check', why }. */
function verdictOf(need, rec) {
  if (need.noTown) return { verdict: 'check', why: 'The address has no town or ZIP code.' };
  if (rec.notFound) return { verdict: 'check', why: need.need === 'address' ? 'No street address was found at the map point.' : 'HERE could not find this address.' };
  if (need.need === 'address') return rec.meters !== null && rec.meters !== undefined && rec.meters > NEAR_MILES * MILE
    ? { verdict: 'check', why: 'The nearest street address is ' + (Math.round(rec.meters / MILE * 10) / 10) + ' miles from the map point.' } : { verdict: 'good', why: '' };
  if (rec.score !== null && rec.score !== undefined && rec.score < GOOD_SCORE) return { verdict: 'check', why: 'HERE matched only part of the address (' + Math.round(rec.score * 100) + ' out of 100). Found: ' + text(rec.matched) };
  if (need.need === 'check' && rec.miles > NEAR_MILES) return { verdict: 'check', why: 'The address is ' + rec.miles + ' miles from the customer\'s map point.' };
  return { verdict: 'good', why: '' };
}
/** A kept answer still fits the customer when it was found from the same map point or the same address. */
function stillFits(was, need) {
  if (!was) return false;
  if (need.need === 'address') return was.from === 'map point' && r5(was.fromLat) === need.lat && r5(was.fromLon) === need.lon;
  if (need.need === 'check') return was.from === 'check' && text(was.fromAddress) === need.address && (need.noTown || (r5(was.fromLat) === need.lat && r5(was.fromLon) === need.lon));
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
  // What is missing first, then the checks of addresses that are there.
  todo.sort((a, b) => (a[1].need === 'check') - (b[1].need === 'check'));
  for (const [c, need] of todo) {
    if (out.looked >= budget) { out.left++; continue; }
    out.looked++;
    let rec;
    try {
      if (need.need === 'address') {
        const hit = await P.reverseOne(key, need.lat, need.lon, fetchFn);
        rec = hit ? { address: hit.street, city: hit.city, state: hit.state, zip: hit.zip, label: hit.label, meters: hit.meters } : { notFound: true };
        Object.assign(rec, { from: 'map point', fromLat: need.lat, fromLon: need.lon });
      } else if (need.noTown) {
        rec = { notFound: true, from: 'check', fromAddress: need.address };
      } else {
        const hit = await P.geocodeOne(key, need.address, fetchFn);
        rec = hit ? { lat: r5(hit.lat), lon: r5(hit.lon), matched: hit.matched, score: hit.score } : { notFound: true };
        if (need.need === 'check') {
          if (hit) rec.miles = Math.round(milesBetween({ lat: need.lat, lon: need.lon }, hit) * 100) / 100;
          Object.assign(rec, { from: 'check', fromAddress: need.address, fromLat: need.lat, fromLon: need.lon });
        } else Object.assign(rec, { from: 'address', fromAddress: need.address });
      }
      Object.assign(rec, verdictOf(need, rec));
    } catch (e) {
      // A turned-down key or a usage limit stops the run; it carries on next hour.
      if (/key|usage limit/.test(e.message)) { out.stopped = e.message; out.left += todo.length - out.looked; out.looked--; break; }
      out.notFound++; continue;
    }
    if (rec.verdict === 'check') out.toCheck = (out.toCheck || 0) + 1;
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
  snap.docs.forEach(d => { const v = d.data(); if (v && v.key) out[v.key] = v; });
  return out;
}

/**
 * Administrators: every customer whose address is to check, from the Hub's customer list (hubCustomers, where src/routemaster.js
 * puts the verdict and its reasons), by plant then name. input: { plant? }
 */
async function toCheck(db, input) {
  const plant = text(input && input.plant);
  const snap = await (plant ? db.collection('hubCustomers').where('plant', '==', plant) : db.collection('hubCustomers')).get();
  const all = [];
  snap.docs.forEach(d => { const v = d.data() || {}; (v.customers || []).forEach(c => all.push(c)); });
  const rows = all.filter(c => c.addressCheck === 'check').map(c => ({ plant: c.plant, key: c.key, account: c.account, name: c.name, dcName: c.dcName || '',
    address: c.address || '', why: c.addressCheckWhy || '' })).sort((a, b) => text(a.plant).localeCompare(text(b.plant)) || text(a.name).localeCompare(text(b.name)));
  return { rows, counts: { customers: all.length, checked: all.filter(c => c.addressCheck).length, good: all.filter(c => c.addressCheck === 'good').length, toCheck: rows.length } };
}

module.exports = { fill, fillPlant, readPlant, toCheck, needOf, verdictOf, FILL };

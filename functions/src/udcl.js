/*
 * The bridge to the United Dairy Customer List (UDCL, Joe 11/1). The Customer List is its own app (its own repository,
 * jcartwright-pixel/united-dairy-customer-list, and its own web site; Joe 11/1: "I would really like it separated ... Still want
 * the bridge, but keep it separate"). It keeps its records in this Firebase project's main database:
 *
 *   udclCustomers/<plant>__<account>          the customer: name, chain, distribution center, address, phone, keys, notes
 *   udclRouteDays/<plant>__<route>__<DAY>     the route day: stops in run order, start time, instructions, load map
 *   private/udcl_<plant>                      the last import
 *
 * Operations only reads them, here: the Sales app's Customers card takes its lines only from the Customer List (Joe 11/1:
 * "Any changes or ever, it goes through that"; salescustomers.js forSales), and the drivers' phone (Route Check-In) shows a route day's Route Book (phone.js routeBook).
 * Nothing in Operations changes them. udcl-rules.js is the Customer List's rules file (the same file as in that app).
 */
'use strict';

const U = require('./udcl-rules');

const CUSTOMERS = 'udclCustomers';
const ROUTE_DAYS = 'udclRouteDays';

// The map comes back as rows of numbers (the database keeps each row as words, packMap).
const unpack = (rd) => (rd && rd.map ? Object.assign({}, rd, { map: U.cleanMap(rd.map) }) : rd);

async function readPlant(db, plant) {
  const [cs, rs, meta] = await Promise.all([
    db.collection(CUSTOMERS).where('plant', '==', plant).get(),
    db.collection(ROUTE_DAYS).where('plant', '==', plant).get(),
    db.collection('private').doc('udcl_' + plant).get()
  ]);
  const customers = {};
  cs.docs.forEach(d => { const c = d.data(); customers[c.key] = c; });
  const routeDays = rs.docs.map(d => unpack(d.data())).sort((a, b) => U.byRoute(a.route, b.route) || U.dayIndex(a.day) - U.dayIndex(b.day));
  return { customers, routeDays, meta: meta.exists ? meta.data() : null };
}

/** For the drivers' phone: one route day's stops in run order, with each customer's address, keys and notes. */
async function routeBook(db, plant, route, day) {
  route = U.numText(String(route || '').replace(/_\d+$/, ''), U.LIMITS.route); day = U.dayOf(day);
  if (!route || !day) return { found: false };
  let s = await db.collection(ROUTE_DAYS).doc(U.routeDayId(plant, route, day)).get();
  // Dispatch may name a route with words around its number ("803 PITTSBURGH"): the number alone, then.
  const num = (/\d{3,}/.exec(route) || [])[0];
  if (!s.exists && num && num !== route) { route = num; s = await db.collection(ROUTE_DAYS).doc(U.routeDayId(plant, route, day)).get(); }
  if (!s.exists) return { found: false, route, day };
  const rd = s.data(), keys = (rd.stops || []).map(x => x.key);
  const refs = keys.map(k => db.collection(CUSTOMERS).doc(U.customerId(plant, k)));
  const cs = refs.length ? await db.getAll(...refs) : [];
  const stops = (rd.stops || []).map((x, i) => { const c = cs[i] && cs[i].exists ? cs[i].data() : {}; return { stop: i + 1, name: c.name || x.name, account: c.account || x.account || '', loadSeq: x.loadSeq || 0, note: x.note || '',
    address: U.addressLine(c), phone: c.phone || '', keys: c.keys || '', notes: c.notes || '', lat: c.lat || null, lon: c.lon || null }; });
  return { found: true, route, day, dayName: U.DAY_NAMES[day], startTime: rd.startTime || '', notes: rd.notes || '', map: rd.map ? U.cleanMap(rd.map) : null, stops, updatedAt: rd.updatedAt || '' };
}

/** The Sales app's lines from the Customer List: { rows: [{ day, route, account, chain, name }], savedAt }, or null when it has none. */
async function salesRows(db, plant) {
  // A plant whose list was never imported into the Customers app has none (the Sales app shows an empty list then).
  if (!(await db.collection('private').doc('udcl_' + plant).get()).exists) return null;
  const d = await readPlant(db, plant);
  if (!d.routeDays.length) return null;
  const rows = [];
  d.routeDays.forEach(rd => (rd.stops || []).forEach(s => { const c = d.customers[s.key] || {}; if (c.active === false) return; rows.push({ day: rd.day, route: rd.route, account: c.account || s.account || '', chain: c.chain || s.chain || '', name: c.name || s.name || '', group: c.group || '' }); }));
  ((d.meta && d.meta.unrouted) || []).forEach(x => rows.push({ day: x.day, route: '', account: x.account || '', chain: x.chain || '', name: x.name || '', group: ((d.customers[x.key] || {}).group) || '' }));
  const at = d.routeDays.map(r => r.updatedAt || '').concat(Object.values(d.customers).map(c => c.updatedAt || '')).sort().pop() || '';
  return { rows, savedAt: at };
}

module.exports = { salesRows, routeBook, readPlant, CUSTOMERS, ROUTE_DAYS };

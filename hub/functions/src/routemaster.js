/*
 * The route customer list through the Hub (Joe 11-9-26: "It comes through to read and it comes through to write ... That way,
 * it's always pointed to the correct updated master"). The one master copy stays the Customer List's own records:
 *
 *   udclCustomers/<plant>__<account>          each customer (written only by the Customer List's code)
 *   udclRouteDays/<plant>__<route>__<DAY>     each route day: stops in run order, load sequences, start time, notes, load map
 *   udclRouteMaster/<plant>                   rewritten by the Customer List after every change it makes
 *
 * The Hub only reads those and writes the two records every other app reads instead (master repository,
 * requests/customer-list-through-hub.md; MASTER.md section 2):
 *
 *   hubRouteMaster/<plant>   every stop on every route day in run order, active customers only, every row with its plant,
 *                            each stop's PALLET USES and case columns (LOW / MIDDLE / AVERAGE / HIGH / LAST 5 WKS), and each
 *                            route day's start time, notes and load map
 *   hubCustomers/<plant>     each active customer's details (chain, account, group, DC (dc, dcName), address, phone, keys, notes, map point;
 *                            a street address or map point the Customer List lacks is filled from src/addressfill.js and marked),
 *                            the route days it is on, and the active customers on no route
 *
 * They are rebuilt when the Customer List rewrites udclRouteMaster/<plant>, when a week of the weekly route report lands
 * (routeWeekly, for the case columns), and every hour in case a change reached the list another way. Plants are never written
 * into this code: a plant is whatever the Customer List has a udclRouteMaster record for.
 * Account alone is not unique (1522 and 51 are each two stores), so every row keeps the chain.
 */
'use strict';

const CUSTOMERS = 'udclCustomers';
const ROUTE_DAYS = 'udclRouteDays';
const SOURCE = 'udclRouteMaster';
const WEEKLY = 'routeWeekly';
const HUB_ROUTE_MASTER = 'hubRouteMaster';
const HUB_CUSTOMERS = 'hubCustomers';

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const DAY_FIELD = { SUN: 'sun', MON: 'mon', TUE: 'tue', WED: 'wed', THU: 'thu', FRI: 'fri', SAT: 'sat' };
// LAST 5 WKS: the average of the newest five deliveries, as the Customer List's own screens show it.
const LAST_WEEKS = 5;
// Firestore holds at most 1 MB a record: a plant bigger than this goes into parts (<plant>__2, <plant>__3 ...).
const PART_BYTES = 800000;

const text = (v) => (v === undefined || v === null ? '' : String(v).trim());
const isOff = (c) => !c || c.inactive === true || c.active === false;
const r1 = (x) => Math.round(x * 10) / 10;
function byRoute(a, b) {
  const x = parseInt(a, 10), y = parseInt(b, 10);
  if (isFinite(x) && isFinite(y) && x !== y) return x - y;
  return String(a).localeCompare(String(b));
}
function addressLine(c) {
  const cityLine = [text(c.city), [text(c.state), text(c.zip)].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [text(c.address), text(c.address2), cityLine].filter(Boolean).join(', ');
}

/*
 * Each customer's DC (Joe 11-12-26: "everything should be listed by DC, and that's how the filter should work"). The same
 * rule as the Customer List's own screens (united-dairy-customer-list public/js/udcl-rules.js: DCS, dcOf, branchOf), copied
 * here because the Hub only reads the Customer List's records: the DC column also holds route numbers; a number above 80 or
 * 0, 8, 11, 12, 14 is a route, not a branch, and those are Marietta's books (9), except route 815, which is Uniontown's (30).
 * A DC is data on the customer, never a plant written into this code; a DC with no name here shows as "DC 61".
 */
const DC_NAMES = { 1: 'Martins Ferry', 6: 'Lancaster', 7: 'Fairmont', 9: 'Marietta', 30: 'Uniontown', 50: 'Charleston' };
const NOT_BRANCH = { 0: 1, 8: 1, 11: 1, 12: 1, 14: 1 }, ROUTE_BRANCH = '9', ROUTE_OWNER = { 815: '30' };
function dcOf(v) {
  let t = v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim().slice(0, 6);
  if (/^-?\d+\.0+$/.test(t)) t = t.replace(/\.0+$/, '');
  t = t.replace(/^0+(?=\d)/, '');
  return /^\d{1,4}$/.test(t) ? t : '';
}
function branchOf(v) {
  const t = dcOf(v);
  return !t || (!NOT_BRANCH[t] && Number(t) <= 80) ? t : ROUTE_OWNER[t] || ROUTE_BRANCH;
}
const dcNameOf = (dc) => (dc ? DC_NAMES[dc] || 'DC ' + dc : '');

/** Low, middle, average, high and the last-5 average of one customer's deliveries on one route day; null with none. */
function caseColumns(weeks) {
  const w = (weeks || []).filter(x => Number(x[1]) > 0).sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0));
  if (!w.length) return null;
  const v = w.map(x => Number(x[1])), s = v.slice().sort((a, b) => a - b);
  const sum = (a) => a.reduce((t, x) => t + x, 0);
  const mid = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  const last = v.slice(0, LAST_WEEKS);
  return { low: Math.round(s[0]), middle: r1(mid), average: r1(sum(v) / v.length), high: Math.round(s[s.length - 1]),
    last5: r1(sum(last) / last.length), deliveries: v.length, newest: w[0][0] };
}

/** route|account -> [[week ending, cases on that day field]] for every week of the weekly route report. */
function weeksByStop(weeklyDocs) {
  const by = {};
  weeklyDocs.forEach(w => {
    const week = text(w.week_ending || w.id);
    (w.stops || []).forEach(st => { const k = text(st.route) + '|' + text(st.customer_no); (by[k] = by[k] || []).push(Object.assign({ week }, st)); });
  });
  return by;
}

/*
 * What the Hub found for a customer the Customer List has no street address or no map point for (src/addressfill.js): shown only
 * where the Customer List has none, and marked so every app can tell (addressFrom 'map point', pointFrom 'address lookup').
 */
function withFill(row, c, f) {
  if (!f) return row;
  const hasPoint = row.lat !== null && row.lon !== null && !(row.lat === 0 && row.lon === 0);
  if (!text(c.address) && f.from === 'map point' && text(f.address)) {
    const city = row.city || text(f.city), state = row.state || text(f.state), zip = row.zip || text(f.zip);
    Object.assign(row, { address: [text(f.address), [city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(', '),
      city, state, zip, addressFrom: 'map point' });
  }
  if (!hasPoint && f.from === 'address' && isFinite(Number(f.lat)) && isFinite(Number(f.lon)) && f.lat !== null) Object.assign(row, { lat: Number(f.lat), lon: Number(f.lon), pointFrom: 'address lookup' });
  return row;
}

/**
 * The two Hub records for one plant, from the Customer List's records as read.
 * customers: [udclCustomers docs], routeDays: [udclRouteDays docs], meta: private/udcl_<plant> (unrouted), weekly: [routeWeekly docs].
 */
function build(plant, plantName, src) {
  const customers = {};
  (src.customers || []).forEach(c => { if (c && c.key) customers[c.key] = c; });
  const weeks = weeksByStop(src.weekly || []);
  const routeDays = (src.routeDays || []).filter(rd => DAYS.indexOf(rd.day) >= 0)
    .sort((a, b) => byRoute(a.route, b.route) || DAYS.indexOf(a.day) - DAYS.indexOf(b.day));
  const rows = [], days = [], onRoutes = {};
  let left = 0, sourceAt = '';
  const newer = (at) => { if (text(at) > sourceAt) sourceAt = text(at); };
  Object.keys(customers).forEach(k => newer(customers[k].updatedAt));
  routeDays.forEach(rd => {
    newer(rd.updatedAt);
    const day = DAYS.indexOf(rd.day), route = text(rd.route), f = DAY_FIELD[rd.day];
    let stop = 0;
    (rd.stops || []).forEach(s => {
      const c = customers[s.key];
      if (isOff(c)) { left++; return; }
      const account = text(c.account || s.account);
      const list = weeks[route + '|' + account] || [];
      const dc = branchOf(c.dc);
      rows.push({ plant, route, day, dayName: rd.day, stop: ++stop, load: Number(s.loadSeq) || 0, key: s.key, account, dc, dcName: dcNameOf(dc),
        chain: text(c.chain === undefined || c.chain === null ? s.chain : c.chain), customer: text(c.name || s.name), note: text(s.note),
        palletUses: text((rd.palletUses || {})[s.key]), cases: caseColumns(list.filter(x => Number(x[f]) > 0.5).map(x => [x.week, r1(Number(x[f]))])) });
      (onRoutes[s.key] = onRoutes[s.key] || []).push({ route, day, dayName: rd.day, stop });
    });
    if (stop) days.push({ plant, route, day, dayName: rd.day, stops: stop, startTime: text(rd.startTime), notes: text(rd.notes), map: rd.map || null });
  });
  const people = Object.keys(customers).filter(k => !isOff(customers[k])).sort((a, b) => text(customers[a].name).localeCompare(text(customers[b].name)))
    .map(k => { const c = customers[k], dc = branchOf(c.dc); const row = { plant, key: k, account: text(c.account), chain: text(c.chain), name: text(c.name), group: text(c.group), dc, dcName: dcNameOf(dc),
      address: addressLine(c), city: text(c.city), state: text(c.state), zip: text(c.zip), phone: text(c.phone), keys: text(c.keys), notes: text(c.notes),
      lat: isFinite(Number(c.lat)) && c.lat !== null && c.lat !== '' ? Number(c.lat) : null, lon: isFinite(Number(c.lon)) && c.lon !== null && c.lon !== '' ? Number(c.lon) : null,
      routes: onRoutes[k] || [] }; return withFill(row, c, (src.fills || {})[k]); });
  const unrouted = ((src.meta && src.meta.unrouted) || []).filter(x => !isOff(customers[x.key] || {}))
    .map(x => { const dc = branchOf((customers[x.key] || {}).dc); return { plant, key: text(x.key), account: text(x.account), chain: text(x.chain), name: text(x.name), day: text(x.day), dc, dcName: dcNameOf(dc) }; });
  const routes = new Set(rows.map(r => r.route));
  const counts = { stops: rows.length, routes: routes.size, routeDays: days.length, customers: people.length, unrouted: unrouted.length,
    inactiveLeftOut: left, withCases: rows.filter(r => r.cases).length, caseWeeks: (src.weekly || []).length };
  return {
    routeMaster: { plant, plantName, activeOnly: true, sourceAt, counts, rows, days },
    customers: { plant, plantName, activeOnly: true, sourceAt, counts: { customers: people.length, unrouted: unrouted.length }, customers: people, unrouted }
  };
}

/** Splits a record's long lists into parts when it would not fit one Firestore record. Returns [[id, record], ...]. */
function parts(id, rec, listKeys) {
  const size = Buffer.byteLength(JSON.stringify(rec));
  if (size <= PART_BYTES) return [[id, Object.assign({}, rec, { parts: 1 })]];
  const n = Math.ceil(size / PART_BYTES), out = [];
  for (let i = 0; i < n; i++) {
    const p = {};
    listKeys.forEach(k => { const a = rec[k] || [], per = Math.ceil(a.length / n); p[k] = a.slice(i * per, (i + 1) * per); });
    out.push([i ? id + '__' + (i + 1) : id, Object.assign({}, i ? { plant: rec.plant, part: i + 1 } : rec, p, i ? {} : { parts: n })]);
  }
  return out;
}

// The Customer List's record names the plant; without it, fac_martins_ferry reads Martins Ferry.
const nameOf = (plant) => String(plant).replace(/^fac_/, '').split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

/** Reads one plant's Customer List records and writes hubRouteMaster/<plant> and hubCustomers/<plant>. */
async function rebuildPlant(db, plant, stamp, weeklyDocs) {
  const [cs, rs, meta, source, fills] = await Promise.all([
    db.collection(CUSTOMERS).where('plant', '==', plant).get(),
    db.collection(ROUTE_DAYS).where('plant', '==', plant).get(),
    db.collection('private').doc('udcl_' + plant).get(),
    db.collection(SOURCE).doc(plant).get(),
    require('./addressfill').readPlant(db, plant).catch(() => ({}))
  ]);
  const weekly = weeklyDocs || (await db.collection(WEEKLY).get()).docs.map(d => Object.assign({ id: d.id }, d.data()));
  const name = (source.exists && source.data().plantName) || nameOf(plant);
  const b = build(plant, name, { customers: cs.docs.map(d => d.data()), routeDays: rs.docs.map(d => d.data()), meta: meta.exists ? meta.data() : null, weekly, fills });
  const at = stamp || new Date().toISOString();
  const writes = parts(plant, Object.assign(b.routeMaster, { builtAt: at }), ['rows', 'days']).map(([id, r]) => [HUB_ROUTE_MASTER, id, r])
    .concat(parts(plant, Object.assign(b.customers, { builtAt: at }), ['customers', 'unrouted']).map(([id, r]) => [HUB_CUSTOMERS, id, r]));
  const batch = db.batch();
  writes.forEach(([col, id, r]) => batch.set(db.collection(col).doc(id), r));
  await batch.commit();
  return { plant, counts: b.routeMaster.counts, parts: writes.length };
}

/** Every plant the Customer List keeps a Route Master for. */
async function rebuildAll(db, stamp) {
  const [plants, weekly] = await Promise.all([db.collection(SOURCE).get(), db.collection(WEEKLY).get()]);
  const weeklyDocs = weekly.docs.map(d => Object.assign({ id: d.id }, d.data()));
  const out = [];
  for (const d of plants.docs) out.push(await rebuildPlant(db, d.id, stamp, weeklyDocs));
  return out;
}

module.exports = { branchOf, dcNameOf, build, caseColumns, parts, rebuildPlant, rebuildAll, HUB_ROUTE_MASTER, HUB_CUSTOMERS, SOURCE, WEEKLY };

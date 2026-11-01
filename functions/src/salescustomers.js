/*
 * The Sales app's customer list (Joe 11/1, mock-ups 1-3): which customers each route delivers to on each day, so a salesperson
 * can tap a route and a day to see every customer on it, or type a customer to see every day and route it gets a delivery.
 *
 * Where it comes from: the United Dairy Customer List app (udcl.js, the bridge), the one customer list. Joe 11/1: "we need to
 * remove that list from UDPO": Operations no longer takes its own upload; the Route Menu is imported in the Customer List app,
 * and a division not imported there has no customers in the Sales app yet. Lines with no route are kept as written; they show
 * under the customer with "No route" and are left out of the route list.
 *
 * Groups (Joe 11/1, mock-ups 4 and 5, his pick iz): every name starting with DQ is Dairy Queen; every other customer goes by the
 * Chain number in the file; no chain, or a chain with only one customer, = Independents (Joe 11/1: "they're called independents"). The file has chain numbers but no chain names, so the app guesses a name (the
 * word most of the chain's customers start with, or a few known ones) and an Administrator can rename any group on
 * Administration > Sales App. A rename is kept through new uploads (groupNames on the same document).
 *
 * Only the group names are kept here, at salesCustomers/<plant id>: { groupNames: { <group key>: name } } (the rows an older
 * upload left in the same document are no longer read). Read only by the server.
 */
'use strict';

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const COLLECTION = 'salesCustomers';

class SalesCustomersError extends Error { constructor(message) { super(message); this.code = 'BAD_REQUEST'; } }
const text = (v) => (v === null || v === undefined ? '' : String(v).trim());

const NO_GROUP = 'Independents';
// A few chains whose customers' names do not share a first word (Uniontown's Route Menu, 2025).
const KNOWN_CHAINS = { 415: "Kuhn's Market", 445: 'AG Schools', 446: 'Uniontown Schools', 28: "Shop 'n Save", 979: 'Healthcare centers', 428: 'Sunoco and A Plus' };
const KNOWN_WORDS = { WAL: 'Walmart', 'WAL-MART': 'Walmart', BFS: 'BFS Foods', KUHNS: "Kuhn's Market", HONEY: 'Honey Bear', HB: 'Honey Bear', GNAGEY: 'Gnagey', LH: 'LH Schools', GIANT: 'Giant Eagle', FAMILY: 'Family Dollar', ALDI: 'Aldi' };
const isDq = (name) => /^\.*DQ\b/i.test(name);
const firstWord = (name) => text(name).replace(/^\.+/, '').split(/[\s#\-/]+/)[0].replace(/[.`']/g, '').toUpperCase();
const title = (w) => w.charAt(0) + w.slice(1).toLowerCase();

/** Which group a line's customer is in: 'DQ', 'chain:<number>', or '' (no group). */
function groupKey(r) { return isDq(r.name) ? 'DQ' : r.chain ? 'chain:' + r.chain : ''; }

/** The app's guess at each group's name, from its customers' names. */
function guessNames(rows) {
  const members = {};
  rows.forEach(r => { const k = groupKey(r); if (k) (members[k] = members[k] || new Set()).add(r.account || r.name); });
  const names = {};
  const nameOf = {};
  rows.forEach(r => { nameOf[r.account || r.name] = r.name; });
  Object.keys(members).forEach(k => {
    if (k === 'DQ') { names[k] = 'Dairy Queen'; return; }
    const chain = k.slice(6), list = [...members[k]].map(id => nameOf[id]);
    if (KNOWN_CHAINS[chain]) { names[k] = KNOWN_CHAINS[chain]; return; }
    const count = {};
    list.forEach(n => { const w = firstWord(n); count[w] = (count[w] || 0) + 1; });
    const top = Object.keys(count).sort((a, b) => count[b] - count[a])[0] || '';
    names[k] = count[top] * 2 >= list.length ? (KNOWN_WORDS[top] || title(top)) : title(firstWord(list.sort()[0])) + ' and others';
  });
  return names;
}

/** Each group: its key, the name shown (renamed or guessed), the guess, how many customers. */
function groupsOf(rows, saved) {
  const guess = guessNames(rows), count = {}, seen = new Set();
  rows.forEach(r => { const id = r.account || r.name, k = groupKey(r); if (!k || seen.has(k + '|' + id)) return; seen.add(k + '|' + id); count[k] = (count[k] || 0) + 1; });
  // A chain with one customer is not much of a group: it shows under Independents.
  return Object.keys(count).filter(k => k === 'DQ' || count[k] > 1).map(k => ({ key: k, name: text(saved && saved[k]) || guess[k], guess: guess[k], count: count[k] }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function summary(rows) {
  return {
    count: rows.length,
    customers: new Set(rows.map(r => r.account || r.name)).size,
    routes: new Set(rows.map(r => r.route).filter(Boolean)).size,
    noRoute: rows.filter(r => !r.route).length
  };
}

/** A division's lines from the Customer List (null when it has none there), with the group names kept here. */
async function readList(db, plant) {
  const [udcl, s] = await Promise.all([require('./udcl').salesRows(db, plant), db.collection(COLLECTION).doc(plant).get()]);
  const groupNames = (s.exists && s.data().groupNames) || {};
  if (!udcl) return null;
  return { rows: udcl.rows, fileName: udcl.fileName || '', savedAt: udcl.savedAt || '', savedBy: udcl.savedBy || '', groupNames };
}

/** Administration > Sales App: each division's list in the Customer List (how many lines, last change, last import's file). */
async function adminView(db, plants) {
  const out = [];
  for (const p of plants) {
    const l = await readList(db, p.id);
    out.push(Object.assign({ id: p.id, name: p.name, fileName: l ? l.fileName : '', savedAt: l ? l.savedAt : '', savedBy: l ? l.savedBy : '', groups: l ? groupsOf(l.rows, l.groupNames) : [] }, summary(l ? l.rows : [])));
  }
  return { plants: out };
}

/** Renames a group (blank = back to the app's guess). */
async function adminRename(db, plants, email, input, stamp) {
  const plant = plants.find(p => p.id === text(input && input.plant));
  if (!plant) throw new SalesCustomersError('Pick the division.');
  const key = text(input && input.key), name = text(input && input.name).replace(/\s+/g, ' ').slice(0, 60);
  if (!/^(DQ|chain:[\w.-]{1,12})$/.test(key)) throw new SalesCustomersError('That group is not on the customer list.');
  await db.collection(COLLECTION).doc(plant.id).set({ groupNames: { [key]: name } }, { merge: true });
  return adminView(db, plants);
}

/** For the Sales app: the division's lines, sorted by name, then day of the week, each with its group's name. */
async function forSales(db, plant) {
  // Joe 11/1: the United Dairy Customer List is the one customer list; the Sales app reads only from it.
  const l = await readList(db, plant);
  if (!l) return { rows: [], savedAt: '' };
  const names = {};
  groupsOf(l.rows, l.groupNames).forEach(g => { names[g.key] = g.name; });
  const rows = l.rows.map(r => Object.assign({}, r, { group: names[groupKey(r)] || NO_GROUP })).sort((a, b) => a.name.localeCompare(b.name) || DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.route.localeCompare(b.route, undefined, { numeric: true }));
  return { rows, savedAt: l.savedAt };
}

module.exports = { summary, adminView, adminRename, forSales, groupKey, groupsOf, guessNames, NO_GROUP, SalesCustomersError, DAYS, COLLECTION };

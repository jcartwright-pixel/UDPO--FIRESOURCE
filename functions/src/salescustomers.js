/*
 * The Sales app's customer list (Joe 11/1, mock-ups 1-3): which customers each route delivers to on each day, so a salesperson
 * can tap a route and a day to see every customer on it, or type a customer to see every day and route it gets a delivery.
 *
 * Where it comes from: Joe's Route Menu workbook, its "Customer By Route" tab (DAY, ROUTE, Chain, Account, Name; one line per
 * customer per delivery day). An Administrator uploads the workbook on Administration > Sales App; the screen reads that tab and
 * sends the lines here. Joe 11/1: "I will update the customers, but this is what I have right now", so a new upload replaces
 * the whole list for that division. Lines with no route (12 Friday lines in the 2025 file) are kept as written; they show under
 * the customer with "No route" and are left out of the route list.
 *
 * Groups (Joe 11/1, mock-ups 4 and 5, his pick iz): every name starting with DQ is Dairy Queen; every other customer goes by the
 * Chain number in the file; no chain, or a chain with only one customer, = Independents (Joe 11/1: "they're called independents"). The file has chain numbers but no chain names, so the app guesses a name (the
 * word most of the chain's customers start with, or a few known ones) and an Administrator can rename any group on
 * Administration > Sales App. A rename is kept through new uploads (groupNames on the same document).
 *
 * Kept in the main database at salesCustomers/<plant id>: { rows: [{ day, route, account, chain, name }], fileName, savedAt, savedBy, groupNames: { <group key>: name } }.
 * One document per division (about 650 lines, far under the size limit). Read only by the server.
 */
'use strict';

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MAX_ROWS = 5000;
const COLLECTION = 'salesCustomers';

class SalesCustomersError extends Error { constructor(message) { super(message); this.code = 'BAD_REQUEST'; } }
const text = (v) => (v === null || v === undefined ? '' : String(v).trim());
// Excel gives numbers (803, 1196.0): keep them as plain words ("803", "1196").
const numText = (v) => { const t = text(v); return /^\d+\.0+$/.test(t) ? t.replace(/\.0+$/, '') : t; };
const dayOf = (v) => { const t = text(v).toUpperCase().slice(0, 3); return DAYS.includes(t) ? t : ''; };

/** The lines as sent by the screen, checked again here: a day and a name on every line; route, account and chain may be blank
 * (chain 0 in the file means none). */
function cleanRows(rows) {
  if (!Array.isArray(rows) || !rows.length) throw new SalesCustomersError('No customer lines were found in the file.');
  if (rows.length > MAX_ROWS) throw new SalesCustomersError('The file has more than ' + MAX_ROWS + ' customer lines.');
  const seen = new Set(), out = [];
  rows.forEach(r => {
    const chain = numText(r && r.chain).slice(0, 12);
    const x = { day: dayOf(r && r.day), route: numText(r && r.route).slice(0, 12), account: numText(r && r.account).slice(0, 20), chain: chain === '0' ? '' : chain, name: text(r && r.name).replace(/\s+/g, ' ').slice(0, 80) };
    if (!x.day || !x.name) return;
    const key = [x.day, x.route, x.account, x.name].join('|');
    if (seen.has(key)) return;
    seen.add(key);
    out.push(x);
  });
  if (!out.length) throw new SalesCustomersError('No customer lines were found in the file.');
  return out;
}

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

async function readList(db, plant) {
  const s = await db.collection(COLLECTION).doc(plant).get();
  if (!s.exists) return null;
  const d = s.data();
  return { rows: Array.isArray(d.rows) ? d.rows : [], fileName: d.fileName || '', savedAt: d.savedAt || '', savedBy: d.savedBy || '', groupNames: d.groupNames || {} };
}

/** Administration > Sales App: each division's list (how many lines, when, by whom, from which file). */
async function adminView(db, plants) {
  const out = [];
  for (const p of plants) {
    const l = await readList(db, p.id);
    out.push(Object.assign({ id: p.id, name: p.name, fileName: l ? l.fileName : '', savedAt: l ? l.savedAt : '', savedBy: l ? l.savedBy : '', groups: l ? groupsOf(l.rows, l.groupNames) : [] }, summary(l ? l.rows : [])));
  }
  return { plants: out };
}

/** Saves a division's whole list, replacing the one before. */
async function adminSave(db, plants, email, input, stamp) {
  const plant = plants.find(p => p.id === text(input && input.plant));
  if (!plant) throw new SalesCustomersError('Pick the division this customer list is for.');
  const rows = cleanRows(input && input.rows);
  // merge: the group names given on Administration stay; the lines are replaced whole.
  await db.collection(COLLECTION).doc(plant.id).set({ plant: plant.id, rows, fileName: text(input.fileName).slice(0, 120), savedAt: stamp, savedBy: email }, { merge: true });
  const s = summary(rows);
  return Object.assign(await adminView(db, plants), { message: 'Saved ' + s.customers + ' customers on ' + s.routes + ' routes for ' + plant.name + '.' });
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
  // Joe 11/1: the United Dairy Customer List is the one customer list. Once a plant has one there, the Sales app reads its lines
  // from it (udcl.js); the list uploaded here stays only for a plant with none, and its group names are kept either way.
  const udcl = await require('./udcl').salesRows(db, plant);
  const l0 = await readList(db, plant);
  const l = udcl ? { rows: udcl.rows, savedAt: udcl.savedAt, groupNames: (l0 && l0.groupNames) || {} } : l0;
  if (!l) return { rows: [], savedAt: '' };
  const names = {};
  groupsOf(l.rows, l.groupNames).forEach(g => { names[g.key] = g.name; });
  const rows = l.rows.map(r => Object.assign({}, r, { group: names[groupKey(r)] || NO_GROUP })).sort((a, b) => a.name.localeCompare(b.name) || DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.route.localeCompare(b.route, undefined, { numeric: true }));
  return { rows, savedAt: l.savedAt };
}

module.exports = { cleanRows, summary, adminView, adminSave, adminRename, forSales, groupKey, groupsOf, guessNames, NO_GROUP, SalesCustomersError, DAYS, COLLECTION };

/*
 * The Sales app's customer list (Joe 11/1, mock-ups 1-3): which customers each route delivers to on each day, so a salesperson
 * can tap a route and a day to see every customer on it, or type a customer to see every day and route it gets a delivery.
 *
 * Where it comes from (Joe 11/1: "remove the customer list from this ... our sales app needs to pull that information from
 * there. Any changes or ever, it goes through that."): only the United Dairy Customer List, Joe's separate Customers app
 * (udcl.js reads its records; Operations never changes them). This app keeps no customer list of its own any more and has no
 * upload; a division with nothing in the Customers app shows an empty list. The old upload (salesCustomers/<plant>) is left in
 * the database untouched and is no longer read.
 *
 * Groups (Joe 11/1, mock-ups 4 and 5, his pick iz; Joe 11/2: a group picked on the Customer List wins): every name starting with DQ is Dairy Queen; every other customer goes by the
 * Chain number on the Customer List; no chain, or a chain with only one customer, = Independents (Joe 11/1: "they're called
 * independents"). The list has chain numbers but no chain names, so the app guesses a name (the word most of the chain's
 * customers start with, or a few known ones).
 */
'use strict';

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const text = (v) => (v === null || v === undefined ? '' : String(v).trim());

const NO_GROUP = 'Independents';
// A few chains whose customers' names do not share a first word (Uniontown's Route Menu, 2025).
const KNOWN_CHAINS = { 415: "Kuhn's Market", 445: 'AG Schools', 446: 'Uniontown Schools', 28: "Shop 'n Save", 979: 'Healthcare centers', 428: 'Sunoco and A Plus' };
const KNOWN_WORDS = { WAL: 'Walmart', 'WAL-MART': 'Walmart', BFS: 'BFS Foods', KUHNS: "Kuhn's Market", HONEY: 'Honey Bear', HB: 'Honey Bear', GNAGEY: 'Gnagey', LH: 'LH Schools', GIANT: 'Giant Eagle', FAMILY: 'Family Dollar', ALDI: 'Aldi' };
const isDq = (name) => /^\.*DQ\b/i.test(name);
const firstWord = (name) => text(name).replace(/^\.+/, '').split(/[\s#\-/]+/)[0].replace(/[.`']/g, '').toUpperCase();
const title = (w) => w.charAt(0) + w.slice(1).toLowerCase();

/**
 * Which group a line's customer is in: 'group:<name>' when one was picked on the Customer List's Directory (Joe 11/2: "add one
 * more column for the grouping ... change it with a drop-down"), else 'DQ', 'chain:<number>', or '' (no group). Chain 0 is no
 * chain (Joe 11/2: the Customer List now shows a chain of 0 as 0).
 */
function groupKey(r) {
  const g = text(r.group);
  if (g) return 'group:' + g;
  const chain = text(r.chain);
  return isDq(r.name) ? 'DQ' : chain && chain !== '0' ? 'chain:' + chain : '';
}

/** The app's guess at each group's name, from its customers' names. */
function guessNames(rows) {
  const members = {};
  rows.forEach(r => { const k = groupKey(r); if (k) (members[k] = members[k] || new Set()).add(r.account || r.name); });
  const names = {};
  const nameOf = {};
  rows.forEach(r => { nameOf[r.account || r.name] = r.name; });
  Object.keys(members).forEach(k => {
    if (k === 'DQ') { names[k] = 'Dairy Queen'; return; }
    if (k.startsWith('group:')) { names[k] = k.slice(6); return; }
    const chain = k.slice(6), list = [...members[k]].map(id => nameOf[id]);
    if (KNOWN_CHAINS[chain]) { names[k] = KNOWN_CHAINS[chain]; return; }
    const count = {};
    list.forEach(n => { const w = firstWord(n); count[w] = (count[w] || 0) + 1; });
    const top = Object.keys(count).sort((a, b) => count[b] - count[a])[0] || '';
    names[k] = count[top] * 2 >= list.length ? (KNOWN_WORDS[top] || title(top)) : title(firstWord(list.sort()[0])) + ' and others';
  });
  return names;
}

/** Each group: its key, the name shown (the app's guess), how many customers. */
function groupsOf(rows) {
  const guess = guessNames(rows), count = {}, seen = new Set();
  rows.forEach(r => { const id = r.account || r.name, k = groupKey(r); if (!k || seen.has(k + '|' + id)) return; seen.add(k + '|' + id); count[k] = (count[k] || 0) + 1; });
  // A chain with one customer is not much of a group: it shows under Independents.
  // A group picked by hand on the Customer List is kept even with one customer.
  return Object.keys(count).filter(k => k === 'DQ' || k.startsWith('group:') || count[k] > 1).map(k => ({ key: k, name: guess[k], count: count[k] }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** For the Sales app: the division's lines from the Customers app, sorted by name, then day of the week, each with its group's name. */
async function forSales(db, plant) {
  const l = await require('./udcl').salesRows(db, plant);
  if (!l) return { rows: [], savedAt: '' };
  const names = {};
  groupsOf(l.rows).forEach(g => { names[g.key] = g.name; });
  const rows = l.rows.map(r => Object.assign({}, r, { group: names[groupKey(r)] || NO_GROUP })).sort((a, b) => a.name.localeCompare(b.name) || DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.route.localeCompare(b.route, undefined, { numeric: true }));
  return { rows, savedAt: l.savedAt };
}

module.exports = { forSales, groupKey, groupsOf, guessNames, NO_GROUP, DAYS };

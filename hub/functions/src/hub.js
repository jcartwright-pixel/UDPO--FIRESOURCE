/*
 * The United Dairy Hub (Joe 11-2-26): one place to sign in and open every app. It lives in the same Firebase project as
 * Operations, so the same United Dairy Google sign-in and the same Users list (users/<email>) decide who sees which tile.
 *
 * Each tile follows the rule its own app uses, so the hub never shows a tile the app would then refuse:
 *   Plant & Distribution (Operations)       every ACTIVE person on the Users list (Operations decides each screen itself)
 *   Customers & Routes (Customer List)      every ACTIVE person on the Users list (the same rule as customerList)
 *   Fuel Tracking (Fuel)                    Administrators only (the same rule as fuelApp)
 *   Employees & Compliance (UDMS)           Administrators for now: UDMS keeps its own access list and checks again
 *   Route & Trip Costs (Route Estimator)    Administrators only (the same rule as routeEstimator), like Fuel Tracking
 *   Route Cost Analysis                     Administrators only (the same rule as routeCost), like Fuel Tracking
 *   Customer Statements (Statement Center)  Administrators by default (Joe 11-7-26: "Let's add it in now"). It is an Apps Script
 *                                           app open to United Dairy accounts, so its tick only shows or hides the card
 * Joe 11-3-26 ("tick ... which apps each person is allowed to see and use ... pre-tick" what they have now): People & Access
 * can tick each app per person. Those ticks are kept in appAccess/<email> (not on the Users list, which is still copied from
 * the Users sheet and would lose them). With no ticks saved, a person has the rule above. Plant & Distribution always stays
 * on for an Enabled person (Operations decides each of its screens itself); Fuel Tracking, Customers & Routes and Route & Trip Costs
 * check the same ticks on their own servers; UDMS still checks its own list, so its tick only shows or hides the card.
 * Statement Center was left out on 11-2-26 ("I don't want to move the statement center to this yet"); Joe added it 11-7-26.
 * Ticks saved before an app was added say nothing about that app, so until that person's ticks are saved again the new
 * app follows the standard rule above (ADDED below); otherwise every administrator with saved ticks would lose the card.
 *
 * The addresses come from the project the server runs in: the practice copy (ud-distribution-sandbox) links to the practice
 * copies, the live one to the live apps. Employees & Compliance has its own practice copy (udms-sandbox, made-up people).
 * Joe 11-9-26 ("a sandbox check that it goes to a test version"): an app with no practice copy (Route & Trip Costs, the
 * Statement Center, the accident app) opens its live one from the practice hub, and its card says so (LIVE_ONLY).
 * test/practice-links.cjs opens every practice card's address after each practice deploy.
 */
'use strict';

const ADMIN_ROLES = ['ADMINISTRATOR', 'ADMIN'];
// Joe 11-2-26: the old Apps Script address opens "Sorry, unable to open the file"; UDMS now runs on its own Firebase site.
const UDMS_URL = 'https://udms-bfccd.web.app/';
// Joe 11-9-26: the practice hub's Employees & Compliance card opens UDMS's practice copy (made-up people), not the live one.
const UDMS_PRACTICE_URL = 'https://udms-sandbox.web.app/';
// Joe 11-6-26: the Accident & Injury Reporting app on the hub too; it has one address (its own Firebase site).
const ACCIDENT_URL = 'https://united-dairy-accident-app.web.app/';
// Joe 11-7-26: the Statement Center (repo united-dairy-statement-center) is an Apps Script web app with one address for
// every location (the location is picked inside it; Uniontown first).
const STATEMENTS_URL = 'https://script.google.com/a/macros/uniteddairy.com/s/AKfycbyMvVPx0RDcDeP_OXe0kmYo3XWBYA7hQzBGgTecCn10wpszalEtyVoXLYmFMsVgnzz5/exec';

class HubError extends Error { constructor(code, message) { super(message); this.code = code; } }

const roleKey = (r) => String(r || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
const isActive = (p) => !!(p && String(p.status || '').trim().toUpperCase() === 'ACTIVE');
const isAdmin = (p) => isActive(p) && (p.roles || []).some(r => ADMIN_ROLES.indexOf(roleKey(r)) >= 0);
const safeIdPart = (value) => String(value || '').trim().replace(/[\/\s]+/g, '_').replace(/[^A-Za-z0-9_.@\-|]/g, '').slice(0, 200);

/** The apps, in the order the tiles show. */
const isPractice = (project) => /-sandbox$/.test(String(project || ''));
// What a practice-hub card adds when it can only open the live app.
const LIVE_ONLY = '. It has no practice copy yet, so this opens the live one.';
// The apps with no practice copy: the practice hub opens the live address and says so.
const NO_PRACTICE = { routes: 'https://ud-distribution-routes.web.app/', statements: null, accident: null };

function apps(project) {
  const site = (s) => 'https://' + project + (s ? '-' + s : '') + '.web.app/';
  return [
    // Joe 11-2-26: "All of them need to be named for what they do" (not Operations, UDMS...).
    { key: 'operations', name: 'Plant & Distribution', note: 'Dispatch, the plant floor, fleet, schedules and plant reports', url: site(''), may: isActive },
    { key: 'customers', name: 'Customers & Routes', note: 'Every customer, delivery route and day, the route book and truck load maps', url: site('customers'), may: isActive },
    { key: 'fuel', name: 'Fuel Tracking', note: 'Monthly fuel use, fuel prices, tank deliveries and trip fuel', url: site('fuel'), may: isAdmin },
    { key: 'udms', name: 'Employees & Compliance', note: "Employee records, driver qualification, accidents, workers' comp and hiring", url: isPractice(project) ? UDMS_PRACTICE_URL : UDMS_URL, may: isAdmin },
    // Joe 11-5-26: the Route & Trip Estimator moved off ChatGPT into this project; its PC Miler key is on Keys & Connections.
    { key: 'routes', name: 'Route & Trip Costs', note: 'Round-trip cost for a delivery or plant transfer, with PC Miler truck miles and tolls', url: site('routes'), may: isAdmin },
    // Joe 11-6-26: route cost analysis as its own app (united-dairy-route-cost), linked from the hub.
    { key: 'routecost', name: 'Route Cost Analysis', note: 'Monthly delivery cost by route and stop: cost per case, per stop and per day on the road', url: site('route-cost'), may: isAdmin },
    { key: 'statements', name: 'Customer Statements', note: 'Email, mail and print customer statements for every location, and keep the statement customer list', url: STATEMENTS_URL, may: isAdmin },
    // Joe 11-6-26: "You don't have the link to the accident app." Anyone enabled can report an accident or injury.
    { key: 'accident', name: 'Accident & Injury Reporting', note: 'Report an accident or injury from a phone, tablet or computer', url: ACCIDENT_URL, may: isActive }
  ];
}

const CHANGE_OPS = { sendChange: 'any', withdrawChange: 'any', changeStatus: 'any', customerChanges: 'admin', approveChange: 'admin', turnDownChange: 'admin' };

const APP_KEYS = ['operations', 'customers', 'fuel', 'udms', 'routes', 'routecost', 'statements', 'accident'];
const ALWAYS = 'operations';
// When an app joined the hub after per-person ticks started (11-3-26): ticks saved before this day follow the standard rule
// for it until they are saved again.
const ADDED = { statements: '2026-11-07T00:00:00Z' };

/** Saved ticks with any app added since they were saved filled in by the standard rule. */
function withAdded(person, saved) {
  if (!saved || !Array.isArray(saved.apps)) return null;
  const when = String(saved.updatedAt || '');
  const add = Object.keys(ADDED).filter(k => saved.apps.indexOf(k) < 0 && !(when >= ADDED[k]) && apps('x').find(a => a.key === k).may(person));
  return add.length ? APP_KEYS.filter(k => saved.apps.indexOf(k) >= 0 || add.indexOf(k) >= 0) : saved.apps;
}

/** The apps a person may open: their saved ticks, or the rule above when none are saved. Plant & Distribution always. */
function appsOf(person, ticks) {
  if (!isActive(person)) return [];
  if (!Array.isArray(ticks)) return apps('x').filter(a => a.may(person)).map(a => a.key);
  return APP_KEYS.filter(k => k === ALWAYS || ticks.indexOf(k) >= 0);
}

async function personOf(db, email) {
  const s = await db.collection('users').doc(safeIdPart(email)).get();
  return s.exists ? s.data() : null;
}
async function ticksOf(db, email, person) {
  const s = await db.collection('appAccess').doc(safeIdPart(email)).get();
  return s.exists ? withAdded(person, s.data()) : null;
}

/**
 * input.op: home (the tiles this person may open); appAccess (administrators: every person's saved ticks);
 * setApps (administrators: {email, apps} saves one person's ticks); the customer list's door (src/changes.js): sendChange,
 * withdrawChange, changeStatus (anyone active), customerChanges, approveChange, turnDownChange (administrators).
 */
async function hubCall(db, user, input, options) {
  const op = String((input || {}).op || 'home');
  const email = String(user.email || '').toLowerCase();
  const person = await personOf(db, email);
  if (!isActive(person)) throw new HubError('NOT_ALLOWED', 'You are not on the Users list. Ask an administrator to add you.');
  if (op === 'home') {
    const project = (options && options.project) || process.env.GCLOUD_PROJECT || 'demo-ud-distribution';
    const mine = appsOf(person, await ticksOf(db, email, person));
    const tiles = [];
    apps(project).filter(a => mine.indexOf(a.key) >= 0).forEach(({ key, name, note, url }) => {
      // Joe 11-5-26 ("another card just for distribution. One for plant, one for distribution"): Plant & Distribution is two
      // cards, each opening its own side of the app (the same two cards as the app's own Home, group.html).
      if (key === 'operations') {
        tiles.push({ key: 'plant', name: 'Plant Operations', note: 'Production, the plant floor, loadout, quality, inventory and plant reports', url: url + 'group.html?g=plantops' });
        tiles.push({ key: 'distribution', name: 'Route Distribution', note: 'Dispatch, the weekly schedule, drivers, trucks, fleet and the garage', url: url + 'group.html?g=routeops' });
      } else if (isPractice(project) && key in NO_PRACTICE) {
        // Route & Trip Costs (11-5-26: its repository has no practice deploy key), the Statement Center and the accident app
        // have no practice copy, so the practice hub opens the live one and says so, instead of a Site Not Found page.
        tiles.push({ key, name, note: note + LIVE_ONLY, url: NO_PRACTICE[key] || url, live: true });
      } else tiles.push({ key, name, note, url });
    });
    const ops = apps(project)[0];
    if (mine.indexOf(ops.key) >= 0) {
      // Joe 11-10-26 ("a card for the sales ... a link that goes directly to that app"): the salespeople's own phone app
      // (UD Sales, Operations' sales.html). Any United Dairy account may open it and it only shows, so it has no tick.
      tiles.push({ key: 'sales', name: 'Sales App', note: 'The salespeople\'s own app: where every route is now and the customers on each route. It only shows; nothing changes', url: ops.url + 'sales.html' });
    }
    return { name: String(person.name || person.displayName || '').trim(), admin: isAdmin(person), tiles };
  }
  // The route customer list's one door (Joe 11-9-26, src/changes.js): any app sends, administrators approve in the Hub.
  if (CHANGE_OPS[op]) {
    if (CHANGE_OPS[op] === 'admin' && !isAdmin(person)) throw new HubError('NOT_ALLOWED', 'Only an administrator can approve or turn down changes to the customer list.');
    const C = require('./changes'), stamp = new Date().toISOString();
    try {
      if (op === 'sendChange') return await C.sendChange(db, email, input, stamp);
      if (op === 'withdrawChange') return await C.withdraw(db, email, input, isAdmin(person), stamp);
      if (op === 'changeStatus') return await C.changeStatus(db, input);
      if (op === 'customerChanges') return await C.listChanges(db, input);
      return await C.decide(db, email, input, op === 'approveChange', stamp);
    } catch (err) {
      if (err instanceof C.ChangeError) throw new HubError(err.code, err.message);
      throw err;
    }
  }
  if (!isAdmin(person)) throw new HubError('NOT_ALLOWED', 'Only an administrator can change who opens which app.');
  if (op === 'appAccess') {
    const snap = await db.collection('appAccess').get();
    const saved = {};
    for (const d of snap.docs) {
      const v = d.data();
      if (!Array.isArray(v.apps)) continue;
      const stale = Object.keys(ADDED).some(k => v.apps.indexOf(k) < 0 && !(String(v.updatedAt || '') >= ADDED[k]));
      saved[d.id] = stale ? withAdded(await personOf(db, d.id), v) || v.apps : v.apps;
    }
    return { saved };
  }
  if (op === 'setApps') {
    const target = String(input.email || '').trim().toLowerCase();
    const want = Array.isArray(input.apps) ? [...new Set(input.apps.map(String))] : null;
    if (!want || want.some(k => APP_KEYS.indexOf(k) < 0)) throw new HubError('BAD_REQUEST', 'Those apps could not be read. Reload the page and tick them again.');
    const ticks = APP_KEYS.filter(k => k === ALWAYS || want.indexOf(k) >= 0);
    if (target === email && APP_KEYS.some(k => ticks.indexOf(k) < 0)) throw new HubError('NOT_ALLOWED', 'You cannot take apps away from yourself. Ask another administrator.');
    const ref = db.collection('appAccess').doc(safeIdPart(target));
    const stamp = new Date().toISOString();
    return db.runTransaction(async tx => {
      const [them, was] = await Promise.all([tx.get(db.collection('users').doc(safeIdPart(target))), tx.get(ref)]);
      if (!them.exists) throw new HubError('NOT_FOUND', target + ' is not on the Users list. Reload the page.');
      tx.set(ref, { apps: ticks, updatedAt: stamp, updatedBy: email });
      tx.set(db.collection('actions').doc('hub-' + require('crypto').randomBytes(8).toString('hex')), { action: 'setApps', by: email, at: stamp, person: target,
        before: was.exists ? was.data().apps || null : null, after: ticks });
      return { ok: true, email: target, apps: ticks };
    });
  }
  throw new HubError('BAD_REQUEST', 'Unknown request.');
}

module.exports = { hubCall, HubError, apps, appsOf, withAdded, APP_KEYS, ADDED, isActive, isAdmin, UDMS_URL, UDMS_PRACTICE_URL, STATEMENTS_URL, LIVE_ONLY, isPractice };

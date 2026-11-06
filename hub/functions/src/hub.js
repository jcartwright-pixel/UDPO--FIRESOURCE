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
 * Joe 11-3-26 ("tick ... which apps each person is allowed to see and use ... pre-tick" what they have now): People & Access
 * can tick each app per person. Those ticks are kept in appAccess/<email> (not on the Users list, which is still copied from
 * the Users sheet and would lose them). With no ticks saved, a person has the rule above. Plant & Distribution always stays
 * on for an Enabled person (Operations decides each of its screens itself); Fuel Tracking, Customers & Routes and Route & Trip Costs
 * check the same ticks on their own servers; UDMS still checks its own list, so its tick only shows or hides the card.
 * Statement Center is left out until Joe says (11-2-26: "I don't want to move the statement center to this yet").
 *
 * The addresses come from the project the server runs in: the practice copy (ud-distribution-sandbox) links to the practice
 * copies, the live one to the live apps. UDMS has one address.
 */
'use strict';

const ADMIN_ROLES = ['ADMINISTRATOR', 'ADMIN'];
// Joe 11-2-26: the old Apps Script address opens "Sorry, unable to open the file"; UDMS now runs on its own Firebase site.
const UDMS_URL = 'https://udms-bfccd.web.app/';

class HubError extends Error { constructor(code, message) { super(message); this.code = code; } }

const roleKey = (r) => String(r || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
const isActive = (p) => !!(p && String(p.status || '').trim().toUpperCase() === 'ACTIVE');
const isAdmin = (p) => isActive(p) && (p.roles || []).some(r => ADMIN_ROLES.indexOf(roleKey(r)) >= 0);
const safeIdPart = (value) => String(value || '').trim().replace(/[\/\s]+/g, '_').replace(/[^A-Za-z0-9_.@\-|]/g, '').slice(0, 200);

/** The apps, in the order the tiles show. */
function apps(project) {
  const site = (s) => 'https://' + project + (s ? '-' + s : '') + '.web.app/';
  return [
    // Joe 11-2-26: "All of them need to be named for what they do" (not Operations, UDMS...).
    { key: 'operations', name: 'Plant & Distribution', note: 'Dispatch, the plant floor, fleet, schedules and plant reports', url: site(''), may: isActive },
    { key: 'customers', name: 'Customers & Routes', note: 'Every customer, delivery route and day, the route book and truck load maps', url: site('customers'), may: isActive },
    { key: 'fuel', name: 'Fuel Tracking', note: 'Monthly fuel use, fuel prices, tank deliveries and trip fuel', url: site('fuel'), may: isAdmin },
    { key: 'udms', name: 'Employees & Compliance', note: "Employee records, driver qualification, accidents, workers' comp and hiring", url: UDMS_URL, may: isAdmin },
    // Joe 11-5-26: the Route & Trip Estimator moved off ChatGPT into this project; its PC Miler key is on Keys & Connections.
    { key: 'routes', name: 'Route & Trip Costs', note: 'Round-trip cost for a delivery or plant transfer, with PC Miler truck miles and tolls', url: site('routes'), may: isAdmin }
  ];
}

const APP_KEYS = ['operations', 'customers', 'fuel', 'udms', 'routes'];
const ALWAYS = 'operations';

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
async function ticksOf(db, email) {
  const s = await db.collection('appAccess').doc(safeIdPart(email)).get();
  return s.exists && Array.isArray(s.data().apps) ? s.data().apps : null;
}

/**
 * input.op: home (the tiles this person may open); appAccess (administrators: every person's saved ticks);
 * setApps (administrators: {email, apps} saves one person's ticks).
 */
async function hubCall(db, user, input, options) {
  const op = String((input || {}).op || 'home');
  const email = String(user.email || '').toLowerCase();
  const person = await personOf(db, email);
  if (!isActive(person)) throw new HubError('NOT_ALLOWED', 'You are not on the Users list. Ask an administrator to add you.');
  if (op === 'home') {
    const project = (options && options.project) || process.env.GCLOUD_PROJECT || 'demo-ud-distribution';
    const mine = appsOf(person, await ticksOf(db, email));
    const tiles = [];
    apps(project).filter(a => mine.indexOf(a.key) >= 0).forEach(({ key, name, note, url }) => {
      // Joe 11-5-26 ("another card just for distribution. One for plant, one for distribution"): Plant & Distribution is two
      // cards, each opening its own side of the app (the same two cards as the app's own Home, group.html).
      if (key === 'operations') {
        tiles.push({ key: 'plant', name: 'Plant Operations', note: 'Production, the plant floor, loadout, quality, inventory and plant reports', url: url + 'group.html?g=plantops' });
        tiles.push({ key: 'distribution', name: 'Route Distribution', note: 'Dispatch, the weekly schedule, drivers, trucks, fleet and the garage', url: url + 'group.html?g=routeops' });
      } else if (key === 'routes' && /-sandbox$/.test(project)) {
        // Route & Trip Costs has no practice copy yet (11-5-26: its repository has no practice deploy key), so the practice
        // hub opens the live one and says so, instead of a Site Not Found page.
        tiles.push({ key, name, note: note + '. It has no practice copy yet, so this opens the live one.', url: 'https://ud-distribution-routes.web.app/' });
      } else tiles.push({ key, name, note, url });
    });
    return { name: String(person.name || person.displayName || '').trim(), admin: isAdmin(person), tiles };
  }
  if (!isAdmin(person)) throw new HubError('NOT_ALLOWED', 'Only an administrator can change who opens which app.');
  if (op === 'appAccess') {
    const snap = await db.collection('appAccess').get();
    const saved = {};
    snap.docs.forEach(d => { if (Array.isArray(d.data().apps)) saved[d.id] = d.data().apps; });
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

module.exports = { hubCall, HubError, apps, appsOf, APP_KEYS, isActive, isAdmin, UDMS_URL };

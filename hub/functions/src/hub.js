/*
 * The United Dairy Hub (Joe 11-2-26): one place to sign in and open every app. It lives in the same Firebase project as
 * Operations, so the same United Dairy Google sign-in and the same Users list (users/<email>) decide who sees which tile.
 *
 * Each tile follows the rule its own app uses, so the hub never shows a tile the app would then refuse:
 *   Plant & Distribution (Operations)       every ACTIVE person on the Users list (Operations decides each screen itself)
 *   Customers & Routes (Customer List)      every ACTIVE person on the Users list (the same rule as customerList)
 *   Fuel Tracking (Fuel)                    Administrators only (the same rule as fuelApp)
 *   Employees & Compliance (UDMS)           Administrators for now: UDMS keeps its own access list and checks again
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
    { key: 'udms', name: 'Employees & Compliance', note: "Employee records, driver qualification, accidents, workers' comp and hiring", url: UDMS_URL, may: isAdmin }
  ];
}

async function personOf(db, email) {
  const s = await db.collection('users').doc(safeIdPart(email)).get();
  return s.exists ? s.data() : null;
}

/** input.op: home (the tiles this person may open). */
async function hubCall(db, user, input, options) {
  const op = String((input || {}).op || 'home');
  if (op !== 'home') throw new HubError('BAD_REQUEST', 'Unknown request.');
  const person = await personOf(db, user.email);
  if (!isActive(person)) throw new HubError('NOT_ALLOWED', 'You are not on the Users list. Ask an administrator to add you.');
  const project = (options && options.project) || process.env.GCLOUD_PROJECT || 'demo-ud-distribution';
  const tiles = apps(project).filter(a => a.may(person)).map(({ key, name, note, url }) => ({ key, name, note, url }));
  return { name: String(person.name || person.displayName || '').trim(), admin: isAdmin(person), tiles };
}

module.exports = { hubCall, HubError, apps, isActive, isAdmin, UDMS_URL };

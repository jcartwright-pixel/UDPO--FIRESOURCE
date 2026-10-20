/*
 * Administration (Joe 10/10): the current app's Administration items, rebuilt for the new app. One server call, `admin`,
 * {op, ...}; Administrators only. Everything here is kept in Operations's database (never readable by the screens
 * directly: the collections below are server-only in firestore.rules), except People & Roles, which also writes the
 * sandbox copy of the Users list through the master write-back (masterwrite.js; production sheets are refused there).
 *
 *   People & Roles        people, savePerson             USERS_MASTER row + personRights/{email} (Allow / Deny)
 *   Role Templates        roleTemplates, saveRoleTemplate private/roleTemplates
 *   Access & QR Codes     accessLinks, accessGenerate, accessRevoke, accessEmail      personAccess/{email}
 *   Driver Station Codes  appLinks, routeCodeNew, routeCodeOnOff                       config/routePhone (phone.js)
 *   Manager Links         releaseCodes, releaseCodeNew                                 private/releaseCodes
 *   Report Recipients     reportGroups, saveReportGroup                                reportGroups/{id}
 *   Sent Email Log        sentLog, setSending, setForecastEmail                        sentEmails, private/emailSettings
 *   Email Senders         emailSenders, saveEmailSenders                               private/emailSettings (senders, fromWho)
 *   Remaining Repairs     repairItems, saveRepairItem, completeRepairItem              repairItems/{id}
 * The email, schedule and diagnostics items are in admintools.js.
 */
'use strict';

const crypto = require('crypto');
const L = require('./logic');
const M = require('./model');
const FAILS = require('./fails');
const R = require('./rights');
const { queueMaster } = require('./masterwrite');
const { appMail, emailSettings, ourAddress, DOMAIN } = require('./adminmail');
const { addresses } = require('./mail');
const STATIONS = require('./stations');

class AdminError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const fail = (code, message) => { throw new AdminError(code, message); };

const EMAIL = /^[^\s@<>(),;:"[\]\\]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const text = (v, max) => String(v === null || v === undefined ? '' : v).trim().slice(0, max || 200);
const newCode = () => crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
const normCode = (v) => String(v || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
const hash = (salt, code) => crypto.createHash('sha256').update(salt + '|' + code).digest('base64url');
const sameHash = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const plantName = (id) => (L.PLANTS.find(p => p.id === id) || {}).name || id;
const activePlants = () => L.PLANTS.filter(p => p.status === 'ACTIVE');
const prettyRole = (r) => String(r).charAt(0) + String(r).slice(1).toLowerCase().replace(/_/g, ' ');

async function personOf(db, email) {
  const snap = await db.collection(M.COLLECTIONS.users).doc(M.safeIdPart(email)).get();
  return snap.exists ? snap.data() : null;
}
async function requireAdmin(db, user) {
  const email = String(user && user.email || '').toLowerCase();
  const person = await personOf(db, email);
  if (!person || person.status !== 'ACTIVE' || !L.isAdmin(person)) fail('NOT_ALLOWED', 'Only an administrator can use Administration');
  return email;
}
async function templatesOf(db) {
  const d = (await db.collection('private').doc('roleTemplates').get()).data() || {};
  // Roles added in Administration (Add Role) live next to the standard ones.
  const custom = (d.customRoles || []).filter(r => R.ROLES.indexOf(r) < 0);
  return { templates: d.templates || {}, meta: d.meta || {}, custom, roles: R.ROLES.concat(custom) };
}

/* ---------- People & Roles ---------- */

function personRevision(p, ex) {
  return crypto.createHash('sha256').update(JSON.stringify([p ? [p.name || '', p.status || '', (p.roles || []).slice().sort(), (p.facilities || []).slice().sort()] : null,
    ex ? [(ex.grants || []).slice().sort(), (ex.denials || []).slice().sort()].concat(ex.screenAccess ? [ex.screenAccess] : []) : null])).digest('hex').slice(0, 16);
}

async function people(db) {
  const [snap, rights, tpl] = await Promise.all([db.collection(M.COLLECTIONS.users).get(), db.collection('personRights').get(), templatesOf(db)]);
  const ex = {};
  rights.docs.forEach(d => { ex[d.id] = d.data(); });
  const list = snap.docs.map(d => {
    const p = d.data(), e = ex[d.id] || null;
    return { email: d.id, name: p.name || '', status: p.status || '', roles: p.roles || [], facilities: p.facilities || [], grants: e ? e.grants || [] : [], denials: e ? e.denials || [] : [],
      screenAccess: e && e.screenAccess ? e.screenAccess : null, updatedAt: (e && e.updatedAt) || (p.cells && p.cells.updated_at) || '', updatedBy: (e && e.updatedBy) || (p.cells && p.cells.updated_by) || '', primary: L.PRIMARY_ADMINS.indexOf(d.id) >= 0,
      revision: personRevision(p, e), rights: R.effectiveRights(p, tpl.templates, e) };
  });
  return { people: list, catalog: R.CATALOG, screenAreas: L.SCREEN_AREAS, screenJobs: L.SCREEN_JOBS, roles: tpl.roles, defaults: R.DEFAULTS, templates: tpl.templates, plants: L.PLANTS, newRevision: personRevision(null, null) };
}

// The sandbox's own Users sheet copy (WRITEBACK_JSON.masters.users, a copy, never the real Users sheet): People & Roles
// saves reach it whether or not the dispatch write-back switch is on (Joe 10/10: saving a person must just work there).
function usersCopy(env) {
  if (!env || !env.WRITEBACK_JSON || env.DEMO_DATA === '1') return false;
  try { const t = JSON.parse(env.WRITEBACK_JSON).masters || {}; return !!(t.users && t.users.spreadsheetId); } catch (e) { return false; }
}

async function savePerson(db, email, input, stamp, deps) {
  const target = text(input.email, 254).toLowerCase();
  if (!EMAIL.test(target)) fail('BAD_REQUEST', 'Enter a display name and valid email.');
  if (!target.endsWith('@' + 'uniteddairy.com')) fail('BAD_REQUEST', 'Only a United Dairy email address can sign in.');
  const name = text(input.name, 120);
  if (!name || /^[=+@-]/.test(name)) fail('BAD_REQUEST', 'Enter a display name and valid email (a name cannot start with = + @ or -).');
  const roles = [...new Set((Array.isArray(input.roles) ? input.roles : []).map(R.normRole))];
  const known = (await templatesOf(db)).roles;
  if (!roles.length || roles.some(r => known.indexOf(r) < 0)) fail('BAD_REQUEST', 'Pick a role.');
  const status = String(input.status || '').toUpperCase();
  if (['ACTIVE', 'INACTIVE'].indexOf(status) < 0) fail('BAD_REQUEST', 'Account status must be Enabled or Disabled.');
  const facilities = [...new Set((Array.isArray(input.facilities) ? input.facilities : []).map(String))];
  if (facilities.indexOf('*') >= 0 && facilities.length > 1) fail('BAD_REQUEST', 'All locations stands alone.');
  if (facilities.some(f => f !== '*' && !L.PLANTS.some(p => p.id === f))) fail('BAD_REQUEST', 'Unknown location.');
  const grants = [...new Set(input.grants || [])], denials = [...new Set(input.denials || [])];
  if (grants.concat(denials).some(c => R.ASSIGNABLE.indexOf(c) < 0 && c !== 'audit.read')) fail('BAD_REQUEST', 'That right cannot be given to one person (Administrator only).');
  if (grants.some(c => denials.indexOf(c) >= 0)) fail('BAD_REQUEST', 'A right cannot be both Allow and Deny.');
  const admin = roles.indexOf('ADMINISTRATOR') >= 0;
  if (admin && (grants.length || denials.length)) fail('BAD_REQUEST', 'An Administrator has every right; take the exceptions off first (Use Role Defaults).');
  // Joe 10/14: the screens this person may see, ticked per plant (left out = unchanged; null = every screen their role allows).
  const screenAccess = R.cleanScreenAccess(input.screenAccess, L.PLANTS.map(p => p.id));
  if (screenAccess === undefined && input.screenAccess !== undefined) fail('BAD_REQUEST', 'The ticked screens could not be read. Reload this person and tick them again.');
  if (L.PRIMARY_ADMINS.indexOf(target) >= 0 && (!admin || status !== 'ACTIVE')) fail('NOT_ALLOWED', 'The primary administrator must stay an Administrator and Enabled.');
  if (target === email && (!admin || status !== 'ACTIVE')) fail('NOT_ALLOWED', 'You cannot remove your own Administrator role or disable yourself. Use another administrator to change this account.');

  return db.runTransaction(async tx => {
    const ref = db.collection(M.COLLECTIONS.users).doc(M.safeIdPart(target)), exRef = db.collection('personRights').doc(M.safeIdPart(target));
    const [snap, exSnap, cfg] = await Promise.all([tx.get(ref), tx.get(exRef), tx.get(db.collection(M.COLLECTIONS.config).doc('app'))]);
    const before = snap.exists ? snap.data() : null, exBefore = exSnap.exists ? exSnap.data() : null;
    if (input.isNew && before) fail('CHANGED', target + ' is already on the Users list; pick them on the left.');
    if (!input.isNew && !before) fail('NOT_FOUND', target + ' is not on the Users list; reload.');
    if (String(input.revision || '') !== personRevision(before, exBefore)) fail('CHANGED', 'Someone changed this person since you opened them. Reload this person before saving.');
    // The Users list is a sheet: the change must reach the sheet copy, or the next copy from the sheet would undo it.
    const c = cfg.exists ? cfg.data() : {};
    const mode = { writeBack: !!(c.writeBack && c.writeBack.enabled === true) || usersCopy(deps && deps.env) };
    if (!mode.writeBack) fail('NOT_ALLOWED', 'This change was not saved: the Users sheet cannot be updated from here yet. Turn the write-back on (Route Distribution page) and save again.');
    const id = before && before.cells && before.cells.id ? before.cells.id : 'usr_' + crypto.randomBytes(10).toString('hex');
    const version = Number(before && before.cells && before.cells.version || 0) + 1;
    const fields = { name, status, roles, facilities: admin && facilities.length === 0 ? ['*'] : facilities, 'cells.version': String(version) };
    if (!before) Object.assign(fields, { 'cells.id': id, 'cells.created_at': stamp, 'cells.created_by': email });
    tx.set(ref, { name, status, roles, facilities: fields.facilities, updatedAt: stamp, updatedBy: email, cells: Object.assign({}, before ? before.cells : {}, { email: target, id }) }, { merge: true });
    const keepScreens = input.screenAccess === undefined ? (exBefore && exBefore.screenAccess) || null : admin ? null : screenAccess;
    tx.set(exRef, { grants, denials, screenAccess: keepScreens, updatedAt: stamp, updatedBy: email });
    queueMaster(tx, db, mode, 'person-' + crypto.randomBytes(8).toString('hex'), '', ref, target, fields, !before, stamp, email, 'users');
    tx.set(db.collection(M.COLLECTIONS.actions).doc('adm-' + crypto.randomBytes(8).toString('hex')), { action: 'savePerson', by: email, at: stamp, person: target,
      before: before ? { name: before.name, status: before.status, roles: before.roles, facilities: before.facilities, grants: exBefore ? exBefore.grants : [], denials: exBefore ? exBefore.denials : [], screenAccess: exBefore ? exBefore.screenAccess || null : null } : null,
      after: { name, status, roles, facilities: fields.facilities, grants, denials, screenAccess: keepScreens } });
    return { ok: true, message: 'Person access saved.', email: target };
  });
}

/* ---------- Role Templates ---------- */

async function saveRoleTemplate(db, email, input, stamp) {
  const role = R.normRole(input.role);
  if ((await templatesOf(db)).roles.indexOf(role) < 0) fail('BAD_REQUEST', 'Pick a role.');
  if (role === 'ADMINISTRATOR') fail('NOT_ALLOWED', 'Administrator has protected full access. Assign or remove that role on the person instead.');
  const rights = [...new Set(input.rights || [])];
  if (rights.some(c => R.ASSIGNABLE.indexOf(c) < 0 && c !== 'audit.read')) fail('BAD_REQUEST', 'That right cannot go in a role template (Administrator only).');
  const ref = db.collection('private').doc('roleTemplates');
  return db.runTransaction(async tx => {
    const d = (await tx.get(ref)).data() || {}, templates = Object.assign({}, d.templates || {}), meta = Object.assign({}, d.meta || {});
    const now = R.templateFor(role, templates);
    if (JSON.stringify((input.expected || []).slice().sort()) !== JSON.stringify(now.slice().sort())) fail('CHANGED', 'Someone changed this role since you opened it. Reload before saving.');
    const ordered = R.CATALOG.map(c => c.code).filter(c => rights.indexOf(c) >= 0);
    // Back to exactly the role's defaults: the saved template goes, so nothing about the role differs from before.
    if (JSON.stringify(ordered) === JSON.stringify(R.CATALOG.map(c => c.code).filter(c => (R.DEFAULTS[role] || []).indexOf(c) >= 0))) delete templates[role];
    else templates[role] = ordered;
    meta[role] = { updatedAt: stamp, updatedBy: email };
    tx.set(ref, { templates, meta });
    tx.set(db.collection(M.COLLECTIONS.actions).doc('adm-' + crypto.randomBytes(8).toString('hex')), { action: 'saveRoleTemplate', by: email, at: stamp, role, before: now, after: ordered });
    return { ok: true, message: 'Role template saved.' };
  });
}

// Add Role (Joe 10/10): a new role with its rights; people can then be given it in People & Roles.
async function addRole(db, email, input, stamp) {
  const label = text(input.name, 40);
  const role = R.normRole(label).replace(/[^A-Z0-9_]/g, '');
  if (!role || role.length < 3) fail('BAD_REQUEST', 'Type the new role\'s name (at least 3 letters).');
  const rights = [...new Set(input.rights || [])];
  if (rights.some(c => R.ASSIGNABLE.indexOf(c) < 0 && c !== 'audit.read')) fail('BAD_REQUEST', 'That right cannot go in a role (Administrator only).');
  const ref = db.collection('private').doc('roleTemplates');
  return db.runTransaction(async tx => {
    const d = (await tx.get(ref)).data() || {};
    const customRoles = (d.customRoles || []).slice();
    if (R.ROLES.indexOf(role) >= 0 || role === 'ADMIN' || customRoles.indexOf(role) >= 0) fail('CHANGED', prettyRole(role) + ' is already a role.');
    customRoles.push(role);
    const templates = Object.assign({}, d.templates || {}, { [role]: R.CATALOG.map(c => c.code).filter(c => rights.indexOf(c) >= 0) });
    const meta = Object.assign({}, d.meta || {}, { [role]: { updatedAt: stamp, updatedBy: email, addedAt: stamp } });
    tx.set(ref, { templates, meta, customRoles });
    tx.set(db.collection(M.COLLECTIONS.actions).doc('adm-' + crypto.randomBytes(8).toString('hex')), { action: 'addRole', by: email, at: stamp, role, after: templates[role] });
    return { ok: true, role, message: prettyRole(role) + ' added. Give it to people in People & Roles.' };
  });
}

/* ---------- Access & QR Codes (personal phone links) ---------- */

const workspaceFor = (p) => (p.roles || []).some(r => /DRIVER/.test(String(r).toUpperCase())) ? 'route' : 'phone';

async function accessLinks(db) {
  const [users, access] = await Promise.all([db.collection(M.COLLECTIONS.users).get(), db.collection('personAccess').get()]);
  const a = {};
  access.docs.forEach(d => { a[d.id] = d.data(); });
  return { people: users.docs.map(d => {
    const p = d.data(), x = a[d.id] || null;
    return { email: d.id, name: p.name || d.id, roles: (p.roles || []).map(prettyRole), facilities: (p.facilities || []).map(f => f === '*' ? 'All locations' : plantName(f)),
      state: !x ? 'NOT SET' : x.enabled ? 'ACTIVE' : 'REVOKED', issuedAt: x ? x.issuedAt || '' : '', issuedBy: x ? x.issuedBy || '' : '', revokedAt: x ? x.revokedAt || '' : '', workspace: workspaceFor(p) };
  }).sort((x, y) => x.name.localeCompare(y.name)), smsConfigured: false };
}

async function accessGenerate(db, email, input, stamp) {
  const target = text(input.email, 254).toLowerCase();
  const p = await personOf(db, target);
  if (!p) fail('NOT_FOUND', target + ' is not on the Users list.');
  const token = crypto.randomBytes(24).toString('base64url');
  const workspace = workspaceFor(p);
  await db.collection('personAccess').doc(M.safeIdPart(target)).set({ hash: hash('access', token), enabled: true, version: crypto.randomUUID(), workspace, issuedAt: stamp, issuedBy: email, revokedAt: '', revokedBy: '' });
  // The link is shown once, now; only its hash is kept. It opens the person's phone screens, where they still sign in.
  return { ok: true, token, workspace, message: 'New mobile access link generated. The prior link is revoked.' };
}

async function accessRevoke(db, email, input, stamp) {
  const ref = db.collection('personAccess').doc(M.safeIdPart(text(input.email, 254).toLowerCase()));
  const d = (await ref.get()).data();
  if (!d) return { ok: true, message: 'No access link exists for this employee.' };
  await ref.update({ enabled: false, version: crypto.randomUUID(), revokedAt: stamp, revokedBy: email });
  return { ok: true, message: 'Mobile access revoked.' };
}

async function accessEmail(db, email, input) {
  const target = text(input.email, 254).toLowerCase(), link = text(input.link, 600);
  const d = (await db.collection('personAccess').doc(M.safeIdPart(target)).get()).data();
  if (!d || !d.enabled || !link) fail('BAD_REQUEST', 'Generate an access link before emailing it.');
  const token = (/[?&]access=([A-Za-z0-9_-]+)/.exec(link) || [])[1] || '';
  if (!sameHash(hash('access', token), d.hash)) fail('BAD_REQUEST', 'That is not this person\'s current link; generate a new one.');
  const out = await appMail(db, { kind: 'Access link', label: target, by: email, to: [target], subject: 'United Dairy mobile access',
    text: 'Your United Dairy mobile access link:\n\n' + link + '\n\nIf you did not request this link, contact your manager.' });
  return { ok: out.status === 'SENT', message: out.status === 'SENT' ? 'Emailed to ' + out.sentTo.join(', ') + (out.testCopy ? ' (sandbox: a test copy to you only).' : '.') : out.reason };
}

/* ---------- Driver Station Codes: the Route Distribution phone code ---------- */

async function appLinks(db) {
  const [c, shown] = await Promise.all([db.collection(M.COLLECTIONS.config).doc('routePhone').get(), db.collection('private').doc('routeCodeShown').get()]);
  const d = c.exists ? c.data() : null, s = shown.exists ? shown.data() : null;
  return { routeCode: { state: !d || !d.codeHash ? 'NOT SET' : d.enabled ? 'ACTIVE' : 'DISABLED', setAt: d ? d.setAt || '' : '', setBy: d ? d.setBy || '' : '',
    code: d && s && s.setAt === d.setAt ? s.code : '' } };
}

async function routeCodeNew(db, email, stamp) {
  const code = Array.from(crypto.randomBytes(6)).map(b => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
  const salt = crypto.randomBytes(12).toString('hex');
  const codeHash = crypto.createHash('sha256').update(salt + ':' + code).digest('hex');
  await db.collection(M.COLLECTIONS.config).doc('routePhone').set({ codeHash, salt, enabled: true, setAt: stamp, setBy: email, failedBy: {} });
  await db.collection('private').doc('routeCodeShown').set({ code, setAt: stamp });
  return { ok: true, code, message: 'New Route Distribution code made. Every phone asks for it again.' };
}

async function routeCodeOnOff(db, email, input, stamp) {
  const ref = db.collection(M.COLLECTIONS.config).doc('routePhone');
  const d = (await ref.get()).data();
  if (!d || !d.codeHash) fail('BAD_REQUEST', 'Make a code first (Generate Code).');
  await ref.update({ enabled: input.open === true, switchedAt: stamp, switchedBy: email });
  return { ok: true, message: input.open === true ? 'The Route Distribution phone link is on.' : 'The Route Distribution phone link is off. Phones cannot open it until it is turned on.' };
}

/* ---------- Manager Links: the manager release code (Joe 10/12: moved from Plant Station Codes) ---------- */

async function releaseCodes(db) {
  const d = (await db.collection('private').doc('releaseCodes').get()).data() || {};
  return { plants: activePlants().map(p => { const c = d[p.id] || null; return { id: p.id, name: p.name, set: !!(c && c.hash), code: c ? c.code || '' : '', changedAt: c ? c.changedAt || '' : '', changedBy: c ? c.changedBy || '' : '' }; }) };
}

async function releaseCodeNew(db, email, input, stamp) {
  const fac = text(input.facilityId, 60);
  if (!activePlants().some(p => p.id === fac)) fail('BAD_REQUEST', 'Pick a plant.');
  const code = newCode(), salt = crypto.randomBytes(12).toString('hex');
  await db.collection('private').doc('releaseCodes').set({ [fac]: { salt, hash: hash(salt, code), code, version: crypto.randomUUID(), changedAt: stamp, changedBy: email } }, { merge: true });
  await db.collection('private').doc('releaseFails').set({ [fac]: {} }, { mergeFields: [fac] });
  return { ok: true, code, message: 'New manager release code for ' + plantName(fac) + '.' };
}

/*
 * The Plant Station tablet's Change Station (any signed-in active user): whether the plant has a release code, and
 * checking one. Five wrong codes lock that plant's release for ten minutes.
 */
async function stationRelease(db, user, input, now) {
  const email = String(user && user.email || '').toLowerCase();
  const p = await personOf(db, email);
  if (!p || p.status !== 'ACTIVE') fail('NOT_ALLOWED', 'Sign in with an active United Dairy account.');
  // A tablet's station code (stations.js): has / enter / check.
  if (['has', 'enter', 'check'].indexOf(input.op) >= 0) return STATIONS.tabletCall(db, input, now);
  return releaseCheck(db, input, now);
}

// The plant's manager release code: 'status' (is one set?) or a typed code. Also the Garage Station's (garage.js), which has no sign-in.
async function releaseCheck(db, input, now) {
  const fac = text(input.facilityId || 'fac_uniontown', 60);
  const codes = (await db.collection('private').doc('releaseCodes').get()).data() || {}, c = codes[fac];
  if (input.op === 'status') return { required: !!(c && c.hash) };
  if (!c || !c.hash) return { ok: true };
  const t = (now ? now() : new Date()).getTime();
  const failRef = db.collection('private').doc('releaseFails');
  return db.runTransaction(async tx => {
    // Per device (fails.js): 5 wrong codes lock out the device that typed them for 10 minutes, not the whole plant.
    const device = FAILS.who(input);
    const byDevice = FAILS.current(((await tx.get(failRef)).data() || {})[fac], v => (v.until || 0) > t || (v.at || 0) > t - 10 * 60000);
    const f = byDevice[device] || { count: 0, until: 0 };
    if (f.until && f.until > t) fail('NOT_ALLOWED', 'Too many wrong manager release codes. Wait 10 minutes and try again.');
    const given = normCode(input.code);
    if (given.length < 6 || !sameHash(hash(c.salt, given), c.hash)) {
      const count = (f.until && f.until <= t ? 0 : f.count || 0) + 1;
      byDevice[device] = count >= 5 ? { count: 0, until: t + 10 * 60000, at: t } : { count, until: 0, at: t };
      tx.set(failRef, { [fac]: byDevice }, { mergeFields: [fac] });
      return { ok: false, message: count >= 5 ? 'Too many wrong manager release codes. Wait 10 minutes and try again.' : 'The manager release code was not recognized.' };
    }
    delete byDevice[device];
    tx.set(failRef, { [fac]: byDevice }, { mergeFields: [fac] });
    return { ok: true };
  });
}

/* ---------- Manager Report Recipients ---------- */

const groupId = (fac, name) => M.safeIdPart(fac + '__' + String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-'));

async function reportGroups(db, input) {
  const fac = text(input.facilityId || 'fac_uniontown', 60);
  const [snap, mail] = await Promise.all([db.collection('reportGroups').where('facilityId', '==', fac).get(), emailSettings(db)]);
  return { facilityId: fac, locations: activePlants().map(p => ({ id: p.id, name: p.name })), sending: mail.sending,
    groups: snap.docs.map(d => Object.assign({ id: d.id }, d.data())).filter(g => g.active !== false).sort((a, b) => a.name.localeCompare(b.name)) };
}

async function saveReportGroup(db, email, input, stamp) {
  const fac = text(input.facilityId || 'fac_uniontown', 60);
  if (!activePlants().some(p => p.id === fac)) fail('BAD_REQUEST', 'Pick a location.');
  const name = text(input.name, 100);
  if (!name) fail('BAD_REQUEST', 'A new group needs a name and at least one address.');
  const raw = String(input.recipients || '').split(/[;,\s]+/).map(s => s.trim()).filter(Boolean);
  const bad = raw.filter(a => !EMAIL.test(a));
  if (bad.length) fail('BAD_REQUEST', 'Not an email address: ' + bad.slice(0, 3).join(', '));
  const recipients = addresses(raw);
  const active = input.active !== false;
  if (active && !recipients.length) fail('BAD_REQUEST', 'A new group needs a name and at least one address.');
  const ref = db.collection('reportGroups').doc(groupId(fac, name));
  const before = (await ref.get()).data();
  await ref.set({ facilityId: fac, name, recipients, active, fromName: 'United Dairy Plant Distribution', version: (before ? before.version || 0 : 0) + 1,
    createdAt: before ? before.createdAt : stamp, createdBy: before ? before.createdBy : email, updatedAt: stamp, updatedBy: email });
  return { ok: true, message: active ? 'Saved.' : 'Removed ' + name + '.' };
}

/* ---------- Sent Email Log and the Sending switch ---------- */

async function sentLog(db) {
  const [snap, settings] = await Promise.all([db.collection('sentEmails').orderBy('at', 'desc').limit(160).get(), emailSettings(db)]);
  return { settings, emails: snap.docs.map(d => Object.assign({ id: d.id }, d.data())) };
}

async function setSending(db, email, input, stamp) {
  if (typeof input.on !== 'boolean') fail('BAD_REQUEST', 'on must be true or false');
  await db.collection('private').doc('emailSettings').set({ sending: input.on, changedAt: stamp, changedBy: email }, { merge: true });
  return { ok: true, message: input.on ? 'Sending is on.' : 'Sending is off.' };
}
// Joe 10/19 (Late Forecast): who gets the forecast box in the plant report email: only a test sent to oneself (the start),
// or everyone the report goes to.
async function setForecastEmail(db, email, input, stamp) {
  if (typeof input.everyone !== 'boolean') fail('BAD_REQUEST', 'everyone must be true or false');
  await db.collection('private').doc('emailSettings').set({ forecastEveryone: input.everyone, forecastChangedAt: stamp, forecastChangedBy: email }, { merge: true });
  return { ok: true, message: input.everyone ? 'The forecast now goes in the report email to everyone.' : 'The forecast now goes only in a test sent to yourself.' };
}

/* ---------- Email Senders ---------- */

// Joe 10/11: an email someone sends comes from that person's own United Dairy mailbox (fromWho PERSON, the default).
// An email no one pressed comes from the plant's mailbox here; a plant left empty keeps the app's standard sender
// (MAIL_FROM). Every plant is listed, planned ones too, so Charleston and Martins Ferry can be set before they go live.
async function emailSenders(db, deps) {
  const s = await emailSettings(db), env = (deps && deps.env) || process.env;
  return { standard: String(env.MAIL_FROM || '').trim(), fromWho: s.fromWho, sending: s.sending,
    plants: L.PLANTS.map(p => { const x = s.senders[p.id] || {}; return { id: p.id, plant: p.name, address: x.address || '', senderName: x.name || '', changedAt: x.changedAt || '', changedBy: x.changedBy || '' }; }) };
}

// Joe 10/14: an empty "Send emails from" means the standard sender and never stops Save. A name with no address is the
// name people see on the standard sender's email. An email address typed as the name is not a name: it is left out and
// the message says where it goes instead.
async function saveEmailSenders(db, email, input, stamp, deps) {
  const before = await emailSettings(db), senders = {}, notes = [];
  const given = input.senders || {};
  L.PLANTS.forEach(p => {
    const g = given[p.id] || {}, raw = text(g.address, 120).toLowerCase();
    let name = text(g.name, 80).replace(/[<>"\r\n]/g, '');
    if (raw && !ourAddress(raw)) fail('BAD_REQUEST', p.name + ': "' + raw + '" is not a United Dairy email address (it must end in ' + DOMAIN + ').');
    if (/@/.test(name)) { notes.push(p.name + ': "Name people see" takes a name, not an email address, so it was left empty.' +
      (raw ? '' : ' To send ' + p.name + '\'s automatic email from ' + name + ', type it in "Send emails from".')); name = ''; }
    const was = before.senders[p.id] || {};
    const same = (was.address || '') === raw && (was.name || '') === name;
    senders[p.id] = { address: raw, name, changedAt: same ? was.changedAt || '' : stamp, changedBy: same ? was.changedBy || '' : email };
  });
  const fromWho = input.fromWho === 'PLANT' ? 'PLANT' : 'PERSON';
  await db.collection('private').doc('emailSettings').set({ senders, fromWho, sendersChangedAt: stamp, sendersChangedBy: email }, { merge: true });
  return Object.assign({ ok: true, message: ['Saved.'].concat(notes).join(' ') }, await emailSenders(db, deps));
}

/* ---------- Remaining Repair Items ---------- */

const PRIORITIES = ['NORMAL', 'HIGH', 'BLOCKER'];
async function repairItems(db) {
  const snap = await db.collection('repairItems').get();
  const all = snap.docs.map(d => Object.assign({ id: d.id }, d.data())).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const open = all.filter(i => i.status === 'OPEN');
  return { open, complete: all.filter(i => i.status !== 'OPEN'), count: open.length };
}

async function saveRepairItem(db, email, input, stamp) {
  const title = text(input.title, 200);
  if (!title) fail('BAD_REQUEST', 'Type the repair item.');
  const priority = String(input.priority || 'NORMAL').toUpperCase();
  if (PRIORITIES.indexOf(priority) < 0) fail('BAD_REQUEST', 'Priority must be Normal, High or Blocker.');
  const id = input.itemId ? text(input.itemId, 40) : 'FIX-' + crypto.randomBytes(4).toString('hex').toUpperCase();
  const ref = db.collection('repairItems').doc(M.safeIdPart(id)), before = (await ref.get()).data();
  if (input.itemId && !before) fail('NOT_FOUND', 'That repair item is gone; reload.');
  await ref.set({ title, notes: text(input.notes, 1000), priority, status: 'OPEN', createdAt: before ? before.createdAt : stamp, createdBy: before ? before.createdBy : email,
    updatedAt: stamp, updatedBy: email, completedAt: '', completedBy: '' });
  return Object.assign({ ok: true, message: before ? 'Repair item saved.' : 'Repair item added.' }, await repairItems(db));
}

async function completeRepairItem(db, email, input, stamp) {
  const ref = db.collection('repairItems').doc(M.safeIdPart(text(input.itemId, 40)));
  if (!(await ref.get()).exists) fail('NOT_FOUND', 'That repair item is gone; reload.');
  await ref.update({ status: 'COMPLETE', completedAt: stamp, completedBy: email, updatedAt: stamp, updatedBy: email });
  return Object.assign({ ok: true, message: 'Marked complete.' }, await repairItems(db));
}

/* ---------- the call ---------- */

const OPS = {
  people: (db) => people(db),
  savePerson, saveRoleTemplate, addRole,
  roleTemplates: async (db) => { const t = await templatesOf(db); return { catalog: R.CATALOG, roles: t.roles, defaults: R.DEFAULTS, templates: t.templates, meta: t.meta }; },
  accessLinks: (db) => accessLinks(db), accessGenerate, accessRevoke, accessEmail: (db, email, input) => accessEmail(db, email, input),
  appLinks: (db) => appLinks(db), routeCodeNew: (db, email, input, stamp) => routeCodeNew(db, email, stamp), routeCodeOnOff,
  releaseCodes: (db) => releaseCodes(db), releaseCodeNew,
  reportGroups: (db, email, input) => reportGroups(db, input), saveReportGroup,
  sentLog: (db) => sentLog(db), setSending, setForecastEmail,
  emailSenders: (db, email, input, stamp, d) => emailSenders(db, d), saveEmailSenders,
  repairItems: (db) => repairItems(db), saveRepairItem, completeRepairItem,
  // Station codes (stations.js): Plant Station, Garage Station and kiosk codes.
  stations: STATIONS.stations, stationAdd: STATIONS.stationAdd, stationCode: STATIONS.stationCode, stationRemove: STATIONS.stationRemove, noAccountSet: STATIONS.noAccountSet
};

async function adminCall(db, user, input, deps) {
  input = input || {};
  const d = deps || {};
  const op = String(input.op || '');
  if (op === 'repairCount') {
    // The header's "Repairs · N" for Administrators (nothing for anyone else).
    const p = await personOf(db, String(user && user.email || '').toLowerCase());
    if (!p || p.status !== 'ACTIVE' || !L.isAdmin(p)) return { count: 0 };
    return { count: (await repairItems(db)).count };
  }
  // Email, schedules and diagnostics (admintools.js), loaded here because it builds on this file.
  const TOOLS = require('./admintools').OPS;
  // The Upload Center (uploads.js, Joe 10/18): a new plant's data from one workbook.
  const UPLOADS = require('./uploads').OPS;
  const fn = (d.ops && d.ops[op]) || OPS[op] || TOOLS[op] || UPLOADS[op];
  if (!fn) fail('BAD_REQUEST', 'Unknown Administration step: ' + op);
  const email = await requireAdmin(db, user);
  const stamp = (d.now ? d.now() : new Date()).toISOString();
  return fn(db, email, input, stamp, d);
}

module.exports = { usersCopy, adminCall, stationRelease, releaseCheck, AdminError, savePerson, personRevision, OPS, requireAdmin, fail, text, plantName, activePlants };

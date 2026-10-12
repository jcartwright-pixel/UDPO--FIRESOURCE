/*
 * United Dairy Distribution app: server entry points (Firebase Cloud Functions).
 *
 *   transferEveryMinute   copies the Live tabs and master lists into the database (read-only on the sheets)
 *   transferNow           the same on request, for an administrator ("Reset test copy" rewrites every row)
 *   save                  every save from the screens, one call each
 *   phone                 the drivers' phone Check-In (Route Distribution code, no United Dairy account)
 *   garage                the Garage Station tablet (technician name + login ID, no United Dairy account)
 *   newRouteCode          a manager makes a new Route Distribution code for the phones
 *   gps                   a manager or administrator saves, removes or tests the Verizon Connect (Fleetmatics) API login
 *   setSwitch             an administrator moves a screen between the current app and the new one, or turns the write-back on / off
 *   writeBackOnSave       writes each save into the SANDBOX Live workbook (phase 2; production is refused)
 *   writeBackEveryMinute  retries anything the write-back could not finish
 *   masterWriteBackOnSave writes Driver / Route / Equipment Master, day off and vacation saves into SANDBOX copies
 *   fleetSyncNightly      brings Equipment Master in step with the United Dairy fleet list every night (the sandbox copy; the
 *                         real one only once config/app.fleetSyncReal.enabled is on, which waits for Joe's OK)
 *   fleetSyncNow          the same from Equipment's "Sync fleet list" button, for a manager or administrator; {preview: true}
 *                         lists every change it would make and writes nothing
 *   mailPlantReport       emails a plant report straight after Send Current Report saves it (reportmail.js; MAIL_FROM)
 *   mocreoEvery5Minutes   reads the MOCREO cooler sensors (read only) once a key is saved in Administration and tested
 *   mocreo                Administration > MOCREO & Sensors: save or replace the key (never shown again), test it, thermometer locations
 *   admin                 Administration's own pages (src/admin.js): people, role templates, links and codes, email, repairs, tools
 *   stationRelease        the Plant Station tablet's Change Station: the plant's manager release code, when one is set
 *   stationSignIn         the Plant Station with no UD account: a plant station's code signs the tablet in as that station
 *                         only, while the plant's switch is On (Administration > Plant Station Codes)
 *   adminJobsEvery5Minutes  repair emails to lessors, the driver check-in mailbox and the weekly archive, each at its Refresh Rate
 *   deviceReads           the one door for every reading device: a line's label reader (its line PC) now, a receiving scanner later (src/reader.js)
 *   lineReader            Line Targets, administrators: make a line's reader key; start or stop the sandbox test feed
 *   productionEveryMinute the sandbox test feed's pretend jugs, and a stop when a label reader line goes quiet
 */
'use strict';

const admin = require('firebase-admin');
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { setGlobalOptions } = require('firebase-functions/v2');
const { runTransfer } = require('./src/transfer');
const { applyAction, checkSaves, SaveError } = require('./src/actions');
const { phoneCall, newRouteCode } = require('./src/phone');
const { garageCall } = require('./src/garage');
const { setSwitch, SwitchError } = require('./src/switch');
const { gpsCall, GpsError } = require('./src/gps');
const { unitedDairyUser } = require('./src/auth');
const { makeSheetsReader, makeSheetsWriter } = require('./src/sheets');
const { runWriteBack } = require('./src/writeback');
const { runMasterWriteBack } = require('./src/masterwrite');
const { transferSources } = require('./src/sources');
const { safeIdPart } = require('./src/model');
const { runFleetSync } = require('./src/fleetsync');
const { mailReport } = require('./src/reportmail');
const { runMocreoSync, readSecrets, mocreoCall, appSecrets, MocreoError } = require('./src/mocreo');
const ADMIN = require('./src/admin');
const { adminCall, stationRelease, AdminError } = ADMIN;
const STATIONS = require('./src/stations');
const { StationError } = STATIONS;
const TOOLS = require('./src/admintools');
const READER = require('./src/reader');
const L = require('./src/logic');

admin.initializeApp();
setGlobalOptions({ region: 'us-east4', maxInstances: 5 });
const db = admin.firestore();

const CODE = { BAD_REQUEST: 'invalid-argument', NOT_FOUND: 'not-found', NOT_ALLOWED: 'permission-denied', CHANGED: 'aborted' };

function signedIn(request) {
  const user = unitedDairyUser(request.auth);
  if (!user) throw new HttpsError('permission-denied', 'Sign in with your United Dairy Google account');
  return user;
}

/*
 * Where the copy reads from. Nothing is read until one of these is set on the deployed project:
 *   DEMO_DATA=1               the made-up sheets in src/demo-sheets.js (the sandbox before its sheet copies exist);
 *                             DEMO_ADMINS (comma-separated emails) are added to the made-up Users list as administrators
 *   SOURCES_JSON              copies of the sheets (sources.js)
 *   READ_UNIONTOWN_SHEETS=1   the Uniontown sheets themselves, read only (production, only after Joe says go)
 */
function transferSetup() {
  if (process.env.DEMO_DATA === '1') {
    const D = require('./src/demo-sheets');
    const admins = String(process.env.DEMO_ADMINS || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
    return { reader: D.fakeReader(D.demoSheets(admins)), sources: D.SOURCES };
  }
  if (!process.env.SOURCES_JSON && process.env.READ_UNIONTOWN_SHEETS !== '1') return null;
  return { reader: makeSheetsReader(), sources: transferSources(process.env) };
}

exports.transferEveryMinute = onSchedule({ schedule: 'every 1 minutes', timeZone: 'America/New_York', timeoutSeconds: 120 }, async () => {
  const setup = transferSetup();
  if (!setup) return;
  // Administration > Refresh Rates: every minute unless an administrator chose a slower rate.
  if (!(await TOOLS.jobDue(db, 'transfer'))) return;
  await runTransfer({ db, reader: setup.reader, sources: setup.sources });
  // Nobody pressed Publish and the calendar reached the Next week: publish it, as the current app's scheduled refresh does.
  try { await require('./src/weekroll').autoPublish(db); } catch (e) { console.error('Automatic Publish failed: ' + (e && e.message || e)); }
});

// Sandbox only: Joe's Over the Road history (OTR Trips 2026 + the August accounting package), filled in once (src/otr-seed.js).
exports.otrHistorySandbox = onSchedule({ schedule: 'every 5 minutes', timeoutSeconds: 300, maxInstances: 1, memory: '512MiB' }, async () => {
  const project = process.env.GCLOUD_PROJECT || JSON.parse(process.env.FIREBASE_CONFIG || '{}').projectId;
  if (project !== 'ud-distribution-sandbox') return;
  await require('./src/otr-seed').seedOtrOnce(db);
});

exports.transferNow = onCall({ timeoutSeconds: 120 }, async (request) => {
  const user = signedIn(request);
  const person = (await db.collection('users').doc(safeIdPart(user.email)).get()).data();
  if (!person || person.status !== 'ACTIVE' || (person.roles || []).indexOf('ADMINISTRATOR') < 0) {
    throw new HttpsError('permission-denied', 'Only an administrator can run the transfer by hand');
  }
  const setup = transferSetup();
  if (!setup) throw new HttpsError('failed-precondition', 'No sheets are set up for this project yet (DEMO_DATA, SOURCES_JSON or READ_UNIONTOWN_SHEETS)');
  const result = await runTransfer({ db, reader: setup.reader, sources: setup.sources, force: !!(request.data && request.data.resetTestCopy) });
  return { at: result.at, liveWeeks: result.liveWeeks, summary: result.summary, warningCount: result.warnings.length };
});

const asHttps = (error) => (error instanceof SaveError || error instanceof SwitchError || error instanceof GpsError || error instanceof MocreoError || error instanceof AdminError || error instanceof StationError || error instanceof READER.ReaderError ? new HttpsError(CODE[error.code] || 'failed-precondition', error.message, error.details || undefined) : error);

// Open to phones without a United Dairy account: every call is checked against the Route Distribution code (or, from the
// Driver Room Check-In tablet, its Driver Room kiosk station code).
const roomCall = (input) => /^room/.test(String(input.op || '')) || !!input.station;
exports.phone = onCall({ maxInstances: 3 }, async (request) => {
  const input = request.data || {};
  try {
    // Joe 10/12: the Driver Room Check-In Station is signed in with a United Dairy account first (the Driver Station link);
    // its station code then decides the page. The drivers' own phones keep the Route Distribution code alone.
    if (roomCall(input) && !unitedDairyUser(request.auth)) throw new HttpsError('unauthenticated', 'Sign in with a United Dairy account on the Driver Station link first.');
    // The Driver Room Check-In tablet's Release: the plant's manager release code (as the no-account Plant Station).
    if (input.op === 'roomStatus' || input.op === 'roomRelease') return await ADMIN.releaseCheck(db, { op: input.op === 'roomStatus' ? 'status' : 'release', facilityId: input.facilityId, code: input.code });
    return await phoneCall(db, input);
  } catch (error) { throw asHttps(error); }
});

// Open to the garage tablet without a United Dairy account: every step is checked against a technician's sign-in.
exports.garage = onCall({ maxInstances: 3 }, async (request) => {
  try { return await garageCall(db, request.data); } catch (error) { throw asHttps(error); }
});

exports.newRouteCode = onCall(async (request) => {
  const user = signedIn(request);
  try { return await newRouteCode(db, user); } catch (error) { throw asHttps(error); }
});

exports.setSwitch = onCall(async (request) => {
  const user = signedIn(request);
  // The write-back can go on only where the server names a sandbox Live workbook to write.
  try { return await setSwitch(db, user, request.data, !!process.env.WRITEBACK_JSON && process.env.DEMO_DATA !== '1'); } catch (error) { throw asHttps(error); }
});

// Joe 10/10: Administration's People & Roles lists everyone on the Users list, for Administrators only. Each person may
// still read only their own entry from the screens; the whole list comes through here.
exports.people = onCall(async (request) => {
  const user = signedIn(request);
  const person = (await db.collection('users').doc(safeIdPart(user.email)).get()).data();
  if (!person || person.status !== 'ACTIVE' || !L.isAdmin(person)) throw new HttpsError('permission-denied', 'Only an administrator can see the Users list');
  const snap = await db.collection('users').get();
  return { people: snap.docs.map(d => { const p = d.data(); return { email: d.id, name: p.name || '', status: p.status || '', roles: p.roles || [], facilities: p.facilities || [] }; }) };
});

exports.gps = onCall({ timeoutSeconds: 30 }, async (request) => {
  const user = signedIn(request);
  try { return await gpsCall(db, user, request.data, { local: process.env.FUNCTIONS_EMULATOR === 'true' }); } catch (error) { throw asHttps(error); }
});

// Administration > MOCREO & Sensors: the API key (write-only), Test Connection, and the thermometer locations.
exports.mocreo = onCall({ timeoutSeconds: 60 }, async (request) => {
  const user = signedIn(request);
  try { return await mocreoCall(db, user, request.data); } catch (error) { throw asHttps(error); }
});

// Administration (src/admin.js): Administrators only, checked inside.
// The sandbox sheet copies the Administration tools may read (Date Inventory) and change (Archive now, Date Convert, both
// refused on a production sheet by writeback.js), and a copy from the sheets on request (Refresh Home Summary Now).
function adminDeps() {
  // Production writes only dispatch changes to the real Live sheet, so its Administration tools keep no Live workbook to change.
  const setup = transferSetup(), live = process.env.WRITEBACK_JSON && process.env.DEMO_DATA !== '1' && !realLive() ? JSON.parse(process.env.WRITEBACK_JSON).spreadsheetId : '';
  return {
    env: process.env,
    sources: setup && process.env.DEMO_DATA !== '1' ? setup.sources : null,
    sheets: setup && process.env.DEMO_DATA !== '1' ? () => makeSheetsWriter() : null,
    liveId: live,
    runTransfer: setup ? () => runTransfer({ db, reader: setup.reader, sources: setup.sources }) : null
  };
}

exports.admin = onCall({ timeoutSeconds: 300, memory: '512MiB' }, async (request) => {
  const user = signedIn(request);
  try { return await adminCall(db, user, request.data, adminDeps()); } catch (error) { throw asHttps(error); }
});

// Repair emails (Immediately / Once a day), the driver check-in mailbox and the weekly archive, each only when its
// Refresh Rate says it is due. Each does nothing until an administrator switches it on.
exports.adminJobsEvery5Minutes = onSchedule({ schedule: 'every 5 minutes', timeoutSeconds: 300, maxInstances: 1, memory: '512MiB' }, async () => {
  const run = async (key, fn) => { try { if (await TOOLS.jobDue(db, key)) await fn(); } catch (e) { console.error(key, e); } };
  await run('repairEmail', () => TOOLS.repairSweep(db, {}));
  await run('checkinMail', () => TOOLS.checkinRun(db, {}));
  const d = adminDeps();
  if (d.sheets && d.liveId) await run('archive', () => TOOLS.archiveCompleted(db, 'SCHEDULE', { sheets: d.sheets(), liveId: d.liveId }));
});

exports.stationRelease = onCall({ maxInstances: 3 }, async (request) => {
  const user = signedIn(request);
  try { return await stationRelease(db, user, request.data || {}); } catch (error) { throw asHttps(error); }
});

// Open to tablets with no United Dairy account (Joe 10/12, the old app's public Plant Station): a plant station's code, only
// while that plant's switch is On. The token names the station and its code's version; the database rules and save check
// both against stationAccess / private/stations each time, so Off, New code and Remove shut the tablet out at once.
exports.stationSignIn = onCall({ maxInstances: 3 }, async (request) => {
  const input = request.data || {};
  try {
    if (input.op === 'status' || input.op === 'release') return await ADMIN.releaseCheck(db, input);
    const r = await STATIONS.signIn(db, input);
    if (!r.ok || input.op !== 'enter') return r;
    const token = await admin.auth().createCustomToken('station-' + r.station.key, { udStation: r.station.key, udVersion: r.station.version, udPlant: r.station.facilityId, udName: r.station.name, udType: r.station.type });
    return Object.assign({ token }, r);
  } catch (error) { throw asHttps(error); }
});

// A save from a United Dairy account, or from a Plant Station signed in by its code alone (only the plant-floor saves).
async function saver(request) {
  const user = unitedDairyUser(request.auth);
  if (user) return user;
  const station = request.auth ? await STATIONS.stationSaver(db, request.auth.token) : null;
  if (!station) return signedIn(request);
  return { uid: request.auth.uid, email: 'station:' + station.key, station };
}

exports.save = onCall(async (request) => {
  const user = await saver(request);
  try {
    // Asking, not saving: which of these saves this person may make (People & Roles counts).
    if (request.data && Array.isArray(request.data.checkSaves)) return { allowed: await checkSaves(db, user, request.data.checkSaves) };
    // Local test database only: a browser test can set the server's clock (?testNow) to its made-up day.
    const testNow = process.env.FUNCTIONS_EMULATOR === 'true' && request.data && request.data.testNow ? new Date(request.data.testNow) : null;
    const result = await applyAction(db, user, request.data, testNow && !isNaN(testNow) ? () => testNow : undefined);
    // A manager's Lessor button: the repair email goes out after the save (Administration > Repair Email).
    return await TOOLS.afterSave(db, user, request.data, result);
  } catch (error) {
    if (error instanceof SaveError) throw new HttpsError(CODE[error.code] || 'failed-precondition', error.message, error.details || undefined);
    throw error;
  }
});

// The production server: it reads the real Uniontown sheets (no SOURCES_JSON copies), so its write-back target is the real
// Live workbook (Joe 10/12: "Let the new app write dispatch changes to the real Live sheet."; production-env.cjs allows
// no other target there).
function realLive() {
  return process.env.READ_UNIONTOWN_SHEETS === '1' && !process.env.SOURCES_JSON && process.env.DEMO_DATA !== '1';
}

// The write-back runs only when config/app.writeBack.enabled is true and WRITEBACK_JSON names the Live workbook the
// copy reads ({"spreadsheetId": "..."}). One at a time, so saves reach the sheet in the order they were made.
async function writeBackIfOn(part) {
  const config = (await db.collection('config').doc('app').get()).data() || {};
  if (!process.env.WRITEBACK_JSON || process.env.DEMO_DATA === '1') return null;
  const target = JSON.parse(process.env.WRITEBACK_JSON);
  // With the switch off, only People & Roles saves go out, and only to the sandbox's Users sheet copy (admin.js usersCopy).
  if (!config.writeBack || config.writeBack.enabled !== true) {
    if (part === 'live' || realLive() || !ADMIN.usersCopy(process.env)) return null;
    const users = target.masters.users, source = transferSources(process.env).masters.users;
    if (!source || source.spreadsheetId !== users.spreadsheetId || source.tab !== users.tab) throw new Error('Write-back stopped: WRITEBACK_JSON.masters.users and SOURCES_JSON must name the same sandbox copy');
    return { live: null, master: await runMasterWriteBack({ db, sheets: makeSheetsWriter(), targets: { users }, only: true }) };
  }
  // The conflict check compares with what the copy last read, so the write-back must write the workbook the copy reads.
  if (target.spreadsheetId !== transferSources(process.env).live.spreadsheetId) {
    throw new Error('Write-back stopped: WRITEBACK_JSON and SOURCES_JSON must name the same sandbox Live workbook');
  }
  const sheets = makeSheetsWriter();
  const live = part === 'master' ? null : await runWriteBack({ db, sheets, target, allowRealLive: realLive() });
  // Production: dispatch changes to the Live tabs, and (Joe 10/12: "Let the new app write Route Master, Driver Master,
  // Equipment Master, Users, Exceptions and Vacations to the real sheets.") those six real master lists, the same sheets the
  // copy reads, and (Joe 10/12) the check-in problem tabs of the real Live workbook; no other list is written. config/app.realMasters.enabled === false stops
  // them; saves queued before they were first turned on are held, not written (masterwrite.js since).
  if (realLive()) {
    if (part === 'live') return { live, master: null };
    const since = await realMastersSince();
    if (!since) return { live, master: null };
    const { UNIONTOWN } = require('./src/sources'), { REAL_MASTER_LISTS, REAL_LIVE_QUEUE_LISTS } = require('./src/writeback');
    const targets = {};
    REAL_MASTER_LISTS.forEach(k => { targets[k] = UNIONTOWN.masters[k]; });
    // Driver Check-ins (Joe 10/12): the problems a check-in reports go to these tabs of the real Live workbook.
    const { TABS, LISTS } = require('./src/maintenance');
    Object.keys(LISTS).forEach(k => { targets[LISTS[k]] = { spreadsheetId: UNIONTOWN.live.spreadsheetId, tab: TABS[k] }; });
    return { live, master: await runMasterWriteBack({ db, sheets, targets, only: true, allowReal: REAL_MASTER_LISTS.concat(REAL_LIVE_QUEUE_LISTS), since }) };
  }
  // Master lists: only those WRITEBACK_JSON.masters names ({"drivers": {"spreadsheetId", "tab"}, ...}), each the same copy the
  // transfer reads (SOURCES_JSON), for the same reason as above.
  const masters = Object.assign({}, target.masters || {}), sources = transferSources(process.env).masters;
  Object.keys(masters).forEach(k => {
    if (!sources[k] || sources[k].spreadsheetId !== masters[k].spreadsheetId || sources[k].tab !== masters[k].tab) {
      throw new Error('Write-back stopped: WRITEBACK_JSON.masters.' + k + ' and SOURCES_JSON must name the same sandbox copy');
    }
  });
  // Pickups: the sandbox copy of the Plant Operations workbook (WRITEBACK_JSON "plant": {"pickups": {...}}), the same copy the transfer reads.
  const plantPickups = (target.plant || {}).pickups;
  if (plantPickups) {
    const src = transferSources(process.env).plant.pickups;
    if (!src || src.spreadsheetId !== plantPickups.spreadsheetId || src.tab !== plantPickups.tab) throw new Error('Write-back stopped: WRITEBACK_JSON.plant.pickups and SOURCES_JSON must name the same sandbox copy');
    masters.pickups = plantPickups;
  }
  // The maintenance queues are tabs of the same sandbox Live workbook.
  const { TABS, LISTS } = require('./src/maintenance');
  Object.keys(LISTS).forEach(k => { masters[LISTS[k]] = { spreadsheetId: target.spreadsheetId, tab: TABS[k] }; });
  const master = part !== 'live' && Object.keys(masters).length ? await runMasterWriteBack({ db, sheets, targets: masters }) : null;
  return { live, master };
}

// When the production server first writes the real master lists: kept in config/app.realMasters.since, so the saves
// queued before that are held. Null while config/app.realMasters.enabled is false.
async function realMastersSince() {
  const ref = db.collection('config').doc('app');
  return db.runTransaction(async tx => {
    const c = ((await tx.get(ref)).data() || {}).realMasters || {};
    if (c.enabled === false) return null;
    if (c.since) return c.since;
    const since = new Date().toISOString();
    tx.set(ref, { realMasters: { enabled: true, since } }, { merge: true });
    return since;
  });
}

// UD_LOCAL_NO_TRIGGERS=1 leaves this out on a workstation whose proxy blocks the emulator's trigger setup;
// the minute pass below still writes back, and CI runs with the trigger.
if (process.env.UD_LOCAL_NO_TRIGGERS !== '1') {
  exports.writeBackOnSave = onDocumentCreated({ document: 'outbox/{id}', maxInstances: 1, concurrency: 1 }, () => writeBackIfOn('live'));
  exports.masterWriteBackOnSave = onDocumentCreated({ document: 'masterOutbox/{id}', maxInstances: 1, concurrency: 1 }, () => writeBackIfOn('master'));
}
// Send Current Report: the email goes out after the save, so a slow or refused email never holds up the screen.
if (process.env.UD_LOCAL_NO_TRIGGERS !== '1') {
  exports.mailPlantReport = onDocumentCreated({ document: 'plantReports/{id}', timeoutSeconds: 60 }, (event) => {
    if (!event.data) return null;
    return mailReport(event.data.ref, event.data.data());
  });
}
exports.writeBackEveryMinute = onSchedule({ schedule: 'every 1 minutes', timeoutSeconds: 120, maxInstances: 1 }, () => writeBackIfOn('both'));

// Fleet list sync: reads the fleet list, writes only the Equipment Master copy the write-back writes (and the transfer reads).
// Production has no WRITEBACK_JSON masters, so there it writes the real Equipment Master only once config/app.fleetSyncReal
// .enabled is true (off until Joe OKs it; the current app's weekly sync stays in charge until then). A preview reads the
// real Equipment Master there and writes nothing.
function fleetSyncTarget() {
  if (!process.env.WRITEBACK_JSON || process.env.DEMO_DATA === '1') return null;
  const target = (JSON.parse(process.env.WRITEBACK_JSON).masters || {}).equipment;
  const source = transferSources(process.env).masters.equipment;
  if (!target || target.spreadsheetId !== source.spreadsheetId || target.tab !== source.tab) return null;
  return target;
}
const realEquipment = () => (realLive() ? require('./src/sources').UNIONTOWN.masters.equipment : null);
async function realFleetSyncOn() {
  return ((((await db.collection('config').doc('app').get()).data() || {}).fleetSyncReal) || {}).enabled === true;
}
// { target, allowReal } for a sync that writes, or null where none may run.
async function fleetSyncWrite() {
  const target = fleetSyncTarget();
  if (target) return { target, allowReal: false };
  const real = realEquipment();
  return real && (await realFleetSyncOn()) ? { target: real, allowReal: true } : null;
}

exports.fleetSyncNightly = onSchedule({ schedule: '0 2 * * *', timeZone: 'America/New_York', timeoutSeconds: 120, maxInstances: 1 }, async () => {
  const run = await fleetSyncWrite();
  if (!run) return;
  const sheets = makeSheetsWriter();
  await runFleetSync({ db, reader: sheets, sheets, target: run.target, allowReal: run.allowReal, by: 'nightly' });
});

// MOCREO sensors (src/mocreo.js): the key is read each run, so the sync starts by itself once a key is saved and tested.
exports.mocreoEvery5Minutes = onSchedule({ schedule: 'every 5 minutes', timeoutSeconds: 120, maxInstances: 1 }, async () => {
  if (!(await TOOLS.jobDue(db, 'mocreo'))) return;
  const project = process.env.GCLOUD_PROJECT || JSON.parse(process.env.FIREBASE_CONFIG || '{}').projectId;
  // The key saved in Administration > MOCREO & Sensors; else the Secret Manager secrets.
  const getSecrets = () => appSecrets(db, async () => {
    const { GoogleAuth } = require('google-auth-library');
    const token = await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getAccessToken();
    return readSecrets({ project, token, fetchFn: fetch });
  });
  await runMocreoSync({ db, getSecrets, fetchFn: fetch });
});

// Equipment's "Sync fleet list" button, and its "Preview fleet sync" ({preview: true}: writes nothing, lists every change).
exports.fleetSyncNow = onCall({ timeoutSeconds: 120, maxInstances: 1 }, async (request) => {
  const user = signedIn(request);
  const person = (await db.collection('users').doc(safeIdPart(user.email)).get()).data();
  if (!person || person.status !== 'ACTIVE' || !L.hasRole(person, ['ADMINISTRATOR', 'ADMIN', 'MANAGER'])) {
    throw new HttpsError('permission-denied', 'Only a manager or administrator can sync the fleet list');
  }
  const sheets = makeSheetsWriter();
  if (request.data && request.data.preview === true) {
    const target = fleetSyncTarget() || realEquipment();
    if (!target) throw new HttpsError('failed-precondition', 'The fleet list preview is not set up here');
    return runFleetSync({ db, reader: sheets, sheets, target, by: user.email, dryRun: true });
  }
  const run = await fleetSyncWrite();
  if (!run) throw new HttpsError('failed-precondition', 'The fleet list sync is not set up here; the current app syncs it every week');
  return runFleetSync({ db, reader: sheets, sheets, target: run.target, allowReal: run.allowReal, by: user.email });
});

// Reading devices (src/reader.js): a line PC posts {device, reads: [{upc, date}]} with the device's key; Receiving plugs in later.
const projectId = () => process.env.GCLOUD_PROJECT || JSON.parse(process.env.FIREBASE_CONFIG || '{}').projectId;
exports.deviceReads = onRequest({ maxInstances: 3, timeoutSeconds: 30 }, async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'POST the reads.' }); return; }
  try {
    const [status, body] = await READER.handleReads(db, req.headers, req.body);
    res.status(status).json(body);
  } catch (error) {
    console.error('deviceReads', error);
    res.status(500).json({ ok: false, error: 'The server could not count those jugs. Send them again.' });
  }
});
exports.lineReader = onCall({ timeoutSeconds: 30 }, async (request) => {
  const user = signedIn(request);
  try { return await READER.readerAll(db, user, request.data, { project: projectId() }); } catch (error) { throw asHttps(error); }
});
exports.productionEveryMinute = onSchedule({ schedule: 'every 1 minutes', timeoutSeconds: 60, maxInstances: 1 }, async () => {
  const done = await READER.readerMinute(db, { project: projectId() });
  if (done.length) console.log('production', done.join('; '));
});

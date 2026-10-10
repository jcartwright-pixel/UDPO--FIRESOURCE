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
 *   fleetSyncNightly      brings Equipment Master in step with the United Dairy fleet list every night (SANDBOX copy only)
 *   fleetSyncNow          the same from Equipment's "Sync fleet list" button, for a manager or administrator
 *   mailPlantReport       emails a plant report straight after Send Current Report saves it (reportmail.js; MAIL_FROM)
 *   mocreoEvery5Minutes   reads the MOCREO cooler sensors (read only) once a key is saved in Administration and tested
 *   mocreo                Administration > MOCREO & Sensors: save or replace the key (never shown again), test it, thermometer locations
 */
'use strict';

const admin = require('firebase-admin');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { setGlobalOptions } = require('firebase-functions/v2');
const { runTransfer } = require('./src/transfer');
const { applyAction, SaveError } = require('./src/actions');
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
  await runTransfer({ db, reader: setup.reader, sources: setup.sources });
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

const asHttps = (error) => (error instanceof SaveError || error instanceof SwitchError || error instanceof GpsError || error instanceof MocreoError ? new HttpsError(CODE[error.code] || 'failed-precondition', error.message, error.details || undefined) : error);

// Open to phones without a United Dairy account: every call is checked against the Route Distribution code.
exports.phone = onCall({ maxInstances: 3 }, async (request) => {
  try { return await phoneCall(db, request.data); } catch (error) { throw asHttps(error); }
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

exports.save = onCall(async (request) => {
  const user = signedIn(request);
  try {
    return await applyAction(db, user, request.data);
  } catch (error) {
    if (error instanceof SaveError) throw new HttpsError(CODE[error.code] || 'failed-precondition', error.message, error.details || undefined);
    throw error;
  }
});

// The write-back runs only when config/app.writeBack.enabled is true and WRITEBACK_JSON names the sandbox Live
// workbook ({"spreadsheetId": "..."}). One at a time, so saves reach the sheet in the order they were made.
async function writeBackIfOn(part) {
  const config = (await db.collection('config').doc('app').get()).data() || {};
  if (!config.writeBack || config.writeBack.enabled !== true || !process.env.WRITEBACK_JSON || process.env.DEMO_DATA === '1') return null;
  const target = JSON.parse(process.env.WRITEBACK_JSON);
  // The conflict check compares with what the copy last read, so the write-back must write the workbook the copy reads.
  if (target.spreadsheetId !== transferSources(process.env).live.spreadsheetId) {
    throw new Error('Write-back stopped: WRITEBACK_JSON and SOURCES_JSON must name the same sandbox Live workbook');
  }
  const sheets = makeSheetsWriter();
  const live = part === 'master' ? null : await runWriteBack({ db, sheets, target });
  // Master lists: only those WRITEBACK_JSON.masters names ({"drivers": {"spreadsheetId", "tab"}, ...}), each the same copy the
  // transfer reads (SOURCES_JSON), for the same reason as above.
  const masters = Object.assign({}, target.masters || {}), sources = transferSources(process.env).masters;
  Object.keys(masters).forEach(k => {
    if (!sources[k] || sources[k].spreadsheetId !== masters[k].spreadsheetId || sources[k].tab !== masters[k].tab) {
      throw new Error('Write-back stopped: WRITEBACK_JSON.masters.' + k + ' and SOURCES_JSON must name the same sandbox copy');
    }
  });
  // The maintenance queues are tabs of the same sandbox Live workbook.
  const { TABS, LISTS } = require('./src/maintenance');
  Object.keys(LISTS).forEach(k => { masters[LISTS[k]] = { spreadsheetId: target.spreadsheetId, tab: TABS[k] }; });
  const master = part !== 'live' && Object.keys(masters).length ? await runMasterWriteBack({ db, sheets, targets: masters }) : null;
  return { live, master };
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
// Production has no WRITEBACK_JSON, so there the current app's weekly sync stays in charge and this does nothing.
function fleetSyncTarget() {
  if (!process.env.WRITEBACK_JSON || process.env.DEMO_DATA === '1') return null;
  const target = (JSON.parse(process.env.WRITEBACK_JSON).masters || {}).equipment;
  const source = transferSources(process.env).masters.equipment;
  if (!target || target.spreadsheetId !== source.spreadsheetId || target.tab !== source.tab) return null;
  return target;
}

exports.fleetSyncNightly = onSchedule({ schedule: '0 2 * * *', timeZone: 'America/New_York', timeoutSeconds: 120, maxInstances: 1 }, async () => {
  const target = fleetSyncTarget();
  if (!target) return;
  const sheets = makeSheetsWriter();
  await runFleetSync({ db, reader: sheets, sheets, target, by: 'nightly' });
});

// MOCREO sensors (src/mocreo.js): the key is read each run, so the sync starts by itself once a key is saved and tested.
exports.mocreoEvery5Minutes = onSchedule({ schedule: 'every 5 minutes', timeoutSeconds: 120, maxInstances: 1 }, async () => {
  const project = process.env.GCLOUD_PROJECT || JSON.parse(process.env.FIREBASE_CONFIG || '{}').projectId;
  // The key saved in Administration > MOCREO & Sensors; else the Secret Manager secrets.
  const getSecrets = () => appSecrets(db, async () => {
    const { GoogleAuth } = require('google-auth-library');
    const token = await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getAccessToken();
    return readSecrets({ project, token, fetchFn: fetch });
  });
  await runMocreoSync({ db, getSecrets, fetchFn: fetch });
});

exports.fleetSyncNow = onCall({ timeoutSeconds: 120, maxInstances: 1 }, async (request) => {
  const user = signedIn(request);
  const person = (await db.collection('users').doc(safeIdPart(user.email)).get()).data();
  if (!person || person.status !== 'ACTIVE' || !L.hasRole(person, ['ADMINISTRATOR', 'ADMIN', 'MANAGER'])) {
    throw new HttpsError('permission-denied', 'Only a manager or administrator can sync the fleet list');
  }
  const target = fleetSyncTarget();
  if (!target) throw new HttpsError('failed-precondition', 'The fleet list sync is not set up here; the current app syncs it every week');
  const sheets = makeSheetsWriter();
  return runFleetSync({ db, reader: sheets, sheets, target, by: user.email });
});

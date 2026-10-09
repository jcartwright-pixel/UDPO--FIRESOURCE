/*
 * United Dairy Distribution app: server entry points (Firebase Cloud Functions).
 *
 *   transferEveryMinute   copies the Live tabs and master lists into the database (read-only on the sheets)
 *   transferNow           the same on request, for an administrator ("Reset test copy" rewrites every row)
 *   save                  every save from the screens, one call each
 *   writeBackOnSave       writes each save into the SANDBOX Live workbook (phase 2; production is refused)
 *   writeBackEveryMinute  retries anything the write-back could not finish
 */
'use strict';

const admin = require('firebase-admin');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { setGlobalOptions } = require('firebase-functions/v2');
const { runTransfer } = require('./src/transfer');
const { applyAction, SaveError } = require('./src/actions');
const { unitedDairyUser } = require('./src/auth');
const { makeSheetsReader, makeSheetsWriter } = require('./src/sheets');
const { runWriteBack } = require('./src/writeback');
const { transferSources } = require('./src/sources');
const { safeIdPart } = require('./src/model');

admin.initializeApp();
setGlobalOptions({ region: 'us-east4', maxInstances: 5 });
const db = admin.firestore();

const CODE = { BAD_REQUEST: 'invalid-argument', NOT_FOUND: 'not-found', NOT_ALLOWED: 'permission-denied', CHANGED: 'aborted' };

function signedIn(request) {
  const user = unitedDairyUser(request.auth);
  if (!user) throw new HttpsError('permission-denied', 'Sign in with your United Dairy Google account');
  return user;
}

exports.transferEveryMinute = onSchedule({ schedule: 'every 1 minutes', timeZone: 'America/New_York', timeoutSeconds: 120 }, async () => {
  await runTransfer({ db, reader: makeSheetsReader(), sources: transferSources(process.env) });
});

exports.transferNow = onCall({ timeoutSeconds: 120 }, async (request) => {
  const user = signedIn(request);
  const person = (await db.collection('users').doc(safeIdPart(user.email)).get()).data();
  if (!person || person.status !== 'ACTIVE' || (person.roles || []).indexOf('ADMINISTRATOR') < 0) {
    throw new HttpsError('permission-denied', 'Only an administrator can run the transfer by hand');
  }
  const result = await runTransfer({ db, reader: makeSheetsReader(), sources: transferSources(process.env), force: !!(request.data && request.data.resetTestCopy) });
  return { at: result.at, liveWeeks: result.liveWeeks, summary: result.summary, warningCount: result.warnings.length };
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
async function writeBackIfOn() {
  const config = (await db.collection('config').doc('app').get()).data() || {};
  if (!config.writeBack || config.writeBack.enabled !== true || !process.env.WRITEBACK_JSON) return null;
  const target = JSON.parse(process.env.WRITEBACK_JSON);
  // The conflict check compares with what the copy last read, so the write-back must write the workbook the copy reads.
  if (target.spreadsheetId !== transferSources(process.env).live.spreadsheetId) {
    throw new Error('Write-back stopped: WRITEBACK_JSON and SOURCES_JSON must name the same sandbox Live workbook');
  }
  return runWriteBack({ db, sheets: makeSheetsWriter(), target });
}

// UD_LOCAL_NO_TRIGGERS=1 leaves this out on a workstation whose proxy blocks the emulator's trigger setup;
// the minute pass below still writes back, and CI runs with the trigger.
if (process.env.UD_LOCAL_NO_TRIGGERS !== '1') {
  exports.writeBackOnSave = onDocumentCreated({ document: 'outbox/{id}', maxInstances: 1, concurrency: 1 }, writeBackIfOn);
}
exports.writeBackEveryMinute = onSchedule({ schedule: 'every 1 minutes', timeoutSeconds: 120, maxInstances: 1 }, writeBackIfOn);

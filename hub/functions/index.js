/*
 * The United Dairy Hub's server: one call, hub. It runs in the same Firebase project as Operations (its own group of functions,
 * "hub"), so the same United Dairy Google sign-in and Users list apply.
 */
'use strict';
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');

initializeApp();
setGlobalOptions({ region: 'us-east4', maxInstances: 5 });
const db = getFirestore();
const { unitedDairyUser } = require('./src/auth');

const CODES = { NOT_ALLOWED: 'permission-denied', BAD_REQUEST: 'invalid-argument', NOT_FOUND: 'not-found' };

exports.hub = onCall({ timeoutSeconds: 30 }, async (request) => {
  const user = unitedDairyUser(request.auth);
  if (!user) throw new HttpsError('permission-denied', 'Sign in with your United Dairy Google account');
  const H = require('./src/hub');
  try {
    return await H.hubCall(db, user, request.data || {}, { dbFor: (name) => (!name || name === '(default)' ? db : getFirestore(name)) });
  } catch (error) {
    if (error instanceof H.HubError) throw new HttpsError(CODES[error.code] || 'failed-precondition', error.message);
    console.error('hub', error);
    throw new HttpsError('internal', 'internal');
  }
});

/*
 * The route customer list through the Hub (Joe 11-9-26): hubRouteMaster/<plant> and hubCustomers/<plant>, built from the
 * Customer List's records (read only) and read by every other app. src/routemaster.js says how.
 */
// The Customer List rewrites udclRouteMaster/<plant> after every change it makes: the Hub's copy follows at once.
exports.hubRouteMasterOnChange = onDocumentWritten({ document: 'udclRouteMaster/{plant}', timeoutSeconds: 120, memory: '512MiB', maxInstances: 1 }, async (event) => {
  if (!event.data || !event.data.after || !event.data.after.exists) return;
  await require('./src/routemaster').rebuildPlant(db, event.params.plant);
});
// A new week of the weekly route report changes the case columns on every plant.
exports.hubRouteMasterOnWeek = onDocumentWritten({ document: 'routeWeekly/{week}', timeoutSeconds: 300, memory: '512MiB', maxInstances: 1 }, async () => {
  await require('./src/routemaster').rebuildAll(db);
});
// Every hour as well, in case a change reached the list some other way.
exports.hubRouteMasterHourly = onSchedule({ schedule: 'every 60 minutes', timeZone: 'America/New_York', timeoutSeconds: 300, memory: '512MiB', maxInstances: 1 }, async () => {
  console.log('hubRouteMaster', JSON.stringify(await require('./src/routemaster').rebuildAll(db)));
});

/*
 * The shared cost rules (Joe 11-12-26): hubCostRules/current, read by Route Cost Analysis and the Route & Trip Estimator.
 * src/costrules.js says how. Rebuilt when Route Cost's rates or rule set, a saved Hub rule set or a fuel quote changes, and
 * every hour (the truck trips change all day).
 */
const costRebuild = () => require('./src/costrules').rebuild(db);
exports.hubCostRulesOnRates = onDocumentWritten({ document: 'routeCostRates/current', timeoutSeconds: 120, memory: '512MiB', maxInstances: 1 }, costRebuild);
exports.hubCostRulesOnRules = onDocumentWritten({ document: 'routeCostRules/current', timeoutSeconds: 120, memory: '512MiB', maxInstances: 1 }, costRebuild);
exports.hubCostRulesOnQuote = onDocumentWritten({ document: 'fuelQuotes/{id}', timeoutSeconds: 120, memory: '512MiB', maxInstances: 1 }, costRebuild);
exports.hubCostRulesHourly = onSchedule({ schedule: 'every 60 minutes', timeZone: 'America/New_York', timeoutSeconds: 300, memory: '512MiB', maxInstances: 1 }, async () => {
  console.log('hubCostRules', JSON.stringify(await costRebuild()));
});

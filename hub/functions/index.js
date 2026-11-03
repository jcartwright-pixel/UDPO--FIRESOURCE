/*
 * The United Dairy Hub's server: one call, hub. It runs in the same Firebase project as Operations (its own group of functions,
 * "hub"), so the same United Dairy Google sign-in and Users list apply.
 */
'use strict';
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');

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
    return await H.hubCall(db, user, request.data || {});
  } catch (error) {
    if (error instanceof H.HubError) throw new HttpsError(CODES[error.code] || 'failed-precondition', error.message);
    console.error('hub', error);
    throw new HttpsError('internal', 'internal');
  }
});

'use strict';
/*
 * Test helpers: the local Firestore emulator (db, clear) and the hub call answered in this process, as index.js answers
 * it, with the signed-in person from the auth emulator's token (so the browser tests need no functions emulator).
 */
const admin = require('firebase-admin');
const PROJECT = 'demo-ud-distribution';

function db() {
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  return admin.firestore();
}
async function clear() {
  const res = await fetch('http://' + process.env.FIRESTORE_EMULATOR_HOST + '/emulator/v1/projects/' + PROJECT + '/databases/(default)/documents', { method: 'DELETE' });
  if (!res.ok) throw new Error('could not clear the emulator: ' + res.status);
}
const CODES = { NOT_ALLOWED: 'PERMISSION_DENIED', BAD_REQUEST: 'INVALID_ARGUMENT', NOT_FOUND: 'NOT_FOUND', CHANGED: 'ABORTED' };
async function localCalls(ctx) {
  const { unitedDairyUser } = require('../src/auth');
  const C = require('../src/hub');
  await ctx.route(/:5001\/[^/]+\/[^/]+\/hub$/, async (route) => {
    const req = route.request(), data = (req.postDataJSON() || {}).data || {};
    let token = null;
    try { token = JSON.parse(Buffer.from(String(req.headers().authorization || '').split(' ')[1].split('.')[1], 'base64url').toString()); } catch (e) { /* no sign-in */ }
    const fail = (status, message) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ error: { status, message } }) });
    const user = unitedDairyUser(token && { uid: token.user_id, token });
    if (!user) return fail('PERMISSION_DENIED', 'Sign in with your United Dairy Google account');
    try {
      const result = await C.hubCall(db(), user, data);
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ result }) });
    } catch (e) {
      if (e instanceof C.HubError) return fail(CODES[e.code] || 'FAILED_PRECONDITION', e.message);
      return fail('INTERNAL', 'internal');
    }
  });
}
module.exports = { PROJECT, db, clear, localCalls };

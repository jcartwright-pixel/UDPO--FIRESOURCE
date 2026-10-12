'use strict';
/*
 * LOCAL_CALLS=1: answer the admin, stationRelease and garage callables in this process (the functions emulator cannot run
 * everywhere). The signed-in person comes from the auth emulator's token. CI runs the real functions emulator instead.
 */
const { db } = require('../emulator/helpers');

// index.js stationSignIn, with the auth emulator's sign-in token.
async function stationSignIn(input) {
  const A = require('../../src/admin'), ST = require('../../src/stations');
  if (input.op === 'status' || input.op === 'release') return A.releaseCheck(db(), input);
  const r = await ST.signIn(db(), input);
  if (!r.ok || input.op !== 'enter') return r;
  const admin = require('firebase-admin');
  const token = await admin.auth().createCustomToken('station-' + r.station.key, { udStation: r.station.key, udVersion: r.station.version, udPlant: r.station.facilityId, udName: r.station.name, udType: r.station.type });
  return Object.assign({ token }, r);
}

module.exports = async function localCalls(page) {
  if (!process.env.LOCAL_CALLS) return;
  const A = require('../../src/admin'), { garageCall } = require('../../src/garage');
  await page.route(/:5001\/[^/]+\/[^/]+\/(admin|stationRelease|garage|stationSignIn|setSwitch)$/, async (route) => {
    const req = route.request(), name = req.url().split('/').pop(), data = (req.postDataJSON() || {}).data || {};
    let user = null;
    try { user = JSON.parse(Buffer.from(String(req.headers().authorization || '').split(' ')[1].split('.')[1], 'base64url').toString()); } catch (e) { /* no sign-in */ }
    try {
      const result = name === 'garage' ? await garageCall(db(), data) : name === 'admin' ? await A.adminCall(db(), user, data, {}) : name === 'stationSignIn' ? await stationSignIn(data) : name === 'setSwitch' ? await require('../../src/switch').setSwitch(db(), user, data, true) : await A.stationRelease(db(), user, data);
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ result }) });
    } catch (e) { await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { status: 'FAILED_PRECONDITION', message: e.message } }) }); }
  });
};

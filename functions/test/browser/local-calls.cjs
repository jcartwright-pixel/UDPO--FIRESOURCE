'use strict';
/*
 * LOCAL_CALLS=1: answer the admin, stationRelease, garage, phone, save and sms callables in this process (the functions emulator cannot run
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

// index.js phone (the drivers' phones and the Driver Room Check-In tablet).
async function phoneLocal(input) {
  if (input.op === 'roomStatus' || input.op === 'roomRelease') return require('../../src/admin').releaseCheck(db(), { op: input.op === 'roomStatus' ? 'status' : 'release', facilityId: input.facilityId, code: input.code });
  return require('../../src/phone').phoneCall(db(), input);
}

// index.js stationRelease, with Send to TV's token for the TV (Joe 10/16).
async function stationReleaseLocal(user, input) {
  const r = await require('../../src/admin').stationRelease(db(), user, input);
  if (input.op === 'tvSend' && r.ok) r.token = await require('firebase-admin').auth().createCustomToken('tv-' + r.station.key, { udTv: r.station.key, udTvVersion: r.station.version, udPlant: r.station.facilityId, udName: r.station.name });
  return r;
}

const { unitedDairyUser } = require('../../src/auth');

module.exports = async function localCalls(page) {
  if (!process.env.LOCAL_CALLS) return;
  const A = require('../../src/admin'), { garageCall } = require('../../src/garage');
  await page.route(/:5001\/[^/]+\/[^/]+\/(admin|stationRelease|garage|stationSignIn|setSwitch|phone|save|sms)$/, async (route) => {
    const req = route.request(), name = req.url().split('/').pop(), data = (req.postDataJSON() || {}).data || {};
    let user = null;
    try { user = JSON.parse(Buffer.from(String(req.headers().authorization || '').split(' ')[1].split('.')[1], 'base64url').toString()); } catch (e) { /* no sign-in */ }
    try {
      // index.js phone: the Driver Room Check-In Station needs a United Dairy sign-in first (Joe 10/12).
      if (name === 'phone' && (/^room/.test(String(data.op || '')) || data.station) && !unitedDairyUser(user && { uid: user.user_id, token: user })) throw new Error('Sign in with a United Dairy account on the Driver Station link first.');
      if (name === 'garage' && data.station && !unitedDairyUser(user && { uid: user.user_id, token: user })) throw new Error('Sign in with the tablet\'s United Dairy account on the Garage Station first.');
      // index.js save: a United Dairy account, or a Plant Station signed in by its code.
      if (name === 'save') {
        const { applyAction, checkSaves } = require('../../src/actions');
        let u = unitedDairyUser(user && { uid: user.user_id, token: user });
        if (!u && user && user.udStation) { const st = await require('../../src/stations').stationSaver(db(), user); if (st) u = { uid: user.user_id, email: 'station:' + st.key, station: st }; }
        if (!u) throw new Error('Sign in first.');
        const result = Array.isArray(data.checkSaves) ? { allowed: await checkSaves(db(), u, data.checkSaves) } : await applyAction(db(), u, data);
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ result }) });
        return;
      }
      const result = name === 'phone' ? await phoneLocal(data) : name === 'garage' ? await garageCall(db(), data, undefined, { user: unitedDairyUser(user && { uid: user.user_id, token: user }), claims: user }) : name === 'admin' ? await A.adminCall(db(), user, data, {}) : name === 'stationSignIn' ? await stationSignIn(data) : name === 'setSwitch' ? await require('../../src/switch').setSwitch(db(), user, data, true) : name === 'sms' ? await require('../../src/sms').smsCall(db(), user, data) : await stationReleaseLocal(user, data);
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ result }) });
    } catch (e) { await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { status: 'FAILED_PRECONDITION', message: e.message } }) }); }
  });
};

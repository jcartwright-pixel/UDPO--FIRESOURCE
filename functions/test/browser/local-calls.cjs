'use strict';
/*
 * LOCAL_CALLS=1: answer the admin, stationRelease and garage callables in this process (the functions emulator cannot run
 * everywhere). The signed-in person comes from the auth emulator's token. CI runs the real functions emulator instead.
 */
const { db } = require('../emulator/helpers');

module.exports = async function localCalls(page) {
  if (!process.env.LOCAL_CALLS) return;
  const A = require('../../src/admin'), { garageCall } = require('../../src/garage');
  await page.route(/:5001\/[^/]+\/[^/]+\/(admin|stationRelease|garage)$/, async (route) => {
    const req = route.request(), name = req.url().split('/').pop(), data = (req.postDataJSON() || {}).data || {};
    let user = null;
    try { user = JSON.parse(Buffer.from(String(req.headers().authorization || '').split(' ')[1].split('.')[1], 'base64url').toString()); } catch (e) { /* no sign-in */ }
    try {
      const result = name === 'garage' ? await garageCall(db(), data) : name === 'admin' ? await A.adminCall(db(), user, data, {}) : await A.stationRelease(db(), user, data);
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ result }) });
    } catch (e) { await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { status: 'FAILED_PRECONDITION', message: e.message } }) }); }
  });
};

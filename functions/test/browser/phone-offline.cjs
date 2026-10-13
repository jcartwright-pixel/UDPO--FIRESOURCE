'use strict';
/*
 * Browser check of the drivers' phone with no signal (Joe 10/12: "if the driver doesn't have cell service and types in his
 * stuff, then comes in"). On an Android phone (390 wide) with the screen cache on: the Route page opens again with no
 * signal, a Check-In made with no signal is kept on the phone (it survives closing the page), the line says what waits,
 * and when the signal is back it is sent once and shows Checked in. Pictures at 390 go to SHOTS_DIR.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium, devices } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const F = require('../fixtures/fake-sheets');
const L = require('../../src/logic');
const { newRouteCode } = require('../../src/phone');
const localCalls = require('./local-calls.cjs');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR;
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, name) }); };

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: () => new Date('2026-10-09T12:00:00Z') });
  const today = L.operatingDay(new Date()), p = L.dayPrefix(today), runId = L.weekStart(today) + '__run_off802';
  await db().collection('runs').doc(runId).set({ weekStart: L.weekStart(today), route: '802', run: 'UT DSD MILK', routeId: 'rte_t802', runId: 'run_off802', rev: 0,
    days: { [p]: { runs: true, driverId: 'drv_test_casey', driver: 'CASEY, LEE', truck: '900002', trailer: 'T-902' } } });
  const { code } = await newRouteCode(db(), { email: 'manager.test@uniteddairy.com' });
  const browser = await chromium.launch();
  const results = [];
  try {
    // An Android phone with the screen cache on. Routing on the context also serves the Firebase code and the phone calls to
    // the service worker.
    const ctx = await browser.newContext(Object.assign({}, devices['Pixel 7'], { viewport: { width: 390, height: 844 }, serviceWorkers: 'allow' }));
    await ctx.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
      route.fulfill({ contentType: 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
    });
    await localCalls(ctx);
    // With no signal the phone calls fail as on a real phone (the local answers above would otherwise still reply).
    let offline = false;
    await ctx.route(/:5001\//, (route) => (offline ? route.abort('internetdisconnected') : route.fallback()));
    const setOffline = async (on) => { offline = on; await ctx.setOffline(on); };
    const ph = await ctx.newPage();
    const errors = [];
    ph.on('pageerror', e => errors.push(e.message));
    await ph.goto(HOSTING + '/route.html');
    await ph.fill('#code', code);
    await ph.click('#step-code button[type=submit]');
    await ph.click('#m-checkin');
    await ph.waitForSelector('#step-name:not([hidden]) #name option[value="drv_test_casey"]', { state: 'attached' });
    await ph.selectOption('#name', 'drv_test_casey');
    await ph.click('#step-name button[type=submit]');
    await ph.waitForSelector('.phone-load');
    // The first visit keeps the page and the Firebase code on the phone.
    await ph.waitForFunction(async () => { if (!navigator.serviceWorker.controller) { return false; } const c = await caches.open('ud-offline-v1'); return !!(await c.match('route.html')) && !!(await c.match('js/phone-queue.js')) && (await Promise.all(['app', 'auth', 'firestore', 'functions'].map(n => c.match('https://www.gstatic.com/firebasejs/12.18.0/firebase-' + n + '.js')))).every(Boolean); }, null, { timeout: 20000 })
      .catch(async () => { await ph.reload(); await ph.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 20000 }); });

    // No signal: the Check-In is kept on the phone, the load says Saved on phone, and the line says one waits.
    await setOffline(true);
    await ph.click('.phone-load');
    await ph.waitForSelector('#step-form:not([hidden])');
    await ph.fill('#step-form input[name=casesDelivered]', '377');
    await ph.click('#step-form .ci-loaded label:has([value=YES])');
    await ph.click('#send');
    await ph.waitForSelector('.phone-load.queued span:text-is("Saved on phone")', { timeout: 10000 });
    assert.match(await ph.textContent('#offline-line'), /Saved on this phone, will send when you have signal\. Waiting: 1/);
    assert.equal(await ph.isVisible('#error'), false, 'no error with no signal: it is saved on the phone');
    assert.equal(await ph.isVisible('text=Changes will not save'), false, 'no "will not save" bar: it is saved on the phone');
    await shot(ph, 'phone-offline-saved-390.png');
    // Closing the page and opening it again with no signal: the page opens from the phone, the Check-In still waits.
    await ph.reload();
    await ph.waitForSelector('#step-menu:not([hidden]) #m-checkin', { timeout: 15000 });
    await ph.click('#m-checkin');
    await ph.waitForSelector('.phone-load.queued', { timeout: 10000 });
    assert.match(await ph.textContent('#offline-line'), /Waiting: 1/);
    await shot(ph, 'phone-offline-reopened-390.png');
    assert.equal((await db().collection('runs').doc(runId).get()).data().days[p].checkinCompletedAt, undefined, 'nothing reached the server yet');
    results.push('No signal: the Route page opens from the phone, a Check-In is kept on the phone (also after closing the page), the load shows Saved on phone and the line counts what waits');

    // The signal is back: it is sent by itself, once, and the load shows Checked in.
    await setOffline(false);
    await ph.waitForSelector('#offline-line.ok', { timeout: 30000 });
    assert.match(await ph.textContent('#offline-line'), /Sent/);
    await ph.waitForSelector('.phone-load.done span:text-is("Checked in")', { timeout: 15000 });
    await shot(ph, 'phone-offline-sent-390.png');
    const day = (await db().collection('runs').doc(runId).get()).data().days[p];
    assert.equal(String(day.casesDelivered), '377');
    assert.ok(day.checkinCompletedAt);
    const logs = await db().collection('actions').where('runDocId', '==', runId).get().catch(() => null);
    if (logs) assert.ok(logs.size <= 1, 'saved once');
    assert.deepEqual(errors, []);
    results.push('Signal back: the waiting Check-In is sent by itself, saved once, the line says Sent and the load shows Checked in');
    await ctx.close();
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('OK  ' + r));
})().catch(e => { console.error(e); process.exit(1); });

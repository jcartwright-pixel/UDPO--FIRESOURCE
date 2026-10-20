'use strict';
/*
 * Joe 10/20 (4:43 PM, "This is the next day, but it is showing that truck is getting loaded. That's an error"): while
 * Tuesday's shift is still running, Wednesday's Daily Case Loadout shows only Wednesday's loads: no "PRIOR DAY LOADS", no
 * Left over, nothing Behind, and the load being loaded shows on its own day only. After the 6 a.m. roll Tuesday's open loads
 * still carry over to Wednesday, first in line and behind (Joe 10/20, "nothing resets at 6 a.m."). Pictures go to SHOTS_DIR.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const localCalls = require('./local-calls.cjs');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR || '';
const MANAGER = 'testEmail=manager.test@uniteddairy.com';
const DURING = '2026-10-20T20:43:00Z'; // Tuesday 4:43 PM in New York: Tuesday's shift is running
const AFTER = '2026-10-21T10:10:00Z'; // Wednesday 6:10 AM: Tuesday's shift is over
const T = (h, m) => h * 60 + (m || 0);
// Tuesday's loads (loaded Tue 10-20 for Wed 10-21): two done, one being loaded, three waiting. Made-up drivers.
const TUE = [['855', 'SAVE-A-LOT 1', 10, T(8), 'PARK, DANA', 'DONE'], ['852', 'JERSEY LOAD 1', 20, T(13), 'LOPEZ, RAY', 'DONE'],
  ['6302', 'UT WALMART', 30, T(3), 'BRANDT, OWEN', 'LOADING'], ['854', 'CREAMOLAND', 40, T(2), 'FOSTER, LEE', ''],
  ['824', 'DSD', 50, T(1), 'NOLAN, TESS', ''], ['812', 'DSD', 60, T(5), 'REYES, SAM', '']];
// Wednesday's own loads (loaded Wed 10-21 for Thu 10-22).
const WED = [['855', 'SAVE-A-LOT 1', 10, T(8), 'PARK, DANA'], ['808', 'DSD', 20, T(4), 'HALE, JUNE'], ['822', 'DSD', 30, T(4, 30), 'ODOM, KAI']];

async function openPage(browser, url, w, h, now, opts) {
  const page = await browser.newPage(Object.assign({ viewport: { width: w, height: h }, serviceWorkers: 'block' }, opts || {}));
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
  });
  await localCalls(page);
  await page.clock.install({ time: new Date(now) });
  await page.clock.resume();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.errors = errors;
  await page.goto(HOSTING + url);
  return page;
}

(async () => {
  await clear();
  const d = db();
  const { runTransfer } = require('../../src/transfer');
  const F = require('../fixtures/fake-sheets');
  const PD = require('../fixtures/plant-demo');
  await runTransfer({ db: d, reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date('2026-10-08T14:00:00Z') });
  for (const c of ['runs', 'pickups', 'plantJournal', 'plantReports']) for (const r of (await d.collection(c).get()).docs) await r.ref.delete();
  let row = 10;
  const put = async (id, route, run, key, day) => d.collection('runs').doc('2026-10-18__' + id).set({ weekStart: '2026-10-18', sheetRow: row++, route, run, routeId: 'rte_' + id, runId: 'run_' + id, active: true,
    loadType: 'Case Loadout', masterShow: { leavesOn: 'DELIVERY DAY' }, days: { [key]: day } });
  for (const [route, run, seq, time, driver, state] of TUE) {
    const day = { runs: true, loadDayOffset: -1, loadDate: '2026-10-20', deliveryDate: '2026-10-21', departureDate: '2026-10-21', dispatchTime: time, loadSequence: seq, driver, truck: '2238' + seq, trailer: 'T-9' + seq };
    if (state === 'DONE') Object.assign(day, { casesOut: 1100, plantStartedAt: '2026-10-20T17:00:00Z', completeTime: '2026-10-20T17:50:00Z', loadStatus: 'COMPLETE' });
    if (state === 'LOADING') Object.assign(day, { plantStartedAt: '2026-10-20T19:57:00Z', loadStatus: 'LOADING' });
    await put('tue' + route, route, run, 'wed', day);
  }
  for (const [route, run, seq, time, driver] of WED) {
    await put('wed' + route, route, run, 'thu', { runs: true, loadDayOffset: -1, loadDate: '2026-10-21', deliveryDate: '2026-10-22', departureDate: '2026-10-22', dispatchTime: time, loadSequence: seq, driver, truck: '2240' + seq, trailer: 'T-8' + seq });
  }
  const browser = await chromium.launch();
  const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }); };
  const routesOn = (page) => page.$$eval('#rows tr[data-row] td:first-child', tds => tds.map(td => td.textContent));
  try {
    // Tuesday 4:43 PM, looking at Wednesday: only Wednesday's three loads, nothing left over or behind.
    for (const [w, h] of [[1536, 790], [1920, 950], [1024, 768], [390, 844]]) {
      const page = await openPage(browser, '/loadout.html?date=2026-10-21&area=CASE&' + MANAGER, w, h, DURING);
      await page.waitForFunction(() => /\bRUNS\b/i.test(document.body.innerText) && document.querySelectorAll('#rows tr[data-row]').length > 0, null, { timeout: 20000 });
      await page.waitForTimeout(500);
      await shot(page, 'next-day-wednesday-' + w);
      const body = await page.evaluate(() => document.body.innerText);
      assert.deepEqual((await routesOn(page)).sort(), ['808', '822', '855'], 'only Wednesday\'s own loads (' + w + ')');
      assert.equal(await page.$('.divider.prior'), null, 'no PRIOR DAY LOADS before Tuesday\'s shift is over');
      assert.match(body, /Left over\s*0/);
      assert.match(body, /Behind\s*0/);
      assert.match(body, /Loading\s*0/, 'the truck being loaded on Tuesday does not show as loading on Wednesday');
      assert.deepEqual(page.errors, []);
      await page.close();
    }

    // Tuesday itself: the load being loaded is there, as loading.
    {
      const page = await openPage(browser, '/loadout.html?date=2026-10-20&area=CASE&' + MANAGER, 1536, 790, DURING);
      await page.waitForFunction(() => document.querySelectorAll('#rows tr[data-row]').length === 6, null, { timeout: 20000 });
      await shot(page, 'next-day-tuesday-1536');
      const body = await page.evaluate(() => document.body.innerText);
      assert.match(body, /Loading\s*1/);
      assert.match(body, /Left over\s*0/);
      assert.deepEqual(page.errors, []);
      await page.close();
    }

    // Wednesday 6:10 AM: Tuesday's four open loads now carry over, first and behind; Wednesday's follow.
    {
      const page = await openPage(browser, '/loadout.html?area=CASE&' + MANAGER, 1536, 790, AFTER);
      await page.waitForFunction(() => /Left over\s*4/.test(document.body.innerText), null, { timeout: 20000 });
      await shot(page, 'next-day-after-6am-1536');
      const routes = await routesOn(page);
      assert.deepEqual(routes.slice(0, 4).sort(), ['6302', '812', '824', '854'], 'Tuesday\'s open loads are first');
      assert.deepEqual(routes.slice(4).sort(), ['808', '822', '855']);
      assert.match(await page.textContent('.divider.prior'), /PRIOR DAY LOADS · 10-20-26/);
      assert.match(await page.evaluate(() => document.body.innerText), /Behind\s*4/);
      assert.deepEqual(page.errors, []);
      await page.close();
    }
    console.log('next-day: ok');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });

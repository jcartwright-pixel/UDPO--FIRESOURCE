'use strict';
/*
 * Browser check of the stations with no signal (Joe 10/13: Plant, Garage and the TV "yes"). With the signal gone the station
 * opens again from the tablet, shows what it last read, a save waits on the tablet with "Saved on this tablet" and is sent
 * once when the signal is back. Pictures at 1024 go to SHOTS_DIR.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const F = require('../fixtures/fake-sheets');
const PD = require('../fixtures/plant-demo');
const G = require('../fixtures/garage-demo');
const localCalls = require('./local-calls.cjs');
const L = require('../../src/logic');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR;
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, name) }); };
const MANAGER = '?testEmail=manager.test@uniteddairy.com';

// A tablet with the screen cache on; offline() also fails the server calls as a tablet with no signal would.
async function tablet(browser, clock) {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true, serviceWorkers: 'allow' });
  await ctx.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    route.fulfill({ contentType: 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
  });
  await ctx.route(/api\.open-meteo\.com/, route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({
    current: { temperature_2m: 54.4, weather_code: 2, wind_speed_10m: 7.6 },
    daily: { weather_code: [2, 61], temperature_2m_max: [61.2, 58], temperature_2m_min: [43.8, 47.1], precipitation_probability_max: [20, 70] } }) }));
  await localCalls(ctx);
  let off = false;
  await ctx.route(/:5001\/|:8080\/|:9099\//, (route) => (off ? route.abort('internetdisconnected') : route.fallback()));
  const page = await ctx.newPage();
  if (clock) await page.clock.setFixedTime(new Date(clock));
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const offline = async (on) => { off = on; await ctx.setOffline(on); };
  return { ctx, page, errors, offline };
}
// The first visit keeps the screen and the Firebase code on the tablet.
async function kept(page, files) {
  await page.waitForFunction(async (files) => {
    if (!navigator.serviceWorker.controller) return false;
    const c = await caches.open('ud-offline-v1');
    for (const f of files) if (!(await c.match(f))) return false;
    return !!(await c.match('js/firebase.js')) && (await Promise.all((await import('/js/firebase.js')).FIREBASE_FILES.map(u => c.match(u)))).every(Boolean);
  }, files, { timeout: 30000 }).catch(async () => { await page.reload(); await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 20000 }); await page.waitForTimeout(6000); });
}

(async () => {
  const browser = await chromium.launch();
  const results = [];
  try {
    // ---- Plant Station (Case Loadout) on the made-up plant day.
    await clear();
    await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date('2026-10-08T14:00:00Z') });
    {
      const { ctx, page, errors, offline } = await tablet(browser, '2026-10-08T14:00:00Z');
      await page.goto(HOSTING + '/plant-station.html' + MANAGER);
      await page.waitForSelector('[data-station="CASE"]');
      await page.click('[data-station="CASE"]');
      await page.waitForSelector('#work .sw-card');
      await page.waitForTimeout(6500);
      await kept(page, ['plant-station.html', 'js/station-work.js', 'js/offline-saves.js', 'css/stations.css']);
      // Case Loadout loads 2 at a time and the made-up day has 2 loading: pause one first (online).
      const p808 = '#work .sw-card[data-sw="2026-10-04__run_p808|fri"]';
      await page.click(p808 + ' [data-act="pause"]');
      await page.fill(p808 + ' [data-k="pauseReason"]', 'Waiting on product');
      await page.click(p808 + ' [data-act="pausego"]');
      await page.waitForSelector(p808 + '.paused', { timeout: 10000 });
      for (let i = 0; i < 100 && (await db().collection('runs').doc('2026-10-04__run_p808').get()).data().days.fri.loadStatus !== 'PAUSED'; i++) await new Promise(r => setTimeout(r, 100));
      await page.waitForTimeout(2500); // the tablet hears the pause and keeps it

      await offline(true);
      await page.reload();
      await page.waitForSelector('#work .sw-card', { timeout: 20000 });
      assert.equal(await page.textContent('#title'), 'Case Loadout', 'the station opens from the tablet with no signal');
      assert.match(await page.textContent('#offline-line'), /No signal\. What you enter is saved on this tablet/);
      const at = '#work .sw-card[data-sw="2026-10-04__run_p811|fri"]';
      await page.click(at + ' [data-act="start"]');
      await page.waitForFunction(() => /Saved on this tablet, will send when you have signal\. Waiting: 1/.test(document.getElementById('offline-line').textContent), null, { timeout: 10000 });
      assert.equal(await page.isVisible('#error'), false, 'no error with no signal: it is saved on the tablet');
      // The card shows the tap at once, marked as waiting to be sent.
      await page.waitForSelector(at + '.run .sw-flag.wait:text-is("WAITING TO SEND")', { timeout: 10000 });
      assert.ok(parseFloat(await page.$eval(at + ' .sw-flag.wait', e => getComputedStyle(e).fontSize)) >= 16);
      await page.$eval(at, e => e.scrollIntoView({ block: 'center' }));
      await shot(page, 'station-offline-plant-waiting-card-1024.png');
      await page.evaluate(() => window.scrollTo(0, 0));
      await shot(page, 'station-offline-plant-saved-1024.png');
      assert.equal((await db().collection('runs').doc('2026-10-04__run_p811').get()).data().days.fri.loadStatus || '', '', 'nothing reached the server yet');
      results.push('Plant Station: with no signal it opens from the tablet with its loads, and Start is kept on the tablet with "Saved on this tablet ... Waiting: 1"');

      await offline(false);
      await page.waitForSelector('#offline-line.ok', { timeout: 40000 });
      assert.match(await page.textContent('#offline-line'), /Sent ✓/);
      await page.waitForSelector(at + '.run', { timeout: 15000 });
      await page.waitForSelector(at + ' .sw-flag.wait', { state: 'detached', timeout: 15000 });
      assert.equal((await db().collection('runs').doc('2026-10-04__run_p811').get()).data().days.fri.loadStatus, 'LOADING');
      const logs = await db().collection('actions').where('action', '==', 'savePlantLoad').get();
      assert.equal(logs.docs.filter(d => d.data().runDocId === '2026-10-04__run_p811').length, 1, 'saved once');
      await shot(page, 'station-offline-plant-sent-1024.png');
      assert.deepEqual(errors, []);
      results.push('Plant Station: signal back, the waiting Start is sent by itself, once, and the card shows LOADING');
      await ctx.close();
    }

    // ---- Driver's Kiosk Station (TV): the last board stays with no signal.
    await clear();
    await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: () => new Date() });
    // The made-up weeks do not load on every day (nothing loads on a Tuesday), so one load for today is added: the board
    // then has a row whatever day the check runs.
    {
      const delivery = L.addDays(L.operatingDay(new Date()), 1), wk = L.weekStart(delivery);
      await db().collection('runs').doc(wk + '__run_tv805').set({ weekStart: wk, route: '805', run: 'UT DSD MILK', routeId: 'rte_tv805', runId: 'run_tv805', rev: 0,
        days: { [L.dayPrefix(delivery)]: { runs: true, loadSequence: 15, driverId: 'drv_test_casey', driver: 'CASEY, LEE', truck: '900005', trailer: 'T-905' } } });
    }
    {
      const { ctx, page, errors, offline } = await tablet(browser);
      await page.goto(HOSTING + '/driver-station.html' + MANAGER + '&tv=1');
      await page.waitForSelector('#screen:not([hidden])');
      await page.waitForTimeout(6500);
      await kept(page, ['driver-station.html', 'js/board-rules.js', 'js/offline-saves.js']);
      await page.waitForSelector('.ds-row:not(.ds-headrow)');
      const before = await page.$$eval('.ds-row:not(.ds-headrow)', r => r.length);
      assert.ok(before > 0, 'the board has loads');
      await offline(true);
      await page.reload();
      await page.waitForSelector('#screen:not([hidden])', { timeout: 20000 });
      await page.waitForFunction((n) => document.querySelectorAll('.ds-row:not(.ds-headrow)').length === n, before, { timeout: 20000 }).catch(() => {});
      assert.equal(await page.$$eval('.ds-row:not(.ds-headrow)', r => r.length), before, 'the same board as before the signal went');
      assert.match(await page.textContent('#foot'), /No signal · last board from/);
      await shot(page, 'station-offline-tv-1024.png');
      // Joe 10/16 (Fire Stick): a TV that started with no signal reloads by itself when the signal comes back.
      await Promise.all([page.waitForEvent('load', { timeout: 30000 }), offline(false)]);
      await page.waitForFunction(() => /Updated /.test(document.getElementById('foot').textContent), null, { timeout: 30000 });
      assert.deepEqual(errors, []);
      results.push('Driver\'s Kiosk Station: with no signal it opens from the tablet and shows the last board, saying when it was from; it reloads by itself when the signal is back');
      await ctx.close();
    }

    // ---- Garage Station: the last list stays, a Start with a mechanic's name and login ID waits on the tablet.
    await clear();
    await runTransfer({ db: db(), reader: F.fakeReader(G.sheets()), sources: G.SOURCES, now: () => new Date() });
    {
      const { ctx, page, errors, offline } = await tablet(browser);
      await page.goto(HOSTING + '/garage-station.html' + MANAGER);
      await page.waitForFunction(() => /900001/.test(document.getElementById('jobs').textContent), null, { timeout: 15000 });
      await page.waitForTimeout(6500);
      await kept(page, ['garage-station.html', 'js/offline-saves.js', 'js/station-code.js']);
      await offline(true);
      await page.reload();
      await page.waitForFunction(() => /900001/.test(document.getElementById('jobs').textContent), null, { timeout: 20000 });
      assert.match(await page.textContent('#offline-line'), /No signal\. What you enter is saved on this tablet/);
      await page.click('.gs-job:has-text("900001") button');
      await page.waitForSelector('#view-job:not([hidden])');
      await page.click('#job-start');
      await page.waitForSelector('#view-sign:not([hidden])');
      await page.click('[data-who="TECH-JT"]');
      for (const k of '48213') await page.click('[data-key="' + k + '"]');
      await page.click('[data-key="go"]');
      await page.waitForFunction(() => /JELLICK Tom: saved on this tablet/.test(document.getElementById('gs-message').textContent), null, { timeout: 10000 });
      assert.match(await page.textContent('#offline-line'), /Saved on this tablet, will send when you have signal\. Waiting: 1/);
      await shot(page, 'station-offline-garage-saved-1024.png');
      assert.equal((await db().collection('workOrders').where('unit', '==', '900001').get()).size, 0, 'nothing reached the server yet');
      results.push('Garage Station: with no signal it opens from the tablet with the last work orders; Start with name and login ID is kept with "Saved on this tablet"');
      await offline(false);
      await page.waitForSelector('#offline-line.ok', { timeout: 40000 });
      const wos = (await db().collection('workOrders').where('unit', '==', '900001').get()).docs.map(d => d.data());
      assert.equal(wos.length, 1, 'one work order');
      assert.deepEqual([wos[0].status, wos[0].techs], ['WORKING', 'JELLICK Tom']);
      await page.waitForFunction(() => /On it now: Tom/.test(document.getElementById('jobs').textContent), null, { timeout: 15000 });
      assert.equal(await page.isVisible('#gs-message'), false, 'the "saved on this tablet" note goes once it is sent');
      await shot(page, 'station-offline-garage-sent-1024.png');
      assert.deepEqual(errors, []);
      results.push('Garage Station: signal back, the Start is sent once and checked by Tom\'s login ID; 900001 is WORKING with Tom');
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('OK  ' + r));
})().catch(e => { console.error(e); process.exit(1); });

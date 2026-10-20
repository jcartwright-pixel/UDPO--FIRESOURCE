'use strict';
/*
 * Browser check of Joe's 10/19 ask ("I need a spot for the overage and a spot for the shortages ... so they could put in
 * what is over and then what is under"): the driver's phone Check-In has an Over part and a Short part (cases, product, store
 * each) that can both be filled; both are saved together and come back apart; the Driver Check-ins list shows "Over: ..." and
 * "Short: ..."; the desktop pop-up has an Over box and a Short box; an over / short written before shows as it was.
 * SHOTS_DIR=<folder> saves pictures; BEFORE=1 only takes the pictures (for the screens as they were).
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const F = require('../fixtures/fake-sheets');
const L = require('../../src/logic');
const { newRouteCode } = require('../../src/phone');
const localCalls = require('./local-calls.cjs');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR;
const BEFORE = !!process.env.BEFORE;
const shot = (pg, name) => SHOTS ? pg.screenshot({ path: path.join(SHOTS, (BEFORE ? 'before-' : 'after-') + name + '.png') }) : null;

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: () => new Date('2026-10-09T12:00:00Z') });
  const today = L.operatingDay(new Date()), p = L.dayPrefix(today), wk = L.weekStart(today);
  const mine = wk + '__run_x801', old = wk + '__run_x806';
  await db().collection('runs').doc(mine).set({ weekStart: wk, route: '801', run: 'UT DSD MILK', routeId: 'rte_x801', runId: 'run_x801', rev: 0, days: { [p]: { runs: true, driverId: 'drv_test_casey', driver: 'CASEY, LEE', truck: '900001', trailer: 'T-801', casesOut: 420 } } });
  // Saved before the two parts: free text with no OVER / SHORT in front.
  await db().collection('runs').doc(old).set({ weekStart: wk, route: '806', run: 'UT DSD MILK', routeId: 'rte_x806', runId: 'run_x806', rev: 0, days: { [p]: { runs: true, driverId: 'drv_x_other', driver: 'OTHER, PAT', truck: '900006', trailer: 'T-806', casesDelivered: 300, overageShortage: 'TRUE', overageShortageDetails: '2 cs 1/2 GAL WHOLE short', checkinCompletedAt: new Date().toISOString() } } });
  const { code } = await newRouteCode(db(), { email: 'manager.test@uniteddairy.com' });
  const browser = await chromium.launch();
  const results = [];
  const route = (ctx) => ctx.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (r) => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, r.request().url().split('/').pop())) }));
  const saved = async () => (await db().collection('runs').doc(mine).get()).data().days[p];
  try {
    // The driver's phone.
    {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
      await route(ctx); await localCalls(ctx);
      const pg = await ctx.newPage(), errors = [];
      pg.on('pageerror', e => errors.push(e.message));
      await pg.goto(HOSTING + '/route.html');
      await pg.fill('#code', code); await pg.click('#step-code button[type=submit]');
      await pg.click('#m-checkin');
      await pg.waitForSelector('#step-name:not([hidden]) #name option[value="drv_test_casey"]', { state: 'attached' });
      await pg.selectOption('#name', 'drv_test_casey'); await pg.click('#step-name button[type=submit]');
      await pg.waitForSelector('.phone-load');
      await pg.click('.phone-load:has(b:text-is("801"))');
      await pg.waitForSelector('#step-form:not([hidden])');
      await pg.check('#step-form [name=overageShortage]');
      await pg.waitForSelector('.ci-os-box:not([hidden])');
      if (!BEFORE) {
        await pg.fill('[name=overCases]', '2'); await pg.fill('[name=overProduct]', '1% milk gallon'); await pg.fill('[name=overStore]', 'Delmont Walmart');
        await pg.fill('[name=shortCases]', '3'); await pg.fill('[name=shortProduct]', '16 oz chocolate'); await pg.fill('[name=shortStore]', 'Youngwood Shop n Save');
      }
      await pg.$eval('.ci-os-box', el => el.scrollIntoView({ block: 'center' }));
      await shot(pg, 'phone-over-short');
      if (!BEFORE) {
        assert.deepEqual(await pg.$$eval('.ci-os-box input', els => els.filter(e => parseFloat(getComputedStyle(e).fontSize) < 16).map(e => e.name)), [], 'boxes 16px or larger');
        await pg.fill('input[name=casesDelivered]', '415');
        await pg.click('.ci-loaded label:has([value=YES])');
        await pg.click('#send');
        await pg.waitForSelector('.phone-load.done:has(b:text-is("801"))', { timeout: 15000 });
        const d = await saved();
        assert.equal(d.overageShortage, 'TRUE');
        assert.equal(d.overageShortageDetails, 'OVER 2 cs · 1% milk gallon · Store: Delmont Walmart; SHORT 3 cs · 16 oz chocolate · Store: Youngwood Shop n Save', 'the over and the short are both saved');
        // Opening it again: both parts come back apart.
        await pg.click('.phone-load:has(b:text-is("801"))');
        await pg.waitForSelector('#step-form:not([hidden])');
        assert.deepEqual(await Promise.all(['overCases', 'overProduct', 'overStore', 'shortCases', 'shortProduct', 'shortStore'].map(n => pg.inputValue('[name=' + n + ']'))),
          ['2', '1% milk gallon', 'Delmont Walmart', '3', '16 oz chocolate', 'Youngwood Shop n Save'], 'both parts come back');
        assert.deepEqual(errors, []);
        results.push('Phone Check-In: Over and Short are two parts (cases, product, store) that can both be filled; both save and come back apart');
      }
      await ctx.close();
    }
    // The desktop: the list and the pop-up.
    {
      if (BEFORE) {
        await db().collection('runs').doc(mine).update({ ['days.' + p + '.overageShortage']: 'TRUE', ['days.' + p + '.overageShortageDetails']: 'SHORT 3 cs · 16 oz chocolate · Store: Youngwood Shop n Save', ['days.' + p + '.casesDelivered']: 415 });
      }
      const ctx = await browser.newContext({ viewport: { width: 1536, height: 790 }, serviceWorkers: 'block' });
      await route(ctx); await localCalls(ctx);
      const pg = await ctx.newPage(), errors = [];
      pg.on('pageerror', e => errors.push(e.message));
      await pg.goto(HOSTING + '/checkins.html?date=' + today + '&testEmail=dispatch.test@uniteddairy.com');
      await pg.waitForSelector('#rows tr[data-index]');
      await pg.waitForFunction(() => /415/.test(document.getElementById('rows').textContent));
      const rowText = (r) => pg.textContent('#rows tr:has(td:first-child:text-is("' + r + '"))');
      await shot(pg, 'list-1536');
      if (!BEFORE) {
        assert.match(await rowText('801'), /Over: 2 cs · 1% milk gallon · Store: Delmont Walmart; Short: 3 cs · 16 oz chocolate · Store: Youngwood Shop n Save/, 'the list shows the over and the short');
        assert.match(await rowText('806'), /Over\/short: 2 cs 1\/2 GAL WHOLE short/, 'an over / short written before shows as it was');
      }
      await pg.click('#rows tr:has(td:first-child:text-is("801"))');
      await pg.waitForSelector('.popover [data-save]');
      await pg.waitForTimeout(300);
      await shot(pg, 'popup-1536');
      if (!BEFORE) {
        assert.equal(await pg.inputValue('#ci-overDetails'), '2 cs · 1% milk gallon · Store: Delmont Walmart');
        assert.equal(await pg.inputValue('#ci-shortDetails'), '3 cs · 16 oz chocolate · Store: Youngwood Shop n Save');
        await pg.fill('#ci-overDetails', '');
        await pg.fill('#ci-shortDetails', '4 cs 16 oz chocolate');
        await pg.click('.popover [data-save]');
        for (let i = 0; i < 50 && (await saved()).overageShortageDetails !== 'SHORT 4 cs 16 oz chocolate'; i++) await pg.waitForTimeout(100);
        assert.equal((await saved()).overageShortageDetails, 'SHORT 4 cs 16 oz chocolate', 'emptying Over and fixing Short saves only the short');
        await pg.waitForFunction(() => /Short: 4 cs 16 oz chocolate/.test(document.getElementById('rows').textContent));
        // The one written before: it stays whole in the pop-up (in Short) and is kept on save.
        await pg.click('#rows tr:has(td:first-child:text-is("806"))');
        await pg.waitForSelector('.popover [data-save]');
        assert.equal(await pg.inputValue('#ci-overDetails'), '');
        assert.equal(await pg.inputValue('#ci-shortDetails'), '2 cs 1/2 GAL WHOLE short');
        await pg.click('.popover [data-cancel]');
        assert.deepEqual(errors, []);
        results.push('Driver Check-ins: the list shows Over: and Short: apart; the pop-up has an Over box and a Short box that save; an over / short written before shows as it was');
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('ok - ' + r));
})().catch(e => { console.error(e); process.exit(1); });

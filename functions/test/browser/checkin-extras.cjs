'use strict';
/*
 * Browser check of two old Check-In features Joe asked back (10/13):
 * - "All routes": someone signed in on the phone with a manager role sees an All routes / My name only switch on the Check-In
 *   list and can check in another driver's route; a driver's phone with no sign-in never shows it.
 * - A checkbox in front of each issue (refused / returned, truck, trailer, pallet jack): typing ticks it, unticking empties the
 *   write-up, and a ticked issue with no write-up is not sent.
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

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: () => new Date('2026-10-09T12:00:00Z') });
  const today = L.operatingDay(new Date()), p = L.dayPrefix(today), wk = L.weekStart(today);
  const mine = wk + '__run_x801', other = wk + '__run_x806';
  await db().collection('runs').doc(mine).set({ weekStart: wk, route: '801', run: 'UT DSD MILK', routeId: 'rte_x801', runId: 'run_x801', rev: 0, days: { [p]: { runs: true, driverId: 'drv_test_casey', driver: 'CASEY, LEE', truck: '900001', trailer: 'T-801' } } });
  await db().collection('runs').doc(other).set({ weekStart: wk, route: '806', run: 'UT DSD MILK', routeId: 'rte_x806', runId: 'run_x806', rev: 0, days: { [p]: { runs: true, driverId: 'drv_x_other', driver: 'OTHER, PAT', truck: '900006', trailer: 'T-806' } } });
  const { code } = await newRouteCode(db(), { email: 'manager.test@uniteddairy.com' });
  const browser = await chromium.launch();
  const results = [];
  const open = async (email) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    await ctx.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (r) => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, r.request().url().split('/').pop())) }));
    await localCalls(ctx);
    const pg = await ctx.newPage();
    const errors = [];
    pg.on('pageerror', e => errors.push(e.message));
    if (email) { await pg.goto(HOSTING + '/index.html?testEmail=' + email); await pg.waitForFunction(() => !document.getElementById('screen').hidden, null, { timeout: 15000 }); }
    await pg.goto(HOSTING + '/route.html');
    await pg.fill('#code', code); await pg.click('#step-code button[type=submit]');
    await pg.click('#m-checkin');
    await pg.waitForSelector('#step-name:not([hidden]) #name option[value="drv_test_casey"]', { state: 'attached' });
    await pg.selectOption('#name', 'drv_test_casey'); await pg.click('#step-name button[type=submit]');
    await pg.waitForSelector('.phone-load');
    return { ctx, pg, errors };
  };
  const routes = (pg) => pg.$$eval('.phone-load b', bs => bs.map(b => b.textContent));
  try {
    // A driver's phone (no sign-in): no switch, only their own route.
    {
      const { ctx, pg, errors } = await open('');
      await pg.waitForTimeout(1500);
      assert.equal(await pg.isVisible('#all-routes'), false, 'no All routes on a driver\'s phone');
      assert.deepEqual((await routes(pg)).filter(r => r === '806'), [], 'another driver\'s route is not listed');

      // The issue checkboxes on the Check-In.
      await pg.click('.phone-load:has(b:text-is("801"))');
      await pg.waitForSelector('#step-form:not([hidden])');
      const box = (n) => pg.$eval('[data-issue~="' + n + '"]', b => b.checked);
      assert.equal(await box('tractorIssues'), false);
      await pg.fill('input[name=tractorIssues]', 'Left mirror cracked');
      assert.equal(await box('tractorIssues'), true, 'typing a truck problem ticks its box');
      // Joe 10/13: "Was your truck loaded correctly?" must be answered; No needs what was wrong.
      assert.equal(await pg.isVisible('.ci-loaded-box'), false, 'no box until No is picked');
      await pg.click('#send');
      await pg.waitForSelector('#send-error:not([hidden])');
      assert.match(await pg.textContent('#send-error'), /Answer: Was your truck loaded correctly\? Tap Yes or No/);
      await pg.click('.ci-loaded label:has([value=NO])');
      await pg.waitForSelector('.ci-loaded-box:not([hidden])');
      await pg.click('#send');
      await pg.waitForFunction(() => /Write what was loaded wrong/.test(document.getElementById('send-error').textContent));
      await pg.fill('input[name=loadingProblem]', '2 cs 2% gallon on the wrong stop');
      await pg.check('[data-issue="trailerIssues"]');
      await pg.click('#send');
      await pg.waitForFunction(() => /Write what the trailer problem is/.test(document.getElementById('send-error').textContent));
      await pg.uncheck('[data-issue="tractorIssues"]');
      assert.equal(await pg.inputValue('input[name=tractorIssues]'), '', 'unticking empties the write-up');
      await pg.fill('input[name=tractorIssues]', 'Left mirror cracked');
      await pg.fill('input[name=trailerIssues]', 'Door seal torn');
      await pg.check('[data-issue="palletJackIssues"]');
      await pg.uncheck('[data-issue="palletJackIssues"]');
      await pg.click('#send');
      await pg.waitForSelector('.phone-load.done:has(b:text-is("801"))', { timeout: 15000 });
      const d = (await db().collection('runs').doc(mine).get()).data().days[p];
      assert.equal(d.tractorIssues, 'Left mirror cracked');
      assert.equal(d.trailerIssues, 'Door seal torn');
      assert.equal(d.palletJackIssues || '', '');
      assert.deepEqual([d.loadedCorrectly, d.loadingProblem], ['NO', '2 cs 2% gallon on the wrong stop'], 'the No and what was wrong are saved');
      // Opening it again shows the ticks from what was written.
      await pg.click('.phone-load:has(b:text-is("801"))');
      await pg.waitForSelector('#step-form:not([hidden])');
      assert.equal(await box('tractorIssues'), true); assert.equal(await box('trailerIssues'), true); assert.equal(await box('palletJackIssues'), false);
      assert.equal(await pg.isChecked('[name=loadedCorrectly][value=NO]'), true, 'the No comes back');
      assert.equal(await pg.inputValue('input[name=loadingProblem]'), '2 cs 2% gallon on the wrong stop');
      await pg.click('.ci-loaded label:has([value=YES])');
      assert.equal(await pg.isVisible('.ci-loaded-box'), false, 'Yes closes the box');
      assert.equal(await pg.inputValue('input[name=loadingProblem]'), '', 'and empties it');
      assert.deepEqual(errors, []);
      results.push('Check-In issues: a checkbox in front of each issue; typing ticks it, unticking empties it, a ticked issue with no write-up is refused, and the saved write-ups come back ticked');
      results.push('Was your truck loaded correctly?: Check In waits for Yes or No; No opens a box and needs what was wrong; the No and its write-up are saved and come back; Yes closes and empties the box');
      results.push('A driver\'s phone with no sign-in has no All routes switch and lists only their own routes');
      await ctx.close();
    }
    // A manager signed in on the same phone: All routes lists every route; Check In on another driver's route saves.
    {
      const { ctx, pg, errors } = await open('manager.test@uniteddairy.com');
      await pg.waitForSelector('#all-routes:not([hidden])', { timeout: 15000 });
      assert.equal(await pg.textContent('#all-routes'), 'All routes');
      await pg.click('#all-routes');
      await pg.waitForSelector('.phone-load:has(b:text-is("806"))');
      assert.equal(await pg.textContent('#all-routes'), 'My name only');
      assert.equal(await pg.textContent('#who'), 'CASEY, LEE', 'the driver\'s name stays at the top');
      await pg.click('.phone-load:has(b:text-is("806"))');
      await pg.waitForSelector('#step-form:not([hidden])');
      await pg.fill('input[name=casesDelivered]', '212');
      await pg.click('.ci-loaded label:has([value=YES])');
      await pg.click('#send');
      await pg.waitForSelector('.phone-load.done:has(b:text-is("806"))', { timeout: 15000 });
      assert.equal(String((await db().collection('runs').doc(other).get()).data().days[p].casesDelivered), '212');
      await pg.click('#all-routes');
      await pg.waitForFunction(() => ![...document.querySelectorAll('.phone-load b')].some(b => b.textContent === '806'));
      assert.deepEqual(errors, []);
      results.push('A manager signed in on the phone: All routes lists every route of the day, Check In on another driver\'s route saves, My name only goes back');
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('OK  ' + r));
})().catch(e => { console.error(e); process.exit(1); });

'use strict';
/*
 * Browser check of the Manager Walkthrough (Joe 10/15, look C, option 1) on the made-up plant: the phone and tablet start screen
 * (Manager Walkthrough, Yard Checks, Loadout Center), the walkthrough (Coolers, then Quality) with its numbers from the same rule
 * as Manager Center, the walkthrough bar on Coolers and Quality, and a manager signing in on a phone landing on the start screen.
 * Pictures go to SHOTS_DIR.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const F = require('../fixtures/fake-sheets');
const PD = require('../fixtures/plant-demo');
const L = require('../../src/logic');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR || '';
const MANAGER = 'testEmail=manager.test@uniteddairy.com';

async function openPage(browser, opts, url) {
  const ctx = await browser.newContext(Object.assign({ serviceWorkers: 'block' }, opts));
  await ctx.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(HOSTING + url);
  page.errors = errors;
  return page;
}
const shot = (page, name) => SHOTS ? page.screenshot({ path: path.join(SHOTS, name + '.png'), scale: 'css' }) : null;
// No sideways page scrolling, and no text under 16px in the walkthrough's own boxes.
async function tidy(page, what) {
  const size = await page.evaluate(() => ({ width: document.scrollingElement.scrollWidth, inner: window.innerWidth }));
  assert.ok(size.width <= size.inner, what + ' has no sideways scrolling: ' + JSON.stringify(size));
  assert.deepEqual(await page.$$eval('.wk-view *, .wk-bar *', els => els.filter(e => e.childNodes.length && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) < 16).map(e => e.textContent)), [], what + ' text is 16px or more');
}

async function seed() {
  const at0 = Date.now(), d = db();
  // Cooler North read 44°F (too warm) 30 minutes ago: the newest walkthrough check, by the supervisor.
  await d.collection('plantJournal').doc('PLANT_TEMPERATURE_CHECK_app_wkseed').set({ recordId: 'TEMP-wkseed', type: 'PLANT_TEMPERATURE_CHECK', date: L.operatingDay(new Date(at0)), status: 'HIGH',
    recordedAt: new Date(at0 - 30 * 60000).toISOString(), recordedBy: 'supervisor.test@uniteddairy.com', createdInApp: true, payload: { locationId: 'ut_temp_cooler_north', location: 'Cooler North', manualTemperature: 44, status: 'HIGH' } });
}

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date('2026-10-08T14:00:00Z') });
  await seed();
  const browser = await chromium.launch();
  const results = [];
  try {
    // The walkthrough: Coolers then Quality, big numbers; Quality's five lines were last checked days ago (past due, flashing).
    for (const [w, h, touch] of [[390, 844, true], [600, 960, true], [800, 1280, true], [1536, 730, false], [1920, 950, false]]) {
      const page = await openPage(browser, { viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch && w < 700 }, '/walkthrough.html?' + MANAGER);
      await page.waitForSelector('.wk-choice');
      assert.deepEqual(await page.$$eval('.wk-choice .wk-t b', b => b.map(x => x.textContent)), ['Coolers', 'Quality']);
      assert.deepEqual(await page.$$eval('.wk-choice', a => a.map(x => x.getAttribute('href'))), ['temps.html?walk=1', 'quality.html?walk=1']);
      assert.equal(await page.textContent('.wk-choice:nth-child(2) .wk-n'), '5of 5 · 5 past due');
      assert.match(await page.textContent('.wk-choice:nth-child(1) .wk-n span'), /^1 out of range$/);
      assert.ok(await page.$eval('.wk-choice:nth-child(2)', a => a.classList.contains('late') && getComputedStyle(a).animationName === 'wk-flash'), 'past-due Quality flashes');
      assert.match(await page.textContent('#last'), /^Last walkthrough check: \d{1,2}:\d\d [AP]M · Supervisor Test$/);
      await tidy(page, 'Walkthrough ' + w);
      await shot(page, 'walkthrough-' + w);
      assert.deepEqual(page.errors, []);
      await page.context().close();
    }
    results.push('Walkthrough: Coolers then Quality with big numbers, past due flashes red, the last walkthrough check line, at 390/600/800/1536/1920');

    // The phone and tablet start screen: three choices.
    for (const [w, h] of [[390, 844], [800, 1280]]) {
      const page = await openPage(browser, { viewport: { width: w, height: h }, hasTouch: true, isMobile: w < 700 }, '/walkthrough.html?view=home&' + MANAGER);
      await page.waitForSelector('.wk-choice');
      assert.deepEqual(await page.$$eval('.wk-choice .wk-t b', b => b.map(x => x.textContent)), ['Manager Walkthrough', 'Yard Checks', 'Loadout Center']);
      assert.deepEqual(await page.$$eval('.wk-choice', a => a.map(x => x.getAttribute('href'))), ['walkthrough.html', 'yard.html', 'loadout.html']);
      assert.equal(await page.textContent('#ask'), 'What are you doing?');
      assert.equal(await page.isVisible('#full'), true);
      await tidy(page, 'Start screen ' + w);
      await shot(page, 'walkthrough-home-' + w);
      assert.deepEqual(page.errors, []);
      await page.context().close();
    }
    results.push('Start screen: Manager Walkthrough, Yard Checks and Loadout Center at 390 and 800, with Open the full Operations app');

    // Coolers and Quality opened from the walkthrough carry its bar: back, which stop, the next stop.
    const phone = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
    const cool = await openPage(browser, phone, '/temps.html?walk=1&' + MANAGER);
    await cool.waitForSelector('#walk-bar');
    assert.deepEqual(await cool.$$eval('#walk-bar a', a => a.map(x => x.textContent + ' ' + x.getAttribute('href'))), ['‹ Walkthrough walkthrough.html', 'Next: Quality › quality.html?walk=1']);
    assert.equal(await cool.textContent('#walk-bar b'), '1 · Coolers');
    await cool.waitForSelector('#rows [data-location]');
    await tidy(cool, 'Coolers with the walkthrough bar');
    await shot(cool, 'walkthrough-coolers-390');
    await cool.click('#walk-bar a.next');
    await cool.waitForSelector('#walk-bar');
    assert.equal(await cool.textContent('#walk-bar b'), '2 · Quality');
    assert.deepEqual(await cool.$$eval('#walk-bar a', a => a.map(x => x.textContent + ' ' + x.getAttribute('href'))), ['‹ Walkthrough walkthrough.html', 'Done ✓ walkthrough.html']);
    await cool.waitForSelector('#fields label');
    await shot(cool, 'walkthrough-quality-390');
    assert.deepEqual(cool.errors, []);
    await cool.context().close();
    const plain = await openPage(browser, { viewport: { width: 1920, height: 950 } }, '/temps.html?' + MANAGER);
    await plain.waitForSelector('#rows [data-location]');
    assert.equal(await plain.$('#walk-bar'), null, 'no bar when Coolers is opened from the menu');
    await plain.context().close();
    results.push('Coolers and Quality from the walkthrough: the bar with Walkthrough, the stop and Next / Done; none from the menu');

    // A manager signing in on a phone lands on the start screen; Open the full Operations app stays on the full app.
    const land = await openPage(browser, phone, '/index.html?' + MANAGER);
    await land.waitForURL(/walkthrough\.html\?view=home/, { timeout: 15000 });
    await land.waitForSelector('.wk-choice');
    await land.click('#full');
    await land.waitForURL(/index\.html\?full=1/);
    await land.waitForSelector('#sides .launch-card');
    await land.goto(HOSTING + '/index.html');
    await land.waitForSelector('#sides .launch-card');
    assert.match(land.url(), /index\.html$/, 'the full app is kept for this tab');
    assert.deepEqual(land.errors, []);
    await land.context().close();
    const desk = await openPage(browser, { viewport: { width: 1536, height: 730 } }, '/index.html?' + MANAGER);
    await desk.waitForSelector('#sides .launch-card');
    await desk.waitForTimeout(500);
    assert.match(desk.url(), /index\.html/, 'a desk computer keeps the full home');
    await desk.context().close();
    results.push('Signing in: a manager on a phone lands on the start screen; Open the full Operations app keeps the full app for the tab; a desk keeps the full home');
  } finally {
    await browser.close();
  }
  console.log('WALKTHROUGH ' + results.join('\nWALKTHROUGH '));
})().catch(e => { console.error(e); process.exit(1); });

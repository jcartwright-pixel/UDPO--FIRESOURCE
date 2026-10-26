'use strict';
/*
 * Browser check of the Manager Walkthrough (Joe 10/15, option 2) on the made-up plant: the managers' phone and tablet start screen
 * (Manager Walkthrough, Loading, Unloading), the walkthrough (Yard, Coolers, Production) with its numbers and lists from the same rule
 * as Manager Center, the DONE / DUE / PAST DUE button beside each card (Joe 10/18), the walkthrough bar on Coolers and Production,
 * and a manager signing in on a phone landing on the start screen.
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
const STATIONS = require('../../src/stations');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR || '';
const MANAGER = 'testEmail=manager.test@uniteddairy.com';
function nyMinutes(ms) {
  const p = {};
  new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).forEach(x => { p[x.type] = x.value; });
  return Number(p.hour) * 60 + Number(p.minute);
}
// The line checks seeded 200 minutes back are on today's operating day (from 6 AM) only from 9:30 AM; from 6:00 to 9:29 AM the
// screens run on a clock pinned to 10:30 AM, so the check is the same at every hour.
const CLOCK = (() => {
  const real = Date.now(), m = nyMinutes(real);
  return m >= 360 && m < 570 ? { ms: real + (630 - m) * 60000, pinned: true } : { ms: real, pinned: false };
})();

async function openPage(browser, opts, url) {
  const ctx = await browser.newContext(Object.assign({ serviceWorkers: 'block' }, opts));
  await ctx.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
  });
  const page = await ctx.newPage();
  if (CLOCK.pinned) await page.clock.setFixedTime(new Date(CLOCK.ms));
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
  const at0 = CLOCK.ms, d = db();
  // Cooler North read 44°F (too warm) 30 minutes ago: the newest walkthrough check, by the supervisor.
  await d.collection('plantJournal').doc('PLANT_TEMPERATURE_CHECK_app_wkseed').set({ recordId: 'TEMP-wkseed', type: 'PLANT_TEMPERATURE_CHECK', date: L.operatingDay(new Date(at0)), status: 'HIGH',
    recordedAt: new Date(at0 - 30 * 60000).toISOString(), recordedBy: 'supervisor.test@uniteddairy.com', createdInApp: true, payload: { locationId: 'ut_temp_cooler_north', location: 'Cooler North', manualTemperature: 44, status: 'HIGH' } });
  // Joe 10/18: two lines running today: the Gallon Filler checked 200 minutes ago (past due at 3 hours) and HTST #1 130 minutes
  // ago (due at 2 hours); the other three have no check today, so they are not running and need none.
  const line = (id, op, mins) => d.collection('plantJournal').doc(id).set({ recordId: id, type: 'PRODUCTION_QUALITY', date: L.operatingDay(new Date(at0)), status: 'RUNNING',
    recordedAt: new Date(at0 - mins * 60000).toISOString(), recordedBy: 'supervisor.test@uniteddairy.com', createdInApp: true, payload: { operationId: op, product: 'Whole milk', status: 'RUNNING', qualityCheck: 'PASS' } });
  await line('PRODUCTION_QUALITY_app_wkgal', 'ut_prod_gallon_filler', 200);
  await line('PRODUCTION_QUALITY_app_wkhtst', 'ut_prod_htst_1', 130);
}

const phone390 = () => ({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date('2026-10-08T14:00:00Z') });
  await seed();
  const browser = await chromium.launch();
  const results = [];
  try {
    // The walkthrough: Yard, Coolers, Production, big numbers; two lines are running, one past due (flashing).
    for (const [w, h, touch] of [[390, 844, true], [600, 960, true], [800, 1280, true], [1536, 730, false], [1920, 950, false]]) {
      const page = await openPage(browser, { viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch && w < 700 }, '/walkthrough.html?' + MANAGER);
      await page.waitForSelector('.wk-choice');
      // Joe 10/23 (pictures, option 1): Pictures is the 4th stop.
      assert.deepEqual(await page.$$eval('.wk-choice .wk-t b', b => b.map(x => x.textContent)), ['Yard', 'Coolers', 'Production', 'Pictures']);
      assert.deepEqual(await page.$$eval('.wk-choice', a => a.map(x => x.getAttribute('href'))), ['yard.html?walk=1', 'temps.html?walk=1', 'quality.html?walk=1', null]);
      assert.equal(await page.textContent('.wk-row:nth-child(3) .wk-choice .wk-n'), '2of 5 · 1 past due');
      assert.match(await page.textContent('.wk-row:nth-child(2) .wk-choice .wk-n span'), /^1 out of range$/);
      assert.ok(await page.$eval('.wk-row:nth-child(3) .wk-choice', a => a.classList.contains('late') && getComputedStyle(a).animationName === 'wk-flash'), 'past-due Production flashes');
      // Joe 10/18: beside each card a button in its colour: Yard done (no trucks), Coolers and Production past due (red).
      assert.deepEqual(await page.$$eval('.wk-act', a => a.map(x => x.textContent + ' ' + x.className + ' ' + x.getAttribute('href') + ' ' + getComputedStyle(x).backgroundColor)),
        ['DONE wk-act ok yard.html?walk=1 rgb(31, 122, 77)', 'PAST DUE wk-act late temps.html?walk=1 rgb(198, 40, 40)', 'PAST DUE wk-act late quality.html?walk=1 rgb(198, 40, 40)', 'TAKE PICTURE wk-act take null rgb(11, 79, 138)']);
      assert.ok(await page.$$eval('.wk-row', r => r.every(x => { const a = x.querySelector('.wk-choice').getBoundingClientRect(), b = x.querySelector('.wk-act').getBoundingClientRect(); return b.left >= a.right && Math.abs(b.top - a.top) < 2; })), 'each button sits beside its card');
      // Who did each area's newest check, or done automatically.
      assert.deepEqual(await page.$$eval('.wk-who', a => a.map(x => x.textContent.replace(/\d{1,2}:\d\d [AP]M/, 'T'))), ['Done automatically', 'Last T · Supervisor Test', 'Last T · Supervisor Test']);
      // Each stop lists what it holds, problems first in red (Joe 10/15, later).
      assert.equal(await page.textContent('.wk-row:nth-child(2) .wk-items li.bad'), 'Cooler North 44°F · HIGH');
      assert.deepEqual(await page.$$eval('.wk-row:nth-child(3) .wk-items li', l => l.map(x => x.className + ' ' + x.textContent.replace(/ · last .*/, ''))),
        ['bad GALLON FILLER PAST DUE', 'warn HTST #1 DUE', 'ok BOXING NOT RUNNING', 'ok TOTES NOT RUNNING', 'ok BLOW MOLD NOT RUNNING']);
      assert.match(await page.textContent('#last'), /^Last walkthrough check: \d{1,2}:\d\d [AP]M · Supervisor Test$/);
      await tidy(page, 'Walkthrough ' + w);
      await shot(page, 'walkthrough-' + w);
      assert.deepEqual(page.errors, []);
      await page.context().close();
    }
    results.push('Walkthrough: Yard, Coolers, Production with big numbers, what each holds and who checked it last, a DONE / DUE / PAST DUE button beside each (green, yellow, red), past due flashes red, the last walkthrough check line, at 390/600/800/1536/1920');

    // Joe 10/23 (pictures, option 1): TAKE PICTURE opens the camera; the picture shows on the 4th stop on the phone and on Manager
    // Center, waiting for the next report, and can be removed until it is sent.
    {
      const page = await openPage(browser, phone390(), '/walkthrough.html?' + MANAGER);
      await page.waitForSelector('.wk-act.take');
      assert.equal(await page.getAttribute('.wp-input', 'capture'), 'environment', 'the back camera opens');
      assert.equal(await page.textContent('.wp-choice .wk-n'), '0none waiting');
      const jpeg = Buffer.from((await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 2400; c.height = 1800; const g = c.getContext('2d'); g.fillStyle = '#4a7fa8'; g.fillRect(0, 0, 2400, 1800); g.fillStyle = '#fff'; g.font = '200px sans-serif'; g.fillText('Dock 4', 300, 900); return c.toDataURL('image/jpeg', 0.95); })).split(',')[1], 'base64');
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('.wk-act.take')]);
      await chooser.setFiles({ name: 'dock.jpg', mimeType: 'image/jpeg', buffer: jpeg });
      await page.waitForFunction(() => document.querySelectorAll('.wp-thumbs img').length === 1, null, { timeout: 20000 });
      assert.equal(await page.textContent('.wp-choice .wk-n'), '1waiting for the next report');
      const kept = (await db().collection('walkPhotos').get()).docs.map(x => x.data());
      assert.equal(kept.length, 1);
      assert.ok(kept[0].width <= 1600 && kept[0].height <= 1600 && kept[0].sentAt === '', 'the phone makes the picture smaller: ' + kept[0].width + 'x' + kept[0].height);
      // Joe 10/23 (later): a caption for the picture, saved as it is typed; the screen keeps it after opening again.
      await page.fill('.wp-cap', 'Cleaned the dock 4 area');
      await page.waitForFunction(() => true);
      const until = Date.now() + 20000;
      while (((await db().collection('walkPhotos').get()).docs[0].data().note || '') !== 'Cleaned the dock 4 area') { assert.ok(Date.now() < until, 'the caption saves'); await page.waitForTimeout(300); }
      await page.reload();
      await page.waitForSelector('.wp-cap');
      assert.equal(await page.inputValue('.wp-cap'), 'Cleaned the dock 4 area');
      await tidy(page, 'Walkthrough with a picture');
      // A second picture: the phone lists both, each with its own caption box.
      const [chooser2] = await Promise.all([page.waitForEvent('filechooser'), page.click('.wk-act.take')]);
      await chooser2.setFiles({ name: 'cooler.jpg', mimeType: 'image/jpeg', buffer: jpeg });
      await page.waitForFunction(() => document.querySelectorAll('.wp-thumbs img').length === 2, null, { timeout: 20000 });
      assert.deepEqual(await page.$$eval('.wp-cap', b => b.map(x => x.value)), ['Cleaned the dock 4 area', '']);
      await page.$eval('.wp-choice', el => el.scrollIntoView({ block: 'end' }));
      await shot(page, 'walkthrough-pictures-390');
      // Manager Center: the same picture on the 4th stop, with Take Picture.
      const mc = await openPage(browser, { viewport: { width: 1536, height: 886 } }, '/manager.html?' + MANAGER);
      await mc.waitForFunction(() => document.querySelectorAll('[data-card="walk"] .wp-tile .wp-thumbs img').length === 1, null, { timeout: 20000 });
      // The newest picture with its caption box, Remove and Take Picture; the other one is on the walkthrough.
      assert.match(await mc.textContent('[data-card="walk"] .wp-tile'), /^Pictures2waitingfor the next reportRemoveTake Picture$/);
      assert.equal(await mc.inputValue('[data-card="walk"] .wp-cap'), '');
      assert.equal(await mc.getAttribute('[data-card="walk"] .wp-count', 'href'), 'walkthrough.html', 'with two waiting, the count opens the walkthrough, which lists them all');
      await mc.waitForTimeout(500);
      await shot(mc, 'manager-pictures-1536');
      for (const [w, h] of [[1536, 886], [1366, 768], [1920, 950], [390, 844]]) {
        await mc.setViewportSize({ width: w, height: h });
        await mc.waitForTimeout(400);
        // Every walkthrough tile shows its whole label (Joe: tiles show the whole wording).
        // Joe 10/19: at 1536 x 886 (his laptop) and 1920 the page itself never scrolls, a picture waiting included (Joe 10/26: the
        // department cards went two by two, so the walkthrough row is reached by scrolling the cards).
        if (w === 1536 || w === 1920) { const g = await mc.evaluate(() => [document.scrollingElement.scrollHeight, window.innerHeight]); assert.ok(g[0] <= g[1] + 1, 'Plant Distribution ' + w + ' has no page scrolling with a picture waiting ' + g); }
        if (w > 760) assert.deepEqual(await mc.$$eval('[data-card="walk"] .mc-tile > span', sp => sp.filter(x => x.scrollWidth > x.clientWidth + 1).map(x => x.textContent)), [], 'whole labels at ' + w);
        if (SHOTS) { await mc.$eval('[data-card="walk"]', el => el.scrollIntoView({ block: 'end' })); await shot(mc, 'manager-pictures-' + w); }
      }
      assert.deepEqual(mc.errors, []);
      await mc.context().close();
      for (const left of [1, 0]) {
        await page.click('.wp-remove');
        await page.waitForFunction((n) => document.querySelectorAll('.wp-thumbs img').length === n, left, { timeout: 20000 });
      }
      assert.equal((await db().collection('walkPhotos').get()).size, 0);
      assert.deepEqual(page.errors, []);
      await page.context().close();
    }
    results.push('Pictures: TAKE PICTURE on the 4th stop opens the camera, the picture is made smaller, its caption saves as typed, it shows on the phone and on Manager Center (newest, with + more) waiting for the next report, every card still fits at 1536 x 886, and a picture can be removed');

    // The phone and tablet start screen: four choices (Joe 10/18: Send Report).
    for (const [w, h] of [[390, 844], [800, 1280]]) {
      const page = await openPage(browser, { viewport: { width: w, height: h }, hasTouch: true, isMobile: w < 700 }, '/walkthrough.html?view=home&' + MANAGER);
      await page.waitForSelector('.wk-choice');
      assert.deepEqual(await page.$$eval('.wk-choice .wk-t b', b => b.map(x => x.textContent)), ['Manager Walkthrough', 'Loading', 'Unloading', 'Send Report', 'Trailer Assignment']);
      assert.deepEqual(await page.$$eval('.wk-choice', a => a.map(x => x.getAttribute('href'))), ['walkthrough.html', 'loadout.html', 'unloading.html', 'manager.html?report=1', 'trailers.html']);
      assert.equal(await page.textContent('.wk-choice[href="manager.html?report=1"] .wk-n'), 'Nonelast sent');
      assert.match(await page.textContent('.wk-choice[href="trailers.html"] .wk-n'), /^\d+of \d+ assigned$/);
      assert.deepEqual(await page.$$eval('.wk-row:nth-child(1) .wk-items li b', b => b.map(x => x.textContent)), ['Yard', 'Coolers', 'Production']);
      assert.deepEqual(await page.$$eval('.wk-act', a => a.map(x => x.textContent + ' ' + x.getAttribute('href'))), ['PAST DUE walkthrough.html'], 'the walkthrough has its button; Loading, Unloading, Send Report and Trailer Assignment have none');
      assert.equal(await page.textContent('#ask'), 'What are you doing?');
      assert.equal(await page.isVisible('#full'), true);
      await tidy(page, 'Start screen ' + w);
      await shot(page, 'walkthrough-home-' + w);
      if (SHOTS) { await page.$eval('.wk-choice[href="trailers.html"]', el => el.scrollIntoView({ block: 'end' })); await page.waitForTimeout(200); await shot(page, 'walkthrough-home-bottom-' + w); }
      assert.deepEqual(page.errors, []);
      await page.context().close();
    }
    results.push('Start screen: Manager Walkthrough (Yard, Coolers, Production) with its PAST DUE button, Loading, Unloading and Send Report at 390 and 800, with Open the full Operations app');

    // Send Report opens Manager Center's report (what goes out, a note box and Send).
    const rep = await openPage(browser, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }, '/manager.html?report=1&' + MANAGER);
    await rep.waitForSelector('#modal:not([hidden])', { timeout: 20000 });
    await rep.waitForSelector('#send:visible', { timeout: 20000 });
    await rep.waitForSelector('#send:enabled', { timeout: 20000 });
    // Close, Copy, Print and Send all fit the phone (two to a line).
    for (const b of ['#close', '#copy', '#print-report', '#send']) { const r = await rep.$eval(b, el => { const x = el.getBoundingClientRect(); return [x.left, x.right]; }); assert.ok(r[0] >= 0 && r[1] <= 390, b + ' fits the phone ' + r); assert.ok(await rep.$eval(b, el => el.scrollWidth <= el.clientWidth), b + ' shows its whole label'); }
    await rep.waitForTimeout(400);
    await shot(rep, 'walkthrough-send-report-390');
    assert.deepEqual(rep.errors, []);
    await rep.context().close();
    results.push('Send Report: opens the Plant Update report with its Send button');

    // Joe 10/18: the Plant Managers app (?app=1): installs as Plant Managers with its own icon; with no Plant Managers code yet it
    // opens on the sign-in alone; once the plant has a code, a manager types it once and the phone remembers it.
    const app1 = await openPage(browser, phone390(), '/walkthrough.html?view=home&app=1&' + MANAGER);
    await app1.waitForSelector('.wk-choice');
    assert.deepEqual([await app1.getAttribute('link[rel="manifest"]', 'href'), await app1.getAttribute('link[rel="apple-touch-icon"]', 'href'), await app1.textContent('#title'), await app1.title()],
      ['plant-managers.webmanifest', 'img/app-icon/plant-managers/apple-touch-icon.png', 'Plant Managers', 'Plant Managers']);
    await app1.context().close();
    const code = (await STATIONS.stationCode(db(), 'admin.test@uniteddairy.com', { key: 'fac_uniontown_manager_managers' }, new Date().toISOString())).code;
    const app2 = await openPage(browser, phone390(), '/walkthrough.html?view=home&app=1&' + MANAGER);
    await app2.waitForSelector('#code-box:not([hidden]) form');
    assert.equal(await app2.isVisible('#list'), false, 'nothing shows before the code');
    assert.equal((await app2.textContent('#code-box button[type="submit"]')).trim(), 'Open Plant Managers');
    assert.ok(await app2.$eval('#code-box input', el => parseFloat(getComputedStyle(el).fontSize) >= 16 && el.getBoundingClientRect().right <= 390), 'the code box fits the phone');
    await shot(app2, 'plant-managers-code-390');
    await app2.fill('#code-box input[name="code"]', 'WRONG1');
    await app2.click('#code-box button[type="submit"]');
    await app2.waitForFunction(() => /not recognized/.test(document.querySelector('.st-code-msg').textContent));
    await app2.fill('#code-box input[name="code"]', code);
    await app2.click('#code-box button[type="submit"]');
    await app2.waitForSelector('.wk-choice');
    assert.equal(await app2.isVisible('#code-box'), false);
    await app2.reload();
    await app2.waitForSelector('.wk-choice');
    assert.equal(await app2.isVisible('#code-box'), false, 'the phone remembers the code');
    assert.deepEqual(app2.errors, []);
    await app2.context().close();
    results.push('Plant Managers app: its own install (name and icon); no code yet opens on the sign-in; with a code, asked once and remembered');

    // Coolers and Production opened from the walkthrough carry its bar: back, which stop, the next stop.
    const phone = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
    const yd = await openPage(browser, phone, '/yard.html?walk=1&' + MANAGER);
    await yd.waitForSelector('#walk-bar');
    assert.equal(await yd.textContent('#walk-bar b'), '1 · Yard');
    assert.deepEqual(await yd.$$eval('#walk-bar a', a => a.map(x => x.textContent + ' ' + x.getAttribute('href'))), ['‹ Walkthrough walkthrough.html', 'Next: Coolers › temps.html?walk=1']);
    await shot(yd, 'walkthrough-yard-390');
    assert.deepEqual(yd.errors, []);
    await yd.context().close();
    const cool = await openPage(browser, phone, '/temps.html?walk=1&' + MANAGER);
    await cool.waitForSelector('#walk-bar');
    assert.deepEqual(await cool.$$eval('#walk-bar a', a => a.map(x => x.textContent + ' ' + x.getAttribute('href'))), ['‹ Walkthrough walkthrough.html', 'Next: Production › quality.html?walk=1']);
    assert.equal(await cool.textContent('#walk-bar b'), '2 · Coolers');
    await cool.waitForSelector('#rows [data-location]');
    await tidy(cool, 'Coolers with the walkthrough bar');
    await shot(cool, 'walkthrough-coolers-390');
    await cool.click('#walk-bar a.next');
    await cool.waitForSelector('#walk-bar');
    assert.equal(await cool.textContent('#walk-bar b'), '3 · Production');
    assert.deepEqual(await cool.$$eval('#walk-bar a', a => a.map(x => x.textContent + ' ' + x.getAttribute('href'))), ['‹ Walkthrough walkthrough.html', 'Done ✓ walkthrough.html']);
    await cool.waitForSelector('#fields label');
    await shot(cool, 'walkthrough-quality-390');
    assert.deepEqual(cool.errors, []);
    await cool.context().close();
    const plain = await openPage(browser, { viewport: { width: 1920, height: 950 } }, '/temps.html?' + MANAGER);
    await plain.waitForSelector('#rows [data-location]');
    assert.equal(await plain.$('#walk-bar'), null, 'no bar when Coolers is opened from the menu');
    await plain.context().close();
    results.push('Yard, Coolers and Production from the walkthrough: the bar with Walkthrough, the stop and Next / Done; none from the menu');

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
    // Managers only (Joe 10/15): a dispatcher on a phone keeps the normal home, and the walkthrough page tells them it is for managers.
    const sup = await openPage(browser, phone, '/index.html?testEmail=dispatch.test@uniteddairy.com');
    await sup.waitForSelector('#sides .launch-card');
    await sup.waitForTimeout(500);
    assert.match(sup.url(), /index\.html/, 'a dispatcher stays on the normal home');
    await sup.goto(HOSTING + '/walkthrough.html');
    await sup.waitForSelector('#not-manager:not([hidden])');
    assert.equal(await sup.isVisible('#list'), false);
    await sup.context().close();
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

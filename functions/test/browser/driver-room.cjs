'use strict';
/*
 * Browser check of the Driver Room Check-In tablet (Joe 10/12, layout A): driver-room.html with no account types a Driver
 * Room kiosk station's code (a TV's code is refused), then shows the drivers' phone screens in Driver Room mode (Joe 10/12:
 * "the driver's phone is exactly how this should look"): View Loadout, DVIR, Check-In; Done signs out, and 5 minutes with no
 * taps signs out and shows the rolling View Loadout.
 * No Back, Home or Sign out: Release at the very bottom asks for the manager release code (Joe 10/12 "Station"). Pictures at 1920 and tablet 1024 go to SHOTS_DIR.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const F = require('../fixtures/fake-sheets');
const A = require('../../src/admin');
const localCalls = require('./local-calls.cjs');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR;
const BOSS = { email: 'admin.test@uniteddairy.com' }, SIGNED = '?testEmail=admin.test@uniteddairy.com';

async function openPage(browser, width, height, url) {
  const page = await browser.newPage({ viewport: { width, height }, serviceWorkers: 'block' });
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
  });
  await localCalls(page);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(HOSTING + url);
  page.errors = errors;
  return page;
}
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, name) }); };
// A finger dragged up the middle of the screen (touch events, as a tablet sends them); returns how far the page or its list moved.
async function swipe(p) {
  const at = () => p.evaluate(() => scrollY + [...document.querySelectorAll('*')].reduce((n, e) => n + e.scrollTop, 0));
  const before = await at(), cdp = await p.context().newCDPSession(p), vp = p.viewportSize(), x = Math.round(vp.width / 2);
  const from = Math.round(vp.height * 0.8), to = Math.round(vp.height * 0.3);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: from }] });
  for (let y = from - 20; y >= to; y -= 20) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForTimeout(400);
  return (await at()) - before;
}
async function touchPage(browser, width, height, url, mobile) {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: !!mobile, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
  });
  await localCalls(page);
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  await page.goto(HOSTING + url);
  return page;
}

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: () => new Date('2026-10-09T12:00:00Z') });
  const kiosk = (await A.adminCall(db(), BOSS, { op: 'stationCode', key: 'fac_uniontown_kiosk_driver' })).code;
  const tv = (await A.adminCall(db(), BOSS, { op: 'stationCode', key: 'fac_uniontown_kiosk_tv' })).code;
  const release = (await A.adminCall(db(), BOSS, { op: 'releaseCodeNew', facilityId: 'fac_uniontown' })).code;
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const [w, h, tag] of [[1920, 1080, '1920'], [1024, 768, 'tablet']]) {
      // Joe 10/12 "these will still also need to have a United Dairy email address to log in first": the old tablet link
      // and the Check-In screens with no United Dairy sign-in go to the Driver Station link's Google sign-in.
      const p = await openPage(browser, w, h, '/driver-room.html');
      await p.waitForURL(/driver-station\.html$/);
      await p.waitForSelector('#signin:not([hidden]) #signin-button');
      await p.evaluate(() => localStorage.setItem('udRoomStation', JSON.stringify({ key: 'fac_uniontown_kiosk_driver', version: 'x', plant: 'Uniontown' })));
      await p.goto(HOSTING + '/route.html?room=1');
      await p.waitForURL(/driver-station\.html$/);
      await p.waitForSelector('#signin:not([hidden]) #signin-button');
      await shot(p, 'driver-room-0-signin-' + tag + '.png');
      // Signed in with a United Dairy account, the Driver Station link asks for the station code.
      await p.goto(HOSTING + '/driver-station.html' + SIGNED);
      await p.waitForSelector('#code-box form.st-code');
      await shot(p, 'driver-room-1-code-' + tag + '.png');
      await p.fill('#code-box input', kiosk);
      await p.click('#code-box button');
      // Joe 10/12 "the driver's phone is exactly how this should look": the phone screens in Driver Room mode, three choices.
      await p.waitForURL(/route\.html\?room=1$/);
      await p.waitForSelector('#step-menu:not([hidden]) #m-checkin');
      assert.equal(await p.textContent('.phone-top b'), 'Uniontown Driver Room Check-In Station');
      assert.deepEqual(await p.$$eval('#step-menu .drv-card b', b => b.map(x => x.textContent)), ['View Loadout', 'DVIR', 'Check-In']);
      assert.equal(await p.$('#go-back, #go-home, #signout'), null, 'no Back, Home or Sign out into the app');
      assert.ok(await p.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth), 'no side scroll');
      await shot(p, 'driver-room-2-choices-' + tag + '.png');
      // Check-In asks for the name, then his loads; Done signs him out, back to the choices.
      await p.click('#m-checkin');
      await p.waitForSelector('#step-name:not([hidden])');
      await p.waitForSelector('#name option[value="drv_test_casey"]', { state: 'attached' });
      assert.ok(await p.$('#name option[value="drv_test_brook"]'), 'BROOK, SAM (relief) is listed');
      await shot(p, 'driver-room-3-names-' + tag + '.png');
      await p.selectOption('#name', 'drv_test_casey');
      await p.click('#step-name button[type=submit]');
      await p.waitForSelector('#step-loads:not([hidden])');
      assert.equal(await p.textContent('#who'), 'CASEY, LEE');
      assert.equal(await p.textContent('#change'), 'Done');
      await shot(p, 'driver-room-4-checkin-' + tag + '.png');
      await p.click('#change');
      await p.waitForSelector('#step-menu:not([hidden])');
      assert.equal(await p.textContent('#who'), '', 'Done signed the driver out');
      // DVIR: the name, then the DVIR; Back keeps him signed in, Done ends it.
      await p.click('#m-dvir');
      await p.waitForSelector('#step-name:not([hidden]) #name option[value="drv_test_casey"]', { state: 'attached' });
      await p.selectOption('#name', 'drv_test_casey');
      await p.click('#step-name button[type=submit]');
      await p.waitForSelector('#step-dvir:not([hidden])');
      await shot(p, 'driver-room-5-dvir-' + tag + '.png');
      await p.click('#step-dvir [data-back]');
      await p.waitForSelector('#step-menu:not([hidden])');
      assert.match(await p.textContent('#m-who'), /CASEY, LEE/);
      await shot(p, 'driver-room-6-signed-in-' + tag + '.png');
      await p.click('#change');
      await p.waitForSelector('#step-menu:not([hidden])');
      // View Loadout: the rolling loads, no name needed; a tap brings back the choices.
      await p.click('#m-board');
      await p.waitForSelector('#step-board:not([hidden])');
      await p.waitForTimeout(600);
      await shot(p, 'driver-room-7-view-loadout-' + tag + '.png');
      await p.click('#board-track');
      await p.waitForSelector('#step-menu:not([hidden])');
      results.push('Driver Room ' + tag + ': with no United Dairy sign-in the tablet goes to the Driver Station Google sign-in; signed in, the Check-In Station code opens the phone screens (View Loadout, DVIR, Check-In) with no Back, Home or Sign out; Check-In and DVIR ask the name; Done signs out, Back keeps him; View Loadout needs no name and a tap brings back the choices');
      // Release is a bar along the very bottom on every Driver Room screen, the rolling View Loadout too; from there it brings
      // back the three choices with the release code box (Cancel keeps the tablet).
      assert.equal((await p.textContent('#m-station')).trim(), 'Release');
      await p.click('#m-board');
      await p.waitForSelector('#step-board:not([hidden])');
      const bar = await p.$eval('#m-station', el => el.getBoundingClientRect().bottom);
      assert.ok(Math.abs(bar - p.viewportSize().height) < 1, 'Release sits at the very bottom');
      await p.click('#m-station');
      await p.waitForSelector('#step-menu:not([hidden]) #release-box form');
      await shot(p, 'driver-room-9-release-' + tag + '.png');
      await p.click('#release-box [data-cancel]');
      assert.equal(await p.isVisible('#m-checkin'), true);
      results.push('Driver Room ' + tag + ': Release sits at the very bottom on every screen; from View Loadout it brings back the choices and asks for the release code; Cancel keeps the tablet');
      if (tag === '1920') {
        // Release with the manager release code.
        await p.click('#m-station');
        await p.fill('#release-box input', release);
        await Promise.all([p.waitForURL(/driver-station\.html$/), p.click('#release-box button[type=submit]')]);
        await p.waitForSelector('#code-box form.st-code');
        assert.equal(await p.evaluate(() => localStorage.getItem('udRoomStation')), null);
        results.push('Driver Room: Release asks for the manager release code, then back to the Driver Station code screen (still signed in)');
      }
      assert.deepEqual(p.errors, []);
      await p.close();
    }

    // Joe 10/12: 5 minutes with no taps signs the driver out and shows the rolling View Loadout; the phone link never signs
    // out by itself.
    {
      const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, serviceWorkers: 'block' });
      const q = await ctx.newPage();
      await q.clock.install();
      await q.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) }));
      await localCalls(q);
      await q.goto(HOSTING + '/driver-station.html' + SIGNED);
      await q.waitForSelector('#code-box form.st-code');
      await q.fill('#code-box input', kiosk);
      await q.click('#code-box button');
      await q.waitForURL(/route\.html\?room=1$/);
      await q.click('#m-checkin');
      await q.waitForSelector('#step-name:not([hidden]) #name option[value="drv_test_casey"]', { state: 'attached' });
      await q.selectOption('#name', 'drv_test_casey');
      await q.click('#step-name button[type=submit]');
      await q.waitForSelector('#step-loads:not([hidden])');
      await q.clock.fastForward(4 * 60000);
      assert.equal(await q.isVisible('#step-loads'), true, 'still on the Check-In after 4 minutes');
      await q.clock.fastForward(70000);
      await q.waitForSelector('#step-board:not([hidden])');
      assert.equal(await q.evaluate(() => sessionStorage.getItem('udRoom.driverId')), null, 'signed out');
      assert.equal(await q.textContent('#who'), '');
      await q.waitForTimeout(300);
      await shot(q, 'driver-room-8-idle-rolling-loads-tablet.png');
      await q.click('#board-track');
      await q.waitForSelector('#step-menu:not([hidden])');
      // The three choices with no one signed in also go back to the rolling loads after 5 minutes.
      await q.clock.fastForward(5 * 60000 + 6000);
      await q.waitForSelector('#step-board:not([hidden])');
      await ctx.close();
      results.push('Driver Room: 5 minutes with no taps signs the driver out and shows the rolling View Loadout; a tap brings back the three choices');
    }

    // Joe 10/12 (as the old page): View Loadout on the Driver Room Check-In Station updates the moment a load changes, with
    // no Refresh press and well before the 2-minute fallback.
    {
      const L = require('../../src/logic');
      // Loaded today for tomorrow's delivery (the board shows today's loading).
      const deliver = L.addDays(L.operatingDay(new Date()), 1), p = L.dayPrefix(deliver), id = L.weekStart(deliver) + '__run_live805';
      await db().collection('runs').doc(id).set({ weekStart: L.weekStart(deliver), route: '805', run: 'LIVE TEST', routeId: 'rte_t805', runId: 'run_live805', rev: 0,
        days: { [p]: { runs: true, driverId: 'drv_test_casey', driver: 'CASEY, LEE', truck: '900002', trailer: 'T-905' } } });
      const lv = await openPage(browser, 1024, 768, '/driver-station.html' + SIGNED);
      await lv.waitForSelector('#code-box form.st-code');
      await lv.fill('#code-box input', kiosk);
      await lv.click('#code-box button');
      await lv.waitForURL(/route\.html\?room=1$/);
      await lv.click('#m-board');
      await lv.waitForSelector('#board-track :text("T-905")');
      await lv.waitForTimeout(1500);
      await db().collection('runs').doc(id).update({ ['days.' + p + '.trailer']: 'T-977' });
      await lv.waitForSelector('#board-track :text("T-977")', { timeout: 10000 });
      assert.deepEqual(lv.errors, []);
      await lv.close();
      results.push('Driver Room: View Loadout updates by itself the moment a load changes (no Refresh, well before the 2-minute fallback)');
    }

    // Joe 10/12 "it does not let you scroll the list": the Check-In and DVIR screens scroll by finger on a phone and on
    // tablets (600, 800, 1024 wide), from the drivers' phone link and from the Driver Room tablet.
    const route = (await A.adminCall(db(), BOSS, { op: 'routeCodeNew' })).code;
    for (const [w, h, mobile] of [[390, 844, true], [600, 960, true], [800, 1280, true], [1024, 768, false]]) {
      const ph = await touchPage(browser, w, h, '/route.html', mobile);
      await ph.waitForSelector('#step-code:not([hidden])');
      await ph.fill('#code', route);
      await ph.click('#step-code button[type=submit]');
      await ph.click('#m-dvir');
      await ph.waitForSelector('#step-name:not([hidden])'); await ph.waitForSelector('#name option[value="drv_test_casey"]', { state: 'attached' });
      await ph.selectOption('#name', 'drv_test_casey');
      await ph.click('#step-name button[type=submit]');
      await ph.waitForSelector('#step-dvir:not([hidden])');
      const moved = await swipe(ph);
      await shot(ph, 'phone-scroll-dvir-' + w + '.png');
      assert.ok(moved > 50, 'the phone DVIR scrolls by finger at ' + w);
      assert.deepEqual(ph.errors, []);
      await ph.context().close();

      const tab = await touchPage(browser, w, h, '/driver-station.html' + SIGNED, mobile);
      await tab.waitForSelector('#code-box form.st-code');
      await tab.fill('#code-box input', kiosk);
      await tab.click('#code-box button');
      await tab.waitForURL(/route\.html\?room=1$/);
      await tab.click('#m-dvir');
      await tab.waitForSelector('#step-name:not([hidden]) #name option[value="drv_test_casey"]', { state: 'attached' });
      await tab.selectOption('#name', 'drv_test_casey');
      await tab.click('#step-name button[type=submit]');
      await tab.waitForSelector('#step-dvir:not([hidden])');
      const roomMoved = await swipe(tab);
      await shot(tab, 'room-scroll-dvir-' + w + '.png');
      assert.ok(roomMoved > 50, 'the Driver Room DVIR scrolls by finger at ' + w);
      assert.deepEqual(tab.errors, []);
      await tab.context().close();
    }
    results.push('Check-In and DVIR scroll by finger on a phone (390) and tablets (600, 800, 1024), from the phone link and the Driver Room tablet');

    // Joe 10/13 (photo of the Uniontown tablet in landscape): the Driver Room Check-In Station uses the tablet's whole width,
    // not the phone column. The three choices sit in one row, and the whole Check-In (with "Was your truck loaded correctly?"
    // answered No and its box open) shows above the Release bar with no scrolling on 1024 and 1280 landscape tablets; on
    // 800 it is two columns and scrolls by finger. The drivers' phone link keeps its phone column.
    {
      const L = require('../../src/logic');
      const today = L.operatingDay(new Date()), pf = L.dayPrefix(today), wk = L.weekStart(today);
      await db().collection('runs').doc(wk + '__run_land801').set({ weekStart: wk, route: '811', run: 'LANDSCAPE', routeId: 'rte_land811', runId: 'run_land801', rev: 0,
        days: { [pf]: { runs: true, driverId: 'drv_test_casey', driver: 'CASEY, LEE', truck: '900001', trailer: 'T-811' } } });
      for (const [w, h] of [[1280, 680], [1024, 600], [800, 480]]) {
        const tab = await touchPage(browser, w, h, '/driver-station.html' + SIGNED);
        await tab.waitForSelector('#code-box form.st-code');
        await tab.fill('#code-box input', kiosk);
        await tab.click('#code-box button');
        await tab.waitForURL(/route\.html\?room=1$/);
        await tab.waitForSelector('#step-menu:not([hidden]) #m-checkin');
        const fit = () => tab.evaluate(() => ({ card: Math.max(...[...document.querySelectorAll('.phone-card:not([hidden])')].map(c => c.getBoundingClientRect().bottom)),
          bar: document.getElementById('m-station').getBoundingClientRect().top, side: document.scrollingElement.scrollWidth - innerWidth, body: document.body.getBoundingClientRect().width }));
        // Joe 10/13 "filling the whole screen": in a Chrome tab the first tap puts the station full screen.
        assert.equal(await tab.evaluate(() => !!document.fullscreenElement), false);
        await tab.click('#step-menu h1');
        await tab.waitForFunction(() => document.fullscreenElement === document.documentElement);
        let f = await fit();
        assert.ok(f.body >= w - 1, 'the station uses the whole width at ' + w);
        const tops = await tab.$$eval('#step-menu .drv-card', b => b.map(x => Math.round(x.getBoundingClientRect().top)));
        assert.equal(new Set(tops).size, 1, 'the three choices in one row at ' + w);
        assert.ok(f.card <= f.bar && f.side <= 0, 'the choices show above Release at ' + w);
        await shot(tab, 'room-landscape-choices-' + w + '.png');
        await tab.click('#m-checkin');
        await tab.waitForSelector('#step-name:not([hidden]) #name option[value="drv_test_casey"]', { state: 'attached' });
        await tab.selectOption('#name', 'drv_test_casey');
        await tab.click('#step-name button[type=submit]');
        await tab.click('.phone-load:has(b:text-is("811"))');
        await tab.waitForSelector('#step-form:not([hidden])');
        await tab.click('.ci-loaded label:has([value=NO])');
        await tab.waitForSelector('.ci-loaded-box:not([hidden])');
        f = await fit();
        assert.ok(f.side <= 0, 'no side scroll on the Check-In at ' + w);
        if (w >= 1024) assert.ok(f.card <= f.bar, 'the whole Check-In shows above Release at ' + w + ' (' + Math.round(f.card) + ' > ' + Math.round(f.bar) + ')');
        else assert.ok(await swipe(tab) > 50, 'the Check-In scrolls by finger at ' + w);
        await shot(tab, 'room-landscape-checkin-' + w + '.png');
        assert.deepEqual(tab.errors, []);
        await tab.context().close();
      }
      const ph = await openPage(browser, 1024, 600, '/route.html');
      await ph.waitForSelector('#step-code:not([hidden])');
      assert.equal(await ph.evaluate(() => Math.round(document.body.getBoundingClientRect().width)), 460, 'the drivers\' phone link keeps its phone column');
      await ph.close();
      results.push('Driver Room landscape tablet (1280, 1024, 800): the first tap in a Chrome tab puts it full screen; the whole width is used; the three choices in one row; the whole Check-In with the loaded-wrong box open shows above Release at 1024 and 1280 and scrolls by finger at 800; the phone link keeps its phone column');
    }
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('OK  ' + r));
})().catch(e => { console.error(e); process.exit(1); });

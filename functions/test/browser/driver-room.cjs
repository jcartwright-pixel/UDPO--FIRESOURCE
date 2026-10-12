'use strict';
/*
 * Browser check of the Driver Room Check-In tablet (Joe 10/12, layout A): driver-room.html with no account types a Driver
 * Room kiosk station's code (a TV's code is refused), shows today's loadout and the drivers' names (Regular, Relief); a
 * driver picks View Loadout, Check-In or DVIR; Check-In and DVIR ask his name and open the phone screens in Driver Room
 * mode; Done comes back signed out, and 5 minutes with no taps goes back to View Loadout.
 * Change Station asks for the manager release code. Pictures at 1920 and tablet 1024 go to SHOTS_DIR.
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
const BOSS = { email: 'admin.test@uniteddairy.com' };

async function openPage(browser, width, height, url) {
  const page = await browser.newPage({ viewport: { width, height } });
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
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: !!mobile });
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
      const p = await openPage(browser, w, h, '/driver-room.html');
      await p.waitForSelector('#code-box form.st-code');
      await shot(p, 'driver-room-1-code-' + tag + '.png');
      // The TV's code is refused here: the TV keeps the Driver Station link.
      await p.fill('#code-box input', tv);
      await p.click('#code-box button');
      await p.waitForSelector('.st-code-msg:text("Driver Room TV")');
      await p.fill('#code-box input', kiosk);
      await p.click('#code-box button');
      // Joe 10/12: three choices first: View Loadout, DVIR, Check-In.
      await p.waitForSelector('#menu:not([hidden]) #go-checkin');
      assert.match(await p.textContent('#plant'), /Uniontown Driver Room/);
      assert.deepEqual(await p.$$eval('#menu .dr-card', b => b.map(x => x.firstChild.textContent)), ['View Loadout', 'DVIR', 'Check-In']);
      await shot(p, 'driver-room-2-choices-' + tag + '.png');
      // Check-In asks for the name.
      await p.click('#go-checkin');
      await p.waitForSelector('#pick:not([hidden]) #names button');
      const heads = await p.$$eval('#names h3', x => x.map(e => e.textContent));
      assert.deepEqual(heads.slice(0, 2), ['REGULAR DRIVERS', 'RELIEF DRIVERS']);
      assert.ok(await p.$('#names button[data-id="drv_test_brook"]'), 'BROOK, SAM (relief) is listed');
      assert.ok(await p.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth), 'no side scroll');
      await shot(p, 'driver-room-3-names-' + tag + '.png');
      // His name opens the Check-In for CASEY; Done signs him out and comes back to the choices.
      await Promise.all([p.waitForURL(/route\.html\?room=1$/), p.click('#names button[data-id="drv_test_casey"]')]);
      await p.waitForSelector('#step-loads:not([hidden])');
      assert.equal(await p.textContent('#who'), 'CASEY, LEE');
      assert.equal(await p.textContent('#change'), 'Done');
      await shot(p, 'driver-room-4-checkin-' + tag + '.png');
      await Promise.all([p.waitForURL(/driver-room\.html$/), p.click('#change')]);
      await p.waitForSelector('#menu:not([hidden]) #go-dvir');
      assert.equal(await p.isVisible('#me'), false, 'Done signed the driver out');
      // DVIR: the name, then the DVIR; Back keeps him signed in (Check-In or DVIR without his name again), Sign Out ends it.
      await p.click('#go-dvir');
      await p.waitForSelector('#pick-title:text-is("DVIR")');
      await Promise.all([p.waitForURL(/view=dvir/), p.click('#names button[data-id="drv_test_casey"]')]);
      await p.waitForSelector('#step-dvir:not([hidden])');
      await shot(p, 'driver-room-5-dvir-' + tag + '.png');
      await Promise.all([p.waitForURL(/driver-room\.html$/), p.click('#step-dvir [data-back]')]);
      await p.waitForSelector('#me:not([hidden]) #to-checkin');
      assert.equal(await p.textContent('#me-name'), 'CASEY, LEE');
      await shot(p, 'driver-room-6-signed-in-' + tag + '.png');
      await p.click('#sign-out');
      await p.waitForSelector('#menu:not([hidden])');
      // View Loadout: the loadout full width, with Check-In and DVIR at the top.
      await p.click('#go-board');
      await p.waitForSelector('body.dr-loadout #h-checkin:not([hidden])');
      assert.equal(await p.isVisible('#side'), false);
      await shot(p, 'driver-room-7-view-loadout-' + tag + '.png');
      await p.click('#h-dvir');
      await p.waitForSelector('#pick:not([hidden])');
      assert.equal(await p.textContent('#pick-title'), 'DVIR');
      await p.click('#pick-cancel');
      await p.waitForSelector('#menu:not([hidden])');
      results.push('Driver Room ' + tag + ': a TV code is refused; the kiosk code opens View Loadout, DVIR and Check-In; Check-In and DVIR ask for the name and open the phone screens for that driver; Done signs out, Back keeps him; View Loadout fills the screen');
      if (tag === '1920') {
        // Change Station with the manager release code.
        await p.click('#change');
        await p.fill('#release-box input', release);
        await p.click('#release-box button[type=submit]');
        await p.waitForSelector('#code-box form.st-code');
        assert.equal(await p.evaluate(() => localStorage.getItem('udRoomStation')), null);
        results.push('Driver Room: Change Station asks for the manager release code, then back to the code screen');
      }
      assert.deepEqual(p.errors, []);
      await p.close();
    }

    // Joe 10/12: 5 minutes with no taps signs the driver out and goes back to the scrolling View Loadout, also from the
    // Check-In screen; the phone link never signs out by itself.
    {
      const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 } });
      const q = await ctx.newPage();
      await q.clock.install();
      await q.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) }));
      await localCalls(q);
      await q.goto(HOSTING + '/driver-room.html');
      await q.waitForSelector('#code-box form.st-code');
      await q.fill('#code-box input', kiosk);
      await q.click('#code-box button');
      await q.click('#go-checkin');
      await Promise.all([q.waitForURL(/route\.html\?room=1$/), q.click('#names button[data-id="drv_test_casey"]')]);
      await q.waitForSelector('#step-loads:not([hidden])');
      await q.clock.fastForward(4 * 60000);
      assert.match(q.url(), /route\.html/, 'still on the Check-In after 4 minutes');
      await Promise.all([q.waitForURL(/driver-room\.html\?view=loadout$/), q.clock.fastForward(70000)]);
      await q.waitForSelector('body.dr-loadout #h-checkin:not([hidden])');
      assert.equal(await q.evaluate(() => sessionStorage.getItem('udRoom.driverId')), null, 'signed out');
      // On the Driver Room page itself: the choices go back to View Loadout after 5 minutes too.
      await q.click('#h-checkin');
      await q.waitForSelector('#pick:not([hidden])');
      await q.clock.fastForward(5 * 60000 + 6000);
      await q.waitForSelector('body.dr-loadout');
      await ctx.close();
      results.push('Driver Room: 5 minutes with no taps (on the Check-In or the Driver Room page) signs the driver out and goes back to View Loadout');
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

      const tab = await touchPage(browser, w, h, '/driver-room.html', mobile);
      await tab.waitForSelector('#code-box form.st-code');
      await tab.fill('#code-box input', kiosk);
      await tab.click('#code-box button');
      await tab.click('#go-dvir');
      await Promise.all([tab.waitForURL(/view=dvir/), tab.click('#names button[data-id="drv_test_casey"]')]);
      await tab.waitForSelector('#step-dvir:not([hidden])');
      const roomMoved = await swipe(tab);
      await shot(tab, 'room-scroll-dvir-' + w + '.png');
      assert.ok(roomMoved > 50, 'the Driver Room DVIR scrolls by finger at ' + w);
      assert.deepEqual(tab.errors, []);
      await tab.context().close();
    }
    // The Driver Room page itself on a short phone screen (stacked): it scrolls as a whole to the names.
    const short = await touchPage(browser, 390, 560, '/driver-room.html', true);
    await short.waitForSelector('#code-box form.st-code');
    await short.fill('#code-box input', kiosk);
    await short.click('#code-box button');
    await short.click('#go-checkin');
    await short.waitForSelector('#names button[data-id="drv_test_casey"]');
    assert.ok(await swipe(short) > 50, 'the Driver Room page scrolls by finger on a short phone screen');
    await shot(short, 'room-scroll-names-390.png');
    await short.context().close();
    results.push('Check-In and DVIR scroll by finger on a phone (390) and tablets (600, 800, 1024), from the phone link and the Driver Room tablet');
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('OK  ' + r));
})().catch(e => { console.error(e); process.exit(1); });

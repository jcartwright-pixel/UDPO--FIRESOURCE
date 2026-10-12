'use strict';
/*
 * Browser check of the Driver Room Check-In tablet (Joe 10/12, layout A): driver-room.html with no account types a Driver
 * Room kiosk station's code (a TV's code is refused), shows today's loadout and the drivers' names (Regular, Relief); a
 * driver taps his name, then Check-In or DVIR open the phone screens in Driver Room mode, and Done comes back signed out.
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
      await p.waitForSelector('#names button');
      assert.match(await p.textContent('#plant'), /Uniontown Driver Room/);
      const heads = await p.$$eval('#names h3', x => x.map(e => e.textContent));
      assert.deepEqual(heads.slice(0, 2), ['REGULAR DRIVERS', 'RELIEF DRIVERS']);
      assert.ok(await p.$('#names button[data-id="drv_test_brook"]'), 'BROOK, SAM (relief) is listed');
      assert.ok(await p.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth), 'no side scroll');
      await shot(p, 'driver-room-2-names-' + tag + '.png');
      await p.click('#names button[data-id="drv_test_casey"]');
      await p.waitForSelector('#me:not([hidden]) #to-checkin');
      assert.equal(await p.textContent('#me-name'), 'CASEY, LEE');
      await shot(p, 'driver-room-3-signed-in-' + tag + '.png');
      if (tag === '1920') {
        // Check-In: the phone screens in Driver Room mode, for CASEY; Done signs him out and comes back.
        await Promise.all([p.waitForURL(/route\.html\?room=1$/), p.click('#to-checkin')]);
        await p.waitForSelector('#step-loads:not([hidden])');
        assert.equal(await p.textContent('#who'), 'CASEY, LEE');
        assert.equal(await p.textContent('#change'), 'Done');
        await shot(p, 'driver-room-4-checkin-' + tag + '.png');
        await Promise.all([p.waitForURL(/driver-room\.html$/), p.click('#change')]);
        await p.waitForSelector('#names button');
        assert.equal(await p.isVisible('#me'), false, 'Done signed the driver out');
        // DVIR.
        await p.click('#names button[data-id="drv_test_casey"]');
        await Promise.all([p.waitForURL(/view=dvir/), p.click('#to-dvir')]);
        await p.waitForSelector('#step-dvir:not([hidden])');
        await shot(p, 'driver-room-5-dvir-' + tag + '.png');
        await Promise.all([p.waitForURL(/driver-room\.html$/), p.click('#change')]);
        await p.waitForSelector('#names button');
        results.push('Driver Room: a TV code is refused; the Driver Room kiosk code shows the loadout and the names (Regular, Relief); a name gives Check-In and DVIR, which open the phone screens for that driver; Done comes back signed out');
        // Sign Out, then Change Station with the manager release code.
        await p.click('#names button[data-id="drv_test_casey"]');
        await p.click('#sign-out');
        await p.waitForSelector('#pick:not([hidden])');
        await p.click('#change');
        await p.fill('#release-box input', release);
        await p.click('#release-box button[type=submit]');
        await p.waitForSelector('#code-box form.st-code');
        assert.equal(await p.evaluate(() => localStorage.getItem('udRoomStation')), null);
        results.push('Driver Room: Sign Out; Change Station asks for the manager release code, then back to the code screen');
      }
      assert.deepEqual(p.errors, []);
      await p.close();
    }
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('OK  ' + r));
})().catch(e => { console.error(e); process.exit(1); });

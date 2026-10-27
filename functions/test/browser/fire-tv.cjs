'use strict';
/*
 * Browser check of the Driver's Kiosk Station TV with no UD account (Joe 10/16, a Fire Stick; Google's sign-in does not open
 * in a TV's kiosk browser): the TV link (?tv=1) asks for the TV's code, a wrong code and a Driver Room tablet's code are
 * refused, the TV's code opens the board with no Google sign-in, a silent keep-awake video plays behind it (Joe 10/23, LG TV
 * screen saver), a reload keeps it, and a new code signs the TV out.
 * Pictures at 1920 go to SHOTS_DIR.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const ST = require('../../src/stations');
const localCalls = require('./local-calls.cjs');
const L = require('../../src/logic');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR;
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, name) }); };
const TV = 'fac_uniontown_kiosk_tv', ROOM = 'fac_uniontown_kiosk_driver';

(async () => {
  const browser = await chromium.launch();
  const results = [];
  try {
    await clear();
    const tvCode = (await ST.stationCode(db(), 'admin.test@uniteddairy.com', { key: TV }, new Date().toISOString())).code;
    const roomCode = (await ST.stationCode(db(), 'admin.test@uniteddairy.com', { key: ROOM }, new Date().toISOString())).code;
    // The board is the loads going out for the next delivery day (as station-offline.cjs).
    const today = L.addDays(L.operatingDay(new Date()), 1), wk = L.weekStart(today);
    await db().collection('runs').doc(wk + '__run_tv805').set({ weekStart: wk, route: '805', run: 'UT DSD MILK', routeId: 'rte_tv805', runId: 'run_tv805', rev: 0,
      days: { [L.dayPrefix(today)]: { runs: true, loadSequence: 15, driverId: 'drv_test_casey', driver: 'CASEY, LEE', truck: '900005', trailer: 'T-905' } } });

    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, serviceWorkers: 'block' });
    await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
      route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
    });
    await page.route(/api\.open-meteo\.com/, route => route.abort());
    await localCalls(page);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(HOSTING + '/driver-station.html?tv=1');
    await page.waitForSelector('#tvacct:not([hidden])');
    assert.match(await page.textContent('#signin-text'), /No United Dairy account is needed/);
    assert.equal((await page.textContent('#signin-button')).trim(), 'Or sign in with a United Dairy account');
    await shot(page, 'fire-tv-1-code-1920.png');
    await page.fill('#tvacct-code', 'ZZZZZZ');
    await page.click('#tvacct button');
    await page.waitForSelector('#tvacct-msg:text("not recognized")');
    await page.fill('#tvacct-code', roomCode);
    await page.click('#tvacct button');
    await page.waitForSelector('#tvacct-msg:text("not a Driver\'s Kiosk Station (TV) code")');
    results.push('Fire Stick TV link: asks for the TV\'s code (no Google sign-in needed); a wrong code and the Driver Room tablet\'s code are refused');

    await page.fill('#tvacct-code', tvCode.toLowerCase());
    await page.click('#tvacct button');
    await page.waitForSelector('#screen:not([hidden])');
    await page.waitForSelector('.ds-row:not(.ds-headrow):has-text("805")', { timeout: 20000 });
    assert.match(await page.textContent('#eyebrow'), /Driver's Kiosk Station · Uniontown/);
    assert.equal(await page.isVisible('#code-box'), false, 'no second code screen');
    assert.equal(await page.$('#ds-score iframe'), null, 'no scorecard panel (it needs a UD sign-in)');
    await page.waitForFunction(() => /\d+ routes?/.test(document.getElementById('foot').textContent));
    await shot(page, 'fire-tv-2-board-1920.png');
    results.push('Fire Stick TV: its code opens the board straight away, no Google sign-in, schedule only');

    // Joe 10/23 (LG TV): a silent video plays behind the board so the TV's screen saver stays away.
    await page.waitForFunction(() => { const v = document.getElementById('ds-awake'); return v && !v.paused && v.muted && v.loop && v.currentTime > 0.5; }, null, { timeout: 15000 });
    assert.equal(await page.evaluate(() => document.elementFromPoint(500, 300).closest('#screen') !== null), true, 'behind the board');
    await shot(page, 'fire-tv-3-board-awake-1920.png');
    results.push('TV link: a silent video plays behind the board, over and over, to keep the TV\'s screen saver away');

    // Joe 10/27 (Raspberry Pi): the lists keep rolling. A list that grows past the screen starts to roll, it rolls on a
    // screen that rounds to whole screen dots (zoomed out, as a 4K TV can be), and a screen that gets shorter starts it too.
    const scrolled = (id) => page.evaluate((i) => document.getElementById(i).scrollTop, id);
    const rolls = async (id, what) => {
      await page.waitForSelector('#' + id + ' .ds-band', { timeout: 15000 });
      const a = await scrolled(id); await page.waitForTimeout(2500); const b = await scrolled(id);
      assert.ok(b > a + 10, what + ' rolls (' + a + ' -> ' + b + ')');
    };
    const batch = db().batch();
    for (let i = 0; i < 40; i++) {
      const rt = String(810 + i);
      batch.set(db().collection('runs').doc(wk + '__run_tv' + rt), { weekStart: wk, route: rt, run: 'UT DSD ' + rt, routeId: 'rte_tv' + rt, runId: 'run_tv' + rt, rev: 0,
        days: { [L.dayPrefix(today)]: { runs: true, loadSequence: 20 + i, driverId: 'drv_tv' + rt, driver: 'DRIVER ' + rt, truck: '9' + rt, trailer: 'T-' + rt } } });
    }
    await batch.commit();
    await rolls('board-scroll', 'the loadout list (grown past the screen)');
    await rolls('week-scroll', 'the weekly schedule');
    await page.evaluate(() => { document.body.style.zoom = '0.6'; });
    await page.waitForTimeout(500);
    await rolls('board-scroll', 'the loadout list zoomed out');
    await page.evaluate(() => { document.body.style.zoom = ''; });
    await page.setViewportSize({ width: 1920, height: 6000 });
    await page.waitForFunction(() => !document.querySelector('#board .ds-band'), null, { timeout: 15000 });
    await page.setViewportSize({ width: 1920, height: 1080 });
    await rolls('board-scroll', 'the loadout list after the screen got shorter');
    results.push('TV: both lists roll when they grow past the screen, keep rolling zoomed out, and start again when the screen gets shorter');

    await page.reload();
    await page.waitForSelector('.ds-row:not(.ds-headrow):has-text("805")', { timeout: 20000 });
    assert.equal(await page.isVisible('#signin'), false, 'still signed in after a reload (as after a power loss)');
    results.push('Fire Stick TV: a reload (as after a power loss) opens the board again with nothing typed');

    await ST.stationCode(db(), 'admin.test@uniteddairy.com', { key: TV }, new Date().toISOString());
    await page.evaluate(() => location.reload());
    await page.waitForSelector('#tvacct:not([hidden])', { timeout: 20000 });
    results.push('Fire Stick TV: a new code in Administration signs the TV out; it asks for the new code');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('OK  ' + r));
})().catch(e => { console.error(e); process.exit(1); });

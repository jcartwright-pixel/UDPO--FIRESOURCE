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
    // Joe 10/27 (Raspberry Pi): the weather sign is drawn by the page, not a picture-letter the screen may not have.
    await page.route(/api\.open-meteo\.com/, route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      current: { temperature_2m: 63, weather_code: 1, wind_speed_10m: 6 },
      daily: { weather_code: [1, 3], temperature_2m_max: [68, 70], temperature_2m_min: [44, 47], precipitation_probability_max: [1, 10] } }) }));
    // Joe 10/27: the live weather turn. The check stands in for YouTube: its player script answers ready at once.
    await page.route(/youtube\.com\/iframe_api/, route => route.fulfill({ contentType: 'text/javascript',
      body: 'window.YT = { Player: function (id, o) { const t = { mute() {}, playVideo() { window.udLivePlays = (window.udLivePlays || 0) + 1; }, pauseVideo() { window.udLivePaused = (window.udLivePaused || 0) + 1; } }; this.playVideo = t.playVideo; this.pauseVideo = t.pauseVideo; setTimeout(() => o.events.onReady({ target: t }), 50); } }; window.onYouTubeIframeAPIReady();' }));
    await page.route(/youtube\.com\/embed\//, route => route.fulfill({ contentType: 'text/html', body: '<body style="background:#123">live</body>' }));
    await localCalls(page);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    // The server's copy for the TV: no scores yet, and FOX Weather's live video as read from its YouTube page.
    const LIVE = { video: 'FoxWxLive01', channel: 'UCaaaaaaaaaaaaaaaaaaaaaa', live: true, embed: true, at: new Date().toISOString(), problem: '' };
    await db().collection('scorecard').doc('kiosk').set({ label: 'Oct 26', through: '', areas: [], rows: [], live: LIVE, at: new Date().toISOString() });
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
    await page.waitForFunction(() => /\d+ routes?/.test(document.getElementById('foot').textContent));
    await page.waitForSelector('#wx-sym svg');
    assert.match(await page.textContent('#weather-now'), /63°F · Mostly clear/);
    assert.match(await page.textContent('#wx'), /63°F · Mostly clear/);
    // Joe 10/27: the right-hand box: FOX Weather live first (the weather is in the top bar), then the Driver Scorecard,
    // 30 seconds each. The TV's own code reads the server's copy of the overall scores (scorecard/kiosk).
    await page.waitForSelector('#turn-live:not([hidden]) iframe[src*="youtube.com/embed/FoxWxLive01?"]');
    // Joe 10/28: YouTube plays an embedded video only when it is told the site's address (the app tells other sites nothing).
    assert.equal(await page.getAttribute('#live-frame', 'referrerpolicy'), 'strict-origin-when-cross-origin');
    // Joe 10/28: the weekly schedule is the same size as the Loadout list above it.
    assert.deepEqual(await page.evaluate(() => { const st = (q) => getComputedStyle(document.querySelector(q)); return [st('#week-rows td').fontSize, st('.ds-row:not(.ds-headrow)').fontSize]; }), ['23px', '23px']);
    assert.ok(await page.evaluate(() => document.querySelector('#week-rows tr').getBoundingClientRect().height >= 63), 'schedule rows as tall as the Loadout rows');
    // Long names and routes wrap or get smaller; no cell is cut off.
    assert.deepEqual(await page.$$eval('#week-rows td', t => t.filter(c => c.scrollWidth > c.clientWidth + 1).map(c => c.textContent)), []);
    assert.equal(await page.isVisible('#turn-weather'), false);
    await shot(page, 'fire-tv-2-board-1920.png');
    await db().collection('scorecard').doc('kiosk').set({ label: 'Oct 26', through: '2026-10-26', areas: [], live: LIVE, at: new Date().toISOString(),
      rows: [{ rank: 1, driver: 'PRICE, LEE', score: 98, grade: 'A' }, { rank: 2, driver: 'MILLER, DANA', score: 84, grade: 'B' }] });
    await page.evaluate(() => window.udTurn());
    await page.waitForSelector('#turn-score:not([hidden]) #sc-rows tr');
    assert.deepEqual(await page.$$eval('#sc-rows tr', t => t.map(r => r.textContent)), ['1PRICE, LEE98 A', '2MILLER, DANA84 B']);
    assert.match(await page.textContent('#sc-label'), /Oct 26 · through 10-26-26/);
    assert.equal(await page.isVisible('#turn-live'), false);
    assert.ok(await page.evaluate(() => window.udLivePaused > 0), 'the live picture pauses during the Scorecard turn');
    await shot(page, 'fire-tv-2b-scorecard-turn-1920.png');
    // Joe 10/28: two-digit ranks were cut off; every rank shows whole.
    await db().collection('scorecard').doc('kiosk').set({ label: 'Oct 26', through: '2026-10-26', areas: [], live: LIVE, at: new Date().toISOString(),
      rows: Array.from({ length: 14 }, (x, i) => ({ rank: i + 1, driver: 'DRIVER ' + (i + 1) + ', LONGNAME', score: 99 - i, grade: 'A' })) });
    await page.waitForFunction(() => document.querySelectorAll('#sc-rows tr').length === 14);
    assert.deepEqual(await page.$$eval('#sc-rows td.rk', t => t.filter(c => c.scrollWidth > c.clientWidth || c.getBoundingClientRect().width < 50).map(c => c.textContent)), []);
    assert.equal(await page.$$eval('#sc-rows td.rk', t => t.map(c => c.textContent).join(',')), '1,2,3,4,5,6,7,8,9,10,11,12,13,14');
    await shot(page, 'fire-tv-2c-scorecard-ranks-1920.png');
    await page.evaluate(() => window.udTurn());
    await page.waitForSelector('#turn-live:not([hidden])');
    // Joe 10/28: FOX starts another live video: the TV changes to it. A video YouTube won't let other sites show: local weather.
    await db().collection('scorecard').doc('kiosk').update({ live: Object.assign({}, LIVE, { video: 'FoxWxLive02' }) });
    await page.waitForSelector('#turn-live:not([hidden]) iframe[src*="youtube.com/embed/FoxWxLive02?"]');
    await db().collection('scorecard').doc('kiosk').update({ live: Object.assign({}, LIVE, { video: 'FoxWxLive02', embed: false }) });
    await page.waitForSelector('#turn-weather:not([hidden]) .now');
    assert.equal(await page.$('#live-frame'), null);
    await db().collection('scorecard').doc('kiosk').update({ live: LIVE });
    await page.waitForSelector('#turn-live:not([hidden]) iframe[src*="youtube.com/embed/FoxWxLive01?"]');
    results.push('TV: weather in the top bar; the right-hand box takes turns: FOX Weather live (paused while hidden), then the Driver Scorecard\'s overall scores');
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
    await page.waitForTimeout(1500);
    await shot(page, 'fire-tv-4-board-full-1920.png');
    await page.evaluate(() => { document.body.style.zoom = '0.6'; });
    await page.waitForTimeout(500);
    await rolls('board-scroll', 'the loadout list zoomed out');
    await page.evaluate(() => { document.body.style.zoom = ''; });
    await page.setViewportSize({ width: 1920, height: 6000 });
    await page.waitForFunction(() => !document.querySelector('#board .ds-band'), null, { timeout: 15000 });
    await page.setViewportSize({ width: 1920, height: 1080 });
    await rolls('board-scroll', 'the loadout list after the screen got shorter');
    results.push('TV: both lists roll when they grow past the screen, keep rolling zoomed out, and start again when the screen gets shorter');

    // Joe 10/28: a release published while the TV is on reloads the board by itself (nobody presses Refresh on a TV).
    let release = 'aaa111';
    await page.route(/\/version\.json/, route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ label: 'test', commit: release }) }));
    await page.reload();
    await page.waitForSelector('.ds-row:not(.ds-headrow):has-text("805")', { timeout: 20000 });
    assert.equal(await page.isVisible('#signin'), false, 'still signed in after a reload (as after a power loss)');
    await page.evaluate(() => { window.udBeforeRelease = 1; return window.udTvVersionCheck(); });
    assert.equal(await page.evaluate(() => window.udBeforeRelease), 1, 'the same version: no reload');
    release = 'bbb222';
    await Promise.all([page.waitForNavigation(), page.evaluate(() => window.udTvVersionCheck())]);
    await page.waitForSelector('.ds-row:not(.ds-headrow):has-text("805")', { timeout: 20000 });
    assert.equal(await page.evaluate(() => window.udBeforeRelease), undefined, 'a new version reloads the board');
    await page.unroute(/\/version\.json/);
    results.push('TV: a new version published reloads the board by itself');
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

'use strict';
/*
 * Browser check of the station screens keeping the tablet's screen on (Joe 10/29, Galaxy tablet: "even though I have the
 * screensaver to never shut off, it shuts off"). Every station, line tablet, Driver Room tablet and TV screen asks the browser
 * to keep the screen on (Screen Wake Lock) as soon as it opens, asks again when the browser lets it go and the screen comes
 * back, and plays a tiny silent looping video when the browser has no way to keep it on. A driver's own phone and a computer
 * opening the Line Tablet from the menus are left alone.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const HOSTING = process.argv[2] || 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));

// A stand-in for the browser's keep-the-screen-on: counts each ask, and window.udDropLock() lets it go as a browser does
// when the screen turns off. ?noWakeLock in the init means a browser without it.
const FAKE_LOCK = `(() => {
  window.udLockAsks = 0;
  if (window.udNoWakeLock) { try { delete Navigator.prototype.wakeLock; } catch (e) {} Object.defineProperty(navigator, 'wakeLock', { value: undefined }); return; }
  let held = null;
  Object.defineProperty(navigator, 'wakeLock', { value: { request: async (type) => {
    if (type !== 'screen') throw new Error('screen only');
    window.udLockAsks++;
    const t = new EventTarget(); t.released = false; t.type = type;
    t.release = async () => { if (t.released) return; t.released = true; t.dispatchEvent(new Event('release')); };
    held = t; return t;
  } } });
  window.udDropLock = () => held && held.release();
})();`;

async function open(browser, url, opts) {
  opts = opts || {};
  // A touch tablet or phone (opts.touch = its width x height), else a computer with a mouse.
  const t = opts.touch;
  const ctx = await browser.newContext(t ? { viewport: { width: t[0], height: t[1] }, screen: { width: t[0], height: t[1] }, hasTouch: true, isMobile: true, serviceWorkers: 'block' }
    : { viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  if (opts.noLock) await ctx.addInitScript('window.udNoWakeLock = true;');
  if (opts.init) await ctx.addInitScript(opts.init);
  await ctx.addInitScript(FAKE_LOCK);
  const page = await ctx.newPage();
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
  });
  await page.route(/api\.open-meteo\.com|youtube\.com|radar\.weather\.gov/, route => route.abort());
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(HOSTING + '/' + url);
  return { ctx, page, errors };
}

(async () => {
  const browser = await chromium.launch();
  const results = [];
  try {
    const ROOM = 'localStorage.setItem("udRoomStation", JSON.stringify({ key: "fac_uniontown_kiosk_driver", plant: "UNIONTOWN", name: "Driver Room" }));';
    const stations = [['plant-station.html'], ['garage-station.html'], ['maint-station.html'], ['driver-station.html'], ['driver-station.html?tv=1'],
      ['plant-kiosk.html?tv=1'], ['line.html?tablet=1'], ['route.html?room=1', ROOM]];
    for (const [url, init] of stations) {
      const { ctx, page } = await open(browser, url, { init });
      // One ask when the screen opens (a station may still move to its code screen while it starts; each page asks for itself).
      await page.waitForFunction(() => document.documentElement.dataset.awake === 'lock' && window.udLockAsks === 1, null, { timeout: 15000 });
      if (process.env.DEBUG_AWAKE) console.log(url, '->', page.url());
      results.push(url + ' keeps the screen on');
      await ctx.close();
    }

    // The browser lets the screen go (screen off, another app): the screen asks again when it is back.
    {
      const { ctx, page, errors } = await open(browser, 'plant-station.html');
      await page.waitForFunction(() => document.documentElement.dataset.awake === 'lock');
      await page.evaluate(() => window.udDropLock());
      await page.waitForFunction(() => window.udLockAsks >= 2, null, { timeout: 5000 });
      await page.evaluate(() => window.udDropLock());
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await page.waitForFunction(() => window.udLockAsks >= 3, null, { timeout: 5000 });
      // A tap while it is held asks no more.
      const before = await page.evaluate(() => window.udLockAsks);
      await page.evaluate(() => document.body.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      await page.waitForTimeout(300);
      assert.equal(await page.evaluate(() => window.udLockAsks), before, 'a tap while the screen is kept on asks nothing more');
      assert.equal(await page.$('#keep-awake'), null, 'no video while the browser keeps the screen on');
      assert.deepEqual(errors.filter(e => /awake|wakeLock/i.test(e)), []);
      results.push('the screen is asked for again after the browser lets it go');
      await ctx.close();
    }

    // A browser with no keep-the-screen-on: the tiny silent video plays over and over.
    {
      const { ctx, page } = await open(browser, 'garage-station.html', { noLock: true });
      await page.waitForFunction(() => document.documentElement.dataset.awake === 'video');
      await page.waitForFunction(() => { const v = document.getElementById('keep-awake'); return v && !v.paused && v.muted && v.loop && v.currentTime > 0.2; }, null, { timeout: 15000 });
      // Big enough that Android keeps the screen on for it (Joe 10/30: a tiny one did not), but unseen and never in the way.
      const box = await page.$eval('#keep-awake', v => { const r = v.getBoundingClientRect(), c = getComputedStyle(v); return { w: r.width, h: r.height, events: c.pointerEvents, opacity: Number(c.opacity), z: c.zIndex }; });
      assert.ok(box.w >= 1280 && box.h >= 800 && box.events === 'none' && box.opacity <= 0.02 && box.z === '-1', 'the video fills the screen behind everything, unseen: ' + JSON.stringify(box));
      // A tap still reaches the screen's own buttons.
      assert.notEqual(await page.evaluate(() => document.elementFromPoint(640, 400).id), 'keep-awake');
      results.push('no keep-the-screen-on in the browser: a silent video plays instead');
      await ctx.close();
    }
    // The Driver Room TV uses its own full-screen video, never a second one.
    {
      const { ctx, page } = await open(browser, 'driver-station.html?tv=1', { noLock: true });
      await page.waitForFunction(() => document.documentElement.dataset.awake === 'video');
      assert.equal(await page.$('#keep-awake'), null, 'the TV plays only its own video');
      results.push('the Driver Room TV keeps its own video');
      await ctx.close();
    }

    // A driver's own phone and a computer opening the Line Tablet from the menus are left alone.
    for (const url of ['route.html', 'line.html', 'daily.html']) {
      const { ctx, page } = await open(browser, url);
      await page.waitForTimeout(1500);
      assert.equal(await page.evaluate(() => [window.udLockAsks, document.documentElement.dataset.awake || '']).then(x => x.join()), '0,', url + ' is left alone');
      results.push(url + ' leaves the screen alone');
      await ctx.close();
    }
    // Joe 10/30 (his Samsung tablet still went dark): any screen on a tablet keeps the screen on; a phone's screens do not.
    for (const url of ['index.html', 'daily.html', 'loadout.html']) {
      const { ctx, page } = await open(browser, url, { touch: [1280, 800] });
      await page.waitForFunction(() => document.documentElement.dataset.awake === 'lock' && window.udLockAsks === 1, null, { timeout: 15000 });
      results.push(url + ' on a tablet keeps the screen on');
      await ctx.close();
    }
    for (const url of ['daily.html', 'route.html']) {
      const { ctx, page } = await open(browser, url, { touch: [390, 844] });
      await page.waitForTimeout(1500);
      assert.equal(await page.evaluate(() => [window.udLockAsks, document.documentElement.dataset.awake || '']).then(x => x.join()), '0,', url + ' on a phone is left alone');
      results.push(url + ' on a phone leaves the screen alone');
      await ctx.close();
    }
    console.log('keep-awake check passed:\n - ' + results.join('\n - '));
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });

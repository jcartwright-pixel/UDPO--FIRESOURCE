'use strict';
/*
 * Browser check (Joe 10/17): on Daily and Weekly Dispatch the day or week picked stays picked when he leaves the screen and comes
 * back (menu link, the tile to the other screen, or the tile back), instead of jumping to today or this week. Each screen keeps
 * its own pick on this computer; the tiles still open the other screen in the same week. Pictures go to SHOTS_DIR.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { clear, db } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const F = require('../fixtures/fake-sheets');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR;
const WHO = 'testEmail=dispatch.test@uniteddairy.com';

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: () => new Date('2026-10-09T12:00:00Z') });
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const [w, h] of [[1536, 864], [1920, 950]]) {
      // One window for the whole check, so what this computer keeps carries from page to page.
      const page = await browser.newPage({ viewport: { width: w, height: h }, serviceWorkers: 'block' });
      await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
        route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
      });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      const dailyDay = async (key) => {
        await page.waitForFunction((k) => document.getElementById('load-day').value === k && location.search.includes('date=' + k), key, { timeout: 10000 });
      };
      const weeklyWeek = async (key) => {
        await page.waitForFunction((k) => document.getElementById('week-date').value === k && location.search.includes('week=' + k), key, { timeout: 10000 });
      };
      const shot = async (name) => { if (SHOTS) { await page.waitForTimeout(400); await page.screenshot({ path: path.join(SHOTS, name + '-' + w + '.png') }); } };

      // Daily: pick Tuesday, then Wednesday with the next-day arrow.
      await page.goto(HOSTING + '/daily.html?date=2026-10-06&' + WHO);
      await dailyDay('2026-10-06');
      await page.click('#next');
      await dailyDay('2026-10-07');
      // The Weekly Dispatch tile opens Weekly Dispatch, the live Current week (the same week here).
      await Promise.all([page.waitForURL(/weekly\.html\?view=live/), page.click('#go-weekly')]);
      await page.waitForFunction(() => document.getElementById('week-date').value === '2026-10-04', null, { timeout: 10000 });
      // The Daily Dispatch tile comes back to Wednesday, the day he picked, not today or the week's Saturday.
      await page.waitForSelector('#go-daily[href*="date=2026-10-07"]');
      await Promise.all([page.waitForURL(/daily\.html\?date=2026-10-07/), page.click('#go-daily')]);
      await dailyDay('2026-10-07');
      await shot('daily-back-from-weekly');

      // Weekly from the menu (no week in the link) with no week kept opens the Live Next week (Joe 10/28). Pick the week before,
      // leave and come back: it is kept; then the next week again, kept the same way.
      await page.goto(HOSTING + '/weekly.html?' + WHO);
      await weeklyWeek('2026-10-11');
      await page.click('#prev');
      await weeklyWeek('2026-10-04');
      await page.goto(HOSTING + '/ops.html?' + WHO);
      await page.goto(HOSTING + '/weekly.html?' + WHO);
      await weeklyWeek('2026-10-04');
      await page.click('#next');
      await weeklyWeek('2026-10-11');
      await page.goto(HOSTING + '/ops.html?' + WHO);
      await page.goto(HOSTING + '/weekly.html?' + WHO);
      await weeklyWeek('2026-10-11');
      await shot('weekly-back');

      // Daily from the menu (no day in the link) still opens the day he last had on Daily.
      await page.goto(HOSTING + '/daily.html?' + WHO);
      await dailyDay('2026-10-07');
      // Weekly's tile in a week that does not hold that day opens that week's own day, and Daily then keeps it.
      await page.goto(HOSTING + '/weekly.html?' + WHO);
      await weeklyWeek('2026-10-11');
      await page.waitForSelector('#go-daily[href*="date=2026-10-1"]');
      const href = await page.$eval('#go-daily', a => a.getAttribute('href'));
      const tileDay = /date=(\d{4}-\d{2}-\d{2})/.exec(href)[1];
      assert.ok(tileDay >= '2026-10-10' && tileDay <= '2026-10-16', 'tile day in the week: ' + tileDay);
      await Promise.all([page.waitForURL(new RegExp('daily\\.html\\?date=' + tileDay)), page.click('#go-daily')]);
      await dailyDay(tileDay);
      await page.goto(HOSTING + '/daily.html?' + WHO);
      await dailyDay(tileDay);

      // Print Layouts' copy of a page (inside a frame) does not change what is kept.
      await page.evaluate(() => new Promise((ok) => {
        const f = document.createElement('iframe');
        f.style.cssText = 'position:fixed;width:900px;height:600px;left:-2000px';
        f.src = 'daily.html?date=2026-10-05&testEmail=dispatch.test@uniteddairy.com';
        f.onload = () => setTimeout(ok, 2500);
        document.body.appendChild(f);
      }));
      await page.goto(HOSTING + '/daily.html?' + WHO);
      await dailyDay(tileDay);
      assert.deepEqual(errors, []);
      await page.close();
    }
    results.push('Daily keeps the day picked and Weekly keeps the week picked after leaving and coming back (menu or tiles); the tiles still open the same week; a print copy does not change them (Joe 10/17)');
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('PASS ' + r));
})().catch(e => { console.error(e); process.exit(1); });

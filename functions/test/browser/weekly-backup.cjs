'use strict';
/*
 * Joe 10/16: on Weekly Dispatch's Driver Assignment Board a driver's day can be set to Backup, beside Available and Off.
 * The day shows BACKUP in its own color (with a legend entry), the run's driver list marks the driver BACKUP, and
 * Available takes it off again. Joe 10/17: Available on his regular day off shows AVAILABLE (app only). Pictures at 1536 and 1920 go to SHOTS_DIR when it is set.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const F = require('../fixtures/fake-sheets');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR || '';

async function openPage(browser, width, height, url) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
  });
  // The board reads Backup days from the Live weeks (last week on), so the page's clock is the fixtures' week, not today.
  await page.clock.setFixedTime(new Date('2026-10-09T12:00:00Z'));
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(HOSTING + url);
  page.errors = errors;
  return page;
}
const cell = (n) => '#board-rows tr[data-driver="drv_test_casey"] td:nth-child(' + n + ')';

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: () => new Date('2026-10-09T12:00:00Z') });
  for (const id of ['run_t801', 'run_t802', 'run_t810']) await db().collection('routes').doc(id).update({ displayDaily: true, displayWeekly: true });
  const browser = await chromium.launch();
  try {
    for (const [w, h] of [[1920, 950], [1536, 730]]) {
      const page = await openPage(browser, w, h, '/weekly.html?week=2026-10-04&testEmail=dispatch.test@uniteddairy.com#board');
      await page.waitForSelector(cell(4) + ' button');
      assert.match(await page.textContent('#legend'), /Backup Driver/);
      // Tuesday is CASEY's regular day off; Backup shows BACKUP in its own color.
      // Joe 10/17: on his regular day off the box opens on Off, as the board shows.
      await page.click(cell(4) + ' button');
      assert.equal(await page.$eval('#avail-reason', s => s.value), 'OFF');
      const choices = await page.$$eval('#avail-reason option', o => o.map(x => x.textContent));
      assert.deepEqual(choices.slice(0, 2), ['Available', 'Backup'], 'Backup right under Available');
      assert.ok(choices.includes('Off'), 'nothing taken away');
      await page.selectOption('#avail-reason', 'BACKUP');
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'after-choices-' + w + '.png') });
      await page.click('#avail-save');
      await page.waitForFunction((sel) => { const td = document.querySelector(sel); return td.textContent === 'BACKUP' && td.classList.contains('b-backup'); }, cell(4), { timeout: 5000 });
      const look = await page.$eval(cell(4), td => { const s = getComputedStyle(td); return { bg: s.backgroundColor, size: parseFloat(s.fontSize) }; });
      assert.equal(look.bg, 'rgb(255, 228, 92)');
      assert.ok(look.size >= 16, 'text at least 16px');
      // Saturday too, then 810's Saturday driver list marks him BACKUP.
      await page.click(cell(8) + ' button');
      await page.selectOption('#avail-reason', 'BACKUP');
      await page.click('#avail-save');
      await page.waitForFunction((sel) => document.querySelector(sel).textContent === 'BACKUP', cell(8), { timeout: 5000 });
      await page.evaluate(() => document.getElementById('board-panel').scrollIntoView());
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'after-board-' + w + '.png') });
      // Stays after a reload (saved on the server), and the box opens on Backup.
      await page.reload();
      await page.waitForFunction((sel) => { const td = document.querySelector(sel); return td && td.textContent === 'BACKUP'; }, cell(4), { timeout: 8000 });
      await page.click(cell(4) + ' button');
      assert.equal(await page.$eval('#avail-reason', s => s.value), 'BACKUP');
      await page.selectOption('#avail-reason', 'AVAILABLE');
      await page.click('#avail-save');
      // Joe 10/17: Available takes Backup off and, on his regular day off, the board reads AVAILABLE (it used to stay OFF).
      await page.waitForFunction((sel) => document.querySelector(sel).textContent === 'AVAILABLE', cell(4), { timeout: 5000 });
      let saved = '';
      for (let i = 0; i < 50 && saved !== 'drv_test_casey__2026-10-06:AVAILABLE,drv_test_casey__2026-10-10:'; i++) {
        await page.waitForTimeout(200);
        saved = (await db().collection('driverBackups').get()).docs.map(d => d.id + ':' + (d.data().kind || '')).join();
      }
      assert.equal(saved, 'drv_test_casey__2026-10-06:AVAILABLE,drv_test_casey__2026-10-10:', 'Tuesday Available (app only), Saturday still Backup');
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'after-available-' + w + '.png') });
      // Stays after a reload, and the box opens on Available.
      await page.reload();
      await page.waitForFunction((sel) => { const td = document.querySelector(sel); return td && td.textContent === 'AVAILABLE'; }, cell(4), { timeout: 8000 });
      await page.click(cell(4) + ' button');
      assert.equal(await page.$eval('#avail-reason', s => s.value), 'AVAILABLE');
      await page.click('[data-close]');
      await db().collection('driverBackups').doc('drv_test_casey__2026-10-06').delete();
      await db().collection('driverBackups').doc('drv_test_casey__2026-10-10').delete();
      await page.waitForFunction((sel) => document.querySelector(sel).textContent === 'OFF', cell(4), { timeout: 5000 });
      assert.deepEqual(page.errors, []);
      await page.close();
    }
    // The run's driver list (Override shows everyone) marks a Backup driver.
    await db().collection('driverBackups').doc('drv_test_casey__2026-10-10').set({ driverId: 'drv_test_casey', date: '2026-10-10' });
    const page = await openPage(browser, 1920, 950, '/weekly.html?week=2026-10-04&testEmail=dispatch.test@uniteddairy.com');
    await page.waitForSelector('#rows td.day.editable[data-day="sat"]');
    await page.click('xpath=//tbody[@id="rows"]/tr[td[1][text()="810"]]/td[@data-day="sat"]');
    await page.waitForSelector('.popover select[data-kind="driver"]');
    const names = await page.$$eval('.popover select[data-kind="driver"] option', o => o.map(x => x.textContent));
    assert.ok(names.includes('CASEY, LEE — BACKUP'), names.join(' | '));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'after-driver-list-1920.png') });
    assert.deepEqual(page.errors, []);
    console.log('weekly-backup: OK');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });

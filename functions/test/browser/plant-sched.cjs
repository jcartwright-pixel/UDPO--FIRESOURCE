'use strict';
/*
 * Browser check of the Plant Operations Scheduler against the local test database (npm run test:browser), on the made-up
 * plant week (test/fixtures/plant-demo.js): Month, Week and Day views (Sunday first), Shipping and Receiving. A manager adds,
 * edits and deletes a load and adds a supplier; a second open screen follows each change without reloading.
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

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR || '';
const DATE = PD.PLANT_DATE;
const MANAGER = '&testEmail=manager.test@uniteddairy.com';

async function openPage(browser, width, height, url) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: SHOTS && width === 1920 ? 2 : 1 });
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    const file = route.request().url().split('/').pop();
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, file)) });
  });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(HOSTING + url);
  page.errors = errors;
  return page;
}
async function fits(page, what) {
  const size = await page.evaluate(() => ({ scroll: document.scrollingElement.scrollHeight, inner: window.innerHeight, width: document.scrollingElement.scrollWidth, innerWidth: window.innerWidth }));
  assert.ok(size.scroll <= size.inner && size.width <= size.innerWidth, what + ' fits with no page scrolling: ' + JSON.stringify(size));
}
async function shots(page, name, w) {
  if (!SHOTS) return;
  await page.screenshot({ path: path.join(SHOTS, name + '-' + w + '.png'), scale: 'css' });
  if (w === 1920) await page.screenshot({ path: path.join(SHOTS, name + '-top-2x.png'), clip: { x: 0, y: 0, width: 1920, height: 475 }, scale: 'device' });
}

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date('2026-10-08T14:00:00Z') });
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const [w, h] of [[1920, 950], [1366, 650]]) {
      // Month: October 2026 starts on Thursday; Sunday is the first column.
      const page = await openPage(browser, w, h, '/scheduler.html?view=month&date=' + DATE + MANAGER);
      await page.waitForFunction(() => /3 loads/.test((document.querySelector('[data-day="2026-10-08"]') || {}).textContent || ''));
      assert.equal(await page.textContent('.sc-wd'), 'SUN');
      assert.equal(await page.getAttribute('.sc-day', 'data-day'), '2026-09-27');
      assert.match(await page.textContent('#range'), /October 2026/);
      assert.match(await page.textContent('#hstats'), /6Loads4Days booked0Holidays/);
      await fits(page, 'Scheduler month ' + w + 'x' + h);
      await shots(page, 'sched-month', w);
      // Week: the customers list and Sunday to Saturday.
      await page.click('[data-view="week"]');
      await page.waitForSelector('.sc-weekgrid');
      assert.deepEqual(await page.$$eval('.sc-count span', s => s.map(x => x.textContent)), ['SUN 10/4', 'MON 10/5', 'TUE 10/6', 'WED 10/7', 'THU 10/8', 'FRI 10/9', 'SAT 10/10']);
      assert.deepEqual(await page.$$eval('.sc-who strong', s => s.map(x => x.textContent)), ['Sun Valley', 'Garber Farms', 'Aldi Charleston', 'Fairmont', 'Walmart DC']);
      await fits(page, 'Scheduler week ' + w + 'x' + h);
      await shots(page, 'sched-week', w);
      // Day.
      await page.click('[data-view="day"]');
      await page.waitForSelector('table.sc-table');
      // Leaving a week that holds today shows today (as the current app); pick Thursday.
      await page.fill('#pick', DATE);
      await page.dispatchEvent('#pick', 'change');
      await page.waitForFunction(() => /Thursday, October 8/.test(document.getElementById('range').textContent));
      assert.deepEqual(await page.$$eval('table.sc-table tbody tr td:nth-child(3)', t => t.map(x => x.textContent)), ['6:30 AM', '7:00 AM', '1:00 PM']);
      await fits(page, 'Scheduler day ' + w + 'x' + h);
      await shots(page, 'sched-day', w);
      // Receiving: the same screen with the suppliers.
      await page.click('[data-lane="RECEIVING"]');
      await page.waitForFunction(() => /Valley Farms/.test(document.getElementById('body').textContent));
      await page.click('[data-view="week"]');
      await page.waitForFunction(() => document.querySelectorAll('.sc-who').length === 6);
      await fits(page, 'Scheduler receiving ' + w + 'x' + h);
      await shots(page, 'sched-receiving', w);
      assert.deepEqual(page.errors, []);
      await page.close();
    }

    // Two open screens: one adds, edits and deletes; the other follows.
    const watcher = await openPage(browser, 1920, 950, '/scheduler.html?view=week&date=' + DATE + MANAGER);
    const desk = await openPage(browser, 1920, 950, '/scheduler.html?view=week&date=' + DATE + MANAGER);
    await watcher.waitForSelector('.sc-load');
    await desk.waitForSelector('.sc-load');
    // Add a Garber load on Saturday from the customer's ＋ (the dialog picks Garber).
    await desk.click('.sc-weekgrid > .sc-col:last-child .sc-add');
    await desk.waitForSelector('#f-route');
    await desk.selectOption('#f-route', { label: '892 · GARBER · Garber Farms' });
    await desk.click('#f-save');
    assert.match(await desk.textContent('#f-error'), /pickup time/, 'the box says what is missing');
    await desk.fill('#f-time', '05:45');
    await desk.fill('#f-trailer', '961');
    await desk.fill('#f-cases', '300');
    if (SHOTS) await desk.screenshot({ path: path.join(SHOTS, 'sched-add-1920.png'), scale: 'css' });
    const t0 = Date.now();
    await desk.click('#f-save');
    await desk.waitForFunction(() => /Garber Farms/.test(document.querySelector('.sc-weekgrid > .sc-col:last-child').textContent));
    const shown = Date.now() - t0;
    await watcher.waitForFunction(() => /Garber Farms[\s\S]*5:45 AM · T-961/.test(document.querySelector('.sc-weekgrid > .sc-col:last-child').textContent), null, { timeout: 8000 });
    results.push('Add Load (Garber, Saturday 5:45 AM, trailer 961): on screen in ' + shown + ' ms, on the other screen in ' + (Date.now() - t0) + ' ms as T-961');
    // Edit Sun Valley: carrier needs a PO; change the time.
    await desk.click('.sc-load.car');
    await desk.fill('#f-po', '');
    await desk.click('#f-save');
    assert.match(await desk.textContent('#f-error'), /PO number/);
    await desk.fill('#f-po', '4471-B');
    await desk.fill('#f-time', '14:30');
    await desk.click('#f-save');
    await watcher.waitForFunction(() => /2:30 PM · PO 4471-B/.test(document.getElementById('body').textContent), null, { timeout: 8000 });
    results.push('Edit Load (Sun Valley carrier): blank PO refused in the box; 2:30 PM and PO 4471-B on the other screen');
    // Delete the Walmart Tuesday load after the confirm box.
    await desk.click('.sc-weekgrid > .sc-col:nth-child(10) .sc-load');
    await desk.click('#f-delete');
    assert.match(await desk.textContent('#modal'), /Delete this load\?[\s\S]*Walmart DC/);
    await desk.click('#yes-delete');
    await watcher.waitForFunction(() => /No loads/.test(document.querySelector('.sc-weekgrid > .sc-col:nth-child(10)').textContent), null, { timeout: 8000 });
    results.push('Delete Load (Walmart, Tuesday) after "Delete this load?": gone from the other screen');
    // Receiving: New Supplier.
    await desk.click('[data-lane="RECEIVING"]');
    await watcher.click('[data-lane="RECEIVING"]');
    await desk.click('#supplier-add');
    await desk.fill('#s-name', 'Ohio Valley Fruit');
    await desk.fill('#s-label', 'Ohio Fruit');
    await desk.click('#s-save');
    await watcher.waitForFunction(() => /Ohio Fruit[\s\S]*S07 · OHIO VALLEY FRUIT/.test(document.querySelector('.sc-wholist').textContent), null, { timeout: 8000 });
    results.push('New Supplier (Ohio Valley Fruit): on the other screen as S07');
    // Month view of the day: the day box lists the loads.
    await desk.click('[data-lane="SHIPPING"]');
    await desk.click('[data-view="month"]');
    await desk.click('[data-day="2026-10-08"]');
    await desk.waitForSelector('.sc-dayrow');
    if (SHOTS) await desk.screenshot({ path: path.join(SHOTS, 'sched-daybox-1920.png'), scale: 'css' });
    assert.equal(await desk.$$eval('.sc-dayrow', r => r.length), 3);
    assert.deepEqual(desk.errors, []);
    assert.deepEqual(watcher.errors, []);
    const log = await db().collection('actions').where('action', '==', 'savePlantSchedule').get();
    assert.equal(log.size, 4, 'each change is one save in the save log');
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('SCHED ' + r));
})().catch(e => { console.error(e); process.exit(1); });

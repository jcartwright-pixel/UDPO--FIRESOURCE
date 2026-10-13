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
const NOW = '2026-10-08T14:00:00Z';

async function openPage(browser, width, height, url) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: SHOTS && width === 1920 ? 2 : 1 });
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    const file = route.request().url().split('/').pop();
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, file)) });
  });
  // The screen's clock reads the same day as the made-up plant week, so "today" does not move with the real date
  // (leaving the month that holds today for Week shows today's week).
  await page.clock.setFixedTime(new Date(NOW));
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
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date(NOW) });
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const [w, h] of [[1920, 950], [1536, 760], [1366, 650]]) {
      // Month: October 2026 starts on Thursday; Sunday is the first column.
      const page = await openPage(browser, w, h, '/scheduler.html?view=month&date=' + DATE + MANAGER);
      await page.waitForFunction(() => /3 loads/.test((document.querySelector('[data-day="2026-10-08"]') || {}).textContent || ''));
      assert.equal(await page.textContent('.sc-wd'), 'SUN');
      assert.equal(await page.getAttribute('.sc-day', 'data-day'), '2026-09-27');
      // Review item 60 (Joe 10/13): the month reads Oct 26.
      assert.equal(await page.textContent('#range'), 'Oct 26');
      assert.match(await page.textContent('#hstats'), /6Loads4Days booked0Holidays/);
      // Joe 10/12: a legend at the top, and each load colored by who delivers it (Uniontown truck, Branch, Carrier).
      assert.deepEqual(await page.$$eval('#legend .sc-by', s => s.map(x => x.textContent)), ['Uniontown truck', 'Branch', 'Carrier']);
      const by = (sel) => page.$$eval(sel, els => els.map(e => (e.className.match(/by-(\w+)/) || [])[1] + ':' + e.textContent.split(' · ')[0].trim()));
      assert.deepEqual(await by('[data-day="2026-10-08"] small[class*="by-"]'), ['ut:Walmart DC', 'ut:Garber Farms', 'carrier:Sun Valley'], 'our own runs blue, the carrier load purple');
      assert.deepEqual(await by('[data-day="2026-10-09"] small[class*="by-"]'), ['branch:Aldi Charleston'], 'a branch run (Route Master coverage BRANCH) green');
      assert.ok(await page.$eval('.sc-by', e => parseFloat(getComputedStyle(e).fontSize) >= 16), 'the legend reads at 16px or more');
      await fits(page, 'Scheduler month ' + w + 'x' + h);
      if (w === 1920) {
        // Print Monthly carries the same legend and colors.
        await page.click('#print');
        await page.waitForFunction(() => { const f = document.getElementById('print-frame'); return f && f.contentDocument && f.contentDocument.querySelector('.legend'); });
        const printed = await page.evaluate(() => { const d = document.getElementById('print-frame').contentDocument; return { legend: d.querySelector('.legend').textContent, by: [...d.querySelectorAll('small[class^="by-"]')].map(x => x.className + ':' + x.textContent.split(' · ')[0]), html: d.documentElement.outerHTML }; });
        assert.equal(printed.legend, 'Uniontown truckBranchCarrier');
        assert.deepEqual(printed.by.sort(), ['by-branch:Aldi Charleston', 'by-carrier:Sun Valley', 'by-ut:Garber Farms', 'by-ut:Garber Farms', 'by-ut:Walmart DC', 'by-ut:Walmart DC'], 'Print Monthly colors each load by who delivers it');
        if (SHOTS) { const pp = await browser.newPage({ viewport: { width: 1056, height: 816 } }); await pp.setContent(printed.html); await pp.emulateMedia({ media: 'print' }); await pp.screenshot({ path: path.join(SHOTS, 'sched-print-monthly.png') }); await pp.close(); }
      }
      await shots(page, 'sched-month', w);
      // Week: the customers list and Sunday to Saturday.
      await page.click('[data-view="week"]');
      await page.waitForSelector('.sc-weekgrid');
      assert.deepEqual(await page.$$eval('.sc-count span', s => s.map(x => x.textContent)), ['SUN 10-4', 'MON 10-5', 'TUE 10-6', 'WED 10-7', 'THU 10-8', 'FRI 10-9', 'SAT 10-10']);
      assert.deepEqual(await page.$$eval('.sc-who strong', s => s.map(x => x.textContent)), ['Sun Valley', 'Garber Farms', 'Aldi Charleston', 'Fairmont', 'Walmart DC']);
      assert.deepEqual([...new Set(await page.$$eval('.sc-load', els => els.map(e => (e.className.match(/by-(\w+)/) || [])[1])))].sort(), ['branch', 'carrier', 'ut'], 'the week colors each load by who delivers it');
      await fits(page, 'Scheduler week ' + w + 'x' + h);
      await shots(page, 'sched-week', w);
      // Day.
      await page.click('[data-view="day"]');
      await page.waitForSelector('table.sc-table');
      // Leaving a week that holds today shows today (as the current app); step to Thursday with the arrows (review item 37,
      // Joe 10/13: no date box, the arrows move the dates).
      assert.equal(await page.$('#pick'), null, 'no date box on the Scheduler');
      const dayShown = () => page.evaluate(() => { const m = /(\d+)-(\d+)-(\d+)\s*$/.exec(document.getElementById('range').textContent.trim()); return m ? '20' + m[3] + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0') : ''; });
      for (let i = 0; i < 400 && (await dayShown()) !== DATE; i++) { const before = await page.textContent('#range'); await page.click((await dayShown()) < DATE ? '#next' : '#prev'); await page.waitForFunction((b) => document.getElementById('range').textContent !== b, before); }
      await page.waitForFunction(() => /Thursday 10-8-26/.test(document.getElementById('range').textContent));
      assert.deepEqual(await page.$$eval('table.sc-table tbody tr td:nth-child(3)', t => t.map(x => x.textContent)), ['6:30 AM', '7:00 AM', '1:00 PM']);
      assert.deepEqual(await page.$$eval('table.sc-table tbody tr', t => t.map(x => x.className)), ['by-ut', 'by-ut', 'by-carrier'], 'the day colors each load by who delivers it');
      await fits(page, 'Scheduler day ' + w + 'x' + h);
      await shots(page, 'sched-day', w);
      // Receiving: the same screen with the suppliers.
      await page.click('[data-lane="RECEIVING"]');
      // Joe 10/13: no sample suppliers; a load booked with one still shows its name.
      await page.waitForFunction(() => /Valley Farms Milk Co-op/.test(document.getElementById('body').textContent));
      await page.click('[data-view="week"]');
      await page.waitForFunction(() => document.querySelectorAll('.sc-who').length === 1);
      assert.deepEqual([...new Set(await page.$$eval('.sc-load', els => els.map(e => (e.className.match(/by-(\w+)/) || [])[1])))].sort(), ['carrier', 'ut'], 'Receiving: the carrier load purple, our own truck blue');
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
    await watcher.waitForFunction(() => /Ohio Fruit[\s\S]*S02 · OHIO VALLEY FRUIT/.test(document.querySelector('.sc-wholist').textContent), null, { timeout: 8000 });
    results.push('New Supplier (Ohio Valley Fruit): on the other screen as S02');
    // Joe 10/13: the Suppliers button lists them; Edit renames one, Remove takes one off (after "Remove this supplier?").
    await desk.setViewportSize({ width: 1536, height: 864 });
    await desk.click('#suppliers');
    await desk.waitForFunction(() => document.querySelectorAll('.sc-suptable tbody tr').length === 2 && !/Saving/.test(document.querySelector('.sc-suptable').textContent));
    assert.deepEqual(await desk.$$eval('.sc-suptable tbody tr', r => r.map(x => x.cells[1].textContent)), ['MOUNTAIN STATE SUGAR', 'OHIO VALLEY FRUIT']);
    assert.ok(await desk.$eval('.sc-suptable td', e => parseFloat(getComputedStyle(e).fontSize) >= 16), 'the list text is at least 16px');
    if (SHOTS) await desk.screenshot({ path: path.join(SHOTS, 'suppliers-list-1536.png'), scale: 'css' });
    for (const w of [390, 800]) {
      await desk.setViewportSize({ width: w, height: 844 });
      assert.ok(await desk.$eval('#modal', m => m.getBoundingClientRect().right <= innerWidth + 1), 'the Suppliers box fits at ' + w);
      if (SHOTS) await desk.screenshot({ path: path.join(SHOTS, 'suppliers-list-' + w + '.png'), scale: 'css' });
    }
    await desk.setViewportSize({ width: 1536, height: 864 });
    await desk.click('.sc-suptable tbody tr:nth-child(1) [data-supplier]');
    assert.equal(await desk.inputValue('#s-name'), 'MOUNTAIN STATE SUGAR');
    await desk.fill('#s-name', 'Dean Foods Milk');
    await desk.fill('#s-label', 'Dean');
    if (SHOTS) await desk.screenshot({ path: path.join(SHOTS, 'suppliers-edit-1536.png'), scale: 'css' });
    await desk.click('#s-save');
    await desk.waitForFunction(() => /DEAN FOODS MILK/.test((document.querySelector('.sc-suptable') || {}).textContent || ''), null, { timeout: 8000 });
    await watcher.waitForFunction(() => /Dean[\s\S]*S06 · DEAN FOODS MILK/.test(document.querySelector('.sc-wholist').textContent), null, { timeout: 8000 });
    results.push('Edit Supplier (Mountain State Sugar to Dean Foods Milk): on the other screen');
    await desk.click('.sc-suptable tbody tr:nth-child(2) [data-supplier]');
    await desk.click('#s-remove');
    assert.match(await desk.textContent('#modal'), /Remove this supplier\?[\s\S]*OHIO VALLEY FRUIT/);
    if (SHOTS) await desk.screenshot({ path: path.join(SHOTS, 'suppliers-remove-1536.png'), scale: 'css' });
    await desk.click('#s-go');
    await desk.waitForFunction(() => document.querySelectorAll('.sc-suptable tbody tr').length === 1, null, { timeout: 8000 });
    await watcher.waitForFunction(() => !/OHIO VALLEY FRUIT/.test(document.querySelector('.sc-wholist').textContent), null, { timeout: 8000 });
    results.push('Remove Supplier (Ohio Valley Fruit) after "Remove this supplier?": gone from the other screen');
    await desk.click('#modal [data-close]');
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
    assert.equal(log.size, 6, 'each change is one save in the save log');
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('SCHED ' + r));
})().catch(e => { console.error(e); process.exit(1); });

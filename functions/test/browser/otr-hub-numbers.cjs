'use strict';
/*
 * Joe 11-6-26: Over the Road reads gallons sold and the three costs from the Hub's Accounting Numbers (accountingMonthly),
 * read once there for every app. On Recap those boxes are gray for a month the Hub has; this screen's own numbers (miles,
 * or a month the Hub does not have) stay as they were. Made-up numbers. Pictures go to SHOTS_DIR.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR || '';

(async () => {
  await clear();
  const d = db();
  const { runTransfer } = require('../../src/transfer');
  const F = require('../fixtures/fake-sheets');
  const PD = require('../fixtures/plant-demo');
  await runTransfer({ db: d, reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date('2026-10-08T14:00:00Z') });
  await d.collection('otrMonthly').doc('2026-09').set({ year: 2026, month: 9, miles: 1234, gallons_sold: 999, source: 'IMPORT' });
  await d.collection('otrMonthly').doc('2026-07').set({ year: 2026, month: 7, gallons_sold: 1500000, source: 'TYPED' });
  await d.collection('accountingMonthly').doc('2026-09').set({ year: 2026, month: 9, gallons_sold: 2100000, distribution_cost: 600000, employee_cost: 325000, fuel_cost: 96000, file: 'made-up.zip', source: 'BY HAND' });
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  try {
    for (const [w, h] of [[1536, 790], [1920, 1080]]) {
      const page = await browser.newPage({ viewport: { width: w, height: h } });
      await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) }));
      await page.clock.install({ time: new Date('2026-11-06T15:00:00Z') });
      await page.clock.resume();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(HOSTING + '/otr.html?testEmail=manager.test@uniteddairy.com');
      await page.click('[data-view="figures"]');
      const box = (m, k) => '.otr-in[data-m="' + m + '"][data-k="' + k + '"]';
      await page.waitForFunction((sel) => { const i = document.querySelector(sel); return i && i.value === '2,100,000'; }, box(9, 'gallons_sold'));
      assert.ok(await page.isDisabled(box(9, 'gallons_sold')), 'a number from the Hub is not typed here');
      assert.equal(await page.getAttribute(box(9, 'gallons_sold'), 'title'), 'From the Hub\'s Accounting Numbers');
      assert.match(await page.inputValue(box(9, 'distribution_cost')), /600,000/);
      assert.equal(await page.inputValue(box(9, 'miles')), '1,234', 'this screen\'s own miles stay');
      assert.ok(!(await page.isDisabled(box(9, 'miles'))), 'and can still be typed');
      assert.equal(await page.inputValue(box(7, 'gallons_sold')), '1,500,000', 'a month the Hub does not have keeps its own number');
      assert.ok(!(await page.isDisabled(box(7, 'gallons_sold'))));
      assert.match(await page.textContent('body'), /Hub's Accounting Numbers/);
      assert.deepEqual(errors, []);
      if (SHOTS) { await page.waitForTimeout(800); await page.locator('.otr-fig').scrollIntoViewIfNeeded(); }
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'otr-recap-hub-' + w + '.png') });
      await page.close();
    }
    console.log('Over the Road reads the Hub\'s Accounting Numbers');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });

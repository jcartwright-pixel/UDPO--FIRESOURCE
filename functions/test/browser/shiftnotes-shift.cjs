'use strict';
/*
 * Browser check (npm run test:browser): Shift Notes' Shift drop-down (Joe 10/11, review item 43) lists the plant's own shifts
 * (Administration > Plant Setup > Plant Shifts), starts on the shift now, and a shift picked by hand is saved with the entry.
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

async function openPage(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 950 }, deviceScaleFactor: SHOTS ? 2 : 1 });
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
const hourNow = () => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date() });
  // Two made-up shifts that cover the whole day, so the test does not depend on the time it runs.
  await db().collection('plantShifts').doc('fac_uniontown').set({ facilityId: 'fac_uniontown', shifts: [{ name: 'Day Crew', start: '00:00', end: '12:00' }, { name: 'Night Crew', start: '12:00', end: '00:00' }] });
  const browser = await chromium.launch();
  const results = [];
  try {
    const page = await openPage(browser, '/shiftnotes.html?testEmail=viewer.test@uniteddairy.com');
    const now = hourNow() < 12 ? 'DAY CREW' : 'NIGHT CREW', other = now === 'DAY CREW' ? 'NIGHT CREW' : 'DAY CREW';
    await page.waitForFunction(() => document.querySelectorAll('#shift-now option').length === 2);
    assert.deepEqual(await page.$$eval('#shift-now option', o => o.map(x => x.textContent)), ['Day crew', 'Night crew'], 'the plant\'s own shifts');
    assert.equal(await page.inputValue('#shift-now'), now, 'starts on the shift now');
    results.push('The drop-down lists the plant\'s shifts and starts on ' + now);
    await page.selectOption('#shift-now', other);
    await page.fill('.sn-entry', 'Filler 3 jammed twice');
    await page.press('.sn-entry', 'Tab');
    await page.waitForSelector('#another:not([hidden])', { timeout: 8000 });
    if (SHOTS) {
      await page.screenshot({ path: path.join(SHOTS, 'shiftnotes-shift-1920.png'), scale: 'css' });
      await page.screenshot({ path: path.join(SHOTS, 'shiftnotes-shift-top-2x.png'), clip: { x: 0, y: 0, width: 1920, height: 475 }, scale: 'device' });
    }
    const saved = (await db().collection('plantJournal').where('type', '==', 'SHIFT_REPORT').get()).docs.map(d => d.data()).filter(d => d.createdInApp);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].payload.shift, other, 'the shift picked by hand is saved');
    results.push('Picked ' + other + ' by hand: the entry was saved with it');
    await page.click('#another');
    assert.equal(await page.inputValue('#shift-now'), now, 'the next entry starts on the shift now again');
    assert.deepEqual(page.errors, []);
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('SHIFT ' + r));
})().catch(e => { console.error(e); process.exit(1); });

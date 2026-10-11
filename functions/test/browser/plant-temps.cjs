'use strict';
/*
 * Browser check of Plant Temperatures & Coolers on the made-up plant: the two cooler locations with the current app's columns,
 * a manual reading that is HIGH by the limits and locks the location (on another open screen too), the Alerts filter, the
 * 24-hour history and the phone's short table. One reading from earlier in the day is seeded with the real clock. Pictures go to SHOTS_DIR.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const F = require('../fixtures/fake-sheets');
const PD = require('../fixtures/plant-demo');
const L = require('../../src/logic');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR || '';
const MANAGER = '?testEmail=manager.test@uniteddairy.com';

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
  const at = new Date(Date.now() - 3 * 3600000).toISOString();
  await db().collection('plantJournal').doc('PLANT_TEMPERATURE_CHECK_app_seed1').set({ recordId: 'TEMP-seed1', type: 'PLANT_TEMPERATURE_CHECK', date: L.operatingDay(new Date()), status: 'RECORDED', recordedAt: at,
    recordedBy: 'supervisor.test@uniteddairy.com', createdInApp: true, payload: { locationId: 'ut_temp_cooler_middle', location: 'Cooler Middle', manualTemperature: 37, notes: 'Normal', status: 'RECORDED' } });
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const [w, h] of [[1920, 950], [1366, 650]]) {
      const page = await openPage(browser, w, h, '/temps.html' + MANAGER);
      await page.waitForFunction(() => document.querySelectorAll('#rows [data-location]').length === 2);
      assert.deepEqual(await page.$$eval('#pane-current th', t => t.map(x => x.textContent)), ['Sensor Name', 'Current Temp', 'Manual Read', 'Trend', 'Status', 'Battery', 'Last Reading', 'Notes', 'Last Checked', 'By', 'Action']);
      assert.deepEqual(await page.$$eval('#rows .tp-name b', t => t.map(x => x.textContent)), ['Cooler North', 'Cooler Middle']);
      assert.match(await page.textContent('[data-location="ut_temp_cooler_middle"]'), /MANUAL ONLY[\s\S]*37°F/);
      await fits(page, 'Temperatures ' + w + 'x' + h);
      await shots(page, 'temps-current', w);
      await page.click('[data-pane="history"]');
      await page.waitForSelector('#pane-history:not([hidden])');
      await fits(page, 'Temperatures history ' + w + 'x' + h);
      assert.deepEqual(page.errors, []);
      await page.close();
    }
    const watcher = await openPage(browser, 1920, 950, '/temps.html' + MANAGER);
    const desk = await openPage(browser, 1920, 950, '/temps.html' + MANAGER);
    await watcher.waitForFunction(() => document.querySelectorAll('#rows [data-location]').length === 2);
    await desk.waitForFunction(() => document.querySelectorAll('#rows [data-location]').length === 2);
    const row = '[data-location="ut_temp_cooler_north"]';
    // Joe 10/10: no Save button; each box saves as it is left. Notes alone do not make a reading.
    assert.equal(await desk.$('[data-save]'), null, 'Temperatures has no Save button');
    await desk.fill(row + ' .tp-notes', 'Door left open');
    await desk.press(row + ' .tp-notes', 'Tab');
    await desk.waitForFunction((r) => /Enter the temperature to save/.test(document.querySelector(r + ' .tp-act').textContent), row);
    await desk.fill(row + ' .tp-manual', '44.5');
    const t0 = Date.now();
    await desk.press(row + ' .tp-manual', 'Tab');
    await desk.waitForFunction((r) => /Saved \d[\s\S]*HIGH/.test(document.querySelector(r + ' .tp-act').textContent), row);
    const shown = Date.now() - t0;
    await watcher.waitForFunction((r) => { const x = document.querySelector(r); return x && /Last manual 44\.5°F HIGH/.test(x.textContent); }, row, { timeout: 8000 });
    results.push('Cooler North 44.5°F saved on leaving the box: HIGH on screen in ' + shown + ' ms, on the other screen in ' + (Date.now() - t0) + ' ms');
    await watcher.click('[data-filter="ALERTS"]');
    await watcher.waitForFunction(() => document.querySelectorAll('#rows [data-location]').length === 1);
    assert.match(await watcher.textContent('[data-filter="ALERTS"]'), /Alerts \(1\)/);
    if (SHOTS) await watcher.screenshot({ path: path.join(SHOTS, 'temps-alerts-1920.png'), scale: 'css' });
    await watcher.click('[data-filter="ALL"]');
    await desk.click('[data-pane="history"]');
    await desk.waitForFunction(() => document.querySelectorAll('#history tr:not(:has(td.empty))').length === 2);
    assert.match(await desk.textContent('#history tr'), /Cooler North[\s\S]*44\.5[\s\S]*HIGH[\s\S]*Door left open/);
    if (SHOTS) await desk.screenshot({ path: path.join(SHOTS, 'temps-history-after-1920.png'), scale: 'css' });
    const phone = await openPage(browser, 412, 860, '/temps.html' + MANAGER);
    await phone.waitForFunction(() => document.querySelectorAll('#rows [data-location]').length === 2);
    assert.deepEqual(await phone.$$eval('#pane-current th', t => t.filter(x => getComputedStyle(x).display !== 'none').map(x => x.textContent)), ['Sensor Name', 'Manual Read', 'Notes', 'Action']);
    await fits(phone, 'Temperatures phone');
    if (SHOTS) await phone.screenshot({ path: path.join(SHOTS, 'temps-phone-412.png'), scale: 'css' });
    for (const p of [desk, watcher, phone]) assert.deepEqual(p.errors, []);
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('TEMPS ' + r));
})().catch(e => { console.error(e); process.exit(1); });

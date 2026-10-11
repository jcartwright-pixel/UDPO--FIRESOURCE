'use strict';
/*
 * Browser check of Administration > MOCREO & Sensors (Joe 10/10): an administrator pastes the MOCREO key (the box empties and
 * only the last 4 characters show), the thermometers list adds, renames and turns off a cooler and links it to a sensor, and
 * Cooler Temperatures follows with the sensor's reading. MOCREO itself is not called here: the sensors are put in the test
 * database as the sync leaves them. Pictures go to SHOTS_DIR.
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
const KEY = 'mok_browser_test_key_7731';

async function openPage(browser, width, height, url) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: SHOTS && width === 1920 ? 2 : 1 });
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
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
async function shots(page, name) {
  if (!SHOTS) return;
  await page.screenshot({ path: path.join(SHOTS, name + '-1920.png'), scale: 'css' });
  await page.screenshot({ path: path.join(SHOTS, name + '-top-2x.png'), clip: { x: 0, y: 0, width: 1920, height: 475 }, scale: 'device' });
}
const row = (name) => '#rows tr:has(input[data-k="location"][value="' + name + '"])';

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date('2026-10-08T14:00:00Z') });
  const now = new Date().toISOString();
  await db().collection('sensors').doc('S1').set({ sensorId: 'S1', name: 'Walk-in sensor A', temperatureF: 36.4, batteryLevel: 90, online: true, returned: true, lastReadingAt: now, lastSyncAt: now });
  await db().collection('sensors').doc('S2').set({ sensorId: 'S2', name: 'Dock freezer sensor', temperatureF: 2.1, batteryLevel: 77, online: true, returned: true, lastReadingAt: now, lastSyncAt: now });
  const browser = await chromium.launch();
  const results = [];
  try {
    const no = await openPage(browser, 1920, 1080, '/mocreo.html?testEmail=manager.test@uniteddairy.com');
    await no.waitForFunction(() => /Only an administrator/.test(document.getElementById('error').textContent));
    results.push('A manager is told only an administrator may change it');

    const page = await openPage(browser, 1920, 1080, '/mocreo.html?testEmail=admin.test@uniteddairy.com');
    await page.waitForFunction(() => document.getElementById('state').textContent === 'No key');
    await page.fill('#f-key', KEY);
    await page.fill('#f-asset', 'asset-55501');
    await page.click('#save');
    await page.waitForFunction(() => /Key set · ends 7731/.test(document.getElementById('state').textContent));
    assert.deepEqual([await page.inputValue('#f-key'), await page.inputValue('#f-asset')], ['', ''], 'the boxes empty after saving');
    assert.ok(!(await page.content()).includes(KEY), 'the key is never on the page');
    const saved = (await db().collection('private').doc('mocreo').get()).data();
    assert.deepEqual([saved.apiKey, saved.assetId], [KEY, 'asset-55501']);
    results.push('Replace Key: saved on the server; the page shows "Key set · ends 7731" and never the key');

    // The thermometers: the two coolers from the sheet, then a new freezer.
    await page.waitForSelector(row('Cooler North'));
    await page.selectOption(row('Cooler North') + ' select[data-k="sensorId"]', 'S1');
    await page.waitForFunction(() => /saved/.test(document.getElementById('foot').textContent));
    await page.click('#add');
    await page.fill('#rows tr:first-child input[data-k="location"]', 'Freezer 2');
    await page.press('#rows tr:first-child input[data-k="location"]', 'Tab');
    await page.waitForSelector(row('Freezer 2'), { timeout: 8000 });
    await page.fill(row('Freezer 2') + ' input[data-k="area"]', 'Dock freezer');
    await page.press(row('Freezer 2') + ' input[data-k="area"]', 'Tab');
    await page.selectOption(row('Freezer 2') + ' select[data-k="sensorId"]', 'S2');
    await page.fill(row('Freezer 2') + ' input[data-k="highLimit"]', '0');
    await page.press(row('Freezer 2') + ' input[data-k="highLimit"]', 'Tab');
    await page.uncheck(row('Cooler Middle') + ' input[data-k="active"]');
    await page.waitForFunction(() => /Cooler Middle saved/.test(document.getElementById('foot').textContent), null, { timeout: 8000 });
    await page.click('.head h1');
    await page.waitForFunction(() => /2\.1°F/.test(document.querySelector('#rows').textContent) && /36\.4°F/.test(document.querySelector('#rows').textContent));
    assert.equal(await page.inputValue(row('Freezer 2') + ' input[data-k="highLimit"]'), '0', 'each box keeps what was typed');
    await fits(page, 'MOCREO & Sensors 1920x1080');
    await shots(page, 'mocreo-admin');
    results.push('Thermometers: Cooler North on sensor A, Freezer 2 added (Dock freezer, sensor B, high 0), Cooler Middle turned off');

    const temps = await openPage(browser, 1920, 1080, '/temps.html?testEmail=manager.test@uniteddairy.com');
    await temps.waitForFunction(() => document.querySelectorAll('#rows [data-location]').length === 2);
    const t = await temps.$$eval('#rows [data-location]', r => r.map(x => x.textContent.replace(/\s+/g, ' ')));
    assert.match(t.join(' | '), /Cooler North[\s\S]*36\.4[\s\S]*\|[\s\S]*Freezer 2[\s\S]*2\.1[\s\S]*HIGH/);
    assert.ok(!/Cooler Middle/.test(t.join(' ')), 'a cooler turned off is not on Cooler Temperatures');
    if (SHOTS) await temps.screenshot({ path: path.join(SHOTS, 'mocreo-temps-1920.png'), scale: 'css' });
    results.push('Cooler Temperatures: Cooler North 36.4°F from its sensor, Freezer 2 2.1°F HIGH, Cooler Middle left off');
    for (const p of [page, temps]) assert.deepEqual(p.errors, []);
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('MOCREO ' + r));
})().catch(e => { console.error(e); process.exit(1); });

'use strict';
/*
 * Browser check of Administration > Machine Connections (Joe 10/26, mock-up 1: "it'll go by location, and then it'll go by
 * machine, and then we can enter the specifics in each machine from there"), on the made-up plant day:
 *   - the plant buttons across the top (an administrator sees all three), the machines down the left grouped by area with how
 *     each is doing, the picked machine on the right;
 *   - a line's page is its hookups only (Counted by, the controller, RedZone): changing Counted by there changes the list;
 *   - the Palletizer's page is its counter box alone; the Thermometers' page is the thermometers alone;
 *   - Charleston shows only its own (its own database): its counter boxes not set up, none of Uniontown's lines; fits 1536x790, 1920x1080 and a 390 phone, text 16px or larger.
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
const RD = require('../../src/reader');
const localCalls = require('./local-calls.cjs');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR || '';
const ADMIN = 'testEmail=admin.test@uniteddairy.com';

async function openPage(browser, width, height, url) {
  const page = await browser.newPage({ viewport: { width, height }, timezoneId: 'America/New_York' });
  await localCalls(page);
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
  });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(HOSTING + url);
  page.errors = errors;
  return page;
}
async function shot(page, name) {
  if (!SHOTS) return;
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOTS, name + '.png') });
}
async function fits(page, what) {
  const size = await page.evaluate(() => ({ scroll: document.scrollingElement.scrollWidth, inner: window.innerWidth }));
  assert.ok(size.scroll <= size.inner, what + ' has no sideways scrolling: ' + JSON.stringify(size));
}
async function bigText(page, sel, what) {
  const small = await page.$$eval(sel, els => els.flatMap(e => [e, ...e.querySelectorAll('*')]).filter(e => e.offsetParent && [...e.childNodes].some(x => x.nodeType === 3 && x.textContent.trim()))
    .map(e => [e.tagName + '.' + e.className, parseFloat(getComputedStyle(e).fontSize)]).filter(x => x[1] < 16));
  assert.deepEqual(small, [], what + ': text 16px or larger');
}
const machine = (page, name) => page.$eval('#mx-list', (l, n) => { const b = [...l.querySelectorAll('.mx-m')].find(x => x.querySelector('b').textContent === n); return b ? b.textContent : ''; }, name);
const pick = (page, name) => page.click('#mx-list .mx-m:has(b:text-is("' + name + '"))');

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date('2026-10-08T14:00:00Z') });
  // The Palletizer's counter box set up and heard from just now; Case Returns not set up.
  const admin = (fields) => RD.readerAll(db(), { email: 'admin.test@uniteddairy.com' }, fields, { now: () => new Date(), key: () => 'key-' + fields.counter });
  const { key } = await admin({ counter: 'palletizer', op: 'makeKey' });
  for (const [field, value] of [['brand', 'MODBUS'], ['ip', '192.168.1.40'], ['countTag', '40001']]) await admin({ counter: 'palletizer', op: 'saveCounter', field, value });
  await RD.handleReads(db(), { authorization: 'Bearer ' + key }, { device: 'palletizer', controller: { count: 1200 } }, { now: () => new Date() });
  await db().collection('sensors').doc('S1').set({ sensorId: 'S1', name: 'Walk-in sensor A', temperatureF: 36.4, online: true });
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const [w, h] of [[1536, 790], [1920, 1080]]) {
      const page = await openPage(browser, w, h, '/administration.html?item=machine-connections&' + ADMIN);
      await page.waitForSelector('#mx-list .mx-m');
      assert.deepEqual(await page.$$eval('.adm-nav-group:has(.adm-gh[data-group="Products & Machines"]) .adm-name', s => s.map(x => x.textContent)), ['Product Sheet', 'Machine Setup', 'Machine Connections', 'MOCREO Key', 'RedZone Sign-In']);
      assert.deepEqual(await page.$$eval('#mx-plants button', b => b.map(x => x.textContent)), ['Uniontown', 'Charleston', 'Martins Ferry']);
      await page.waitForSelector('#mx-list .mx-m:has(b:text-is("Palletizer"))');
      await page.waitForSelector('#mx-list .mx-m:has(b:text-is("BLOW MOLD"))');
      assert.deepEqual(await page.$$eval('#mx-list h4', t => t.map(x => x.textContent)), ['Fillers', 'HTST', 'Boxing & Totes', 'Blow Mold', 'Shipping & Returns', 'Coolers & Freezers']);
      // The 1536 pass changes it to a sensor.
      assert.match(await machine(page, 'GALLON FILLER'), w === 1536 ? /Typed on tablet/ : /Working[\s\S]*Sensor/);
      assert.match(await machine(page, 'Palletizer'), /Working[\s\S]*Case counter box/);
      assert.match(await machine(page, 'Case Returns'), /Not set up[\s\S]*Nothing hooked up/);
      assert.match(await machine(page, 'Thermometers'), /Working[\s\S]*1 MOCREO sensor/);
      await fits(page, 'Machine Connections at ' + w);
      await bigText(page, '.mx', 'Machine Connections');

      // A line: its hookups only, in Line Targets' own boxes.
      await pick(page, 'GALLON FILLER');
      const frame = page.frameLocator('.mx-frame');
      await frame.locator('#rz').waitFor();
      assert.equal(await frame.locator('.qc-lines').isVisible(), false, 'no line list inside the machine');
      assert.equal(await frame.locator('.lt-table').isVisible(), false, 'no products table inside the machine');
      assert.equal(await frame.locator('#counter').isVisible(), true, 'Counted by is on the machine');
      assert.match(page.url(), /machine=line%3Aut_prod_gallon_filler/);
      if (w === 1536) {
        await frame.locator('#counter').selectOption('SENSOR');
        await page.waitForFunction(() => /Working[\s\S]*Sensor/.test([...document.querySelectorAll('#mx-list .mx-m')].find(x => x.querySelector('b').textContent === 'GALLON FILLER').textContent));
        assert.equal(((await db().collection('productionLines').doc('ut_prod_gallon_filler').get()).data() || {}).counter, 'SENSOR');
        results.push('Counted by changed on the machine\'s page saves on the line and the list shows Working · Sensor');
      }
      await shot(page, 'line-' + w);

      // The Palletizer: its counter box alone.
      await pick(page, 'Palletizer');
      await page.waitForSelector('#mx-cc [data-counter="palletizer"]');
      assert.deepEqual(await page.$$eval('#mx-cc [data-counter] h3', t => t.map(x => x.textContent)), ['Palletizer']);
      assert.equal(await page.inputValue('#mx-cc [data-f="ip"]'), '192.168.1.40');
      await fits(page, 'Palletizer at ' + w);
      await bigText(page, '.mx', 'Palletizer');
      await shot(page, 'palletizer-' + w);

      // The thermometers alone (the key is MOCREO Key).
      await pick(page, 'Thermometers');
      const t = page.frameLocator('.mx-frame');
      await t.locator('.mc-therm').waitFor();
      assert.equal(await t.locator('.mc-left').isVisible(), false, 'no MOCREO key on the thermometers');
      await shot(page, 'thermometers-' + w);

      // Charleston: its own database, so its own counter boxes (not set up) and none of Uniontown's lines or sensors.
      await page.click('#mx-plants button:text-is("Charleston")');
      await page.waitForFunction(() => /Palletizer[\s\S]*Not set up/.test(document.getElementById('mx-list').textContent));
      assert.equal(await machine(page, 'GALLON FILLER'), '');
      assert.match(await machine(page, 'Thermometers'), /Not set up[\s\S]*No MOCREO sensors yet/);
      await shot(page, 'charleston-' + w);
      assert.deepEqual(page.errors, []);
      await page.close();
    }
    results.push('Plant buttons, machines grouped by area with Working / Typed on tablet / Not set up, a line\'s hookups, the Palletizer\'s box, the thermometers, Charleston on its own; fits 1536 and 1920');

    // MOCREO Key: the key and Test Connection only.
    const key2 = await openPage(browser, 1536, 790, '/administration.html?item=mocreo&' + ADMIN);
    const kf = key2.frameLocator('#frame');
    await kf.locator('#f-key').waitFor();
    assert.equal(await kf.locator('.mc-therm').isVisible(), false, 'no thermometers on MOCREO Key');
    await key2.close();
    results.push('MOCREO Key shows the key and Test Connection only');

    // Case Counters still opens from its old link and Find a setting.
    const old = await openPage(browser, 1536, 790, '/administration.html?item=case-counters&' + ADMIN);
    await old.waitForSelector('[data-counter="case_returns"]');
    await old.close();

    // A phone: the list above the machine, no sideways scrolling.
    const phone = await openPage(browser, 390, 844, '/administration.html?item=machine-connections&' + ADMIN);
    await phone.waitForSelector('#mx-list .mx-m');
    await fits(phone, 'Machine Connections on a phone');
    await shot(phone, 'phone-390');
    await phone.close();
    results.push('Fits a 390 phone');
  } finally {
    await browser.close();
  }
  console.log('Machine Connections browser check passed:\n- ' + results.join('\n- '));
})().catch(e => { console.error(e); process.exit(1); });

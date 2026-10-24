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
    // Joe 10/17: one fixed line per MOCREO sensor (its name can't be typed over) with his locations in a drop-down that starts blank.
    await page.waitForFunction(() => document.querySelectorAll('#srows tr[data-sensor]').length === 2);
    assert.deepEqual(await page.$$eval('.mc-sensors th', t => t.map(x => x.textContent)), ['MOCREO Sensor', 'Now', 'Battery', 'Your Location']);
    assert.deepEqual(await page.$$eval('#srows tr[data-sensor]', r => r.map(x => [x.querySelector('.mc-name').textContent, x.querySelectorAll('input').length, x.querySelector('select').value])),
      [['Dock freezer sensor', 0, ''], ['Walk-in sensor A', 0, '']]);
    const coolerNorth = await page.getAttribute(row('Cooler North'), 'data-id');
    await page.selectOption('#srows tr[data-sensor="S1"] select', coolerNorth);
    // Audit batch 4 (Joe's rule: no save messages): the pick saves quietly.
    const locOf = async (id) => (await db().collection('tempLocations').doc(id).get()).data() || {};
    for (let i = 0; i < 40 && (await locOf(coolerNorth)).sensorId !== 'S1'; i++) await page.waitForTimeout(250);
    assert.equal((await locOf(coolerNorth)).sensorId, 'S1', 'Cooler North is on Walk-in sensor A');
    assert.doesNotMatch(await page.textContent('#foot'), /saved|Saving/i);
    await page.click('#add');
    await page.fill('#rows tr:first-child input[data-k="location"]', 'Freezer 2');
    await page.press('#rows tr:first-child input[data-k="location"]', 'Tab');
    await page.waitForSelector(row('Freezer 2'), { timeout: 8000 });
    // Joe 10/17: one Location column; the Cooler / Area box that repeated it is gone.
    assert.deepEqual(await page.$$eval('.mc-table:not(.mc-sensors) th', t => t.map(x => x.textContent)), ['Location', 'Sensor', 'Now', 'Low °F', 'High °F', 'On', '']);
    await page.selectOption('#srows tr[data-sensor="S2"] select', await page.getAttribute(row('Freezer 2'), 'data-id'));
    const freezer2 = await page.getAttribute(row('Freezer 2'), 'data-id');
    for (let i = 0; i < 40 && (await locOf(freezer2)).sensorId !== 'S2'; i++) await page.waitForTimeout(250);
    assert.equal((await locOf(freezer2)).sensorId, 'S2', 'Freezer 2 is on Dock freezer sensor');
    await page.fill(row('Freezer 2') + ' input[data-k="highLimit"]', '0');
    await page.press(row('Freezer 2') + ' input[data-k="highLimit"]', 'Tab');
    await page.uncheck(row('Cooler Middle') + ' input[data-k="active"]');
    const coolerMiddle = await page.getAttribute(row('Cooler Middle'), 'data-id');
    for (let i = 0; i < 40 && (await locOf(coolerMiddle)).active !== false; i++) await page.waitForTimeout(250);
    assert.equal((await locOf(coolerMiddle)).active, false, 'Cooler Middle saved as off');
    await page.click('.head h1');
    await page.waitForFunction(() => /2\.1°F/.test(document.querySelector('#rows').textContent) && /36\.4°F/.test(document.querySelector('#rows').textContent));
    assert.equal(await page.inputValue(row('Freezer 2') + ' input[data-k="highLimit"]'), '0', 'each box keeps what was typed');
    await fits(page, 'MOCREO & Sensors 1920x1080');
    await shots(page, 'mocreo-admin');
    results.push('Thermometers: Cooler North on sensor A, Freezer 2 added (sensor B, high 0), Cooler Middle turned off');

    const temps = await openPage(browser, 1920, 1080, '/temps.html?testEmail=manager.test@uniteddairy.com');
    await temps.waitForFunction(() => document.querySelectorAll('#rows [data-location]').length === 2);
    const t = await temps.$$eval('#rows [data-location]', r => r.map(x => x.textContent.replace(/\s+/g, ' ')));
    assert.match(t.join(' | '), /Cooler North[\s\S]*36\.4[\s\S]*\|[\s\S]*Freezer 2[\s\S]*2\.1[\s\S]*HIGH/);
    assert.ok(!/Cooler Middle/.test(t.join(' ')), 'a cooler turned off is not on Cooler Temperatures');
    // Joe 10/19: a sensor reading in range needs no manual check; a HIGH one stays Due until someone enters a reading.
    const act = await temps.$$eval('#rows [data-location]', r => r.map(x => [x.children[0].querySelector('b').textContent, x.children[9].textContent, x.children[10].textContent]));
    assert.deepEqual(act, [['Cooler North', 'Sensor', 'OK'], ['Freezer 2', '—', 'Due']]);
    assert.deepEqual(await temps.$$eval('#hstats div', d => d.map(x => x.textContent)), ['2Locations', '1Checked 2 h', '1Due', '1Alerts']);
    assert.equal(await temps.$eval('#rows [data-location="ut_temp_cooler_north"] .tp-manual', i => i.disabled), false, 'the manual box still takes a reading');
    if (SHOTS) await temps.screenshot({ path: path.join(SHOTS, 'mocreo-temps-1920.png'), scale: 'css' });
    if (SHOTS) { await temps.setViewportSize({ width: 1536, height: 864 }); await temps.screenshot({ path: path.join(SHOTS, 'mocreo-temps-1536.png'), scale: 'css' }); await temps.setViewportSize({ width: 1920, height: 1080 }); }
    results.push('Cooler Temperatures: Cooler North 36.4°F from its sensor counts as checked by the sensor, Freezer 2 2.1°F HIGH is Due, Cooler Middle left off');
    // Joe 10/17: "I named the sensors ... on the MOCREO website and we need to match them up." Match to MOCREO Names shows the
    // pairs first and saves only on Save Matches: Cooler North goes from sensor A to "Main North", Cooler Middle gets
    // "Main Center", and Freezer 2, whose sensor is named for no cooler here, is left to pick by hand.
    await db().collection('sensors').doc('S3').set({ sensorId: 'S3', name: 'Main North', temperatureF: 35.1, batteryLevel: 100, online: true, returned: true, lastReadingAt: now, lastSyncAt: now });
    await db().collection('sensors').doc('S4').set({ sensorId: 'S4', name: 'Main Center', temperatureF: 37.2, batteryLevel: 100, online: true, returned: true, lastReadingAt: now, lastSyncAt: now });
    await page.waitForFunction(() => document.querySelectorAll('#srows tr[data-sensor]').length === 4);
    assert.match(await page.textContent('#srows tr[data-sensor="S3"] select'), /Cooler North · on Walk-in sensor A/, 'a location on another sensor says which');
    await page.click('#match');
    await page.waitForSelector('#match-box:not([hidden]) #match-save');
    const plan = (await page.textContent('#match-box')).replace(/\s+/g, ' ');
    assert.match(plan, /Cooler North: Walk-in sensor A → Main North/);
    assert.match(plan, /Cooler Middle: Manual only → Main Center \(turned off; tick On to show it on Cooler Temperatures\)/);
    assert.match(plan, /Freezer 2: Dock freezer sensor → Manual only \(no sensor named for it; pick it by hand\)/);
    assert.equal((await db().collection('tempLocations').doc('ut_temp_cooler_north').get()).data().sensorId, 'S1', 'nothing saves before Save Matches');
    await fits(page, 'MOCREO & Sensors with the matches 1920x1080');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'mocreo-match-1920.png'), scale: 'css' });
    const narrow = await openPage(browser, 1536, 864, '/mocreo.html?testEmail=admin.test@uniteddairy.com');
    await narrow.waitForSelector(row('Cooler North'));
    await narrow.click('#match');
    await narrow.waitForSelector('#match-box:not([hidden]) #match-save');
    await fits(narrow, 'MOCREO & Sensors with the matches 1536x864');
    const top = await narrow.$eval('#match', b => { const r = b.getBoundingClientRect(); return { right: r.right, h: r.height, w: b.scrollWidth <= b.clientWidth + 1 }; });
    assert.ok(top.right <= 1536 && top.w && top.h < 60, 'Match to MOCREO Names keeps its whole name on the top line at 1536 ' + JSON.stringify(top));
    if (SHOTS) await narrow.screenshot({ path: path.join(SHOTS, 'mocreo-match-1536.png'), scale: 'css' });
    await narrow.click('#match-cancel');
    await page.click('#match-save');
    await page.waitForFunction(() => /3 of 3 matches saved/.test(document.getElementById('foot').textContent), null, { timeout: 10000 });
    const got = {};
    for (const id of ['ut_temp_cooler_north', 'ut_temp_cooler_middle']) got[id] = (await db().collection('tempLocations').doc(id).get()).data().sensorId;
    const freezer = (await db().collection('tempLocations').where('location', '==', 'Freezer 2').get()).docs[0].data();
    assert.deepEqual([got.ut_temp_cooler_north, got.ut_temp_cooler_middle, freezer.sensorId, freezer.highLimit], ['S3', 'S4', '', 0]);
    await page.waitForFunction(() => /35\.1°F/.test(document.querySelector('#rows').textContent));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'mocreo-matched-1920.png'), scale: 'css' });
    // A location goes on one sensor only: picking Cooler North for "Main Center" moves it off "Main North", and Cooler Middle,
    // which was on "Main Center", goes to manual.
    await page.selectOption('#srows tr[data-sensor="S4"] select', 'ut_temp_cooler_north');
    for (let i = 0; i < 40 && ((await locOf('ut_temp_cooler_north')).sensorId !== 'S4' || (await locOf('ut_temp_cooler_middle')).sensorId !== ''); i++) await page.waitForTimeout(250);
    const moved = {};
    for (const id of ['ut_temp_cooler_north', 'ut_temp_cooler_middle']) moved[id] = (await db().collection('tempLocations').doc(id).get()).data().sensorId;
    assert.deepEqual(moved, { ut_temp_cooler_north: 'S4', ut_temp_cooler_middle: '' });
    // The list redraws from the saved locations a moment after the save, so wait for Main North's box to catch up.
    await page.waitForFunction(() => document.querySelector('#srows tr[data-sensor="S3"] select').value === '', null, { timeout: 5000 }).catch(() => {});
    assert.equal(await page.inputValue('#srows tr[data-sensor="S3"] select'), '', 'Main North is left with no location');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'mocreo-sensor-list-1920.png'), scale: 'css' });
    await narrow.waitForFunction(() => /Cooler North/.test(document.querySelector('#srows tr[data-sensor="S4"] select').selectedOptions[0].textContent));
    await fits(narrow, 'MOCREO & Sensors sensor list 1536x864');
    if (SHOTS) await narrow.screenshot({ path: path.join(SHOTS, 'mocreo-sensor-list-1536.png'), scale: 'css' });
    results.push('A location is on one sensor only: picking it for another sensor moves it there');
    results.push('Match to MOCREO Names: Cooler North → Main North, Cooler Middle → Main Center, Freezer 2 left to pick by hand; saved only on Save Matches');
    for (const p of [page, temps, narrow]) assert.deepEqual(p.errors, []);
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('MOCREO ' + r));
})().catch(e => { console.error(e); process.exit(1); });

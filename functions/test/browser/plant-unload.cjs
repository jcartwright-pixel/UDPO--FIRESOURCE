'use strict';
/*
 * Browser check of Unloading & Washing, Product Returns and Truck Washing against the local test database
 * (npm run test:browser), on the made-up plant day (test/fixtures/plant-demo.js): Thursday's trailers back.
 * A plant employee starts, counts and ends an unload, puts returns back in the cooler (RTA), washes trailers and
 * fixes a trailer number; a second open screen follows each change without reloading. Pictures go to SHOTS_DIR.
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
const WORKER = '&testEmail=viewer.test@uniteddairy.com', MANAGER = '&testEmail=manager.test@uniteddairy.com';

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
const row = (route) => 'tr[data-key="' + DATE + '|' + route + '|UT DSD MILK"]';
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
      const page = await openPage(browser, w, h, '/unloading.html?date=' + DATE + WORKER);
      await page.waitForSelector(row('805'));
      const keys = await page.$$eval('#rows tr[data-key]', trs => trs.map(t => t.dataset.key.split('|')[1]));
      assert.equal(keys[0], '805', 'the load being unloaded is on top');
      assert.equal(keys.length, 10, 'Needs Unloading: 12 case trailers back, 802 and 6303 already unloaded');
      assert.match(await page.textContent('#banner'), /Product returns need attention · 2 loads/);
      assert.match(await page.textContent(row('808')), /Next: 808 · UT DSD MILK · 4:00 AM/, 'the trailer is needed next for 808, which is loading');
      await fits(page, 'Unloading & Washing ' + w + 'x' + h);
      await shots(page, 'unloading', w);
      await page.click('[data-tab="all"]');
      await page.waitForSelector(row('802'));
      assert.match(await page.textContent(row('802') + ' td:nth-child(6)'), /Wash/, 'T-951 asked for a wash: 802 (unloaded) shows the Wash button');
      await fits(page, 'Unloading & Washing (All Loads) ' + w + 'x' + h);
      assert.deepEqual(page.errors, []);
      await page.close();
    }

    // Two open screens: the dock works the list, the manager's screen follows.
    const watcher = await openPage(browser, 1920, 950, '/unloading.html?date=' + DATE + MANAGER);
    const dock = await openPage(browser, 1920, 950, '/unloading.html?date=' + DATE + WORKER);
    await watcher.waitForSelector(row('805'));
    await dock.waitForSelector(row('811') + ' button.clock');
    await dock.click(row('811') + ' button.clock');
    await dock.waitForFunction(() => /Stop unloading 805/.test(document.getElementById('error').textContent));
    results.push('Start on 811 while 805 is unloading: "Stop unloading 805 · UT DSD MILK before starting another."');
    await dock.click(row('805') + ' button.clock.end');
    await dock.waitForFunction(() => /Enter the quantity before ending/.test(document.getElementById('error').textContent));
    await dock.fill(row('805') + ' input[data-f="casesIn"]', '25');
    const t0 = Date.now();
    await dock.click(row('805') + ' button.clock.end');
    await watcher.waitForFunction(k => !document.querySelector('tr[data-key="' + k + '"]'), DATE + '|805|UT DSD MILK', { timeout: 8000 }).catch(async e => {
      console.error('DEBUG', await dock.textContent('#error'), await dock.innerHTML(row('805')).catch(() => 'gone'), await watcher.innerHTML(row('805')).catch(() => 'gone'));
      throw e;
    });
    results.push('805: 25 cases typed, End pressed; it left the other screen\'s Needs Unloading list in ' + (Date.now() - t0) + ' ms');
    // The End is two saves (the count, then the end); Start 811 only once this screen too has 805 off its list, or the
    // one-at-a-time rule rightly refuses it. Then this screen shows 811 unloading at once and the other screen follows.
    await dock.waitForFunction(k => !document.querySelector('tr[data-key="' + k + '"]'), DATE + '|805|UT DSD MILK', { timeout: 8000 });
    await dock.click(row('811') + ' button.clock');
    await dock.waitForSelector(row('811') + '.loading', { timeout: 8000 });
    await watcher.waitForSelector(row('811') + '.loading', { timeout: 8000 }).catch(async e => {
      console.error('DEBUG3', await dock.textContent('#error'), await dock.innerHTML(row('811')).catch(() => 'gone'), await watcher.innerHTML(row('811')).catch(() => 'gone'));
      throw e;
    });

    // Edit: trailer back typed as 977 is stored as T-977.
    await dock.click(row('811') + ' button.edit-row');
    await dock.fill('#rows [data-e="trailer"]', '977');
    if (SHOTS) await dock.screenshot({ path: path.join(SHOTS, 'unloading-edit-1920.png'), scale: 'css' });
    await dock.click('#rows [data-do="editsave"]');
    await watcher.waitForFunction(() => /T-977/.test(document.querySelector('tr[data-key$="|811|UT DSD MILK"]').textContent), null, { timeout: 8000 }).catch(async e => {
      console.error('DEBUG2', await dock.textContent('#error'), await dock.innerHTML(row('811')).catch(() => 'gone'), await watcher.innerHTML(row('811')).catch(() => 'gone'));
      throw e;
    });
    results.push('811 trailer back typed 977: the other screen shows T-977');

    // RTA on 811 (the driver's check-in return); the banner drops to the one left (805, now on All Loads).
    await dock.click(row('811') + ' button.rta');
    await watcher.waitForFunction(() => /· 1 load(?!s)/.test(document.getElementById('banner').textContent), null, { timeout: 8000 });
    await watcher.waitForFunction(k => /Returned/.test(document.querySelector('tr[data-key="' + k + '"]').textContent), DATE + '|811|UT DSD MILK', { timeout: 8000 });
    results.push('RTA on 811: the other screen shows Returned and the banner counts 1 load');

    // Wash on 802 (T-951): Washed on the other screen.
    await dock.click('[data-tab="all"]');
    await watcher.click('[data-tab="all"]');
    await dock.click(row('802') + ' button.wash');
    await watcher.waitForFunction(k => /Washed/.test(document.querySelector('tr[data-key="' + k + '"] td:nth-child(6)').textContent), DATE + '|802|UT DSD MILK', { timeout: 8000 });
    results.push('Wash on 802: T-951 shows Washed on the other screen');
    assert.deepEqual(dock.errors, []);
    assert.deepEqual(watcher.errors, []);
    await watcher.close(); await dock.close();

    // Product Returns: 805's dock return is still pending; RTA it here.
    for (const [w, h] of [[1920, 950], [1366, 650]]) {
      const page = await openPage(browser, w, h, '/returns.html?date=' + DATE + WORKER);
      await page.waitForFunction(() => document.querySelectorAll('#rows tr').length === 2 && /Pending/.test(document.getElementById('rows').textContent));
      assert.match(await page.textContent('#hstats'), /2Returns7Cases1Refused1Pending/);
      await fits(page, 'Product Returns ' + w + 'x' + h);
      await shots(page, 'returns', w);
      if (w === 1366) {
        await page.click('button.rta');
        await page.waitForFunction(() => /0Pending/.test(document.getElementById('hstats').textContent), null, { timeout: 8000 });
        results.push('Product Returns: RTA on 805 leaves 0 pending');
      }
      assert.deepEqual(page.errors, []);
      await page.close();
    }

    // Truck Washing: T-960 asked for a wash and T-993 was unloaded (T-951 is washed). + Add Wash T-960.
    for (const [w, h] of [[1920, 950], [1366, 650]]) {
      const page = await openPage(browser, w, h, '/washing.html?date=' + DATE + WORKER);
      await page.waitForFunction(() => document.querySelectorAll('#rows tr button.wash').length === 2);
      const units = await page.$$eval('#rows td.rr b', bs => bs.map(b => b.textContent).sort());
      assert.deepEqual(units, ['T-960', 'T-993']);
      assert.match(await page.textContent('#side'), /Washes this week2/);
      await fits(page, 'Truck Washing ' + w + 'x' + h);
      await shots(page, 'washing', w);
      if (w === 1366) {
        await page.click('#add-open');
        await page.fill('#add-trailer', '960');
        await page.click('#add-bar button.wash');
        await page.waitForFunction(() => document.querySelectorAll('#rows tr button.wash').length === 1 && /Washes this week3/.test(document.getElementById('side').textContent), null, { timeout: 8000 });
        results.push('Truck Washing: + Add Wash 960 cleared T-960\'s request; 3 washes this week');
      }
      assert.deepEqual(page.errors, []);
      await page.close();
    }
    const log = await db().collection('actions').where('action', 'in', ['saveUnloading', 'completeWash']).get();
    assert.ok(log.size >= 7, 'each press is one save in the save log');
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('UNLOAD ' + r));
})().catch(e => { console.error(e); process.exit(1); });

'use strict';
/*
 * Browser check of the plant screens against the local test database (npm run test:browser):
 * a busy made-up plant day (test/fixtures/plant-demo.js) is transferred, then the Loadout Center and the Plant
 * Distribution Departments page are opened at 1920x950 and 1366x650. A plant employee starts a load, ends it, types a
 * trailer, adds a pickup and completes it; another open screen shows each change without reloading.
 * Pictures go to SHOTS_DIR when it is set.
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
const row = (route) => 'tr[data-row^="2026-10-04__run_p' + route + '|"]';

(async () => {
  await clear();
  const out = await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date('2026-10-08T14:00:00Z') });
  assert.deepEqual(out.summary.plant.skipped, [], 'every plant list was read');
  assert.equal(out.summary.plant.pickups.rows, 2);
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const [w, h] of [[1920, 950], [1366, 650]]) {
      const page = await openPage(browser, w, h, '/loadout.html?date=' + DATE + '&testEmail=viewer.test@uniteddairy.com');
      await page.waitForSelector(row('801'));
      const routes = await page.$$eval('#rows tr[data-row] td:first-child', tds => tds.map(td => td.textContent));
      assert.equal(routes[0], '6303', 'the load left over from Wednesday is on top');
      assert.deepEqual(routes.slice(1, 4), ['801', '802', '805'], 'then today in load order');
      assert.equal(routes.length, 12, '11 case loads today plus one left over');
      assert.match(await page.textContent('.divider.prior'), /PRIOR DAY LOADS/);
      assert.match(await page.textContent('#strip'), /Pickups 1 left of 2/);
      assert.equal(await page.textContent(row('805') + ' button.pu'), 'P/U1', 'an open pickup shows red with its count');
      const size = await page.evaluate(() => ({ scroll: document.scrollingElement.scrollHeight, inner: window.innerHeight, width: document.scrollingElement.scrollWidth, innerWidth: window.innerWidth }));
      assert.ok(size.scroll <= size.inner && size.width <= size.innerWidth, 'Loadout Center fits ' + w + 'x' + h + ' with no page scrolling: ' + JSON.stringify(size));
      if (SHOTS) {
        await page.screenshot({ path: path.join(SHOTS, 'loadout-' + w + '.png'), scale: 'css' });
        if (w === 1920) await page.screenshot({ path: path.join(SHOTS, 'loadout-top-2x.png'), clip: { x: 0, y: 0, width: 1920, height: 475 }, scale: 'device' });
      }
      assert.deepEqual(page.errors, []);
      await page.close();
    }

    // Two open screens: a plant employee works a load, the manager's screen follows without reloading.
    const watcher = await openPage(browser, 1920, 950, '/loadout.html?date=' + DATE + '&testEmail=manager.test@uniteddairy.com');
    const loader = await openPage(browser, 1920, 950, '/loadout.html?date=' + DATE + '&testEmail=viewer.test@uniteddairy.com');
    await watcher.waitForSelector(row('811'));
    await loader.waitForSelector(row('811') + ' button.clock:not([disabled])');
    const t0 = Date.now();
    await loader.click(row('811') + ' button.clock');
    await loader.waitForSelector(row('811') + '.loading');
    const shown = Date.now() - t0;
    await watcher.waitForSelector(row('811') + '.loading', { timeout: 8000 });
    const seen = Date.now() - t0;
    results.push('Start on 811: on screen in ' + shown + ' ms, on the other open screen in ' + seen + ' ms');
    await loader.waitForSelector(row('811') + ' button.clock.end');
    await loader.click(row('811') + ' button.clock');
    await watcher.waitForSelector(row('811') + '.done', { timeout: 8000 });
    results.push('End on 811: the other screen shows it Done');

    // Typing a trailer number: 977 becomes T-977 (no unit matches, kept as typed like the current app).
    await loader.fill(row('812') + ' input[data-k="trailer"]', '977');
    await loader.press(row('812') + ' input[data-k="trailer"]', 'Enter');
    await watcher.waitForFunction(() => { const i = document.querySelector('tr[data-row^="2026-10-04__run_p812|"] input[data-k="trailer"]'); return i && i.value === 'T-977'; }, null, { timeout: 8000 });
    await loader.fill(row('812') + ' input[data-k="quantity"]', '575');
    await loader.press(row('812') + ' input[data-k="quantity"]', 'Enter');
    await watcher.waitForFunction(() => { const i = document.querySelector('tr[data-row^="2026-10-04__run_p812|"] input[data-k="quantity"]'); return i && i.value === '575'; }, null, { timeout: 8000 });
    await loader.waitForFunction(() => { const i = document.querySelector('tr[data-row^="2026-10-04__run_p812|"] input[data-k="trailer"]'); return i && i.value === 'T-977'; }, null, { timeout: 8000 });
    results.push('typed trailer 977 and 575 cases on 812: the other screen shows T-977 and 575');

    // Status picker: Done.
    await loader.click(row('815') + ' button.state');
    await loader.click('#state-pop [data-s="COMPLETE"]');
    await watcher.waitForSelector(row('815') + '.done', { timeout: 8000 });

    // Pickups: add one on 6302, then complete it.
    await loader.click(row('6302') + ' button.pu');
    await loader.fill('#pu-item', 'Gallon chocolate');
    await loader.fill('#pu-qty', '4');
    await loader.click('#pu-add');
    await watcher.waitForFunction(() => /P\/U1/.test(document.querySelector('tr[data-row^="2026-10-04__run_p6302|"] button.pu').textContent), null, { timeout: 8000 });
    if (SHOTS) await loader.screenshot({ path: path.join(SHOTS, 'loadout-pickup-1920.png'), scale: 'css' });
    await loader.waitForSelector('#pu-list [data-done^="pu_"]', { timeout: 8000 });
    await loader.click('#pu-list [data-done^="pu_"]');
    await watcher.waitForFunction(() => document.querySelector('tr[data-row^="2026-10-04__run_p6302|"] button.pu').textContent === 'Completed', null, { timeout: 8000 });
    await loader.click('#pu-modal [data-close]');
    results.push('Add Pickup on 6302 showed red on the other screen; Pickup Complete turned it to Completed');

    // Edit box.
    await loader.click(row('6301_1') + ' button.edit-row');
    if (SHOTS) await loader.screenshot({ path: path.join(SHOTS, 'loadout-edit-1920.png'), scale: 'css' });
    await loader.fill('#edit-notes', 'Short 2 cases of buttermilk');
    await loader.click('#edit-save');
    await watcher.waitForFunction(() => true);

    // Tanker columns.
    await loader.click('[data-area="TANKER"]');
    const heads = await loader.$$eval('#head-row th', ths => ths.map(t => t.textContent));
    assert.deepEqual(heads, ['Route', 'Run', 'Driver / CVG', 'Truck', 'Trailer', 'Quantity Out', 'Status', 'Shift', 'Pickup', '']);
    assert.deepEqual(loader.errors, []);
    assert.deepEqual(watcher.errors, []);

    const db0 = db();
    const log = await db0.collection('actions').where('action', '==', 'savePlantLoad').get();
    assert.ok(log.size >= 5, 'each change is one save in the save log');

    // Departments page.
    for (const [w, h] of [[1920, 950], [1366, 650]]) {
      const home = await openPage(browser, w, h, '/plant.html?date=' + DATE + '&testEmail=viewer.test@uniteddairy.com');
      await home.waitForFunction(() => document.querySelector('[data-n="load.total"]').textContent === '16');
      assert.equal(await home.textContent('[data-n="unload.done"]'), '1');
      assert.equal(await home.textContent('[data-n="unload.total"]'), '1');
      assert.equal(await home.textContent('[data-n="wash.open"]'), '2');
      if (SHOTS) {
        await home.screenshot({ path: path.join(SHOTS, 'departments-' + w + '.png'), scale: 'css' });
        if (w === 1920) await home.screenshot({ path: path.join(SHOTS, 'departments-top-2x.png'), clip: { x: 0, y: 0, width: 1920, height: 475 }, scale: 'device' });
      }
      assert.deepEqual(home.errors, []);
      await home.close();
    }
    results.push('Plant Distribution Departments: loads, unloading, washing and returns counted');
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('PLANT ' + r));
})().catch(e => { console.error(e); process.exit(1); });

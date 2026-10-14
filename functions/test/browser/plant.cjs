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
      // Joe 10/14 ("for the case type columns ... B, make them narrower too"): as on Daily Box Loadout, Truck, Trailer and Cases Out
      // 20% narrower and Driver / CVG 30% (replacing Joe 10/11's one-line driver names); a driver's whole name still shows, at 16px
      // or more, wrapping when it is too long for the column.
      const drivers = await page.$$eval('#rows td.lo-driver', tds => tds.map(td => ({ name: td.textContent, fits: td.scrollWidth <= td.clientWidth + 1, size: parseFloat(getComputedStyle(td).fontSize) })));
      assert.ok(drivers.length >= 12 && drivers.every(d => d.fits && d.size >= 16), 'every driver\'s whole name shows at 16px or more at ' + w + ': ' + JSON.stringify(drivers.filter(d => !d.fits || d.size < 16)));
      assert.ok(drivers.some(d => /ALESANTRINO, DAVID/.test(d.name)), 'the long name is on the list');
      const widths = await page.$$eval('#cols col', c => c.map(x => parseFloat(x.style.width)));
      assert.deepEqual(widths.slice(0, 6), [5.6, 18.4, 10.9, 6.5, 6.5, 5.1], 'Truck, Trailer and Cases Out 20% narrower, Driver 30%; Route and Run wider');
      const runs = await page.$$eval('#rows tr[data-row] td:nth-child(2)', tds => tds.filter(td => td.classList.contains('fit-wrap')).map(td => td.textContent));
      assert.deepEqual(runs, [], 'every run on one line at ' + w);
      // Review item 22 (Joe 10/13): the Start / End column has its heading, and Wednesday's 6303 (still loading, End forgotten)
      // shows just "forgot End?" on one line; when it started shows on hover.
      assert.equal((await page.$$eval('#head-row th', ths => ths.map(t => t.textContent)))[8], 'Start / End');
      const forgot = await page.$eval(row('6303') + ' td:nth-child(10)', td => ({ text: td.textContent, title: (td.querySelector('[title]') || {}).title || '' }));
      assert.equal(forgot.text, 'forgot End?', JSON.stringify(forgot));
      assert.match(forgot.title, /^Started \w{3} \d{1,2}:\d{2} [AP]M · forgot End\?$/, 'when it started shows on hover ' + JSON.stringify(forgot));
      assert.ok(await page.$eval(row('6303'), tr => tr.getBoundingClientRect().height < 60), '6303 stays one line high');
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
    // Review item 38 (Joe 10/13): no Save Times & Notes button; leaving the box saves it, then Close.
    assert.equal(await loader.$('#edit-save'), null, 'no Save button on the Edit Load box');
    await loader.click('#edit-modal [data-close]');
    for (let i = 0; ; i++) {
      const days = (await db().collection('runs').get()).docs.flatMap(d => Object.values(d.data().days || {}));
      if (days.some(d => d && d.plantNotes === 'Short 2 cases of buttermilk')) break;
      assert.ok(i < 40, 'the note saved when its box was left');
      await new Promise(r => setTimeout(r, 250));
    }
    results.push('Edit Load: the note saved on leaving the box (no Save button)');

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
      // Joe 10/10: driver pickups count in the Loading totals: 16 runs plus 3 pickups (two in plant-demo.js, one added above).
      await home.waitForFunction(() => document.querySelector('[data-n="load.total"]').textContent === '19');
      // Thursday's trailers back: 16 runs plus 6303; 6303 and 802 unloaded, 805 unloading (plant-demo.js).
      await home.waitForFunction(() => document.querySelector('[data-n="unload.total"]').textContent === '17');
      assert.equal(await home.textContent('[data-n="unload.done"]'), '2');
      assert.equal(await home.textContent('[data-n="unload.unloading"]'), '1');
      // T-951 and T-960 asked for a wash; T-993 was unloaded and not washed yet.
      assert.equal(await home.textContent('[data-n="wash.open"]'), '3');
      assert.equal(await home.textContent('[data-n="ret.pending"]'), '2');
      // Review item 28 (Joe 10/13): the chart, list and tile labels are 16px, and a long Returns or Washing button has its whole
      // text on hover.
      assert.deepEqual(await home.$$eval('.dept-a .hour small, .dept-a .hour b, .dept-a .legend, .dept-a .chip em, .dept-a .chip small, .dept-a .dc-metric em, .dept-a .dc-metric small, .dept-a .sec-t, .dept-a .li, .dept-a .hb, .dept-a .dc-link', els => els.filter(e => parseFloat(getComputedStyle(e).fontSize) < 16).map(e => e.className + ' ' + e.textContent.slice(0, 20))), []);
      assert.ok(await home.$$eval('.dept-a [data-dept="ret"] a.dc-link', a => a.every(x => x.title && x.title === x.querySelector('span').textContent)), 'each Returns button has its whole text on hover');
      if (SHOTS) {
        await home.screenshot({ path: path.join(SHOTS, 'departments-' + w + '.png'), scale: 'css' });
        if (w === 1920) await home.screenshot({ path: path.join(SHOTS, 'departments-top-2x.png'), clip: { x: 0, y: 0, width: 1920, height: 475 }, scale: 'device' });
      }
      assert.deepEqual(home.errors, []);
      await home.close();
    }
    results.push('Plant Distribution Departments: loads, unloading, washing and returns counted');

    // Plant Station tablet (1280x800): Skip moves a waiting load to the bottom of today's loads, marked SKIPPED · COME BACK,
    // still there after a reload; Start takes the mark off. Wednesday's open load stays on top under "finish these first".
    {
      const tab = await openPage(browser, 1280, 800, '/loadout.html?date=' + DATE + '&area=CASE&testEmail=viewer.test@uniteddairy.com');
      await tab.waitForSelector('#rows tr[data-row] button.skip');
      assert.match(await tab.textContent('.divider.prior'), /still open, finish these first/);
      const id = await tab.$eval('#rows tr[data-row]:not(.done):not(.loading) button.skip', b => b.dataset.skip);
      const sel = 'tr[data-row="' + id + '"]';
      await tab.click(sel + ' button.skip');
      await tab.waitForSelector(sel + '.skipped');
      assert.equal(await tab.$eval('#rows tr[data-row]:last-child', t => t.dataset.row), id, 'the skipped load goes to the bottom');
      assert.match(await tab.textContent(sel), /SKIPPED · COME BACK/);
      assert.equal(await tab.$(sel + ' button.skip'), null, 'no second Skip on a skipped load');
      if (SHOTS) {
        await tab.screenshot({ path: path.join(SHOTS, 'loadout-skip-tablet-1280.png'), scale: 'css' });
        await tab.$eval('.sheet.scroll-list', el => { el.scrollTop = el.scrollHeight; });
        await tab.screenshot({ path: path.join(SHOTS, 'loadout-skipped-tablet-1280.png'), scale: 'css' });
      }
      // Start and Skip both show whole in their cell on the tablet.
      const fit = await tab.$$eval('.clock-cell', cs => cs.every(c => c.parentElement.scrollWidth <= c.parentElement.clientWidth + 1));
      assert.ok(fit, 'Start and Skip fit their cell at 1280 wide');
      await tab.reload();
      await tab.waitForSelector(sel + '.skipped');
      results.push('Skip: the load went to the bottom marked SKIPPED · COME BACK and stayed skipped after a reload');
      await tab.click(sel + ' button.clock');
      await tab.waitForSelector(sel + '.loading', { timeout: 8000 });
      assert.doesNotMatch(await tab.textContent(sel), /SKIPPED/);
      results.push('Start on the skipped load takes the mark off');
      assert.deepEqual(tab.errors, []);
      await tab.close();
    }
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('PLANT ' + r));
})().catch(e => { console.error(e); process.exit(1); });

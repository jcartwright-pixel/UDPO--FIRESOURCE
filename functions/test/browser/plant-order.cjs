'use strict';
/*
 * Browser check of the Loadout Center loading order (npm run test:browser): on the made-up plant day, with the clock set
 * to that day, a plant employee moves a load with the arrows, drags one with the mouse and one with a finger on a tablet
 * (touch events), and another open screen follows. A day that is not today shows no handles. Pictures go to SHOTS_DIR.
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
const NOON = new Date(DATE + 'T16:00:00Z');

async function openPage(browser, opts, url) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  await page.clock.setFixedTime(NOON);
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    const file = route.request().url().split('/').pop();
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, file)) });
  });
  // The local server's clock is set to the same made-up day for each save (index.js reads testNow on the emulator only).
  await page.route(/127\.0\.0\.1:5001\/.*\/save$/, (route) => {
    const req = route.request();
    if (req.method() !== 'POST') return route.continue();
    const body = JSON.parse(req.postData() || '{}');
    body.data = Object.assign({}, body.data, { testNow: NOON.toISOString() });
    route.continue({ postData: JSON.stringify(body) });
  });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(HOSTING + url);
  page.errors = errors;
  return page;
}
const row = (route) => 'tr[data-row^="2026-10-04__run_p' + route + '|"]';
const routes = (page) => page.$$eval('#rows tr[data-row] td:first-child', tds => tds.map(td => td.textContent));
const waitOrder = (page, list) => page.waitForFunction(want => [...document.querySelectorAll('#rows tr[data-row] td:first-child')].map(td => td.textContent).slice(1, 1 + want.length).join(',') === want.join(','), list, { timeout: 8000 })
  .catch(async e => { throw new Error('Wanted ' + list.join(',') + ' but the screen shows ' + (await routes(page)).join(',') + ' / ' + (await page.textContent('#error').catch(() => ''))); });

// A redraw can replace a row between finding it and measuring it: measure again.
async function box(page, sel) {
  for (let i = 0; i < 20; i++) { const b = await page.locator(sel).boundingBox().catch(() => null); if (b) return b; await page.waitForTimeout(100); }
  throw new Error('Not on screen: ' + sel);
}
async function touchDrag(page, from, to) {
  const cdp = await page.context().newCDPSession(page);
  const a = await box(page, from), b = await box(page, to);
  const p = (x, y) => [{ x, y, id: 1 }];
  const x0 = a.x + a.width / 2, y0 = a.y + a.height / 2, y1 = b.y + 6;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: p(x0, y0) });
  for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: p(x0, y0 + (y1 - y0) * i / 8) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date(DATE + 'T14:00:00Z') });
  const browser = await chromium.launch();
  const results = [];
  try {
    const desk = { viewport: { width: 1920, height: 950 }, deviceScaleFactor: SHOTS ? 2 : 1 };
    const loader = await openPage(browser, desk, '/loadout.html?date=' + DATE + '&testEmail=viewer.test@uniteddairy.com');
    const watcher = await openPage(browser, desk, '/loadout.html?date=' + DATE + '&testEmail=manager.test@uniteddairy.com');
    await loader.waitForSelector(row('811') + ' .lo-grip');
    assert.deepEqual((await routes(loader)).slice(0, 7), ['6303', '801', '802', '805', '808', '811', '812'], 'the route cell still reads as the route; the left-over load stays on top');
    assert.equal(await loader.$(row('6303') + ' .lo-grip'), null, 'a prior-day load has no handle');
    assert.ok(await loader.$eval(row('801') + ' .lo-move.up', b => b.disabled), 'the first load cannot move earlier');
    if (SHOTS) {
      await loader.screenshot({ path: path.join(SHOTS, '1-loadout-order-1920.png'), scale: 'css' });
      await loader.screenshot({ path: path.join(SHOTS, '2-loadout-order-top-2x.png'), clip: { x: 0, y: 0, width: 1920, height: 475 }, scale: 'device' });
    }

    // Arrow: 811 one place later.
    await loader.click(row('811') + ' .lo-move.down');
    await waitOrder(loader, ['801', '802', '805', '808', '812', '811']);
    await waitOrder(watcher, ['801', '802', '805', '808', '812', '811']);
    results.push('Arrow: 811 moved after 812; the other open screen shows it');

    // Mouse drag: 815 by its handle onto the top half of 808 (lands before 808).
    const g = await box(loader, row('815') + ' .lo-grip'), t = await box(loader, row('808'));
    await loader.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
    await loader.mouse.down();
    for (let i = 1; i <= 8; i++) await loader.mouse.move(g.x + g.width / 2, g.y + g.height / 2 + (t.y + 8 - g.y - g.height / 2) * i / 8);
    if (SHOTS) await loader.screenshot({ path: path.join(SHOTS, '3-loadout-dragging-1920.png'), scale: 'css' });
    await loader.mouse.up();
    await waitOrder(loader, ['801', '802', '805', '815', '808', '812', '811']);
    await waitOrder(watcher, ['801', '802', '805', '815', '808', '812', '811']);
    results.push('Mouse drag: 815 dropped before 808');

    const run = async (r) => (await db().collection('runs').doc('2026-10-04__run_p' + r).get()).data().days.fri.loadSequenceOverride;
    assert.deepEqual(await Promise.all(['815', '808', '812', '811'].map(run)), [40, 50, 60, 70], 'saved as the day\'s load_sequence_override with the numbers the loads had');

    // Finger drag on a tablet: 6302 to before 805.
    const tablet = await openPage(browser, { viewport: { width: 1280, height: 800 }, hasTouch: true, isMobile: false }, '/loadout.html?date=' + DATE + '&testEmail=viewer.test@uniteddairy.com');
    await tablet.waitForSelector(row('6302') + ' .lo-grip');
    await tablet.locator(row('6302')).scrollIntoViewIfNeeded();
    await touchDrag(tablet, row('6302') + ' .lo-grip', row('805'));
    await waitOrder(tablet, ['801', '802', '6302', '805']);
    await waitOrder(watcher, ['801', '802', '6302', '805']);
    results.push('Finger drag on a 1280 tablet: 6302 moved up before 805');
    if (SHOTS) await tablet.screenshot({ path: path.join(SHOTS, '4-loadout-order-tablet-1280.png') });

    // Another day: no handles, the old widths.
    await loader.click('#next');
    await loader.waitForFunction(() => document.querySelector('#load-date').value === '2026-10-09');
    assert.equal(await loader.$('.lo-grip'), null, 'tomorrow shows no handles');
    for (const p of [loader, watcher, tablet]) assert.deepEqual(p.errors, []);
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('ORDER ' + r));
})().catch(e => { console.error(e); process.exit(1); });

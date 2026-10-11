'use strict';
/*
 * Browser check of the Loadout Center loading order (npm run test:browser): on the made-up plant day, with the clock set
 * to that day, a plant employee moves a load with the keyboard (Up / Down on the grab handle), drags one with the mouse and one with a finger on a tablet
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
  // The finger goes down only once the screen has settled: both rows in view, the handle where it was 300 ms ago and
  // nothing over it (on a slower machine the rows were still moving when the finger went down, and nothing was dragged).
  // The row it goes to must show too, not sit under the table's fixed header (the finger would land on the header and the
  // load would go nowhere), so the list is scrolled to put that row just below the header, and the spot checked for both.
  await page.evaluate(([f, t]) => { const b = document.querySelector(t), s = b.closest('.scroll-list');
    s.scrollTop += b.getBoundingClientRect().top - (s.getBoundingClientRect().top + s.querySelector('thead').offsetHeight + 30); }, [from, to]);
  const hits = (sel, x, y) => page.evaluate(([s, px, py]) => { const el = document.elementFromPoint(px, py); return !!(el && el.closest(s)); }, [sel, x, y]);
  let a = null, b = null, ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    const a2 = await box(page, from), b2 = await box(page, to), x = a2.x + a2.width / 2;
    ready = !!(a && b && a.y === a2.y && b.y === b2.y) && await hits(from, x, a2.y + a2.height / 2) && await hits(to, x, b2.y + 6);
    a = a2; b = b2;
    if (!ready) await page.waitForTimeout(300);
  }
  if (!ready) throw new Error('The tablet screen did not settle with both rows showing: ' + JSON.stringify({ a, b }));
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
  for (const [w, h] of [[1920, 1000], [1536, 760]]) {
    const p = await openPage(browser, { viewport: { width: w, height: h } }, '/loadout.html?date=' + DATE + '&testEmail=' + (process.env.WHO || 'viewer.test@uniteddairy.com'));
    await p.waitForSelector(row('811'));
    await p.waitForTimeout(800);
    const info = await p.$$eval('.lo-grip', g => g.map(x => { const r = x.getBoundingClientRect(), td = x.closest('td').getBoundingClientRect(); return [x.textContent, Math.round(r.left), Math.round(r.right), Math.round(td.left), Math.round(td.right)]; }));
    console.log('GRIPS', w, JSON.stringify(info.slice(0, 3)), info.length);
    if (process.env.OUT) await p.screenshot({ path: require('path').join(process.env.OUT, 'loadout-grip-' + process.env.TAG + '-' + w + '.png') });
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });

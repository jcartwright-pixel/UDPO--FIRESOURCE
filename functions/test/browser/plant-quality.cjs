'use strict';
/*
 * Browser check of Production Line Status & Quality on the made-up plant (test/fixtures/plant-demo.js): the lines in view order
 * with their last checks, each line's own fields, a check saved box by box as each is left (Joe 10/10: no Record button; the
 * boxes start empty with the last check small and grey), the 24-hour history, and a second open screen.
 * (Below: the old header of the Yard Checks test this file was made from.)
 * Browser check of Yard Checks against the local test database (npm run test:browser). Four loaded trailers wait on the
 * yard today (dated from the real clock, since the yard list follows the time of day): T-701 never checked, T-702 checked
 * 3 hours ago (due again), T-703 checked 30 minutes ago (locked for 2 hours), T-704 never checked. A plant employee records
 * a check and a Left Yard; a second open screen follows without reloading. Pictures go to SHOTS_DIR.
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
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const [w, h] of [[1920, 950], [1366, 650]]) {
      const page = await openPage(browser, w, h, '/quality.html' + MANAGER);
      await page.waitForFunction(() => document.querySelectorAll('#lines [data-line]').length === 5);
      assert.deepEqual(await page.$$eval('#lines [data-line] span', s => s.map(x => x.textContent)), ['BOXING', 'TOTES', 'HTST #1', 'GALLON FILLER', 'BLOW MOLD']);
      assert.equal(await page.textContent('#form-title'), 'BOXING Quality Check');
      assert.equal(await page.inputValue('.prod-product'), '', 'the boxes start empty');
      assert.match(await page.textContent('#fields'), /Last: 1% Chocolate milk/, 'the line\'s last check shows small and grey');
      assert.equal(await page.$('.prod-cycle'), null, 'Boxing records no cycle time');
      await page.click('[data-line="ut_prod_blow_mold"]');
      await page.waitForFunction(() => document.getElementById('form-title').textContent === 'BLOW MOLD Quality Check');
      assert.equal(await page.$$eval('.prod-head', x => x.length), 6);
      assert.equal(await page.inputValue('.prod-head[data-head="2"]'), '');
      assert.match(await page.textContent('.qc-heads'), /Last: 58\.5/);
      await fits(page, 'Quality ' + w + 'x' + h);
      await shots(page, 'quality-blowmold', w);
      await page.click('[data-line="ut_prod_htst_1"]');
      await page.waitForFunction(() => document.getElementById('form-title').textContent === 'HTST #1 Quality Check');
      assert.deepEqual(await page.$$eval('#fields label, #fields .qc-field > span', l => l.map(x => x.childNodes[0].textContent.trim())), ['Product being run', 'Temperature', 'Label / date code', 'Overall result', 'Corrective action / notes']);
      await shots(page, 'quality-htst', w);
      await page.click('[data-pane="history"]');
      await page.waitForSelector('#pane-history:not([hidden])');
      await fits(page, 'Quality history ' + w + 'x' + h);
      assert.deepEqual(page.errors, []);
      await page.close();
    }
    const watcher = await openPage(browser, 1920, 950, '/quality.html?view=history&' + MANAGER.slice(1));
    const desk = await openPage(browser, 1920, 950, '/quality.html?line=ut_prod_totes&' + MANAGER.slice(1));
    await desk.waitForFunction(() => document.getElementById('form-title').textContent === 'TOTES Quality Check');
    await watcher.waitForSelector('#pane-history:not([hidden])');
    const before = await watcher.$$eval('#history tr:not(:has(td.empty))', r => r.length);
    assert.equal(await desk.$('.prod-weights'), null, 'Totes records no weight');
    // Joe 10/10 (typed): the product is picked from the machine's own drop-down; one not on it goes under Other (type it).
    await desk.focus('.prod-product');
    await desk.selectOption('.prod-product', '__other__');
    await desk.fill('.prod-other', 'Orange drink');
    await desk.press('.prod-other', 'Tab');
    const t0 = Date.now();
    await desk.fill('.prod-temperature', '38');
    await desk.press('.prod-temperature', 'Tab');
    await desk.selectOption('.prod-status', 'REVIEW');
    await desk.waitForFunction(() => /^Saved/.test(document.querySelector('[data-note="prod-status"]').textContent));
    const shown = Date.now() - t0;
    await desk.fill('.prod-notes', 'Cap torque low');
    await desk.press('.prod-notes', 'Tab');
    await watcher.waitForFunction((n) => document.querySelectorAll('#history tr:not(:has(td.empty))').length === n + 1 && /TOTES[\s\S]*Orange drink[\s\S]*Temp 38[\s\S]*Review[\s\S]*Cap torque low/.test(document.querySelector('#history tr').textContent), before, { timeout: 8000 });
    results.push('Quality check saved box by box (TOTES, Review, 38): on screen in ' + shown + ' ms, top of the other screen\'s 24-hour history in ' + (Date.now() - t0) + ' ms');
    if (SHOTS) await watcher.screenshot({ path: path.join(SHOTS, 'quality-history-1920.png'), scale: 'css' });
    const phone = await openPage(browser, 412, 860, '/quality.html?line=ut_prod_gallon_filler&' + MANAGER.slice(1));
    await phone.waitForFunction(() => document.getElementById('form-title').textContent === 'GALLON FILLER Quality Check');
    if (SHOTS) await phone.screenshot({ path: path.join(SHOTS, 'quality-phone-412.png'), scale: 'css' });
    assert.deepEqual(desk.errors, []);
    assert.deepEqual(watcher.errors, []);
    assert.deepEqual(phone.errors, []);
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('QUALITY ' + r));
})().catch(e => { console.error(e); process.exit(1); });

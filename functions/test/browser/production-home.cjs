'use strict';
/*
 * Browser check of the Plant Production front page (Joe 10/26): Blow Mold is not on it, Boxing and Totes are two cards side by
 * side (each opening just its own lines), and the page fits Joe's 1536 laptop window and a 1920 screen without scrolling.
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

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR || '';
const ADMIN = 'testEmail=admin.test@uniteddairy.com';

async function openPage(browser, width, height, url) {
  const page = await browser.newPage({ viewport: { width, height }, timezoneId: 'America/New_York' });
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
  });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(HOSTING + url);
  page.errors = errors;
  return page;
}

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date() });
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const [w, h] of [[1536, 790], [1920, 1080]]) {
      const p = await openPage(browser, w, h, '/production-home.html?' + ADMIN);
      await p.waitForFunction(() => document.querySelectorAll('.dp-card').length === 4 && [...document.querySelectorAll('.dp-card')].every(c => c.querySelector('.dp-counts b').textContent !== '0') && document.querySelector('[data-card="walk"] .mc-tile') && document.querySelector('[data-card="notes"] .mc-tile'));
      await p.waitForTimeout(500);
      assert.deepEqual(await p.$$eval('.dp-card .dp-head strong', s => s.map(x => x.textContent)), ['Fillers', 'HTST', 'Boxing', 'Totes'], 'no Blow Mold card, Boxing and Totes apart');
      assert.deepEqual(await p.$$eval('.dp-card', c => c.map(x => x.dataset.href)), ['production.html?kind=FILLER', 'production.html?kind=HTST', 'production.html?kind=BOXING', 'production.html?kind=TOTES']);
      const lines = await p.$$eval('.dp-card', c => c.map(x => x.querySelector('.dp-counts b').textContent));
      assert.deepEqual(lines.slice(2), ['1', '1'], 'one line on each of Boxing and Totes');
      // Boxing on one side, Totes on the other, on the same row.
      const [bx, tt] = await p.$$eval('.dp-card', c => c.slice(2).map(x => x.getBoundingClientRect()).map(r => ({ top: Math.round(r.top), left: r.left })));
      assert.ok(bx.top === tt.top && bx.left < tt.left, 'Boxing and Totes side by side: ' + JSON.stringify([bx, tt]));
      const fit = await p.evaluate(() => { const g = document.getElementById('grid'), se = document.scrollingElement; return { grid: g.scrollHeight - g.clientHeight, page: se.scrollHeight - innerHeight, side: se.scrollWidth - innerWidth }; });
      assert.deepEqual(fit, { grid: 0, page: 0, side: 0 }, 'fits at ' + w + 'x' + h + ' without scrolling');
      const font = await p.$$eval('#grid *', els => Math.min(...els.filter(e => e.offsetParent && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())).map(e => parseFloat(getComputedStyle(e).fontSize))));
      assert.ok(font >= 16, 'text at least 16px, was ' + font);
      if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'production-home-' + w + '.png') });
      assert.deepEqual(p.errors, []);
      await p.close();
    }
    results.push('Plant Production front page: Fillers, HTST, Boxing and Totes (no Blow Mold), Boxing and Totes side by side, fits 1536x790 and 1920x1080 without scrolling');

    // The Totes card opens just the Totes line; the Boxing card just the boxing lines.
    for (const [kind, names] of [['TOTES', ['TOTES']], ['BOXING', ['BOXING']]]) {
      const p = await openPage(browser, 1536, 864, '/production.html?kind=' + kind + '&' + ADMIN);
      await p.waitForFunction(() => document.querySelectorAll('#tiles .pd-tile').length > 0);
      assert.deepEqual(await p.$$eval('#tiles .pd-tile .pd-name', t => t.map(x => x.textContent)), names, kind);
      assert.deepEqual(p.errors, []);
      await p.close();
    }
    results.push('The Boxing and Totes cards open just their own lines');
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('ok - ' + r));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });

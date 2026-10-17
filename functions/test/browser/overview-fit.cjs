'use strict';
/*
 * Browser check of the Operations Overview's plant card (Joe 10/16: "make them a little taller and that way you can fit all
 * the wording in the tiles"). On the made-up plant day, at every desk, tablet and phone size: each number tile's word sits
 * whole inside its tile (MAINTENANCE used to spill out), and each Recent Activity line keeps its name on one line and its
 * route and truck / trailer whole (223873 / T-993 used to split at the hyphen). With SHOTS_DIR=<folder> it saves pictures.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const F = require('../fixtures/fake-sheets');
const PD = require('../fixtures/plant-demo');
const localCalls = require('./local-calls.cjs');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR || '';
const NOON = new Date(PD.PLANT_DATE + 'T16:00:00Z');

async function openPage(browser, width, height) {
  const page = await browser.newPage({ viewport: { width, height }, serviceWorkers: 'block' });
  await page.clock.setFixedTime(NOON);
  await localCalls(page);
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, r => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, r.request().url().split('/').pop())) }));
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(HOSTING + '/company.html?testEmail=admin.test@uniteddairy.com');
  page.errors = errors;
  return page;
}

// Everything that does not fit: a tile word wider than its tile or poking past it, a Recent Activity name or piece on two lines.
const misfits = (page) => page.evaluate(() => {
  const out = [], lines = (el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight || 20));
  document.querySelectorAll('.co-plant .co-cell').forEach(c => {
    const s = c.querySelector('span'), cr = c.getBoundingClientRect(), r = document.createRange();
    r.selectNodeContents(s);
    const sr = r.getBoundingClientRect();
    if (sr.left < cr.left + 2 || sr.right > cr.right - 2 || s.scrollWidth > s.clientWidth) out.push('tile ' + s.textContent);
  });
  document.querySelectorAll('.co-plant .co-act').forEach(a => {
    [a.querySelector('span'), ...a.querySelectorAll('.co-what b, .co-what i, time, b.none')].forEach(el => {
      const rects = (() => { const r = document.createRange(); r.selectNodeContents(el); return [...r.getClientRects()]; })();
      if (new Set(rects.map(x => Math.round(x.top))).size > 1) out.push('line ' + el.textContent);
      if (el.getBoundingClientRect().right > a.getBoundingClientRect().right + 1) out.push('past edge ' + el.textContent);
    });
  });
  return out;
});

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date(PD.PLANT_DATE + 'T14:00:00Z') });
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const [w, h] of [[1536, 864], [1920, 1080], [1366, 768], [1024, 768], [800, 1280], [600, 960], [412, 915], [390, 844]]) {
      const page = await openPage(browser, w, h);
      await page.waitForSelector('.co-plant[data-plant="fac_uniontown"] .co-grid');
      await page.waitForFunction(() => document.querySelectorAll('.co-plant .co-act time').length >= 2);
      await page.waitForTimeout(400);
      if (SHOTS) {
        await page.screenshot({ path: path.join(SHOTS, 'overview-' + w + '.png'), fullPage: true });
        if (w === 1536) await page.locator('.co-plant[data-plant="fac_uniontown"]').screenshot({ path: path.join(SHOTS, 'overview-card-zoom-1536.png'), scale: 'device' });
      }
      assert.deepEqual(await page.$$eval('.co-plant[data-plant="fac_uniontown"] .co-cell span', s => s.map(x => x.textContent)),
        ['Scheduled', 'Completed', 'Unloaded', 'Loaded', 'Loading', 'Waiting', 'Pickups', 'Maintenance'], 'all eight tiles stay');
      assert.deepEqual(await page.$$eval('.co-plant .co-act > span', s => s.map(x => x.textContent)), ['Route Being Loaded', 'Last Route Loaded', 'Next in Line']);
      assert.deepEqual(await misfits(page), [], w + 'x' + h + ': every word fits');
      assert.ok(await page.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth), w + ': no sideways scroll');
      // The Today box stays inside the blue banner on a phone (it went under the banner's edge).
      assert.ok(await page.evaluate(() => document.querySelector('.co-date').getBoundingClientRect().right <= document.querySelector('.co-hero').getBoundingClientRect().right), w + ': Today box inside the banner');
      const sizes = await page.$$eval('.co-plant .co-cell span, .co-plant .co-act > *, .co-plant .co-what > *', s => s.map(x => parseFloat(getComputedStyle(x).fontSize)));
      assert.ok(sizes.every(n => n >= 16), 'text stays 16px or larger');
      assert.equal(await page.$$eval('.co-plant[data-plant="fac_charleston"] .co-soon, .co-plant[data-plant="fac_martins_ferry"] .co-soon', s => s.length), 2, 'Charleston and Martins Ferry keep their being-built line');
      // Joe 10/16: at desk sizes the three plant cards stay the same width side by side (all three must fit once they are live).
      if (w >= 1366) assert.equal(new Set(await page.$$eval('.co-plant', c => c.map(x => Math.round(x.getBoundingClientRect().width)))).size, 1, w + ': the plant cards are the same width');
      assert.deepEqual(page.errors, []);
      await page.close();
    }
    results.push('Operations Overview: every tile word and Recent Activity line fits whole at 1920, 1536, 1366, 1024, 800, 600, 412 and 390');
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('ok - ' + r));
})().catch((e) => { console.error(e); process.exit(1); });

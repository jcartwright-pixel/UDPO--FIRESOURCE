'use strict';
/*
 * Browser check of Joe's 10/19 ask on Fleet & Maintenance ("shrink the index cards just a little bit, so I can see the bottom
 * of this window so I don't have to scroll down"): his 1920 screen at 125% is a 1536x790 window. The six counts, the four
 * cards and Latest write-ups all fit with no scrolling at 1536x790 and 1920x950, and every label stays 16px or larger.
 * SHOTS_DIR=<folder> saves pictures; BEFORE=1 only takes the pictures (for the screen as it was).
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const localCalls = require('./local-calls.cjs');
const { db, clear } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const F = require('../fixtures/fake-sheets');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR;
const BEFORE = !!process.env.BEFORE;

async function openPage(browser, width, height, url) {
  const page = await browser.newPage({ viewport: { width, height }, serviceWorkers: 'block' });
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
  });
  await localCalls(page);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(HOSTING + url);
  page.errors = errors;
  return page;
}

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: () => new Date() });
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const [w, h] of [[1536, 790], [1920, 950]]) {
      const p = await openPage(browser, w, h, '/maint.html?testEmail=manager.test@uniteddairy.com');
      await p.waitForSelector('.hub-card[data-kind="GARAGE"] .hub-tile');
      await p.waitForFunction(() => [...document.querySelectorAll('.hub-card img')].filter(i => i.complete && i.naturalWidth > 0).length === 3, null, { timeout: 10000 });
      await p.waitForTimeout(800);
      const m = await p.evaluate(() => {
        const v = document.querySelector('.hub-view'), cards = document.querySelector('.hub-cards').getBoundingClientRect();
        return { page: document.scrollingElement.scrollHeight - innerHeight, view: v.scrollHeight - v.clientHeight, cardsBottom: Math.round(cards.bottom), height: innerHeight };
      });
      console.log('# ' + w + 'x' + h + ' ' + JSON.stringify(m));
      if (SHOTS) await p.screenshot({ path: path.join(SHOTS, (BEFORE ? 'before' : 'after') + '-' + w + '.png') });
      if (BEFORE) { await p.close(); continue; }
      assert.ok(m.page <= 0 && m.view <= 0 && m.cardsBottom <= m.height, 'Fleet & Maintenance fits ' + w + 'x' + h + ' with no scrolling');
      assert.equal(await p.$$eval('.hub-kpis div', d => d.length), 6, 'all six counts');
      assert.equal(await p.$$eval('.hub-card', d => d.length), 4, 'all four cards');
      assert.deepEqual(await p.$$eval('.hub-tile span, .hub-kpis span, .hub-big small, .hub-card-head strong', s => s.filter(x => parseFloat(getComputedStyle(x).fontSize) < 16).map(x => x.textContent)), [], 'labels 16px or larger');
      assert.deepEqual(await p.$$eval('.hub-tile span', s => s.filter(x => x.scrollWidth > x.clientWidth + 1 || x.scrollHeight > x.clientHeight + 1 || x.closest('.hub-tile').scrollHeight > x.closest('.hub-tile').clientHeight + 1).map(x => x.textContent)), [], 'tile labels show in full');
      assert.deepEqual(p.errors, []);
      await p.close();
    }
    if (!BEFORE) results.push('Fleet & Maintenance fits Joe\'s 1536x790 window and 1920x950 with no scrolling: six counts, four cards, labels 16px or larger and whole');
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('ok - ' + r));
})().catch(e => { console.error(e); process.exit(1); });

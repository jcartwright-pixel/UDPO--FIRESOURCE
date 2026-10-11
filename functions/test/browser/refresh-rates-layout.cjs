'use strict';
/*
 * Browser check of Refresh Rates' columns (Joe 10/11): What it does wraps in a narrower column, and no How often
 * drop-down runs into Last run, at 1920, at 1920 zoomed to 125% (1536 wide) and at 1366. Text stays 16px.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const F = require('../fixtures/fake-sheets');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR;

async function openPage(browser, width, height, url) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
  });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(HOSTING + url);
  page.errors = errors;
  return page;
}
const shot = async (p, name, clip) => { if (SHOTS) await p.screenshot(Object.assign({ path: path.join(SHOTS, name) }, clip ? { clip } : {})); };

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: () => new Date('2026-10-09T12:00:00Z') });
  const at = '2026-10-11T00:14:00Z';
  await db().collection('private').doc('refreshRates').set({ lastRun: { transfer: at, mocreo: at, repairEmail: at, checkinMail: at, archive: at } }, { merge: true });
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const [w, h, name] of [[1920, 1080, '1920'], [1536, 864, '1920-at-125'], [1366, 768, '1366']]) {
      const p = await openPage(browser, w, h, '/administration.html?testEmail=admin.test@uniteddairy.com');
      await p.waitForSelector('.adm-item[data-key="refresh-rates"]');
      await p.click('.adm-item[data-key="refresh-rates"]');
      await p.waitForSelector('#rr2-rows tr select');
      const bad = await p.$$eval('#rr2-rows tr', rows => rows.flatMap(tr => {
        const how = tr.children[2], last = tr.children[3], lr = last.getBoundingClientRect(), out = [];
        how.querySelectorAll('select, .ap-chip').forEach(s => { const r = s.getBoundingClientRect(); if (r.right > how.getBoundingClientRect().right + 0.5 || (last.textContent.trim() && r.right > lr.left + 10)) out.push(tr.children[0].textContent + ': ' + Math.round(r.right) + ' > ' + Math.round(lr.left)); });
        return out;
      }));
      assert.deepEqual(bad, [], name + ': a How often control runs into Last run');
      assert.equal(await p.$eval('#rr2-rows td', td => getComputedStyle(td).fontSize), '16px');
      assert.equal(await p.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth), true);
      assert.deepEqual(p.errors, []);
      await shot(p, 'after-' + name + '.png');
      if (name === '1920') await shot(p, 'after-1920-top-2x.png', { x: 0, y: 0, width: 1920, height: 540 });
      await p.close();
      results.push('Refresh Rates at ' + name + ': no How often control runs into Last run; text stays 16px');
    }
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('ok - ' + r));
})().catch(err => { console.error(err); process.exit(1); });

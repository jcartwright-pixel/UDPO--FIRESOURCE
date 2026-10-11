'use strict';
/*
 * Browser check (npm run test:browser): HTST #1 records Changeover as its status and the Remaining output of the run (Joe 10/11,
 * review item 40, as the old app); the line list says "In changeover · <left>" on another open screen. Other lines have neither.
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
const WHO = 'testEmail=viewer.test@uniteddairy.com';

async function openPage(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 950 }, deviceScaleFactor: SHOTS ? 2 : 1 });
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

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date('2026-10-08T14:00:00Z') });
  const browser = await chromium.launch();
  const results = [];
  try {
    const desk = await openPage(browser, '/quality.html?line=ut_prod_htst_1&' + WHO);
    const watcher = await openPage(browser, '/quality.html?line=ut_prod_boxing&' + WHO);
    await desk.waitForFunction(() => document.getElementById('form-title').textContent === 'HTST #1 Quality Check');
    await desk.waitForSelector('#fields .prod-output:not([disabled])');
    assert.ok(await desk.$('#fields .prod-status option[value="CHANGEOVER"]'), 'HTST offers Changeover');
    await watcher.waitForFunction(() => document.getElementById('form-title').textContent === 'BOXING Quality Check');
    assert.equal(await watcher.$('#fields .prod-output'), null, 'Boxing has no Remaining output');
    assert.equal(await watcher.$('#fields .prod-status option[value="CHANGEOVER"]'), null, 'nor Changeover');
    await desk.selectOption('#fields .prod-status', 'CHANGEOVER');
    await desk.fill('#fields .prod-output', '300 gal');
    await desk.press('#fields .prod-output', 'Tab');
    await watcher.waitForFunction(() => /In changeover · 300 gal left/.test(document.querySelector('[data-line="ut_prod_htst_1"]').textContent), null, { timeout: 8000 });
    assert.equal(await watcher.textContent('[data-line="ut_prod_htst_1"] span'), 'HTST #1', 'the line name stays as it was');
    results.push('HTST #1 set to Changeover with 300 gal left; the other screen lists "In changeover · 300 gal left"');
    const saved = (await db().collection('plantJournal').where('type', '==', 'PRODUCTION_QUALITY').get()).docs.map(d => d.data()).filter(d => d.createdInApp && (d.payload || {}).operationId === 'ut_prod_htst_1');
    assert.equal(saved.length, 1);
    assert.equal(saved[0].payload.status, 'CHANGEOVER');
    assert.equal(saved[0].payload.remainingOutput, '300 gal');
    await desk.selectOption('#fields .prod-status', 'RUNNING');
    await watcher.waitForFunction(() => /Running · 300 gal left/.test(document.querySelector('[data-line="ut_prod_htst_1"]').textContent), null, { timeout: 8000 });
    results.push('Back to Pass: the list says "Running · 300 gal left"');
    if (SHOTS) {
      await desk.screenshot({ path: path.join(SHOTS, 'quality-htst-changeover-1920.png'), scale: 'css' });
      await desk.screenshot({ path: path.join(SHOTS, 'quality-htst-changeover-top-2x.png'), clip: { x: 0, y: 0, width: 1920, height: 475 }, scale: 'device' });
    }
    for (const p of [desk, watcher]) assert.deepEqual(p.errors, []);
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('HTST ' + r));
})().catch(e => { console.error(e); process.exit(1); });

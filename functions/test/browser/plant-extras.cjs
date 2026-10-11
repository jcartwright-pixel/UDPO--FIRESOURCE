'use strict';
/*
 * Browser check of the plant items from the screen review (7-10), on the made-up plant day:
 *   Loadout: the two-press "Ended Up Not Running" never stays armed for the
 *   next load. Unloading: the mode buttons say which is on. Quality: the first box picked on a line saves and
 *   says Saved even when the new check arrives before the save answers. Manager Center: Send waits for the plant's data.
 *   Pictures go to SHOTS_DIR.
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
const MANAGER = 'testEmail=manager.test@uniteddairy.com', ADMIN = 'testEmail=admin.test@uniteddairy.com', DISPATCH = 'testEmail=dispatch.test@uniteddairy.com';

async function openPage(browser, width, height, url) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: SHOTS && width === 1920 ? 2 : 1 });
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
  });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(HOSTING + url);
  page.errors = errors;
  return page;
}
async function shots(page, name) {
  if (!SHOTS) return;
  await page.screenshot({ path: path.join(SHOTS, name + '-1920.png'), scale: 'css' });
  await page.screenshot({ path: path.join(SHOTS, name + '-top-2x.png'), clip: { x: 0, y: 0, width: 1920, height: 475 }, scale: 'device' });
}
const row = (route) => '#rows tr[data-row^="2026-10-04__run_p' + route + '|"]';
const until = async (fn, what) => { for (let i = 0; i < 80; i++) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 100)); } throw new Error('Timed out: ' + what); };


(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date('2026-10-08T14:00:00Z') });
  const browser = await chromium.launch();
  const results = [];
  try {
    const page = await openPage(browser, 1920, 1080, '/loadout.html?date=' + DATE + '&' + MANAGER);
    await page.waitForSelector(row('811') + ' button.edit-row');

    // Ended Up Not Running: pressed once, then Cancel; the next load's box starts unarmed.
    await page.click(row('811') + ' button.edit-row');
    await page.click('#edit-notrunning');
    assert.match(await page.textContent('#edit-notrunning'), /Press again/);
    await page.click('#edit-modal [data-close]');
    await page.click(row('815') + ' button.edit-row');
    assert.equal(await page.textContent('#edit-notrunning'), 'Ended Up Not Running');
    await page.click('#edit-modal [data-close]');
    results.push('Loadout: "Ended Up Not Running" pressed once then Cancel does not stay armed for the next load');
    assert.deepEqual(page.errors, []);

    const un = await openPage(browser, 1920, 1080, '/unloading.html?date=' + DATE + '&' + MANAGER);
    await un.waitForSelector('#rows tr');
    assert.equal(await un.getAttribute('[data-mode="check"]', 'aria-pressed'), 'true');
    await shots(un, 'extras-unloading');
    results.push('Unloading: Check Off / View Only say which is on (aria-pressed)');

    const q = await openPage(browser, 1920, 1080, '/quality.html?line=ut_prod_htst_1&' + MANAGER);
    await q.waitForFunction(() => document.getElementById('form-title').textContent === 'HTST #1 Quality Check');
    await q.selectOption('.prod-status', 'CHANGEOVER');
    await q.waitForFunction(() => /^Saved/.test(document.querySelector('[data-note="prod-status"]').textContent), null, { timeout: 8000 });
    await q.fill('.prod-temperature', '38');
    await q.press('.prod-temperature', 'Tab');
    await q.waitForFunction(() => /^Saved/.test(document.querySelector('[data-note="prod-temperature"]').textContent));
    const checks = await until(async () => { const d = (await db().collection('plantJournal').where('type', '==', 'PRODUCTION_QUALITY').get()).docs.map(x => x.data()).filter(x => (x.payload || {}).area === 'HTST #1' && x.createdInApp); return d.length && d.every(x => x.payload.temperature === '38') && d; }, 'one HTST #1 check with both boxes');
    assert.equal(checks.length, 1, 'both boxes fill the same check');
    assert.equal(await q.getAttribute('.prod-temperature', 'inputmode'), 'decimal');
    results.push('Quality: the first box picked says Saved and later boxes fill the same check');

    const m = await openPage(browser, 1920, 1080, '/manager.html?' + MANAGER);
    await m.waitForSelector('#send', { state: 'attached' });
    await m.waitForFunction(() => !document.getElementById('send').disabled, null, { timeout: 8000 });
    results.push('Manager Center: Send Current Report is ready once the loads and the journal are read');
    for (const p of [un, q, m]) assert.deepEqual(p.errors, []);
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('EXTRAS ' + r));
})().catch(e => { console.error(e); process.exit(1); });

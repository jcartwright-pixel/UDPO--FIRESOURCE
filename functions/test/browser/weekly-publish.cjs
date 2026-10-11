'use strict';
/*
 * Joe 10/11 (review item 6): Weekly's Publish to Daily Dispatch on the Next week asks for a second click, moves the weeks on and
 * opens the new Next week built from the masters; a week after Next is a read-only preview; a week before Previous is read only.
 * Pictures go to SHOTS_DIR when it is set.
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
const SHOTS = process.env.SHOTS_DIR || '';

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
const routesShown = (page) => page.$$eval('#rows tr td:first-child', tds => tds.map(td => td.textContent));

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: () => new Date('2026-10-09T12:00:00Z') });
  // The made-up Route Master leaves the show flags blank (No); the real one has them.
  for (const id of ['run_t801', 'run_t802', 'run_t810']) await db().collection('routes').doc(id).update({ displayDaily: true, displayWeekly: true });
  const browser = await chromium.launch();
  try {
    const page = await openPage(browser, 1920, 950, '/weekly.html?week=2026-10-11&testEmail=dispatch.test@uniteddairy.com');
    await page.waitForSelector('#rows tr td.day');
    await page.waitForFunction(() => !document.getElementById('publish').disabled);
    assert.equal(await page.textContent('#publish'), 'Publish to Daily Dispatch');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, '1-next-week-before-publish-1920.png') });
    await page.click('#publish');
    assert.match(await page.textContent('#publish'), /^Click Again: Push 10-11-26 Live$/);
    assert.match(await page.textContent('#wk-note'), /move Current to Previous, Next to Current, and create the new Next week/);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, '2-click-again-1920.png') });
    await page.click('#publish');
    await page.waitForFunction(() => /week=2026-10-18/.test(location.search) && /Week pushed live/.test(document.getElementById('wk-note').textContent), null, { timeout: 10000 });
    assert.match(await page.textContent('#wk-note'), /Week pushed live\. Current is now 10\/11/);
    await page.waitForFunction(() => [...document.querySelectorAll('#rows tr td:first-child')].map(td => td.textContent).join() === '802,801,810', null, { timeout: 5000 });
    assert.match(await page.textContent('#rows'), /CASEY, LEE/);
    assert.ok(await page.$('#rows td.day.editable'), 'the new Next week can be edited');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, '3-new-next-week-1920.png') });

    // A week after Next: a preview from Route Master and Driver Master, view only.
    await page.click('#next-week');
    await page.waitForFunction(() => /preloaded from Route Master/.test(document.getElementById('wk-note').textContent) && document.querySelectorAll('#rows tr td.day').length > 0, null, { timeout: 8000 });
    assert.deepEqual(await routesShown(page), ['802', '801', '810']);
    assert.equal(await page.textContent('#publish'), 'Publish Stored Next Week First');
    assert.equal(await page.$('#rows td.day.editable'), null, 'a preview cannot be edited');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, '4-future-preview-1920.png') });

    // A week before Previous: view only.
    await page.fill('#week-date', '2026-09-27');
    await page.dispatchEvent('#week-date', 'change');
    await page.waitForFunction(() => /older than the Live weeks/.test(document.getElementById('wk-note').textContent) && document.querySelectorAll('#rows tr td.day').length > 0, null, { timeout: 8000 });
    assert.equal(await page.$eval('#publish', b => b.disabled), true);
    assert.equal(await page.$('#rows td.day.editable'), null, 'an older week cannot be edited');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, '5-older-week-1920.png') });
    assert.deepEqual(page.errors, []);
    console.log('weekly-publish: OK');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });

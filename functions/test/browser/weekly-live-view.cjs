'use strict';
/*
 * Joe 10/28 (picked hm, mock-up 3): Daily Dispatch's Weekly Dispatch button opens Weekly Dispatch, the live Current week, looking
 * just like the Weekly Dispatch Template (the renamed screen he gets next week ready on). A pick there saves to the live week, so
 * it shows on Daily Dispatch; there is no Publish and no arrows, and after a Publish it moves on to the new Current week by itself.
 * Pictures go to SHOTS_DIR when it is set.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const { applyAction } = require('../../src/actions');
const F = require('../fixtures/fake-sheets');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR || '';
const WHO = 'testEmail=dispatch.test@uniteddairy.com';

async function open(browser, width, height, url) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
  });
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  await page.goto(HOSTING + url);
  return page;
}
const shown = (page) => page.$eval('#week-date', el => el.value);
const visible = (page, id) => page.$eval('#' + id, el => !!el.offsetParent);

(async () => {
  await clear();
  // The copy taken on 10-09: Live weeks Previous 9-27, Current 10-04, Next 10-11.
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: () => new Date('2026-10-09T12:00:00Z') });
  for (const id of ['run_t801', 'run_t802', 'run_t810']) await db().collection('routes').doc(id).update({ displayDaily: true, displayWeekly: true });
  const browser = await chromium.launch();
  try {
    for (const [width, height] of [[1536, 864], [1920, 950]]) {
      // Daily's Weekly Dispatch button opens the live week.
      const page = await open(browser, width, height, '/daily.html?date=2026-10-05&' + WHO);
      await page.waitForSelector('#go-weekly[href*="view=live"]');
      await Promise.all([page.waitForURL(/weekly\.html\?view=live/), page.click('#go-weekly')]);
      await page.waitForSelector('tr td.day.editable[data-day="mon"]');
      assert.equal(await shown(page), '2026-10-04', 'the live Current week');
      assert.equal(await page.$eval('#page-name', h => h.textContent), 'Weekly Dispatch');
      assert.equal(await page.title(), 'Weekly Dispatch · Operations');
      for (const id of ['publish', 'reset', 'run-days', 'prev', 'next']) assert.equal(await visible(page, id), false, id + ' is not on the live week');
      assert.equal(await page.$eval('#week-date', el => el.disabled), true);
      assert.match(await page.$eval('#wk-note', el => el.textContent), /Changes here go straight to Daily Dispatch/);
      assert.equal(await page.$eval('#go-other', a => a.textContent), 'Weekly Dispatch Template');
      if (SHOTS) { await page.waitForTimeout(600); await page.screenshot({ path: path.join(SHOTS, 'weekly-dispatch-live-week-' + width + '.png') }); }
      // The Template button opens the renamed screen, with its Weekly Dispatch button back to here.
      await Promise.all([page.waitForURL(/weekly\.html\?week=/), page.click('#go-other')]);
      await page.waitForSelector('#rows tr td.day');
      assert.equal(await page.$eval('#page-name', h => h.textContent), 'Weekly Dispatch Template');
      assert.equal(await page.$eval('#go-other', a => a.textContent), 'Weekly Dispatch');
      assert.equal(await visible(page, 'publish'), true);
      if (SHOTS) { await page.waitForTimeout(600); await page.screenshot({ path: path.join(SHOTS, 'weekly-dispatch-template-' + width + '.png') }); }
      assert.deepEqual(page.errors, []);
      await page.close();
    }
    // A pick on the live week saves to the live week's run, the one Daily Dispatch shows.
    const live = await open(browser, 1920, 950, '/weekly.html?view=live&' + WHO);
    await live.waitForSelector('tr td.day.editable[data-day="mon"]');
    await live.waitForTimeout(800);
    await live.click('xpath=//tr[td[1][text()="899"]]/td[@data-day="mon"]');
    await live.selectOption('.popover select[data-kind="driver"]', 'drv_test_brook');
    await live.waitForFunction(() => [...document.querySelectorAll('#rows tr')].some(tr => tr.children[0].textContent === '899' && /BROOK/.test(tr.children[3].textContent)), null, { timeout: 8000 });
    let saved = false;
    for (let i = 0; i < 40 && !saved; i++) {
      const snap = await db().collection('runs').where('weekStart', '==', '2026-10-04').get();
      saved = snap.docs.some(d => JSON.stringify(d.data()).includes('drv_test_brook'));
      if (!saved) await new Promise(r => setTimeout(r, 250));
    }
    assert.ok(saved, 'the pick saved to the live week');
    // Next week published (here, from another computer): the open live week moves on to the new Current week by itself.
    await applyAction(db(), { email: 'dispatch.test@uniteddairy.com' }, { action: 'publishWeek', requestId: 'live-' + Date.now(), weekStart: '2026-10-11' }, () => new Date('2026-10-09T13:00:00Z'));
    await live.waitForFunction(() => document.getElementById('week-date').value === '2026-10-11', null, { timeout: 10000 });
    assert.match(live.url(), /view=live/);
    if (SHOTS) { await live.waitForTimeout(800); await live.screenshot({ path: path.join(SHOTS, 'weekly-dispatch-after-publish-1920.png') }); }
    assert.deepEqual(live.errors, []);
    await live.close();
    console.log('weekly-live-view: OK');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });

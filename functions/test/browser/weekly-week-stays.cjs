'use strict';
/*
 * Joe 10/28: "I do not want the date to change unless I change it. Whenever I change it, I publish to the new week, and then it
 * brings in the following next week." Weekly Dispatch opens on the Live Next week (not the calendar week), keeps the week picked
 * with the arrows, and after a Publish opens the new Next week. Pictures go to SHOTS_DIR when it is set.
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
const URL = '/weekly.html?testEmail=dispatch.test@uniteddairy.com';

async function open(context, width, height) {
  const page = await context.newPage();
  await page.setViewportSize({ width, height });
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
  });
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  await page.goto(HOSTING + URL);
  await page.waitForSelector('#rows tr td.day');
  return page;
}
const shown = (page) => page.$eval('#week-date', el => el.value);

(async () => {
  await clear();
  // The copy taken on 10-09: Live weeks Previous 9-27, Current 10-04, Next 10-11. Today's calendar week is a later week.
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: () => new Date('2026-10-09T12:00:00Z') });
  for (const id of ['run_t801', 'run_t802', 'run_t810']) await db().collection('routes').doc(id).update({ displayDaily: true, displayWeekly: true });
  const browser = await chromium.launch();
  try {
    for (const [width, height] of [[1536, 864], [1920, 950]]) {
      const context = await browser.newContext();
      // Opened with no week picked: the Live Next week, the week being got ready.
      const first = await open(context, width, height);
      assert.equal(await shown(first), '2026-10-11', 'opens on the Live Next week');
      if (SHOTS) await first.screenshot({ path: path.join(SHOTS, 'opens-on-next-week-' + width + '.png') });
      // Moved back a week with the arrow: it stays there when Weekly is opened again.
      await first.click('#prev');
      await first.waitForFunction(() => document.getElementById('week-date').value === '2026-10-04');
      await first.close();
      const again = await open(context, width, height);
      assert.equal(await shown(again), '2026-10-04', 'the week picked stays picked');
      await again.click('#next');
      await again.waitForFunction(() => document.getElementById('week-date').value === '2026-10-11');
      assert.deepEqual(first.errors.concat(again.errors), []);
      await again.close();
      await context.close();
    }
    // Published (here, from another computer): Weekly opens the new Next week.
    const context = await browser.newContext();
    const before = await open(context, 1920, 950);
    assert.equal(await shown(before), '2026-10-11');
    await before.close();
    await applyAction(db(), { email: 'dispatch.test@uniteddairy.com' }, { action: 'publishWeek', requestId: 'stays-' + Date.now(), weekStart: '2026-10-11' }, () => new Date('2026-10-09T13:00:00Z'));
    for (const [width, height] of [[1536, 864], [1920, 950]]) {
      const after = await open(context, width, height);
      assert.equal(await shown(after), '2026-10-18', 'after Publish it opens the new Next week');
      if (SHOTS) await after.screenshot({ path: path.join(SHOTS, 'after-publish-new-next-week-' + width + '.png') });
      assert.deepEqual(after.errors, []);
      await after.close();
    }
    await context.close();
    console.log('weekly-week-stays: OK');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });

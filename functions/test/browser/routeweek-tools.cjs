'use strict';
/*
 * Browser check of Route Week Override (review item 15, RouteWeekOverride.html): it opens at the week asked for (?week=,
 * as Weekly's Route Run Days sends it), and Reset Week asks twice before putting the week back to normal.
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

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: () => new Date('2026-10-09T12:00:00Z') });
  const live = ((await db().collection('config').doc('app').get()).data() || {}).liveWeeks || {};
  const weeks = [live.previous, live.current, live.next].filter(Boolean);
  assert.ok(weeks.length >= 2, 'the made-up sheets have more than one Live week: ' + JSON.stringify(live));
  const want = weeks[0];
  const browser = await chromium.launch();
  const results = [];
  try {
    const p = await openPage(browser, 1920, 1080, '/routeweek.html?week=' + want + '&testEmail=manager.test@uniteddairy.com');
    await p.waitForSelector('#rows tr[data-id] button[data-day]:not([disabled])');
    const [y, m, d] = want.split('-').map(Number);
    assert.equal(await p.textContent('#week-label'), 'Week of ' + m + '/' + d + '/' + y, 'opens at the week asked for');
    results.push('Route Week Override opened at the week of ' + want + ' (asked for), not the default ' + (live.next || live.current));

    // Change one day, then Reset: the first click only asks; the second puts the day back.
    const btn = '#rows tr[data-id] button[data-day="wed"]';
    const first = await p.$eval(btn, b => b.closest('tr').dataset.id);
    const sel = '#rows tr[data-id="' + first + '"] button[data-day="wed"]';
    await p.click(sel);
    await p.waitForFunction((s) => document.querySelector(s).classList.contains('over'), sel, { timeout: 5000 });
    await p.click('#reset');
    assert.equal(await p.textContent('#reset'), 'Click Again: Reset Week', 'the first click only asks to confirm');
    await p.waitForTimeout(800);
    assert.equal(await p.$eval(sel, b => b.classList.contains('over')), true, 'nothing was reset on the first click');
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'routeweek-reset-armed-1920.png') });
    await p.click('#reset');
    await p.waitForFunction((s) => !document.querySelector(s).classList.contains('over'), sel, { timeout: 8000 });
    assert.equal(await p.textContent('#reset'), 'Reset Week to Normal');
    results.push('Reset Week asked once ("Click Again: Reset Week"), then put the changed day back on the second click');

    // The first click alone runs out after 6 seconds.
    await p.click(sel);
    await p.waitForFunction((s) => document.querySelector(s).classList.contains('over'), sel, { timeout: 5000 });
    await p.click('#reset');
    await p.waitForTimeout(6500);
    assert.equal(await p.textContent('#reset'), 'Reset Week to Normal', 'the ask runs out');
    await p.click('#reset');
    await p.waitForTimeout(800);
    assert.equal(await p.$eval(sel, b => b.classList.contains('over')), true, 'a click after the ask ran out only asks again');
    results.push('An unanswered Reset ask runs out after 6 seconds');
    assert.deepEqual(p.errors, []);
    await p.close();
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('ok - ' + r));
})().catch(err => { console.error(err); process.exit(1); });

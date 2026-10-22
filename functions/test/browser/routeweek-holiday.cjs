'use strict';
/*
 * Browser check of Route Week Override's holidays (Joe 10/22, mock-up 2): a week with a holiday from the Scheduler's list
 * picks it in the Holiday drop-down, turns its column gold, outlines each load still running on it in red, and lists those
 * loads in the side with a Move to drop-down that takes the load off the holiday and onto the day picked.
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
const WEEK = '2026-11-22'; // Thanksgiving is Thursday 11-26-26
const PLAIN = '2026-11-15';
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
// route, run, days Sun..Sat
const ROWS = [['855', 'SAVE-A-LOT 1', '1111100'], ['857', 'SAVE-A-LOT 3', '1000100'], ['852', 'JERSEY LOAD 1', '0111111'], ['880', 'VENTURA', '0101010']];

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
  const d = db();
  for (const x of (await d.collection('runs').get()).docs) await x.ref.delete();
  for (let i = 0; i < ROWS.length; i++) {
    const [route, run, pat] = ROWS[i], id = 'hol_' + i, days = {}, normal = {};
    DAYS.forEach((p, j) => { days[p] = { runs: pat[j] === '1' }; normal[p] = { active: pat[j] === '1' }; });
    await d.collection('routes').doc(id).set({ id, route, run, days: normal });
    for (const w of [PLAIN, WEEK]) await d.collection('runs').doc(w + '_' + id).set({ weekStart: w, route, run, routeId: id, runId: id, weekOrder: i, rev: 1, days: JSON.parse(JSON.stringify(days)) });
  }
  for (const w of ['2026-11-08', PLAIN, WEEK]) await d.collection('weeks').doc(w).set({ weekStart: w });
  await d.collection('config').doc('app').set({ liveWeeks: { previous: '2026-11-08', current: PLAIN, next: WEEK } }, { merge: true });

  const browser = await chromium.launch();
  const results = [];
  try {
    const p = await openPage(browser, 1536, 790, '/routeweek.html?week=' + WEEK + '&testEmail=manager.test@uniteddairy.com');
    await p.waitForSelector('#hol-list select:not([disabled])');
    assert.equal(await p.$eval('#hol-pick', s => s.selectedOptions[0].textContent), 'Thanksgiving · Thu 11-26-26', 'the app picks the week\'s holiday itself');
    assert.equal(await p.$eval('#heads th.hol', th => th.textContent.startsWith('HolidayTHU')), true, 'the holiday column is marked');
    assert.equal(await p.$$eval('#rows button.hol-need', b => b.length), 3, 'the three loads on Thanksgiving are outlined');
    assert.equal(await p.textContent('#hol-head'), 'Move Thanksgiving loads to · 3 left');
    assert.equal(await p.isHidden('#rw-filter'), true, 'the side lists the holiday loads instead of All Routes / Changed Only');
    results.push('Thanksgiving week picks Thanksgiving, marks Thursday and lists the 3 loads that run on it');

    // 855 already runs Wednesday, so its choices leave Wednesday out; move it to Friday.
    const row = '#hol-list [data-id="' + WEEK + '_hol_0"]';
    const opts = await p.$$eval(row + ' select option', o => o.map(x => x.textContent));
    assert.deepEqual(opts, ['', 'Fri 11-27-26', 'Sat 11-28-26', 'Not running'], 'only days the route does not already run, and Not running');
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'routeweek-holiday-1536.png') });
    await p.selectOption(row + ' select', 'fri');
    const cell = (id, day) => '#rows tr[data-id="' + WEEK + '_' + id + '"] button[data-day="' + day + '"]';
    await p.waitForFunction((s) => document.querySelector(s).classList.contains('over') && document.querySelector(s).textContent.includes('RUNS'), cell('hol_0', 'fri'), { timeout: 8000 });
    await p.waitForFunction(() => document.getElementById('hol-head').textContent.endsWith('2 left'), null, { timeout: 8000 });
    assert.equal(await p.textContent(cell('hol_0', 'thu')), 'OFF');
    assert.equal(await p.$eval(row, x => x.className), 'done');
    assert.equal(await p.$eval(row + ' select', s => s.value), 'fri');
    await p.waitForFunction(() => document.getElementById('reason').value === 'Thanksgiving', null, { timeout: 8000 });
    const saved = (await d.collection('runs').doc(WEEK + '_hol_0').get()).data().days;
    assert.equal(saved.thu.runs, false); assert.equal(saved.fri.runs, true);
    results.push('Move to Fri took 855 off Thursday and onto Friday (saved), and the week reason says Thanksgiving');

    // Changing it to Not running puts Friday back; the blank choice puts the load back on Thursday.
    await p.selectOption(row + ' select', 'off');
    await p.waitForFunction((s) => document.querySelector(s).textContent === 'OFF', cell('hol_0', 'fri'), { timeout: 8000 });
    assert.equal(await p.$eval(row + ' select', s => s.value), 'off');
    await p.selectOption(row + ' select', '');
    await p.waitForFunction((s) => document.querySelector(s).classList.contains('hol-need'), cell('hol_0', 'thu'), { timeout: 8000 });
    // The heading counts after the Thursday cell is redrawn, so wait for it rather than read it at once.
    await p.waitForFunction(() => document.getElementById('hol-head').textContent.endsWith('3 left'), null, { timeout: 8000 });
    assert.equal(await p.textContent('#hol-head'), 'Move Thanksgiving loads to · 3 left');
    results.push('Not running took Friday back off; the blank choice put 855 back on Thursday');

    // A week with no holiday looks as before.
    await p.click('#prev');
    await p.waitForFunction(() => document.getElementById('week-label').textContent === 'Week of 11-15-26');
    assert.equal(await p.isHidden('#hol-pick-box'), true);
    assert.equal(await p.isVisible('#rw-filter'), true);
    assert.equal(await p.$$eval('#heads th.hol', x => x.length), 0);
    results.push('A week with no holiday has no Holiday drop-down and keeps All Routes / Changed Only');
    assert.deepEqual(p.errors, []);
    await p.close();
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('ok - ' + r));
})().catch(err => { console.error(err); process.exit(1); });

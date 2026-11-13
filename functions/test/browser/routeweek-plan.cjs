'use strict';
/*
 * Browser check of planning a holiday week ahead on Holiday Week Override (Joe 11-12-26: "I want to predetermine what the holiday
 * week's going to run like. So I need to be able to switch it forward, and it actually has to know what holiday is"). The arrows
 * go past the Live Next week; a week after it shows Route Master's runs, names its holiday, suggests a day for each holiday load,
 * and every change is saved to that week's plan only (weekPlans), never to a Live week's runs.
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
const NEXT = '2026-11-15', PLANNED = '2026-11-22'; // Thanksgiving is Thursday 11-26-26, the day after it Friday 11-27-26
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
  for (const x of (await d.collection('routes').get()).docs) await x.ref.delete();
  for (let i = 0; i < ROWS.length; i++) {
    const [route, run, pat] = ROWS[i], id = 'plan_' + i, days = {}, normal = {};
    DAYS.forEach((p, j) => { days[p] = { runs: pat[j] === '1' }; normal[p] = { active: pat[j] === '1', dispatchTime: 240 }; });
    await d.collection('routes').doc(id).set({ id, route, run, weekOrder: i, displayWeekly: true, displayDaily: true, days: normal });
    await d.collection('runs').doc(NEXT + '_' + id).set({ weekStart: NEXT, route, run, routeId: id, runId: id, weekOrder: i, rev: 1, days });
  }
  for (const w of ['2026-11-01', '2026-11-08', NEXT]) await d.collection('weeks').doc(w).set({ weekStart: w });
  await d.collection('config').doc('app').set({ liveWeeks: { previous: '2026-11-01', current: '2026-11-08', next: NEXT } }, { merge: true });
  const nextBefore = (await d.collection('runs').where('weekStart', '==', NEXT).get()).docs.map(x => x.data());

  const browser = await chromium.launch();
  const results = [];
  try {
    const p = await openPage(browser, 1536, 790, '/routeweek.html?week=' + NEXT + '&testEmail=manager.test@uniteddairy.com');
    await p.waitForFunction(() => document.getElementById('week-label').textContent === 'Week of 11-15-26');
    assert.equal(await p.isEnabled('#next'), true, 'the arrow goes past the Live Next week');
    // The next holiday from today (whatever day the check runs), one click to its week.
    if (await p.isVisible('#next-hol')) assert.match(await p.textContent('#next-hol'), /^Next holiday: .+ · [A-Z][a-z]{2} \d{1,2}-\d{1,2}-\d{2}$/);
    await p.click('#next');
    await p.waitForFunction(() => document.getElementById('week-label').textContent === 'Week of 11-22-26');
    await p.waitForSelector('#hol-list select:not([disabled])');
    assert.equal(await p.textContent('#week-kind'), 'Planned ahead: used when this week is built');
    assert.equal(await p.$eval('#hol-pick', s => s.selectedOptions[0].textContent), 'Thanksgiving · Thu 11-26-26', 'the planned week knows its holiday');
    assert.equal(await p.$eval('#heads th.hol', th => th.textContent.startsWith('HolidayTHU')), true, 'Thursday is marked Holiday');
    assert.equal(await p.textContent('#hol-head'), 'Move Thanksgiving loads to · 3 left');
    results.push('The arrow steps past Next to 11-22-26, which says Planned ahead and names Thanksgiving on Thursday');

    // The suggested day: the nearest day the route does not run, the day before first, never the day after Thanksgiving.
    const tip = (i) => p.$eval('#hol-list [data-id="' + PLANNED + '__plan_' + i + '"] .rw-tip', x => x.textContent);
    assert.deepEqual([await tip(0), await tip(1), await tip(2)], ['Suggested: Sat 11-28-26', 'Suggested: Wed 11-25-26', 'Suggested: Sun 11-22-26']);
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'routeweek-plan-1536.png') });
    await p.click('#hol-suggest');
    await p.waitForFunction(() => document.getElementById('hol-head').textContent.endsWith('all moved'), null, { timeout: 15000 });
    const cell = (i, day) => '#rows tr[data-id="' + PLANNED + '__plan_' + i + '"] button[data-day="' + day + '"]';
    assert.equal(await p.textContent(cell(1, 'wed')), '✓ RUNS');
    assert.equal(await p.$eval(cell(1, 'wed'), b => b.classList.contains('over')), true);
    assert.equal(await p.textContent(cell(1, 'thu')), 'OFF');
    await p.waitForFunction(() => document.getElementById('reason').value === 'Thanksgiving', null, { timeout: 8000 });
    // The moves save one after another; wait for the last one to land.
    const want = { plan_0: { thu: false, sat: true }, plan_1: { thu: false, wed: true }, plan_2: { thu: false, sun: true } };
    let saved = null;
    for (let k = 0; k < 60; k++) {
      const s = await d.collection('weekPlans').doc(PLANNED).get(); saved = s.exists ? s.data() : null;
      if (saved && saved.overrideReason && require('util').isDeepStrictEqual(saved.days, want)) break;
      await new Promise(r => setTimeout(r, 250));
    }
    assert.deepEqual(saved.days, want);
    assert.equal(saved.overrideReason, 'Thanksgiving');
    results.push('Use Suggested Moves moved the 3 Thanksgiving loads to Sat, Wed and Sun, saved in the week\'s plan with the reason');

    // Nothing else changed: no runs for the planned week, the Next week as it was.
    assert.equal((await d.collection('runs').where('weekStart', '==', PLANNED).get()).size, 0);
    assert.deepEqual((await d.collection('runs').where('weekStart', '==', NEXT).get()).docs.map(x => x.data()), nextBefore);
    results.push('No Live week changed: the planned week has no runs yet and next week is untouched');

    // A click on a day changes the plan too, and the plan is there after a reload.
    await p.click(cell(3, 'sun'));
    await p.waitForFunction((s) => document.querySelector(s).textContent.includes('RUNS'), cell(3, 'sun'));
    await p.waitForTimeout(800);
    await p.goto(HOSTING + '/routeweek.html?week=' + PLANNED + '&testEmail=manager.test@uniteddairy.com');
    await p.waitForFunction((s) => { const b = document.querySelector(s); return b && b.textContent.includes('RUNS') && b.classList.contains('over'); }, cell(3, 'sun'), { timeout: 10000 });
    assert.equal(await p.textContent(cell(0, 'sat')), '✓ RUNS');
    results.push('A clicked day saves to the plan and is still there after a reload');

    // Joe 11-13-26: Weekly Dispatch's look at that week shows the plan.
    await p.goto(HOSTING + '/weekly.html?week=' + PLANNED + '&testEmail=manager.test@uniteddairy.com');
    await p.waitForFunction(() => /with its Holiday Week Override plan \(Thanksgiving\)/.test(document.getElementById('wk-note').textContent), null, { timeout: 15000 });
    results.push('Weekly Dispatch shows the planned week with its Holiday Week Override plan');
    assert.deepEqual(p.errors, []);
    await p.close();
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('ok - ' + r));
})().catch(err => { console.error(err); process.exit(1); });

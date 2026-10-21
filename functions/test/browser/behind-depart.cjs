'use strict';
/*
 * Behind is measured from when a route leaves, not from the loadout day (Joe 10/11). Saturday 10/10's loadout carries Monday
 * 10/12's routes; at 12:27 AM Sunday none of them is behind (the evening ones leave Sunday evening, the rest after midnight, Joe 10/19). Manager Center's report
 * preview and the Loadout Center's Behind count agree. Pictures go to SHOTS_DIR.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear, runDaysSettled } = require('../emulator/helpers');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR || '';
const SHOT_NAME = process.env.SHOT_NAME || 'behind-depart';
const MANAGER = 'testEmail=manager.test@uniteddairy.com';

async function openPage(browser, url, when) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
  });
  await page.clock.install({ time: new Date(when) });
  await page.clock.resume();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(HOSTING + url);
  page.errors = errors;
  return page;
}

(async () => {
  await clear();
  const d = db();
  // The Users list the test sign-in reads.
  const { runTransfer } = require('../../src/transfer');
  const F = require('../fixtures/fake-sheets');
  const PD = require('../fixtures/plant-demo');
  await runTransfer({ db: d, reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date('2026-10-08T14:00:00Z') });
  for (const r of (await d.collection('runs').get()).docs) await r.ref.delete();
  // Monday 10/12 routes, loaded Saturday 10/10 (load day offset -2), as on the Live sheet.
  const loads = [['971', 'PAINTSVILLE', 0], ['880', 'VENTURA', 120], ['844', 'OH PROCESSORS', 1080], ['950', 'ALDI', 1380]];
  for (const [i, [route, run, time]] of loads.entries()) {
    await d.collection('runs').doc('2026-10-11__sat' + route).set({ weekStart: '2026-10-11', sheetRow: 900 + i, route, run, routeId: 'rte_s' + route, runId: 'run_s' + route, active: true, loadType: 'CASE LOADOUT',
      days: { mon: { runs: true, loadDayOffset: -2, loadDate: '2026-10-10', deliveryDate: '2026-10-12', dispatchTime: time, loadSequence: i + 1 } } });
  }
  await runDaysSettled(d);
  const browser = await chromium.launch();
  const results = [];
  try {
    // 12:27 AM Sunday 10/11 (the operating day is still Saturday until 6 AM).
    const early = await openPage(browser, '/manager.html?' + MANAGER, '2026-10-11T04:27:00Z');
    await early.waitForFunction(() => /Plant Update/.test(document.getElementById('pv-subject').textContent) && /of 4/.test(document.getElementById('pv-subject').parentNode.textContent + document.body.textContent));
    if (SHOTS) await early.screenshot({ path: path.join(SHOTS, SHOT_NAME + '-1920.png'), scale: 'css' });
    const subject = await early.textContent('#pv-subject');
    console.log('SUBJECT ' + subject);
    if (!process.env.SHOT_ONLY) {
      assert.match(subject, /All routes on time/);
      const lo = await openPage(browser, '/loadout.html?' + MANAGER, '2026-10-11T04:27:00Z');
      await lo.waitForSelector('#rows tr[data-row]');
      await lo.waitForFunction(() => /4 of 4 loaded|0 of 4/.test(document.getElementById('strip').textContent));
      if (SHOTS) await lo.screenshot({ path: path.join(SHOTS, SHOT_NAME + '-loadout-1920.png'), scale: 'css' });
      assert.match(await lo.textContent('#strip'), /Behind 0/);
      results.push('12:27 AM Sunday: the Saturday loadout for Monday is on time on Manager Center and the Loadout Center');
      // Joe 10/19: the day rolls at 6 a.m., so 844 (6:00 PM) and 950 (11:00 PM) leave Sunday evening and 971 (12:00 AM) and
      // 880 (2:00 AM) after midnight Monday. Joe 10/20: after the 6 a.m. roll they are left over from Saturday's shift and all
      // leave before Sunday's shift ends, so all four are behind on Sunday at 6:40 PM and still at 12:46 AM Monday.
      const sunday = await openPage(browser, '/manager.html?' + MANAGER, '2026-10-11T22:40:00Z');
      await sunday.waitForFunction(() => /Plant Update/.test(document.getElementById('pv-subject').textContent));
      await sunday.waitForFunction(() => /4 routes behind/.test(document.getElementById('pv-subject').textContent), null, { timeout: 8000 });
      assert.match(await sunday.textContent('body'), /left over from Sat 10-10-26/);
      await sunday.close();
      const later = await openPage(browser, '/manager.html?' + MANAGER, '2026-10-12T04:46:10Z');
      await later.waitForFunction(() => /4 routes behind/.test(document.getElementById('pv-subject').textContent), null, { timeout: 8000 });
      assert.match(await later.textContent('body'), /971[\s\S]*BEHIND/);
      results.push('Sunday 6:40 PM and Monday 12:46 AM: the four Saturday loads still open are left over and leave before Sunday\'s shift ends, so all are behind');
      // Joe 10/19 ("look into the route setup"): the Route Editor's Departure Day decides. Tuesday 10/20's loads made Monday:
      // Jersey (Load Day, 1:00 PM) leaves Monday; 901 (7:00 AM), 907 (9:00 AM) and 827 (1:00 AM) are Delivery Day, Tuesday.
      // 2:57 PM Monday: only Jersey is behind, on Manager Center and the Loadout Center.
      const tue = [['852', 'JERSEY LOAD 1', 780, 'Load Day'], ['901', 'PRODUCT 1', 420, 'Delivery Day'], ['907', 'FAIRMONT TRANSFER', 540, 'Delivery Day'], ['827', 'UT WALMART', 60, 'Delivery Day']];
      for (const [i, [route, run, time, leavesOn]] of tue.entries()) {
        await d.collection('runs').doc('2026-10-18__tue' + route).set({ weekStart: '2026-10-18', sheetRow: 950 + i, route, run, routeId: 'rte_t' + route, runId: 'run_t' + route, active: true, loadType: 'CASE LOADOUT',
          masterShow: { daily: true, mobile: null, loadType: 'Case Loadout', leavesOn },
          days: { tue: { runs: true, loadDayOffset: -1, loadDate: '2026-10-19', deliveryDate: '2026-10-20', departureDate: '2026-10-20', dispatchTime: time, loadSequence: i + 1 } } });
      }
      const monday = await openPage(browser, '/manager.html?' + MANAGER, '2026-10-19T18:57:00Z');
      await monday.waitForFunction(() => /1 route behind/i.test(document.getElementById('pv-subject').textContent), null, { timeout: 8000 });
      assert.match(await monday.textContent('body'), /852[\s\S]*BEHIND/);
      const lo2 = await openPage(browser, '/loadout.html?' + MANAGER, '2026-10-19T18:57:00Z');
      await lo2.waitForSelector('#rows tr[data-row]');
      await lo2.waitForFunction(() => /Behind 1\b/.test(document.getElementById('strip').textContent), null, { timeout: 8000 });
      results.push('Monday 2:57 PM: Jersey (Load Day) is behind; 901, 907 and 827 (Delivery Day) leave Tuesday and are not');
      for (const p of [early, lo, later, monday, lo2]) assert.deepEqual(p.errors, []);
    }
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('BEHIND ' + r));
})().catch(e => { console.error(e); process.exit(1); });

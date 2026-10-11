'use strict';
/*
 * Behind is measured from when a route leaves, not from the loadout day (Joe 10/11). Saturday 10/10's loadout carries Monday
 * 10/12's routes; at 12:27 AM Sunday none of them is behind (they leave Monday). Manager Center's report
 * preview and the Loadout Center's Behind count agree. Pictures go to SHOTS_DIR.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');

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
      // 7:00 PM Sunday: still none (they leave Monday). 12:40 AM Monday: 971 (12:00 AM Monday) is behind; 880 (2:00 AM) is not yet.
      const sunday = await openPage(browser, '/manager.html?' + MANAGER, '2026-10-11T23:00:00Z');
      await sunday.waitForFunction(() => /Plant Update/.test(document.getElementById('pv-subject').textContent));
      await sunday.waitForTimeout(1500);
      assert.match(await sunday.textContent('#pv-subject'), /All routes on time/);
      await sunday.close();
      const later = await openPage(browser, '/manager.html?' + MANAGER, '2026-10-12T04:46:10Z');
      await later.waitForFunction(() => /1 route behind/.test(document.getElementById('pv-subject').textContent), null, { timeout: 8000 });
      assert.match(await later.textContent('body'), /971[\s\S]*BEHIND/);
      results.push('Sunday 7:00 PM none is behind; Monday 12:46 AM only 971 (46 minutes past; 45 is not behind) (departs 12:00 AM Monday) is');
      for (const p of [early, lo, later]) assert.deepEqual(p.errors, []);
    }
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('BEHIND ' + r));
})().catch(e => { console.error(e); process.exit(1); });

'use strict';
/*
 * Audit batch 1 (Joe 10/22, "ah"): every screen agrees on when a load leaves. The Loadout Center, Manager Center, Plant
 * Departments and Yard Checks use the same rule as the Late Forecast (plant-rules.js departWall): the route's Departure Day picks
 * the date, and a Load Day time before the 6 a.m. roll is the next morning (Joe 10/21).
 *
 * Monday 10/19, 11:00 PM. Tuesday's Sun Valley 849 (Load Day, 4:00 AM, not loaded yet) leaves Tuesday 4:00 AM, so it is not
 * behind. Tuesday's Charleston Transfer 950 (Delivery Day, 10:00 PM) was loaded Monday on T-950 and leaves Tuesday 10:00 PM, so it
 * stays on the Active Yard Queue. Pictures go to SHOTS_DIR (SHOT_NAME prefix); BEFORE=1 only takes pictures, for the old code.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear, runDaysSettled } = require('../emulator/helpers');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR || '';
const NAME = process.env.SHOT_NAME || 'leave-same';
const BEFORE = process.env.BEFORE === '1';
const MANAGER = 'testEmail=manager.test@uniteddairy.com';
const NOW = '2026-10-20T03:00:00Z'; // Monday 10/19, 11:00 PM in New York

async function openPage(browser, url, width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
  });
  await page.clock.install({ time: new Date(NOW) });
  await page.clock.resume();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(HOSTING + url);
  page.errors = errors;
  return page;
}
const shot = (page, what, w) => SHOTS ? page.screenshot({ path: path.join(SHOTS, NAME + '-' + what + '-' + w + '.png'), scale: 'css' }) : null;

(async () => {
  await clear();
  const d = db();
  const { runTransfer } = require('../../src/transfer');
  const F = require('../fixtures/fake-sheets');
  const PD = require('../fixtures/plant-demo');
  await runTransfer({ db: d, reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date('2026-10-08T14:00:00Z') });
  for (const r of (await d.collection('runs').get()).docs) await r.ref.delete();
  const run = (route, runName, leavesOn, day, i) => d.collection('runs').doc('2026-10-18__same' + route).set({ weekStart: '2026-10-18', sheetRow: 960 + i, route, run: runName,
    routeId: 'rte_same' + route, runId: 'run_same' + route, active: true, loadType: 'CASE LOADOUT', masterShow: { daily: true, mobile: null, loadType: 'Case Loadout', leavesOn },
    days: { tue: Object.assign({ runs: true, loadDayOffset: -1, loadDate: '2026-10-19', deliveryDate: '2026-10-20', departureDate: '2026-10-20', loadSequence: i + 1 }, day) } });
  await run('849', 'SUN VALLEY', 'Load Day', { dispatchTime: 240, cases: '900' }, 0);
  await run('950', 'CHARLESTON TRANSFER', 'Delivery Day', { dispatchTime: 1320, trailer: 'T-950', loadStatus: 'COMPLETE', completeTime: '2026-10-20T00:30:00Z', cases: '1,100' }, 1);
  await runDaysSettled(d);
  const browser = await chromium.launch();
  const seen = [];
  try {
    for (const [w, h] of [[1536, 790], [1920, 1080]]) {
      const lo = await openPage(browser, '/loadout.html?' + MANAGER, w, h);
      await lo.waitForSelector('#rows tr[data-row]');
      await lo.waitForFunction(() => /Behind \d/.test(document.getElementById('strip').textContent));
      await lo.waitForTimeout(600);
      await shot(lo, 'loadout', w);
      const strip = (await lo.textContent('#strip')).replace(/\s+/g, ' ');
      seen.push(w + ' Loadout Center: ' + strip);
      if (!BEFORE) assert.match(strip, /Behind 0\b/, 'Sun Valley 849 leaves Tuesday 4:00 AM, so it is not behind at 11 PM Monday');

      const mc = await openPage(browser, '/manager.html?' + MANAGER, w, h);
      await mc.waitForFunction(() => /Plant Update/.test((document.getElementById('pv-subject') || {}).textContent || ''));
      await mc.waitForTimeout(800);
      await shot(mc, 'manager', w);
      const body = (await mc.textContent('body')).replace(/\s+/g, ' ');
      seen.push(w + ' Manager Center: ' + (await mc.textContent('#pv-subject')) + ' | behind shown: ' + /\bBEHIND\b/.test(body));
      if (!BEFORE) assert.match(await mc.textContent('#pv-subject'), /All routes on time/);

      const yd = await openPage(browser, '/yard.html?' + MANAGER, w, h);
      await yd.waitForFunction(() => document.getElementById('hstats') && /\d/.test(document.getElementById('hstats').textContent));
      await yd.waitForTimeout(800);
      await shot(yd, 'yard', w);
      const trailers = await yd.$$eval('#rows tr[data-trailer]', r => r.map(x => x.dataset.trailer));
      seen.push(w + ' Yard Checks Active Yard Queue: ' + (trailers.join(', ') || 'empty'));
      if (!BEFORE) assert.deepEqual(trailers, ['T-950'], 'Charleston Transfer leaves Tuesday 10:00 PM, so T-950 is still on the yard Monday night');
      for (const p of [lo, mc, yd]) { assert.deepEqual(p.errors, []); await p.close(); }
    }
  } finally {
    await browser.close();
  }
  seen.forEach(s => console.log('LEAVE ' + s));
})().catch(e => { console.error(e); process.exit(1); });

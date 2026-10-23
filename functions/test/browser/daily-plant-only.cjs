'use strict';
/*
 * Browser check (Joe 10/23, 849 Sun Valley Friday: "if it is on my weekly dispatch or daily dispatch, it's allowed to be visible
 * ... no matter who is running it"): a Plant Scheduler load for a day its run does not run shows on Daily Dispatch on its loadout
 * day, at 1536 and 1920 wide: a United Dairy load as PLANT LOAD - NEEDS DRIVER, a carrier's pickup as CARRIER. Pressing NO RUN
 * on the carrier's line turns the day on with CARRIER as its driver. Pictures go to SHOTS_DIR.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { clear, db } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const F = require('../fixtures/fake-sheets');
const L = require('../../src/logic');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR;
const DATE = '2026-10-05', DATE2 = '2026-10-07';

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
  const runs = (await db().collection('runs').get()).docs.map(d => Object.assign({ id: d.id }, d.data()));
  const runIdOf = (r) => runs.find(x => x.id === r.runDocId).runId;
  // 810 does not run Tuesday (loaded Monday 10/5); 802 does not run Thursday (loaded Wednesday 10/7).
  const plantRow = L.notRunningRows(runs, DATE).find(r => runIdOf(r) === 'run_t810'), pickupRow = L.notRunningRows(runs, DATE2).find(r => runIdOf(r) === 'run_t802');
  assert.ok(plantRow && pickupRow, 'the made-up days have runs that do not run');
  // A United Dairy load on the Scheduler (plantLoads) and a carrier's pickup (the Scheduler's own record) for those days.
  await db().collection('plantLoads').doc('SCHED-test-ud').set({ runId: runIdOf(plantRow), route: plantRow.route, run: plantRow.run, date: plantRow.deliveryDate, status: 'SCHEDULED', pickupTime: '16:00', trailer: 'T-10295' });
  const pickupRun = runs.find(x => x.id === pickupRow.runDocId);
  await db().collection('plantJournal').doc('PLANT_SCHEDULE_app_test_pickup').set({ recordId: 'test_pickup', type: 'PLANT_SCHEDULE', date: pickupRow.deliveryDate, status: 'SCHEDULED',
    routeId: pickupRun.routeId, runId: pickupRun.runId, route: pickupRun.route, run: pickupRun.run, area: 'SCHEDULER', createdInApp: true, recordedAt: '2026-10-04T12:00:00Z',
    payload: { scheduleType: 'CARRIER', carrier: true, pickupTime: '16:00', poNumber: '46020', trailer: 'T-922' } });
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const [w, h] of [[1536, 790], [1920, 1080]]) {
      const line = (r) => '#rows tr[data-id="' + r.id + '"]';
      const q = await openPage(browser, w, h, '/daily.html?date=' + DATE + '&testEmail=dispatch.test@uniteddairy.com');
      await q.waitForSelector(line(plantRow) + '.plant-only', { timeout: 15000 });
      assert.match(await q.textContent(line(plantRow) + ' td:nth-child(4)'), /PLANT LOAD/);
      assert.match(await q.textContent(line(plantRow)), /T-10295/);
      assert.equal(await q.$$eval('#rows tr.plant-only', t => t.length), 1, 'a run on two lines shows its load once');
      if (SHOTS) await q.screenshot({ path: path.join(SHOTS, 'daily-plant-load-' + w + '.png') });
      assert.deepEqual(q.errors, []);
      await q.close();
      const p = await openPage(browser, w, h, '/daily.html?date=' + DATE2 + '&testEmail=dispatch.test@uniteddairy.com');
      await p.waitForSelector(line(pickupRow) + '.plant-only', { timeout: 15000 });
      assert.equal((await p.textContent(line(pickupRow) + ' td:nth-child(4)')).trim(), 'CARRIER');
      assert.match(await p.textContent(line(pickupRow)), /T-922/);
      assert.match(await p.getAttribute(line(pickupRow), 'title'), /PO 46020/);
      if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'daily-plant-only-' + w + '.png') });
      assert.deepEqual(p.errors, []);
      if (w === 1920) {
        await p.click(line(pickupRow) + ' [data-runs]');
        await p.waitForFunction((sel) => { const tr = document.querySelector(sel); return tr && !tr.classList.contains('plant-only') && !tr.classList.contains('off'); }, line(pickupRow), { timeout: 10000 });
        await p.waitForFunction((sel) => document.querySelector(sel + ' td:nth-child(4)').textContent.trim() === 'CARRIER', line(pickupRow), { timeout: 10000 });
        let saved = {};
        for (let i = 0; i < 50 && !(saved.runs === true && saved.driver === 'CARRIER'); i++) {
          await new Promise(r => setTimeout(r, 200));
          saved = (await db().collection('runs').doc(pickupRow.runDocId).get()).data().days[pickupRow.day];
        }
        assert.deepEqual([saved.runs, saved.driver], [true, 'CARRIER'], 'saved as running, driver CARRIER');
      }
      await p.close();
    }
    results.push('Daily Dispatch: a Scheduler load on a day its run does not run shows (PLANT LOAD for United Dairy, CARRIER for a carrier pickup) at 1536 and 1920; RUNS turns the pickup on as CARRIER');
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('DAILY PLANT ONLY ' + r));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });

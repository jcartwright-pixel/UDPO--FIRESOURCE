'use strict';
/*
 * Driver Scorecard on Verizon Connect Fleet GPS (Joe 10/13): made-up October dispatch runs, GPS days and alerts are written to
 * the local test database, then the scorecard is opened at Joe's 1536 and at 1920. It checks the alerts land on the driver
 * Daily Dispatch put in each truck, that an alert on a truck nobody was dispatched in shows under "No driver dispatched",
 * the Week view, the GPS weights on Settings, and that the table fits across with 16px text. Pictures go to SHOTS_DIR when set.
 * BEFORE=1 only writes the sample data and takes the pictures (used for the "before" pictures of the old screen).
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const F = require('../fixtures/fake-sheets');

const HOSTING = process.argv[2] || 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR || '';
const BEFORE = !!process.env.BEFORE;

async function openPage(browser, width, height, url) {
  const page = await browser.newPage({ viewport: { width, height }, serviceWorkers: 'block' });
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
  });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(HOSTING + url);
  page.errors = errors;
  return page;
}

// Sample drivers in their usual trucks. 229001 is a Fleet unit nobody is dispatched in.
const CREW = [
  { id: 'drv_s_adams', name: 'HALL, PAT', route: '855', truck: '223893' },
  { id: 'drv_s_baker', name: 'KING, LEE', route: '856', truck: '223894' },
  { id: 'drv_s_cole', name: 'LANE, SAM', route: '857', truck: '223895' },
  { id: 'drv_s_diaz', name: 'DIAZ, RAY', route: '858', truck: '223896' },
  { id: 'drv_s_evans', name: 'EVANS, JO', route: '859', truck: '223897' },
  { id: 'drv_s_fox', name: 'FOX, KIM', route: '860', truck: '223898' }
];
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const addDays = (key, n) => { const d = new Date(key + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const WORK = []; for (let d = '2026-10-01'; d <= '2026-10-12'; d = addDays(d, 1)) if (new Date(d + 'T12:00:00Z').getUTCDay() !== 0) WORK.push(d);
const weekOf = (key) => addDays(key, -new Date(key + 'T12:00:00Z').getUTCDay());
const iso = (date, hh, mm) => new Date(date + 'T' + String(hh + 4).padStart(2, '0') + ':' + String(mm).padStart(2, '0') + ':00Z').toISOString(); // EDT

async function seed(d) {
  const runs = {}, b = d.batch();
  CREW.forEach((c, i) => WORK.forEach((date, j) => {
    const ws = weekOf(date), id = ws + '__sample_' + c.route, r = runs[id] || (runs[id] = { runId: 'sample_' + c.route, route: c.route, run: 'DAY', weekStart: ws, days: {} });
    const missed = (i === 3 && j % 4 === 1) || (i === 5 && j === 2);
    r.days[DAYS[new Date(date + 'T12:00:00Z').getUTCDay()]] = { runs: true, driver: c.name, driverId: c.id, truck: c.truck, startTime: '05:00',
      casesOut: 600, plantCaseReturn: i === 4 && j === 5 ? 594 : 600, checkinCompletedAt: missed ? '' : iso(date, 5, 2) };
    b.set(d.collection('plantEvents').doc('sample_dvir_' + c.route + '_' + date), { type: 'DVIR', date, route: c.route, run: 'DAY', defect: i === 2 && j === 3 });
    b.set(d.collection('gpsDays').doc(date + '_' + c.truck), { tag: c.truck, date, miles: 160 + i * 9 + (j % 3) * 4, firstMove: iso(date, 5, 30 + i * 3), lastMove: iso(date, 14, 10 + i * 6),
      yardOut: iso(date, 5, 34 + i * 3), yardIn: iso(date, 14, 5 + i * 6), fuelGallons: Math.round((160 + i * 9) / (6.6 + (i % 3) * 0.4)) });
  }));
  Object.keys(runs).forEach(id => b.set(d.collection('runs').doc(id), runs[id]));
  const alert = (date, tag, hh, mm, type, extra) => b.set(d.collection('gpsAlerts').doc('sample_' + date + '_' + tag + '_' + hh + mm + '_' + type), Object.assign({ date, tag, at: iso(date, hh, mm), type }, extra || {}));
  alert('2026-10-02', '223896', 9, 14, 'SPEEDING', { speedMph: 71, limitMph: 55, place: 'US-40 W' });
  alert('2026-10-06', '223896', 10, 2, 'SPEEDING', { speedMph: 68, limitMph: 55 });
  alert('2026-10-06', '223896', 10, 40, 'HARSH_BRAKING');
  alert('2026-10-08', '223896', 11, 15, 'HARSH_BRAKING');
  alert('2026-10-07', '223894', 8, 5, 'HARSH_BRAKING');
  alert('2026-10-09', '223894', 12, 30, 'IDLE', { minutes: 28 });
  alert('2026-10-05', '223898', 7, 45, 'HARSH_ACCEL');
  alert('2026-10-08', '229001', 13, 20, 'SPEEDING', { speedMph: 66, limitMph: 45 });
  alert('2026-10-08', '229001', 13, 31, 'HARSH_BRAKING');
  await b.commit();
}

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: () => new Date('2026-10-09T12:00:00Z') });
  await seed(db());
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const [w, h] of [[1536, 760], [1920, 950]]) {
      const sc = await openPage(browser, w, h, '/scorecard.html?month=2026-10&testEmail=manager.test@uniteddairy.com');
      await sc.waitForSelector('.sc-board tr[data-key]');
      await sc.waitForTimeout(800);
      if (SHOTS) await sc.screenshot({ path: path.join(SHOTS, (BEFORE ? 'before' : 'after') + '-month-' + w + '.png') });
      if (BEFORE) { await sc.close(); continue; }
      // Joe 10/13 (later): the driver alone, one grade per area we score, then the overall score.
      assert.deepEqual(await sc.$$eval('table.sc-board thead th', t => t.map(x => x.textContent.trim())),
        ['#', 'Driver', 'Check-in', 'Cases', 'Inspections', 'Attendance', 'Speeding', 'Hard Stops', 'Idling', 'Overall']);
      const ray = await sc.$eval('tr[data-key="DRV_S_DIAZ"]', tr => [...tr.cells].map(c => c.textContent.trim()));
      assert.equal(ray[1], 'DIAZ, RAY', 'no truck or route on the board');
      assert.deepEqual(ray.slice(2), ['B', 'A', 'A', 'A', 'A', 'A', 'A', '80 C'], 'check-in 88 (B), speeding 96 and hard stops 96 (A), overall 80 (C)');
      assert.match(await sc.textContent('#unassigned'), /No driver dispatched[\s\S]*10-8-26\s*229001\s*Speeding \(66 mph in a 45/, 'the alert on a truck with no driver is kept for a manager');
      const fit = await sc.evaluate(() => ({ table: document.querySelector('.sc-board').scrollWidth, box: document.querySelector('#sheet').clientWidth,
        small: [...document.querySelectorAll('.sc-board td, .sc-board th, .sc-board small')].filter(e => e.offsetParent && parseFloat(getComputedStyle(e).fontSize) < 16).length }));
      assert.ok(fit.table <= fit.box + 1, 'the table fits across at ' + w + ': ' + JSON.stringify(fit));
      assert.equal(fit.small, 0, 'no text under 16px');
      assert.equal(await sc.$eval('.sc-board thead th', th => getComputedStyle(th).position), 'sticky', 'the table header stays at the top');
      // A driver's misses list each alert with its points.
      await sc.click('tr[data-key="DRV_S_DIAZ"]');
      await sc.waitForSelector('tr.sc-misses');
      assert.match(await sc.textContent('tr.sc-misses'), /Speeding \(71 mph in a 55, 9:14 AM, truck 223896, US-40 W\)\s*−2/);
      assert.match(await sc.textContent('.sc-facts'), /Truck 223896 · Route 858[\s\S]*2 speeding, 2 hard stops[\s\S]*GPS miles[\s\S]*MPG 6\.8[\s\S]*yard out \d+:\d\d AM, in \d+:\d\d PM/, 'the GPS details are one click away');
      if (SHOTS) await sc.screenshot({ path: path.join(SHOTS, 'after-driver-misses-' + w + '.png') });
      // Week view: Sunday to Saturday.
      await sc.click('.tabs [data-mode="week"]');
      await sc.waitForSelector('.sc-board');
      assert.match(await sc.textContent('.sc-period'), /^Week of \d{1,2}-\d{1,2}-\d\d$/);
      if (w === 1920) {
        await sc.evaluate(() => window.udScWeek && window.udScWeek('2026-10-04'));
        await sc.waitForFunction(() => /10-4-26/.test(document.querySelector('.sc-period').textContent));
        await sc.waitForSelector('tr[data-key="DRV_S_DIAZ"]');
        assert.equal(await sc.textContent('.sc-period'), 'Week of 10-4-26');
        if (SHOTS) await sc.screenshot({ path: path.join(SHOTS, 'after-week-' + w + '.png') });
        await sc.click('.tabs [data-mode="settings"]');
        await sc.waitForSelector('.sc-n[data-k="speeding"]');
        assert.deepEqual(await sc.$$eval('.sc-n[data-k="speeding"], .sc-n[data-k="hardBrake"], .sc-n[data-k="hardAccel"], .sc-n[data-k="idle"], .sc-n[data-k="gpsDayCap"]', l => l.map(x => x.value)), ['2', '2', '1', '1', '10']);
        if (SHOTS) await sc.screenshot({ path: path.join(SHOTS, 'after-settings-' + w + '.png') });
      }
      assert.deepEqual(sc.errors, []);
      await sc.close();
    }
    if (!BEFORE) results.push('Driver Scorecard GPS: alerts on the dispatched driver, No driver dispatched kept, Week view, GPS weights on Settings, fits at 1536 and 1920');
    // With no alerts at all the board says so plainly.
    if (!BEFORE) {
      const all = await db().collection('gpsAlerts').get();
      const b = db().batch(); all.docs.forEach(x => b.delete(x.ref)); await b.commit();
      const sc = await openPage(browser, 1536, 760, '/scorecard.html?month=2026-10&testEmail=manager.test@uniteddairy.com');
      await sc.waitForSelector('.sc-board tr[data-key]');
      await sc.waitForFunction(() => /No GPS alerts received yet/.test((document.querySelector('#gps-note') || {}).textContent || ''));
      if (SHOTS) await sc.screenshot({ path: path.join(SHOTS, 'after-no-alerts-1536.png') });
      assert.deepEqual(sc.errors, []);
      await sc.close();
      results.push('Driver Scorecard GPS: with no alerts it says No GPS alerts received yet');
    }
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('ok - ' + r));
})().catch(e => { console.error(e); process.exit(1); });

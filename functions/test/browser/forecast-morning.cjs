'use strict';
/*
 * Joe 10/21 (7:51 AM): "I see too much red whenever there's only right now potentially one late... the right-hand pane,
 * it's showing everything late. But see, we catch up, so it shouldn't be shaded. All red... tighten our times up."
 * A Wednesday morning like his: last night's Fairmont Transfer left over, Save-A-Lot 1 loading, Sun Valley (Load Day,
 * 4:00 PM: Joe 10/21, the 4:00 AM in Route Master was a typing mistake) and the rest of tonight's loads, with two earlier Wednesdays timed. Pictures go to SHOTS_DIR.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const localCalls = require('./local-calls.cjs');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR || '';
const MANAGER = 'testEmail=manager.test@uniteddairy.com';
const NOW = '2026-10-21T11:51:00Z'; // Wednesday 7:51 AM in New York
const T = (h, m) => h * 60 + (m || 0);
// Tonight's loads in the plant's loading order: [route, run, dispatch, Departure Day, delivers (day key), usual cases].
const TONIGHT = [['856', 'SAVE-A-LOT 2', T(15), 'LOAD DAY', 'wed', 600], ['852', 'JERSEY LOAD 1', T(13), 'LOAD DAY', 'thu', 1150], ['852', 'JERSEY LOAD 2', T(13), 'LOAD DAY', 'thu', 1150],
  ['845', 'I/W BALTIMORE', T(21), 'LOAD DAY', 'thu', 600], ['848', 'I/W COLUMBUS', T(4), 'DELIVERY DAY', 'thu', 800], ['849', 'SUN VALLEY', T(16), 'LOAD DAY', 'thu', 900],
  ['906', 'LANCASTER TRANSFER', T(2), 'DELIVERY DAY', 'thu', 760], ['950_1', 'CHARLESTON TRANSFER', T(22), 'DELIVERY DAY', 'thu', 700], ['825', 'DSD', T(5), 'DELIVERY DAY', 'thu', 190],
  ['827', 'UT WALMART', T(2), 'DELIVERY DAY', 'thu', 1000], ['6304', 'UT WALMART', T(1), 'DELIVERY DAY', 'thu', 990], ['824', 'DSD', T(1), 'DELIVERY DAY', 'thu', 480],
  ['813', 'DSD', T(1, 30), 'DELIVERY DAY', 'thu', 540], ['815', 'DSD', T(3), 'DELIVERY DAY', 'thu', 210], ['8302_2', '8302_2', T(5, 30), 'DELIVERY DAY', 'thu', 400],
  ['8303_1', '8303_1', T(5, 30), 'DELIVERY DAY', 'thu', 900], ['808', 'DSD', T(4), 'DELIVERY DAY', 'thu', 430], ['812', 'DSD', T(5), 'DELIVERY DAY', 'thu', 450],
  ['822', 'DSD', T(4, 30), 'DELIVERY DAY', 'thu', 400], ['6301_1', '6301_1', T(5), 'DELIVERY DAY', 'thu', 1000], ['901_1', 'PRODUCT 1', T(7), 'DELIVERY DAY', 'thu', 900],
  ['909_1', 'MARIETTA LOAD 1', T(6), 'DELIVERY DAY', 'thu', 1040], ['909_2', 'MARIETTA LOAD 2', T(8), 'DELIVERY DAY', 'thu', 980], ['907_1', 'FAIRMONT TRANSFER', T(8), 'DELIVERY DAY', 'thu', 1090]];
// The minutes from one load's End to the next on the two Wednesdays before (as the plant really runs: some quick, some slow).
const GAPS = [[40, 55, 50, 30, 45, 50, 60, 40, 45, 50, 45, 25, 30, 30, 25, 45, 25, 30, 25, 45, 40, 55, 50, 55], [35, 50, 55, 35, 40, 45, 55, 45, 40, 55, 50, 30, 25, 35, 30, 40, 30, 25, 30, 50, 45, 50, 55, 50]];

async function openPage(browser, url, w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, serviceWorkers: 'block' });
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
  });
  await localCalls(page);
  await page.clock.install({ time: new Date(NOW) });
  await page.clock.resume();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.errors = errors;
  await page.goto(HOSTING + url);
  return page;
}

(async () => {
  await clear();
  const d = db();
  const { runTransfer } = require('../../src/transfer');
  const F = require('../fixtures/fake-sheets');
  const PD = require('../fixtures/plant-demo');
  await runTransfer({ db: d, reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date('2026-10-08T14:00:00Z') });
  for (const c of ['runs', 'pickups', 'plantJournal', 'plantReports']) for (const r of (await d.collection(c).get()).docs) await r.ref.delete();
  const run = (id, week, row, route, name, leavesOn, days) => d.collection('runs').doc(id).set({ weekStart: week, sheetRow: row, route, run: name, routeId: 'rte_' + id, runId: 'run_' + id, active: true, loadType: 'Case Loadout', masterShow: { leavesOn }, days });
  // Last night's Fairmont Transfer (loaded Tue for Wed, 8:00 AM) is still to load.
  await run('2026-10-18__p907', '2026-10-18', 5, '907_1', 'FAIRMONT TRANSFER', 'DELIVERY DAY',
    { wed: { runs: true, loadDayOffset: -1, loadDate: '2026-10-20', deliveryDate: '2026-10-21', departureDate: '2026-10-21', dispatchTime: T(8), loadSequence: 80, casesOut: 828 } });
  // Save-A-Lot 1 (8:00 AM today) is loading now.
  await run('2026-10-18__t855', '2026-10-18', 6, '855', 'SAVE-A-LOT 1', 'LOAD DAY',
    { wed: { runs: true, loadDayOffset: 0, loadDate: '2026-10-21', deliveryDate: '2026-10-21', departureDate: '2026-10-21', dispatchTime: T(8), loadSequence: 5, casesOut: 1188, plantStartedAt: '2026-10-21T11:20:00Z', loadStatus: 'LOADING' } });
  let row = 10;
  for (const [i, [route, name, time, leavesOn, key]] of TONIGHT.entries()) {
    const delivery = key === 'wed' ? '2026-10-21' : '2026-10-22';
    await run('2026-10-18__t' + i, '2026-10-18', row++, route, name, leavesOn, { [key]: { runs: true, loadDayOffset: key === 'wed' ? 0 : -1, loadDate: '2026-10-21', deliveryDate: delivery, departureDate: delivery, dispatchTime: time, loadSequence: 10 + i } });
  }
  // The two Wednesdays before: the same loads, one after another from 4:00 PM.
  for (const [n, [week, load, delivery]] of [['2026-10-11', '2026-10-14', '2026-10-15'], ['2026-10-04', '2026-10-07', '2026-10-08']].entries()) {
    let end = Date.parse(load + 'T16:00:00-04:00');
    for (let i = 0; i < TONIGHT.length; i++) {
      const [route, name, time, leavesOn, key, cases] = TONIGHT[i];
      end += GAPS[n][i] * 60000;
      const at = new Date(end).toISOString(), dk = key === 'wed' ? 'wed' : 'thu', dd = key === 'wed' ? load : delivery;
      await run(week + '__h' + i, week, 50 + i, route, name, leavesOn, { [dk]: { runs: true, loadDayOffset: key === 'wed' ? 0 : -1, loadDate: load, deliveryDate: dd, departureDate: dd, dispatchTime: time, loadSequence: 10 + i, casesOut: cases, plantStartedAt: at, completeTime: at, loadStatus: 'COMPLETE' } });
    }
  }
  const browser = await chromium.launch();
  try {
    const fc = await openPage(browser, '/forecast.html?' + MANAGER, 1536, 790);
    await fc.waitForFunction(() => document.querySelectorAll('.fc-row:not(.fc-head)').length === 26, null, { timeout: 30000 });
    await fc.waitForFunction(() => document.querySelectorAll('#times tr').length > 5, null, { timeout: 20000 });
    await fc.waitForTimeout(1500);
    if (SHOTS) await fc.screenshot({ path: path.join(SHOTS, 'forecast-morning-1536.png') });
    const text = await fc.evaluate(() => document.body.innerText);
    // The shift report email's forecast box for the same morning, worked out the way Manager Center does.
    const runs = (await d.collection('runs').get()).docs.map(x => Object.assign({ id: x.id }, x.data()));
    const box = await fc.evaluate(async (runs) => {
      const P = await import('/js/plant-core.js'), U = window.UDPlant, date = '2026-10-21';
      const kept = JSON.parse(localStorage.getItem('udForecastNights') || 'null'), history = kept ? kept.nights : [];
      const f = U.loadForecast({ date, loads: P.loadoutRows(runs, date), history }, Date.now());
      return { late: f.late, behind: f.behind, html: U.reportHtml({ dayLabel: 'Wednesday, October 21, 2026', behind: [], loaded: [], nextUp: [], pickups: [], down: [], lines: [], temperatures: [], areas: [], totalLoads: 0, leftToLoad: 0, forecast: f }, '') };
    }, runs);
    const mail = await browser.newPage({ viewport: { width: 1536, height: 790 } });
    await mail.setContent(box.html);
    if (SHOTS) await mail.screenshot({ path: path.join(SHOTS, 'forecast-email-1536.png') });
    const mailText = await mail.evaluate(() => document.body.innerText);
    fs.writeFileSync(path.join(SHOTS || require('os').tmpdir(), 'forecast-email.txt'), mailText);
    fs.writeFileSync(path.join(SHOTS || require('os').tmpdir(), 'forecast-morning.txt'), text);
    if (process.env.CHECK_AFTER) {
      const rows = await fc.$$eval('.fc-row:not(.fc-head)', r => r.map(x => ({ route: x.querySelector('b').textContent, late: x.classList.contains('late'), text: x.textContent })));
      // Sun Valley (Load Day, 4:00 PM) leaves this afternoon and is loaded before then.
      const sun = rows.find(x => /Sun Valley/.test(x.text));
      assert.equal(sun.late, false, 'Sun Valley is on time');
      assert.match(sun.text, /4:00 PM/);
      // The right pane: a time is red only where a load leaving then is late.
      const times = await fc.$$eval('#times tbody tr', r => r.map(x => ({ bad: x.classList.contains('bad'), text: x.textContent })));
      assert.ok(times.some(t => !t.bad), 'not every due-by time is red');
      assert.ok(times.filter(t => t.bad).every(t => /\d+ late/.test(t.text)));
      assert.ok(times.filter(t => !t.bad).every(t => /On time/.test(t.text)));
      // Joe 10/21: the left-over Fairmont is behind only by its own loading, and says it is left over.
      const fair = rows.find(x => /Fairmont/.test(x.text) && x.late);
      assert.match(fair.text, /left over · (\d+ min|1 h( \d+ min)?)\b/);
      assert.doesNotMatch(fair.text, /3 h 20 min/);
      // The email box: the left-over load counts only its own loading, so "behind" is not hours and hours.
      assert.ok(box.behind <= 120, 'about ' + box.behind + ' min behind');
      // Joe 11/1: the box answers "will every truck be loaded before it leaves?"; no hours behind, no cases.
      assert.match(mailText, /Not every truck will be loaded before it leaves/);
      assert.doesNotMatch(mailText, /About \d+ hr|\bcases\b/i);
      assert.deepEqual(fc.errors, []);
    }
    console.log('forecast-morning: ok');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });

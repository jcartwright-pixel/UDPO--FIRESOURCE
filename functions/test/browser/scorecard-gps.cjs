'use strict';
/*
 * Driver Scorecard on Verizon Connect Fleet GPS (Joe 10/13): made-up October dispatch runs, GPS days and alerts are written to
 * the local test database, then the scorecard is opened at Joe's 1536 and at 1920. It checks the alerts land on the driver
 * Daily Dispatch put in each truck, that an alert on a truck nobody was dispatched in shows under "No driver dispatched",
 * the Week view, the GPS weights on Settings, and that the table fits across with 16px text. Pictures go to SHOTS_DIR when set.
 * Also (Joe 10/13): a tab per area, the Incidents & Complaints list, accidents that count only once reviewed, an excused hard
 * stop, idling on a sleeper route, the kiosk (grades only), and the Driver Roster's Accidents and Complaints columns and entry.
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
      // Time grade: EVANS leaves about half an hour before a 6:15 dispatch; FOX's route is due back by 1:15 PM.
      dispatchTime: i === 4 ? '06:15' : '05:45', routeHours: i === 5 ? 7.5 : 8.5,
      casesOut: 600, plantCaseReturn: i === 4 && j === 5 ? 594 : 600, checkinCompletedAt: missed ? '' : iso(date, 5, 2) };
    b.set(d.collection('plantEvents').doc('sample_dvir_' + c.route + '_' + date), { type: 'DVIR', date, route: c.route, run: 'DAY', defect: i === 2 && j === 3 });
    b.set(d.collection('gpsDays').doc(date + '_' + c.truck), { tag: c.truck, date, miles: 160 + i * 9 + (j % 3) * 4, firstMove: iso(date, 5, 30 + i * 3), lastMove: iso(date, 14, 10 + i * 6),
      yardOut: iso(date, 5, 34 + i * 3), yardIn: iso(date, 14, 5 + i * 6), fuelGallons: Math.round((160 + i * 9) / (6.6 + (i % 3) * 0.4)) });
  }));
  Object.keys(runs).forEach(id => b.set(d.collection('runs').doc(id), runs[id]));
  // Joe 10/14: only Driver Master drivers are graded, so the sample crew is on the driver list; the sample days (10-1 to 10-12)
  // come before the go-live start date, so Scorecard counted from is moved back to 10-1 for them.
  CREW.forEach(c => b.set(d.collection('drivers').doc(c.id), { id: c.id, name: c.name, relief: false, cells: null, seniorityDate: '2020-01-01', days: {} }));
  b.set(d.collection('scorecard').doc('settings'), { countFrom: '2026-10-01' }, { merge: true });
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
  alert('2026-10-08', '229001', 13, 35, 'HARSH_TURN');
  // 229001 is ours (Uniontown, Equipment Master); 551234 is another plant's Fleet unit and stays off No driver dispatched.
  b.set(d.collection('equipment').doc('veh_truck_229001'), { id: 'veh_truck_229001', unit: '229001', type: 'TRUCK', facilityId: 'fac_uniontown', location: 'UNIONTOWN', status: 'ACTIVE' });
  alert('2026-10-08', '551234', 13, 40, 'SPEEDING', { speedMph: 70, limitMph: 45 });
  // Truck cleanliness, rated once this month: HALL's truck spotless (5), DIAZ's dirty (2).
  b.set(d.collection('scorecardRatings').doc('DRV_S_ADAMS_2026-10-09'), { kind: 'cleanliness', driverKey: 'DRV_S_ADAMS', driver: 'HALL, PAT', date: '2026-10-09', rating: 5, truck: '223893', note: '' });
  b.set(d.collection('scorecardRatings').doc('DRV_S_DIAZ_2026-10-09'), { kind: 'cleanliness', driverKey: 'DRV_S_DIAZ', driver: 'DIAZ, RAY', date: '2026-10-09', rating: 2, truck: '223896', note: 'trash in the cab' });
  // Joe 10/13: FOX runs a sleeper route (Route Master "Sleeper"), so his idling counts a quarter.
  b.set(d.collection('routes').doc('sample_860'), { route: '860', run: 'DAY', sleeper: true });
  alert('2026-10-09', '223898', 12, 0, 'IDLE', { minutes: 30 });
  // A manager excused DIAZ's 10-8 hard stop (a deer); it costs nothing.
  const key = ['gps', '2026-10-08', '223896@' + iso('2026-10-08', 11, 15), 'hardBrake'].join('|');
  b.set(d.collection('scorecardExcuses').doc('sample_excuse'), { key, reason: 'Deer in the road', by: 'manager.test@uniteddairy.com', driverKey: 'DRV_S_DIAZ', what: 'Hard stop' });
  // Accidents and complaints: DIAZ's 1st degree accident (reviewed, counts 15); ADAMS (on the Driver Roster) a 2nd degree one
  // that counts and a complaint still under review.
  b.set(d.collection('driverIncidents').doc('sample_diaz_acc'), { kind: 'accident', driverKey: 'DRV_S_DIAZ', driver: 'DIAZ, RAY', date: '2026-09-20', accidentClass: 1, type: 'Backing', truck: '223896', preventable: true, note: '', status: 'counts', enteredBy: 'manager.test@uniteddairy.com', reviewedBy: 'manager.test@uniteddairy.com' });
  b.set(d.collection('driverIncidents').doc('sample_adams_acc'), { kind: 'accident', driverKey: 'DRV_TEST_ADAMS', driver: 'ADAMS, PAT', date: '2026-10-03', accidentClass: 2, type: 'Fixed object', truck: '223893', status: 'counts', enteredBy: 'manager.test@uniteddairy.com' });
  b.set(d.collection('driverIncidents').doc('sample_adams_comp'), { kind: 'complaint', driverKey: 'DRV_TEST_ADAMS', driver: 'ADAMS, PAT', date: '2026-10-05', source: 'customer', customer: 'Kroger 512', severity: 'major', type: 'Late delivery', status: 'review', enteredBy: 'manager.test@uniteddairy.com' });
  // Joe 10/13 PDA: LANE got a written warning (counts at once, 10 points).
  b.set(d.collection('driverIncidents').doc('sample_lane_pda'), { kind: 'pda', driverKey: 'DRV_S_COLE', driver: 'LANE, SAM', date: '2026-10-06', step: 'written', reason: 'Attendance', note: '', status: 'counts', enteredBy: 'manager.test@uniteddairy.com' });
  await b.commit();
}
const AREA_HEADS = ['#', 'Driver', 'Check-in', 'Cases', 'Inspections', 'Attendance', 'Speeding', 'Hard Stops', 'Idling', 'Seatbelt', 'Fuel MPG', 'Time', 'Truck Clean', 'Accidents', 'Complaints', 'PDA', 'Overall'];
const heads = (page, sel) => page.$$eval(sel, t => t.map(x => x.textContent.replace(/\u00ad/g, '').trim()));

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
      assert.deepEqual(await heads(sc, 'table.sc-board thead th'), AREA_HEADS);
      const ray = await sc.$eval('tr[data-key="DRV_S_DIAZ"]', tr => [...tr.cells].map(c => c.textContent.trim()));
      assert.equal(ray[1], 'DIAZ, RAY', 'no truck or route on the board');
      // Joe 10/13 rewards, 10 days: check-in 7 clean, no 5 in a row, 3 missed -12 = -5 -> 70 (D); speeding 8 clean, one
      // streak +2, 2 alerts -4 = 6 -> 92 (B); hard stops: the 10-8 one is excused, so 9 clean + a streak - 2 = 9 -> 98 (A);
      // no seatbelt alerts yet (–); fuel and the rest clean (100). Truck cleanliness 2 of 5 -> 70 (D). A 1st degree accident
      // (reviewed) -15 -> 85 (B); complaints and PDAs none (100). Overall (70+100+100+100+92+98+100+100+100+70+85+100+100)/13 = 93 (A).
      assert.deepEqual(ray.slice(2), ['D', 'A', 'A', 'A', 'B', 'A', 'A', '–', 'A', 'A', 'D', 'B', 'A', 'A', '93 A'], 'grades by points per day; overall = average of the areas');
      assert.equal(await sc.$eval('tr[data-key="DRV_S_BAKER"] td:nth-child(13)', td => td.textContent.trim()), '–', 'not rated this month: no grade');
      assert.match(await sc.textContent('#sc-how'), /How scoring works: each area \(but Attendance\) earns \+1 for a perfect day \(no miss in it\) and \+2 for every 5 perfect days in a row[\s\S]*Attendance earns nothing: the first 4 call-off days in the calendar year are free and each day after costs 3/);
      // Joe 10/13 Time grade: left too early (EVANS, 10 days) and back too late (FOX, 10 days) each cost 1 a day: -10 -> 60 (D).
      assert.equal(await sc.$eval('tr[data-key="DRV_S_EVANS"] td:nth-child(12)', td => td.textContent.trim()), 'D');
      assert.equal(await sc.$eval('tr[data-key="DRV_S_FOX"] td:nth-child(12)', td => td.textContent.trim()), 'D');
      // Joe 10/13: driving and distribution only, nothing for the plant.
      assert.doesNotMatch(await sc.textContent('#screen'), /plant/i, 'no plant card or plant items on the scorecard');
      assert.match(await sc.textContent('#kpis'), /Average driver score/);
      assert.match(await sc.textContent('#sc-how'), /Accidents \(12 months\), PDAs \(9 months\) and complaints \(6 months\) count past the period shown/);
      assert.match(await sc.textContent('#unassigned'), /No driver dispatched[\s\S]*10-8-26\s*229001\s*Speeding \(66 mph in a 45/, 'the alert on a truck with no driver is kept for a manager');
      assert.match(await sc.textContent('#unassigned'), /Hard turn \(1:35 PM/, 'harsh cornering is listed as a hard turn');
      assert.doesNotMatch(await sc.textContent('#unassigned'), /551234/, 'another plant\'s Fleet unit is not under No driver dispatched');
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
      assert.match(await sc.textContent('.sc-rate'), /Truck cleanliness: 2 of 5 on 10-9-26 \(trash in the cab\)/);
      assert.match(await sc.textContent('tr.sc-misses'), /Hard stop \(11:15 AM, truck 223896\)\s*−0\s*Excused: Deer in the road · manager test/, 'the excused hard stop costs nothing');
      assert.match(await sc.textContent('tr.sc-misses'), /Accident, 1st degree \(Minor\): Backing, truck 223896, preventable\s*−15/);
      assert.ok(await sc.$('tr.sc-misses .sc-excuse'), 'a manager can excuse the other GPS misses');
      if (SHOTS) await sc.screenshot({ path: path.join(SHOTS, 'after-driver-misses-' + w + '.png') });
      // A manager rates the truck from the details: pick 1 to 5 and Save comes on (the save itself: scorecard-rating.test.js).
      await sc.click('.sc-rate-open');
      await sc.waitForSelector('.sc-rate-form');
      assert.equal(await sc.$eval('.sc-rate-save', b => b.disabled), true);
      await sc.click('.sc-star[data-v="4"]');
      assert.equal(await sc.$eval('.sc-rate-save', b => b.disabled), false);
      if (SHOTS) await sc.screenshot({ path: path.join(SHOTS, 'after-rate-cleanliness-' + w + '.png') });
      await sc.click('.sc-rate-cancel');
      // Excuse opens a reason box (the save itself: driver-incidents.test.js).
      await sc.click('tr.sc-misses .sc-excuse');
      await sc.waitForSelector('.sc-ex-form .sc-ex-reason');
      await sc.fill('.sc-ex-reason', 'Deer');
      if (SHOTS && w === 1536) await sc.screenshot({ path: path.join(SHOTS, 'after-excuse-' + w + '.png') });
      await sc.click('.sc-ex-cancel');
      // FOX's idling on his sleeper route costs a quarter point.
      await sc.click('tr[data-key="DRV_S_FOX"]');
      await sc.waitForFunction(() => /sleeper/.test((document.querySelector('tr.sc-misses') || {}).textContent || ''));
      // Joe 10/14: idling is one line a day with the total minutes and how many times.
      assert.match(await sc.textContent('tr.sc-misses'), /Idling 30 min total, 1 time, truck 223898, sleeper\s*−0\.25/);
      // Joe 10/13: a tab per area; Speeding lists every driver's speeding.
      assert.deepEqual(await heads(sc, '#cats [data-tab]'), ['Overall', 'Check-in', 'Cases', 'Inspections', 'Attendance', 'Speeding', 'Hard Stops', 'Idling', 'Seatbelt', 'MPG', 'Time', 'Clean', 'Accidents', 'Complaints', 'PDA', 'Incidents']);
      const strip = await sc.$eval('#cats', c => ({ h: c.getBoundingClientRect().height, sw: c.scrollWidth, cw: c.clientWidth }));
      assert.ok(strip.h < 60 && strip.sw <= strip.cw + 1, 'the tabs fit on one line: ' + JSON.stringify(strip));
      await sc.click('#cats [data-tab="speeding"]');
      await sc.waitForSelector('table.sc-area');
      assert.deepEqual(await heads(sc, 'table.sc-area thead th'), ['#', 'Driver', 'Grade', 'Score', 'Days', 'Perfect days', 'Earned', 'Points off', 'Speeding details']);
      assert.match(await sc.textContent('table.sc-area'), /DIAZ, RAY\s*B\s*92[\s\S]*Speeding \(71 mph in a 55/);
      if (SHOTS) await sc.screenshot({ path: path.join(SHOTS, 'after-tab-speeding-' + w + '.png') });
      await sc.click('#cats [data-tab="incidents"]');
      await sc.waitForSelector('table.sc-incidents');
      assert.equal(await sc.$$eval('table.sc-incidents tbody tr', t => t.length), 4);
      assert.match(await sc.textContent('table.sc-incidents'), /LANE, SAM\s*PDA\s*Written warning\s*PDA: Written warning, Attendance\s*Manager decision\s*10/);
      assert.match(await sc.textContent('table.sc-incidents tr.sc-pending'), /ADAMS, PAT\s*Complaint\s*Major\s*Customer complaint \(Major\) from Kroger 512: Late delivery/);
      assert.equal(await sc.$eval('table.sc-incidents tr.sc-pending select', s => s.value), 'review', 'Under review until a manager marks it');
      if (SHOTS) await sc.screenshot({ path: path.join(SHOTS, 'after-incidents-' + w + '.png') });
      await sc.click('#cats [data-tab="overall"]');
      await sc.waitForSelector('.sc-board tr[data-key]');
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
        assert.deepEqual(await sc.$$eval('.sc-n[data-k="speeding"], .sc-n[data-k="hardBrake"], .sc-n[data-k="hardAccel"], .sc-n[data-k="hardTurn"], .sc-n[data-k="idle"], .sc-n[data-k="gpsDayCap"]', l => l.map(x => x.value)), ['2', '2', '1', '1', '1', '10']);
        assert.deepEqual(await sc.$$eval('.sc-n[data-k="sleeperIdlePct"], .sc-n[data-k="accidentBase"], .sc-n[data-k="accident2"], .sc-n[data-k="complaintMajor"], .sc-n[data-k="attendanceFreeDays"]', l => l.map(x => x.value)), ['4', '25', '15', '2', '10']);
        // Joe 10/16: attendance by the calendar year, the first 4 days free, no reward, a manager can excuse a day.
        assert.deepEqual(await sc.$$eval('.sc-n[data-k="callOff"]', l => l.map(x => x.value)), ['3']);
        assert.match(await sc.textContent('#sheet'), /Attendance\s*call-off days a year cost nothing\s*Each call-off day after\s*points\s*The year is January 1 to December 31\. Perfect attendance earns no extra points\. A call-off a manager excuses \(FMLA or Other\) does not count\./);
        assert.equal(await sc.$eval('#sc-kiosk-reasons', c => c.checked), false, 'Show reasons on kiosk starts off');
        assert.equal(await sc.$$eval('[data-kiosk-area]', l => l.length), AREA_HEADS.length - 3, 'every area can be ticked for the kiosk');
        assert.equal(await sc.$$eval('[data-kiosk-area]:checked', l => l.length), 0, 'none ticked to start');
        if (SHOTS) { await sc.$eval('#sc-kiosk-reasons', e => e.scrollIntoView({ block: 'center' })); await sc.screenshot({ path: path.join(SHOTS, 'after-settings-kiosk-' + w + '.png') }); }
        if (SHOTS) await sc.screenshot({ path: path.join(SHOTS, 'after-settings-' + w + '.png') });
      }
      assert.deepEqual(sc.errors, []);
      await sc.close();
    }
    if (!BEFORE) {
      // Joe 10/13: the Driver's Kiosk Station shows the grades only (scorecard.html?kiosk=1 inside the TV board).
      const k = await openPage(browser, 1920, 330, '/scorecard.html?month=2026-10&kiosk=1&testEmail=manager.test@uniteddairy.com');
      await k.waitForSelector('.sc-kiosk-title');
      await k.waitForSelector('.sc-board tbody td.strong');
      // Joe 10/13: the kiosk shows the overall score only, best first, until areas are ticked on Settings.
      assert.deepEqual(await heads(k, 'table.sc-board thead th'), ['#', 'Driver', 'Overall']);
      assert.deepEqual(await k.$$eval('table.sc-board tbody td.strong', t => t.map(x => x.textContent)).then(l => l.slice(0, 2)), ['HALL, PAT', 'KING, LEE']);
      assert.equal(await k.$$eval('tr.sc-misses, .sc-excuse, #sc-how', l => l.length), 0, 'no reasons or misses on the kiosk');
      assert.equal(await k.$eval('#kpis', e => e.offsetParent === null), true, 'no counts or buttons on the kiosk');
      if (SHOTS) await k.screenshot({ path: path.join(SHOTS, 'after-kiosk-1920.png') });
      assert.deepEqual(k.errors, []);
      await k.close();
      // Joe 10/13: the Driver Roster counts each driver's accidents and complaints and enters them under Edit.
      const ro = await openPage(browser, 1536, 760, '/drivers.html?testEmail=manager.test@uniteddairy.com');
      await ro.waitForSelector('#rows tr[data-id]');
      const rh = await heads(ro, '.sheet thead th');
      assert.deepEqual(rh.slice(-4), ['Accidents', 'Complaints', 'PDA', 'Edit']);
      await ro.waitForFunction(() => /review/.test(document.querySelector('#rows tr[data-id="drv_test_adams"]').textContent));
      const adams = await ro.$eval('#rows tr[data-id="drv_test_adams"]', tr => [...tr.cells].slice(-4, -1).map(c => c.textContent.trim()));
      assert.deepEqual(adams, ['1', '0 +1 review', '0'], 'one counting accident; one complaint under review; no PDA');
      await ro.click('#rows tr[data-id="drv_test_adams"] [data-edit]');
      await ro.waitForSelector('#d-inc-list .inc-item');
      assert.equal(await ro.$$eval('#d-inc-list .inc-item', l => l.length), 2);
      assert.equal(await ro.$$eval('#d-inc-list .inc-pending', l => l.length), 1, 'the complaint under review shows in amber');
      await ro.click('#d-add-accident');
      await ro.waitForSelector('#i-class');
      assert.deepEqual(await ro.$$eval('#i-class option', o => o.map(x => x.textContent)), ['1st degree (Minor)', '2nd degree (Damage)', '3rd degree (Total loss)']);
      if (SHOTS) await ro.screenshot({ path: path.join(SHOTS, 'after-roster-add-accident-1536.png') });
      await ro.click('#i-cancel');
      await ro.click('#d-add-complaint');
      await ro.waitForSelector('#i-severity');
      await ro.click('#i-cancel');
      await ro.click('#d-add-pda');
      await ro.waitForSelector('#i-step');
      assert.deepEqual(await ro.$$eval('#i-step option', o => o.map(x => x.textContent)), ['Verbal warning', 'Written warning', 'Final written warning', 'Suspension']);
      if (SHOTS) await ro.screenshot({ path: path.join(SHOTS, 'after-roster-add-pda-1536.png') });
      if (SHOTS) await ro.screenshot({ path: path.join(SHOTS, 'after-roster-add-complaint-1536.png') });
      const fitR = await ro.evaluate(() => ({ sw: document.querySelector('.sheet table').scrollWidth, cw: document.querySelector('.sheet').clientWidth }));
      assert.ok(fitR.sw <= fitR.cw + 1, 'the roster fits across with the two new columns: ' + JSON.stringify(fitR));
      assert.equal(await ro.getAttribute('#incidents-link', 'href'), 'scorecard.html?tab=incidents');
      assert.deepEqual(ro.errors, []);
      await ro.close();
      results.push('Driver Scorecard: area tabs, Incidents & Complaints, excused miss, sleeper idling, kiosk grades only, Driver Roster accidents and complaints');
    }
    if (!BEFORE) results.push('Driver Scorecard GPS: alerts on the dispatched driver, No driver dispatched kept, Week view, GPS weights on Settings, fits at 1536 and 1920');
    // Joe 10/14 (mock-up A): the Route Distribution home has a Manager card across the page, under the four cards, with Driver
    // Scorecard, Over the Road, Trucks Today and GPS Setup and today's numbers. Nothing on the four cards is taken away.
    if (!BEFORE) {
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      const now = new Date().toISOString(), b = db().batch();
      // Two scored alerts on our 229001 today; an engine code (not scored) on it and an alert on another plant's unit don't count.
      [['SPEEDING', '229001'], ['HARSH_TURN', '229001'], ['FAULT_CODE', '229001'], ['SPEEDING', '551234']].forEach(([type, tag], i) =>
        b.set(db().collection('gpsAlerts').doc('home_' + i), { date: today, tag, at: now, type }));
      b.set(db().collection('gpsTrucks').doc('223893'), { tag: '223893', lastReport: now, updatedAt: now, ignitionOn: true, speedMph: 48, place: '' });
      b.set(db().collection('gpsTrucks').doc('223894'), { tag: '223894', lastReport: now, updatedAt: now, ignitionOn: false, speedMph: 0, place: 'Uniontown Branch' });
      await b.commit();
      const review = (await db().collection('driverIncidents').where('status', '==', 'review').get()).size;
      const tt = await openPage(browser, 1536, 760, '/trucks.html?testEmail=manager.test@uniteddairy.com');
      await tt.waitForSelector('#kpis b');
      const kpi = await tt.$$eval('#kpis div', d => Object.fromEntries(d.map(x => [x.querySelector('span').textContent, x.querySelector('b').textContent])));
      await tt.close();
      for (const [w, h] of [[1536, 760], [1920, 960]]) {
        const home = await openPage(browser, w, h, '/distribution.html?testEmail=manager.test@uniteddairy.com');
        await home.waitForFunction(() => { const x = document.querySelector('[data-n="mgr.alerts"]'); return x && x.textContent === '2'; }, null, { timeout: 15000 });
        assert.deepEqual(await home.$$eval('.dc-wide .dc-link span', l => l.map(x => x.textContent)), ['Driver Scorecard', 'Over the Road', 'Trucks Today', 'GPS Setup']);
        assert.deepEqual(await home.$$eval('.dc-wide .dc-link', l => l.map(x => x.getAttribute('href'))), ['scorecard.html', 'otr.html', 'trucks.html', 'gps.html']);
        assert.deepEqual(await home.$$eval('.dc-wide .dc-metric', l => l.map(x => x.querySelector('em').textContent + ' ' + x.querySelector('b').textContent + ' ' + x.querySelector('small').textContent)),
          ['Scorecard ' + review + ' Under review', 'GPS alerts 2 Today', 'On the road ' + kpi['Driving'] + ' Trucks', 'In yard ' + kpi['In yard'] + ' Trucks'], 'the same counts as Trucks Today');
        assert.equal(await home.$$eval('.cards4 > .card', c => c.length), 5, 'the four cards stay and the Manager card is added');
        assert.deepEqual(await home.$$eval('.cards4 > .card:not(.dc-wide) .dc-link span', l => l.map(x => x.textContent)), ['Daily Dispatch', 'Weekly Dispatch', 'Route Editor', 'Driver Roster', 'Driver Weekly Template', 'Vacation Schedule',
          'Fleet & Maintenance', 'Equipment', 'Equipment Issues', 'Garage Work Orders', 'Fleet Service', 'Driver Check-ins', 'Sheet Conflicts'], 'nothing taken off the four cards');
        const g = await home.evaluate(() => { const c = [...document.querySelectorAll('.cards4 > .card')].map(x => x.getBoundingClientRect()); const l = [...document.querySelectorAll('.dc-wide .dc-link')].map(x => x.getBoundingClientRect());
          return { wide: Math.round(c[4].width), two: Math.round(c[1].right - c[0].left), below: c[4].top >= Math.max(c[2].bottom, c[3].bottom) - 1, oneLine: l.every(x => Math.abs(x.top - l[0].top) < 2), side: document.documentElement.scrollWidth > innerWidth + 1,
            small: [...document.querySelectorAll('.dc-wide .dc-link, .dc-wide .dc-metric em')].filter(x => parseFloat(getComputedStyle(x).fontSize) < 16).length }; });
        assert.ok(g.below && Math.abs(g.wide - g.two) <= 2 && g.oneLine && !g.side && !g.small, 'the Manager card runs across under the four cards, links on one line, text 16px+, at ' + w + ': ' + JSON.stringify(g));
        if (SHOTS) {
          await home.screenshot({ path: path.join(SHOTS, 'after-home-manager-' + w + '.png') });
          await home.evaluate(() => { const m = document.querySelector('.side-main'); if (m) m.scrollTop = m.scrollHeight; });
          await home.screenshot({ path: path.join(SHOTS, 'after-home-manager-' + w + '-scrolled.png') });
        }
        assert.deepEqual(home.errors, []);
        if (w === 1536) { await Promise.all([home.waitForURL(/scorecard\.html$/), home.click('#card-scorecard')]); }
        await home.close();
      }
      results.push('Route Distribution home: Manager card (Driver Scorecard, Over the Road, Trucks Today, GPS Setup) with under review, today\'s alerts on our units, and Trucks Today\'s driving and in-yard counts, at 1536 and 1920');
    }
    // Joe 10/14: only our drivers (never CARRIER), counted from a start date, idling once a day with each time excusable, and a
    // late-night departure through the yard is not read as the earlier run coming back. BEFORE=1 takes the same pictures of the old screen.
    {
      const b = db().batch(), ws = weekOf('2026-10-05');
      b.set(db().collection('runs').doc(ws + '__sample_849'), { runId: 'sample_849', route: '849', run: 'DAY', weekStart: ws, days: Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri'].map(p => [p, { runs: true, driver: 'CARRIER', driverId: '', truck: '', dispatchTime: '15:00', casesOut: 300, plantCaseReturn: 300 }])) });
      b.set(db().collection('gpsAlerts').doc('start_idle_1'), { date: '2026-10-07', tag: '223896', at: iso('2026-10-07', 9, 20), type: 'IDLE', minutes: 12 });
      b.set(db().collection('gpsAlerts').doc('start_idle_2'), { date: '2026-10-07', tag: '223896', at: iso('2026-10-07', 11, 5), type: 'IDLE', minutes: 9 });
      // EVANS's truck passed through the yard at 11:40 PM leaving on its next run: Fleet's last "return" that day.
      b.set(db().collection('gpsDays').doc('2026-10-07_223897'), { yardIn: '2026-10-08T03:40:00.000Z' }, { merge: true });
      // The start date is after the whole month on screen, so the board reads "before the start" whatever today is.
      b.set(db().collection('scorecard').doc('settings'), { countFrom: '2026-11-15' }, { merge: true });
      await b.commit();
      const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, (BEFORE ? 'before-' : 'after-') + name + '-1536.png') }); };
      const tab = async (page, t) => { await page.click('#cats [data-tab="' + t + '"]'); await page.waitForTimeout(300); return page.$$eval('.sc-board tbody tr', rows => rows.map(r => r.textContent)); };
      let sc = await openPage(browser, 1536, 760, '/scorecard.html?month=2026-10&testEmail=manager.test@uniteddairy.com');
      await sc.waitForSelector('#cats [data-tab="checkin"]');
      await sc.waitForTimeout(800);
      // Joe 10/14 (live): before the start date one driver with an old call-off was alone on the board and read as "stuck"
      // on him. Now nobody is listed, the board says why, No driver dispatched starts at the start date too, and Week / Month switch.
      if (!BEFORE) {
        assert.equal(await sc.$$eval('.sc-board tr[data-key]', r => r.length), 0, 'no driver is listed from call-offs before 11-15-26');
        assert.match(await sc.textContent('.sc-board'), /The scorecard counts from 11-15-26 \(Settings\)/);
        assert.equal(await sc.$('#unassigned'), null, 'No driver dispatched starts at the start date');
        const foot = await sc.textContent('#foot');
        assert.match(foot, /counted from 11-15-26 \(Settings\)/);
        assert.ok(!/copied Live weeks/.test(foot), 'the footer no longer talks about copied Live weeks');
        await shot(sc, 'board-before-start');
        await sc.click('[data-mode="week"]');
        await sc.waitForFunction(() => /Week of/.test(document.body.textContent));
        await sc.click('[data-mode="month"]');
        await sc.waitForFunction(() => /Oct 26/.test(document.body.textContent));
      }
      for (const t of BEFORE ? ['checkin', 'cases', 'inspection', 'time', 'idling'] : ['checkin', 'cases', 'inspection', 'time']) {
        const rows = await tab(sc, t);
        await shot(sc, 'tab-' + t);
        if (!BEFORE) assert.ok(rows.every(x => !/−\d/.test(x) || /No misses|^\s*$/.test(x)) && !rows.some(x => /Missed daily check-in|short \(out|No inspection done|Back at the yard/.test(x)), t + ': nothing before 11-15-26 costs points: ' + rows.join(' / '));
      }
      await sc.close();
      if (!BEFORE) {
        await db().collection('scorecard').doc('settings').set({ countFrom: '2026-10-01' }, { merge: true });
        sc = await openPage(browser, 1536, 760, '/scorecard.html?month=2026-10&testEmail=manager.test@uniteddairy.com');
        await sc.waitForSelector('.sc-board tr[data-key]');
        await sc.waitForTimeout(800);
        assert.ok(!/CARRIER/.test(await sc.textContent('.sc-board')), 'CARRIER is not graded on the board');
        const cases = await tab(sc, 'cases');
        assert.ok(!cases.some(x => /CARRIER/.test(x)), 'CARRIER is not on the Cases tab');
        const time = await tab(sc, 'time');
        assert.ok(!time.some(x => /11:40 PM/.test(x)), 'the 11:40 PM pass through the yard is not a late return');
        await shot(sc, 'tab-time-from-10-1');
        const idle = await tab(sc, 'idling');
        assert.ok(idle.some(x => /10-7-26 Idling 21 min total, 2 times, truck 223896\s*−1/.test(x)), 'DIAZ 10-7: one line, 21 minutes, 2 times: ' + idle.join(' / '));
        await shot(sc, 'tab-idling');
        await sc.click('.sc-idle-open');
        await sc.waitForSelector('.sc-pop');
        assert.equal(await sc.$$eval('.sc-pop .sc-excuse', b => b.length), 2, 'each time has its own Excuse');
        assert.match(await sc.textContent('.sc-pop'), /Idling \(12 min, 9:20 AM, truck 223896\)[\s\S]*Idling \(9 min, 11:05 AM, truck 223896\)/);
        const box = await sc.$eval('.sc-pop', e => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, font: parseFloat(getComputedStyle(e).fontSize) }; });
        assert.ok(box.l >= 0 && box.r <= 1536 && box.t >= 0 && box.b <= 760 && box.font >= 16, 'the pop-up fits the window with 16px text');
        await shot(sc, 'idling-popup');
        await sc.click('.sc-pop .sc-pop-close');
        assert.equal(await sc.$('.sc-pop'), null);
        await sc.click('#cats [data-tab="inspection"]');
        assert.ok(!/No inspection done/.test(await sc.textContent('.sc-board')), 'a miss that costs 0 is not listed');
        assert.deepEqual(sc.errors, []);
        await sc.close();
        results.push('Driver Scorecard (Joe 10/14): nothing before Scorecard counted from costs points; CARRIER is never graded; idling is one line a day with a pop-up to excuse each time; an 11:40 PM pass through the yard is not a late return');
      }
    }
    // Joe 10/16: "not penalized nor reward unless it has been over four days in the calendar year", with a manager override
    // (FMLA, or Other with a note). DIAZ called off 6 days in October; a manager excused 10-3 as FMLA. BEFORE=1 takes the old screen.
    {
      await db().collection('scorecard').doc('settings').set({ countFrom: '2026-10-01' }, { merge: true });
      const b = db().batch();
      ['2026-10-02', '2026-10-03', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'].forEach(date =>
        b.set(db().collection('exceptions').doc('att_diaz_' + date), { cells: { driver_id: 'drv_s_diaz', start_date: date, end_date: date, reason_code: 'SICK DAY', status: 'APPROVED' } }));
      b.set(db().collection('scorecardExcuses').doc('att_diaz_fmla'), { key: 'att|2026-10-03|DRV_S_DIAZ|', reason: 'FMLA', by: 'manager.test@uniteddairy.com', at: '2026-10-16T15:00:00.000Z', driverKey: 'DRV_S_DIAZ', what: 'Call-off (sick day)' });
      await b.commit();
      const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, (BEFORE ? 'before-' : 'after-') + name + '-1536.png') }); };
      const sc = await openPage(browser, 1536, 760, '/scorecard.html?month=2026-10&testEmail=manager.test@uniteddairy.com');
      await sc.waitForSelector('.sc-board tr[data-key]');
      await sc.click('#cats [data-tab="attendance"]');
      await sc.waitForFunction(() => /DIAZ/.test((document.querySelector('.sc-board') || {}).textContent || ''));
      await sc.waitForTimeout(500);
      const toDiaz = () => sc.$$eval('table.sc-board tbody tr', rows => { const r = rows.find(x => /DIAZ, RAY/.test(x.textContent)); if (r) r.scrollIntoView({ block: 'center' }); });
      await toDiaz();
      await shot(sc, 'attendance-tab');
      if (!BEFORE) {
        const diaz = await sc.$$eval('table.sc-area tbody tr', rows => rows.map(r => r.textContent).find(t => /DIAZ, RAY/.test(t)) || '');
        assert.deepEqual(await heads(sc, 'table.sc-area thead th'), ['#', 'Driver', 'Grade', 'Score', 'Call-off days', 'Perfect days', 'Earned', 'Points off', 'Attendance details']);
        assert.match(diaz, /DIAZ, RAY\s*A\s*97\s*6\s*–\s*–\s*−3/, 'grade A, score 97, 6 call-off days, nothing earned, 3 off');
        assert.match(diaz, /10-2-26 Call-off \(sick day\), day 1 this year, within the 4 allowed/);
        assert.match(diaz, /10-7-26 Call-off \(sick day\), day 4 this year, within the 4 allowed/);
        assert.match(diaz, /10-8-26 Call-off \(sick day\), day 5 this year\s*−3/, 'the 5th day costs 3');
        assert.match(diaz, /10-3-26 Call-off \(sick day\)\s*−0\s*Excused: FMLA · manager test · 10-16-26/, 'the FMLA day is kept, with who and when');
        assert.ok(!/day 1 this year, within the 4 allowed\s*−/.test(diaz), 'a free day shows no points');
        await sc.locator('table.sc-area tbody tr', { hasText: 'DIAZ, RAY' }).locator('.sc-excuse').last().click();
        await sc.waitForSelector('.sc-ex-form .sc-ex-why');
        assert.deepEqual(await sc.$$eval('.sc-ex-why option', o => o.map(x => x.textContent)), ['Pick a reason', 'FMLA', 'Other']);
        await sc.selectOption('.sc-ex-why', 'Other');
        await sc.click('.sc-ex-save');
        await sc.waitForFunction(() => /Type a note for Other/.test(document.body.textContent));
        await sc.fill('.sc-ex-reason', 'jury duty');
        await toDiaz();
        await shot(sc, 'attendance-excuse');
        await sc.click('.sc-ex-cancel');
        assert.equal(await sc.$eval('#error', e => e.hidden), true, 'Cancel clears the message');
        await sc.click('#cats [data-tab="overall"]');
        await sc.click('tr[data-key="DRV_S_DIAZ"]');
        await sc.waitForFunction(() => /this year, 4 allowed/.test(document.body.textContent));
        assert.match(await sc.textContent('#sheet'), /6 call-offs \(5 this year, 4 allowed\)/);
        assert.deepEqual(sc.errors.filter(e => !/Type a note/.test(e)), []);
        results.push('Driver Scorecard attendance (Joe 10/16): the first 4 call-off days in the calendar year cost nothing, the 5th costs 3, an FMLA day is excused with who and when, and the Excuse box offers FMLA or Other');
      }
      // Settings: the attendance line.
      await sc.click('.tabs [data-mode="settings"]');
      await sc.waitForSelector('.sc-n[data-k="callOff"]');
      await sc.$eval('.sc-n[data-k="callOff"]', e => e.scrollIntoView({ block: 'center' }));
      await shot(sc, 'attendance-settings');
      await sc.close();
    }
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

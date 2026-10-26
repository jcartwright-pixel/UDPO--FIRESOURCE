'use strict';
/*
 * Screen load timings (Joe 10/18: "some screens a little slow ... do some screen load timings").
 * Opens every main screen against the local test database, signed in as the test administrator, with a connection delay like
 * an office internet line, and times how long each screen takes until it stops changing (the data is drawn). Each screen is
 * opened twice: "first open" in a fresh browser, and "moving between screens" in a browser that already has the app open.
 * Not part of npm run test:browser (it measures, it does not pass or fail). Usage, inside the emulators:
 *   node test/browser/screen-timings.cjs [width] [out.json]
 * Env: GROW=1 adds a year of made-up history (work orders, issues, washes, scheduled loads) to see which screens slow down
 * as the database grows.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const F = require('../fixtures/fake-sheets');
const PD = require('../fixtures/plant-demo');
const L = require('../../src/logic');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const WIDTH = Number(process.argv[2] || 1536);
const OUT = process.argv[3] || '';
const HEIGHT = { 1536: 730, 1920: 950, 390: 844 }[WIDTH] || 800;
const WHO = 'testEmail=admin.test@uniteddairy.com';
// The office line: 40 ms each way to Google, about 40 Mbit/s down.
const LINE = { offline: false, latency: Number(process.env.LATENCY || 40), downloadThroughput: 5e6, uploadThroughput: 2e6 };

const SCREENS = [
  ['Home', 'index.html'], ['Route Distribution', 'distribution.html'], ['Daily Dispatch', 'daily.html'], ['Weekly Dispatch', 'weekly.html'],
  ['Route Editor', 'routes.html'], ['Route Week Override', 'routeweek.html'], ['Driver Roster', 'drivers.html'], ['Driver Weekly Template', 'template.html'],
  ['Vacation Schedule', 'vacations.html'], ['Fleet & Maintenance', 'maint.html'], ['Equipment', 'equipment.html'], ['Equipment Issues', 'issues.html'],
  ['Garage Work Orders', 'garage.html'], ['Fleet Service', 'fleet.html'], ['Driver Scorecard', 'scorecard.html'], ['Over the Road', 'otr.html'],
  ['Trucks Today', 'trucks.html'], ['GPS Setup', 'gps.html'], ['Driver Check-ins', 'checkins.html'], ['Driver Station', 'driver-station.html'],
  ['Sheet Conflicts', 'conflicts.html'], ['Dispatch Administration', 'admin.html'], ['Operational Assignments', 'ops.html'], ['Print Layouts', 'print.html'],
  ['Dispatch Settings', 'settings.html'], ['Administration', 'administration.html'], ['Manager Center', 'manager.html'], ['Plant Departments', 'plant.html'],
  ['Loadout Center', 'loadout.html'], ['Unloading & Washing', 'unloading.html'], ['Product Returns', 'returns.html'], ['Truck Washing', 'washing.html'],
  ['Trailer Assignments', 'trailers.html'], ['Shipping & Receiving', 'scheduler.html'], ['Shift Notes', 'shiftnotes.html'], ['Quality Checks', 'quality.html'],
  ['Cooler Temperature', 'temps.html'], ['Yard Checks', 'yard.html'], ['Manager Walkthrough', 'walkthrough.html'], ['Plant Reports', 'reports.html'],
  ['Shift Reports', 'shiftreports.html'], ['Plant Performance TV', 'plant-kiosk.html'], ['Reports', 'reportcenter.html'], ['Safety Walkthrough', 'safety.html'],
  ['Production Lines', 'production.html'], ['Line Targets', 'linetargets.html'], ['Inventory', 'inventory.html'], ['Maintenance Center', 'pmaint.html'],
  ['Machinery', 'machinery.html'], ['Work Orders (plant)', 'pmworkorders.html'], ['PM Schedule', 'pmschedule.html'], ['MOCREO & Sensors', 'mocreo.html'],
  ['Company Overview', 'company.html'], ['Upload Center', 'uploads.html'],
  ['Driver Assignment Board', 'weekly.html#board'], ['Truck Issues', 'issues.html?kind=TRUCK'], ['Trailer Issues', 'issues.html?kind=TRAILER'],
  ['Fork Truck Issues', 'issues.html?kind=FORK_TRUCK'], ['Send Current Report', 'manager.html?report=1'], ['Loading Rundown', 'reports.html?view=rundown'],
  ['Production TV', 'production.html?tv=1'], ['Line Tablet', 'line.html'], ['Maintenance Station', 'maint-station.html'], ['Garage Station', 'garage-station.html'],
  ['Plant Station', 'plant-station.html'], ['Driver Room TV', 'driver-room.html'], ['Driver Check-In (phone)', 'route.html'], ['Phone Screens', 'phone-screens.html'],
  ['Open Safety Issues', 'safety-issues.html'], ['Fire Extinguishers', 'extinguishers.html'], ['Fire Alarm', 'safety-fire.html?sys=alarm'],
  ['Fire Suppression', 'safety-fire.html?sys=suppression'], ['Escape Plan', 'safety-fire.html?sys=escape'], ['Past Walks', 'safety-walks.html'],
  ['Checklist Setup', 'safety-setup.html'], ['Products', 'products.html'], ['Machine Setup', 'machine-setup.html'], ['Location Areas', 'location-areas.html'],
  ['RedZone', 'redzone.html'], ['Shifts', 'shifts.html'], ['Text Log', 'texts.html'], ['Coming Soon page', 'soon.html']
];

async function seed() {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date('2026-10-08T14:00:00Z') });
  if (process.env.REAL) await realWeeks();
  if (!process.env.GROW) return;
  // A year of history in the collections some screens read whole (made-up, sized like a busy plant).
  const d = db(), today = L.operatingDay(new Date());
  let batch = d.batch(), n = 0;
  const put = async (ref, data) => { batch.set(ref, data); if (++n % 400 === 0) { await batch.commit(); batch = d.batch(); } };
  for (let i = 0; i < 365; i++) {
    const date = L.addDays(today, -i);
    for (let k = 0; k < 4; k++) await put(d.collection('workOrders').doc('grow_wo_' + i + '_' + k), { workOrderId: 'WO-g' + i + k, status: 'COMPLETE', unit: String(200 + k), createdAt: date + 'T12:00:00Z', closedAt: date + 'T15:00:00Z', description: 'Made-up closed work order for timing', items: [{ text: 'Brake check', done: true }] });
    for (let k = 0; k < 5; k++) await put(d.collection('maintenance').doc('grow_mx_' + i + '_' + k), { recordId: 'MX-g' + i + k, kind: k === 0 ? 'WASH' : 'TRUCK', status: 'COMPLETE', unit: String(200 + k), date, createdAt: date + 'T10:00:00Z', notes: 'Made-up closed record for timing' });
    for (let k = 0; k < 3; k++) await put(d.collection('plantWash').doc('grow_pw_' + i + '_' + k), { recordId: 'PW-g' + i + k, status: 'COMPLETE', serviceDate: date, unit: 'T-' + (900 + k) });
    for (let k = 0; k < 6; k++) await put(d.collection('plantJournal').doc('PLANT_SCHEDULE_grow_' + i + '_' + k), { recordId: 'SCHED-g' + i + k, type: 'PLANT_SCHEDULE', date, status: 'SCHEDULED', payload: { pickupTime: '07:00', scheduleType: 'ROUTE' }, recordedAt: date + 'T08:00:00Z' });
    for (let k = 0; k < 20; k++) await put(d.collection('plantJournal').doc('SHIFT_REPORT_grow_' + i + '_' + k), { recordId: 'SHIFT-g' + i + k, type: 'SHIFT_REPORT', date, area: 'HANDOFF', recordedAt: date + 'T09:00:00Z', payload: { section: 'HANDOFF', values: { Entry: 'Made-up note' } } });
  }
  // Joe 10/18 (data checkup): a year of archived dispatch weeks (the copy keeps DISPATCH WEEK HISTORY in runs), plant check-ins
  // and plant work orders, the other collections that grow with history.
  const real = (await d.collection('runs').where('weekStart', '==', '2026-10-04').get()).docs.map(x => x.data());
  for (let w = 2; w <= 53 && real.length; w++) {
    const target = L.addDays(L.weekStart(today), -7 * w), shift = L.daysBetween('2026-10-04', target);
    for (let i = 0; i < 80; i++) {
      const run = JSON.parse(JSON.stringify(real[i % real.length]).replace(/"(\d{4}-\d{2}-\d{2})/g, (m, k) => '"' + L.addDays(k, shift)));
      Object.assign(run, { weekStart: target, route: String(1000 + i), runId: 'run_hist' + i, routeId: 'rte_real' + i, sourceTab: 'DISPATCH WEEK HISTORY' });
      await put(d.collection('runs').doc(target + '__run_hist' + i), run);
    }
  }
  for (let i = 0; i < 365; i++) {
    const date = L.addDays(today, -i);
    for (let k = 0; k < 30; k++) await put(d.collection('plantEvents').doc('grow_ev_' + i + '_' + k), { recordId: 'EV-g' + i + k, type: k % 2 ? 'DVIR' : 'ROUTE_CHECKIN', date, route: String(1000 + k), driverId: '', recordedAt: date + 'T10:00:00Z' });
    for (let k = 0; k < 3; k++) await put(d.collection('plantWorkOrders').doc('grow_pwo_' + i + '_' + k), { facilityId: 'fac_uniontown', status: 'DONE', title: 'Made-up finished plant job', createdAt: date + 'T08:00:00Z', completedAt: date + 'T11:00:00Z' });
  }
  await batch.commit();
}

// Joe's real Live sheet has about 80 runs a week (LIVE CURRENT WEEK, 10/18), so REAL=1 fills last, this and next week with that
// many loads (REAL_RUNS to try more) (copies of the made-up week's loads, dates moved to the real weeks), the way the screens meet the real plant.
async function realWeeks() {
  const d = db(), runs = (await d.collection('runs').where('weekStart', '==', '2026-10-04').get()).docs.map(x => x.data());
  const today = L.operatingDay(new Date()), wk = L.weekStart(today);
  let batch = d.batch(), n = 0;
  for (const target of [L.addDays(wk, -7), wk, L.addDays(wk, 7)]) {
    const shift = L.daysBetween('2026-10-04', target);
    for (let i = 0; i < Number(process.env.REAL_RUNS || 80); i++) {
      const src = runs[i % runs.length];
      const json = JSON.stringify(src).replace(/"(\d{4}-\d{2}-\d{2})/g, (m, k) => '"' + L.addDays(k, shift));
      const run = JSON.parse(json);
      const route = String(1000 + i), id = 'run_real' + i;
      Object.assign(run, { weekStart: target, route, runId: id, routeId: 'rte_real' + i, sheetRow: 10 + i });
      batch.set(d.collection('runs').doc(target + '__' + id), run);
      if (++n % 400 === 0) { await batch.commit(); batch = d.batch(); }
    }
  }
  await batch.commit();
}

async function prepare(page) {
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    const file = route.request().url().split('/').pop();
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, file)), headers: { 'Cache-Control': 'public, max-age=31536000' } });
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', LINE);
  // Every change to what the page shows (text and rows; a box shown or hidden alone is not counted) is noted, so "ready" is
  // when the screen stopped changing.
  if (process.env.FORCECACHE) await page.addInitScript(() => { window.UD_OFFLINE = true; });
  await page.addInitScript(() => {
    window.__muts = [];
    new MutationObserver(ms => { if (ms.some(m => m.type !== 'attributes')) window.__muts.push(performance.now()); }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
  });
  const reqs = { n: 0, db: 0, bytes: 0, server: [] };
  page.on('request', r => { reqs.n++; if (/:8080\//.test(r.url())) reqs.db++; const m = r.url().match(/:5001\/[^/]+\/[^/]+\/([A-Za-z]+)/); if (m) reqs.server.push(m[1]); });
  page.on('response', async r => { try { const h = await r.headerValue('content-length'); reqs.bytes += Number(h || 0); } catch (e) { /* closed */ } });
  page.on('pageerror', e => { (page.__errors = page.__errors || []).push(e.message); });
  return reqs;
}

// Last change before the screen sat still for QUIET ms (screens with a running clock keep changing; their clock is ignored by
// stopping at the first quiet gap).
const QUIET = 1500, LIMIT = 10000;
async function timeOpen(page, url) {
  const tStart = Date.now();
  const [bare, hash] = url.split('#');
  await page.goto(HOSTING + '/' + bare + (bare.includes('?') ? '&' : '?') + WHO + (hash ? '#' + hash : ''), { waitUntil: 'domcontentloaded' });
  const t0 = Date.now();
  let out = null;
  while (Date.now() - t0 < LIMIT) {
    await page.waitForTimeout(250);
    try {
      const done = await page.evaluate((q) => { const m = window.__muts || []; const last = m.length ? m[m.length - 1] : 0; return performance.now() - last > q; }, QUIET);
      if (!done) continue;
      out = await page.evaluate((q) => {
        const m = window.__muts.slice().sort((a, b) => a - b);
        let ready = m[0] || 0;
        for (let i = 1; i < m.length; i++) { if (m[i] - m[i - 1] > q) break; ready = m[i]; }
        return { readyAt: performance.timeOrigin + ready, files: performance.getEntriesByType('resource').filter(r => /\.(js|css)(\?|$)/.test(r.name)).length,
          page: location.pathname.split('/').pop(), text: (document.getElementById('screen') || document.body).innerText.slice(0, 80).replace(/\s+/g, ' ') };
      }, QUIET);
      break;
    } catch (e) { await page.waitForLoadState('domcontentloaded').catch(() => {}); }
  }
  if (!out) return { ready: -1, files: 0, text: 'did not settle', page: '' };
  return Object.assign(out, { ready: Math.round(out.readyAt - tStart) });
}

(async () => {
  await seed();
  const browser = await chromium.launch();
  const rows = [];
  // Moving between screens: one browser with the app open, each screen opened from the last.
  const warmCtx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, isMobile: WIDTH < 500, hasTouch: WIDTH < 500, serviceWorkers: 'block' });
  const warm = await warmCtx.newPage();
  const warmReqs = await prepare(warm);
  await timeOpen(warm, 'index.html');
  const only = (process.env.ONLY || '').split(',').filter(Boolean);
  for (const [name, url] of SCREENS.filter(([, u]) => !only.length || only.includes(u.split(/[?#]/)[0]))) {
    // First open: a fresh browser (nothing kept from before).
    const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, isMobile: WIDTH < 500, hasTouch: WIDTH < 500, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const reqs = await prepare(page);
    let cold, hot;
    try { cold = await timeOpen(page, url); } catch (e) { cold = { ready: -1, error: e.message }; }
    const coldReqs = Object.assign({}, reqs, { server: reqs.server.slice() });
    await ctx.close();
    const before = Object.assign({}, warmReqs);
    try { hot = await timeOpen(warm, url); } catch (e) { hot = { ready: -1, error: e.message }; }
    const row = { name, url, firstOpen: cold.ready, moving: hot.ready, files: cold.files, requests: coldReqs.n, dbRequests: coldReqs.db, kb: Math.round(coldReqs.bytes / 1024),
      movingRequests: warmReqs.n - before.n, serverCalls: coldReqs.server.join(' '), errors: (page.__errors || []).length, landedOn: cold.page, shows: cold.text };
    rows.push(row);
    console.log([name.padEnd(28), String(row.firstOpen).padStart(6), String(row.moving).padStart(6), String(row.files).padStart(4), String(row.requests).padStart(5), String(row.kb).padStart(6), row.serverCalls.padEnd(14), (row.landedOn !== url.split(/[?#]/)[0] ? '-> ' + row.landedOn + ' ' : '') + row.shows.slice(0, 40)].join(' '));
  }
  await browser.close();
  if (OUT) fs.writeFileSync(OUT, JSON.stringify({ width: WIDTH, line: LINE, grow: !!process.env.GROW, rows }, null, 1));
})().catch(e => { console.error(e); process.exit(1); });

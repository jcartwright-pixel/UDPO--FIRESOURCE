'use strict';
/*
 * Browser check of the one-record-per-run-and-day list (src/rundays.js; Joe 10/19, Plant Distribution and Yard Checks slow to
 * open). Three real-size Live weeks (80 runs each, the real Uniontown week's size) are copied in, and for every day from a week
 * back to a week ahead the page works out Manager Center's and Yard Checks' loads (loadout, yard trailers, unloads, returns) two
 * ways: from the three weeks of whole runs, as before, and from the yesterday-and-today records the screens read now. Both must
 * be the same, and the new read must be a small part of the old one. Then a change to a run (a trailer typed, a day turned off,
 * a run removed) must reach its records through the trigger, and Manager Center and Yard Checks must open with the loads.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const L = require('../../src/logic');
const F = require('../fixtures/fake-sheets');
const PD = require('../fixtures/plant-demo');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const ADMIN = '?testEmail=admin.test@uniteddairy.com';
const today = L.operatingDay(new Date()), wk = L.weekStart(today);
const WEEKS = [L.addDays(wk, -7), wk, L.addDays(wk, 7)];

async function seed() {
  await clear();
  const d = db();
  await runTransfer({ db: d, reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date('2026-10-08T14:00:00Z') });
  // The 10-04 week's runs, moved onto last, this and next week (as test/browser/screen-timings.cjs REAL=1), each run given a
  // trailer and a loaded state on some days so the yard and the unloads have something to show.
  const src = (await d.collection('runs').where('weekStart', '==', '2026-10-04').get()).docs.map(x => x.data());
  assert.ok(src.length, 'the made-up plant has runs in the 10-04 week');
  let batch = d.batch(), n = 0;
  for (const target of WEEKS) {
    const shift = L.daysBetween('2026-10-04', target);
    for (let i = 0; i < 80; i++) {
      const run = JSON.parse(JSON.stringify(src[i % src.length]).replace(/"(\d{4}-\d{2}-\d{2})/g, (m, k) => '"' + L.addDays(k, shift)));
      Object.assign(run, { weekStart: target, route: String(1000 + i), runId: 'run_rd' + i, routeId: 'rte_rd' + i, sheetRow: 10 + i });
      L.DAYS.forEach((p, j) => {
        const day = run.days[p] = Object.assign({}, run.days[p] || {}, { runs: (i + j) % 5 !== 0, trailer: 'T-' + (500 + i), deliveryDate: L.addDays(target, j) });
        if ((i + j) % 3 === 0) Object.assign(day, { loadStatus: 'COMPLETE', loadedComplete: true });
        if (i % 7 === 0) day.loadDayOffset = -2;
        if (i % 11 === 0) day.loadDayOffset = 0;
        if (i % 13 === 0) day.departureDate = L.addDays(target, j + 1);
        if (i % 17 === 0) day.refusedReturned = 'YES';
      });
      batch.set(d.collection('runs').doc(target + '__run_rd' + i), run);
      if (++n % 400 === 0) { await batch.commit(); batch = d.batch(); }
    }
  }
  await batch.commit();
}

// Waits until every run of the three weeks has its records (the trigger writes them).
async function waitForRecords() {
  const d = db(), want = (await d.collection('runs').where('weekStart', 'in', WEEKS).get()).docs.reduce((a, x) => a + Object.keys(x.data().days || {}).length, 0);
  for (let i = 0; i < 120; i++) {
    const have = (await d.collection('runDays').where('weekStart', 'in', WEEKS).get()).size;
    if (have === want) return want;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('the run day records did not catch up with the runs');
}

async function openPage(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1536, height: 790 } });
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    const file = route.request().url().split('/').pop();
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, file)) });
  });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(HOSTING + url);
  page.errors = errors;
  return page;
}

// In the page: both ways for each day, compared there; returns the days that differ and the sizes read.
async function compare(page, days) {
  return page.evaluate(async ({ days, weeks }) => {
    const { start } = await import('./js/app.js');
    const { collection, query, where, getDocs } = await import('./js/firebase.js');
    const P = await import('./js/plant-core.js');
    const { watchLoads } = await import('./js/recent-records.js');
    const L = window.UDLogic, U = window.UDPlant, { db } = await start();
    // The loads as the server has them: a first answer from this page's own memory of an earlier day's records can be short
    // (the server's full answer follows it); one from the server, or no change for 2 seconds, is the screen's settled list.
    const settled = (list) => new Promise((res, rej) => {
      let last = null, timer = 0;
      const stop = watchLoads(db, list, (r, s) => { last = r; clearTimeout(timer); if (!s.metadata.fromCache) { stop(); res(r); } else timer = setTimeout(() => { stop(); res(last); }, 2000); }, rej);
    });
    const size = (s) => s.docs.reduce((n, d) => n + JSON.stringify(d.data()).length, 0);
    const whole = await getDocs(query(collection(db, 'runs'), where('weekStart', 'in', weeks)));
    const all = whole.docs.map(d => Object.assign({ id: d.id }, d.data()));
    const out = { differ: [], wholeKb: Math.round(size(whole) / 1024), dayKb: [], shown: 0 };
    for (const date of days) {
      const dates = [L.addDays(date, -1), date];
      const s = await getDocs(query(collection(db, 'runDays'), where('dates', 'array-contains-any', dates)));
      out.dayKb.push(Math.round(size(s) / 1024));
      const runs = await settled(dates);
      // Noon of that day on the plant's clock: the yard list and Behind follow the time.
      const now = Date.parse(date + 'T16:00:00Z');
      const views = (list) => {
        const loads = P.loadoutRows(list, date, ''), returns = P.returnsFor(list, date, []);
        return JSON.stringify({ loads, yard: U.yardQueue(list, [], date, now), yardHolds: U.yardHolds(list, date), returns, unloads: P.unloadRows(list, date, [], returns, loads) });
      };
      // Plant Distribution Departments (js/plant-dept.js) reads today, yesterday and the day before, and shows yesterday's loads too.
      const dates3 = [L.addDays(date, -2), L.addDays(date, -1), date];
      const runs3 = await settled(dates3);
      const dept = (list) => { const loads = P.loadoutRows(list, date), returns = P.returnsFor(list, date, []); return JSON.stringify({ loads, yesterday: P.loadoutRows(list, L.addDays(date, -1)), returns, unloads: P.unloadRows(list, date, [], returns, loads) }); };
      const da = dept(all), db3 = dept(runs3);
      if (da !== db3) { out.differ.push(date + ' (Plant Departments)'); const A = JSON.parse(da), B = JSON.parse(db3); out.deptDetail = Object.keys(A).filter(k => JSON.stringify(A[k]) !== JSON.stringify(B[k])).map(k => { const x = [].concat(A[k].rows || A[k]), y = [].concat(B[k].rows || B[k]); const i = x.findIndex((v, j) => JSON.stringify(v) !== JSON.stringify(y[j])); return [date, k, x.length, y.length, JSON.stringify(x[i]).slice(0, 700), JSON.stringify(y[i]).slice(0, 700)]; }); }
      const a = views(all), b = views(runs);
      out.shown += JSON.parse(a).loads.length + JSON.parse(a).yard.rows.length;
      if (a !== b) { out.differ.push(date); if (!out.detail) { const A = JSON.parse(a), B = JSON.parse(b); out.detail = Object.keys(A).filter(k => JSON.stringify(A[k]) !== JSON.stringify(B[k])).map(k => { const x = [].concat(A[k].rows || A[k]), y = [].concat(B[k].rows || B[k]); const i = x.findIndex((v, j) => JSON.stringify(v) !== JSON.stringify(y[j])); return [date, k, x.length, y.length, JSON.stringify(x[i]).slice(0, 600), JSON.stringify(y[i]).slice(0, 600)]; }); } }
    }
    return out;
  }, { days, weeks: WEEKS });
}

(async () => {
  await seed();
  const records = await waitForRecords();
  const browser = await chromium.launch();
  try {
    const page = await openPage(browser, '/manager.html' + ADMIN);
    await page.waitForSelector('#screen:not([hidden])');
    const days = []; for (let i = -6; i <= 6; i++) days.push(L.addDays(today, i));
    const r = await compare(page, days);
    if (r.differ.length) console.log('DETAIL', JSON.stringify(r.differ), JSON.stringify(r.detail, null, 1), JSON.stringify(r.deptDetail, null, 1));
    assert.deepEqual(r.differ, [], 'the loads, yard trailers, unloads and returns are the same from the one-day records on every day (Manager Center, Yard Checks and Plant Departments)');
    assert.ok(r.shown > 50, 'the days compared have loads and yard trailers to show (' + r.shown + ')');
    const most = Math.max(...r.dayKb);
    assert.ok(most * 3 < r.wholeKb, 'the screens read ' + most + ' KB instead of ' + r.wholeKb + ' KB');
    console.log('ok - same loads on 13 days from ' + records + ' one-day records; ' + most + ' KB read instead of ' + r.wholeKb + ' KB');

    // A change to a run reaches its records: a trailer typed on today's day, a day turned off, a run removed.
    const d = db(), p = L.dayPrefix(today), id = wk + '__run_rd1', id2 = wk + '__run_rd2';
    await d.collection('runs').doc(id).update({ ['days.' + p + '.trailer']: 'T-999' });
    await d.collection('runs').doc(id2).delete();
    const until = async (what, ok) => { for (let i = 0; i < 60; i++) { if (await ok()) return; await new Promise(res => setTimeout(res, 500)); } throw new Error(what); };
    await until('the typed trailer reached the record', async () => ((await d.collection('runDays').doc(id + '__' + p).get()).data() || { days: {} }).days[p].trailer === 'T-999');
    await until('the removed run\'s records went', async () => (await d.collection('runDays').where('runDocId', '==', id2).get()).empty);
    const again = await compare(page, [today]);
    assert.deepEqual(again.differ, [], 'after the changes the screens still show the same as the whole runs');
    console.log('ok - a typed trailer and a removed run reach the one-day records');

    // Both screens open with today's loads from the records.
    const loadsShown = await page.evaluate(() => document.querySelector('[data-card="dept"]').innerText);
    assert.match(loadsShown, /\d/, 'Manager Center shows load numbers');
    const yard = await openPage(browser, '/yard.html' + ADMIN);
    // The list has arrived when it no longer says it is loading (which trailers are due follows the real clock).
    await yard.waitForFunction(() => { const t = (document.getElementById('rows') || {}).innerText || ''; return t && !/Loading the trailers/.test(t); }, null, { timeout: 15000 });
    assert.deepEqual([...page.errors, ...yard.errors], [], 'no page errors');
    console.log('ok - Manager Center and Yard Checks open with the loads');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });

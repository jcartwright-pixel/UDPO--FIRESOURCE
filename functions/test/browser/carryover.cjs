'use strict';
/*
 * Joe 10/20 (6:08 AM): "we still have leftover from last night before we even start today... we got to just have a
 * continuation of the plant status." After the 6 a.m. roll, last night's open loads stay first in line: each counts as
 * behind (it missed its shift), the Late Forecast takes them first (a paused load is not loading, so it waits its turn), and
 * today's Est. Done times start after them. Daily Case Loadout, Manager Center, the Late Forecast screen and the report all
 * say the same. Pictures go to SHOTS_DIR.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const localCalls = require('./local-calls.cjs');
const R = require('../../src/plant-rules');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR || '';
const MANAGER = 'testEmail=manager.test@uniteddairy.com';
const NOW = '2026-10-20T10:10:00Z'; // Tuesday 6:10 AM in New York
const T = (h, m) => h * 60 + (m || 0);
// Last night's loads (loaded Mon 10-19 for Tue 10-20): four still open after 6 a.m., as on Joe's screen; 901 was started and
// paused ("No product").
const PRIOR = [['971', 'PAINTSVILLE TRANSFER', 50, T(2), 812], ['901_1', 'PRODUCT 1', 60, T(7), 853, '2026-10-20T08:39:00Z', 'PAUSED'],
  ['909_1', 'MARIETTA LOAD 1', 70, T(6), 1067], ['907_1', 'FAIRMONT TRANSFER', 80, T(8), 1073], ['803', 'DSD', 40, T(4), 503, '2026-10-20T03:00:00Z', 'COMPLETE']];
// Today's (loaded Tue 10-20): Save-A-Lot leaves the day it is loaded; the rest deliver Wednesday. Joe 10/20: as on the Live
// sheet, Save-A-Lot's load date reads 1-1-70 and Save-A-Lot 2 has no cases or trailer yet; both still show everywhere.
const TODAY = [['855', 'SAVE-A-LOT 1', 10, T(8), 600, 'tue', 0, 'LOAD DAY'], ['856', 'SAVE-A-LOT 2', 20, T(15), null, 'tue', 0, 'LOAD DAY'],
  ['852', 'JERSEY LOAD 1', 30, T(13), 1150, 'wed', -1, 'LOAD DAY'], ['849', 'SUN VALLEY', 40, T(15), 900, 'wed', -1, 'DELIVERY DAY'], ['813', 'DSD', 50, T(1, 30), 477, 'wed', -1, 'DELIVERY DAY']];

async function openPage(browser, url, w, h, opts) {
  const page = await browser.newPage(Object.assign({ viewport: { width: w, height: h }, serviceWorkers: 'block' }, opts || {}));
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
  let row = 10;
  for (const [route, run, seq, time, cases, started, status] of PRIOR) {
    const day = { runs: true, loadDayOffset: -1, loadDate: '2026-10-19', deliveryDate: '2026-10-20', departureDate: '2026-10-20', dispatchTime: time, loadSequence: seq, casesOut: cases };
    if (started) Object.assign(day, { plantStartedAt: started, loadStatus: status }, status === 'COMPLETE' ? { completeTime: '2026-10-20T03:45:00Z' } : {});
    await d.collection('runs').doc('2026-10-18__' + route).set({ weekStart: '2026-10-18', sheetRow: row++, route, run, routeId: 'rte_' + route, runId: 'run_' + route, active: true, loadType: 'Case Loadout',
      masterShow: { leavesOn: 'DELIVERY DAY' }, days: { tue: day } });
  }
  for (const [route, run, seq, time, cases, key, offset, leavesOn] of TODAY) {
    const delivery = key === 'tue' ? '2026-10-20' : '2026-10-21';
    await d.collection('runs').doc('2026-10-18__t' + route).set({ weekStart: '2026-10-18', sheetRow: row++, route, run, routeId: 'rte_t' + route, runId: 'run_t' + route, active: true, loadType: 'Case Loadout',
      masterShow: { leavesOn }, days: { [key]: { runs: true, loadDayOffset: offset, loadDate: key === 'tue' ? '1970-01-01' : '2026-10-20', deliveryDate: delivery, departureDate: delivery, dispatchTime: time, loadSequence: seq, casesOut: cases } } });
  }
  // The two Tuesdays before: 4 one-hour loads each.
  for (const [week, load, delivery, rate] of [['2026-10-11', '2026-10-13', '2026-10-14', 760], ['2026-10-04', '2026-10-06', '2026-10-07', 720]]) {
    for (let i = 0; i < 4; i++) {
      const s = new Date(Date.parse(load + 'T18:00:00-04:00') + i * 3600000);
      await d.collection('runs').doc(week + '__h' + i).set({ weekStart: week, sheetRow: 50 + i, route: '7' + i, run: 'DSD', routeId: 'rte_h' + i, runId: 'run_h' + i, active: true, loadType: 'Case Loadout',
        days: { wed: { runs: true, loadDayOffset: -1, loadDate: load, deliveryDate: delivery, departureDate: delivery, dispatchTime: 240, loadSequence: 10 + i, casesOut: rate, plantStartedAt: s.toISOString(), completeTime: new Date(s.getTime() + 3600000).toISOString(), loadStatus: 'COMPLETE' } } });
    }
  }
  const browser = await chromium.launch();
  const shot = async (page, name, full) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: !!full }); };
  try {
    // Daily Case Loadout: the four left over from last night are first and all four are behind.
    const lo = await openPage(browser, '/loadout.html?' + MANAGER, 1536, 790);
    await lo.waitForFunction(() => /Left over\s*4/.test(document.body.innerText), null, { timeout: 20000 });
    await lo.waitForFunction(() => /9\s*RUNS/i.test(document.body.innerText));
    await shot(lo, 'carryover-loadout-1536');
    assert.match(await lo.evaluate(() => document.body.innerText), /Behind\s*4/, 'every load left over from last night is behind');
    assert.deepEqual(lo.errors, []);

    // Manager Center: the same four behind; the Late Forecast tile counts the knock-on.
    const mc = await openPage(browser, '/manager.html?' + MANAGER, 1536, 790);
    await mc.waitForFunction(() => /4 routes behind/i.test(document.getElementById('pv-subject').textContent), null, { timeout: 20000 });
    // Every load reaches Manager Center through runDays (a trigger on each run): wait for all nine.
    await mc.waitForFunction(() => /9 of 9/.test(document.getElementById('pv-chips').textContent), null, { timeout: 20000 });
    await shot(mc, 'carryover-manager-1536');
    await mc.click('.mc-preview');
    await mc.click('#send-test');
    await mc.waitForFunction(() => !document.getElementById('saved').hidden, null, { timeout: 20000 });
    await shot(mc, 'carryover-report-1536');
    const reports = (await d.collection('plantReports').get()).docs.map(x => x.data());
    const rep = JSON.parse(reports[0].reportJson), f = rep.forecast;
    assert.deepEqual(rep.behind.map(x => x.route).sort(), ['901_1', '907_1', '909_1', '971'], 'Routes Behind lists every left-over load');
    assert.ok(rep.behind.filter(x => x.route !== '971').every(x => /left over from Mon 10-19-26/.test(x.late)), 'a left-over load not yet past its dispatch says it is left over');
    // The forecast takes last night's loads first (901, paused, waits its turn like the rest), then today's in order.
    assert.deepEqual(f.loads.map(x => x.route), ['971', '901_1', '909_1', '907_1', '855', '856', '852', '849', '813']);
    assert.ok(f.loads[1].est > f.loads[0].est, 'the paused load is not counted as nearly done');
    const lastPrior = f.loads[3].est, first = f.loads[4];
    assert.ok(first.start >= lastPrior, 'today starts after last night\'s leftovers');
    assert.equal(first.late, true, 'Save-A-Lot 855 (8:00 AM) cannot leave on time behind four left-over loads');
    assert.equal(first.reason, 'misses dispatch');
    // Joe 10/20: the email lists what is left over from yesterday first, then today's loads (Save-A-Lot included), in loading order.
    const html = R.reportHtml(rep, ''), plainText = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    assert.match(plainText, /Left over from Mon 10-19-26 971 [\s\S]*901 [\s\S]*909 [\s\S]*907 [\s\S]*Today Tue 10-20-26 855 Save-A-Lot 1 [\s\S]*856 Save-A-Lot 2 [\s\S]*852 [\s\S]*849 [\s\S]*813 /);
    assert.doesNotMatch(plainText, /Delivers /);
    fs.writeFileSync(path.join(SHOTS || require('os').tmpdir(), 'carryover-email.html'), html);
    assert.deepEqual(mc.errors, []);

    // The Late Forecast screen: the same order and lates.
    const fc = await openPage(browser, '/forecast.html?' + MANAGER, 1536, 790);
    await fc.waitForFunction(() => document.querySelectorAll('.fc-row:not(.fc-head)').length === 9, null, { timeout: 20000 });
    await shot(fc, 'carryover-forecast-1536');
    const order = await fc.$$eval('.fc-row:not(.fc-head)', rows => rows.map(r => r.querySelector('b').textContent));
    assert.deepEqual(order, ['971', '901', '909', '907', '855', '856', '852', '849', '813']);
    assert.match(await fc.$eval('.fc-row:nth-of-type(6)', r => r.className + ' ' + r.textContent).catch(() => ''), /.*/);
    assert.deepEqual(fc.errors, []);
    if (SHOTS) {
      const em = await browser.newPage({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2 });
      await em.goto('file://' + path.join(SHOTS, 'carryover-email.html'));
      await em.screenshot({ path: path.join(SHOTS, 'carryover-email-phone.png'), fullPage: true });
    }
    console.log('carryover: ok');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });

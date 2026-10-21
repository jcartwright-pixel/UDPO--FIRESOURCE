'use strict';
/*
 * Late Forecast (Joe 10/19, option t): Manager Center's Late Forecast tile opens the Late Forecast screen; with Monday 10-19-26's
 * real loadout at 7:00 PM, Marietta (909) and Fairmont (907) are late (past the 6:00 AM shift end) and show red with the reason,
 * 9 loads are due by 5:00 AM, and the screen fits 1536 x 790 without scrolling. Send Test to Me saves a test-only report that
 * does not start a new round. Pictures go to SHOTS_DIR.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear, runDaysSettled } = require('../emulator/helpers');
const localCalls = require('./local-calls.cjs');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR || '';
const MANAGER = 'testEmail=manager.test@uniteddairy.com';
const NOW = '2026-10-19T23:00:00Z';
const T = (h, m) => h * 60 + (m || 0);
// [route, run, sequence, dispatch, cases, started, done]: the Live sheet's Tuesday 10-20 column, read 10-19 at 6:58 PM.
const LOADS = [
  ['849', 'SUN VALLEY', 36, T(15), 900, '2026-10-19T09:30:00Z', '2026-10-19T10:47:00Z'], ['906', 'LANCASTER TRANSFER', 35, T(4), 863, '2026-10-19T14:35:21Z', '2026-10-19T15:22:56Z'],
  ['980', 'PORTSMOUTH TRANSFER', 45, T(3), 820, '2026-10-19T17:49:14Z', '2026-10-19T17:49:17Z'], ['848', 'I/W COLUMBUS', 25, T(4), 892, '2026-10-19T17:49:33Z', '2026-10-19T19:02:23Z'],
  ['852', 'JERSEY LOAD 1', 15, T(13), 1150, '2026-10-19T17:29:22Z', '2026-10-19T20:00:44Z'], ['827', 'UT WALMART', 60, T(1), 1017, '2026-10-19T20:40:48Z', '2026-10-19T21:50:44Z'],
  ['6304', 'UT WALMART', 65, T(1), 887, '2026-10-19T21:53:05Z', '2026-10-19T22:57:31Z'], ['845', 'I/W BALTIMORE', 20, T(21), 316], ['950_1', 'CHARLESTON TRANSFER', 40, T(16), 668],
  ['971', 'PAINTSVILLE TRANSFER', 50, T(2), 812], ['813', 'DSD', 70, T(1, 30), 477], ['803', 'DSD', 75, T(4), 503], ['812', 'DSD', 80, T(5), 450], ['822', 'DSD', 85, T(4, 30), 350],
  ['808', 'DSD', 90, T(4), 516], ['8303_1', 'UT WALMART', 95, T(5, 30), 996], ['825', 'DSD', 100, T(5), 252], ['805', 'DSD', 105, T(5), 115], ['901_1', 'PRODUCT 1', 110, T(7), 853],
  ['909_1', 'MARIETTA LOAD 1', 115, T(21), 1067], ['907_1', 'FAIRMONT TRANSFER', 120, T(9), 1073]];

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
  for (const [i, [route, run, seq, time, cases, started, done]] of LOADS.entries()) {
    const day = { runs: true, loadDayOffset: -1, loadDate: '2026-10-19', deliveryDate: '2026-10-20', departureDate: route === '845' ? '2026-10-19' : '2026-10-20', dispatchTime: time, loadSequence: seq, casesOut: cases };
    if (started) Object.assign(day, { plantStartedAt: started, completeTime: done, loadStatus: 'COMPLETE' });
    await d.collection('runs').doc('2026-10-18__' + route).set({ weekStart: '2026-10-18', sheetRow: 10 + i, route, run, routeId: 'rte_' + route, runId: 'run_' + route, active: true, loadType: 'Case Loadout',
      masterShow: { leavesOn: route === '845' ? 'LOAD DAY' : 'DELIVERY DAY' }, days: { tue: day } });
  }
  // Last Monday and the Monday before: 4 one-hour loads each, 785 and 744 cases an hour.
  for (const [week, load, delivery, rate] of [['2026-10-11', '2026-10-12', '2026-10-13', 785], ['2026-10-04', '2026-10-05', '2026-10-06', 744]]) {
    for (let i = 0; i < 4; i++) {
      const s = new Date(Date.parse(load + 'T18:00:00-04:00') + i * 3600000);
      await d.collection('runs').doc(week + '__h' + i).set({ weekStart: week, sheetRow: 50 + i, route: '7' + i, run: 'DSD', routeId: 'rte_h' + i, runId: 'run_h' + i, active: true, loadType: 'Case Loadout',
        days: { tue: { runs: true, loadDayOffset: -1, loadDate: load, deliveryDate: delivery, departureDate: delivery, dispatchTime: 240, loadSequence: 10 + i, casesOut: rate, plantStartedAt: s.toISOString(), completeTime: new Date(s.getTime() + 3600000).toISOString(), loadStatus: 'COMPLETE' } } });
    }
  }
  await runDaysSettled(d);
  const browser = await chromium.launch();
  try {
    const mc = await openPage(browser, '/manager.html?' + MANAGER, 1536, 790);
    await mc.waitForFunction(() => /Plant Update/.test(document.getElementById('pv-subject').textContent));
    // The loads reach Manager Center through runDays (filled by a trigger on each run), so wait for all of them.
    await mc.waitForFunction(() => /2\s*late/.test((document.querySelector('.mc-tile[href="forecast.html"]') || {}).textContent || ''), null, { timeout: 20000 }).catch(async (e) => {
      // What the tile showed instead, so a slow or wrong fill can be told apart.
      console.error('late-forecast: the tile reads', JSON.stringify(await mc.evaluate(() => ((document.querySelector('.mc-tile[href="forecast.html"]') || {}).textContent || '(no tile)').replace(/\s+/g, ' '))), 'errors', JSON.stringify(mc.errors));
      if (SHOTS) await mc.screenshot({ path: path.join(SHOTS, 'late-forecast-timeout-1536.png') });
      throw e;
    });
    const tile = await mc.textContent('.mc-tile[href="forecast.html"]');
    assert.match(tile, /Late Forecast\s*2\s*late\s*All done est\. \d+:\d\d AM/);
    const cut = await mc.$$eval('[data-card="dept"] .mc-tile span, [data-card="dept"] .mc-tile i', els => els.filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent));
    assert.deepEqual(cut, [], 'every tile keeps its whole wording');
    if (SHOTS) await mc.screenshot({ path: path.join(SHOTS, 'late-forecast-manager-1536.png') });
    // Send Test to Me: only the sender, and the round (what was checked since the last report) does not start over.
    await mc.click('.mc-preview');
    await mc.click('#send-test');
    await mc.waitForFunction(() => !document.getElementById('saved').hidden);
    const reports = (await d.collection('plantReports').get()).docs.map(x => x.data());
    assert.equal(reports.length, 1);
    assert.equal(reports[0].testOnly, true);
    assert.match(JSON.parse(reports[0].reportJson).forecast.paceText, /Mon 10-5-26, Mon 10-12-26 \+ tonight/);
    assert.doesNotMatch(await mc.textContent('#rp-body'), /\bpace\b|cases an hour|cushion|Mon 10-12-26/i, 'the report window shows no formula');
    assert.deepEqual(mc.errors, []);

    await Promise.all([mc.waitForURL(/forecast\.html/), mc.click('.mc-tile[href="forecast.html"]')]);
    await mc.waitForSelector('.fc-row.late');
    // Past nights read in: the due-by count is the one worked out with them.
    await mc.waitForFunction(() => /9 loads\s*3,791 cases/.test(document.getElementById('band').textContent));
    // Joe 10/20: nobody sees how the forecast is worked out (no pace, cases an hour, past nights or minutes a load).
    assert.doesNotMatch(await mc.evaluate(() => document.body.innerText), /\bpace\b|cases an hour|cases\/hr|cushion|Mon 10-12-26|minutes a load|47 cases/i);
    // The label beside the bar can be cut to "4 h 10 min late" when there is no room; its hover keeps the reason.
    const late = await mc.$$eval('.fc-row.late', rows => rows.map(r => r.querySelector('b').textContent + ' ' + r.querySelector('.fc-why').title));
    assert.deepEqual(late.map(t => t.split(' ')[0]), ['909', '907']);
    late.forEach(t => assert.match(t, / late: past the 6:00 AM shift end$/));
    assert.match(await mc.textContent('#band'), /2 loads late[\s\S]*Due by 5:00 AM\s*9 loads\s*3,791 cases/);
    assert.equal(await mc.$$eval('.fc-row:not(.fc-head)', r => r.length), 14);
    assert.deepEqual(await mc.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight]), [1536, 790], 'fits without scrolling');
    await mc.selectOption('#due-by', '180');
    assert.match(await mc.textContent('#band'), /Due by 3:00 AM\s*3 loads/);
    if (SHOTS) await mc.screenshot({ path: path.join(SHOTS, 'late-forecast-1536.png') });
    assert.deepEqual(mc.errors, []);

    const phone = await openPage(browser, '/forecast.html?' + MANAGER, 390, 844, { isMobile: true, hasTouch: true });
    await phone.waitForSelector('.fc-row.late');
    assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth), 390, 'no sideways scroll on a phone');
    assert.match(await phone.textContent('.fc-row.late'), /Late: past the 6:00 AM shift end by/);
    if (SHOTS) await phone.screenshot({ path: path.join(SHOTS, 'late-forecast-390.png'), fullPage: true });
    assert.deepEqual(phone.errors, []);
    console.log('late-forecast: ok');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });

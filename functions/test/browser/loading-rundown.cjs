'use strict';
/*
 * Browser check of the Loading Rundown (Joe 10/15, Plant Reports): one plant day (6 AM to 6 AM) of made-up loads on three
 * shifts. Times come from the Plant Station tablet and the manager's desk; one End was typed in 45 minutes late, one Start was
 * moved at the desk, one End was changed on the sheet and one load has times saved before the app kept who saved them.
 * Checks the order (first started to last), where each time came from, the downtime between loads and the recap by shift,
 * at 1536 and 1920. Pictures go to SHOTS_DIR.
 */
const assert = require('node:assert/strict');
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
const SHOTS = process.env.SHOTS_DIR || '';
const MANAGER = 'testEmail=manager.test@uniteddairy.com';

async function openPage(browser, width, height, url) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: SHOTS && width === 1920 ? 2 : 1 });
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

// A New York wall time (date + minutes from that midnight, may run past 24 h) as a UTC stamp.
function nyStamp(date, minutes) {
  date = L.addDays(date, Math.floor(minutes / 1440));
  minutes = minutes % 1440;
  const [y, m, d] = date.split('-').map(Number);
  let t = Date.UTC(y, m - 1, d, 0, 0) + minutes * 60000 + 4 * 3600000;
  for (let i = 0; i < 2; i++) {
    const p = {};
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(t)).forEach(x => { p[x.type] = x.value; });
    const wall = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute));
    t += (Date.UTC(y, m - 1, d, 0, 0) + minutes * 60000) - wall;
  }
  return new Date(t).toISOString();
}
const h = (hh, mm) => hh * 60 + (mm || 0);
const TABLET = { by: 'station:st_case', name: 'Case Loadout', via: 'TABLET', station: 'Case Loadout' };
const TOTE = { by: 'station:st_tote', name: 'Tote Loadout', via: 'TABLET', station: 'Tote Loadout' };
const DESK = { by: 'mike.supervisor@uniteddairy.com', name: 'Mike Supervisor', via: 'DESK', station: '' };
const DESK2 = { by: 'dan.nightlead@uniteddairy.com', name: 'Dan Nightlead', via: 'DESK', station: '' };
// [route, run, load type, start, end, start from, end from, extra]
const LOADS = [
  ['901', 'AKRON', 'CASE LOADOUT', h(6, 20), h(7, 5), TABLET, TABLET],
  ['902', 'CANTON', 'CASE LOADOUT', h(7, 15), h(8, 0), TABLET, TABLET],
  ['903', 'MASSILLON', 'CASE LOADOUT', h(8, 10), h(9, 0), TABLET, DESK],
  ['904', 'WOOSTER', 'CASE LOADOUT', h(10, 30), h(11, 20), DESK, DESK, { endTyped: 45 }],
  ['905', 'FAIRMONT', 'CASE LOADOUT', h(11, 30), h(12, 25), TABLET, TABLET],
  ['801', 'ALDI CHARLESTON', 'TOTE', h(9, 0), h(9, 40), TOTE, TOTE],
  ['906', 'WHEELING', 'CASE LOADOUT', h(14, 40), h(15, 30), TABLET, TABLET],
  ['907', 'MARIETTA', 'CASE LOADOUT', h(15, 35), h(16, 20), DESK, DESK, { startMoved: h(16, 5) }],
  ['908', 'ZANESVILLE', 'CASE LOADOUT', h(17, 50), h(18, 40), TABLET, TABLET],
  ['909', 'PARKERSBURG', 'CASE LOADOUT', h(19, 0), h(19, 45), TABLET, TABLET],
  ['910', 'MORGANTOWN', 'CASE LOADOUT', h(22, 40), h(23, 30), DESK2, DESK2, { endSheet: h(23, 10) }],
  ['911', 'CLARKSBURG', 'CASE LOADOUT', h(23, 40), h(24, 35), TABLET, TABLET],
  ['912', 'ELKINS', 'CASE LOADOUT', h(24, 50), h(25, 40), null, null],
  ['913', 'BECKLEY', 'CASE LOADOUT', h(26, 0), h(26, 50), DESK2, DESK2]
];

async function seed() {
  const d = db(), today = L.operatingDay(new Date()), date = L.addDays(today, -1), week = L.weekStart(date), p = L.dayPrefix(date);
  for (const r of (await d.collection('runs').get()).docs) await r.ref.delete();
  for (const [i, [route, name, type, start, end, sFrom, eFrom, x]] of LOADS.entries()) {
    const extra = x || {}, startAt = nyStamp(date, start), endAt = nyStamp(date, end);
    const day = { runs: true, loadDayOffset: 0, dispatchTime: (end + 30) % 1440, loadSequence: i + 1, truck: String(300 + i), trailer: 'T-' + (40 + i), loadStatus: 'COMPLETE', plantStartedAt: startAt, completeTime: endAt };
    // A load that leaves after midnight departs the next calendar morning.
    if (end + 30 >= 1440) day.departureDate = L.addDays(date, 1);
    if (sFrom) day.startMark = Object.assign({ value: startAt, savedAt: startAt }, sFrom);
    if (eFrom) day.endMark = Object.assign({ value: endAt, savedAt: nyStamp(date, end + (extra.endTyped || 0)) }, eFrom);
    if (extra.startMoved) {
      // The tablet started it at 3:35 PM; the supervisor moved the Start to 4:05 PM at the desk at 4:30 PM.
      const moved = nyStamp(date, extra.startMoved), at = nyStamp(date, h(16, 30));
      day.plantStartedAt = moved;
      day.startMark = Object.assign({ value: moved, savedAt: at }, DESK);
      day.timeEdits = [Object.assign({ what: 'START', from: startAt, to: moved, savedAt: at, was: { name: 'Case Loadout', via: 'TABLET', station: 'Case Loadout', savedAt: startAt } }, DESK)];
    }
    // The End was changed on the sheet (outside the app): the mark still holds the time the app saved.
    if (extra.endSheet) day.completeTime = nyStamp(date, extra.endSheet);
    await d.collection('runs').doc(week + '__rd' + route).set({ weekStart: week, sheetRow: 700 + i, route, run: name, routeId: 'rte_rd' + route, runId: 'run_rd' + route, active: true, loadType: type, days: { [p]: day } });
  }
  // One load for the day never started.
  await d.collection('runs').doc(week + '__rd914').set({ weekStart: week, sheetRow: 799, route: '914', run: 'LEWISBURG', routeId: 'rte_rd914', runId: 'run_rd914', active: true, loadType: 'CASE LOADOUT',
    days: { [p]: { runs: true, loadDayOffset: 0, dispatchTime: h(20), loadSequence: 30, truck: '399', trailer: 'T-99' } } });
  return { date };
}

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date('2026-10-08T14:00:00Z') });
  const { date } = await seed();
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const [w, ht] of [[1536, 864], [1920, 1080]]) {
      // From the Reports menu's Loading Rundown link: yesterday, all loadouts.
      const pg = await openPage(browser, w, ht, '/reportcenter.html?' + MANAGER);
      await pg.waitForSelector('.rc-card[href="reports.html?view=rundown"]');
      await Promise.all([pg.waitForURL(/view=rundown/), pg.click('.rc-card[href="reports.html?view=rundown"]')]);
      await pg.waitForSelector('.rd-loads tbody tr');
      assert.equal(await pg.$eval('#report', s => s.value), 'rundown');
      assert.equal(await pg.$eval('#day', i => i.value), date);
      assert.ok(await pg.isHidden('#week-field'), 'the week box is hidden');
      const rows = await pg.$$eval('.rd-loads tbody tr', r => r.map(x => [...x.children].map(c => c.textContent.trim())));
      // First started to last: the tote at 9:00 AM sits between 903 and 904; 907's Start moved to 4:05 PM; 911-913 after midnight.
      assert.deepEqual(rows.map(r => r[1].split(' ')[0]), ['901', '902', '903', '801', '904', '905', '906', '907', '908', '909', '910', '911', '912', '913']);
      const row = (route) => rows.find(r => r[1].startsWith(route));
      assert.deepEqual(row('901').slice(3, 8), ['First Shift', '6:20 AM', 'Tablet · Case Loadout', '7:05 AM', 'Tablet · Case Loadout']);
      assert.match(row('904')[7], /^Desk · Mike Supervisorentered 12:05 PM$/, 'an End typed in 45 minutes later shows when it was entered');
      assert.match(row('907')[10], /Start 3:35 PM → 4:05 PM · Desk · Mike Supervisor · at 4:30 PM/);
      assert.equal(row('910')[7], 'Changed on the sheet');
      assert.deepEqual([row('912')[5], row('912')[7]], ['Not recorded', 'Not recorded']);
      // Downtime before: Cases 9:00 AM to 10:30 AM idle; the tote is its own loadout (first load).
      assert.equal(row('904')[9], '1 h 30 min');
      assert.equal(row('801')[9], 'first load');
      assert.equal(row('901')[9], 'first load');
      assert.equal(row('902')[9], '10 min');
      // Recap: the three Uniontown shifts and the whole day.
      const recap = await pg.$$eval('.rp-card:first-of-type tbody tr', r => r.map(x => [...x.children].map(c => c.textContent.trim())));
      assert.deepEqual(recap.map(r => r[0].split(' ').slice(0, 2).join(' ')), ['First Shift', 'Second Shift', 'Third Shift', 'Whole day']);
      assert.deepEqual(recap.map(r => r[1]), ['6', '4', '4', '14']);
      // Second Shift owns 2:30 to 10:30 PM (in an overlap the earlier shift keeps it): 2:30-2:40 PM of the gap before 906,
      // 3:30-4:05 PM (907's Start was moved), 4:20-5:50 PM, 6:40-7:00 PM and 7:45-10:30 PM = 5 h 20 min.
      assert.equal(recap[1][4], '5 h 20 min');
      assert.match(await pg.textContent('.rp-lead'), /Second Shift had the most downtime between loads/);
      assert.match(await pg.textContent('.rp-lead'), /First Shift: 1 time entered well after the time it says/);
      assert.match(await pg.textContent('.rp-lead'), /Third Shift: 1 changed on the sheet/);
      assert.match(await pg.textContent('#body'), /914 LEWISBURG[\s\S]*Never started/);
      // Joe's screen rules: 16px text or more, no sideways page scrolling, the controls on one line.
      assert.ok(await pg.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth), 'no sideways page scrolling at ' + w);
      assert.ok(await pg.evaluate(() => { const v = document.querySelector('.rp-view'); return v.scrollWidth <= v.clientWidth + 1; }), 'the report fits across at ' + w);
      const small = await pg.$$eval('#body td, #body th, .rp-ctrl select, .rp-ctrl input', els => els.filter(e => e.getClientRects().length && parseFloat(getComputedStyle(e).fontSize) < 16).length);
      assert.equal(small, 0, 'no text under 16px at ' + w);
      const tops = await pg.$$eval('.rp-ctrl > label:not([hidden])', ls => [...new Set(ls.map(l => Math.round(l.getBoundingClientRect().bottom)))]);
      assert.equal(tops.length, 1, 'the controls sit on one line at ' + w);
      if (SHOTS) {
        await pg.screenshot({ path: path.join(SHOTS, 'loading-rundown-' + w + '.png'), scale: 'css' });
        await pg.evaluate(() => { const c = document.querySelector('.rd-loads'); c.scrollIntoView({ block: 'start' }); });
        await pg.screenshot({ path: path.join(SHOTS, 'loading-rundown-loads-' + w + '.png'), scale: 'css' });
      }
      // The loads list's header stays at the top while the list scrolls under it.
      await pg.setViewportSize({ width: w, height: 760 });
      const stuck = await pg.evaluate(() => {
        const v = document.querySelector('.rp-view'), th = document.querySelector('.rd-loads thead th'), table = th.closest('table');
        v.scrollTop = table.getBoundingClientRect().top - v.getBoundingClientRect().top + v.scrollTop + 200;
        return { under: table.getBoundingClientRect().top < v.getBoundingClientRect().top - 50, off: Math.abs(th.getBoundingClientRect().top - v.getBoundingClientRect().top) };
      });
      assert.ok(stuck.under && stuck.off <= 2, 'the loads header stays in view at ' + w + ' ' + JSON.stringify(stuck));
      if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, 'loading-rundown-scrolled-' + w + '.png'), scale: 'css' });
      await pg.setViewportSize({ width: w, height: ht });
      // One loadout: Totes alone has the one tote load.
      await pg.selectOption('#area', 'TOTES');
      await pg.waitForFunction(() => document.querySelectorAll('.rd-loads tbody tr').length === 1);
      assert.match(page_url(await pg.url()), /area=TOTES/);
      // The day before has no loads.
      await pg.click('#dprev');
      await pg.waitForFunction(() => /No load was started this day/.test(document.body.textContent));
      assert.deepEqual(pg.errors, []);
      await pg.close();
      results.push(w + ': 14 loads in start order, tablet / desk / typed-later / moved / sheet shown, recap ' + recap.map(r => r[0].split(' ')[0] + ' ' + r[1] + ' loads ' + r[4]).join(', '));
    }
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('RUNDOWN ' + r));
})().catch(e => { console.error(e); process.exit(1); });

function page_url(u) { return decodeURIComponent(u); }

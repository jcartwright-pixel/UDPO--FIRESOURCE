'use strict';
/*
 * Browser check of Move Stops for This Week on Route Week Override (Joe 11-13-26, mock-up ll): after the holiday week's days are
 * set, each customer's stops go to the days that run, a low-volume customer gets fewer deliveries by Joe's case limits, a stop
 * with no cases in the last 3 weeks gets no delivery, any stop can be sent to another route and day by hand, and Use These
 * Changes keeps the list with the week (weekStopMoves) without touching the Customer List. Made-up customers only.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const F = require('../fixtures/fake-sheets');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR || '';
const NEXT = '2026-11-15', PLANNED = '2026-11-22'; // Thanksgiving is Thursday 11-26-26
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const ROWS = [['855', 'SAVE-A-LOT 1', '1111100'], ['852', 'JERSEY LOAD 1', '0111111']];
// The Hub's route customer list: route, account, customer, day, cases a day in each report week
const HUB = [['855', '101', 'SAMPLE CORNER STORE', 'MON', 5], ['855', '101', 'SAMPLE CORNER STORE', 'WED', 5], ['855', '101', 'SAMPLE CORNER STORE', 'THU', 5],
  ['855', '102', 'SAMPLE CONE SHOP', 'MON', 0], ['855', '102', 'SAMPLE CONE SHOP', 'THU', 0],
  ['855', '103', 'SAMPLE FOOD MART', 'TUE', 100], ['855', '103', 'SAMPLE FOOD MART', 'THU', 100],
  ['852', '201', 'SAMPLE MARKET', 'FRI', 50]];

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
  const d = db();
  for (const x of (await d.collection('runs').get()).docs) await x.ref.delete();
  for (const x of (await d.collection('routes').get()).docs) await x.ref.delete();
  for (let i = 0; i < ROWS.length; i++) {
    const [route, run, pat] = ROWS[i], id = 'stops_' + i, days = {}, normal = {};
    DAYS.forEach((p, j) => { days[p] = { runs: pat[j] === '1' }; normal[p] = { active: pat[j] === '1', dispatchTime: 240 }; });
    await d.collection('routes').doc(id).set({ id, route, run, weekOrder: i, displayWeekly: true, displayDaily: true, days: normal });
    await d.collection('runs').doc(NEXT + '_' + id).set({ weekStart: NEXT, route, run, routeId: id, runId: id, weekOrder: i, rev: 1, days });
  }
  for (const w of ['2026-11-01', '2026-11-08', NEXT]) await d.collection('weeks').doc(w).set({ weekStart: w });
  await d.collection('config').doc('app').set({ liveWeeks: { previous: '2026-11-01', current: '2026-11-08', next: NEXT } }, { merge: true });
  // Thanksgiving week planned: 855 does not run Thursday.
  await d.collection('weekPlans').doc(PLANNED).set({ weekStart: PLANNED, days: { stops_0: { thu: false } }, overrideReason: 'Thanksgiving' });
  const rows = HUB.map(([route, account, customer, dayName], i) => ({ plant: 'fac_uniontown', route, day: DAYS.indexOf(dayName.toLowerCase()), dayName, stop: i + 1, load: 0, key: 'k' + account, account, chain: '', customer, note: '', palletUses: '', cases: null }));
  await d.collection('hubRouteMaster').doc('fac_uniontown').set({ plant: 'fac_uniontown', rows, days: [], builtAt: '2026-11-13T12:00:00Z' });
  for (const w of ['2026-11-14', '2026-11-07', '2026-10-31', '2026-10-24']) {
    const by = {};
    HUB.forEach(([route, account, , dayName, cases]) => { const k = route + '|' + account; by[k] = by[k] || { route: Number(route), chain: 0, customer_no: Number(account), customer: 'X' }; by[k][dayName.toLowerCase()] = w === '2026-10-24' ? 999 : cases; });
    await d.collection('routeWeekly').doc(w).set({ week_ending: w, stops: Object.keys(by).map(k => Object.assign({ sun: 0, mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0 }, by[k])) });
  }
  const hubBefore = (await d.collection('hubRouteMaster').doc('fac_uniontown').get()).data();

  const browser = await chromium.launch();
  const results = [];
  try {
    const p = await openPage(browser, 1536, 790, '/routeweek.html?week=' + PLANNED + '&testEmail=manager.test@uniteddairy.com');
    await p.waitForFunction(() => document.getElementById('week-label').textContent === 'Week of 11-22-26');
    await p.waitForSelector('#stops-open:not([disabled])');
    await p.click('#stops-open');
    await p.waitForSelector('#stops-list tr[data-cust]', { timeout: 15000 });
    // Each day cell: the route that delivers and its cases, or the normal day crossed out, or NONE.
    const day = (cust, d) => p.$eval('#stops-list tr[data-cust="' + cust + '"]', (tr, i) => { const td = tr.cells[5 + i], sp = td.querySelector('span');
      return sp ? sp.className + ':' + sp.textContent : (td.classList.contains('no') ? 'no' : ''); }, DAYS.indexOf(d));
    assert.deepEqual(await p.$eval('#stops-list thead tr', tr => [...tr.cells].map(c => c.childNodes[0].textContent)), ['Chain', 'Account', 'Customer', 'Route', 'Normal', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Notes']);
    assert.deepEqual([await day('855|101', 'mon'), await day('855|101', 'wed'), await day('855|101', 'thu')], ['on:855', 'add:855', 'drop:Thu'],
      'Thursday off: the low-volume store rides on Wednesday on route 855 (3 down to 2)');
    assert.equal(await p.$eval('#stops-list tr[data-cust="855|101"]', tr => tr.cells[9].classList.contains('no')), true, 'Thursday is striped: route 855 does not run');
    assert.deepEqual([await day('855|102', 'mon')], ['none:None'], 'no cases in the last 3 weeks: no delivery');
    assert.deepEqual([await day('855|103', 'tue'), await day('855|103', 'wed')], ['on:855', 'add:855'], 'a busy store keeps 2 deliveries: Thursday moves to Wednesday');
    // Joe 11-14-26: every customer shows at first, each route with its stops a day, and a changed customer says CHANGED by its normal days.
    assert.equal(await p.$$eval('#stops-list tr[data-cust]', t => t.length), 4, 'All Customers shows every customer');
    const norm = (cust) => p.$eval('#stops-list tr[data-cust="' + cust + '"] td.c-norm', td => td.textContent);
    assert.deepEqual([await norm('855|101'), await norm('852|201')], ['Changed Mon Wed Thu', 'Fri']);
    assert.match(await p.$eval('#stops-list tr.rt', tr => tr.textContent), /Route 852 · runs Mon Tue Wed Thu Fri Sat this week · Stops Mon 0 · Tue 0 · Wed 0 · Thu 0 · Fri 1 · Sat 0 ·/);
    assert.match(await p.$$eval('#stops-list tr.rt', t => t[1].textContent), /Route 855 · runs Sun Mon Tue Wed this week · Stops Sun 0 · Mon 1 · Tue 1 · Wed 2 \(1 moved in\) ·/);
    results.push('Every customer shows at first; each route says its stops a day (moved in counted); a changed customer says CHANGED by its normal days');
    // Joe 11-14-26 ("a store running on Friday. Well, I'd like to change it to a Tuesday"): click the empty Tuesday.
    await p.click('#stops-list tr[data-cust="852|201"] td:nth-child(8) button');
    assert.deepEqual([await day('852|201', 'tue'), await day('852|201', 'fri'), await norm('852|201')], ['add:852', 'drop:Fri', 'Changed Fri']);
    assert.match(await p.$eval('#stops-list tr.rt', tr => tr.textContent), /Stops Mon 0 · Tue 1 \(1 moved in\) · Wed 0 · Thu 0 · Fri 0 · Sat 0/);
    // And back to Friday in its pop-up, where every day can be picked.
    await p.click('#stops-list tr[data-cust="852|201"] td:nth-child(11) button');
    await p.waitForSelector('#stops-cust:not([hidden])');
    assert.equal(await p.$$eval('#stops-cust tr[data-k="852|201|fri"] select[data-pick=day] option', o => o.length), 7, 'any day can be picked');
    await p.selectOption('#stops-cust tr[data-k="852|201|fri"] select[data-pick=day]', 'fri');
    await p.click('#stops-cust-close');
    assert.deepEqual([await day('852|201', 'tue'), await day('852|201', 'fri'), await norm('852|201')], ['', 'on:852', 'Fri']);
    results.push('A click on an empty day moves the delivery there (Friday to Tuesday); the pop-up offers every day and puts it back');
    // Print: every customer, each route with its stops a day.
    await p.evaluate(() => { window.print = () => {}; });
    await p.click('#stops-print');
    assert.equal(await p.$$eval('#stops-printout tbody tr:not(.rt)', t => t.length), 4, 'the printout has every customer');
    assert.match(await p.textContent('#stops-printout'), /Route 855 · Stops Sun 0 · Mon 1 · Tue 1 · Wed 2 \(1 moved in\)/);
    results.push('Print has every customer, not only the changes, with each route\'s stops a day');
    await p.click('#stops-tabs [data-stops="changes"]');
    assert.equal(await p.$$eval('#stops-list tr[data-cust]', t => t.length), 3, 'Changed shows the 3 customers that change');
    assert.match(await p.textContent('#stops-state'), /^4 changes in the plan · Not saved$/);
    results.push('Each customer on its own route, Sun to Sat: the route that delivers each day with its cases, a day taken off crossed out, NONE for no delivery');
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'routeweek-stops-1536.png') });

    // Any delivery to any route and day, by hand: click the day, pick in the customer's pop-up.
    await p.click('#stops-list tr[data-cust="855|103"] td:nth-child(10) button');
    await p.waitForSelector('#stops-cust:not([hidden])');
    await p.selectOption('#stops-cust tr[data-k="855|103|thu"] select[data-pick=route]', '852');
    await p.selectOption('#stops-cust tr[data-k="855|103|thu"] select[data-pick=day]', 'fri');
    await p.click('#stops-cust-close');
    assert.deepEqual([await day('855|103', 'wed'), await day('855|103', 'fri')], ['', 'add:852'], 'Friday shows route 852');
    results.push('A delivery picked by hand goes to route 852 on Friday, and Friday says 852');

    // Routes in my plan: untick 855 and its customers leave the list; tick it back.
    await p.click('#stops-routes-btn');
    await p.uncheck('#stops-routes input[data-route="855"]');
    assert.equal(await p.$$eval('#stops-list tr[data-cust]', t => t.length), 0);
    assert.match(await p.textContent('#stops-routes-btn'), /Routes in my plan: 852$/);
    await p.check('#stops-routes input[data-route="855"]');
    assert.equal(await p.$$eval('#stops-list tr[data-cust]', t => t.length), 3);
    results.push('Routes in my plan ticks each route in or out');

    // A case limit changed saves and works the list out again.
    await p.fill('#stops-rules input[data-rule=skipUnder]', '0');
    await p.press('#stops-rules input[data-rule=skipUnder]', 'Tab');
    await p.waitForFunction(() => !document.querySelector('#stops-list tr[data-cust="855|102"] .none'));
    let rules = null;
    for (let k = 0; k < 40 && !(rules && rules.skipUnder === 0); k++) { rules = (await d.collection('config').doc('holidayStopRules').get()).data(); await new Promise(r => setTimeout(r, 250)); }
    assert.equal(rules.skipUnder, 0);
    await p.fill('#stops-rules input[data-rule=skipUnder]', '3');
    await p.press('#stops-rules input[data-rule=skipUnder]', 'Tab');
    await p.waitForSelector('#stops-list tr[data-cust="855|102"] .none');
    results.push('The case limits save when changed and the suggestions follow them');

    // A note, then Save: kept, not used yet.
    await p.fill('#stops-list input[data-note="855|102"]', 'Closed for the season');
    await p.click('#stops-save');
    await p.waitForFunction(() => /Saved .*not used yet/.test(document.getElementById('stops-state').textContent), null, { timeout: 10000 });
    let doc0 = (await d.collection('weekStopMoves').doc(PLANNED).get()).data();
    assert.equal(doc0.draft.notes['855|102'], 'Closed for the season');
    assert.deepEqual(doc0.changes || [], [], 'Save does not use the changes');
    results.push('Save keeps the note and the changes without using them');

    await p.click('#stops-use');
    await p.waitForFunction(() => /Used for this week/.test(document.getElementById('stops-state').textContent), null, { timeout: 10000 });
    const saved = (await d.collection('weekStopMoves').doc(PLANNED).get()).data();
    assert.deepEqual(saved.changes.map(c => [c.route, c.account, c.fromDay, c.toRoute, c.toDay, c.kind]),
      [['855', '102', 'mon', '', '', 'skip'], ['855', '102', 'thu', '', '', 'skip'], ['855', '101', 'thu', '855', 'wed', 'join'], ['855', '103', 'thu', '852', 'fri', 'hand']]);
    assert.equal(saved.notes['855|102'], 'Closed for the season');
    assert.deepEqual((await d.collection('hubRouteMaster').doc('fac_uniontown').get()).data(), hubBefore, 'the route customer list is not changed');
    results.push('Use These Changes keeps the 4 changes and the note with the week; the route customer list is untouched');

    // Start Over asks first; Cancel keeps the pick.
    await p.click('#stops-over');
    await p.waitForSelector('#stops-ask:not([hidden])');
    await p.click('#stops-ask-no');
    assert.equal(await day('855|103', 'fri'), 'add:852');
    await p.click('#stops-over');
    await p.click('#stops-ask-yes');
    assert.equal(await day('855|103', 'wed'), 'add:855');
    results.push('Start Over asks first, then puts the hand pick back to the suggestion');

    // Reopened after a reload: the used changes and the note come back.
    await p.goto(HOSTING + '/routeweek.html?week=' + PLANNED + '&testEmail=manager.test@uniteddairy.com');
    await p.waitForFunction(() => document.getElementById('week-label').textContent === 'Week of 11-22-26');
    await p.waitForSelector('#stops-open:not([disabled])');
    await p.click('#stops-open');
    await p.waitForSelector('#stops-list tr[data-cust="855|103"]', { timeout: 15000 });
    assert.equal(await day('855|103', 'fri'), 'add:852');
    assert.equal(await p.inputValue('#stops-list input[data-note="855|102"]'), 'Closed for the season');
    assert.match(await p.textContent('#stops-state'), /Used for this week/);
    results.push('After a reload the used changes come back, the hand pick and the note included');
    assert.deepEqual(p.errors, []);
    await p.close();
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('ok - ' + r));
})().catch(err => { console.error(err); process.exit(1); });

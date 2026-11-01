'use strict';
/*
 * Joe 10/31 (mock-up 2d): the Sales app (sales.html). Any United Dairy account opens it, even one not on the Users list. The map
 * stays on top; the routes scroll under it (Route, Driver, Status, Where now); a tap moves the map to that truck. A place marked
 * in Fleet shows by its name. Pictures at 390, 768, 1024 and 1536 go to SHOTS_DIR.
 * Joe 11/1 (mock-ups 1-5): the app opens on two cards; Customers by route lists a route's customers for a day, every day and
 * route of a customer, and a group's customers (Dairy Queen). The customers come only from the Customer List app; nothing is
 * uploaded in Operations. Made-up customers only.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
// (The made-up times are written in summer time, -04:00; after the clocks change they read an hour off, which no check here minds.)
const { db, clear } = require('../emulator/helpers');
const L = require('../../src/logic');
const localCalls = require('./local-calls.cjs');

const HOSTING = process.argv[2] || 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR;
// The Route Menu's Customer By Route tab, made up: [day, route, chain, account, name].
const MENU = [
  ['TUE', 803, 0, 1196, 'ACORN CORNER MARKET'], ['FRI', 803, 0, 1196, 'ACORN CORNER MARKET'], ['TUE', 803, 0, 40463, 'DQ HILLVIEW'],
  ['TUE', 803, 0, 40471, '...DQ RIVERSIDE'], ['THU', 805, 0, 13590, 'DQ BETHEL KNOLL'], ['SAT', 805, 0, 13590, 'DQ BETHEL KNOLL'],
  ['MON', 808, 990, 2603, 'WAL-MART #2603 MAPLETON'], ['THU', 808, 990, 2603, 'WAL-MART #2603 MAPLETON'], ['WED', 808, 990, 1885, 'WAL-MART #1885 PINEDALE'],
  ['WED', 812, 10, 48, 'BFS FOODS #48 OAKMONT'], ['FRI', '', 0, 271285, 'LAKESIDE SCOOPS'], ['FRI', 803, 0, 231705, 'FIFTH STREET MARKET'],
  ['FRI', 803, 0, 231705, 'FIFTH STREET MARKET']
];

// Joe 11/1 (mock-ups 2-5): Customers by route, on a phone, from the Customer List app (below).
async function customers(pg) {
  await pg.click('[data-go="customers"]');
  await pg.waitForSelector('#cu-route option[value="803"]', { state: 'attached' });
  assert.equal(await pg.textContent('#sa-title'), 'Customers');
  assert.match(await pg.getAttribute('#sa-help', 'href'), /^help\.html\?for=sales\.html%3Fview%3Dcustomers(&|$)/);
  // By route: the routes (the line with no route is not one), a blank pick first.
  assert.deepEqual(await pg.$$eval('#cu-route option', o => o.map(x => x.value)), ['', '803', '805', '808', '812']);
  await pg.selectOption('#cu-route', '803');
  assert.deepEqual(await pg.$$eval('#cu-days .sa-day.has', d => d.map(x => x.textContent)), ['Tue', 'Fri'], 'dark = the days 803 runs');
  await pg.click('#cu-days >> text=Tue');
  assert.equal(await pg.textContent('#cu-list .sa-group'), 'Route 803, Tuesday: 3 customers');
  assert.deepEqual((await pg.$$eval('#cu-list .cu-row', r => r.map(x => x.textContent))).sort(), ['...DQ RIVERSIDE#40471', 'ACORN CORNER MARKET#1196', 'DQ HILLVIEW#40463'].sort(), 'the old upload is not shown');
  assert.equal(await pg.textContent('#cu-foot'), 'From the Customer List app, last changed 11-01-26.');
  if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, 'sales-390-customers-by-route.png'), fullPage: true });
  await pg.click('#cu-days >> text=Fri');
  assert.equal(await pg.textContent('#cu-list .sa-group'), 'Route 803, Friday: 2 customers', 'the line in twice counts once');
  // By customer: every day and route of a customer; a tap on a route opens that route and day.
  await pg.click('[data-tab="customer"]');
  await pg.fill('#cu-find', 'bethel');
  assert.equal(await pg.textContent('.cu-res h3'), 'DQ BETHEL KNOLL#13590');
  assert.deepEqual(await pg.$$eval('.cu-res .cu-grid > *', c => c.map(x => x.textContent)), ['Delivery day', 'Route', 'Thursday', '805', 'Saturday', '805']);
  if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, 'sales-390-customers-by-customer.png'), fullPage: true });
  await pg.fill('#cu-find', 'lakeside');
  assert.match(await pg.textContent('.cu-res'), /FridayNo route/);
  await pg.fill('#cu-find', 'bethel');
  await pg.click('.cu-go[data-route="805"][data-day="SAT"]');
  assert.equal(await pg.textContent('#cu-list .sa-group'), 'Route 805, Saturday: 1 customer');
  // By group: Dairy Queen (every DQ name, with its dots too), then the chains; a chain with one customer is with the Independents.
  await pg.click('[data-tab="group"]');
  assert.deepEqual(await pg.$$eval('.cu-grp', g => g.map(x => x.textContent)), ['Dairy Queen3 customers ›', 'Walmart2 customers ›', 'Independents4 customers ›']);
  if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, 'sales-390-customers-groups.png'), fullPage: true });
  await pg.click('.cu-grp[data-group="Dairy Queen"]');
  assert.equal(await pg.textContent('#cu-list .sa-group'), 'Dairy Queen: 3 customers');
  assert.deepEqual((await pg.$$eval('.cu-cust', c => c.map(x => x.querySelector('b').textContent + ' | ' + [...x.querySelectorAll('.cu-go')].map(b => b.textContent).join(', ')))).sort(),
    ['...DQ RIVERSIDE | Tue 803', 'DQ BETHEL KNOLL | Thu 805, Sat 805', 'DQ HILLVIEW | Tue 803'].sort());
  if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, 'sales-390-customers-dairy-queen.png'), fullPage: true });
  await pg.click('#cu-all-groups');
  await pg.waitForSelector('.cu-grp');
  const small = await pg.$$eval('#v-customers *', x => x.filter(e => e.offsetWidth && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) < 16).map(e => e.textContent.trim()));
  assert.deepEqual(small, []);
  assert.ok(await pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scroll on Customers');
}

// Joe 11/1: "Any changes or ever, it goes through that": the customers are on the Customer List app (its records in the main
// database, made up here from MENU). The old upload, still in the database, is never shown again.
async function customerList() {
  const P = 'fac_uniontown', b = db().batch(), days = {}, seen = new Set(), unrouted = [];
  MENU.forEach(([day, route, chain, account, name]) => {
    const key = String(account), c = chain ? String(chain) : '';
    b.set(db().collection('udclCustomers').doc(P + '__' + key), { plant: P, key, account: key, chain: c, name, active: true, updatedAt: '2026-11-01T13:00:00.000Z' });
    if (!route) { unrouted.push({ day, account: key, chain: c, name }); return; }
    const id = route + '__' + day;
    if (seen.has(id + key)) return;
    seen.add(id + key);
    (days[id] = days[id] || { plant: P, route: String(route), day, stops: [] }).stops.push({ key, account: key, name });
  });
  Object.keys(days).forEach(id => b.set(db().collection('udclRouteDays').doc(P + '__' + id), days[id]));
  b.set(db().collection('private').doc('udcl_' + P), { plant: P, at: '2026-11-01T12:00:00.000Z', unrouted });
  b.set(db().collection('salesCustomers').doc(P), { rows: [{ day: 'TUE', route: '803', account: '1', chain: '', name: 'OLD UPLOAD ONLY' }], savedAt: '2026-10-01T12:00:00.000Z' });
  await b.commit();
}

// Administration > Sales App: no upload any more, only where the customers come from.
async function adminNote(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1536, height: 864 }, serviceWorkers: 'block' });
  await ctx.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (r) => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, r.request().url().split('/').pop())) }));
  await localCalls(ctx);
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  await p.goto(HOSTING + '/administration.html?testEmail=sales.admin@uniteddairy.com');
  // The Administration menu's groups fold (#577): open the item's group first.
  await p.waitForSelector('.adm-item[data-key="sales-app"]', { state: 'attached' });
  await p.$eval('.adm-item[data-key="sales-app"]', b => { if (!b.offsetParent) b.closest('.adm-nav-group').querySelector('.adm-gh').click(); });
  await p.click('.adm-item[data-key="sales-app"]');
  await p.waitForSelector('#sc-from');
  assert.match(await p.textContent('#sc-from'), /customers from the Customer List app\. Every change .* is made there/);
  assert.equal(await p.$$eval('#sc-file, #sc-save, #sc-groups, .sc-group', x => x.length), 0, 'no upload and no group renames here');
  // The Customer List's web site is this one's with -customers on the end.
  assert.equal(await p.evaluate(async () => { const m = await import('/js/admin-pages.js'); return [m.customersAppUrl('ud-distribution-sandbox.web.app'), m.customersAppUrl('ud-distribution.web.app'), m.customersAppUrl('127.0.0.1')].join(' '); }),
    'https://ud-distribution-sandbox-customers.web.app/ https://ud-distribution-customers.web.app/ ');
  if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'admin-sales-app-customers-1536.png'), fullPage: true });
  assert.deepEqual(errors, []);
  await ctx.close();
}

(async () => {
  await clear();
  await db().collection('users').doc('sales.admin@uniteddairy.com').set({ name: 'Test Admin', status: 'ACTIVE', roles: ['ADMIN'], facilities: ['*'], cells: { id: 'usr_sadm', version: '1' } });
  // Today's loads (delivered tomorrow) and yesterday's (delivered today), each with a trailer, a truck and a made-up driver.
  const today = L.operatingDay(new Date()), now = new Date().toISOString();
  const b = db().batch();
  const add = (id, route, loadDate, day) => {
    const delivery = L.addDays(loadDate, 1), prefix = L.dayPrefix(delivery), week = L.weekStart(delivery);
    b.set(db().collection('runs').doc(week + '__' + id), { weekStart: week, route, run: 'Run ' + route, routeId: 'rte_' + id, runId: id, rev: 0, routeStatus: 'ACTIVE', masterShow: { daily: true, leavesOn: 'Delivery Day' },
      days: { [prefix]: Object.assign({ runs: true, deliveryDate: delivery, loadDate }, day) } });
  };
  add('sa802', '802', L.addDays(today, -1), { dispatchTime: 210, driver: 'Sam Porter', trailer: 'T-801', truck: '701', completeTime: L.addDays(today, -1) + 'T23:00:00-04:00' });
  add('sa811', '811', L.addDays(today, -1), { dispatchTime: 270, driver: 'Dana Whitfield', trailer: 'T-802', truck: '702', completeTime: L.addDays(today, -1) + 'T23:30:00-04:00' });
  // Joe 11/1 (mock-up 3): a name typed in capitals, the GPS's "US|zip|road [route]" address, and a place too long for one line.
  add('sa812', '812', L.addDays(today, -1), { dispatchTime: 300, driver: 'PRATT JR, MICHAEL', trailer: 'T-803', truck: '703', completeTime: L.addDays(today, -1) + 'T23:40:00-04:00' });
  add('sa813', '813', L.addDays(today, -1), { dispatchTime: 330, driver: 'Ortiz, Samuel', trailer: 'T-804', truck: '704', completeTime: L.addDays(today, -1) + 'T23:50:00-04:00' });
  add('sa815', '815', today, { dispatchTime: 1400, driver: 'Tina Moss', trailer: 'T-805', truck: '705' });
  add('sa820', '820', today, { runs: false, dispatchTime: 1300, driver: 'Nobody Running' });
  b.set(db().collection('gpsTrucks').doc('T-801'), { tag: 'T-801', unitId: 'U801', lat: 40.69, lon: -80.1, address: 'I-79 N, Cranberry, PA', place: '', speedMph: 61, lastReport: now });
  b.set(db().collection('gpsTrucks').doc('702'), { tag: '702', unitId: 'U702', lat: 39.63, lon: -79.95, address: '100 Mall Rd, Morgantown, WV', place: 'Walmart 2291', speedMph: 0, lastReport: now });
  b.set(db().collection('gpsTrucks').doc('T-803'), { tag: 'T-803', unitId: 'U803', lat: 39.7, lon: -78.9, address: 'US|21795|Mary Rd [MD-63]', place: '', speedMph: 0, lastReport: now });
  b.set(db().collection('gpsTrucks').doc('T-804'), { tag: 'T-804', unitId: 'U804', lat: 39.65, lon: -78.76, address: 'I-68 E near Cumberland, Allegany County, Maryland 21502', place: '', speedMph: 58, lastReport: now });
  b.set(db().collection('gpsTrucks').doc('705'), { tag: '705', unitId: 'U705', lat: 39.9, lon: -79.72, address: '', place: 'Uniontown Plant', speedMph: 0, lastReport: now });
  // When they left: 802's trailer trip (its GPS saw it leave), 811's truck (its trailer has no GPS unit).
  const left = (h, m) => new Date(Date.parse(today + 'T0' + h + ':' + m + ':00-04:00')).toISOString();
  b.set(db().collection('gpsReefer').doc('T-801'), { id: L.weekStart(today) + '__sa802|' + L.dayPrefix(today), unitId: 'U801', out: left(3, 20) });
  b.set(db().collection('gpsDays').doc(today + '_702'), { tag: '702', date: today, yardOut: left(5, 42) });
  await b.commit();

  const browser = await chromium.launch();
  try {
    await customerList();
    await adminNote(browser);
    for (const w of [390, 768, 1024, 1536]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, isMobile: w < 700, hasTouch: true, serviceWorkers: 'block' });
      await ctx.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (r) => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, r.request().url().split('/').pop())) }));
      // No outside network in the test: the map is a plain stand-in page.
      await ctx.route(/https:\/\/maps\.google\.com\//, (r) => r.fulfill({ contentType: 'text/html', body: '<body style="margin:0;background:#e9efe4;font:16px Arial;display:flex;align-items:center;justify-content:center;height:100vh">Google map here</body>' }));
      await localCalls(ctx);
      const pg = await ctx.newPage();
      const errors = [];
      pg.on('pageerror', e => errors.push(e.message));
      // Not on the Users list: a United Dairy account is enough (Joe 10/31).
      await pg.goto(HOSTING + '/sales.html?testEmail=pat.seller@uniteddairy.com');
      // Joe 11/1 (mock-up 1): it opens on two cards.
      await pg.waitForSelector('#v-home:not([hidden]) .sa-card');
      assert.deepEqual(await pg.$$eval('.sa-card b', b => b.map(x => x.textContent)), ['Where the routes are', 'Customers by route']);
      assert.ok(await pg.isHidden('#sa-back'), 'no Back on the cards');
      await pg.waitForFunction(() => document.querySelector('#sa-division').options.length > 0);
      assert.match(await pg.getAttribute('#sa-help', 'href'), /^help\.html\?for=sales\.html(&|$)/);
      if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, 'sales-' + w + '-cards.png') });
      await pg.click('[data-go="routes"]');
      await pg.waitForSelector('.sa-row');
      assert.equal(await pg.textContent('#sa-title'), 'Route Status');
      assert.match(pg.url(), /sales\.html\?view=routes/);
      assert.deepEqual(await pg.$$eval('.sa-group', x => x.map(e => e.textContent.split(',')[0].split(' ')[0])), ['Today', 'Loaded']);
      const rows = await pg.$$eval('.sa-row', x => x.map(r => ['.sa-route', '.sa-driver', '.sa-where'].map(c => r.querySelector(c).textContent.trim())));
      assert.deepEqual(rows, [['815', 'Tina Moss', 'At the plant'], ['802', 'Sam Porter', 'On the road: I-79 N, Cranberry, PA'], ['811', 'Dana Whitfield', 'At Walmart 2291'],
        ['812', 'Pratt Jr, Michael', 'Stopped: Mary Rd (MD-63), 21795'], ['813', 'Ortiz, Samuel', 'On the road: I-68 E near Cumberland, Allegany County, Maryland 21502']], '820 (Ended Up Not Running) left off');
      assert.match(await pg.textContent('.sa-row[data-id*="sa811"] .sa-pill'), /^Left \d{1,2}:\d{2} [AP]M, (\d+h )?\d+m late$/, 'the status short: 1h 12m, not 1 hr 12 min');
      // Joe 11/1 (mock-up 3): every route is exactly two lines: route and status, then driver · where now, never wrapped.
      const lines = await pg.$$eval('.sa-row', x => x.map(r => {
        const one = r.querySelector('.sa-l1'), two = r.querySelector('.sa-l2'), lh = (e) => parseFloat(getComputedStyle(e).fontSize) * 1.6;
        return { one: one.getBoundingClientRect().height <= lh(one) + 8, two: two.getBoundingClientRect().height <= lh(two), under: Math.abs(two.getBoundingClientRect().left - r.querySelector('.sa-route').getBoundingClientRect().left) < 2 };
      }));
      assert.ok(lines.every(l => l.one && l.two && l.under), 'two lines a route, the driver under the route number: ' + JSON.stringify(lines));
      assert.equal(await pg.textContent('.sa-cols'), 'RouteStatusDriver · Where now');
      assert.equal(await pg.$eval('#sa-division', s => s.options[s.selectedIndex].text), 'Uniontown');
      assert.match(await pg.textContent('#sa-refreshed'), /^\d{1,2}:\d{2} [AP]M$/);
      assert.ok(await pg.isHidden('#sa-map'), 'no map until a route is tapped');
      // Tap 811: the map moves there.
      await pg.click('.sa-row[data-id$="|' + L.dayPrefix(today) + '"] >> text=Dana Whitfield');
      assert.match(await pg.getAttribute('#sa-map', 'src'), /q=39\.63,-79\.95/);
      assert.match(await pg.textContent('#sa-map-title'), /^811 Dana Whitfield, GPS at /);
      assert.equal(await pg.textContent('#sa-map-where'), 'At Walmart 2291');
      // Scrolled to the bottom, the map is still on top, and a tap moves it again.
      await pg.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      const top = await pg.$eval('.sa-map-box', e => e.getBoundingClientRect().top);
      assert.ok(top >= 0 && top < 200, 'the map stays on top: ' + top);
      await pg.click('text=Sam Porter');
      assert.match(await pg.getAttribute('#sa-map', 'src'), /q=40\.69,-80\.1/);
      // A place too long for its line ends in "…" on the phone; tapped, the whole place is under the map.
      if (w === 390) assert.ok(await pg.$eval('.sa-row[data-id*="sa813"] .sa-l2', e => e.scrollWidth > e.clientWidth && getComputedStyle(e).textOverflow === 'ellipsis'), 'the long place is cut with …');
      await pg.click('text=Ortiz, Samuel');
      assert.equal(await pg.textContent('#sa-map-where'), 'On the road: I-68 E near Cumberland, Allegany County, Maryland 21502');
      // Text at least 16px; nothing wider than the phone.
      const small = await pg.$$eval('.sa-row *, .sa-cols *, .sa-sub *, .sa-map *', x => x.filter(e => e.textContent.trim() && parseFloat(getComputedStyle(e).fontSize) < 16).map(e => e.textContent.trim()));
      assert.deepEqual(small, []);
      assert.ok(await pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scroll at ' + w);
      // Help opens the Sales part (the routes screen).
      assert.match(await pg.getAttribute('#sa-help', 'href'), /^help\.html\?for=sales\.html%3Fview%3Droutes(&|$)/);
      if (SHOTS) {
        await pg.evaluate(() => window.scrollTo(0, 0));
        await pg.click('text=Dana Whitfield');
        await pg.screenshot({ path: path.join(SHOTS, 'sales-' + w + '-tapped-811.png') });
        await pg.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await pg.click('text=Sam Porter');
        await pg.screenshot({ path: path.join(SHOTS, 'sales-' + w + '-scrolled-tapped-802.png') });
        // Joe 11/1 (mock-up 3): a place cut off with "…" shows whole under the map once the route is tapped.
        await pg.click('text=Pratt Jr, Michael');
        await pg.evaluate(() => window.scrollTo(0, 0));
        await pg.screenshot({ path: path.join(SHOTS, 'sales-' + w + '-tapped-812.png') });
      }
      // Back comes to the cards.
      await pg.click('#sa-back');
      await pg.waitForSelector('#v-home:not([hidden])');
      assert.ok(await pg.isHidden('#sa-maparea'), 'the map is only on the routes screen');
      if (w === 390) await customers(pg);
      assert.deepEqual(errors, []);
      await ctx.close();
    }
    // An account outside United Dairy is signed out and told why.
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    await ctx.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (r) => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, r.request().url().split('/').pop())) }));
    await localCalls(ctx);
    const pg = await ctx.newPage();
    await pg.goto(HOSTING + '/sales.html?testEmail=someone@gmail.com');
    await pg.waitForSelector('#error:not([hidden])');
    assert.match(await pg.textContent('#error'), /Only United Dairy Google accounts/);
    assert.ok(await pg.isHidden('#screen'));
    console.log('sales-app: ok');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });

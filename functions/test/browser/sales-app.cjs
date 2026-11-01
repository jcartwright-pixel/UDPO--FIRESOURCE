'use strict';
/*
 * Joe 10/31 (mock-up 2d): the Sales app (sales.html). Any United Dairy account opens it, even one not on the Users list. The map
 * stays on top; the routes scroll under it (Route, Driver, Status, Where now); a tap moves the map to that truck. A place marked
 * in Fleet shows by its name. Pictures at 390, 768 and 1024 go to SHOTS_DIR.
 * Joe 11/1 (mock-ups 1-5): the app opens on two cards; Customers by route lists a route's customers for a day, every day and
 * route of a customer, and a group's customers (Dairy Queen). The list is loaded on Administration > Sales App from the Route
 * Menu workbook (its Customer By Route tab); a group can be renamed there. Made-up customers only.
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
const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
// The Route Menu's Customer By Route tab, made up: [day, route, chain, account, name].
const MENU = [
  ['TUE', 803, 0, 1196, 'ACORN CORNER MARKET'], ['FRI', 803, 0, 1196, 'ACORN CORNER MARKET'], ['TUE', 803, 0, 40463, 'DQ HILLVIEW'],
  ['TUE', 803, 0, 40471, '...DQ RIVERSIDE'], ['THU', 805, 0, 13590, 'DQ BETHEL KNOLL'], ['SAT', 805, 0, 13590, 'DQ BETHEL KNOLL'],
  ['MON', 808, 990, 2603, 'WAL-MART #2603 MAPLETON'], ['THU', 808, 990, 2603, 'WAL-MART #2603 MAPLETON'], ['WED', 808, 990, 1885, 'WAL-MART #1885 PINEDALE'],
  ['WED', 812, 10, 48, 'BFS FOODS #48 OAKMONT'], ['FRI', '', 0, 271285, 'LAKESIDE SCOOPS'], ['FRI', 803, 0, 231705, 'FIFTH STREET MARKET'],
  ['FRI', 803, 0, 231705, 'FIFTH STREET MARKET']
];

// Joe 11/1 (mock-ups 2-5): Customers by route, on a phone, after the list was loaded on Administration (below).
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
  assert.deepEqual((await pg.$$eval('#cu-list .cu-row', r => r.map(x => x.textContent))).sort(), ['...DQ RIVERSIDE#40471', 'ACORN CORNER MARKET#1196', 'DQ HILLVIEW#40463'].sort());
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
  assert.deepEqual(await pg.$$eval('.cu-grp', g => g.map(x => x.textContent)), ['Dairy Queen3 customers ›', 'Big Box Stores2 customers ›', 'Independents4 customers ›']);
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

// Administration > Sales App: the Route Menu workbook in, the list saved for Uniontown, a group renamed.
async function uploadMenu(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1536, height: 864 }, serviceWorkers: 'block' });
  await ctx.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (r) => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, r.request().url().split('/').pop())) }));
  if (process.env.XLSX_LOCAL) await ctx.route(XLSX_URL, r => r.fulfill({ path: process.env.XLSX_LOCAL, contentType: 'application/javascript' }));
  await localCalls(ctx);
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  await p.goto(HOSTING + '/administration.html?testEmail=sales.admin@uniteddairy.com');
  await p.click('.adm-item[data-key="sales-app"]');
  await p.waitForSelector('#sc-list tr');
  assert.match(await p.textContent('#sc-list'), /UniontownNot loaded/);
  // The workbook, made in the page with the Excel reader: a tab before it, then Customer By Route with Joe's headings.
  await p.evaluate((u) => new Promise((ok, bad) => { const s = document.createElement('script'); s.src = u; s.onload = ok; s.onerror = bad; document.head.appendChild(s); }), XLSX_URL);
  const b64 = await p.evaluate((menu) => {
    const X = window.XLSX, wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([['Chain', 'Account', 'Customer'], [0, 1, 'NOT THIS ONE']]), 'Cases By Cust Vol');
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([['DAY', 'ROUTE', 'Chain', 'Account', 'Name']].concat(menu)), 'Customer By Route');
    return X.write(wb, { type: 'base64', bookType: 'xlsx' });
  }, MENU);
  await p.setInputFiles('#sc-file', { name: 'Route Menu.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(b64, 'base64') });
  await p.waitForSelector('#sc-check .ap-msg');
  assert.match(await p.textContent('#sc-check'), /Route Menu\.xlsx: 9 customers on 4 routes \(13 lines\)\. 1 line has no route.*Pick the division/);
  assert.ok(await p.isDisabled('#sc-save'), 'no save until the division is picked');
  await p.selectOption('#sc-plant', 'fac_uniontown');
  await p.click('#sc-save');
  await p.waitForSelector('.ap > .ap-msg.good:not([hidden])');
  assert.match(await p.textContent('.ap > .ap-msg.good'), /Saved 9 customers on 4 routes for Uniontown/);
  const saved = (await db().collection('salesCustomers').doc('fac_uniontown').get()).data();
  assert.equal(saved.rows.length, 12, 'the line in twice is kept once');
  assert.deepEqual(saved.rows.find(r => r.name === 'LAKESIDE SCOOPS'), { day: 'FRI', route: '', account: '271285', chain: '', name: 'LAKESIDE SCOOPS' });
  assert.equal(saved.savedBy, 'sales.admin@uniteddairy.com');
  // Group names: the guesses, then Walmart renamed (it stays through the next upload).
  assert.deepEqual(await p.$$eval('#sc-groups tbody tr', r => r.map(x => x.querySelector('input').value + ' ' + x.children[1].textContent)), ['Dairy Queen 3', 'Walmart 2']);
  await p.fill('.sc-group[data-key="chain:990"]', 'Big Box Stores');
  await p.press('.sc-group[data-key="chain:990"]', 'Tab');
  await p.waitForFunction(() => document.querySelector('.sc-group[data-key="chain:990"]').dataset.was === 'Big Box Stores');
  assert.equal((await db().collection('salesCustomers').doc('fac_uniontown').get()).data().groupNames['chain:990'], 'Big Box Stores');
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
  add('sa815', '815', today, { dispatchTime: 1400, driver: 'Tina Moss', trailer: 'T-805', truck: '705' });
  add('sa820', '820', today, { runs: false, dispatchTime: 1300, driver: 'Nobody Running' });
  b.set(db().collection('gpsTrucks').doc('T-801'), { tag: 'T-801', unitId: 'U801', lat: 40.69, lon: -80.1, address: 'I-79 N, Cranberry, PA', place: '', speedMph: 61, lastReport: now });
  b.set(db().collection('gpsTrucks').doc('702'), { tag: '702', unitId: 'U702', lat: 39.63, lon: -79.95, address: '100 Mall Rd, Morgantown, WV', place: 'Walmart 2291', speedMph: 0, lastReport: now });
  b.set(db().collection('gpsTrucks').doc('705'), { tag: '705', unitId: 'U705', lat: 39.9, lon: -79.72, address: '', place: 'Uniontown Plant', speedMph: 0, lastReport: now });
  // When they left: 802's trailer trip (its GPS saw it leave), 811's truck (its trailer has no GPS unit).
  const left = (h, m) => new Date(Date.parse(today + 'T0' + h + ':' + m + ':00-04:00')).toISOString();
  b.set(db().collection('gpsReefer').doc('T-801'), { id: L.weekStart(today) + '__sa802|' + L.dayPrefix(today), unitId: 'U801', out: left(3, 20) });
  b.set(db().collection('gpsDays').doc(today + '_702'), { tag: '702', date: today, yardOut: left(5, 42) });
  await b.commit();

  const browser = await chromium.launch();
  try {
    await uploadMenu(browser);
    for (const w of [390, 768, 1024]) {
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
      const rows = await pg.$$eval('.sa-row', x => x.map(r => [...r.children].map(c => c.textContent.trim())));
      assert.deepEqual(rows.map(r => [r[0], r[1], r[3]]), [['815', 'Tina Moss', 'At the plant'], ['802', 'Sam Porter', 'On the road near I-79 N, Cranberry, PA'], ['811', 'Dana Whitfield', 'At Walmart 2291']], '820 (Ended Up Not Running) left off');
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

'use strict';
/*
 * Joe 10/31 (mock-up 2d): the Sales app (sales.html). Any United Dairy account opens it, even one not on the Users list. The map
 * stays on top; the routes scroll under it (Route, Driver, Status, Where now); a tap moves the map to that truck. A place marked
 * in Fleet shows by its name. Pictures at 390, 768 and 1024 go to SHOTS_DIR.
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

(async () => {
  await clear();
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
      await pg.waitForSelector('.sa-row');
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
      // Help opens the Sales part.
      assert.match(await pg.getAttribute('#sa-help', 'href'), /^help\.html\?for=sales\.html(&|$)/);
      if (SHOTS) {
        await pg.evaluate(() => window.scrollTo(0, 0));
        await pg.click('text=Dana Whitfield');
        await pg.screenshot({ path: path.join(SHOTS, 'sales-' + w + '-tapped-811.png') });
        await pg.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await pg.click('text=Sam Porter');
        await pg.screenshot({ path: path.join(SHOTS, 'sales-' + w + '-scrolled-tapped-802.png') });
      }
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

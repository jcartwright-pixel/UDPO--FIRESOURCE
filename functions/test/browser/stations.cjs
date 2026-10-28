'use strict';
/*
 * Browser check of the last six screens (10/10): Garage Station (name + login ID, jobs), the drivers' View Loadout and DVIR
 * on the phone page, the Driver Station board and its TV, Trailer Assignments (desk and phone) and the Plant Station picker.
 * With SHOTS=<folder> it also saves a picture of each.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const { newRouteCode, phoneCall } = require('../../src/phone');
const { garageCall } = require('../../src/garage');
const F = require('../fixtures/fake-sheets');
const G = require('../fixtures/garage-demo');
const PD = require('../fixtures/plant-demo');
const localCalls = require('./local-calls.cjs');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const MANAGER = '?testEmail=manager.test@uniteddairy.com';
const SHOTS = process.env.SHOTS || '';

async function openPage(browser, width, height, url, clock, touch) {
  const page = await browser.newPage(Object.assign(touch ? { viewport: { width, height }, hasTouch: true, isMobile: true } : { viewport: { width, height } }, { serviceWorkers: 'block' }));
  if (clock) await page.clock.setFixedTime(new Date(clock));
  await localCalls(page);
  // Joe 10/27: no live weather picture in these checks (YouTube is refused), so the TV's weather turn shows the local weather.
  await page.route(/youtube\.com/, route => route.abort());
  // The public callables answer straight from the server code when no functions emulator runs (LOCAL_CALLS=1).
  if (process.env.LOCAL_CALLS) {
    await page.route(/:5001\/[^/]+\/[^/]+\/(garage|phone)$/, async (route) => {
      const name = route.request().url().split('/').pop(), data = (route.request().postDataJSON() || {}).data;
      try {
        const result = await (name === 'garage' ? garageCall(db(), data) : phoneCall(db(), data));
        route.fulfill({ contentType: 'application/json', body: JSON.stringify({ result }) });
      } catch (e) {
        route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { status: 'FAILED_PRECONDITION', message: e.message } }) });
      }
    });
  }
  // The Driver Room weather window reads Open-Meteo; the check answers with a fixed forecast.
  await page.route(/api\.open-meteo\.com/, route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({
    current: { temperature_2m: 54.4, weather_code: 2, wind_speed_10m: 7.6 },
    daily: { weather_code: [2, 61], temperature_2m_max: [61.2, 58], temperature_2m_min: [43.8, 47.1], precipitation_probability_max: [20, 70] } }) }));
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
  });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(HOSTING + url);
  page.errors = errors;
  return page;
}
const shot = async (page, name, full) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name), fullPage: !!full }); };
const fits = (page) => page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1);

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(G.sheets()), sources: G.SOURCES, now: () => new Date('2026-10-09T12:00:00Z') });
  const browser = await chromium.launch();
  const results = [];
  try {
    // Garage Station (Joe 10/28): the Trucks card, a work order, Start Work: the technicians' names, then the login ID on the keypad.
    const gs = await openPage(browser, 1920, 1080, '/garage-station.html?testEmail=manager.test@uniteddairy.com');
    await gs.waitForSelector('[data-type="TRUCK"]', { timeout: 10000 });
    await gs.waitForFunction(() => /\b1\b/.test(document.querySelector('[data-type="TRUCK"] b').textContent), null, { timeout: 10000 });
    await gs.click('[data-type="TRUCK"]');
    await gs.waitForFunction(() => /Air leak/.test(document.getElementById('jobs').textContent), null, { timeout: 10000 });
    await shot(gs, 'garage-station-jobs-1920.png');
    await gs.click('.gs-job:has-text("900001") button');
    await gs.click('#job-start');
    await gs.waitForSelector('[data-who="TECH-JT"]');
    await shot(gs, 'garage-station-sign-in-1920.png');
    await gs.click('[data-who="TECH-JT"]');
    for (const k of '48213') await gs.click('[data-key="' + k + '"]');
    await gs.click('[data-key="go"]');
    await gs.waitForFunction(() => /JELLICK Tom started on 900001/.test(document.getElementById('gs-message').textContent), null, { timeout: 10000 });
    assert.deepEqual(gs.errors, []);
    results.push('Garage Station: the Trucks card shows 900001; JELLICK Tom starts it with his name and login ID');

    // The drivers' phone page: View Loadout and DVIR, with the Route Distribution code.
    const { code } = await newRouteCode(db(), { email: 'manager.test@uniteddairy.com' });
    const phone = await openPage(browser, 390, 844, '/route.html');
    await phone.fill('#code', code);
    await phone.click('#step-code button[type=submit]');
    // Joe 10/12: the phone opens on three choices: View Loadout (no name needed), DVIR and Check-In (the name once).
    await phone.waitForSelector('#step-menu:not([hidden])', { timeout: 8000 });
    assert.deepEqual(await phone.$$eval('#step-menu .drv-card b', b => b.map(x => x.textContent)), ['View Loadout', 'DVIR', 'Check-In', 'My Schedule']);
    await shot(phone, 'phone-driver-menu-390.png');
    await phone.click('#m-board');
    await phone.waitForSelector('#step-board:not([hidden])', { timeout: 8000 });
    await phone.waitForTimeout(800);
    await shot(phone, 'phone-view-loadout-390.png');
    assert.ok(await fits(phone), 'View Loadout fits the phone width');
    await phone.click('#step-board [data-back]');
    await phone.waitForSelector('#step-menu:not([hidden])', { timeout: 8000 });
    await phone.click('#m-dvir');
    await phone.waitForSelector('#step-name:not([hidden])', { timeout: 8000 });
    await phone.selectOption('#name', 'drv_test_casey');
    await phone.click('#step-name button[type=submit]');
    await phone.waitForSelector('#step-dvir:not([hidden])', { timeout: 8000 });
    const dvir = phone;
    await shot(dvir, 'phone-dvir-390.png', true);
    assert.ok(await fits(dvir), 'the DVIR fits the phone width');
    // Joe 10/13 "default no defect": all 12 items (7 truck, 5 trailer) start as Checked — no defect; the driver changes only
    // the ones with a defect, which turn red and still need a write-up.
    {
      const L0 = require('../../src/logic'), d0 = L0.operatingDay(new Date());
      await db().collection('runs').doc(L0.weekStart(d0) + '__run_dv803').set({ weekStart: L0.weekStart(d0), route: '803', run: 'UT DSD MILK', routeId: 'rte_t803', runId: 'run_dv803', rev: 0,
        days: { [L0.dayPrefix(d0)]: { runs: true, driverId: 'drv_test_casey', driver: 'CASEY, LEE', truck: '900003', trailer: 'T-903' } } });
      await dvir.click('#step-dvir [data-back]');
      await dvir.waitForSelector('#step-menu:not([hidden])', { timeout: 8000 });
      await dvir.click('#m-dvir');
      await dvir.waitForSelector('#step-dvir:not([hidden])', { timeout: 8000 });
      await dvir.waitForFunction(() => document.querySelectorAll('#dv-route option').length > 1, null, { timeout: 8000 });
    }
    const items = await dvir.$$eval('.drv-col select', s => s.map(x => x.value));
    assert.equal(items.length, 12);
    assert.ok(items.every(v => v === 'Checked — no defect'), 'every DVIR item starts as no defect: ' + JSON.stringify(items));
    await dvir.selectOption('#dv-inspection', 'Pre-trip');
    await dvir.selectOption('#dv-truck-items label:nth-child(1) select', 'Defect found');
    assert.equal(await dvir.$eval('#dv-truck-items label:nth-child(1) select', x => x.classList.contains('dv-bad')), true, 'a defect stands out');
    const said = async (re) => { await dvir.waitForFunction(r => new RegExp(r).test(document.getElementById('dv-msg').textContent), re.source, { timeout: 5000 }).catch(() => {}); return dvir.textContent('#dv-msg'); };
    // Joe 10/13: a green Submit at the top (beside Back) and at the bottom (beside Review inspection). With no signature it
    // goes to the signature box, outlines it and saves nothing.
    assert.deepEqual(await dvir.$$eval('#step-dvir [data-submit]', b => b.map(x => [x.textContent, getComputedStyle(x).backgroundColor])),
      [['Submit', 'rgb(27, 127, 59)'], ['Submit', 'rgb(27, 127, 59)']]);
    await dvir.evaluate(() => scrollTo(0, 0));
    await dvir.click('#step-dvir .drv-head [data-submit]');
    assert.match(await said(/Please sign/), /Please sign/);
    assert.equal(await dvir.$eval('.drv-sign', x => x.classList.contains('dv-need')), true, 'the signature box is outlined');
    assert.ok(await dvir.$eval('.drv-sign', x => { const r = x.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; }), 'the screen moved to the signature');
    await dvir.check('#dv-typed');
    assert.equal(await dvir.$eval('.drv-sign', x => x.classList.contains('dv-need')), false);
    await dvir.click('#dv-send');
    assert.match(await said(/Describe the defects/), /Describe the defects/);
    await dvir.fill('#dv-tractor', 'Brake pedal soft');
    await dvir.click('#dv-send');
    assert.match(await said(/Review: .* 1 defect\./), /Review: .* 1 defect\./);
    // The top Submit saves it.
    await dvir.click('#step-dvir .drv-head [data-submit]');
    assert.match(await said(/Inspection saved|Saved on this phone/), /Inspection saved|Saved on this phone/);
    results.push('DVIR: every item starts as no defect; only the item changed to Defect found counts (red, and it needs its write-up); green Submit at the top and bottom, which goes to the signature when it is missing and otherwise saves');
    assert.deepEqual(phone.errors, []);
    results.push('Drivers\' phone: opens on View Loadout, DVIR and Check-In; View Loadout needs no name, DVIR asks for it once; both fit a 390 wide phone');

    // The phone Check-In (Joe 10/11): over / short, a corrected truck, the jack, drop and hook, Speak; and Skip on Who is driving.
    const L = require('../../src/logic');
    const today = L.operatingDay(new Date()), p = L.dayPrefix(today);
    await db().collection('runs').doc(L.weekStart(today) + '__run_pic802').set({ weekStart: L.weekStart(today), route: '802', run: 'UT DSD MILK', routeId: 'rte_t802', runId: 'run_pic802', rev: 0,
      days: { [p]: { runs: true, driverId: 'drv_test_casey', driver: 'CASEY, LEE', truck: '900002', trailer: 'T-902/T-901' } } });
    await db().collection('equipment').doc('veh_truck_900001').set({ id: 'veh_truck_900001', type: 'TRUCK', unit: '900001', status: 'ACTIVE' });
    await phone.click('#step-dvir [data-back]');
    await phone.waitForSelector('#step-menu:not([hidden])', { timeout: 8000 });
    await phone.click('#m-checkin');
    await phone.waitForSelector('.phone-load', { timeout: 8000 });
    await phone.click('.phone-load');
    await phone.waitForSelector('#step-form:not([hidden])');
    assert.equal(await phone.inputValue('#step-form [name=trailer]'), 'T-902');
    assert.equal(await phone.inputValue('#step-form .ci-tr'), 'T-901', 'the second trailer of the cell gets its own box');
    await shot(phone, 'phone-checkin-390.png');
    const plain = await phone.evaluate(() => ({ scroll: document.scrollingElement.scrollHeight, inner: window.innerHeight }));
    await phone.check('#step-form [name=overageShortage]');
    await phone.fill('#step-form [name=shortCases]', '2');
    await phone.fill('#step-form [name=shortProduct]', '2% gallon');
    await phone.fill('#step-form [name=shortStore]', 'Giant Eagle');
    await phone.fill('#step-form [name=truck]', '01');
    await phone.press('#step-form [name=truck]', 'Tab');
    assert.equal(await phone.inputValue('#step-form [name=truck]'), '900001', 'a short number finds the truck');
    await phone.fill('#step-form [name=palletJack]', '7');
    await phone.fill('#step-form .ci-tr-issues', 'Light out');
    await phone.fill('#step-form input[name=casesDelivered]', '400');
    await phone.click('#step-form .ci-loaded label:has([value=YES])');
    await shot(phone, 'phone-checkin-filled-390.png', true);
    assert.ok(await fits(phone), 'the Check-In fits the phone width');
    await phone.click('#send');
    await phone.waitForSelector('.phone-load.done', { timeout: 8000 });
    const saved = (await db().collection('runs').doc(L.weekStart(today) + '__run_pic802').get()).data().days[p];
    assert.equal(saved.overageShortageDetails, 'SHORT 2 cs · 2% gallon · Store: Giant Eagle');
    assert.equal(saved.checkinTruck, '900001');
    assert.deepEqual(saved.moreTrailers, [{ trailer: 'T-901', issues: 'Light out', needsCleaned: false }]);
    await phone.click('#change');
    await phone.waitForSelector('#step-name:not([hidden])', { timeout: 8000 });
    await shot(phone, 'phone-who-is-driving-390.png');
    await phone.click('#skip');
    await phone.waitForSelector('.phone-load', { timeout: 8000 });
    assert.equal(await phone.textContent('#who'), 'Driver not chosen');
    await shot(phone, 'phone-skip-390.png');
    assert.deepEqual(phone.errors, []);
    results.push('Drivers\' phone Check-In: over / short, a short truck number, the jack and a second trailer saved; Skip lists the day\'s routes (Check-In ' + plain.scroll + ' of ' + plain.inner + ' px tall before ticking)');

    // Driver Station: the board and the Driver Room TV.
    const ds = await openPage(browser, 1920, 1080, '/driver-station.html' + MANAGER);
    await ds.waitForSelector('#screen:not([hidden])');
    await ds.waitForTimeout(1500);
    await shot(ds, 'driver-station-1920.png');
    const tv = await openPage(browser, 1920, 1080, '/driver-station.html' + MANAGER + '&tv=1');
    await tv.waitForSelector('#screen:not([hidden])');
    await tv.waitForTimeout(1500);
    assert.equal(await tv.$eval('body', b => b.classList.contains('ds-tv')), true);
    await shot(tv, 'driver-room-tv-1920.png');
    await tv.waitForFunction(() => /°F/.test(document.getElementById('weather-now').textContent));
    assert.equal(await tv.textContent('#weather-now'), '54°F · Partly cloudy');
    assert.equal(await tv.textContent('#weather-today'), 'High 61° · Low 44° · Rain 20% · Wind 8 mph');
    assert.equal(await tv.textContent('#weather-next'), 'Tomorrow: Rain, 58° / 47°');
    await tv.waitForSelector('#turn-weather .now:visible', { timeout: 15000 });
    assert.equal(await tv.isVisible('#turn-live'), false, 'no live picture: the local weather shows instead');
    assert.deepEqual(ds.errors.concat(tv.errors), []);
    results.push('Driver Station: the board and the Driver Room TV open, with the weather window filled in');

    // Trailer Assignments and Plant Station on the made-up plant day.
    await clear();
    await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date('2026-10-08T14:00:00Z') });
    const clock = '2026-10-08T14:00:00Z';
    const ta = await openPage(browser, 1920, 1080, '/trailers.html' + MANAGER, clock);
    await ta.waitForSelector('[data-trailer]', { timeout: 10000 });
    await shot(ta, 'trailer-assignments-1920.png');
    const taPhone = await openPage(browser, 390, 844, '/trailers.html' + MANAGER, clock);
    await taPhone.waitForSelector('[data-trailer]', { timeout: 10000 });
    assert.ok(await fits(taPhone), 'Trailer Assignments fits the phone width');
    await shot(taPhone, 'trailer-assignments-phone-390.png');
    assert.equal(await taPhone.isVisible('#yard'), false, 'no yard panel on a phone');
    // Review items 25 and 27 (Joe 10/13): on a phone each route is a card with Run, Driver, Truck, Trailer and Depart named on it;
    // no name or truck number is broken mid-word, and there is no side-menu strip.
    const taCard = await taPhone.$eval('#rows .ta-row', r => ({
      display: getComputedStyle(r).display,
      labels: [...r.children].map(s => getComputedStyle(s, '::before')).filter(b => b.display !== 'none' && b.content !== 'none' && b.content !== 'normal').map(b => b.content.replace(/"/g, '')),
      broken: [...document.querySelectorAll('#rows .ta-row > span:not(.tr)')].filter(s => { const t = s.cloneNode(true); t.querySelectorAll('small').forEach(x => x.remove()); return t.textContent.split(/\s+/).some(w => { const g = document.createRange(); const n = [...s.childNodes].find(c => c.nodeType === 3 && c.textContent.includes(w)); if (!n || !w) return false; const i = n.textContent.indexOf(w); g.setStart(n, i); g.setEnd(n, i + w.length); return g.getClientRects().length > 1; }); }).map(s => s.textContent),
      menu: getComputedStyle(document.querySelector('.sidemenu')).display
    }));
    assert.equal(taCard.display, 'flex', 'a route is a card on a phone');
    assert.deepEqual(taCard.labels, ['Run', 'Driver', 'Truck', 'Trailer', 'Depart'], 'every box is named on the card');
    assert.deepEqual([taCard.broken, taCard.menu], [[], 'none'], 'no word broken mid-word, no side-menu strip ' + JSON.stringify(taCard));
    assert.deepEqual(ta.errors.concat(taPhone.errors), []);
    results.push('Trailer Assignments: every unfinished load with its trailer box; the yard panel on a desk, not on a phone');

    const ps = await openPage(browser, 1920, 1080, '/plant-station.html' + MANAGER, clock);
    await ps.waitForSelector('[data-station="CASE_UNLOADING"]');
    await shot(ps, 'plant-station-pick-1920.png');
    await ps.click('[data-station="CASE"]');
    await ps.waitForSelector('#work .sw-card');
    await shot(ps, 'plant-station-case-1920.png');
    assert.deepEqual(await ps.$$eval('.ps-tab b', b => b.map(x => x.textContent)), ['Loading']);
    await ps.reload();
    await ps.waitForSelector('#work .sw-card');
    assert.equal(await ps.textContent('#title'), 'Case Loadout', 'the tablet remembers its station');
    await ps.click('#change');
    await ps.click('[data-station="CASE_UNLOADING"]');
    // Joe 10/27: Case Unloading opens on the choice of Case Unloading or Trailer Assignments.
    assert.deepEqual(await ps.$$eval('.ps-tab b', b => b.map(x => x.textContent)), ['Case Unloading', 'Trailer Assignments']);
    await ps.click('[data-part="unload"]');
    await ps.waitForSelector('[data-view="unloading"]');
    assert.deepEqual(await ps.$$eval('.ps-tab b', b => b.map(x => x.textContent)), ['Unloading', 'Washing', 'Returns']);
    // Joe 10/14: the Tote Loadout station loads, unloads and washes.
    await ps.click('#change');
    await ps.click('[data-station="TOTES"]');
    await ps.waitForFunction(() => document.querySelectorAll('.ps-tab b').length === 3);
    assert.deepEqual(await ps.evaluate(() => [...document.querySelectorAll('.ps-tab b')].map(x => x.textContent)), ['Loading', 'Unloading', 'Washing'], 'Tote Loadout has Loading, Unloading and Washing');
    await ps.click('[data-view="washing"]');
    await ps.waitForSelector('#work .sw-panel-head h2:text-is("Washing")');
    assert.deepEqual(ps.errors, []);
    results.push('Plant Station: a tablet picks its station once; Case Loadout shows Loading only, Case Unloading shows the choice of Case Unloading (Unloading, Washing and Returns) or Trailer Assignments, Tote Loadout shows Loading, Unloading and Washing');
    // Joe 10/10: the Plant Station is a tablet screen: a slim header with Back and Home, no desktop side menu.
    const tab = await openPage(browser, 1280, 800, '/plant-station.html' + MANAGER, clock);
    await tab.waitForSelector('[data-station="CASE_UNLOADING"]');
    assert.equal(await tab.$('.sidemenu'), null, 'no desktop side menu on the Plant Station');
    // Joe 10/27: a plant tablet goes nowhere else, so no Back or Home even while picking the station.
    assert.equal(await tab.isVisible('#go-back') || await tab.isVisible('#go-home'), false, 'no Back or Home into the app while picking the station');
    assert.ok(await fits(tab), 'the Plant Station fits a tablet');
    await shot(tab, 'plant-station-tablet-pick-1280.png');
    await tab.click('[data-station="CASE_UNLOADING"]');
    await tab.click('[data-part="unload"]');
    await tab.waitForSelector('#work .sw-panel');
    await shot(tab, 'plant-station-tablet-unloading-1280.png');
    assert.deepEqual(tab.errors, []);
    results.push('Plant Station: tablet layout with a slim header (no Back or Home) and no desktop menu');

    // Joe 10/12: "This should only be a mobile view. and not be able to see all the information. This is for the employees."
    // A station shows its own work on this page (today, its area, cards), with no way into the manager screens.
    const managerPages = (page) => page.$$eval('a[href]', a => a.map(x => x.getAttribute('href')).filter(h => /loadout|unloading|washing|returns|index|administration|manager/.test(h)));
    assert.deepEqual(await managerPages(tab), [], 'no link to a manager screen from Case Unloading');
    assert.equal(await tab.isVisible('#go-back') || await tab.isVisible('#go-home'), false, 'a station has no Back or Home into the rest of the app');
    for (const v of ['washing', 'returns', 'unloading']) {
      await tab.click('[data-view="' + v + '"]');
      await tab.waitForSelector('#work .sw-panel-head h2:text-is("' + v[0].toUpperCase() + v.slice(1) + '")');
      assert.equal(tab.url().split('/').pop().split('?')[0], 'plant-station.html', 'the ' + v + ' tab stays on the Plant Station');
    }
    assert.ok(await fits(tab), 'the station work fits a tablet');
    await tab.click('#change');
    await tab.click('[data-station="CASE"]');
    await tab.waitForSelector('#work .sw-card');
    assert.equal(await tab.isVisible('#tabs'), false, 'one work area: no tabs, the loads straight away');
    assert.deepEqual(await managerPages(tab), [], 'no link to a manager screen from Case Loadout');
    for (const gone of ['#load-date', '.areas', 'table', '[data-edit]', '.hdr-admin', '#go-admin']) assert.equal(await tab.$(gone), null, gone + ' is not on the station');
    // Joe 10/12: Case Loadout loads 2 at a time and the made-up day has 2 loading, so one is paused (with its reason) first.
    const p808 = '#work .sw-card[data-sw="2026-10-04__run_p808|fri"]';
    await tab.click(p808 + ' [data-act="pause"]');
    await tab.fill(p808 + ' [data-k="pauseReason"]', 'Waiting on product');
    await tab.click(p808 + ' [data-act="pausego"]');
    await tab.waitForSelector(p808 + '.paused', { timeout: 10000 });
    for (let i = 0; i < 100 && (await db().collection('runs').doc('2026-10-04__run_p808').get()).data().days.fri.loadStatus !== 'PAUSED'; i++) await new Promise(r => setTimeout(r, 100));
    // Start a waiting load, type its cases, Complete: the card shows each step.
    const id = '2026-10-04__run_p811|fri';
    const at = '#work .sw-card[data-sw="' + id + '"]';
    await tab.click(at + ' [data-act="start"]');
    await tab.waitForSelector(at + '.run.open .sw-badge:text-is("LOADING")', { timeout: 10000 });
    await tab.fill(at + ' [data-k="quantity"]', '412');
    await tab.click(at + ' [data-act="complete"]');
    await tab.waitForSelector(at + '.done .sw-badge:text-is("COMPLETE")', { timeout: 10000 });
    await tab.click(at + ' .sw-head');
    assert.equal(await tab.inputValue(at + ' [data-k="quantity"]'), '412');
    assert.equal(await tab.isDisabled(at + ' [data-k="quantity"]'), true, 'a finished load is read only on the station');
    assert.deepEqual(tab.errors, []);
    // Joe 10/12 photo: on a tablet held upright (800 wide) the run name ran into the truck number. Route, run, truck and
    // trailer must not overlap on any card.
    for (const [w, h] of [[600, 960], [800, 1280], [1024, 768]]) {
    const upright = await openPage(browser, w, h, '/plant-station.html' + MANAGER, clock, true);
    await upright.click('[data-station="CASE"]');
    await upright.waitForSelector('#work .sw-card');
    const clash = await upright.$$eval('#work .sw-head:not(.tall)', heads => heads.map(h => {
      // The text's own extent (a word too long for its column spills over the next one), not just the column's box.
      const box = (sel) => {
        const e = h.querySelector(sel);
        if (!e || getComputedStyle(e).display === 'none') return null;
        const r = document.createRange(); r.selectNodeContents(e);
        const t = r.getBoundingClientRect(), c = e.getBoundingClientRect();
        return { left: Math.min(t.left, c.left), right: Math.max(t.right, c.right), top: Math.min(t.top, c.top), bottom: Math.max(t.bottom, c.bottom) };
      };
      const parts = ['.route', '.run', '.truck', '.trailer'].map(box).filter(Boolean);
      return parts.some((a, i) => parts.some((b, j) => j > i && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1)) ? h.textContent : '';
    }).filter(Boolean));
    assert.deepEqual(clash, [], 'nothing overlaps on a card on a ' + w + ' wide tablet');
    assert.ok(await fits(upright), 'the station work fits a ' + w + ' wide tablet');
    await shot(upright, 'plant-station-case-tablet-' + w + '.png');
    // Joe 10/12 "tapping does nothing": a tap on the account circle shows which account the tablet is signed in as.
    await upright.tap('#who');
    await upright.waitForSelector('#who.open:has-text("manager.test@uniteddairy.com")');
    assert.ok(await upright.evaluate(() => { const r = document.getElementById('who').getBoundingClientRect(); return r.right <= innerWidth && parseFloat(getComputedStyle(document.getElementById('who')).fontSize) >= 16; }), 'the account shows on screen at 16px on a ' + w + ' wide tablet');
    // Joe 10/12: "it won't even let me scroll." A finger swipe up on the touch tablet must move the page.
    assert.ok(await upright.evaluate(() => document.scrollingElement.scrollHeight > innerHeight + 50), 'the station work is taller than a ' + w + ' wide tablet');
    const cdp = await upright.context().newCDPSession(upright);
    const fx = Math.round(w / 2), fy = Math.round(h * 0.75);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: fx, y: fy }] });
    for (let i = 1; i <= 12; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: fx, y: fy - Math.round(h / 2) * i / 12 }] }); await upright.waitForTimeout(16); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const moved = await upright.waitForFunction(() => scrollY > 50, null, { timeout: 3000 }).then(() => true, () => false);
    assert.ok(moved, 'a finger swipe scrolls the station page on a ' + w + ' wide touch tablet');
    await upright.evaluate(() => scrollTo(0, 0));
    assert.deepEqual(upright.errors, []);
    }
    // Joe 10/12: "it still will not let me edit ... And I have those rights turned on." An account whose role alone
    // cannot save plant work, but which Administration > People & Roles allows "Update route loading", can edit.
    const RIGHTS = 'rights.test@uniteddairy.com';
    const mgr = (await db().collection('users').doc('manager.test@uniteddairy.com').get()).data();
    await db().collection('users').doc(RIGHTS).set(Object.assign({}, mgr, { email: RIGHTS, name: 'Rights Test', roles: ['MECHANIC'], cells: Object.assign({}, mgr.cells, { email: RIGHTS }) }));
    const asRights = async () => {
      const pg = await openPage(browser, 800, 1280, '/plant-station.html?testEmail=' + RIGHTS, clock, true);
      await pg.click('[data-station="CASE"]');
      await pg.waitForSelector('#work .sw-card');
      return pg;
    };
    const noGrant = await asRights();
    await noGrant.waitForSelector('#work .sw-note:has-text("View only: rights.test@uniteddairy.com")');
    const loNo = await openPage(browser, 1536, 864, '/loadout.html?testEmail=' + RIGHTS, clock);
    await loNo.waitForSelector('#foot:has-text("View only: rights.test@uniteddairy.com is not allowed")');
    await loNo.close();
    assert.equal(await noGrant.$('#work .sw-card:not(.done) [data-act="start"]:not([disabled])'), null, 'no Start without the role or the right');
    await noGrant.close();
    await db().collection('personRights').doc(RIGHTS).set({ grants: ['plant.loading.write'], denials: [] });
    const granted = await asRights();
    const gStart = '#work .sw-card:not(.done):not(.run):not(.paused) [data-act="start"]:not([disabled])';
    await granted.waitForSelector(gStart, { timeout: 10000 });
    assert.equal(await granted.$('#work .sw-note'), null, 'no View only note for an account People & Roles allows');
    const gid = await granted.getAttribute('#work .sw-card:not(.done):not(.run):not(.paused) >> nth=0', 'data-sw');
    await granted.click('#work .sw-card[data-sw="' + gid + '"] [data-act="start"]');
    await granted.waitForSelector('#work .sw-card[data-sw="' + gid + '"].run .sw-badge:text-is("LOADING")', { timeout: 10000 });
    assert.deepEqual(granted.errors, []);
    await granted.close();
    const loYes = await openPage(browser, 1536, 864, '/loadout.html?testEmail=' + RIGHTS, clock);
    await loYes.waitForSelector('#foot:has-text("Type a truck")', { timeout: 10000 });
    assert.deepEqual(loYes.errors, []);
    await loYes.close();
    results.push('Plant Station: an account allowed "Update route loading" in People & Roles can Start a load and edit Case Loadout though its role alone cannot; without it, View only names the account and says why');
    const stPhone = await openPage(browser, 390, 844, '/plant-station.html' + MANAGER, clock);
    await stPhone.click('[data-station="CASE"]');
    await stPhone.waitForSelector('#work .sw-card');
    assert.ok(await fits(stPhone), 'the station work fits a phone');
    await shot(stPhone, 'plant-station-case-phone-390.png');
    assert.deepEqual(stPhone.errors, []);
    results.push('Plant Station: the employee view on the station page (today, its area, cards; Start, cases, Complete); no Back, Home, dates, Edit or links to the manager screens; nothing overlaps on a tablet 600, 800 or 1024 wide, a finger swipe scrolls it, and a tap on the circle shows the account');
  } finally {
    await browser.close();
  }
  console.log(results.map(r => 'ok - ' + r).join('\n'));
})().catch(e => { console.error(e); process.exit(1); });

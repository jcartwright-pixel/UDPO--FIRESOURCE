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

async function openPage(browser, width, height, url, clock) {
  const page = await browser.newPage({ viewport: { width, height } });
  if (clock) await page.clock.setFixedTime(new Date(clock));
  await localCalls(page);
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
    // Garage Station: the technicians' names, then the login ID on the keypad, then the jobs.
    const gs = await openPage(browser, 1920, 1080, '/garage-station.html');
    await gs.waitForSelector('[data-tech="TECH-JT"]', { timeout: 10000 });
    await shot(gs, 'garage-station-sign-in-1920.png');
    await gs.click('[data-tech="TECH-JT"]');
    for (const k of '48213') await gs.click('[data-key="' + k + '"]');
    await gs.click('[data-key="go"]');
    await gs.waitForFunction(() => /Air leak/.test(document.body.textContent), null, { timeout: 10000 });
    await shot(gs, 'garage-station-jobs-1920.png');
    assert.deepEqual(gs.errors, []);
    results.push('Garage Station: JELLICK Tom signed in with his login ID and sees the open jobs');

    // The drivers' phone page: View Loadout and DVIR, with the Route Distribution code.
    const { code } = await newRouteCode(db(), { email: 'manager.test@uniteddairy.com' });
    const phone = await openPage(browser, 390, 844, '/route.html');
    await phone.fill('#code', code);
    await phone.click('#step-code button[type=submit]');
    await phone.waitForSelector('#step-name:not([hidden])', { timeout: 8000 });
    await phone.selectOption('#name', 'drv_test_casey');
    await phone.click('#step-name button[type=submit]');
    await phone.waitForSelector('#to-board', { state: 'visible', timeout: 8000 });
    await shot(phone, 'phone-driver-menu-390.png');
    await phone.click('#to-board');
    await phone.waitForSelector('#step-board:not([hidden])', { timeout: 8000 });
    await phone.waitForTimeout(800);
    await shot(phone, 'phone-view-loadout-390.png');
    assert.ok(await fits(phone), 'View Loadout fits the phone width');
    await phone.click('#step-board [data-back]');
    await phone.click('#to-dvir');
    await phone.waitForSelector('#step-dvir:not([hidden])', { timeout: 8000 });
    const dvir = phone;
    await shot(dvir, 'phone-dvir-390.png', true);
    assert.ok(await fits(dvir), 'the DVIR fits the phone width');
    assert.deepEqual(phone.errors, []);
    results.push('Drivers\' phone: View Loadout and DVIR open from the driver menu and fit a 390 wide phone');

    // The phone Check-In (Joe 10/11): over / short, a corrected truck, the jack, drop and hook, Speak; and Skip on Who is driving.
    const L = require('../../src/logic');
    const today = L.operatingDay(new Date()), p = L.dayPrefix(today);
    await db().collection('runs').doc(L.weekStart(today) + '__run_pic802').set({ weekStart: L.weekStart(today), route: '802', run: 'UT DSD MILK', routeId: 'rte_t802', runId: 'run_pic802', rev: 0,
      days: { [p]: { runs: true, driverId: 'drv_test_casey', driver: 'CASEY, LEE', truck: '900002', trailer: 'T-902/T-901' } } });
    await db().collection('equipment').doc('veh_truck_900001').set({ id: 'veh_truck_900001', type: 'TRUCK', unit: '900001', status: 'ACTIVE' });
    await phone.click('#step-dvir [data-back]');
    await phone.waitForSelector('.phone-load', { timeout: 8000 });
    await phone.click('.phone-load');
    await phone.waitForSelector('#step-form:not([hidden])');
    assert.equal(await phone.inputValue('#step-form [name=trailer]'), 'T-902');
    assert.equal(await phone.inputValue('#step-form .ci-tr'), 'T-901', 'the second trailer of the cell gets its own box');
    await shot(phone, 'phone-checkin-390.png');
    const plain = await phone.evaluate(() => ({ scroll: document.scrollingElement.scrollHeight, inner: window.innerHeight }));
    await phone.check('#step-form [name=overageShortage]');
    await phone.check('#step-form [name=osKind][value=SHORT]', { force: true });
    await phone.fill('#step-form [name=osCases]', '2');
    await phone.fill('#step-form [name=osProduct]', '2% gallon');
    await phone.fill('#step-form [name=osStore]', 'Giant Eagle');
    await phone.fill('#step-form [name=truck]', '01');
    await phone.press('#step-form [name=truck]', 'Tab');
    assert.equal(await phone.inputValue('#step-form [name=truck]'), '900001', 'a short number finds the truck');
    await phone.fill('#step-form [name=palletJack]', '7');
    await phone.fill('#step-form .ci-tr-issues', 'Light out');
    await phone.fill('#step-form input[name=casesDelivered]', '400');
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
    assert.deepEqual(ta.errors.concat(taPhone.errors), []);
    results.push('Trailer Assignments: every unfinished load with its trailer box; the yard panel on a desk, not on a phone');

    const ps = await openPage(browser, 1920, 1080, '/plant-station.html' + MANAGER, clock);
    await ps.waitForSelector('[data-station="CASE_UNLOADING"]');
    await shot(ps, 'plant-station-pick-1920.png');
    await ps.click('[data-station="CASE"]');
    await ps.waitForSelector('.ps-tab');
    await shot(ps, 'plant-station-case-1920.png');
    assert.deepEqual(await ps.$$eval('.ps-tab b', b => b.map(x => x.textContent)), ['Loading']);
    await ps.reload();
    await ps.waitForSelector('.ps-tab');
    assert.equal(await ps.textContent('#title'), 'Case Loadout', 'the tablet remembers its station');
    await ps.click('#change');
    await ps.click('[data-station="CASE_UNLOADING"]');
    assert.deepEqual(await ps.$$eval('.ps-tab b', b => b.map(x => x.textContent)), ['Unloading', 'Washing', 'Returns']);
    assert.deepEqual(ps.errors, []);
    results.push('Plant Station: a tablet picks its station once; Case Loadout shows Loading only, Case Unloading shows Unloading, Washing and Returns');
    // Joe 10/10: the Plant Station is a tablet screen: a slim header with Back and Home, no desktop side menu.
    const tab = await openPage(browser, 1280, 800, '/plant-station.html' + MANAGER, clock);
    await tab.waitForSelector('[data-station="CASE_UNLOADING"]');
    assert.equal(await tab.$('.sidemenu'), null, 'no desktop side menu on the Plant Station');
    assert.ok(await tab.isVisible('#go-back') && await tab.isVisible('#go-home'), 'Back and Home in the slim header');
    assert.ok(await fits(tab), 'the Plant Station fits a tablet');
    await shot(tab, 'plant-station-tablet-pick-1280.png');
    await tab.click('[data-station="CASE_UNLOADING"]');
    await tab.waitForSelector('.ps-tab');
    await shot(tab, 'plant-station-tablet-unloading-1280.png');
    assert.deepEqual(tab.errors, []);
    results.push('Plant Station: tablet layout with a slim header (Back, Home) and no desktop menu');
  } finally {
    await browser.close();
  }
  console.log(results.map(r => 'ok - ' + r).join('\n'));
})().catch(e => { console.error(e); process.exit(1); });

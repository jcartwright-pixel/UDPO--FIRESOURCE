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

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const MANAGER = '?testEmail=manager.test@uniteddairy.com';
const SHOTS = process.env.SHOTS || '';

async function openPage(browser, width, height, url, clock) {
  const page = await browser.newPage({ viewport: { width, height } });
  if (clock) await page.clock.setFixedTime(new Date(clock));
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
    assert.deepEqual(ds.errors.concat(tv.errors), []);
    results.push('Driver Station: the board and the Driver Room TV open');

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
  } finally {
    await browser.close();
  }
  console.log(results.map(r => 'ok - ' + r).join('\n'));
})().catch(e => { console.error(e); process.exit(1); });

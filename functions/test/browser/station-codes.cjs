'use strict';
/*
 * Browser check of station codes (Joe 10/12, like the current app): Administration > Plant Station Codes, Garage Station
 * Codes and Driver Station Codes each show one link and a list of stations; + Add makes a station and Create code gives it
 * its own code. On a tablet, the Plant Station, Garage Station and Driver Room kiosk then ask for a code, open that station
 * when it is typed, and Change Station sends them back to the code screen. Pictures at Joe's 1536 width go to SHOTS_DIR.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const F = require('../fixtures/fake-sheets');
const G = require('../fixtures/garage-demo');
const localCalls = require('./local-calls.cjs');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR;
const ADMIN = '?testEmail=admin.test@uniteddairy.com';

async function openPage(browser, width, height, url) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
  });
  await localCalls(page);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(HOSTING + url);
  page.errors = errors;
  return page;
}
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, name) }); };
// Administration pictures: the top of the page (the links), then scrolled to the stations.
const twoShots = async (p, name) => { await p.$eval('#view .ap-scroll', el => { el.scrollTop = 0; }); await shot(p, name + '-top-1536.png'); await p.$eval('#st-list', el => el.scrollIntoView()); await shot(p, name + '-stations-1536.png'); };
const noSideScroll = (p) => p.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth);

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(G.sheets()), sources: G.SOURCES, now: () => new Date('2026-10-09T12:00:00Z') });
  const browser = await chromium.launch();
  const results = [], codes = {};
  try {
    const p = await openPage(browser, 1536, 864, '/administration.html' + ADMIN);
    await p.waitForSelector('.adm-item.on[data-key="people"]');
    const open = async (key) => { await p.click('.adm-item[data-key="' + key + '"]'); await p.waitForSelector('#st-list .ap-item'); await p.waitForTimeout(300); };
    // Give the station named `name` its code and keep it.
    const makeCode = async (name) => {
      const row = p.locator('#st-list .ap-item', { has: p.locator('b', { hasText: new RegExp('^' + name + '$') }) });
      await row.locator('[data-st-code]').click();
      await row.locator('code').waitFor();
      return (await row.locator('code').textContent()).trim();
    };

    await open('station-codes');
    assert.deepEqual(await p.$$eval('.ap-link', l => l.map(x => x.dataset.link)), ['plant', 'public']);
    // Joe 10/12: the no-account link is built now (it was "Being built"), with its On / Off.
    assert.match(await p.textContent('.ap-link[data-link="public"]'), /Code, no account/);
    assert.deepEqual(await p.$$eval('#st-list .ap-item b', b => b.map(x => x.textContent)), ['Case Loadout', 'Case Unloading', 'Tote Loadout', 'Boxing Loadout', 'Yard Services']);
    await p.fill('#st-name', 'Case Loadout dock 2');
    await p.selectOption('#st-type', 'CASE');
    await p.click('#st-add');
    await p.waitForSelector('#st-list .ap-item b:text-is("Case Loadout dock 2")');
    codes.plant = await makeCode('Case Loadout');
    await makeCode('Case Loadout dock 2');
    assert.ok(await noSideScroll(p));
    await twoShots(p, '1-plant-station-codes');
    results.push('Plant Station Codes: the Plant Station link, the no-account link (On / Off), the stations; + Add Station and Create code work');

    await open('garage-codes');
    assert.deepEqual(await p.$$eval('.ap-link', l => l.map(x => x.dataset.link)), ['garage', 'maint']);
    codes.garage = await makeCode('Garage');
    await twoShots(p, '2-garage-station-codes');
    results.push('Garage Station Codes: its own page with the Garage Station link and its stations');

    await open('driver-codes');
    // Joe 10/12: like Plant Station Codes: the Driver Room Check-In link (Joe 10/12 evening), the Driver Station link, its stations
    // right under it, then the drivers' phone link.
    assert.deepEqual(await p.$$eval('.ap-link', l => l.map(x => x.dataset.link)), ['driverroom', 'driver', 'route']);
    assert.deepEqual(await p.$$eval('.ap-link[data-link="driver"], #st-list, .ap-link[data-link="route"]', l => l.map(x => x.dataset.link || x.id)), ['driver', 'st-list', 'route'], 'the stations sit under the Driver Station link');
    assert.equal((await p.textContent('#st-add')).trim(), '+ Add Station');
    await p.fill('#st-name', 'Plant kiosk');
    await p.click('#st-add');
    await p.waitForSelector('#st-list .ap-item b:text-is("Plant kiosk")');
    codes.kiosk = await makeCode('Driver Room kiosk');
    codes.tv = await makeCode('Driver Room TV');
    assert.equal(await p.isVisible('#view .ap-msg.good'), false, 'no green status bar (errors only)');
    assert.deepEqual(await p.$$eval('#st-list .ap-item b', b => b.map(x => x.textContent)), ['Driver Room kiosk', 'Driver Room TV', 'Plant kiosk']);
    await twoShots(p, '3-driver-station-codes');
    assert.deepEqual(p.errors, []);
    results.push('Driver Station Codes: one Driver Station link, its stations under it (+ Add Station, more than one per plant), then the drivers\' phone link');

    // The Plant Station tablet: the code screen, a wrong code, the right one opens Case Loadout; Change Station goes back.
    const ps = await openPage(browser, 1536, 864, '/plant-station.html' + ADMIN);
    await ps.waitForSelector('#code-box form.st-code');
    assert.equal(await ps.isVisible('#pick'), false, 'no station list once the plant has codes');
    await shot(ps, '4-plant-station-code-screen-1536.png');
    await ps.fill('#code-box input', 'ZZZZZZ');
    await ps.click('#code-box button');
    await ps.waitForSelector('.st-code-msg:text("not recognized")');
    await ps.fill('#code-box input', codes.plant.toLowerCase());
    await ps.click('#code-box button');
    await ps.waitForSelector('#work .sw-panel');
    assert.equal(await ps.textContent('#title'), 'Case Loadout');
    await shot(ps, '5-plant-station-opened-1536.png');
    await ps.reload();
    await ps.waitForSelector('#work .sw-panel');
    assert.equal(await ps.textContent('#title'), 'Case Loadout', 'the tablet remembers its station');
    await ps.click('#change');
    await ps.waitForSelector('#code-box form.st-code');
    assert.deepEqual(ps.errors, []);
    results.push('Plant Station: asks for the code, opens that station, remembers it; Change Station asks again');

    // Joe 10/12: the Plant Station with no UD account (the old app's public Plant Station), Off until an administrator turns
    // it On; then the station's code alone opens that station and its screens. Turn Off shuts the tablet out.
    await open('station-codes');
    assert.match(await p.textContent('.ap-link[data-link="public"]'), /Code, no account/);
    assert.equal(await p.textContent('#na-row .ap-chip'), 'OFF');
    const na = await openPage(browser, 1536, 864, '/plant-station.html?noaccount=1');
    await na.waitForSelector('#noacct:not([hidden])');
    await shot(na, '10-no-account-code-screen-1536.png');
    await na.fill('#noacct-code', codes.plant);
    await na.click('#noacct button');
    await na.waitForSelector('#noacct-msg:text("turned off")');
    await p.click('[data-na-on]');
    await p.waitForSelector('#na-row .ap-chip:text-is("ON")', { timeout: 10000 }).catch(async e => { throw new Error('Turn On: ' + await p.textContent('#view').catch(() => '') + ' ' + e.message); });
    await na.click('#noacct button');
    await na.waitForSelector('#work .sw-panel');
    assert.equal(await na.textContent('#title'), 'Case Loadout');
    assert.equal(await na.isVisible('#signout'), false, 'a no-account tablet leaves only through Change Station');
    await shot(na, '11-no-account-station-opened-1536.png');
    // Its Loading list (on the Plant Station page itself, Joe 10/12) reads the loads with no UD account.
    await na.waitForTimeout(1500);
    assert.equal(await na.isVisible('#error'), false, 'no read error on the station\'s loads with no UD account: ' + await na.textContent('#error'));
    await shot(na, '12-no-account-loadout-1536.png');
    // Any other screen says it needs a UD account, the manager's Loadout Center too (Joe 10/12: the station is for the employees).
    for (const other of ['/daily.html', '/loadout.html?area=CASE', '/unloading.html']) {
      await na.goto(HOSTING + other);
      await na.waitForSelector('#signin-error:text("Only the Plant Station screens")');
    }
    // Turn Off (press twice): back on the Plant Station, the tablet is sent to the code screen.
    await p.click('[data-na-off]');
    await p.click('[data-na-off]');
    await p.waitForSelector('#na-row .ap-chip:text-is("OFF")');
    await na.goto(HOSTING + '/plant-station.html');
    await na.waitForSelector('#noacct:not([hidden])');
    assert.match(await na.textContent('#signin-error'), /turned off/);
    assert.deepEqual(na.errors, []);
    results.push('Plant Station with no UD account: Off by default; On, the station code alone opens the station and its Loading screen; other screens refused; Turn Off sends it back to the code screen');

    const gs = await openPage(browser, 1536, 864, '/garage-station.html');
    await gs.waitForSelector('#view-code form.st-code');
    await gs.fill('#view-code input', codes.garage);
    await gs.click('#view-code button');
    await gs.waitForSelector('[data-tech]');
    assert.match(await gs.textContent('#title'), /^Garage · Uniontown$/);
    assert.ok(await gs.isVisible('#gs-change'));
    await shot(gs, '6-garage-station-opened-1536.png');
    assert.deepEqual(gs.errors, []);
    results.push('Garage Station: asks for the garage code, then the work orders');

    const ds = await openPage(browser, 1536, 864, '/driver-station.html' + ADMIN);
    await ds.waitForSelector('#code-box form.st-code');
    await shot(ds, '7-driver-kiosk-code-screen-1536.png');
    await ds.fill('#code-box input', codes.kiosk);
    // Joe 10/12 "I didn't want the Driver Room TV, it is showing the kiosk": the Driver Room tablet's code typed on the
    // Driver Station link opens the drivers' Check-In page (View Loadout, DVIR, Check-In), which keeps the code.
    await Promise.all([ds.waitForURL(/driver-room\.html$/), ds.click('#code-box button')]);
    await ds.waitForSelector('#menu:not([hidden]) #go-checkin');
    assert.match(await ds.textContent('#plant'), /Uniontown Driver Room/);
    assert.equal(await ds.evaluate(() => localStorage.getItem('udKioskCode')), null, 'the Driver Station link does not keep it');
    await shot(ds, '8-driver-kiosk-opened-1536.png');
    await ds.goto(HOSTING + '/driver-room.html');
    await ds.waitForSelector('#menu:not([hidden]) #go-checkin');
    assert.deepEqual(ds.errors, []);
    results.push('Driver Room kiosk: its code on the Driver Station link opens the Driver Room Check-In page, which keeps it');
    // A TV's code typed on the tablet link opens the TV display (no header).
    const tv = await openPage(browser, 1536, 864, '/driver-station.html' + ADMIN);
    await tv.waitForSelector('#code-box form.st-code');
    await tv.fill('#code-box input', codes.tv);
    await Promise.all([tv.waitForURL(/tv=1/), tv.click('#code-box button')]);
    await tv.waitForSelector('#eyebrow:text("Driver Room TV · Uniontown")');
    await shot(tv, '9-driver-room-tv-1536.png');
    // The TV keeps its code: opening the one Driver Station link again goes straight to the TV board.
    await tv.goto(HOSTING + '/driver-station.html' + ADMIN);
    await tv.waitForURL(/tv=1/);
    await tv.waitForSelector('#eyebrow:text("Driver Room TV · Uniontown")');
    results.push('Driver Room TV: its code on the one Driver Station link opens the full-screen TV board, also when reopened');

    // Joe 10/12: the TV has a small Exit; with the plant's manager release code it unattaches the TV and goes to the code
    // screen (with Back and Home). A wrong code keeps the TV board; Cancel keeps it too.
    const release = (await require('../../src/admin').adminCall(db(), { email: 'admin.test@uniteddairy.com' }, { op: 'releaseCodeNew', facilityId: 'fac_uniontown' })).code;
    assert.equal(await tv.isVisible('#tv-exit'), true);
    assert.equal(await tv.isVisible('.topbar'), false);
    await tv.click('#tv-exit');
    await tv.waitForSelector('#release-box form');
    await tv.click('#release-box [data-cancel]');
    assert.equal(await tv.isVisible('#release-box form'), false);
    await tv.click('#tv-exit');
    await tv.fill('#release-box input', 'WRONG1');
    await tv.click('#release-box button[type=submit]');
    await tv.waitForFunction(() => /\S/.test(document.querySelector('.ps-release-msg').textContent) && !/Checking/.test(document.querySelector('.ps-release-msg').textContent));
    assert.match(tv.url(), /tv=1/);
    await tv.fill('#release-box input', release);
    await Promise.all([tv.waitForURL(u => !/tv=1/.test(String(u))), tv.click('#release-box button[type=submit]')]);
    await tv.waitForSelector('#code-box form.st-code');
    assert.equal(await tv.isVisible('#go-back'), true);
    assert.equal(await tv.isVisible('#go-home'), true);
    assert.equal(await tv.isVisible('#tv-exit'), false);
    results.push('Driver Room TV: Exit asks for the manager release code (Cancel and a wrong code keep the TV), the right code unattaches it to the code screen with Back and Home');

    // The Driver Room kiosk tablet: Change Station asks for the release code; Cancel keeps it, the right code frees it.
    await ds.click('#change');
    await ds.waitForSelector('#release-box form');
    await ds.click('#release-box [data-cancel]');
    assert.equal(await ds.isVisible('#go-checkin'), true);
    await ds.click('#change');
    await ds.fill('#release-box input', release);
    await ds.click('#release-box button[type=submit]');
    await ds.waitForSelector('#code-box form.st-code');
    assert.equal(await ds.evaluate(() => localStorage.getItem('udRoomStation')), null);
    assert.deepEqual(tv.errors, []);
    results.push('Driver Room kiosk: Change Station asks for the manager release code (Cancel keeps it), then the tablet forgets its code');
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('OK  ' + r));
})().catch(e => { console.error(e); process.exit(1); });

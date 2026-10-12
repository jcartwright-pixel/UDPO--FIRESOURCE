'use strict';
/*
 * Browser check of station codes (Joe 10/12, like the current app): Administration > Plant Station Codes, Garage Station
 * Codes and Driver Station Codes each show one link and a list of stations; + Add makes a station and Create code gives it
 * its own code. On a tablet, the Plant Station, Garage Station and Driver Room kiosk then ask for a code, open that station
 * when it is typed, and Release at the bottom (manager release code) sends them back to the code screen. Pictures at Joe's 1536 width go to SHOTS_DIR.
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
// Joe 10/12: a coded station has no Back, Home or Sign out; its one way out is the Release bar at the very bottom. Pictures of
// it at 1024 (tablet) and 1920 go to SHOTS_DIR as station-<name>-<width>.png.
async function locked(p, sel, name) {
  for (const gone of ['#go-back', '#go-home', '#signout']) assert.equal(await p.isVisible(gone), false, gone + ' is not on a station');
  assert.equal((await p.textContent(sel)).trim(), 'Release');
  const box = await p.$eval(sel, el => { const r = el.getBoundingClientRect(); return { bottom: r.bottom, width: r.width }; });
  const size = p.viewportSize();
  assert.ok(Math.abs(box.bottom - size.height) < 1 && box.width >= size.width - 1, 'Release is a bar along the very bottom');
  if (SHOTS && name) {
    for (const [w, h] of [[1024, 768], [1920, 1080]]) { await p.setViewportSize({ width: w, height: h }); await p.waitForTimeout(300); await shot(p, 'station-' + name + '-' + w + '.png'); }
    await p.setViewportSize(size);
  }
}
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
    // Joe 10/12: like Plant Station Codes: the one Driver Station (TV loadout) link ("I shouldn't have to have a different
    // link"), its stations right under it, then the drivers' phone link.
    assert.deepEqual(await p.$$eval('.ap-link', l => l.map(x => x.dataset.link)), ['driver', 'route']);
    assert.match(await p.textContent('.ap-link[data-link="driver"] h4'), /^Driver's Kiosk Station and Driver Room Check-In Station$/);
    assert.deepEqual(await p.$$eval('.ap-link[data-link="driver"], #st-list, .ap-link[data-link="route"]', l => l.map(x => x.dataset.link || x.id)), ['driver', 'st-list', 'route'], 'the stations sit under the Driver Station link');
    assert.equal((await p.textContent('#st-add')).trim(), '+ Add Station');
    await p.fill('#st-name', 'Plant kiosk');
    await p.click('#st-add');
    await p.waitForSelector('#st-list .ap-item b:text-is("Plant kiosk")');
    codes.kiosk = await makeCode('Driver Room Check-In Station');
    codes.tv = await makeCode("Driver's Kiosk Station");
    assert.equal(await p.isVisible('#view .ap-msg.good'), false, 'no green status bar (errors only)');
    assert.deepEqual(await p.$$eval('#st-list .ap-item b', b => b.map(x => x.textContent)), ['Driver Room Check-In Station', "Driver's Kiosk Station", 'Plant kiosk']);
    await twoShots(p, '3-driver-station-codes');
    assert.deepEqual(p.errors, []);
    results.push('Driver Station Codes: one Driver Station link, its stations under it (+ Add Station, more than one per plant), then the drivers\' phone link');

    // The Plant Station tablet: the code screen, a wrong code, the right one opens Case Loadout; Release stays put until the
    // plant has a manager release code (Joe 10/12: no Back, Home or Sign out; Release at the very bottom is the only way out).
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
    await locked(ps, '#change', 'plant');
    await ps.click('#change');
    await ps.waitForSelector('#error:not([hidden])');
    assert.match(await ps.textContent('#error'), /stays here until the plant has a manager release code/);
    assert.equal(await ps.textContent('#title'), 'Case Loadout', 'no release code: the station stays');
    assert.deepEqual(ps.errors, []);
    results.push('Plant Station: asks for the code, opens that station, remembers it; no Back, Home or Sign out; Release at the bottom refuses until a manager release code is set');

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
    assert.equal(await na.isVisible('#signout'), false, 'a no-account tablet leaves only through Release');
    await locked(na, '#change');
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
    await locked(gs, '#gs-change', 'garage');
    await shot(gs, '6-garage-station-opened-1536.png');
    await gs.click('#gs-change');
    await gs.waitForSelector('#gs-message:not([hidden])');
    assert.match(await gs.textContent('#gs-message'), /stays here until the plant has a manager release code/);
    assert.ok(await gs.isVisible('[data-tech]'), 'no release code: the garage station stays');
    assert.deepEqual(gs.errors, []);
    results.push('Garage Station: asks for the garage code, then the work orders; no Back or Home; Release at the bottom refuses until a manager release code is set');

    const ds = await openPage(browser, 1536, 864, '/driver-station.html' + ADMIN);
    await ds.waitForSelector('#code-box form.st-code');
    await shot(ds, '7-driver-kiosk-code-screen-1536.png');
    await ds.fill('#code-box input', codes.kiosk);
    // Joe 10/12 "I didn't want the Driver Room TV, it is showing the kiosk": the Driver Room tablet's code typed on the
    // Driver Station link opens the drivers' Check-In page (View Loadout, DVIR, Check-In), which keeps the code.
    await Promise.all([ds.waitForURL(/route\.html\?room=1$/), ds.click('#code-box button')]);
    await ds.waitForSelector('#step-menu:not([hidden]) #m-checkin');
    assert.equal(await ds.textContent('.phone-top b'), 'Uniontown Driver Room Check-In Station');
    assert.equal(await ds.$('#go-back, #go-home, #signout'), null, 'no Back, Home or Sign out into the app');
    assert.ok(await ds.evaluate(() => localStorage.getItem('udKioskCode')), 'the existing link keeps it too');
    await shot(ds, '8-driver-kiosk-opened-1536.png');
    // Reopening the existing link (or driver-room.html) goes straight back to the drivers' Check-In.
    await ds.goto(HOSTING + '/driver-station.html' + ADMIN);
    await ds.waitForURL(/route\.html\?room=1$/);
    await ds.goto(HOSTING + '/driver-room.html');
    await ds.waitForURL(/route\.html\?room=1$/);
    await ds.waitForSelector('#step-menu:not([hidden]) #m-checkin');
    // Joe 10/12: a driver must never get from the Driver Room into the app. With no manager release code set yet, Release
    // refuses (it used to let anyone through) and the tablet stays on its screen.
    await locked(ds, '#m-station', 'driver-room-checkin');
    await ds.click('#m-station');
    await ds.waitForSelector('#error:not([hidden])');
    assert.match(await ds.textContent('#error'), /stays here until the plant has a manager release code/);
    assert.equal(await ds.isVisible('#m-checkin'), true);
    await shot(ds, '8b-driver-room-no-release-code-1536.png');
    assert.deepEqual(ds.errors, []);
    results.push('Driver Room kiosk: its code on the existing Driver Station link opens the drivers\' Check-In (the phone screens), which keeps it; no Back, Home or Sign out; with no manager release code set, Release refuses');
    // A TV's code typed on the tablet link opens the TV display (no header).
    const tv = await openPage(browser, 1536, 864, '/driver-station.html' + ADMIN);
    await tv.waitForSelector('#code-box form.st-code');
    await tv.fill('#code-box input', codes.tv);
    await Promise.all([tv.waitForURL(/tv=1/), tv.click('#code-box button')]);
    await tv.waitForSelector('#eyebrow:text("Driver\'s Kiosk Station · Uniontown")');
    await shot(tv, '9-driver-room-tv-1536.png');
    // No release code yet: the TV's Release refuses too, and the TV has no Sign out or Exit.
    await locked(tv, '#change', 'driver-station-tv');
    assert.equal(await tv.isVisible('#tv-exit'), false, 'a coded TV has no Exit; Release is the only way out');
    await tv.click('#change');
    await tv.waitForSelector('#error:not([hidden])');
    assert.match(await tv.textContent('#error'), /stays here/);
    assert.match(tv.url(), /tv=1/);
    // The TV keeps its code: opening the one Driver Station link again goes straight to the TV board.
    await tv.goto(HOSTING + '/driver-station.html' + ADMIN);
    await tv.waitForURL(/tv=1/);
    await tv.waitForSelector('#eyebrow:text("Driver\'s Kiosk Station · Uniontown")');
    results.push('Driver Room TV: its code on the one Driver Station link opens the full-screen TV board, also when reopened; no Sign out or Exit, and Release refuses until a manager release code is set');

    // Joe 10/12: the TV's Release at the bottom, with the plant's manager release code, unattaches the TV and goes to the code
    // screen (with Back and Home). A wrong code keeps the TV board; Cancel keeps it too.
    const release = (await require('../../src/admin').adminCall(db(), { email: 'admin.test@uniteddairy.com' }, { op: 'releaseCodeNew', facilityId: 'fac_uniontown' })).code;
    assert.equal(await tv.isVisible('.topbar'), false);
    await tv.click('#change');
    await tv.waitForSelector('#release-box form');
    await tv.click('#release-box [data-cancel]');
    assert.equal(await tv.isVisible('#release-box form'), false);
    await tv.click('#change');
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
    assert.equal(await tv.isVisible('#change'), false, 'released: no Release bar');
    results.push('Driver Room TV: Release asks for the manager release code (Cancel and a wrong code keep the TV), the right code unattaches it to the code screen with Back and Home');

    // The Driver Room kiosk tablet: Release asks for the release code; Cancel keeps it, the right code frees it.
    await ds.click('#m-station');
    await ds.waitForSelector('#release-box form');
    await ds.click('#release-box [data-cancel]');
    assert.equal(await ds.isVisible('#m-checkin'), true);
    await ds.click('#m-station');
    await ds.fill('#release-box input', release);
    await Promise.all([ds.waitForURL(/driver-room\.html$/), ds.click('#release-box button[type=submit]')]);
    await ds.waitForSelector('#code-box form.st-code');
    assert.equal(await ds.evaluate(() => localStorage.getItem('udRoomStation')), null);
    assert.equal(await ds.evaluate(() => localStorage.getItem('udKioskCode')), null, 'the existing link forgets it too');
    assert.deepEqual(tv.errors, []);
    results.push('Driver Room kiosk: Release asks for the manager release code (Cancel keeps it), then the tablet forgets its code');

    // The Plant Station and the Garage Station: Release with the manager release code frees them to the code screen.
    await ps.click('#change');
    await ps.waitForSelector('#release:not([hidden])');
    await ps.fill('#release-code', release);
    await ps.click('#release-go');
    await ps.waitForSelector('#code-box form.st-code');
    assert.equal(await ps.isVisible('#change'), false);
    await gs.click('#gs-change');
    await gs.waitForSelector('#gs-release form');
    await gs.fill('#gs-release input', release);
    await gs.click('#gs-release button[type=submit]');
    await gs.waitForSelector('#view-code form.st-code');
    assert.equal(await gs.isVisible('#gs-change'), false);
    assert.deepEqual(ps.errors, []);
    assert.deepEqual(gs.errors, []);
    results.push('Plant Station and Garage Station: Release with the manager release code frees the tablet to the code screen');
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('OK  ' + r));
})().catch(e => { console.error(e); process.exit(1); });

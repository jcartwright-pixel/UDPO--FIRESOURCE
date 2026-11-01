'use strict';
/*
 * Browser check of station codes (Joe 10/12, like the current app): Administration > Plant Station Codes, Garage Station
 * Codes and Driver Station Codes each show one link and a list of stations; + Add makes a station and Create code gives it
 * its own code. On a tablet, the Plant Station, Garage Station and Driver Room kiosk then ask for a code, open that station
 * when it is typed, and Release in the bottom-right corner (manager release code) sends the Plant Station back to its code
 * screen (Joe 10/27) and the Garage Station and Driver Room kiosk to the Home menu. Pictures at Joe's 1536 width go to SHOTS_DIR.
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
// The stations themselves are opened with a manager's account: an Administrator is never locked to a station (Joe 10/29).
const MGR = '?testEmail=manager.test@uniteddairy.com';

async function openPage(browser, width, height, url) {
  const page = await browser.newPage({ viewport: { width, height }, serviceWorkers: 'block' });
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
// Joe 10/12: a coded station has no Back, Home or Sign out; its one way out is Release, a small button in the bottom-right corner (Joe 10/13). Pictures of
// it at 1024 (tablet) and 1920 go to SHOTS_DIR as station-<name>-<width>.png.
async function locked(p, sel, name) {
  for (const gone of ['#go-back', '#go-home', '#signout']) assert.equal(await p.isVisible(gone), false, gone + ' is not on a station');
  assert.equal((await p.textContent(sel)).trim(), 'Release');
  // Joe 10/13 "the release needs just to be a little small, in the bottom right": a small button in the corner (text 16px or more,
  // big enough to tap) that covers nothing: the screen stops above it.
  const box = await p.$eval(sel, el => { const r = el.getBoundingClientRect(); return { bottom: r.bottom, right: r.right, width: r.width, height: r.height, font: parseFloat(getComputedStyle(el).fontSize) }; });
  const size = p.viewportSize();
  assert.ok(size.height - box.bottom < 20 && size.width - box.right < 20 && box.width < size.width / 3, 'Release is a small button in the bottom-right corner ' + JSON.stringify(box));
  assert.ok(box.font >= 16 && box.height >= 40, 'Release reads at 16px or more and is easy to tap ' + JSON.stringify(box));
  if (SHOTS && name) {
    for (const [w, h] of [[1024, 768], [1280, 800], [1920, 1080]]) { await p.setViewportSize({ width: w, height: h }); await p.waitForTimeout(300); await shot(p, 'station-' + name + '-' + w + '.png'); }
    await p.setViewportSize(size);
  }
}
const noSideScroll = (p) => p.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth);
// Joe 10/16 (Window Test Center, Phone 412 x 915): the code screen fits a phone with no sideways scroll; the box shrinks
// with the window, the code input included. Back to the page's own size after.
async function codeFitsPhones(p, name) {
  const size = p.viewportSize();
  for (const w of [390, 412]) {
    await p.setViewportSize({ width: w, height: 900 });
    await p.waitForTimeout(200);
    assert.ok(await noSideScroll(p), name + ' code screen fits a ' + w + ' phone (' + await p.evaluate(() => document.scrollingElement.scrollWidth) + ' px wide)');
    const inp = await p.$eval('.st-code input', el => { const r = el.getBoundingClientRect(); return { right: r.right, font: parseFloat(getComputedStyle(el).fontSize) }; });
    assert.ok(inp.right <= w && inp.font >= 16, name + ' code box stays inside a ' + w + ' phone ' + JSON.stringify(inp));
    if (w === 412) await shot(p, name.toLowerCase().replace(/ /g, '-') + '-code-screen-412.png');
  }
  await p.setViewportSize(size);
}

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
    assert.deepEqual(await p.$$eval('.ap-link', l => l.map(x => x.dataset.link)), ['plant', 'public', 'line']);
    // Joe 10/28: the line tablets' code sits under the Plant Stations.
    assert.deepEqual(await p.$$eval('#lt-list .ap-item b', b => b.map(x => x.textContent)), ['Line Tablet']);
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
    // Joe 10/28: the Maintenance Station's own code sits under the garage stations; each list answers its own buttons.
    assert.deepEqual(await p.$$eval('#ms-list .ap-item b', b => b.map(x => x.textContent)), ['Maintenance Station']);
    codes.garage = await makeCode('Garage');
    assert.equal(await p.$$eval('#ms-list code', c => c.length), 0, 'a garage code leaves the Maintenance Station without one');
    await twoShots(p, '2-garage-station-codes');
    results.push('Garage Station Codes: its own page with the Garage Station link and its stations');

    // Joe 10/18: the Plant Managers app: its link (a UD account with the Manager or Administrator role) and its code.
    await open('manager-app-codes');
    assert.deepEqual(await p.$$eval('.ap-link', l => l.map(x => x.dataset.link)), ['managers']);
    assert.match(await p.$eval('.ap-link[data-link="managers"]', el => el.outerHTML), /walkthrough\.html\?view=home&(amp;)?app=1/);
    assert.deepEqual(await p.$$eval('#st-list .ap-item b', b => b.map(x => x.textContent)), ['Plant Managers']);
    codes.managers = await makeCode('Plant Managers');
    assert.ok(await noSideScroll(p));
    await twoShots(p, '2b-plant-managers-app');
    results.push('Plant Managers App: its own page with the Plant Managers link and its code; Create code works');

    // Joe 10/31: the Sales app: just its link, for any United Dairy account (no code).
    await p.click('.adm-item[data-key="sales-app"]');
    await p.waitForSelector('.ap-link[data-link="sales"]');
    assert.deepEqual(await p.$$eval('.ap-link', l => l.map(x => x.dataset.link)), ['sales']);
    assert.match(await p.$eval('.ap-link[data-link="sales"]', el => el.outerHTML), /href="sales\.html"/);
    assert.equal(await p.textContent('.ap-link[data-link="sales"] .ap-chip'), 'UD sign-in');
    assert.equal(await p.$$eval('#st-list', l => l.length), 0, 'no codes on the Sales App page');
    assert.ok(await noSideScroll(p));
    await shot(p, '2c-sales-app-1536.png');
    results.push('Sales App: its own page with the Sales App link (copy, QR, Launch), no code');

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
    // plant has a manager release code (Joe 10/12: no Back, Home or Sign out; Release in the bottom-right corner is the only way out).
    const ps = await openPage(browser, 1536, 864, '/plant-station.html' + MGR);
    await ps.waitForSelector('#code-box form.st-code');
    assert.equal(await ps.isVisible('#pick'), false, 'no station list once the plant has codes');
    await shot(ps, '4-plant-station-code-screen-1536.png');
    await codeFitsPhones(ps, 'Plant Station');
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
    results.push('Plant Station: asks for the code, opens that station, remembers it; no Back, Home or Sign out; Release in the bottom-right corner refuses until a manager release code is set');

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
    // Any other screen goes straight back to the station, the manager's Loadout Center too (Joe 10/12: the station is for the
    // employees; Joe 10/27: a plant tablet goes nowhere else).
    for (const other of ['/daily.html', '/loadout.html?area=CASE', '/unloading.html']) {
      await na.goto(HOSTING + other);
      await na.waitForURL(/plant-station\.html$/);
      await na.waitForSelector('#work .sw-panel');
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

    // Joe 10/12 "all my stations will have a United Dairy login, then a code": the garage tablet signs in first.
    const nogs = await openPage(browser, 1536, 864, '/garage-station.html');
    await nogs.waitForSelector('#signin:not([hidden]) #signin-button');
    assert.equal(await nogs.isVisible('#view-code'), false, 'no station code before the United Dairy sign-in');
    await nogs.close();
    const gs = await openPage(browser, 1536, 864, '/garage-station.html?testEmail=manager.test@uniteddairy.com');
    await gs.waitForSelector('#view-code form.st-code');
    await gs.fill('#view-code input', codes.garage);
    await gs.click('#view-code button');
    // Joe 10/28: it opens on the three cards (Trucks, Trailers, Fork trucks).
    await gs.waitForSelector('#view-home:not([hidden]) [data-type="TRUCK"]');
    assert.match(await gs.textContent('#title'), /^Garage · Uniontown$/);
    await locked(gs, '#gs-change', 'garage');
    await shot(gs, '6-garage-station-opened-1536.png');
    await gs.click('#gs-change');
    await gs.waitForSelector('#gs-message:not([hidden])');
    assert.match(await gs.textContent('#gs-message'), /stays here until the plant has a manager release code/);
    assert.ok(await gs.isVisible('[data-type="TRUCK"]'), 'no release code: the garage station stays');
    assert.deepEqual(gs.errors, []);
    results.push('Garage Station: asks for the garage code, then the work orders; no Back or Home; Release in the bottom-right corner refuses until a manager release code is set');

    const ds = await openPage(browser, 1536, 864, '/driver-station.html' + MGR);
    await ds.waitForSelector('#code-box form.st-code');
    await codeFitsPhones(ds, 'Driver Station');
    await shot(ds, '7-driver-kiosk-code-screen-1536.png');
    assert.equal(await ds.textContent('.head h1'), 'Driver Station', 'the code screen is a plain setup screen, not the loadout');
    assert.equal(await ds.isVisible('#tv'), false);
    await ds.fill('#code-box input', codes.kiosk);
    // Joe 10/12 "I didn't want the Driver Room TV, it is showing the kiosk": the Driver Room tablet's code typed on the
    // Driver Station link opens the drivers' Check-In page (View Loadout, DVIR, Check-In), which keeps the code.
    await Promise.all([ds.waitForURL(/route\.html\?room=1$/), ds.click('#code-box button')]);
    await ds.waitForSelector('#step-menu:not([hidden]) #m-checkin');
    assert.equal(await ds.textContent('.phone-top b'), 'Uniontown Driver Room Check-In Station');
    assert.equal(await ds.$('#go-back, #go-home, #signout'), null, 'no Back, Home or Sign out into the app');
    assert.ok(await ds.evaluate(() => localStorage.getItem('udKioskCode')), 'the existing link keeps it too');
    await shot(ds, '8-driver-kiosk-opened-1536.png');
    // Reopening the existing link (or the old driver-room.html, via the Driver Station link) goes straight back to the drivers' Check-In.
    await ds.goto(HOSTING + '/driver-station.html' + MGR);
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
    const tv = await openPage(browser, 1536, 864, '/driver-station.html' + MGR);
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
    await tv.goto(HOSTING + '/driver-station.html' + MGR);
    await tv.waitForURL(/tv=1/);
    await tv.waitForSelector('#eyebrow:text("Driver\'s Kiosk Station · Uniontown")');
    results.push('Driver Room TV: its code on the one Driver Station link opens the full-screen TV board, also when reopened; no Sign out or Exit, and Release refuses until a manager release code is set');

    // Joe 10/12: the TV's Release in the bottom-right corner, with the plant's manager release code, unattaches the TV and goes to the Home
    // menu (Joe 10/13). A wrong code keeps the TV board; Cancel keeps it too.
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
    // Joe 10/28 "you need to block that exact same way" (replaces 10/13's Home menu): the right code unattaches the TV and goes back
    // to its code screen only, with no Back, Home or Sign out; the TV forgets its code and opens nothing else.
    await tv.click('#release-box button[type=submit]');
    await tv.waitForSelector('#code-box form.st-code');
    assert.match(tv.url(), /driver-station\.html\?tv=1$/);
    assert.equal(await tv.evaluate(() => localStorage.getItem('udKioskCode')), null);
    for (const gone of ['#go-back', '#go-home', '#signout', '#change']) assert.equal(await tv.isVisible(gone), false, gone + ' is not on the TV\'s code screen after Release');
    await Promise.all([tv.waitForURL(/driver-station\.html/), tv.goto(HOSTING + '/index.html')]);
    await tv.waitForSelector('#code-box form.st-code');
    results.push('Driver Room TV: Release asks for the manager release code (Cancel and a wrong code keep the TV), the right code unattaches it and goes back to its code screen; the TV opens nothing else');

    // The Driver Room kiosk tablet: Release asks for the release code; Cancel keeps it, the right code frees it.
    await ds.click('#m-station');
    await ds.waitForSelector('#release-box form');
    await ds.click('#release-box [data-cancel]');
    assert.equal(await ds.isVisible('#m-checkin'), true);
    await ds.click('#m-station');
    await ds.fill('#release-box input', release);
    // Joe 10/28: back to the Check-In Station's code screen only (it went to the Home menu before).
    await Promise.all([ds.waitForURL(/driver-station\.html\?for=room$/), ds.click('#release-box button[type=submit]')]);
    await ds.waitForSelector('#code-box form.st-code');
    for (const gone of ['#go-back', '#go-home', '#signout']) assert.equal(await ds.isVisible(gone), false, gone + ' is not on the Check-In Station\'s code screen after Release');
    assert.equal(await ds.evaluate(() => localStorage.getItem('udRoomStation')), null);
    assert.equal(await ds.evaluate(() => localStorage.getItem('udKioskCode')), null, 'the existing link forgets it too');
    assert.deepEqual(tv.errors, []);
    // Opened again to set it up, the Check-In Station's code screen names only that station: no loadout title, Desk view or Refresh.
    await ds.goto(HOSTING + '/route.html?room=1');
    await ds.waitForURL(/driver-station\.html\?for=room$/);
    await ds.waitForSelector('#code-box form.st-code');
    assert.equal(await ds.textContent('.head h1'), 'Driver Room Check-In Station');
    assert.doesNotMatch(await ds.textContent('#code-box'), /Kiosk|TV/);
    assert.equal(await ds.isVisible('#tv'), false);
    assert.equal(await ds.isVisible('#refresh'), false);
    await shot(ds, '7b-driver-room-setup-code-screen-1536.png');
    results.push('Driver Room kiosk: Release asks for the manager release code (Cancel keeps it), then the tablet forgets its code and goes back to the code screen, which names only the Check-In Station; the tablet opens nothing else');

    // Joe 10/27 (replaces 10/13's Home menu for the plant tablets): the Plant Station's Release with the manager release code
    // goes back to the station code screen, never the app; the tablet still opens no other screen (Joe 10/27: "that's the only thing it's allowed").
    await ps.click('#change');
    await ps.waitForSelector('#release:not([hidden])');
    await ps.fill('#release-code', release);
    assert.deepEqual(ps.errors, []);
    await ps.click('#release-go');
    await ps.waitForSelector('#code-box form.st-code');
    assert.match(ps.url(), /plant-station\.html/);
    for (const gone of ['#go-back', '#go-home', '#signout', '#change']) assert.equal(await ps.isVisible(gone), false, gone + ' is not on the code screen after Release');
    await Promise.all([ps.waitForURL(/plant-station\.html/), ps.goto(HOSTING + '/index.html' + MGR)]);
    await ps.waitForSelector('#code-box form.st-code');
    await gs.click('#gs-change');
    await gs.waitForSelector('#gs-release form');
    await gs.fill('#gs-release input', release);
    assert.deepEqual(gs.errors, []);
    // Joe 10/28: the Garage Station the same way: back to its code screen, never the Home menu.
    await gs.click('#gs-release button[type=submit]');
    await gs.waitForSelector('#view-code form.st-code');
    assert.match(gs.url(), /garage-station\.html/);
    for (const gone of ['#go-back', '#go-home', '#gs-change']) assert.equal(await gs.isVisible(gone), false, gone + ' is not on the garage code screen after Release');
    await Promise.all([gs.waitForURL(/garage-station\.html/), gs.goto(HOSTING + '/index.html' + MGR)]);
    await gs.waitForSelector('#view-code form.st-code');
    results.push('Plant Station and Garage Station: Release with the manager release code goes back to the code screen and the tablet opens nothing else');
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('OK  ' + r));
})().catch(e => { console.error(e); process.exit(1); });

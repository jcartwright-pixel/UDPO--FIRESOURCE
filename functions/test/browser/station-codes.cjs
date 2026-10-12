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
    assert.match(await p.textContent('.ap-link[data-link="public"]'), /Being built/);
    assert.deepEqual(await p.$$eval('#st-list .ap-item b', b => b.map(x => x.textContent)), ['Case Loadout', 'Case Unloading', 'Tote Loadout', 'Boxing Loadout', 'Yard Services']);
    await p.fill('#st-name', 'Case Loadout dock 2');
    await p.selectOption('#st-type', 'CASE');
    await p.click('#st-add');
    await p.waitForSelector('#st-list .ap-item b:text-is("Case Loadout dock 2")');
    codes.plant = await makeCode('Case Loadout');
    await makeCode('Case Loadout dock 2');
    assert.ok(await noSideScroll(p));
    await twoShots(p, '1-plant-station-codes');
    results.push('Plant Station Codes: the Plant Station link, the no-account link (being built), the stations; + Add Station and Create code work');

    await open('garage-codes');
    assert.deepEqual(await p.$$eval('.ap-link', l => l.map(x => x.dataset.link)), ['garage', 'maint']);
    codes.garage = await makeCode('Garage');
    await twoShots(p, '2-garage-station-codes');
    results.push('Garage Station Codes: its own page with the Garage Station link and its stations');

    await open('driver-codes');
    // Joe 10/12: like Plant Station Codes: one Driver Station link, its stations right under it, then the drivers' phone link.
    assert.deepEqual(await p.$$eval('.ap-link', l => l.map(x => x.dataset.link)), ['driver', 'route']);
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
    await ps.waitForSelector('.ps-tab');
    assert.equal(await ps.textContent('#title'), 'Case Loadout');
    await shot(ps, '5-plant-station-opened-1536.png');
    await ps.reload();
    await ps.waitForSelector('.ps-tab');
    assert.equal(await ps.textContent('#title'), 'Case Loadout', 'the tablet remembers its station');
    await ps.click('#change');
    await ps.waitForSelector('#code-box form.st-code');
    assert.deepEqual(ps.errors, []);
    results.push('Plant Station: asks for the code, opens that station, remembers it; Change Station asks again');

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
    await ds.click('#code-box button');
    await ds.waitForSelector('#eyebrow:text("Driver Room kiosk · Uniontown")');
    assert.equal(await ds.isVisible('#ds-grid'), true);
    await shot(ds, '8-driver-kiosk-opened-1536.png');
    assert.deepEqual(ds.errors, []);
    results.push('Driver Room kiosk: asks for its code, then the board');
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
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('OK  ' + r));
})().catch(e => { console.error(e); process.exit(1); });

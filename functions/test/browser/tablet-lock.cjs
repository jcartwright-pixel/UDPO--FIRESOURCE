'use strict';
/*
 * Joe 10/27: "they should be able to go no other places than where we designed them to go. When you release it, it just goes
 * back to the input screen where you can put in the code." The audit of every plant tablet and the Plant Managers app, kept as
 * a check so a leak cannot come back. For each Plant Station (Case Loadout, Case Unloading, Tote Loadout, Boxing Loadout, Yard
 * Services), opened both ways (a United Dairy account then the code, and the code alone):
 *   - every button and tab on the station (and inside its Yard Services / Trailer Assignments frame) is pressed and the tablet
 *     must still be on the Plant Station;
 *   - every screen of the app typed into the address bar goes straight back to the Plant Station;
 *   - Release with the manager release code goes back to the code screen, which has no Back, Home or Sign out, and the
 *     tablet still opens no other screen.
 * The Case Unloading tablet opens on the choice of Case Unloading or Trailer Assignments, with Back to the choice.
 * Joe 10/28: the Garage Station, Maintenance Station, a line tablet and the Driver Room TV and tablet the same way (OTHERS).
 * The Plant Managers app (phone): no menu, no Home, Help or Administration; it opens exactly the managers' screens (the
 * walkthrough, Yard, Coolers, Production, Loading, Unloading with its Returns and Washing) and every other screen goes back
 * to its start. What each one reached is printed (and saved as tablet-lock-audit.md in SHOTS_DIR).
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const F = require('../fixtures/fake-sheets');
const PD = require('../fixtures/plant-demo');
const STATIONS = require('../../src/stations');
const localCalls = require('./local-calls.cjs');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR || '';
const ADMIN = 'admin.test@uniteddairy.com';
const UD = '?testEmail=' + ADMIN;
const MANAGER = 'testEmail=manager.test@uniteddairy.com';
// Every screen of the app (the pages in public/).
const PAGES = fs.readdirSync(path.join(__dirname, '../../../public')).filter(f => /\.html$/.test(f)).sort();
const MANAGER_PAGES = ['walkthrough.html', 'yard.html', 'temps.html', 'quality.html', 'loadout.html', 'unloading.html', 'returns.html', 'washing.html'];
const NOW = '2026-10-08T14:00:00Z';
const pageOf = (url) => new URL(url).pathname.split('/').pop() || 'index.html';

async function openPage(browser, opts, url) {
  const ctx = await browser.newContext(Object.assign({ serviceWorkers: 'block' }, opts));
  await ctx.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
  });
  const page = await ctx.newPage();
  // The made-up plant's day, so the stations have loads, trailers and buttons to press.
  // (A running clock, so each screen still finishes drawing and shows.)
  await page.clock.install({ time: new Date(NOW) });
  await page.clock.resume();
  await localCalls(page);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  // A screen that tries to open a window of its own is a way out too.
  page.on('popup', p => errors.push('opened a new window: ' + p.url()));
  page.on('dialog', d => d.dismiss().catch(() => {}));
  if (url) await page.goto(HOSTING + url);
  page.errors = errors;
  return page;
}
const tablet = () => ({ viewport: { width: 1024, height: 768 }, hasTouch: true });
const phone = () => ({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
// Pictures once the screen has finished drawing (app.js fades a screen in when it is ready).
const shot = async (page, name) => {
  if (!SHOTS) return;
  await page.waitForFunction(() => !document.body.classList.contains('ud-drawing'), null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOTS, name + '.png') });
};

// Typed into the address bar: each screen must end on `home` (a page name); returns the screens that did not.
async function typedAll(page, pages, home, allowed) {
  const out = [], navs = [];
  const onNav = (f) => { if (f === page.mainFrame()) navs.push(Date.now() % 100000 + ' ' + f.url().replace(HOSTING, '')); };
  page.on('framenavigated', onNav);
  for (const p of pages) {
    await page.goto(HOSTING + '/' + p, { waitUntil: 'commit' }).catch(() => {});
    const ok = allowed && allowed.indexOf(p) >= 0;
    try {
      if (ok) await page.waitForLoadState('domcontentloaded');
      else await page.waitForURL(u => pageOf(String(u)) === home, { timeout: 15000 });
    } catch (e) { out.push(p + ' stayed on ' + pageOf(page.url()) + ' navs=' + navs.slice(-6).join(', ')); }
    if (ok && pageOf(page.url()) !== p) out.push(p + ' (a manager screen) went to ' + pageOf(page.url()));
  }
  page.off('framenavigated', onNav);
  return out;
}

// Press every button, tab and link on the station (and inside its frame) one at a time; after each, the tablet must still be on
// the Plant Station (or `home`, a test of the page's address). Release and the Release box are left out (Release is checked on
// its own). Returns what was pressed.
async function pressAll(page, home) {
  const onHome = home || ((u) => pageOf(u) === 'plant-station.html');
  const pressed = [];
  const pick = 'button:visible, a[href]:visible, [role="tab"]:visible, [data-card]:visible, [data-open]:visible';
  const skip = (t) => /^(Release|RELEASE THIS STATION)$/i.test(t);
  for (const where of ['top', 'frame']) {
    for (let i = 0; i < 60; i++) {
      const scope = where === 'top' ? page.mainFrame() : page.frames().find(f => f !== page.mainFrame() && /inStation=1/.test(f.url()));
      if (!scope) break;
      const all = await scope.$$(pick).catch(() => []);
      if (i >= all.length) break;
      const el = all[i], label = ((await el.textContent().catch(() => '')) || (await el.getAttribute('title').catch(() => '')) || '').replace(/\s+/g, ' ').trim().slice(0, 40);
      if (skip(label) || await el.evaluate(e => !!e.closest('#release, #release-box, #gs-release, #ms-release, .sw-frame') || e.type === 'submit').catch(() => true)) continue;
      await el.click({ timeout: 2000, trial: false }).catch(() => {});
      await page.waitForTimeout(250);
      // A pop-up box or a form the button opened: Escape and the screen's own Cancel close it again.
      await page.keyboard.press('Escape').catch(() => {});
      pressed.push((where === 'frame' ? 'frame: ' : '') + (label || '(no words)'));
      assert.ok(onHome(page.url()), 'pressing "' + label + '" left the station for ' + page.url());
      const f = page.frames().find(x => x !== page.mainFrame() && /\.html/.test(x.url()));
      if (f) assert.ok(['trailers.html', 'yard.html'].indexOf(pageOf(f.url())) >= 0, 'pressing "' + label + '" opened ' + f.url() + ' inside the station');
    }
  }
  return pressed;
}

const PLANT = [['CASE', 'Case Loadout'], ['CASE_UNLOADING', 'Case Unloading'], ['TOTES', 'Tote Loadout'], ['BOXING', 'Boxing Loadout'], ['YARD_SERVICES', 'Yard Services']];

/*
 * Joe 10/28 "you need to block that exact same way": the Garage Station, the Maintenance Station, a line tablet, the Driver Room
 * TV (Driver's Kiosk Station) and the Driver Room tablet (Driver Room Check-In Station). Each: its link, its code, then
 * every button pressed (still on its screen), every screen typed in (back to its screen), and Release with the manager release
 * code (back to its code screen, no Back, Home or Sign out, nothing else opens).
 *   open: the address it is set up from; key: its station; code: where its code is typed; ready: its screen once open;
 *   home: its page; onHome: the addresses it may be on; release / box: its Release button and the release code box.
 */
const OTHERS = [
  { name: 'Garage Station', key: 'fac_uniontown_garage_garage', open: '/garage-station.html?' + MANAGER, code: '#view-code', ready: 'body.station-locked #view-jobs:not([hidden])', home: 'garage-station.html', release: '#gs-change', box: '#gs-release', gone: ['#go-back', '#go-home'] },
  { name: 'Maintenance Station', key: 'fac_uniontown_maint_maint', open: '/maint-station.html', code: '#view-code', ready: 'body.station-locked #view-jobs:not([hidden])', home: 'maint-station.html', release: '#ms-change', box: '#ms-release', gone: ['#go-back', '#go-home'] },
  { name: 'Line tablet', key: 'fac_uniontown_line_line', open: '/line.html' + UD + '&tablet=1', code: '#code-box', pick: '#line-list [data-line]', ready: 'body.station-locked #line-head:not([hidden])', home: 'line.html', release: '#lt-release', box: '#release-box', gone: ['#go-back', '#go-home', '#signout', '#change'] },
  { name: 'Driver Room TV (Driver\'s Kiosk Station)', key: 'fac_uniontown_kiosk_tv', open: '/driver-station.html' + UD, code: '#code-box', ready: 'body.station-locked #ds-grid:not([hidden])', home: 'driver-station.html', release: '#change', box: '#release-box', gone: ['#go-back', '#go-home', '#signout', '#tv-exit'] },
  { name: 'Driver Room tablet (Driver Room Check-In Station)', key: 'fac_uniontown_kiosk_driver', open: '/driver-station.html?for=room&' + MANAGER, code: '#code-box', ready: 'body.room.station-locked #m-station', home: 'route.html', onHome: (u) => pageOf(u) === 'route.html' && /[?&]room=1/.test(u),
    release: '#m-station', box: '#release-box', gone: ['#go-back', '#go-home', '#signout'], after: 'driver-station.html' }
];

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date(NOW) });
  const at = new Date().toISOString(), codes = {};
  for (const [type] of PLANT) codes[type] = (await STATIONS.stationCode(db(), ADMIN, { key: 'fac_uniontown_plant_' + type.toLowerCase() }, at)).code;
  codes.managers = (await STATIONS.stationCode(db(), ADMIN, { key: 'fac_uniontown_manager_managers' }, at)).code;
  for (const o of OTHERS) codes[o.key] = (await STATIONS.stationCode(db(), ADMIN, { key: o.key }, at)).code;
  await STATIONS.noAccountSet(db(), ADMIN, { facilityId: 'fac_uniontown', on: true }, at);
  const release = (await require('../../src/admin').adminCall(db(), { email: ADMIN }, { op: 'releaseCodeNew', facilityId: 'fac_uniontown' })).code;
  const browser = await chromium.launch();
  const results = [], audit = ['# Plant tablets, the garage, maintenance and line tablets, the Driver Room and the Plant Managers app: where each one can go', ''];
  try {
    for (const [type, name] of PLANT) {
      for (const how of ['ud', 'code']) {
        const what = name + (how === 'ud' ? ' (United Dairy account, then code)' : ' (code alone)');
        const p = await openPage(browser, tablet(), how === 'ud' ? '/plant-station.html' + UD : '/plant-station.html?noaccount=1');
        if (how === 'ud') {
          await p.waitForSelector('#code-box form.st-code');
          await p.fill('#code-box input', codes[type]);
          await p.click('#code-box button');
        } else {
          await p.waitForSelector('#noacct:not([hidden])');
          await p.fill('#noacct-code', codes[type]);
          await p.click('#noacct button');
        }
        await p.waitForFunction(() => !document.getElementById('station').hidden && !document.getElementById('screen').hidden);
        // Joe 10/27: the Case Unloading tablet opens on the choice of its two parts; Back comes back to the choice.
        if (type === 'CASE_UNLOADING') {
          assert.deepEqual(await p.$$eval('#tabs [data-part] b', b => b.map(x => x.textContent)), ['Case Unloading', 'Trailer Assignments']);
          assert.equal(await p.isVisible('#ps-back'), false, 'no Back on the choice itself');
          if (how === 'ud') await shot(p, 'tablet-lock-case-unloading-choice-1024');
          await p.click('[data-part="trailers"]');
          await p.waitForSelector('#work iframe.sw-frame');
          assert.equal(await p.textContent('#title'), 'Trailer Assignments');
          assert.ok(await p.isVisible('#ps-back'));
          if (how === 'ud') { await p.waitForTimeout(1500); await shot(p, 'tablet-lock-trailer-assignments-1024'); }
          await p.click('#ps-back');
          await p.waitForSelector('#tabs [data-part]');
          await p.click('[data-part="unload"]');
          await p.waitForSelector('#tabs [data-view="unloading"]');
          assert.deepEqual(await p.$$eval('#tabs [data-view]', b => b.map(x => x.dataset.view)), ['unloading', 'washing', 'returns']);
          assert.equal(await p.textContent('#title'), 'Case Unloading');
          if (how === 'ud') await shot(p, 'tablet-lock-case-unloading-1024');
          await p.click('#ps-back');
          await p.waitForSelector('#tabs [data-part]');
        }
        for (const gone of ['#go-back', '#go-home', '#signout', '#go-admin', '#go-help', '.sidemenu']) assert.equal(await p.isVisible(gone), false, what + ': ' + gone + ' is not on a station');
        // The station's lists (and a Yard Services frame) read in before the buttons are pressed.
        await p.waitForTimeout(3000);
        // A frame on the station (Yard Services) opens its screen, never a Google sign-in, with either way of signing in.
        const fr = p.frames().find(f => f !== p.mainFrame() && /inStation=1/.test(f.url()));
        if (fr) assert.equal(await fr.isVisible('#signin'), false, what + ': the screen inside the station asks for a Google sign-in');
        const pressed = await pressAll(p);
        // Every screen typed in goes back to the station (all of them once per kind of sign-in; the main ones for the rest).
        const typed = type === 'CASE' ? PAGES : ['index.html', 'company.html', 'administration.html', 'manager.html', 'daily.html', 'loadout.html', 'unloading.html', 'trailers.html', 'yard.html', 'help.html', 'walkthrough.html'];
        const leaks = await typedAll(p, typed, 'plant-station.html');
        assert.deepEqual(leaks, [], what + ': typed screens that did not go back to the station');
        await p.waitForFunction(() => !document.getElementById('station').hidden && !document.getElementById('screen').hidden);
        // Release with the manager release code: back to the code screen, and still nothing else opens.
        await p.click('#change');
        await p.waitForSelector('#release:not([hidden])');
        await p.fill('#release-code', release);
        await p.click('#release-go');
        await p.waitForSelector(how === 'ud' ? '#code-box form.st-code' : '#noacct:not([hidden])');
        assert.equal(pageOf(p.url()), 'plant-station.html', what + ': Release stays on the Plant Station');
        for (const gone of ['#go-back', '#go-home', '#change', '#go-admin', '.sidemenu']) assert.equal(await p.isVisible(gone), false, what + ': ' + gone + ' is not on the code screen');
        if (how === 'ud') assert.equal(await p.isVisible('#signout'), false, what + ': no Sign out on the code screen');
        if (type === 'CASE') await shot(p, 'tablet-lock-after-release-' + how + '-1024');
        const after = await typedAll(p, ['index.html', 'company.html', 'administration.html', 'manager.html', 'loadout.html'], 'plant-station.html');
        assert.deepEqual(after, [], what + ': after Release, typed screens that did not go back to the code screen');
        assert.deepEqual(p.errors.filter(e => !/Missing or insufficient permissions/.test(e)), [], what + ': no errors or new windows');
        audit.push('## ' + what, '', '- Opens: the ' + name + ' station only' + (type === 'CASE_UNLOADING' ? ' (a choice of Case Unloading or Trailer Assignments, with Back to the choice)' : '') + '.',
          '- Pressed ' + pressed.length + ' buttons, tabs and links (' + [...new Set(pressed)].join(', ') + '): all stayed on the station.', '- Typed ' + typed.length + ' other screens into the address bar: every one came back to the station.',
          '- Release (manager release code): back to the code screen; nothing else opens after it.', '');
        results.push(what + ': ' + pressed.length + ' buttons pressed and ' + typed.length + ' screens typed in, all stayed on the station; Release went back to the code screen');
        await p.context().close();
      }
    }

    // The Garage Station, the Maintenance Station, a line tablet and the Driver Room's TV and tablet (Joe 10/28).
    for (const o of OTHERS) {
      const p = await openPage(browser, tablet(), o.open);
      const onHome = o.onHome || ((u) => pageOf(u) === o.home);
      await p.waitForSelector(o.code + ' form.st-code');
      await p.fill(o.code + ' input', codes[o.key]);
      await p.click(o.code + ' button');
      if (o.pick) { await p.waitForSelector(o.pick); await p.click(o.pick); }
      await p.waitForSelector(o.ready);
      assert.ok(onHome(p.url()), o.name + ': its code opens its own screen (' + p.url() + ')');
      for (const gone of o.gone.concat(['#go-admin', '#go-help', '.sidemenu'])) assert.equal(await p.isVisible(gone), false, o.name + ': ' + gone + ' is not on the station');
      assert.equal((await p.textContent(o.release)).trim(), 'Release');
      await p.waitForTimeout(2000);
      await shot(p, 'tablet-lock-' + o.home.replace('.html', '') + '-1024');
      const pressed = await pressAll(p, onHome);
      const typed = o.home === 'garage-station.html' ? PAGES : ['index.html', 'company.html', 'administration.html', 'manager.html', 'daily.html', 'garage.html', 'pmaint.html', 'production.html', 'route.html', 'driver-station.html', 'line.html', 'garage-station.html', 'maint-station.html', 'plant-station.html', 'help.html'];
      const leaks = await typedAll(p, typed, o.home);
      assert.deepEqual(leaks, [], o.name + ': typed screens that did not go back to the station');
      await p.waitForSelector(o.ready);
      assert.ok(onHome(p.url()), o.name + ': back on its own screen (' + p.url() + ')');
      // Release with the manager release code: back to the code screen, and still nothing else opens.
      await p.click(o.release);
      await p.waitForSelector(o.box + ' form');
      await p.fill(o.box + ' input', release);
      await p.click(o.box + ' button[type=submit]');
      await p.waitForSelector(o.code + ' form.st-code');
      assert.equal(pageOf(p.url()), o.after || o.home, o.name + ': Release stays on its own page');
      for (const gone of o.gone.concat([o.release, '#go-admin', '.sidemenu'])) assert.equal(await p.isVisible(gone), false, o.name + ': ' + gone + ' is not on the code screen');
      await shot(p, 'tablet-lock-' + o.home.replace('.html', '') + '-after-release-1024');
      const after = await typedAll(p, ['index.html', 'company.html', 'administration.html', 'manager.html', 'route.html', 'plant-station.html'], o.after || o.home);
      assert.deepEqual(after, [], o.name + ': after Release, typed screens that did not go back to the code screen');
      assert.deepEqual(p.errors.filter(e => !/Missing or insufficient permissions/.test(e)), [], o.name + ': no errors or new windows');
      audit.push('## ' + o.name, '', '- Opens: its own screen only (' + o.home + (o.onHome ? ' with ?room=1' : '') + ').',
        '- Pressed ' + pressed.length + ' buttons, tabs and links (' + [...new Set(pressed)].join(', ') + '): all stayed on it.', '- Typed ' + typed.length + ' other screens into the address bar: every one came back to it.',
        '- Release (manager release code): back to the code screen; nothing else opens after it.', '');
      results.push(o.name + ': ' + pressed.length + ' buttons pressed and ' + typed.length + ' screens typed in, all stayed on it; Release went back to the code screen');
      await p.context().close();
    }

    // The Plant Managers app on a phone.
    const m = await openPage(browser, phone(), '/walkthrough.html?view=home&app=1&' + MANAGER);
    await m.waitForSelector('#code-box:not([hidden]) form');
    await m.fill('#code-box input[name="code"]', codes.managers);
    await m.click('#code-box button[type="submit"]');
    await m.waitForSelector('.wk-choice');
    const bare = async (what) => {
      for (const gone of ['.sidemenu', '#go-home', '#go-back', '#go-admin', '#go-help', '#full']) assert.equal(await m.isVisible(gone), false, 'Plant Managers ' + what + ': ' + gone + ' is not there');
    };
    await bare('start');
    assert.equal(await m.getAttribute('.topbar .brand', 'href'), 'walkthrough.html?view=home&app=1', 'the logo goes to the Plant Managers start');
    await shot(m, 'tablet-lock-plant-managers-home-390');
    const choices = await m.$$eval('.wk-list a[href]', a => [...new Set(a.map(x => x.getAttribute('href')))]);
    const reached = [];
    for (const href of choices) {
      await m.goto(HOSTING + '/' + href);
      await m.waitForLoadState('domcontentloaded');
      await m.waitForTimeout(1200);
      assert.ok(MANAGER_PAGES.indexOf(pageOf(m.url())) >= 0, href + ' is a manager screen');
      await bare(href);
      assert.ok(await m.isVisible('#pm-home'), href + ' has the Plant Managers button back to the start');
      // 10/28 (practice test): nothing wider than the phone, so a finger swipe moves the list, not a zoomed page sideways.
      const wide = await m.evaluate(() => ({ iw: innerWidth, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
        over: [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1 && e.getClientRects().length).slice(0, 5)
          .map(e => e.tagName + (e.id ? '#' + e.id : '') + '.' + [...e.classList].join('.') + ' ' + Math.round(e.getBoundingClientRect().right)) }));
      assert.ok(wide.iw <= 391 && wide.sw <= wide.cw + 1, href + ' is wider than the phone ' + JSON.stringify(wide));
      // Narrower phones and wider fonts too (the test machine's fonts made the walkthrough's top line 425 wide at 390).
      await m.setViewportSize({ width: 320, height: 800 });
      await m.waitForTimeout(300);
      const narrow = await m.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      assert.ok(narrow.sw <= narrow.cw + 1, href + ' is wider than a 320 phone ' + JSON.stringify(narrow));
      await m.setViewportSize({ width: 390, height: 844 });
      reached.push(href);
      // Every link on it opens a manager screen (or comes back to the start).
      const links = await m.$$eval('#screen a[href]', a => [...new Set(a.filter(x => x.getClientRects().length).map(x => x.getAttribute('href')).filter(h => !/^(#|javascript:|mailto:|tel:|https?:)/.test(h)))]);
      for (const l of links) assert.ok(MANAGER_PAGES.indexOf(l.split(/[?#]/)[0]) >= 0, href + ' links to ' + l + ', not a manager screen');
    }
    if (SHOTS) { await m.goto(HOSTING + '/loadout.html'); await m.waitForTimeout(1500); await shot(m, 'tablet-lock-plant-managers-loading-390'); }
    await m.click('#pm-home');
    await m.waitForSelector('.wk-choice');
    const leaks = await typedAll(m, PAGES, 'walkthrough.html', MANAGER_PAGES);
    assert.deepEqual(leaks, [], 'Plant Managers app: typed screens that were not manager screens and did not go back to the start');
    assert.deepEqual(m.errors.filter(e => !/Missing or insufficient permissions/.test(e)), [], 'Plant Managers app: no errors or new windows');
    await m.context().close();
    results.push('Plant Managers app: no menu, Home, Help or Administration; opens ' + reached.join(', ') + '; ' + PAGES.length + ' screens typed in: only the manager screens open, the rest go back to the start');
    audit.push('## Plant Managers app (phone)', '', '- Opens: ' + MANAGER_PAGES.join(', ') + '.', '- No side menu, no Home, Help or Administration, no link to the full app. The logo and the Plant Managers button go back to its start.',
      '- Typed ' + PAGES.length + ' screens into the address bar: only the manager screens open; every other one goes back to the start.', '');
  } finally {
    await browser.close();
  }
  if (SHOTS) fs.writeFileSync(path.join(SHOTS, 'tablet-lock-audit.md'), audit.join('\n'));
  results.forEach(r => console.log('OK  ' + r));
})().catch(e => { console.error(e); process.exit(1); });

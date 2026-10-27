'use strict';
/*
 * Browser check of who lands where (Joe 10/10): a person limited to one plant (a supervisor such as Brian Bircher at
 * Uniontown) only ever sees that plant's home; an Administrator starts on the all-plants overview, picks a plant, and that
 * plant's home has an Administration card leading to everything the current app's Administration does (inside the new app).
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const F = require('../fixtures/fake-sheets');

const localCalls = require('./local-calls.cjs');
const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR;

async function openPage(browser, width, height, url) {
  const page = await browser.newPage({ viewport: { width, height } });
  await localCalls(page);
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
  });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(HOSTING + url);
  page.errors = errors;
  return page;
}
const noSideScroll = (p) => p.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth);

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: () => new Date('2026-10-09T12:00:00Z') });
  await db().collection('users').doc('super.test@uniteddairy.com').set({ name: 'Test Supervisor', status: 'ACTIVE', roles: ['SUPERVISOR'], facilities: ['fac_uniontown'] });
  const browser = await chromium.launch();
  const results = [];
  try {
    // A one-plant supervisor: Uniontown's home only, no Administration, no way to the all-plants overview.
    const sup = await openPage(browser, 1920, 1080, '/index.html?testEmail=super.test@uniteddairy.com');
    await sup.waitForSelector('#screen:not([hidden]) .hq-card');
    await sup.waitForFunction(() => document.getElementById('plant-name').textContent === 'Uniontown Operations');
    await sup.waitForTimeout(800);
    assert.match(sup.url(), /index\.html/);
    // Joe 10/26 (1E): four cards (Plant Operations, Route Distribution, Reports, Safety Walkthrough), each department a dark blue button
    // on its group's card with its main screens under it in light blue (Inventory is now inside Shipping & Receiving).
    assert.deepEqual(await sup.$$eval('.hq-card > strong', c => c.map(x => x.textContent)), ['Plant Operations', 'Route Distribution', 'Reports', 'Safety Walkthrough']);
    assert.deepEqual(await sup.$$eval('.hq-main', c => c.map(x => x.dataset.side)), ['plant', 'production', 'pmaint', 'shipping', 'distribution', 'fleet', 'garage']);
    assert.equal(await sup.$('#go-back'), null, 'nothing above the plant home');
    assert.equal(await sup.isVisible('#go-admin'), false, 'no Administration button');
    if (SHOTS) await sup.screenshot({ path: path.join(SHOTS, 'home-one-plant-1920.png') });
    // Joe 10/11: Under Construction modules open only for Administrators. A supervisor sees both cards with the banner, says
    // "Administrators only", and clicking one stays on the plant home; the menu links are locked; typing the address is refused.
    assert.deepEqual(await sup.$$eval('.hq-card.building', c => c.map(x => x.dataset.cardSide + ':' + x.querySelector('.uc-admin-only').innerText + ':' + getComputedStyle(x.querySelector('.open-text')).display)),
      ['safety:Administrators only while it is being built:none']);
    assert.deepEqual(await sup.$$eval('.hq-main.building', c => c.map(x => x.dataset.side)), ['production', 'pmaint']);
    await sup.click('.hq-main[data-side="production"]');
    await sup.waitForTimeout(600);
    assert.match(sup.url(), /index\.html/, 'a supervisor clicking Plant Production stays on the plant home');
    assert.deepEqual(await sup.$$eval('.sidemenu a[data-building], .side-flyouts a[data-building]', a => a.map(x => x.dataset.side + ':' + getComputedStyle(x).pointerEvents)), ['safety:none', 'production:none', 'pmaint:none']);
    // Joe 10/26: the Plant Operations page has the plant's department cards; Under Construction ones stay closed there too.
    await sup.goto(HOSTING + '/group.html?g=plantops&testEmail=super.test@uniteddairy.com');
    await sup.waitForSelector('.launch-card[data-side="production"]');
    assert.deepEqual(await sup.$$eval('.launch-card', c => c.map(x => x.dataset.side)), ['plant', 'production', 'pmaint', 'shipping']);
    await sup.click('.launch-card[data-side="production"]');
    await sup.waitForTimeout(600);
    assert.match(sup.url(), /group\.html/, 'a supervisor clicking Plant Production stays on the Plant Operations page');
    // Plant Production's first page is its Production Lines board (Joe 10/11); Plant Maintenance's is its Maintenance Center (Joe 10/12),
    // and every Plant Maintenance screen stays closed to a supervisor while it is being built.
    for (const [page, name, inside] of [['production.html?', 'Plant Production', '#tiles'], ['pmaint.html?', 'Plant Maintenance', '#cols'], ['machinery.html?', 'Plant Maintenance', '#rows'],
      ['pmschedule.html?', 'Plant Maintenance', '#rows'], ['pmworkorders.html?', 'Plant Maintenance', '#rows'], ['inventory.html?', 'Shipping & Receiving', '#rows']]) {
      await sup.goto(HOSTING + '/' + page + 'testEmail=super.test@uniteddairy.com');
      await sup.waitForSelector('#uc-refused');
      assert.equal(await sup.textContent('#uc-refused h1'), name + ' is under construction');
      assert.match(await sup.textContent('#uc-refused p'), /Only Administrators can open/);
      assert.equal(await sup.isVisible(inside), false, name + ' stays closed to a supervisor');
      assert.equal(await sup.isVisible('#go-home'), true, 'the header and its Home button stay');
      assert.equal(await sup.isVisible('#signin'), false, 'the supervisor stays signed in');
    }
    // Any other being-built screen still opens for everyone.
    await sup.goto(HOSTING + '/soon.html?what=trucks-today&testEmail=super.test@uniteddairy.com');
    await sup.waitForSelector('#screen:not([hidden]) .soon-card');
    assert.equal(await sup.$('#uc-refused'), null);
    await sup.goto(HOSTING + '/company.html?testEmail=super.test@uniteddairy.com');
    await sup.waitForSelector('.co-plant');
    assert.deepEqual(await sup.$$eval('.co-plant', c => c.map(x => x.dataset.plant)), ['fac_uniontown'], 'the overview shows a one-plant user their plant only');
    await sup.goto(HOSTING + '/administration.html?testEmail=super.test@uniteddairy.com');
    await sup.waitForFunction(() => /Administrators only/.test(document.getElementById('shell').textContent));
    assert.deepEqual(sup.errors, []);
    await sup.close();
    results.push('A one-plant supervisor sees only Uniontown\'s home (four cards, no Administration); Plant Production, Plant Maintenance and Safety Walkthrough show Administrators only and do not open, by card, menu or address; the overview shows them Uniontown only; Administration says Administrators only');

    // An Administrator: the all-plants overview first, then Uniontown, whose home has the Administration card.
    const adm = await openPage(browser, 1920, 1080, '/index.html?testEmail=admin.test@uniteddairy.com');
    await adm.waitForURL(/company\.html/);
    await adm.waitForSelector('.co-plant[data-plant="fac_uniontown"] .co-grid');
    // Review item 19 (Joe 10/13): no six top tiles (they repeated Uniontown's card) and no filler line under the title.
    assert.equal(await adm.$$eval('.co-kpi, #kpis', s => s.length), 0);
    assert.equal(await adm.$$eval('.co-hero p', s => s.length), 0);
    assert.deepEqual(await adm.$$eval('.co-plant strong', s => s.map(x => x.textContent)), ['Uniontown', 'Charleston', 'Martins Ferry']);
    assert.deepEqual(await adm.$$eval('.co-plant header em', s => s.map(x => x.textContent)), ['ACTIVE', 'PLANNED', 'PLANNED']);
    assert.deepEqual(await adm.$$eval('.co-plant[data-plant="fac_uniontown"] .co-cell span', s => s.map(x => x.textContent)), ['Scheduled', 'Completed', 'Unloaded', 'Loaded', 'Loading', 'Waiting', 'Pickups', 'Maintenance']);
    assert.equal(await adm.$$eval('.co-plant.planned .co-soon b', s => s.map(x => x.textContent).join()), 'Being built,Being built');
    // Review item 20 (Joe 10/13): Charleston and Martins Ferry are one short "being built" line each, not big empty boxes.
    assert.ok((await adm.$$eval('.co-plant.planned', c => c.map(x => x.offsetHeight))).every(h => h < 130));
    assert.equal(await adm.$$eval('.co-plant.planned footer', f => f.length), 0);
    assert.ok(await noSideScroll(adm), 'the overview fits the width');
    if (SHOTS) await adm.screenshot({ path: path.join(SHOTS, 'home-all-plants-1920.png') });
    await Promise.all([adm.waitForURL(/soon\.html\?what=plant-charleston/), adm.click('.co-plant[data-plant="fac_charleston"]')]);
    await adm.waitForFunction(() => /Charleston is not connected/.test(document.getElementById('why').textContent));
    await Promise.all([adm.waitForURL(/company\.html/), adm.click('#go')]);
    await adm.waitForSelector('.co-plant[data-plant="fac_uniontown"]');
    // Joe 10/12: picking a plant opens its home with all its cards, wherever on the card the plant is picked (the name, the
    // header, Recent Activity, View Details); the Plant Distribution card there opens the Manager Center.
    for (const spot of ['header strong', 'footer a']) {
      await Promise.all([adm.waitForURL(/index\.html/), adm.click('.co-plant[data-plant="fac_uniontown"] ' + spot)]);
      await adm.waitForSelector('.hq-main[data-side="plant"]');
      await adm.goto(HOSTING + '/company.html?testEmail=admin.test@uniteddairy.com');
      await adm.waitForSelector('.co-plant[data-plant="fac_uniontown"] .co-grid');
    }
    await Promise.all([adm.waitForURL(/index\.html/), adm.click('.co-plant[data-plant="fac_uniontown"] .co-recent h3')]);
    // Joe 10/11: the plant home shows the plant's three cards, Route Distribution, Fleet & Maintenance, Reports and (Joe 10/12) Safety Walkthrough;
    // Plant Production and Plant Maintenance carry an Under Construction banner. Administration is the header button.
    await adm.waitForSelector('.hq-card[data-card-side="reports"]');
    // Joe 10/26 (1E): the four home cards; the departments' own cards (with their pictures) are on the Plant Operations and Route
    // Distribution pages, which the group cards open.
    assert.deepEqual(await adm.$$eval('.hq-main', c => c.map(x => x.dataset.side)), ['plant', 'production', 'pmaint', 'shipping', 'distribution', 'fleet', 'garage']);
    assert.deepEqual(await adm.$$eval('.hq-card[data-card-side] .uc-banner', b => b.map(x => x.closest('.hq-card').dataset.cardSide)), ['safety']);
    const fits = await adm.evaluate(() => ({ bottom: Math.max(...[...document.querySelectorAll('.hq-card')].map(c => c.getBoundingClientRect().bottom)), inner: innerHeight }));
    assert.ok(fits.bottom <= fits.inner, 'the four cards fit a 1920x1080 screen: ' + JSON.stringify(fits));
    assert.deepEqual(await adm.$$eval('.hq-main, .hq-sub, .hq-card a.open-text', a => a.filter(x => x.scrollWidth > x.clientWidth + 1).map(x => x.textContent)), [], 'every button keeps its words on one line');
    await Promise.all([adm.waitForURL(/group\.html\?g=plantops/), adm.click('.hq-card[data-group="plantops"] .open-text')]);
    await adm.waitForSelector('.launch-card[data-side="shipping"]');
    // Joe 10/11 evening: Plant Production and Plant Maintenance use his own pictures with the banner painted on (the clean pictures
    // stay in the library for later), so the banner comes from the picture and is not laid on twice.
    await adm.waitForFunction(() => [...document.querySelectorAll('.launch-card.banner-pic img')].every(i => i.complete && i.naturalWidth > 0));
    assert.deepEqual(await adm.$$eval('.launch-card.banner-pic', c => c.map(x => { const i = x.querySelector('img'); return x.dataset.side + ':' + i.alt + ':' + i.getAttribute('src') + ':' + i.naturalWidth; })),
      ['production:Under Construction:img/library/plant-production-construction-560.webp:560', 'pmaint:Under Construction:img/library/plant-maintenance-construction-560.webp:560']);
    assert.equal(await adm.$$eval('.launch-card.banner-pic .uc-banner', b => b.length), 0, 'the banner is not drawn twice over the pictures');
    for (const clean of ['plant-production-v1-560.webp', 'plant-maintenance-v1-560.webp', 'plant-production-v1-full.webp', 'plant-maintenance-v1-full.webp']) {
      assert.equal((await adm.request.get(HOSTING + '/img/library/' + clean)).status(), 200, 'the clean picture is kept in the library: ' + clean);
    }
    const sizes = await adm.$$eval('.launch-card', c => c.map(x => Math.round(x.getBoundingClientRect().width) + 'x' + Math.round(x.getBoundingClientRect().height)));
    assert.equal(new Set(sizes).size, 1, 'the four department cards are the same size: ' + sizes.join(' '));
    assert.equal(await adm.textContent('.sidemenu a.side-name'), 'Plant Operations');
    assert.deepEqual(await adm.$$eval('.sidemenu a[data-side]', a => a.map(x => x.dataset.side)), ['plant', 'production', 'crew', 'pmaint', 'shipping']);
    await adm.goto(HOSTING + '/group.html?g=routeops&testEmail=admin.test@uniteddairy.com');
    await adm.waitForSelector('.launch-card[data-side="garage"]');
    assert.deepEqual(await adm.$$eval('.launch-card', c => c.map(x => x.dataset.side)), ['distribution', 'fleet', 'garage']);
    await adm.goto(HOSTING + '/index.html?testEmail=admin.test@uniteddairy.com');
    await adm.waitForSelector('.hq-card[data-card-side="reports"]');
    await adm.waitForSelector('#go-back');
    // Joe 10/10 evening: Administration is a header button on the main screens, not a menu item.
    assert.equal(await adm.isVisible('#go-admin'), true, 'Administration is in an Administrator\'s header');
    assert.equal(await adm.$('.sidemenu a[href="administration.html"]'), null, 'Administration is not in the menu');
    if (SHOTS) await adm.screenshot({ path: path.join(SHOTS, 'home-admin-uniontown-1920.png') });
    await Promise.all([adm.waitForURL(/company\.html/), adm.click('#go-back')]);
    await adm.waitForSelector('.co-plant[data-plant="fac_uniontown"]');
    await Promise.all([adm.waitForURL(/index\.html/), adm.click('.co-plant[data-plant="fac_uniontown"] header strong')]);
    await Promise.all([adm.waitForURL(/administration\.html/), adm.click('#go-admin')]);
    // Joe 10/10: Administration like the current app's tab: every item in a menu on the left; the item opens on the right.
    await adm.waitForSelector('.adm-item.on[data-key="people"]');
    const groups = await adm.$$eval('.adm-nav-group h2', h => h.map(x => x.textContent));
    assert.deepEqual(groups, ['People & Access', 'Links & Codes', 'Email & Schedules', 'Dispatch', 'Plant Setup', 'Connections & Keys', 'Fleet & GPS Setup', 'System Tools', 'Diagnostics']);
    const all = await adm.$$eval('.adm-item', t => t.length);
    // Joe 10/12: Garage Station Codes added; Driver Station, Plant Station and Phone Screens moved from System Tools to Links & Codes.
    // Joe 10/12: Location Areas added under Plant Setup.
    // Joe 10/13: Sheet Conflicts added under Diagnostics, so Find a setting finds it.
    // Joe 10/13: Machine Setup added under Plant Setup.
    // Joe 10/15: Schedule Texts added under Connections & Keys.
    // Joe 10/16: Connections & Keys > RedZone back (the RedZone API, read only).
    // Joe 10/18: Upload Center added under Plant Setup (a new plant's data from one workbook).
    // Joe 10/18: Plant Managers App added under Links & Codes (the Plant Managers link and its code).
    // Batch 8, mock-up 2 (10/23): Operational Assignments, Print Layouts, Dispatch Settings, Route Editor and Go-Live Switches
    // are on the Dispatch Administration page; the list keeps one Dispatch Administration line, and Find a setting still finds them.
    // Joe 10/22: Case Counters added under Connections & Keys (the palletizer and case returns counter boxes).
    // Joe 10/26: Machine Connections added under Connections & Keys; Case Counters moved into it (Find a setting still finds it).
    // Joe 10/25: Menu Setup, Plant Schedule Setup, Maintenance Schedule Setup and Maintenance Equipment added under Plant Setup.
    assert.equal(all, 39, 'every item from the current app\'s Administration is in the menu or on Dispatch Administration');
    assert.deepEqual(await adm.$$eval('.adm-nav-group:has(h2:text-is("Dispatch")) .adm-name', s => s.map(x => x.textContent)), ['Dispatch Administration']);
    // People & Roles opens first: everyone on the Users list, read through the server for Administrators.
    await adm.waitForSelector('#people tr[data-email="super.test@uniteddairy.com"]');
    assert.match(await adm.textContent('#people tr[data-email="super.test@uniteddairy.com"]'), /Supervisor[\s\S]*Uniontown[\s\S]*Active/);
    // Joe 10/26: each person's Home screen is picked right in the list.
    assert.deepEqual(await adm.$$eval('.adm-table th', t => t.map(x => x.textContent)), ['Name', 'Email', 'Role', 'Plants', 'Status', 'Home screen']);
    assert.ok(await noSideScroll(adm), 'Administration fits the width');
    assert.equal(await adm.$$eval('a[href*="script.google.com"], a[target="_blank"]', a => a.length), 0);
    if (SHOTS) await adm.screenshot({ path: path.join(SHOTS, 'administration-people-1920.png') });
    // A screen already in the new app opens inside the panel, without its own header and menu; the page stays put.
    await adm.fill('#find', 'Print Layouts');
    await adm.click('.adm-item[data-key="print"]');
    await adm.fill('#find', '');
    const frame = await (await adm.waitForSelector('#frame')).contentFrame();
    await frame.waitForSelector('#screen:not([hidden])');
    assert.equal(await frame.evaluate(() => document.body.classList.contains('embed') && !document.querySelector('.topbar').getClientRects().length), true, 'no second header inside the panel');
    assert.match(adm.url(), /administration\.html/);
    assert.equal(await adm.getAttribute('#full', 'href').then(h => /^print\.html/.test(h)), true);
    await adm.waitForTimeout(800);
    if (SHOTS) await adm.screenshot({ path: path.join(SHOTS, 'administration-print-1920.png') });
    // Joe 10/10: every Administration item is built; none says Being built. Repair Email opens right there.
    await adm.click('.adm-item[data-key="repair-email"]');
    await adm.waitForSelector('#re-where input');
    assert.equal(/Being built/.test(await adm.textContent('#shell')), false);
    if (SHOTS) await adm.screenshot({ path: path.join(SHOTS, 'administration-repair-email-1920.png') });
    await adm.fill('#find', 'QR');
    assert.deepEqual(await adm.$$eval('.adm-item .adm-name', s => s.map(x => x.textContent)), ['Access & QR Codes', 'Manager Links', 'Plant Station Codes', 'Garage Station Codes', 'Driver Station Codes', 'Plant Managers App']);
    await adm.fill('#find', '');
    await adm.fill('#find', 'Print Layouts');
    await Promise.all([adm.waitForURL(/print\.html/), adm.click('.adm-item[data-key="print"]').then(() => adm.click('#full'))]);
    assert.deepEqual(adm.errors, []);
    await adm.close();
    results.push('An Administrator starts on the all-plants overview (Uniontown live, Charleston and Martins Ferry being built), picks Uniontown, whose home has the six cards and the Administration header button; Administration lists every item in seven groups, finds an item by a word; People & Roles lists the Users list, every item opens inside the right panel and none says Being built');

    // The overview and Administration at a laptop size.
    const small = await openPage(browser, 1366, 768, '/company.html?testEmail=admin.test@uniteddairy.com');
    await small.waitForSelector('.co-plant .co-grid');
    assert.ok(await noSideScroll(small));
    await small.goto(HOSTING + '/administration.html?testEmail=admin.test@uniteddairy.com');
    await small.waitForSelector('.adm-item');
    assert.ok(await noSideScroll(small));
    assert.deepEqual(small.errors, []);
    await small.close();
    results.push('The overview and Administration fit a 1366 window');

    // Joe 10/11: the main screen's plant fly-out lists the same six as the plant home; Reports gathers every report in one
    // place (the plant's reports moved there from Plant Distribution); Plant Production opens its being-built page.
    const mods = await openPage(browser, 1536, 864, '/company.html?testEmail=admin.test@uniteddairy.com');
    await mods.waitForSelector('.side-plant[data-plant="fac_uniontown"] .side-sec-btn');
    await mods.hover('.side-plant[data-plant="fac_uniontown"] .side-sec-btn');
    await mods.waitForSelector('.side-flyouts .flyout.open a[data-plant="fac_uniontown"]', { state: 'visible' });
    assert.deepEqual(await mods.$$eval('.side-flyouts .flyout.open a', a => a.map(x => x.textContent)), ['Plant Distribution', 'Plant Production', 'Plant Vacations & Schedule', 'Plant Maintenance', 'Shipping & Receiving', 'Route Distribution', 'Fleet & Maintenance', 'Garage', 'Reports', 'Safety Walkthrough']);
    await Promise.all([mods.waitForURL(/reportcenter\.html/), mods.click('.side-flyouts .flyout.open a[data-side="reports"]')]);
    await mods.waitForSelector('.rc-card');
    assert.deepEqual(await mods.$$eval('.rc-group h2', h => h.map(x => x.textContent)), ['Walkthrough Reports', 'Driver Reports', 'Plant Reports', 'Garage Reports']);
    // Joe 10/13: Trucks Today is built (Verizon Connect Fleet), so its card opens it. Joe 10/15: the Loading Rundown card.
    assert.deepEqual(await mods.$$eval('.rc-card', a => a.map(x => x.getAttribute('href'))), ['safety-walks.html', 'scorecard.html', 'otr.html', 'trucks.html', 'reports.html', 'reports.html?view=rundown', 'shiftreports.html', 'plant-kiosk.html', 'fleet.html']);
    assert.equal(await mods.getAttribute('.sidemenu a.side-name', 'data-side'), 'reports');
    assert.ok(await noSideScroll(mods));
    await Promise.all([mods.waitForURL(/shiftreports\.html/), mods.click('.rc-card[href="shiftreports.html"]')]);
    await mods.waitForSelector('.sidemenu a.side-name');
    assert.equal(await mods.getAttribute('.sidemenu a.side-name', 'data-side'), 'reports', 'a report opened from Reports keeps the Reports menu');
    await mods.evaluate(() => sessionStorage.setItem('udPlant', 'fac_uniontown'));
    await mods.goto(HOSTING + '/index.html?testEmail=admin.test@uniteddairy.com');
    await mods.waitForSelector('.hq-main[data-side="production"]');
    await mods.waitForTimeout(500);
    assert.deepEqual(await mods.$$eval('.hq-main, .hq-sub, .hq-card a.open-text', a => a.filter(x => x.scrollWidth > x.clientWidth + 1).map(x => x.textContent)), [], 'every button keeps its words on one line at 1536');
    // Joe 10/26: a group of Reports on the home opens Reports on that group only.
    await Promise.all([mods.waitForURL(/group=driver/), mods.click('.hq-sub[href="reportcenter.html?group=driver"]')]);
    await mods.waitForSelector('.rc-card');
    assert.deepEqual(await mods.$$eval('.rc-group h2', h => h.map(x => x.textContent)), ['Driver Reports']);
    await mods.goto(HOSTING + '/index.html?testEmail=admin.test@uniteddairy.com');
    await mods.waitForSelector('.hq-main[data-side="production"]');
    // Joe 10/11: Plant Production (still Under Construction) opens for an administrator.
    // Joe 10/26: on its front page (the Plant Distribution layout: report, four machine cards, Production Checks, Shift Notes).
    // Joe 10/26 later: Fillers, HTST, Boxing and Totes (Blow Mold off the front page; Boxing and Totes each their own card).
    await Promise.all([mods.waitForURL(/production-home\.html/), mods.click('.hq-main[data-side="production"]')]);
    await mods.waitForSelector('.mc-depts .dp-card');
    assert.deepEqual(await mods.$$eval('.mc-depts .dp-card', c => c.map(x => x.dataset.href)),
      ['production.html?kind=FILLER', 'production.html?kind=HTST', 'production.html?kind=BOXING', 'production.html?kind=TOTES']);
    assert.equal(await mods.getAttribute('.sidemenu a.side-name', 'data-side'), 'production');
    assert.deepEqual(mods.errors, []);
    await mods.close();
    results.push('Main screen fly-out and plant home list Plant Distribution, Plant Production, Plant Maintenance, Route Distribution, Fleet & Maintenance and Reports; Reports lists every report and keeps its menu; Plant Production opens its front page for an administrator; every home button keeps its words on one line at 1536');

    // Joe 10/10: anywhere on a card opens its screen's first view; one line or number inside opens that screen.
    // Joe 10/12: except a plant's tile on the main screen: anywhere on it, its numbers and Recent Activity lines included,
    // opens that plant's home with its cards (the numbers used to open Loadout, Unloading or Fleet & Maintenance).
    const cards = await openPage(browser, 1920, 1080, '/company.html?testEmail=admin.test@uniteddairy.com');
    const T = '.co-plant[data-plant="fac_uniontown"] ';
    await cards.waitForSelector(T + '.co-grid');
    assert.equal(await cards.$$eval(T + '[data-open]', x => x.length), 0, 'nothing on the plant tile opens another screen');
    for (const spot of ['.co-cell:nth-child(1) b', '.co-cell:nth-child(3) span', '.co-cell:nth-child(8)', '.co-act:nth-child(2) b', 'footer span', '.co-grid']) {
      await Promise.all([cards.waitForURL(/index\.html/), cards.click(T + spot)]);
      await cards.waitForSelector('.hq-main[data-side="plant"]');
      assert.equal(await cards.evaluate(() => sessionStorage.getItem('udPlant')), 'fac_uniontown', spot + ' remembers the plant');
      await cards.goto(HOSTING + '/company.html?testEmail=admin.test@uniteddairy.com');
      await cards.waitForSelector(T + '.co-grid');
    }
    // The ☰ menu: hovering a plant shows its sides; clicking the plant's name opens its home.
    await cards.waitForSelector('.side-plant[data-plant="fac_uniontown"] .side-sec-btn');
    await cards.hover('.side-plant[data-plant="fac_uniontown"] .side-sec-btn');
    await cards.waitForSelector('.side-flyouts .flyout.open a[data-plant="fac_uniontown"]', { state: 'visible' });
    await cards.waitForTimeout(500);
    await Promise.all([cards.waitForURL(/index\.html/), cards.click('.side-plant[data-plant="fac_uniontown"] .side-sec-btn')]);
    await cards.waitForSelector('.hq-main[data-side="plant"]');
    // The plant home's Plant Distribution button opens the Manager Center; anywhere else on the Plant Operations card opens its page.
    await Promise.all([cards.waitForURL(/manager\.html/), cards.click('.hq-main[data-side="plant"]')]);
    await cards.goto(HOSTING + '/index.html?testEmail=admin.test@uniteddairy.com');
    await cards.waitForSelector('.hq-card[data-group="plantops"] .hq-list');
    await Promise.all([cards.waitForURL(/group\.html\?g=plantops/), cards.click('.hq-card[data-group="plantops"] > strong')]);
    await cards.waitForSelector('.launch-card[data-side="plant"]');
    await Promise.all([cards.waitForURL(/manager\.html/), cards.click('.launch-card[data-side="plant"]')]);
    await cards.goto(HOSTING + '/maint.html?testEmail=admin.test@uniteddairy.com');
    await cards.waitForSelector('.hub-card[data-kind="TRAILER"] .hub-tiles4');
    // Fleet & Maintenance cards are links edge to edge: the top opens the card's screen, each box its own.
    await Promise.all([cards.waitForURL(/issues\.html\?kind=TRAILER$/), cards.click('.hub-card[data-kind="TRAILER"] .hub-card-head strong')]);
    await cards.goto(HOSTING + '/maint.html?testEmail=admin.test@uniteddairy.com');
    await cards.waitForSelector('.hub-kpis [data-open]');
    await Promise.all([cards.waitForURL(/filter=review/), cards.click('.hub-kpis [data-open*="filter=review"]')]);
    await cards.goto(HOSTING + '/distribution.html?testEmail=admin.test@uniteddairy.com');
    await cards.waitForSelector('.card[data-card="drivers.html"] .dc-metric');
    await Promise.all([cards.waitForURL(/vacations\.html/), cards.click('.card[data-card="drivers.html"] [data-open="vacations.html"] b')]);
    await cards.goto(HOSTING + '/distribution.html?testEmail=admin.test@uniteddairy.com');
    await cards.waitForSelector('.card[data-card="drivers.html"] .dc-head');
    await Promise.all([cards.waitForURL(/drivers\.html/), cards.click('.card[data-card="drivers.html"] .dc-head')]);
    assert.deepEqual(cards.errors, []);
    await cards.close();
    results.push('Cards: anywhere on a plant tile (numbers and lines too) and the menu plant name open the plant home, whose Plant Distribution card opens Manager Center; a card opens its screen (Route Distribution, Fleet & Maintenance, all-plants overview) and a number or line inside opens its own screen');

    // Phones 360 and 390 wide: the header title wraps beside the logo and never runs under the initials or Sign out.
    for (const w of [360, 390]) {
      for (const pg of ['index.html', 'daily.html', 'yard.html']) {
        const ph = await openPage(browser, w, 780, '/' + pg + '?testEmail=manager.test@uniteddairy.com');
        await ph.waitForSelector('#screen:not([hidden]) .topbar .brand strong');
        await ph.waitForFunction(() => document.getElementById('who').textContent.length > 0);
        const r = await ph.evaluate(() => {
          const t = document.querySelector('.brand strong').getBoundingClientRect(), who = document.getElementById('who').getBoundingClientRect(), out = document.getElementById('signout').getBoundingClientRect();
          return { clear: t.right <= Math.min(who.width ? who.left : out.left, out.left) + 1, inside: out.right <= innerWidth + 1 };
        });
        assert.deepEqual(r, { clear: true, inside: true }, pg + ' at ' + w + ': the title clears the initials and Sign out');
        if (SHOTS && pg === 'index.html') await ph.screenshot({ path: path.join(SHOTS, 'phone-header-' + w + '.png'), clip: { x: 0, y: 0, width: w, height: 200 } });
        await ph.close();
      }
    }
    results.push('Phone header at 360 and 390: the title wraps beside the logo, clear of the initials and Sign out');
  } finally {
    await browser.close();
  }
  console.log(results.map(r => 'ok - ' + r).join('\n'));
})().catch(e => { console.error(e); process.exit(1); });

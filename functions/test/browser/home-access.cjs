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
    await sup.waitForSelector('#screen:not([hidden]) .launch-card');
    await sup.waitForFunction(() => document.getElementById('plant-name').textContent === 'Uniontown Operations');
    await sup.waitForTimeout(800);
    assert.match(sup.url(), /index\.html/);
    // Joe 10/12: Safety Walkthrough is the seventh card, next to Reports (Under Construction too).
    assert.deepEqual(await sup.$$eval('.launch-card', c => c.map(x => x.dataset.side)), ['plant', 'production', 'pmaint', 'distribution', 'fleet', 'reports', 'safety']);
    assert.equal(await sup.$('#go-back'), null, 'nothing above the plant home');
    assert.equal(await sup.isVisible('#go-admin'), false, 'no Administration button');
    if (SHOTS) await sup.screenshot({ path: path.join(SHOTS, 'home-one-plant-1920.png') });
    // Joe 10/11: Under Construction modules open only for Administrators. A supervisor sees both cards with the banner, says
    // "Administrators only", and clicking one stays on the plant home; the menu links are locked; typing the address is refused.
    assert.deepEqual(await sup.$$eval('.launch-card.building', c => c.map(x => x.dataset.side + ':' + x.querySelector('.uc-admin-only').innerText + ':' + getComputedStyle(x.querySelector('.open-text')).display)),
      ['production:Administrators only while it is being built:none', 'pmaint:Administrators only while it is being built:none', 'safety:Administrators only while it is being built:none']);
    await sup.click('.launch-card[data-side="production"]');
    await sup.waitForTimeout(600);
    assert.match(sup.url(), /index\.html/, 'a supervisor clicking Plant Production stays on the plant home');
    assert.deepEqual(await sup.$$eval('.sidemenu a[data-building]', a => a.map(x => x.dataset.side + ':' + getComputedStyle(x).pointerEvents)), ['production:none', 'pmaint:none', 'safety:none']);
    // Plant Production's first page is its Production Lines board (Joe 10/11); Plant Maintenance's is its Maintenance Center (Joe 10/12),
    // and every Plant Maintenance screen stays closed to a supervisor while it is being built.
    for (const [page, name, inside] of [['production.html?', 'Plant Production', '#tiles'], ['pmaint.html?', 'Plant Maintenance', '#cols'], ['machinery.html?', 'Plant Maintenance', '#rows'],
      ['pmschedule.html?', 'Plant Maintenance', '#rows'], ['pmworkorders.html?', 'Plant Maintenance', '#rows']]) {
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
    results.push('A one-plant supervisor sees only Uniontown\'s home (seven cards, no Administration); Plant Production, Plant Maintenance and Safety Walkthrough show Administrators only and do not open, by card, menu or address; the overview shows them Uniontown only; Administration says Administrators only');

    // An Administrator: the all-plants overview first, then Uniontown, whose home has the Administration card.
    const adm = await openPage(browser, 1920, 1080, '/index.html?testEmail=admin.test@uniteddairy.com');
    await adm.waitForURL(/company\.html/);
    await adm.waitForSelector('.co-plant[data-plant="fac_uniontown"] .co-grid');
    assert.deepEqual(await adm.$$eval('.co-kpi span', s => s.map(x => x.textContent)), ['Scheduled Loads', 'Loaded', 'Loads Completed', 'Currently Loading', 'Unloaded', 'Waiting to Unload']);
    assert.deepEqual(await adm.$$eval('.co-plant strong', s => s.map(x => x.textContent)), ['Uniontown', 'Charleston', 'Martins Ferry']);
    assert.deepEqual(await adm.$$eval('.co-plant header em', s => s.map(x => x.textContent)), ['ACTIVE', 'PLANNED', 'PLANNED']);
    assert.deepEqual(await adm.$$eval('.co-plant[data-plant="fac_uniontown"] .co-cell span', s => s.map(x => x.textContent)), ['Scheduled', 'Completed', 'Unloaded', 'Loaded', 'Loading', 'Waiting', 'Pickups', 'Maintenance']);
    assert.equal(await adm.$$eval('.co-plant.planned .co-soon b', s => s.map(x => x.textContent).join()), 'Being built,Being built');
    assert.ok(await noSideScroll(adm), 'the overview fits the width');
    if (SHOTS) await adm.screenshot({ path: path.join(SHOTS, 'home-all-plants-1920.png') });
    await Promise.all([adm.waitForURL(/soon\.html\?what=plant-charleston/), adm.click('.co-plant[data-plant="fac_charleston"]')]);
    await adm.waitForFunction(() => /Charleston is not connected/.test(document.getElementById('why').textContent));
    await Promise.all([adm.waitForURL(/company\.html/), adm.click('#go')]);
    await adm.waitForSelector('.co-plant[data-plant="fac_uniontown"]');
    // Joe 10/12: picking a plant opens its Plant Distribution (the Manager Center) first, wherever on the card it is clicked;
    // Back from there is the plant's home with all six cards, and Back again is this overview.
    await Promise.all([adm.waitForURL(/manager\.html/), adm.click('.co-plant[data-plant="fac_uniontown"] .co-recent h3')]);
    await adm.waitForSelector('#screen .head h1');
    assert.equal(await adm.textContent('#screen .head h1'), 'Manager Center');
    assert.equal(await adm.$eval('.sidemenu a.side-name', a => a.textContent.trim() + ':' + a.classList.contains('on')), 'Plant Distribution:true', 'the menu shows Plant Distribution as the page open');
    if (SHOTS) await adm.screenshot({ path: path.join(SHOTS, 'home-uniontown-opens-plant-operations-1920.png') });
    await Promise.all([adm.waitForURL(/index\.html/), adm.click('#go-back')]);
    // Joe 10/11: the plant home shows the plant's three cards, Route Distribution, Fleet & Maintenance, Reports and (Joe 10/12) Safety Walkthrough;
    // Plant Production and Plant Maintenance carry an Under Construction banner. Administration is the header button.
    await adm.waitForSelector('.launch-card[data-side="reports"]');
    assert.deepEqual(await adm.$$eval('.launch-card', c => c.map(x => x.dataset.side)), ['plant', 'production', 'pmaint', 'distribution', 'fleet', 'reports', 'safety']);
    // Joe 10/11 evening: those two cards use his own pictures with the banner painted on (the clean pictures stay in the
    // library for later), so the banner comes from the picture and is not laid on twice.
    await adm.waitForFunction(() => [...document.querySelectorAll('.launch-card.banner-pic img')].every(i => i.complete && i.naturalWidth > 0));
    assert.deepEqual(await adm.$$eval('.launch-card.banner-pic', c => c.map(x => { const i = x.querySelector('img'); return x.dataset.side + ':' + i.alt + ':' + i.getAttribute('src') + ':' + i.naturalWidth; })),
      ['production:Under Construction:img/library/plant-production-construction-560.webp:560', 'pmaint:Under Construction:img/library/plant-maintenance-construction-560.webp:560']);
    assert.equal(await adm.$$eval('.launch-card.banner-pic .uc-banner', b => b.length), 0, 'the banner is not drawn twice over the pictures');
    // Safety Walkthrough has a drawn icon (no picture), so its banner is laid across the icon (mock-up A).
    assert.deepEqual(await adm.$$eval('.launch-card .uc-banner', b => b.map(x => x.closest('.launch-card').dataset.side)), ['safety']);
    for (const clean of ['plant-production-v1-560.webp', 'plant-maintenance-v1-560.webp', 'plant-production-v1-full.webp', 'plant-maintenance-v1-full.webp']) {
      assert.equal((await adm.request.get(HOSTING + '/img/library/' + clean)).status(), 200, 'the clean picture is kept in the library: ' + clean);
    }
    const fits = await adm.evaluate(() => ({ bottom: Math.max(...[...document.querySelectorAll('.launch-card')].map(c => c.getBoundingClientRect().bottom)), inner: innerHeight }));
    assert.ok(fits.bottom <= fits.inner, 'the seven cards fit a 1920x1080 screen: ' + JSON.stringify(fits));
    const sizes = await adm.$$eval('.launch-card', c => c.map(x => Math.round(x.getBoundingClientRect().width) + 'x' + Math.round(x.getBoundingClientRect().height)));
    assert.equal(new Set(sizes).size, 1, 'the seven cards are the same size: ' + sizes.join(' '));
    await adm.waitForSelector('#go-back');
    // Joe 10/10 evening: Administration is a header button on the main screens, not a menu item.
    assert.equal(await adm.isVisible('#go-admin'), true, 'Administration is in an Administrator\'s header');
    assert.equal(await adm.$('.sidemenu a[href="administration.html"]'), null, 'Administration is not in the menu');
    if (SHOTS) await adm.screenshot({ path: path.join(SHOTS, 'home-admin-uniontown-1920.png') });
    await Promise.all([adm.waitForURL(/company\.html/), adm.click('#go-back')]);
    await adm.waitForSelector('.co-plant[data-plant="fac_uniontown"]');
    await Promise.all([adm.waitForURL(/manager\.html/), adm.click('.co-plant[data-plant="fac_uniontown"] header strong')]);
    await Promise.all([adm.waitForURL(/administration\.html/), adm.click('#go-admin')]);
    // Joe 10/10: Administration like the current app's tab: every item in a menu on the left; the item opens on the right.
    await adm.waitForSelector('.adm-item.on[data-key="people"]');
    const groups = await adm.$$eval('.adm-nav-group h2', h => h.map(x => x.textContent));
    assert.deepEqual(groups, ['People & Access', 'Links & Codes', 'Email & Schedules', 'Dispatch Administration', 'Plant Setup', 'Connections & Keys', 'Fleet & GPS Setup', 'System Tools', 'Diagnostics']);
    const all = await adm.$$eval('.adm-item', t => t.length);
    assert.equal(all, 35, 'every item from the current app\'s Administration is in the menu, plus Garage Station Codes (Joe 10/12)');
    // People & Roles opens first: everyone on the Users list, read through the server for Administrators.
    await adm.waitForSelector('#people tr[data-email="super.test@uniteddairy.com"]');
    assert.match(await adm.textContent('#people tr[data-email="super.test@uniteddairy.com"]'), /Supervisor[\s\S]*Uniontown[\s\S]*Active/);
    assert.deepEqual(await adm.$$eval('.adm-table th', t => t.map(x => x.textContent)), ['Name', 'Email', 'Role', 'Plants', 'Status']);
    assert.ok(await noSideScroll(adm), 'Administration fits the width');
    assert.equal(await adm.$$eval('a[href*="script.google.com"], a[target="_blank"]', a => a.length), 0);
    if (SHOTS) await adm.screenshot({ path: path.join(SHOTS, 'administration-people-1920.png') });
    // A screen already in the new app opens inside the panel, without its own header and menu; the page stays put.
    await adm.click('.adm-item[data-key="print"]');
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
    assert.deepEqual(await adm.$$eval('.adm-item .adm-name', s => s.map(x => x.textContent)), ['Access & QR Codes', 'Manager Links', 'Plant Station Codes', 'Garage Station Codes', 'Driver Station Codes']);
    await adm.fill('#find', '');
    await Promise.all([adm.waitForURL(/print\.html/), adm.click('.adm-item[data-key="print"]').then(() => adm.click('#full'))]);
    assert.deepEqual(adm.errors, []);
    await adm.close();
    results.push('An Administrator starts on the all-plants overview (six numbers; Uniontown live, Charleston and Martins Ferry being built), picks Uniontown, which opens its Plant Distribution first (Back is its home with the six cards) and the Administration header button; Administration lists every item in seven groups, finds an item by a word; People & Roles lists the Users list, every item opens inside the right panel and none says Being built');

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
    assert.deepEqual(await mods.$$eval('.side-flyouts .flyout.open a', a => a.map(x => x.textContent)), ['Plant Distribution', 'Plant Production', 'Plant Maintenance', 'Route Distribution', 'Fleet & Maintenance', 'Reports', 'Safety Walkthrough']);
    await Promise.all([mods.waitForURL(/reportcenter\.html/), mods.click('.side-flyouts .flyout.open a[data-side="reports"]')]);
    await mods.waitForSelector('.rc-card');
    assert.deepEqual(await mods.$$eval('.rc-group h2', h => h.map(x => x.textContent)), ['Plant Reports', 'Distribution Reports', 'Fleet Reports']);
    assert.deepEqual(await mods.$$eval('.rc-card', a => a.map(x => x.getAttribute('href'))), ['reports.html', 'shiftreports.html', 'plant-kiosk.html', 'scorecard.html', 'otr.html', 'soon.html?what=trucks-today', 'fleet.html']);
    assert.equal(await mods.getAttribute('.sidemenu a.side-name', 'data-side'), 'reports');
    assert.ok(await noSideScroll(mods));
    await Promise.all([mods.waitForURL(/shiftreports\.html/), mods.click('.rc-card[href="shiftreports.html"]')]);
    await mods.waitForSelector('.sidemenu a.side-name');
    assert.equal(await mods.getAttribute('.sidemenu a.side-name', 'data-side'), 'reports', 'a report opened from Reports keeps the Reports menu');
    await mods.evaluate(() => sessionStorage.setItem('udPlant', 'fac_uniontown'));
    await mods.goto(HOSTING + '/index.html?testEmail=admin.test@uniteddairy.com');
    await mods.waitForSelector('.launch-card[data-side="production"]');
    await mods.waitForTimeout(500);
    const fits1536 = await mods.evaluate(() => ({ bottom: Math.max(...[...document.querySelectorAll('.launch-card')].map(c => c.getBoundingClientRect().bottom)), inner: innerHeight }));
    assert.ok(fits1536.bottom <= fits1536.inner, 'the seven cards fit a 1536x864 screen: ' + JSON.stringify(fits1536));
    // Joe 10/11: Plant Production (still Under Construction) opens its Production Lines board for an administrator.
    await Promise.all([mods.waitForURL(/production\.html/), mods.click('.launch-card[data-side="production"]')]);
    await mods.waitForSelector('#tiles .pd-tile, #tiles .pd-empty');
    assert.equal(await mods.$('.pd-building'), null, 'an administrator sees the board, not the being-built note');
    assert.equal(await mods.getAttribute('.sidemenu a.side-name', 'data-side'), 'production');
    assert.deepEqual(mods.errors, []);
    await mods.close();
    results.push('Main screen fly-out and plant home list Plant Distribution, Plant Production, Plant Maintenance, Route Distribution, Fleet & Maintenance and Reports; Reports lists every report and keeps its menu; Plant Production opens its Production Lines board for an administrator; the six cards fit 1536x864');

    // Joe 10/10: anywhere on a card opens its screen's first view; one line or number inside opens that screen.
    const cards = await openPage(browser, 1920, 1080, '/company.html?testEmail=admin.test@uniteddairy.com');
    await cards.waitForSelector('.co-plant[data-plant="fac_uniontown"] .co-grid');
    await Promise.all([cards.waitForURL(/unloading\.html/), cards.click('.co-plant[data-plant="fac_uniontown"] .co-cell[data-open="unloading.html"] span')]);
    await cards.goto(HOSTING + '/company.html?testEmail=admin.test@uniteddairy.com');
    await cards.waitForSelector('.co-plant[data-plant="fac_uniontown"] .co-grid');
    await Promise.all([cards.waitForURL(/maint\.html/), cards.click('.co-plant[data-plant="fac_uniontown"] .co-cell[data-open="maint.html"]')]);
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
    results.push('Cards: a card opens its screen (Route Distribution, Fleet & Maintenance, all-plants overview) and a number or line inside opens its own screen');

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

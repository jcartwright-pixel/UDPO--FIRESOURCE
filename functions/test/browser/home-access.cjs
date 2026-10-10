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

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR;

async function openPage(browser, width, height, url) {
  const page = await browser.newPage({ viewport: { width, height } });
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
    assert.deepEqual(await sup.$$eval('.launch-card', c => c.map(x => x.dataset.side)), ['distribution', 'plant', 'fleet']);
    assert.equal(await sup.$('#go-back'), null, 'nothing above the plant home');
    assert.equal(await sup.isVisible('.sidemenu a[href="administration.html"]'), false, 'no Administration in the menu');
    if (SHOTS) await sup.screenshot({ path: path.join(SHOTS, 'home-one-plant-1920.png') });
    await sup.goto(HOSTING + '/company.html?testEmail=super.test@uniteddairy.com');
    await sup.waitForSelector('.co-plant');
    assert.deepEqual(await sup.$$eval('.co-plant', c => c.map(x => x.dataset.plant)), ['fac_uniontown'], 'the overview shows a one-plant user their plant only');
    await sup.goto(HOSTING + '/administration.html?testEmail=super.test@uniteddairy.com');
    await sup.waitForFunction(() => /Administrators only/.test(document.getElementById('shell').textContent));
    assert.deepEqual(sup.errors, []);
    await sup.close();
    results.push('A one-plant supervisor sees only Uniontown\'s home (three cards, no Administration); the overview shows them Uniontown only; Administration says Administrators only');

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
    await Promise.all([adm.waitForURL(/index\.html/), adm.click('.co-plant[data-plant="fac_uniontown"] .co-recent h3')]);
    await adm.waitForSelector('.launch-card[data-side="admin"]');
    assert.deepEqual(await adm.$$eval('.launch-card', c => c.map(x => x.dataset.side)), ['distribution', 'plant', 'fleet', 'admin']);
    const sizes = await adm.$$eval('.launch-card', c => c.map(x => Math.round(x.getBoundingClientRect().width) + 'x' + Math.round(x.getBoundingClientRect().height)));
    assert.equal(new Set(sizes).size, 1, 'the four cards are the same size: ' + sizes.join(' '));
    await adm.waitForSelector('#go-back');
    assert.equal(await adm.isVisible('.sidemenu a[href="administration.html"]'), true, 'Administration is in an Administrator\'s menu');
    if (SHOTS) await adm.screenshot({ path: path.join(SHOTS, 'home-admin-uniontown-1920.png') });
    await Promise.all([adm.waitForURL(/company\.html/), adm.click('#go-back')]);
    await adm.waitForSelector('.co-plant[data-plant="fac_uniontown"]');
    await Promise.all([adm.waitForURL(/index\.html/), adm.click('.co-plant[data-plant="fac_uniontown"] .co-recent h3')]);
    await Promise.all([adm.waitForURL(/administration\.html/), adm.click('.launch-card[data-side="admin"]')]);
    // Joe 10/10: Administration like the current app's tab: every item in a menu on the left; the item opens on the right.
    await adm.waitForSelector('.adm-item.on[data-key="people"]');
    const groups = await adm.$$eval('.adm-nav-group h2', h => h.map(x => x.textContent));
    assert.deepEqual(groups, ['People & Access', 'App Links & Codes', 'Email & Schedules', 'Dispatch Administration', 'Fleet & GPS Setup', 'System Tools', 'Diagnostics']);
    const all = await adm.$$eval('.adm-item', t => t.length);
    assert.equal(all, 28, 'every item from the current app\'s Administration is in the menu');
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
    // One still being built says so right there.
    await adm.click('.adm-item[data-key="repair-email"]');
    await adm.waitForSelector('.adm-soon');
    assert.match(await adm.textContent('.adm-panel-head'), /Repair Email[\s\S]*Being built/);
    if (SHOTS) await adm.screenshot({ path: path.join(SHOTS, 'administration-soon-1920.png') });
    await adm.fill('#find', 'QR');
    assert.deepEqual(await adm.$$eval('.adm-item .adm-name', s => s.map(x => x.textContent)), ['Access & QR Codes', 'App Links & Codes']);
    await adm.fill('#find', '');
    await Promise.all([adm.waitForURL(/print\.html/), adm.click('.adm-item[data-key="print"]').then(() => adm.click('#full'))]);
    assert.deepEqual(adm.errors, []);
    await adm.close();
    results.push('An Administrator starts on the all-plants overview (six numbers; Uniontown live, Charleston and Martins Ferry being built), picks Uniontown, whose home has a fourth same-size Administration card; Administration lists every item in seven groups, finds an item by a word; People & Roles lists the Users list, built screens open inside the right panel and the rest say Being built there');

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

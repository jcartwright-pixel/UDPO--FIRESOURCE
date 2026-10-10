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
    await sup.waitForFunction(() => /Administrators only/.test(document.getElementById('body').textContent));
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
    await Promise.all([adm.waitForURL(/index\.html/), adm.click('.co-plant[data-plant="fac_uniontown"]')]);
    await adm.waitForSelector('.launch-card[data-side="admin"]');
    assert.deepEqual(await adm.$$eval('.launch-card', c => c.map(x => x.dataset.side)), ['distribution', 'plant', 'fleet', 'admin']);
    const sizes = await adm.$$eval('.launch-card', c => c.map(x => Math.round(x.getBoundingClientRect().width) + 'x' + Math.round(x.getBoundingClientRect().height)));
    assert.equal(new Set(sizes).size, 1, 'the four cards are the same size: ' + sizes.join(' '));
    await adm.waitForSelector('#go-back');
    assert.equal(await adm.isVisible('.sidemenu a[href="administration.html"]'), true, 'Administration is in an Administrator\'s menu');
    if (SHOTS) await adm.screenshot({ path: path.join(SHOTS, 'home-admin-uniontown-1920.png') });
    await Promise.all([adm.waitForURL(/company\.html/), adm.click('#go-back')]);
    await adm.waitForSelector('.co-plant[data-plant="fac_uniontown"]');
    await Promise.all([adm.waitForURL(/index\.html/), adm.click('.co-plant[data-plant="fac_uniontown"]')]);
    await Promise.all([adm.waitForURL(/administration\.html/), adm.click('.launch-card[data-side="admin"]')]);
    await adm.waitForSelector('.adm-tile');
    const groups = await adm.$$eval('.adm-group h2', h => h.map(x => x.textContent));
    assert.deepEqual(groups, ['People & Access', 'App Links & Codes', 'Email & Schedules', 'Dispatch Administration', 'Fleet & GPS Setup', 'System Tools', 'Diagnostics']);
    const all = await adm.$$eval('.adm-tile', t => t.length);
    const tops = await adm.$$eval('.adm-tile', t => [...new Set(t.map(x => Math.round(x.getBoundingClientRect().height)))]);
    assert.ok(Math.max(...tops) - Math.min(...tops) <= 2, 'tiles are the same size: ' + tops.join(' '));
    assert.ok(await noSideScroll(adm), 'Administration fits the width');
    assert.equal(await adm.$$eval('a[href*="script.google.com"]', a => a.length), 0);
    if (SHOTS) await adm.screenshot({ path: path.join(SHOTS, 'administration-1920.png'), fullPage: true });
    await adm.click('#show [data-show="soon"]');
    assert.equal(await adm.$$eval('.adm-tile:not(.soon)', t => t.length), 0, 'Being built shows only screens still to build');
    await adm.click('#show [data-show="ready"]');
    assert.equal(await adm.$$eval('.adm-tile.soon', t => t.length), 0);
    await adm.click('#show [data-show="all"]');
    assert.equal(await adm.$$eval('.adm-tile', t => t.length), all);
    await adm.fill('#find', 'QR');
    assert.deepEqual(await adm.$$eval('.adm-tile strong', s => s.map(x => x.textContent)), ['Access & QR Codes', 'App Links & Codes']);
    await adm.fill('#find', '');
    await Promise.all([adm.waitForURL(/soon\.html\?what=admin-people/), adm.click('.adm-tile[data-key="people"]')]);
    await adm.waitForFunction(() => document.getElementById('what').textContent === 'People & Roles is being built in the new app');
    await Promise.all([adm.waitForURL(/administration\.html/), adm.click('#go')]);
    await adm.waitForSelector('.adm-tile');
    await Promise.all([adm.waitForURL(/print\.html/), adm.click('.adm-tile[data-key="print"]')]);
    assert.deepEqual(adm.errors, []);
    await adm.close();
    results.push('An Administrator starts on the all-plants overview (six numbers; Uniontown live, Charleston and Martins Ferry being built), picks Uniontown, whose home has a fourth same-size Administration card; Administration lists every item in seven groups, filters by built / being built and by a word, and opens each inside the new app');

    // The overview and Administration at a laptop size.
    const small = await openPage(browser, 1366, 768, '/company.html?testEmail=admin.test@uniteddairy.com');
    await small.waitForSelector('.co-plant .co-grid');
    assert.ok(await noSideScroll(small));
    await small.goto(HOSTING + '/administration.html?testEmail=admin.test@uniteddairy.com');
    await small.waitForSelector('.adm-tile');
    assert.ok(await noSideScroll(small));
    assert.deepEqual(small.errors, []);
    await small.close();
    results.push('The overview and Administration fit a 1366 window');
  } finally {
    await browser.close();
  }
  console.log(results.map(r => 'ok - ' + r).join('\n'));
})().catch(e => { console.error(e); process.exit(1); });

'use strict';
/*
 * Browser check of Joe's 10/26 Home screen (People & Roles): an administrator picks a person's Home screen in the People
 * list (it saves on its own, nothing moves); that person then opens the app straight on that screen, once per tab, and the
 * Home button still goes to the normal Home. Pictures go to SHOTS_DIR.
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
const ADMIN = 'admin.test@uniteddairy.com';
const DANA = 'dana.miller@uniteddairy.com';
const PEOPLE = [[DANA, 'Dana Miller', ['DISPATCHER']], ['rick.fowler@uniteddairy.com', 'Rick Fowler', ['MANAGER']], ['tess.moran@uniteddairy.com', 'Tess Moran', ['MANAGER']],
  ['luis.ortega@uniteddairy.com', 'Luis Ortega', ['SUPERVISOR']], ['amy.keller@uniteddairy.com', 'Amy Keller', ['MANAGER']]];

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
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, name) }); };
const homeOf = async (email) => ((await db().collection('personRights').doc(email).get()).data() || {}).homeScreen || '';

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: () => new Date('2026-10-09T12:00:00Z') });
  for (const [em, name, roles] of PEOPLE) await db().collection('users').doc(em).set({ name, status: 'ACTIVE', roles, facilities: ['fac_uniontown'], cells: { id: 'usr_' + name.split(' ')[0].toLowerCase(), version: '1' } });
  await db().collection('config').doc('app').set({ writeBack: { enabled: true } }, { merge: true });
  // Tess sees only the maintenance screens and two reports, so her list offers only those.
  await db().collection('personRights').doc('tess.moran@uniteddairy.com').set({ grants: [], denials: [], screenAccess: { fac_uniontown: ['pmCenter', 'machinery', 'pmWorkOrders', 'plantReports'] } });
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const [w, h] of [[1536, 864], [1920, 1080]]) {
      const p = await openPage(browser, w, h, '/administration.html?testEmail=' + ADMIN);
      await p.waitForSelector('#people tr[data-email="' + DANA + '"] select.hs-pick');
      if (w === 1536) {
        assert.equal(await p.$eval('select.hs-pick[data-home-for="' + DANA + '"]', s => s.value), '', 'starts blank');
        const tess = await p.$$eval('select.hs-pick[data-home-for="tess.moran@uniteddairy.com"] option', o => o.map(x => x.value).filter(Boolean));
        assert.deepEqual(tess, ['pmaint.html', 'machinery.html', 'pmworkorders.html', 'reportcenter.html', 'reports.html'], 'only the screens she can see');
        const groups = await p.$$eval('select.hs-pick[data-home-for="' + DANA + '"] optgroup', g => g.map(x => x.label));
        ['Plant Distribution', 'Plant Production', 'Plant Vacations & Schedule', 'Plant Maintenance', 'Route Distribution'].forEach(g => assert.ok(groups.indexOf(g) >= 0, g));
        const picks = { [DANA]: 'daily.html', 'rick.fowler@uniteddairy.com': 'manager.html', 'tess.moran@uniteddairy.com': 'pmaint.html', 'luis.ortega@uniteddairy.com': 'production-home.html', 'amy.keller@uniteddairy.com': 'crew.html' };
        for (const [em, pg] of Object.entries(picks)) {
          const before = await p.evaluate(() => [scrollY, document.querySelector('.ap-scroll').scrollTop]);
          await p.selectOption('select.hs-pick[data-home-for="' + em + '"]', pg);
          for (let i = 0; i < 50 && await homeOf(em) !== pg; i++) await p.waitForTimeout(200);
          assert.equal(await homeOf(em), pg, em + ' saved on its own');
          assert.deepEqual(await p.evaluate(() => [scrollY, document.querySelector('.ap-scroll').scrollTop]), before, 'saving never moves the page');
        }
        assert.equal(await p.$('#p-modal:not([hidden])'), null, 'picking does not open the person');
        assert.equal(await p.$eval('.ap-msg', m => m.hidden || !m.textContent.trim()), true, 'no saved message');
        // The person's own Save keeps the Home screen (its revision still matches).
        await p.click('#people tr[data-email="' + DANA + '"] td.strong');
        await p.waitForSelector('#p-modal:not([hidden]) #p-save');
        await p.fill('#p-name', 'Dana Miller');
        await p.click('#p-save');
        await p.waitForFunction((e) => document.querySelector('#view').textContent.indexOf('Saved ' + e) >= 0, DANA);
        assert.equal(await homeOf(DANA), 'daily.html');
        results.push('Home screen picked in the People list saves on its own, offers only screens the person can see, and Save Person Access keeps it');
      }
      await p.waitForSelector('#people tr[data-email="' + DANA + '"] select.hs-pick');
      assert.equal(await p.$eval('select.hs-pick[data-home-for="' + DANA + '"]', s => s.value), 'daily.html');
      const font = await p.$$eval('.people-table td, .people-table th, select.hs-pick', els => Math.min(...els.map(x => parseFloat(getComputedStyle(x).fontSize))));
      assert.ok(font >= 16, 'text at least 16px, was ' + font);
      assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways scroll');
      const cut = await p.$$eval('select.hs-pick', s => s.filter(x => x.value && x.scrollWidth > x.clientWidth + 1).map(x => x.dataset.homeFor));
      assert.deepEqual(cut, [], 'each picked Home screen shows its whole name');
      await shot(p, '1-people-home-screen-' + w + '.png');
      assert.deepEqual(p.errors, []);
      await p.close();
    }
    // Dana opens the app: straight to Daily Dispatch. Home goes to the normal Home and stays there.
    for (const [w, h] of [[1536, 864], [1920, 1080]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h } });
      const d = await ctx.newPage();
      await d.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
        route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
      });
      await d.goto(HOSTING + '/index.html?testEmail=' + DANA);
      await d.waitForURL(/daily\.html/, { timeout: 30000 });
      await d.waitForSelector('#screen:not([hidden])');
      await d.waitForTimeout(1500);
      await shot(d, '2-dana-opens-on-daily-dispatch-' + w + '.png');
      await d.click('#go-home');
      await d.waitForURL(/index\.html/);
      await d.waitForSelector('#sides a[data-side]');
      await d.waitForTimeout(1500);
      assert.match(d.url(), /index\.html/, 'Home stays on the normal Home');
      await shot(d, '3-dana-presses-home-' + w + '.png');
      await ctx.close();
    }
    results.push('The person opens the app on their Home screen; the Home button still goes to the normal Home');
    // Someone with no Home screen opens on the normal Home, as before.
    const v = await openPage(browser, 1536, 864, '/index.html?testEmail=viewer.test@uniteddairy.com');
    await v.waitForSelector('#sides a[data-side]');
    await v.waitForTimeout(1500);
    assert.match(v.url(), /index\.html/);
    await v.close();
    results.push('Blank Home screen: the normal Home, as before');
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('ok - ' + r));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });

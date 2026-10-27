'use strict';
/*
 * Browser check of Joe's 10/26 Help guide: the "? Help" button (right, before Administration) on every screen opens help.html in the same window (no
 * pop-up over the screen) on that screen's own part, Back comes straight back, the search finds parts, and Administration's
 * "?" opens the help for the item that is open. Pictures go to SHOTS_DIR.
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
const title = (p) => p.$eval('#help-read .help-title', h => h.textContent);
const noSideScroll = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: () => new Date('2026-10-09T12:00:00Z') });
  await db().collection('users').doc(ADMIN).set({ name: 'Admin Test', status: 'ACTIVE', roles: ['ADMINISTRATOR'], facilities: ['fac_uniontown'], cells: { id: 'usr_admin', version: '1' } });
  await db().collection('config').doc('app').set({ writeBack: { enabled: true } }, { merge: true });
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const [w, h] of [[1536, 864], [1920, 1080]]) {
      const p = await openPage(browser, w, h, '/daily.html?date=2026-10-07&testEmail=' + ADMIN);
      await p.waitForSelector('#go-help');
      // Joe 10/26 (mock-up 2): "? Help" on the right, just before Administration, and the header still fits.
      assert.equal(await p.$eval('#go-help', b => b.nextElementSibling && b.nextElementSibling.id), 'go-admin');
      assert.equal((await p.textContent('#go-help')).replace(/\s+/g, ''), '?Help');
      assert.ok(await noSideScroll(p), 'the header with the ? fits at ' + w);
      await shot(p, 'help-daily-' + w + '.png');
      // Same window, on the Daily Dispatch part; nothing is laid over the screen.
      const pages = browser.contexts().reduce((n, c) => n + c.pages().length, 0);
      await p.click('#go-help');
      await p.waitForSelector('#help-read .help-title');
      assert.match(p.url(), /\/help\.html\?for=daily\.html/);
      assert.equal(browser.contexts().reduce((n, c) => n + c.pages().length, 0), pages, 'no new window');
      assert.equal(await title(p), 'Daily Dispatch');
      assert.equal(await p.textContent('#help-list .help-item.on'), 'Daily Dispatch');
      assert.ok(await p.isVisible('#help-read .help-dont'), 'the part has a Do not line');
      assert.ok(await noSideScroll(p), 'the Help page fits at ' + w);
      assert.equal(await p.$('#go-help'), null, 'no ? on the Help page itself');
      await shot(p, 'help-page-' + w + '.png');
      // Back comes straight back to the screen.
      await p.click('#go-back');
      await p.waitForURL(/\/daily\.html/);
      if (w === 1536) {
        // A page that is several screens opens the part for the one on screen.
        await p.goto(HOSTING + '/loadout.html?area=CASE&testEmail=' + ADMIN);
        await p.waitForSelector('#go-help');
        await p.click('#go-help');
        await p.waitForSelector('#help-read .help-title');
        assert.match(await title(p), /^Loading/);
        await p.goto(HOSTING + '/reports.html?view=rundown&testEmail=' + ADMIN);
        await p.waitForSelector('#go-help');
        await p.click('#go-help');
        await p.waitForSelector('#help-read .help-title');
        assert.equal(await title(p), 'Loading Rundown');
        // Search narrows the topics; picking one shows it and its Open this screen button.
        await p.fill('#help-q', 'extinguisher');
        await p.waitForFunction(() => [...document.querySelectorAll('#help-list .help-item')].length < 10);
        const found = await p.$$eval('#help-list .help-item', a => a.map(x => x.textContent));
        assert.ok(found.indexOf('Fire Extinguishers') >= 0, 'search finds Fire Extinguishers');
        await p.click('#help-list .help-item[data-id="extinguishers"]');
        assert.equal(await title(p), 'Fire Extinguishers');
        assert.match(await p.getAttribute('#help-read .help-go', 'href'), /^extinguishers\.html\?testEmail=/);
        // A link inside a part opens that part.
        await p.goto(HOSTING + '/help.html?testEmail=' + ADMIN + '#plant-station');
        await p.waitForSelector('#help-read .help-title');
        assert.equal(await title(p), 'Plant Station tablet');
        await p.click('#help-read [data-help-link="loadout"]');
        assert.match(await title(p), /^Loading/);
        // Administration: the ? opens the help for the item that is open.
        await p.goto(HOSTING + '/administration.html?item=people&testEmail=' + ADMIN);
        await p.waitForSelector('#go-help');
        await p.click('#go-help');
        await p.waitForSelector('#help-read .help-title');
        assert.equal(await title(p), 'People & Roles');
      }
      assert.deepEqual(p.errors, []);
      results.push(w + ': ok');
      await p.close();
    }
    console.log('help guide: ' + results.join(', '));
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });

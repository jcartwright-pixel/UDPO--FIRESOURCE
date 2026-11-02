'use strict';
/*
 * Browser check (Joe 11/2, "all moved off of Google Drive"): Administration > Go-Live Switches lists the Google sheets moving
 * into Operations. Only a ready one has a Move into Operations button; pressed twice it moves, the row says In Operations with
 * the day, and it has no way back. Pictures go to SHOTS_DIR.
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
const ADMIN = '?testEmail=admin.test@uniteddairy.com';

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: () => new Date('2026-11-02T12:00:00Z') });
  const browser = await chromium.launch();
  try {
    for (const [width, height] of [[1536, 790], [1920, 1080]]) {
      const p = await browser.newPage({ viewport: { width, height }, serviceWorkers: 'block' });
      await p.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
        route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
      });
      await localCalls(p);
      const errors = [];
      p.on('pageerror', e => errors.push(e.message));
      await p.goto(HOSTING + '/administration.html' + ADMIN + '&item=switch');
      await p.waitForSelector('tr[data-row="sheet-users"]');
      await p.$eval('tr[data-row="sheet-users"]', r => r.scrollIntoView({ block: 'center' }));
      if (width === 1536) {
        // Only People is ready; the rest wait.
        assert.equal(await p.$$eval('button[data-sheet]:not([disabled])', b => b.map(x => x.dataset.sheet).join()), 'users');
        assert.match(await p.textContent('tr[data-row="sheet-users"]'), /On Google/);
        assert.match(await p.textContent('tr[data-row="sheet-live"]'), /Not ready/);
        if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'before-' + width + '.png') });
        const btn = 'button[data-sheet="users"]';
        await p.click(btn);
        assert.match(await p.textContent(btn), /Press again/);
        await p.click(btn);
        await p.waitForFunction(() => /In Operations/.test(document.querySelector('tr[data-row="sheet-users"]').textContent));
        assert.match(await p.textContent('tr[data-row="sheet-users"]'), /Moved \d{1,2}-\d{1,2}-\d{2}\b/);
        assert.equal(await p.$('button[data-sheet="users"]'), null);
        const c = (await db().collection('config').doc('app').get()).data();
        assert.equal(c.offSheets.users.by, 'admin.test@uniteddairy.com');
      }
      await p.$eval('tr[data-row="sheet-users"]', r => r.scrollIntoView({ block: 'center' }));
      assert.ok(await p.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth));
      if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'after-' + width + '.png') });
      assert.deepEqual(errors, []);
      await p.close();
    }
  } finally {
    await browser.close();
  }
  console.log('OK  Go-Live Switches: the People list moves into Operations with two presses and stays moved');
})().catch(e => { console.error(e); process.exit(1); });

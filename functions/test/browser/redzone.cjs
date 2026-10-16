'use strict';
/*
 * Joe 10/16: Administration > Connections & Keys > RedZone is back. RedZone support: the client ID and secret are made in RedZone
 * and traded for a token at https://api.rz-ops.com/public/v2/oauth/token, so those addresses are filled in and only the client ID
 * and secret are typed. They are saved locked away (private/redzone) and never shown back. Pictures at 1536, 1920 and 800 go to
 * SHOTS_DIR. Test Connection is not pressed here (it would go to RedZone); the emulator tests cover it.
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
const localCalls = require('./local-calls.cjs');

async function openPage(browser, width, height, url) {
  const ctx = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' });
  await ctx.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (r) => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, r.request().url().split('/').pop())) }));
  await localCalls(ctx);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  await page.goto(HOSTING + url);
  return page;
}
const small = (p) => p.evaluate(() => [...document.querySelectorAll('body *')].filter(el => el.offsetWidth && el.offsetHeight && [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(el).fontSize) < 15.9).map(el => el.tagName + ' "' + el.textContent.trim().slice(0, 30) + '"'));
const fits = (p) => p.evaluate(() => document.scrollingElement.scrollWidth - innerWidth);
const SECRET = 'rz-secret-typed-once-5678';

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: () => new Date('2026-10-09T12:00:00Z') });
  // Joe 10/16: What RedZone gives us, as the last ask left it (the emulator tests cover the asking).
  await db().collection('private').doc('redzone').set({ lastDiscover: { at: '2026-10-16T01:30:00.000Z', by: 'admin.test@uniteddairy.com', items: [
    { kind: 'Lines and areas', found: true, path: '/locations', count: 14, fields: ['id', 'name', 'type'], examples: ['GALLON FILLER (type Line)', 'BLOW MOLD (type Line)'] },
    { kind: 'Sensors and data points', found: true, path: '/organizations/org1/data-points', count: 46, fields: ['id', 'name', 'locationName', 'lastValue', 'unit'], examples: ['Gallon Filler Count (lastValue 1234, unit jugs, locationName GALLON FILLER)', 'Blow Mold Temp (lastValue 212, unit F)'] },
    { kind: 'Runs', found: false, path: '/runs', status: 403 },
    { kind: 'Shifts', found: false, path: '/shifts', status: 404, note: 'Not Found' }
  ], used: { org: 'org1', enterprise: 'f99e6965', name: 'Uniontown' }, enterprises: [{ id: 'f99e6965', name: 'Uniontown', from: 'list' }] } });
  const browser = await chromium.launch();
  try {
    for (const [w, h] of [[1536, 730], [1920, 950], [800, 1100]]) {
      const rz = await openPage(browser, w, h, '/redzone.html?testEmail=admin.test@uniteddairy.com');
      await rz.waitForFunction(() => document.getElementById('f-address').value !== '');
      assert.equal(await rz.title(), 'RedZone · Operations');
      assert.equal(await rz.inputValue('#f-address'), 'https://api.rz-ops.com/public/v2');
      assert.equal(await rz.inputValue('#f-tokenurl'), 'https://api.rz-ops.com/public/v2/oauth/token');
      assert.deepEqual(await rz.$$eval('#form label', l => l.slice(0, 2).map(x => x.firstChild.textContent.trim())), ['Client ID', 'Client secret'], 'the two boxes Joe types come first');
      assert.match(await rz.textContent('.gps-steps'), /Manage Access > Roles > Create Role: name it "Operations App Read Only" and turn on only Basic Access/);
      // What RedZone gives us: one row per kind, with how many, the address, the fields and examples.
      await rz.waitForSelector('#give-list tbody tr');
      assert.deepEqual(await rz.$$eval('#give-list tbody tr', r => r.map(x => [...x.children].slice(0, 2).map(c => c.textContent))),
        [['Lines and areas', '14'], ['Sensors and data points', '46'], ['Runs', 'Not allowed (403)'], ['Shifts', 'Not foundNot Found']]);
      assert.equal(await rz.textContent('#give-site'), 'Site used: Uniontown (f99e6965)', 'RedZone keeps its lists by site (enterprise)');
      assert.match(await rz.textContent('#give-list'), /Gallon Filler Count \(lastValue 1234, unit jugs, locationName GALLON FILLER\)/);
      assert.equal(await rz.isVisible('#give-download'), true);
      assert.deepEqual(await small(rz), [], 'text 16px or larger at ' + w);
      assert.ok(await fits(rz) <= 0, 'no sideways scrolling at ' + w);
      if (w === 1536) {
        assert.equal(await rz.textContent('#state'), 'Not saved');
        if (SHOTS) await rz.screenshot({ path: path.join(SHOTS, 'redzone-before-1536.png'), fullPage: true });
        await rz.fill('#f-client', 'rz-client-1234');
        await rz.fill('#f-secret', SECRET);
        await rz.click('#save');
        await rz.waitForFunction(() => document.getElementById('state').textContent === 'Saved');
        const saved = (await db().collection('private').doc('redzone').get()).data();
        assert.deepEqual([saved.clientId, saved.clientSecret, saved.savedBy], ['rz-client-1234', SECRET, 'admin.test@uniteddairy.com']);
        assert.equal(await rz.inputValue('#f-secret'), '', 'the secret box empties once saved');
        assert.equal(await rz.getAttribute('#f-client', 'placeholder'), 'saved, ends 1234 (paste to replace)');
        assert.ok(!(await rz.content()).includes(SECRET), 'the secret is never shown back');
      } else assert.equal(await rz.textContent('#state'), 'Saved');
      if (SHOTS) await rz.screenshot({ path: path.join(SHOTS, 'redzone-' + w + '.png'), fullPage: true });
      if (SHOTS) { await rz.$eval('#give-card', e => e.scrollIntoView({ block: 'start' })); await rz.screenshot({ path: path.join(SHOTS, 'redzone-what-it-gives-' + w + '.png') }); }
      assert.deepEqual(rz.errors, []);
      await rz.context().close();
    }
  } finally {
    await browser.close();
  }
  console.log('ok - RedZone, What RedZone gives us: lines 14, sensors 46 with latest values, runs not allowed, shifts not found; Download the List');
  console.log('ok - RedZone: RedZone\'s addresses filled in, the client ID and secret typed and saved locked away (only the last 4 shown), 16px text, fits at 1536, 1920 and 800');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });

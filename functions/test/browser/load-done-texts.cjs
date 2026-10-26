'use strict';
/*
 * Joe 10/26 ("text temporarily a few people when the load is complete ... that their load is done, and if they have any
 * pickups"): Administration > Load Done Texts. Off; tick the drivers (saved at once, Find a driver on the right); the
 * example text; the texts sent. Pictures at 1536 and 1920 and a phone go to SHOTS_DIR.
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

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: () => new Date('2026-10-09T12:00:00Z') });
  await db().collection('driverPhones').doc('drv_test_casey').set({ driverId: 'drv_test_casey', phone: '+13305551234' });
  await db().collection('private').doc('sms').set({ accountSid: 'AC' + '0123456789abcdef'.repeat(2), authToken: 'tok', fromNumber: '+18885550100' });
  await db().collection('textLog').doc('done_2026-10-18_x_mon').set({ direction: 'out', kind: 'LOAD_DONE', driverId: 'drv_test_casey', name: 'CASEY, LEE', to: '+13305551234', at: '2026-10-18T17:50:00.000Z', status: 'NOT SENT',
    body: 'United Dairy: your load is done. Route 905 UT DSD MILK, trailer T-901, 1,200 cases. Pickups: 2 crates chocolate milk.' });
  const browser = await chromium.launch();
  try {
    for (const [w, h] of [[1536, 730], [1920, 950], [390, 844]]) {
      const p = await openPage(browser, w, h, '/donetexts.html?testEmail=admin.test@uniteddairy.com');
      // Off at first; the 1536 run below ticks a driver and turns it On.
      await p.waitForFunction((on) => document.getElementById('state').textContent === on, w === 1536 ? 'Off' : 'On');
      await p.waitForSelector('#drivers .texts-tick');
      assert.match(await p.textContent('#sample'), /^United Dairy: your load is done\. Route 801 .*Pickups: 2 crates chocolate milk\.$/);
      assert.match(await p.textContent('#account'), /888-555-0100/);
      assert.match(await p.textContent('#mode'), /Test copy/);
      await p.waitForSelector('#log tr td:nth-child(5)');
      assert.match(await p.textContent('#log'), /Test copy, not sent/);
      if (w === 1536) {
        // A tick saves at once, and the ticked driver moves to the top.
        await p.check('#drivers .texts-tick[data-id="drv_test_casey"]');
        for (let i = 0; i < 50 && !((await db().collection('private').doc('sms').get()).data().doneDrivers || {}).drv_test_casey; i++) await p.waitForTimeout(100);
        assert.ok((await db().collection('private').doc('sms').get()).data().doneDrivers.drv_test_casey);
        await p.waitForFunction(() => document.getElementById('count').textContent === '1 ticked');
        assert.equal(await p.$eval('#drivers tr td:nth-child(2)', td => td.textContent), 'CASEY, LEE');
        await p.click('#turn');
        await p.waitForFunction(() => document.getElementById('state').textContent === 'On');
        assert.equal((await db().collection('private').doc('sms').get()).data().doneOn, true);
        // Find a driver narrows the list.
        await p.fill('#find', 'case');
        await p.waitForFunction(() => document.querySelectorAll('#drivers tr').length === 1);
        await p.fill('#find', '');
      }
      assert.ok(await fits(p) <= 0, 'no side scroll on Load Done Texts at ' + w);
      assert.deepEqual(await small(p), [], 'Load Done Texts: no text under 16px at ' + w);
      if (SHOTS) { await p.waitForTimeout(1000); await p.screenshot({ path: path.join(SHOTS, 'after-load-done-texts-' + w + '.png'), fullPage: w === 390 }); }
      if (SHOTS && w !== 390) { await p.$eval('#log', e => e.closest('section').scrollIntoView()); await p.screenshot({ path: path.join(SHOTS, 'after-load-done-sent-' + w + '.png') }); }
      assert.deepEqual(p.errors, []);
      await p.context().close();
    }
    // Administration lists it under Connections & Keys, next to Schedule Texts.
    const a = await openPage(browser, 1536, 790, '/administration.html?testEmail=admin.test@uniteddairy.com');
    await a.waitForSelector('.adm-item[data-key="people"]');
    await a.fill('#find', 'texts');
    await a.waitForFunction(() => [...document.querySelectorAll('.adm-item')].map(x => x.dataset.key).join() === 'schedule-texts,load-done-texts');
    await a.waitForSelector('.adm-item[data-key="load-done-texts"]', { state: 'visible' });
    if (SHOTS) { await a.waitForTimeout(1000); await a.screenshot({ path: path.join(SHOTS, 'after-administration-1536.png') }); }
    await a.context().close();
    console.log('load-done-texts: ok');
  } finally { await browser.close(); }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });

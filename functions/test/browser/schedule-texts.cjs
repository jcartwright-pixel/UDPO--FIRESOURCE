'use strict';
/*
 * Joe 10/15: Schedule Texts, built ready and kept Off. The Driver Roster has a Mobile Phone column (saved on its own,
 * driverPhones); Administration > Schedule Texts has the On / Off switch (Off), the Twilio account boxes and who would get
 * the next text. Pictures at 1536 and 1920 go to SHOTS_DIR.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const F = require('../fixtures/fake-sheets');
const L = require('../../src/logic');

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
// Visible words under 16px (Joe: text at least 16px).
const small = (p) => p.evaluate(() => [...document.querySelectorAll('body *')].filter(el => el.offsetWidth && el.offsetHeight && [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(el).fontSize) < 15.9).map(el => el.tagName + ' "' + el.textContent.trim().slice(0, 30) + '"'));
const fits = (p) => p.evaluate(() => document.scrollingElement.scrollWidth - innerWidth);

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: () => new Date('2026-10-09T12:00:00Z') });
  const week = '2026-10-18';
  await db().collection('runs').doc(week + '__run_t905').set({ weekStart: week, route: '905', run: 'UT DSD MILK', runId: 'run_t905', rev: 0, days: { mon: { runs: true, driverId: 'drv_test_casey', driver: 'CASEY, LEE' }, tue: { runs: true, driverId: 'drv_test_adams', driver: 'ADAMS, PAT' } } });
  await db().collection('config').doc('app').set({ liveWeeks: { previous: '2026-10-04', current: '2026-10-11', next: week } }, { merge: true });
  const browser = await chromium.launch();
  try {
    for (const w of [1536, 1920]) {
      // The Driver Roster: Mobile Phone, typed in the list, saved on its own; a short number is refused and put back.
      const ro = await openPage(browser, w, w === 1536 ? 730 : 950, '/drivers.html?testEmail=manager.test@uniteddairy.com');
      await ro.waitForSelector('#rows tr[data-id="drv_test_casey"] [data-phone]');
      assert.ok((await ro.$$eval('.sheet thead th', t => t.map(x => x.textContent))).includes('Mobile Phone'));
      const box = '#rows tr[data-id="drv_test_casey"] [data-phone]';
      assert.equal(await ro.inputValue(box), w === 1536 ? '' : '330-555-1234');
      if (w === 1536) {
        await ro.fill(box, '555-1234'); await ro.press(box, 'Tab');
        await ro.waitForFunction(() => /10 digits/.test(document.getElementById('error').textContent));
        assert.equal(await ro.inputValue(box), '');
        await ro.fill(box, '(330) 555-1234'); await ro.press(box, 'Tab');
        const saved = async () => ((await db().collection('driverPhones').doc('drv_test_casey').get()).data() || {}).phone;
        for (let i = 0; i < 50 && (await saved()) !== '+13305551234'; i++) await ro.waitForTimeout(100);
        assert.equal(await saved(), '+13305551234');
        await ro.waitForFunction((s) => document.querySelector(s).value === '330-555-1234', box);
      }
      assert.ok(await fits(ro) <= 0, 'no side scroll on the Driver Roster at ' + w);
      if (SHOTS) await ro.screenshot({ path: path.join(SHOTS, 'after-roster-' + w + '.png') });
      assert.deepEqual(ro.errors, []);
      await ro.context().close();

      // Administration > Schedule Texts: Off, the account boxes empty, who would get the next text.
      const tx = await openPage(browser, w, w === 1536 ? 730 : 950, '/texts.html?testEmail=admin.test@uniteddairy.com');
      await tx.waitForFunction(() => document.getElementById('state').textContent === 'Off');
      assert.equal(await tx.isDisabled('#turn'), true, 'On needs the Twilio account first');
      assert.deepEqual(await tx.$$eval('#form input', i => i.map(x => x.value + '|' + x.placeholder)), ['|', '|', '|'], 'empty boxes, no placeholder that looks saved');
      await tx.waitForSelector('#preview tr td');
      assert.deepEqual(await tx.$$eval('#preview tr', r => r.map(x => x.textContent)), ['ADAMS, PATNo number', 'CASEY, LEE330-555-1234']);
      assert.match(await tx.textContent('#mode'), /Test copy: texts are written to the log only/);
      assert.ok(await fits(tx) <= 0, 'no side scroll on Schedule Texts at ' + w);
      assert.deepEqual(await small(tx), [], 'Schedule Texts: no text under 16px at ' + w);
      if (SHOTS) await tx.screenshot({ path: path.join(SHOTS, 'after-texts-' + w + '.png') });
      if (w === 1920) {
        await tx.fill('#f-sid', 'AC' + '0123456789abcdef'.repeat(2)); await tx.fill('#f-token', 'tok'); await tx.fill('#f-from', '330-555-0000');
        await tx.click('#save');
        await tx.waitForFunction(() => document.getElementById('keys').textContent === 'Saved');
        assert.deepEqual(await tx.$$eval('#form input', i => i.map(x => x.value)), ['', '', ''], 'the boxes empty after saving');
        await tx.click('#turn');
        await tx.waitForFunction(() => document.getElementById('state').textContent === 'On');
        // Turning On counts the week already posted as done.
        assert.equal((await db().collection('private').doc('sms').get()).data().lastWeek, '2026-10-11');
        await tx.click('#turn');
        await tx.waitForFunction(() => document.getElementById('state').textContent === 'Off');
      }
      assert.deepEqual(tx.errors, []);
      await tx.context().close();
    }
    console.log('schedule-texts: ok');
  } finally { await browser.close(); }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });

'use strict';
/*
 * Joe 10/31 (hx): Send Schedule Texts on the live screens, Weekly Dispatch and Daily Dispatch, never the template. The strip
 * names the posted week; the first tap arms it, the second sends that week (whatever week Daily Dispatch is showing); then it
 * reads Sent and Send Again. Only administrators see it. Pictures go to SHOTS_DIR when it is set.
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
const SHOTS = process.env.SHOTS_DIR || '';
const ADMIN = 'testEmail=admin.test@uniteddairy.com';

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
const small = (p) => p.evaluate(() => [...document.querySelectorAll('#send-texts *')].filter(el => el.offsetWidth && [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(el).fontSize) < 15.9).map(el => el.tagName));
const fits = (p) => p.evaluate(() => document.scrollingElement.scrollWidth - innerWidth);
const lastSend = async () => ((await db().collection('private').doc('sms').get()).data() || {}).lastSend;

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: () => new Date('2026-10-09T12:00:00Z') });
  for (const id of ['run_t801', 'run_t802', 'run_t810']) await db().collection('routes').doc(id).update({ displayDaily: true, displayWeekly: true });
  await db().collection('config').doc('app').set({ liveWeeks: { previous: '2026-10-04', current: '2026-10-11', next: '2026-10-18' } }, { merge: true });
  await db().collection('runs').doc('2026-10-11__run_t905').set({ weekStart: '2026-10-11', route: '905', run: 'UT DSD MILK', runId: 'run_t905', rev: 0, days: { wed: { runs: true, driverId: 'drv_test_casey', driver: 'CASEY, LEE' } } });
  await db().collection('private').doc('sms').set({ accountSid: 'AC' + '0123456789abcdef'.repeat(2), authToken: 'tok', fromNumber: '+18885550100' });
  await db().collection('driverPhones').doc('drv_test_casey').set({ driverId: 'drv_test_casey', phone: '+13305551234', scheduleText: true });
  const browser = await chromium.launch();
  try {
    // The template never has it (after a Publish it moves on to the next week).
    const tpl = await openPage(browser, 1536, 790, '/weekly.html?week=2026-10-11&' + ADMIN);
    await tpl.waitForSelector('#rows tr td.day');
    await tpl.waitForTimeout(2500);
    assert.equal(await tpl.isHidden('#send-texts'), true, 'no Send on the Weekly Dispatch Template');
    await tpl.context().close();

    // Weekly Dispatch (the live week): Not sent, first tap arms, second sends the posted week.
    const wk = await openPage(browser, 1536, 790, '/weekly.html?view=live&' + ADMIN);
    await wk.waitForFunction(() => /Not sent/.test(document.getElementById('send-texts').textContent) && !document.querySelector('#send-texts button').disabled, null, { timeout: 15000 });
    assert.match(await wk.textContent('#send-texts'), /Schedule texts for the posted week, 10-11-26 to 10-17-26: Not sent \(1 driver ticked on the Driver Roster\)\./);
    assert.equal(await wk.textContent('#send-texts button'), 'Send Schedule Texts: Week of 10-11-26');
    if (SHOTS) await wk.screenshot({ path: path.join(SHOTS, 'live-send-weekly-not-sent-1536.png') });
    await wk.click('#send-texts button');
    assert.equal(await wk.textContent('#send-texts button'), 'Tap Again: Text 1 driver for 10-11-26', 'the first tap only arms it');
    assert.equal(await lastSend(), undefined);
    if (SHOTS) await wk.screenshot({ path: path.join(SHOTS, 'live-send-weekly-tap-again-1536.png') });
    await wk.click('#send-texts button');
    await wk.waitForFunction(() => /: Sent /.test(document.getElementById('send-texts').textContent), null, { timeout: 15000 });
    assert.equal(await wk.textContent('#send-texts button'), 'Send Again: Week of 10-11-26');
    assert.match(await wk.textContent('#send-texts'), /Sent .* to 1 driver \(test copy, written to the list only\)\./);
    const l = await lastSend();
    assert.deepEqual([l.week, l.drivers, l.live, l.by], ['2026-10-11', 1, false, 'admin.test@uniteddairy.com']);
    assert.ok(await fits(wk) <= 0);
    assert.deepEqual(await small(wk), []);
    if (SHOTS) await wk.screenshot({ path: path.join(SHOTS, 'live-send-weekly-sent-1536.png') });
    assert.deepEqual(wk.errors, []);
    await wk.context().close();

    // Daily Dispatch on another week still names (and would send) the posted week.
    for (const [w, h] of [[1920, 1080], [390, 844]]) {
      const dd = await openPage(browser, w, h, '/daily.html?date=2026-10-20&' + ADMIN);
      await dd.waitForFunction(() => /: Sent /.test(document.getElementById('send-texts').textContent), null, { timeout: 15000 });
      assert.match(await dd.textContent('#send-texts'), /posted week, 10-11-26 to 10-17-26/);
      assert.equal(await dd.textContent('#send-texts button'), 'Send Again: Week of 10-11-26');
      assert.ok(await fits(dd) <= 0, 'no side scroll on Daily Dispatch at ' + w);
      assert.deepEqual(await small(dd), []);
      if (SHOTS) await dd.screenshot({ path: path.join(SHOTS, 'live-send-daily-' + w + '.png') });
      if (w === 1920) {
        // Send Again needs both taps too, and texts the posted week a second time.
        const at = l.at;
        await dd.click('#send-texts button');
        assert.equal(await dd.textContent('#send-texts button'), 'Tap Again: Text 1 driver for 10-11-26');
        await dd.click('#send-texts button');
        for (let i = 0; i < 100 && (await lastSend()).at === at; i++) await dd.waitForTimeout(100);
        assert.equal((await lastSend()).week, '2026-10-11');
      }
      assert.deepEqual(dd.errors, []);
      await dd.context().close();
    }

    // Someone who is not an administrator does not see it.
    const disp = await openPage(browser, 1536, 790, '/daily.html?date=2026-10-12&testEmail=dispatch.test@uniteddairy.com');
    await disp.waitForSelector('#rows tr');
    await disp.waitForTimeout(2500);
    assert.equal(await disp.isHidden('#send-texts'), true, 'only administrators');
    await disp.context().close();
    // Joe 10/31 (im): Texts part 3, "Sample for": a driver's week in the new text, texted only to the part 5 cell.
    for (const [w, h] of [[1536, 790], [390, 844]]) {
      await db().collection('private').doc('sms').set({ forwardTo: w === 1536 ? '' : '+13305557777' }, { merge: true });
      const tx = await openPage(browser, w, h, '/texts.html?' + ADMIN);
      await tx.waitForFunction(() => document.querySelectorAll('#sample-for option').length > 1, null, { timeout: 15000 });
      assert.equal(await tx.inputValue('#sample-for'), '', 'the drop-down starts blank');
      assert.equal(await tx.isHidden('#sample-text'), true);
      await tx.selectOption('#sample-for', 'drv_test_casey');
      await tx.waitForFunction(() => !document.getElementById('sample-text').hidden);
      const text = await tx.textContent('#sample-text');
      assert.match(text, /^United Dairy: your schedule, week of 10-11-26\nSun 10-11: /);
      assert.match(text, /Wed 10-14: Rt 905 UT DSD MILK/);
      assert.match(await tx.textContent('#preview-text'), /is posted\. Open UD Routes > My Schedule/, 'drivers still get the short text');
      if (w === 1536) {
        assert.equal(await tx.isDisabled('#sample-send'), true, 'needs the part 5 cell');
        assert.match(await tx.textContent('#sample-hint'), /Type your cell in part 5 first/);
        if (SHOTS) await tx.locator('#sample-for').locator('xpath=ancestor::section').screenshot({ path: path.join(SHOTS, 'sample-no-cell-1536.png') });
      } else {
        await tx.waitForFunction(() => !document.getElementById('sample-send').disabled);
        assert.match(await tx.textContent('#sample-hint'), /Goes only to 330-555-7777 \(part 5\)\. No driver gets it\./);
        await tx.click('#sample-send');
        assert.equal(await tx.textContent('#sample-send'), 'Tap again to text 330-555-7777');
        await tx.click('#sample-send');
        await tx.waitForFunction(() => /Test copy: written to the list/.test(document.getElementById('sample-hint').textContent), null, { timeout: 15000 });
        await tx.waitForFunction(() => /Sample to you/.test(document.getElementById('log').textContent), null, { timeout: 15000 });
        const logged = (await db().collection('textLog').get()).docs.map(x => x.data()).filter(x => x.kind === 'SAMPLE');
        assert.deepEqual(logged.map(x => [x.to, x.status, x.body === text]), [['+13305557777', 'NOT SENT', true]]);
      }
      assert.ok(await fits(tx) <= 0, 'no side scroll on Texts at ' + w);
      if (SHOTS) await tx.locator('#sample-for').locator('xpath=ancestor::section').screenshot({ path: path.join(SHOTS, 'sample-' + w + '.png') });
      assert.deepEqual(tx.errors, []);
      await tx.context().close();
    }
    console.log('send-texts-live: ok');
  } finally { await browser.close(); }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });

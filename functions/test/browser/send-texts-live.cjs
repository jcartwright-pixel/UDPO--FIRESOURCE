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

    // Daily Dispatch on another week still sends the posted week. Joe 11/6 (ks): Daily's line is short ("Texts sent ..."); the posted
    // week's dates are on its hover, and the driver count shows on a wide screen.
    for (const [w, h] of [[1920, 1080], [390, 844]]) {
      const dd = await openPage(browser, w, h, '/daily.html?date=2026-10-20&' + ADMIN);
      await dd.waitForFunction(() => /^Texts sent /.test(document.getElementById('send-texts').textContent), null, { timeout: 15000 });
      assert.match(await dd.getAttribute('#send-texts', 'title'), /posted week, 10-11-26 to 10-17-26, sent to 1 driver/);
      assert.match(await dd.textContent('#send-texts .send-words'), /^Texts sent .* to 1 driver \(test copy\)$/);
      assert.equal(await dd.textContent('#send-texts button'), 'Send Again');
      assert.ok(await fits(dd) <= 0, 'no side scroll on Daily Dispatch at ' + w);
      assert.deepEqual(await small(dd), []);
      if (SHOTS) await dd.screenshot({ path: path.join(SHOTS, 'live-send-daily-' + w + '.png') });
      if (w === 1920) {
        // Send Again needs both taps too, and texts the posted week a second time.
        const at = l.at;
        await dd.click('#send-texts button');
        assert.equal(await dd.textContent('#send-texts button'), 'Tap Again: Text 1 driver');
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
      // Joe 11/6 (ik): the driver's own week, a block a day, the way My Schedule reads; it is the text the drivers get.
      assert.match(text, /^United Dairy schedule for Lee Casey\nWeek of 10-11-26 to 10-17-26\n\nSUNDAY 10-11-26\n/);
      assert.match(text, /\n\nWEDNESDAY 10-14-26\n905 UT DSD MILK\n/);
      assert.match(text, /\n\nMONDAY 10-12-26\n802 UT DSD MILK\n(.+ · )?Leaves 4:00 AM\n/);
      assert.match(text, /\n\nAlso on UD Routes > My Schedule\.$/);
      assert.match(await tx.textContent('#preview-text'), /Each driver gets their own posted week/);
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
    // Joe 11/2 ("wrong phone number ... can I change and then resend?"): Resend on a posted-week schedule text in part 6 texts
    // only that driver again, at the Driver Roster's number now. An older week's text has no Resend.
    await db().collection('textLog').doc('old_week_casey').set({ direction: 'out', week: '2026-10-04', driverId: 'drv_test_casey', name: 'CASEY, LEE', to: '+13305551234', body: 'old', at: '2026-10-03T12:00:00.000Z', status: 'SENT' });
    for (const [w, h] of [[1536, 790], [390, 844]]) {
      const tx = await openPage(browser, w, h, '/texts.html?' + ADMIN);
      await tx.waitForSelector('#log [data-resend]', { timeout: 15000 });
      assert.equal(await tx.locator('#log [data-resend="old_week_casey"]').count(), 0, 'no Resend on an older week');
      const before = (await db().collection('textLog').get()).docs.filter(x => x.data().kind === 'RESEND').length;
      const b = tx.locator('#log [data-resend]').first(), id = await b.getAttribute('data-resend');
      const who = (await db().collection('textLog').doc(id).get()).data();
      assert.equal(await b.textContent(), 'Resend');
      assert.ok(parseFloat(await b.evaluate(el => getComputedStyle(el).fontSize)) >= 16, '16px button');
      await b.click();
      assert.equal(await tx.locator('#log [data-resend="' + id + '"]').textContent(), 'Tap again: text ' + who.name);
      if (SHOTS) await tx.locator('#log').locator('xpath=ancestor::section').screenshot({ path: path.join(SHOTS, 'resend-armed-' + w + '.png') });
      await tx.locator('#log [data-resend="' + id + '"]').click();
      await tx.waitForFunction((n) => (document.getElementById('log').textContent.match(/Schedule, resent/g) || []).length > n, before, { timeout: 15000 });
      const resent = (await db().collection('textLog').get()).docs.map(x => x.data()).filter(x => x.kind === 'RESEND');
      assert.equal(resent.length, before + 1, 'one text, one driver');
      assert.ok(resent.every(x => x.driverId === who.driverId && x.week === '2026-10-11' && x.status === 'NOT SENT'));
      assert.ok(await fits(tx) <= 0, 'no side scroll on Texts at ' + w);
      if (SHOTS) await tx.locator('#log').locator('xpath=ancestor::section').screenshot({ path: path.join(SHOTS, 'resend-' + w + '.png') });
      assert.deepEqual(tx.errors, []);
      await tx.context().close();
    }
    console.log('send-texts-live: ok');
  } finally { await browser.close(); }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });

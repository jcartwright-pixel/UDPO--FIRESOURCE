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
// Joe 11/9: the warnings come up in a pop-up by themselves. popText waits for it and gives its words; closePop puts it away.
const POP = '#send-texts-pop:not([hidden])';
const popText = async (p) => { await p.waitForSelector(POP, { timeout: 20000 }); return p.textContent(POP); };
const closePop = async (p) => { await p.click(POP + ' .send-pop-close'); await p.waitForSelector('#send-texts-pop', { state: 'hidden' }); };
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
    // Joe 11/7: drivers Send will not reach (not signed up) whose posted week is not their normal week. Joe 11/9: in a pop-up.
    const handPop = await popText(wk);
    assert.match(handPop, /TEXT (THIS DRIVER|THESE \d+ DRIVERS) YOURSELF/);
    assert.match(handPop, /Not signed up for texts, and their week is not their normal week\./);
    assert.doesNotMatch(handPop, /CASEY/, 'Casey is signed up: Send reaches him');
    if (SHOTS) await wk.screenshot({ path: path.join(SHOTS, 'pop-text-yourself-1536.png') });
    await closePop(wk);
    if (SHOTS) await wk.screenshot({ path: path.join(SHOTS, 'live-send-weekly-not-sent-1536.png') });
    await wk.click('#send-texts button');
    assert.equal(await wk.textContent('#send-texts button'), 'Tap Again: Text 1 driver for 10-11-26', 'the first tap only arms it');
    assert.equal(await lastSend(), undefined);
    if (SHOTS) await wk.screenshot({ path: path.join(SHOTS, 'live-send-weekly-tap-again-1536.png') });
    await wk.click('#send-texts button');
    await wk.waitForFunction(() => /: Sent /.test(document.getElementById('send-texts').textContent), null, { timeout: 15000 });
    assert.equal(await wk.textContent('#send-texts button'), 'Send Again: Week of 10-11-26');
    assert.match(await wk.textContent('#send-texts'), /1 OF 1 SENT.*Sent [^.]*\(test copy, written to the list only\)\./);
    const l = await lastSend();
    assert.deepEqual([l.week, l.drivers, l.live, l.by], ['2026-10-11', 1, false, 'admin.test@uniteddairy.com']);
    // A warning already closed does not come up again by itself; its red button on the strip opens it.
    await wk.waitForTimeout(1500);
    assert.equal(await wk.isHidden('#send-texts-pop'), true, 'closed stays closed');
    assert.match(await wk.textContent('#send-texts .send-chip'), /^\d+ TO TEXT YOURSELF$/);
    await wk.click('#send-texts .send-chip');
    assert.match(await popText(wk), /YOURSELF/);
    await closePop(wk);
    assert.ok(await fits(wk) <= 0);
    assert.deepEqual(await small(wk), []);
    if (SHOTS) await wk.screenshot({ path: path.join(SHOTS, 'live-send-weekly-sent-1536.png') });
    assert.deepEqual(wk.errors, []);
    await wk.context().close();

    // Daily Dispatch on another week still sends the posted week. Joe 11/6 (ks): Daily's line is short ("Texts sent ..."); the posted
    // week's dates are on its hover, and the driver count shows on a wide screen.
    for (const [w, h] of [[1920, 1080], [390, 844]]) {
      const dd = await openPage(browser, w, h, '/daily.html?date=2026-10-20&' + ADMIN);
      await dd.waitForFunction(() => /^Texts sent /.test((document.querySelector('#send-texts .send-words') || {}).textContent || ''), null, { timeout: 15000 });
      assert.equal(await dd.textContent('#send-texts .send-count.good'), '1 OF 1 SENT', 'Joe 11/7 (li): the sent check');
      assert.match(await dd.getAttribute('#send-texts', 'title'), /posted week, 10-11-26 to 10-17-26, sent to 1 driver/);
      assert.match(await dd.textContent('#send-texts .send-words'), /^Texts sent .* to 1 driver \(test copy\)$/);
      assert.match(await dd.textContent('#send-texts .send-chip'), /^\d+ TO TEXT YOURSELF$/);
      assert.match(await popText(dd), /YOURSELF/);
      await closePop(dd);
      assert.equal(await dd.textContent('#send-texts button'), 'Send Again');
      assert.ok(await fits(dd) <= 0, 'no side scroll on Daily Dispatch at ' + w);
      assert.deepEqual(await small(dd), []);
      if (SHOTS) await dd.waitForTimeout(800), await dd.screenshot({ path: path.join(SHOTS, 'live-send-daily-' + w + '.png') });
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

    // Joe 11/7 (li): the fail-safe. After a send, the strip counts who has the week: 1 OF 1 SENT in green. A driver ticked after the
    // send is missing: red 1 OF 2 SENT · 1 MISSING with his name and why, and Text the Missing Driver (two taps) texts only him.
    const wk2 = await openPage(browser, 1536, 790, '/weekly.html?view=live&' + ADMIN);
    await wk2.waitForFunction(() => /^1 OF 1 SENT$/.test((document.querySelector('#send-texts .send-count.good') || {}).textContent || ''), null, { timeout: 15000 });
    await popText(wk2);
    await closePop(wk2);
    if (SHOTS) await wk2.waitForTimeout(800), await wk2.screenshot({ path: path.join(SHOTS, 'check-all-sent-1536.png') });
    await wk2.context().close();
    await db().collection('driverPhones').doc('drv_test_adams').set({ driverId: 'drv_test_adams', phone: '+13305550199', scheduleText: true });
    for (const [w, h, url] of [[1920, 1080, '/daily.html?date=2026-10-12&'], [390, 844, '/weekly.html?view=live&'], [1536, 790, '/weekly.html?view=live&']]) {
      const p = await openPage(browser, w, h, url + ADMIN);
      await p.waitForSelector('#send-texts .send-count.bad', { timeout: 15000 });
      const short = /daily/.test(url);
      assert.equal(await p.textContent('#send-texts .send-count'), short ? '1 OF 2 SENT' : '1 OF 2 SENT · 1 MISSING');
      assert.equal(await p.textContent('#send-texts button'), short ? 'Text 1 Missing' : 'Text the Missing Driver');
      const missPop = await popText(p);
      assert.match(missPop, /1 DRIVER DOES NOT HAVE THIS WEEK'S TEXT/);
      assert.match(missPop, /ADAMS, PAT \(not sent yet\)/);
      assert.equal(await p.textContent(POP + ' .send-pop-fix'), short ? 'Text 1 Missing' : 'Text the Missing Driver');
      assert.ok(await p.$$eval(POP + ' *', els => els.filter(e => e.offsetWidth && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())).every(e => parseFloat(getComputedStyle(e).fontSize) >= 15.9)), '16 size in the pop-up');
      assert.ok(await fits(p) <= 0, 'no side scroll with the pop-up at ' + w);
      if (SHOTS) await p.waitForTimeout(500), await p.screenshot({ path: path.join(SHOTS, 'pop-missing-' + w + '.png') });
      if (w === 1536) {
        // Text the Missing Driver in the pop-up: two taps, only the missing driver.
        const before = (await db().collection('textLog').get()).size;
        await p.click(POP + ' .send-pop-fix');
        assert.equal(await p.textContent(POP + ' .send-pop-fix'), 'Tap Again: Text 1 driver');
        await p.click(POP + ' .send-pop-fix');
        await p.waitForFunction(() => /^2 OF 2 SENT$/.test((document.querySelector('#send-texts .send-count.good') || {}).textContent || ''), null, { timeout: 15000 });
        const added = (await db().collection('textLog').get()).docs.map(x => x.data()).filter(x => x.driverId === 'drv_test_adams');
        assert.equal((await db().collection('textLog').get()).size, before + 1, 'only the missing driver');
        assert.equal(added.length, 1);
        assert.doesNotMatch(await p.textContent('#send-texts-pop'), /DOES NOT HAVE/, 'the missing part goes once they have it');
        await closePop(p);
        if (SHOTS) await p.waitForTimeout(800), await p.screenshot({ path: path.join(SHOTS, 'check-fixed-1536.png') });
        assert.deepEqual(p.errors, []);
        await p.context().close();
        break;
      }
      await closePop(p);
      assert.deepEqual(await small(p), []);
      assert.ok(await fits(p) <= 0, 'no side scroll at ' + w);
      if (SHOTS) await p.waitForTimeout(800), await p.screenshot({ path: path.join(SHOTS, 'check-missing-' + w + '.png') });
      assert.deepEqual(p.errors, []);
      await p.context().close();
    }

    // Joe 11/9: Dispatch gives Casey a truck on Wednesday after his text went out. Weekly Dispatch, already open, lists him in red
    // with what changed (no reload, nothing texted by itself), and Send Updated Schedule texts only him; then he drops off.
    {
      const p = await openPage(browser, 1536, 790, '/weekly.html?view=live&' + ADMIN);
      await p.waitForSelector('#send-texts .send-count.good', { timeout: 15000 });
      assert.doesNotMatch(await popText(p), /CHANGED/, 'nothing changed yet');
      await closePop(p);
      const before = (await db().collection('textLog').get()).size;
      await db().collection('runs').doc('2026-10-11__run_t905').set({ days: { wed: { truck: '518', trailer: '905' } } }, { merge: true });
      // The new warning brings the pop-up back by itself.
      const chPop = await popText(p);
      assert.match(chPop, /1 DRIVER'S SCHEDULE CHANGED AFTER THEIR TEXT WENT OUT/);
      assert.match(await p.textContent(POP + ' .send-pop-row'), /CASEY, LEE \(texted .+\)WEDNESDAY: TRUCK 518 ADDED, TRAILER 905 ADDED/);
      assert.equal(await p.textContent(POP + ' .send-update'), 'Send Updated Schedule');
      assert.equal(await p.textContent('#send-texts .send-chip'), '1 SCHEDULE CHANGED');
      assert.equal((await db().collection('textLog').get()).size, before, 'the warning never texts');
      assert.deepEqual(await small(p), []);
      assert.ok(await fits(p) <= 0);
      if (SHOTS) await p.waitForTimeout(800), await p.screenshot({ path: path.join(SHOTS, 'changed-weekly-1536.png') });
      for (const [w, h] of [[1920, 1080], [390, 844]]) {
        const dd = await openPage(browser, w, h, '/daily.html?date=2026-10-12&' + ADMIN);
        assert.match(await popText(dd), /SCHEDULE CHANGED/);
        assert.ok(await fits(dd) <= 0, 'no side scroll on Daily Dispatch at ' + w);
        assert.deepEqual(await small(dd), []);
        if (SHOTS) await dd.waitForTimeout(800), await dd.screenshot({ path: path.join(SHOTS, 'changed-daily-' + w + '.png') });
        assert.deepEqual(dd.errors, []);
        await dd.context().close();
      }
      await p.click(POP + ' .send-update');
      await p.waitForFunction(() => !document.querySelector('#send-texts-pop .send-update') && !/CHANGED/.test(document.getElementById('send-texts').textContent), null, { timeout: 15000 });
      const added = (await db().collection('textLog').get()).docs.map(x => x.data()).filter(x => x.kind === 'RESEND');
      assert.equal(added.length, 1);
      assert.deepEqual([added[0].driverId, /Truck 518 · Trailer 905/.test(added[0].body)], ['drv_test_casey', true]);
      if (SHOTS) await p.waitForTimeout(800), await p.screenshot({ path: path.join(SHOTS, 'changed-sent-1536.png') });
      assert.deepEqual(p.errors, []);
      await p.context().close();
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
      // Joe 11/7: part 3 lists, in red, the drivers to text yourself.
      await tx.waitForSelector('#hand:not([hidden]) #hand-rows tr', { timeout: 15000 });
      const hand = await tx.$$eval('#hand-rows tr', rs => rs.map(r => [...r.cells].map(c => c.textContent)));
      assert.ok(hand.length && hand.every(r => /Not signed up|No mobile phone|Replied STOP/.test(r[1]) && /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)/.test(r[2])), JSON.stringify(hand));
      assert.ok(!hand.some(r => /CASEY/.test(r[0])), 'Casey is signed up');
      assert.ok(await tx.$$eval('#hand td, #hand th', els => els.every(el => parseFloat(getComputedStyle(el).fontSize) >= 15.9)), '16px');
      assert.ok(await fits(tx) <= 0, 'no side scroll on Texts at ' + w);
      if (SHOTS) await tx.waitForTimeout(800), await tx.locator('#hand').locator('xpath=ancestor::section').screenshot({ path: path.join(SHOTS, 'hand-' + w + '.png') });
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

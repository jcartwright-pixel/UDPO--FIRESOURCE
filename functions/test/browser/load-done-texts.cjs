'use strict';
/*
 * Joe 10/26 ("text temporarily a few people when the load is complete ... that their load is done, and if they have any
 * pickups"; then one Texts screen with a part per kind and the Driver Roster controlling who gets them): the Roster's Texts
 * ticks (Schedule, Load) and Administration > Texts: each kind's own On / Off and who gets it, a test text to one phone,
 * Ask drivers to sign up, the texts and replies. Pictures at 1536, 1920 and a phone go to SHOTS_DIR.
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
  await db().collection('config').doc('app').set({ liveWeeks: { previous: '2026-10-04', current: '2026-10-11', next: '2026-10-18' } }, { merge: true });
  await db().collection('private').doc('sms').set({ accountSid: 'AC' + '0123456789abcdef'.repeat(2), authToken: 'tok', fromNumber: '+18885550100' });
  await db().collection('textLog').doc('done_2026-10-18_x_mon').set({ direction: 'out', kind: 'LOAD_DONE', driverId: 'drv_test_casey', name: 'CASEY, LEE', to: '+13305551234', at: '2026-10-18T17:50:00.000Z', status: 'NOT SENT',
    body: 'United Dairy: your load is done. Route 905 UT DSD MILK, trailer T-901, 1,200 cases. Pickups: 2 crates chocolate milk.' });
  await db().collection('driverPhones').doc('drv_test_adams').set({ driverId: 'drv_test_adams', phone: '+13305550101', loadText: false, stoppedAt: '2026-10-18T14:06:00.000Z' });
  await db().collection('textLog').doc('doneReply_SM2').set({ direction: 'in', kind: 'SIGN_UP', driverId: 'drv_test_adams', name: 'ADAMS, PAT', from: '+13305550101', at: '2026-10-18T14:06:00.000Z', status: 'RECEIVED', body: 'STOP' });
  // Joe 10/31: a driver's reply that was texted on to the phone under Driver replies.
  await db().collection('textLog').doc('doneReply_SM5').set({ direction: 'in', kind: 'REPLY', driverId: 'drv_test_casey', name: 'CASEY, LEE', from: '+13305551234', at: '2026-10-18T15:10:00.000Z', status: 'RECEIVED', body: 'Running about 20 minutes late', forwardTo: '+13305557777', forwardStatus: 'SENT' });
  const browser = await chromium.launch();
  try {
    // The Driver Roster: Texts, a Schedule and a Load tick (Joe 10/26), saved at once; a driver who replied STOP says so in red.
    for (const [w, h] of [[1536, 790], [1920, 950]]) {
      const ro = await openPage(browser, w, h, '/drivers.html?testEmail=manager.test@uniteddairy.com');
      const tick = (kind) => '#rows [data-driver="drv_test_casey"][data-text="' + kind + '"]';
      await ro.waitForSelector(tick('LOAD'));
      assert.ok((await ro.$$eval('.sheet thead th', t => t.map(x => x.textContent))).includes('Texts'));
      assert.match(await ro.textContent('#rows tr[data-id="drv_test_adams"] td.load-text'), /Replied STOP/);
      if (w === 1536) {
        await ro.check(tick('LOAD'));
        await ro.check(tick('SCHEDULE'));
        const saved = async () => (await db().collection('driverPhones').doc('drv_test_casey').get()).data() || {};
        for (let i = 0; i < 50 && !((await saved()).loadText && (await saved()).scheduleText); i++) await ro.waitForTimeout(100);
        assert.deepEqual([(await saved()).loadText, (await saved()).scheduleText, (await saved()).phone], [true, true, '+13305551234'], 'both ticks saved; the phone stays');
      }
      assert.ok(await fits(ro) <= 0, 'no side scroll on the Driver Roster at ' + w);
      if (SHOTS) { await ro.waitForTimeout(1000); await ro.screenshot({ path: path.join(SHOTS, 'after-driver-roster-' + w + '.png') }); }
      assert.deepEqual(ro.errors, []);
      await ro.context().close();
    }
    // Administration > Texts: a part per kind with its own switch; who gets each kind is a list of the Roster's ticks.
    for (const [w, h] of [[1536, 790], [1920, 1080], [390, 844]]) {
      const p = await openPage(browser, w, h, '/texts.html?testEmail=admin.test@uniteddairy.com');
      await p.waitForFunction((on) => document.getElementById('done-state').textContent === on, w === 1536 ? 'Off' : 'On');
      assert.equal(await p.textContent('#state'), 'Off', 'Schedule texts stay Off');
      await p.waitForFunction(() => document.getElementById('count').textContent === '1 ticked' && document.getElementById('preview-count').textContent === '1 ticked');
      assert.equal(await p.$eval('#drivers tr td', td => td.textContent), 'CASEY, LEE');
      assert.equal(await p.$eval('#preview tr td', td => td.textContent), 'CASEY, LEE');
      assert.match(await p.textContent('#sample'), /^United Dairy: your load is done\. Route 801 .*Pickups: 2 crates chocolate milk\.$/);
      assert.match(await p.textContent('#preview-text'), /your schedule for the week of/);
      assert.match(await p.textContent('#mode'), /Test copy/);
      assert.match(await p.textContent('#ask-text'), /Reply YES to get them/);
      await p.waitForSelector('#log tr td:nth-child(6)');
      assert.match(await p.textContent('#log'), /Load done/);
      if (w === 1536) {
        // A test text to one phone, with every switch Off: the test copy writes it to the list only.
        await p.fill('#test-phone', '555-12');
        await p.click('#test-send');
        await p.waitForFunction(() => /10 digits/.test(document.getElementById('error').textContent));
        await p.fill('#test-phone', '330-555-9999');
        await p.click('#test-send');
        await p.waitForFunction(() => /330-555-9999: test copy/.test(document.getElementById('test-result').textContent));
        await p.waitForFunction(() => /this is a test text/.test(document.getElementById('log').textContent));
        // Ask drivers: the first tap arms it, the second asks (the test copy writes to the list only).
        await p.click('#ask');
        assert.equal(await p.textContent('#ask'), 'Tap again to text the drivers');
        await p.click('#ask');
        await p.waitForFunction(() => /test copy/.test(document.getElementById('ask-text').textContent));
        await p.click('#done-turn');
        await p.waitForFunction(() => document.getElementById('done-state').textContent === 'On');
        assert.equal((await db().collection('private').doc('sms').get()).data().doneOn, true);
        assert.equal((await db().collection('private').doc('sms').get()).data().on, undefined, 'Schedule texts untouched');
        await p.fill('#test-phone', '330-555-9999');
        // Joe 10/31: driver replies sent on to a phone; it saves by itself, a bad number is refused, blank turns it off.
        assert.equal(await p.textContent('#fwd-state'), 'Off');
        assert.match(await p.textContent('#fwd-sample'), /^United Dairy: reply from .+: Running about 20 minutes late$/);
        await p.fill('#fwd-phone', '555-77');
        await p.press('#fwd-phone', 'Enter');
        await p.waitForFunction(() => /10 digits/.test(document.getElementById('error').textContent));
        await p.fill('#fwd-phone', '330-555-7777');
        await p.press('#fwd-phone', 'Enter');
        await p.waitForFunction(() => document.getElementById('fwd-state').textContent === 'On' && /330-555-7777/.test(document.getElementById('fwd-text').textContent));
        assert.equal((await db().collection('private').doc('sms').get()).data().forwardTo, '+13305557777');
        assert.match(await p.textContent('#log'), /Reply.*Running about 20 minutes late.*Sent to your cell/);
      }
      assert.ok(await fits(p) <= 0, 'no side scroll on Texts at ' + w);
      assert.deepEqual(await small(p), [], 'Texts: no text under 16px at ' + w);
      if (SHOTS) { await p.$eval('h1', e => e.scrollIntoView()); await p.waitForTimeout(1000); await p.screenshot({ path: path.join(SHOTS, 'after-texts-top-' + w + '.png') }); }
      if (SHOTS && w !== 390) {
        await p.$eval('#done-turn', e => e.closest('section').previousElementSibling.scrollIntoView()); await p.waitForTimeout(500); await p.screenshot({ path: path.join(SHOTS, 'after-texts-kinds-' + w + '.png') });
        await p.$eval('#fwd-phone', e => e.closest('section').scrollIntoView()); await p.waitForTimeout(500); await p.screenshot({ path: path.join(SHOTS, 'after-texts-replies-' + w + '.png') });
        await p.$eval('#log', e => e.closest('section').scrollIntoView()); await p.waitForTimeout(500); await p.screenshot({ path: path.join(SHOTS, 'after-texts-log-' + w + '.png') });
      }
      assert.deepEqual(p.errors, []);
      await p.context().close();
    }
    // Administration lists Texts under Connections & Keys (it was Schedule Texts).
    const a = await openPage(browser, 1536, 790, '/administration.html?testEmail=admin.test@uniteddairy.com');
    await a.waitForSelector('.adm-item[data-key="people"]');
    await a.fill('#find', 'texts');
    await a.waitForFunction(() => [...document.querySelectorAll('.adm-item')].map(x => x.dataset.key).join() === 'schedule-texts');
    await a.waitForSelector('.adm-item[data-key="schedule-texts"]', { state: 'visible' });
    if (SHOTS) { await a.waitForTimeout(1000); await a.screenshot({ path: path.join(SHOTS, 'after-administration-1536.png') }); }
    await a.context().close();
    console.log('load-done-texts: ok');
  } finally { await browser.close(); }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });

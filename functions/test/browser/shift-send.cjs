'use strict';
/*
 * Browser check of Joe's 10/15 Maintenance Requests rule ("This needs to have a send button, not automatically send. And until
 * it's sent, can't be cleared"): a new maintenance request is a draft marked Not sent yet until Send to Maintenance is pressed;
 * nothing reaches maintenance's list before that, a report does not empty it and leaving the screen keeps it. Pictures go to
 * SHOTS_DIR.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const F = require('../fixtures/fake-sheets');
const PD = require('../fixtures/plant-demo');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR || '';
const MANAGER = '?testEmail=manager.test@uniteddairy.com';
const requests = async () => (await db().collection('plantJournal').where('type', '==', 'SHIFT_REPORT').get()).docs.map(d => d.data()).filter(d => d.payload && d.payload.values && d.payload.values.Type === 'Maintenance Request');

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date('2026-10-08T14:00:00Z') });
  await db().collection('plantReports').doc('send-report-1').set({ at: new Date(Date.now() - 3600000).toISOString(), by: 'zmiller@uniteddairy.com' });
  const results = [];
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1536, height: 730 } });
    const page = await ctx.newPage();
    await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) }));
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(HOSTING + '/shiftnotes.html' + MANAGER);
    await page.waitForSelector('#fields .sn-entry');
    await page.click('#lines [data-kind="Maintenance Request"]');
    await page.waitForSelector('#mr-send-row:not([hidden])');
    assert.equal(await page.isVisible('#mr-unsent'), false, 'nothing typed yet: no Not sent yet mark');
    assert.match(await page.textContent('#new-title'), /when you press Send/);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'shift-send-empty-1536.png') });

    // Send with nothing typed says so and sends nothing.
    await page.click('#mr-send');
    await page.waitForFunction(() => /Type what's wrong first/.test(document.querySelector('#form-last').textContent));
    // Typed and left: kept as a draft, marked Not sent yet, not on maintenance's list.
    await page.fill('.sn-equip', 'Filler 4');
    await page.fill('.sn-entry', 'Leaky valve on the bowl');
    await page.selectOption('.sn-urgency', { index: 1 });
    await page.click('#kind-title');
    await page.waitForSelector('#mr-unsent:not([hidden])');
    assert.equal((await page.textContent('#form-last')).trim(), 'Not sent yet');
    await page.waitForTimeout(1500);
    assert.deepEqual(await requests(), [], 'nothing goes to maintenance before Send');
    results.push('A typed maintenance request is marked Not sent yet and is not on maintenance\'s list; Send with nothing typed asks for what\'s wrong');

    // A new report does not empty an unsent request; leaving and coming back keeps it.
    await db().collection('plantReports').doc('send-report-2').set({ at: new Date().toISOString(), by: 'zmiller@uniteddairy.com' });
    await page.waitForTimeout(1500);
    assert.deepEqual([await page.inputValue('.sn-equip'), await page.inputValue('.sn-entry')], ['Filler 4', 'Leaky valve on the bowl'], 'a report does not clear an unsent request');
    await page.reload();
    await page.waitForSelector('#fields .sn-entry');
    await page.click('#lines [data-kind="Maintenance Request"]');
    await page.waitForFunction(() => document.querySelector('#fields .sn-entry').value === 'Leaky valve on the bowl');
    await page.waitForSelector('#mr-unsent:not([hidden])');
    assert.equal(await page.inputValue('.sn-equip'), 'Filler 4');
    assert.deepEqual(await requests(), []);
    results.push('A new report does not empty it, and leaving the screen and coming back keeps it');
    assert.equal((await page.textContent('#form-last')).trim(), 'Not sent yet', 'the pill at the top says Not sent yet too');
    if (SHOTS) for (const [w, h] of [[1536, 864], [1920, 1080]]) { await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(300); await page.screenshot({ path: path.join(SHOTS, 'shift-send-unsent-' + w + '.png') }); }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'nothing runs off the side');

    // Send: it goes on maintenance's list, the Send row goes, the draft is gone.
    await page.click('#mr-send');
    await page.waitForFunction(() => /Sent to maintenance/.test(document.querySelector('#form-last').textContent), null, { timeout: 15000 });
    await page.waitForSelector('#mr-send-row[hidden]', { state: 'attached' });
    const sent = await requests();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].payload.values.Equipment, 'Filler 4');
    assert.equal(await page.evaluate(() => localStorage.getItem('ud.shiftnotes.requestDraft')), null, 'the draft is gone once sent');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'shift-send-sent-1920.png') });
    await page.click('#another');
    await page.waitForSelector('#open-box .sn-card');
    assert.match(await page.textContent('#open-box'), /Filler 4[\s\S]*Waiting for maintenance/);
    assert.equal(await page.inputValue('.sn-entry'), '', 'Start Another Entry starts a new request empty');
    results.push('Send to Maintenance puts it on maintenance\'s list (Waiting for maintenance) and the next request starts empty');

    // Other kinds still save by themselves as each box is left.
    await page.click('#lines [data-kind="Other"]');
    await page.waitForSelector('#mr-send-row[hidden]', { state: 'attached' });
    assert.deepEqual(errors, []);
    await ctx.close();
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('SEND ' + r));
})().catch(e => { console.error(e); process.exit(1); });

'use strict';
/*
 * Browser check of Maintenance's email write-ups (review item 33, Joe 10/11): a write-up from the answering-service email
 * shows a View link that opens the original email (sender, time, subject, text). Joe 10/18: no "From email" tag and no
 * "View email" wording, one View link in front of what is wrong.
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
const shot = async (p, name, clip) => { if (SHOTS) await p.screenshot(Object.assign({ path: path.join(SHOTS, name) }, clip ? { clip } : {})); };

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: () => new Date('2026-10-09T12:00:00Z') });
  const opened = new Date(Date.now() - 3600000).toISOString();
  const text = 'Name (UT): ADAMS\nRoute Number: 801\nTractor Number: 900001\nWrite Up Defects: truck horn weak\nCases Delivered: 410';
  await db().collection('maintenance').doc('MAIL_mail77_tractor').set({ record_id: 'MAIL|mail77|tractor', kind: 'TRUCK', truck_number: '900001', driver: 'ADAMS', route_id: '801', issue_details: 'truck horn weak', status: 'OPEN', opened_at: opened, source_type: 'GMAIL', source_id: 'mail77' });
  await db().collection('maintenance').doc('APP_x_mon_tractor').set({ record_id: 'APP|x|mon|tractor', kind: 'TRUCK', truck_number: '900002', driver: 'BROOK', route_id: '802', issue_details: 'Flat tire', status: 'OPEN', opened_at: opened, source_type: 'APP' });
  await db().collection('mailCopies').doc('mail77').set({ id: 'mail77', from: 'Lauttamus Answering Service <CallCenter@lauttamus.com>', subject: 'UNIONTOWN DRIVER CHECK IN', receivedAt: opened, body: text });
  const browser = await chromium.launch();
  const results = [];
  try {
    const p = await openPage(browser, 1920, 1080, '/issues.html?testEmail=manager.test@uniteddairy.com');
    await p.waitForSelector('tr[data-id="MAIL_mail77_tractor"]');
    assert.match(await p.textContent('tr[data-id="MAIL_mail77_tractor"] td.wrong'), /^View truck horn weak$/);
    assert.equal(/From email|View email/.test(await p.textContent('#rows')), false);
    // A write-up typed into the sheet (no email, no app check-in) has nothing to open.
    assert.equal(await p.locator('tr[data-id="APP_x_mon_tractor"] [data-source]').count(), 0);
    await shot(p, 'list-1920.png');
    await shot(p, 'list-top-2x.png', { x: 0, y: 0, width: 1920, height: 540 });
    await p.click('tr[data-id="MAIL_mail77_tractor"] [data-source]');
    await p.waitForSelector('#mail-modal:not([hidden]) .mail-text');
    const shown = await p.textContent('#mail-body');
    assert.match(shown, /Lauttamus Answering Service/);
    assert.match(shown, /UNIONTOWN DRIVER CHECK IN/);
    assert.match(shown, /Write Up Defects: truck horn weak/);
    await shot(p, 'view-email-1920.png');
    await p.click('[data-close-mail]');
    assert.equal(await p.isHidden('#mail-modal'), true);
    assert.deepEqual(p.errors, []);
    results.push('A write-up from the answering-service email shows one View link that opens the original email; typed ones have none');
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('ok - ' + r));
})().catch(err => { console.error(err); process.exit(1); });

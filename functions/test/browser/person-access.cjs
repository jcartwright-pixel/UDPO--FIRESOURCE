'use strict';
/*
 * Browser check of People & Roles' person pop-up (Joe 10/11 screenshot): Allowed locations shows what each person really
 * has (an Administrator with no plants listed has All locations; anyone else Uniontown), Save Person Access saves, and a
 * refusal reads in plain words with no [403] code. Pictures go to SHOTS_DIR.
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
const ticked = (p) => p.$$eval('#p-plants input:checked', b => b.map(x => x.value));

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: () => new Date('2026-10-09T12:00:00Z') });
  const u = db().collection('users');
  await u.doc('boss.test@uniteddairy.com').set({ name: 'Boss Test', status: 'ACTIVE', roles: ['ADMINISTRATOR'], facilities: [], cells: { id: 'usr_boss', version: '2' } });
  await u.doc('nolist.test@uniteddairy.com').set({ name: 'No List Supervisor', status: 'ACTIVE', roles: ['SUPERVISOR'], facilities: [], cells: { id: 'usr_nolist', version: '1' } });
  await db().collection('config').doc('app').set({ writeBack: { enabled: true } }, { merge: true });
  const browser = await chromium.launch();
  const results = [];
  try {
    const p = await openPage(browser, 1920, 1080, '/administration.html?testEmail=admin.test@uniteddairy.com');
    await p.waitForSelector('#people tr[data-email="boss.test@uniteddairy.com"]');
    await p.click('#people tr[data-email="boss.test@uniteddairy.com"]');
    await p.waitForSelector('#p-modal:not([hidden]) #p-save');
    assert.deepEqual(await ticked(p), ['*'], 'an Administrator with no plants listed shows All locations');
    await shot(p, 'person-open-1920.png');
    await shot(p, 'person-open-top-2x.png', { x: 0, y: 0, width: 1920, height: 540 });
    await p.click('#p-save');
    await p.waitForFunction(() => /Saved boss\.test@uniteddairy\.com/.test(document.querySelector('#view').textContent));
    assert.deepEqual((await u.doc('boss.test@uniteddairy.com').get()).data().facilities, ['*']);
    await shot(p, 'person-saved-1920.png');
    await shot(p, 'person-saved-top-2x.png', { x: 0, y: 0, width: 1920, height: 540 });
    results.push('An Administrator with no plants listed shows All locations ticked, and Save Person Access saves');

    // Anyone else with no plants listed sees Uniontown, so their box shows Uniontown.
    if (await p.$('#p-modal:not([hidden]) #p-cancel')) await p.click('#p-modal #p-cancel');
    await p.click('#people tr[data-email="nolist.test@uniteddairy.com"]');
    await p.waitForSelector('#p-modal:not([hidden]) #p-save');
    assert.deepEqual(await ticked(p), ['fac_uniontown']);
    await p.click('#p-modal #p-cancel');
    results.push('A supervisor with no plants listed shows Uniontown ticked');

    // A refusal is plain words, without a code.
    await db().collection('config').doc('app').set({ writeBack: { enabled: false } }, { merge: true });
    await p.reload();
    await p.waitForSelector('#people tr[data-email="boss.test@uniteddairy.com"]');
    await p.click('#people tr[data-email="boss.test@uniteddairy.com"]');
    await p.waitForSelector('#p-modal:not([hidden]) #p-save');
    await p.click('#p-save');
    await p.waitForSelector('#p-modal .ap-msg.bad:not([hidden])');
    const msg = await p.textContent('#p-modal .ap-msg.bad');
    assert.equal(/\[\d{3}\]|FirebaseError|functions\//.test(msg), false, msg);
    assert.deepEqual(p.errors, []);
    results.push('A refused save reads in plain words with no code');
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('ok - ' + r));
})().catch(err => { console.error(err); process.exit(1); });

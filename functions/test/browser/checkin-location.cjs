'use strict';
/*
 * Browser check of Driver Check-In Email per location (Joe 10/11): a Location drop-down on the button line; each location
 * shows and saves its own mailbox settings, laid out as before. Pictures go to SHOTS_DIR.
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
  const browser = await chromium.launch();
  const results = [];
  try {
    const p = await openPage(browser, 1920, 1080, '/administration.html?testEmail=admin.test@uniteddairy.com');
    await p.waitForSelector('.adm-item[data-key="checkin-email"]');
    await p.click('.adm-item[data-key="checkin-email"]');
    await p.waitForSelector('#ce-plant');
    await p.waitForFunction(() => document.querySelector('#ce-from').value === 'callcenter@lauttamus.com');
    assert.deepEqual(await p.$$eval('#ce-plant option', o => o.map(x => x.textContent)), ['Uniontown', 'Charleston', 'Martins Ferry']);
    const tops = await p.$$eval('#view .ap-bar > button, #view .ap-bar > .ap-right', b => [...new Set(b.map(x => Math.round(x.getBoundingClientRect().top)))]);
    assert.equal(tops.length, 1, 'buttons and Location on one line');
    assert.equal(await p.inputValue('#ce-subject'), 'UNIONTOWN DRIVER CHECK IN');
    await shot(p, 'after-uniontown-1920.png');
    await shot(p, 'after-uniontown-top-2x.png', { x: 0, y: 0, width: 1920, height: 540 });
    // Charleston: blank and off until filled in; saving it leaves Uniontown alone.
    await p.selectOption('#ce-plant', 'fac_charleston');
    await p.waitForFunction(() => document.querySelector('#ce-from').value === '');
    assert.equal(await p.isChecked('#ce-on'), false);
    await p.click('#ce-std');
    assert.equal(await p.inputValue('#ce-subject'), 'CHARLESTON DRIVER CHECK IN');
    await p.fill('#ce-to', 'chdrivercheckin@uniteddairy.com');
    await p.click('#ce-save');
    await p.waitForFunction(() => /Saved for Charleston/.test(document.querySelector('#view').textContent));
    await shot(p, 'after-charleston-1920.png');
    await p.selectOption('#ce-plant', 'fac_uniontown');
    await p.waitForFunction(() => document.querySelector('#ce-to').value === 'utdrivercheckin@uniteddairy.com');
    await p.selectOption('#ce-plant', 'fac_charleston');
    await p.waitForFunction(() => document.querySelector('#ce-to').value === 'chdrivercheckin@uniteddairy.com');
    assert.deepEqual(p.errors, []);
    results.push('Driver Check-In Email has a Location drop-down on the button line; Charleston starts blank and off, saves on its own, and Uniontown keeps its addresses');
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('ok - ' + r));
})().catch(err => { console.error(err); process.exit(1); });

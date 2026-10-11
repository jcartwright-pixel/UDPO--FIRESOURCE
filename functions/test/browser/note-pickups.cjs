'use strict';
/*
 * Browser check (npm run test:browser): a load note that asks for a pickup shows on the Loadout Center as an open pickup, red,
 * on the load's P/U button and in the Pickups count; Pickup Complete clears it on another open screen. Pictures go to SHOTS_DIR.
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
const DATE = PD.PLANT_DATE;

async function openPage(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 950 }, deviceScaleFactor: SHOTS ? 2 : 1 });
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    const file = route.request().url().split('/').pop();
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, file)) });
  });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(HOSTING + url);
  page.errors = errors;
  return page;
}
const row = (route) => 'tr[data-row^="2026-10-04__run_p' + route + '|"]';

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date(DATE + 'T14:00:00Z') });
  const browser = await chromium.launch();
  const results = [];
  try {
    const loader = await openPage(browser, '/loadout.html?date=' + DATE + '&testEmail=viewer.test@uniteddairy.com');
    const watcher = await openPage(browser, '/loadout.html?date=' + DATE + '&testEmail=manager.test@uniteddairy.com');
    await loader.waitForSelector(row('811') + ' button.edit-row');
    await watcher.waitForSelector(row('811'));
    assert.match(await loader.textContent('#strip'), /Pickups 1 left of 2/);
    await loader.click(row('811') + ' button.edit-row');
    await loader.fill('#edit-notes', 'pu 6 qts chocolate');
    await loader.click('#edit-save');
    await watcher.waitForFunction(r => document.querySelector(r + ' button.pu.open'), row('811'), { timeout: 8000 });
    assert.equal(await watcher.textContent(row('811') + ' button.pu'), 'P/U1', 'the note shows as an open pickup, red with its count');
    assert.match(await watcher.textContent('#strip'), /Pickups 2 left of 3/);
    results.push('A note "pu 6 qts chocolate" on 811 shows as an open pickup on the other screen');
    await loader.waitForSelector(row('811') + ' button.pu.open');
    await loader.click(row('811') + ' button.pu');
    assert.match(await loader.textContent('#pu-list'), /pu 6 qts chocolate[\s\S]*From the load note/);
    if (SHOTS) {
      await loader.screenshot({ path: path.join(SHOTS, 'note-pickup-popup-1920.png'), scale: 'css' });
      await loader.screenshot({ path: path.join(SHOTS, 'note-pickup-popup-top-2x.png'), clip: { x: 0, y: 0, width: 1920, height: 475 }, scale: 'device' });
    }
    await loader.click('#pu-list [data-done]');
    await watcher.waitForFunction(r => /Completed/.test(document.querySelector(r + ' button.pu').textContent), row('811'), { timeout: 8000 });
    assert.match(await watcher.textContent('#strip'), /Pickups 1 left of 3/);
    const saved = (await db().collection('pickups').where('runDocId', '==', '2026-10-04__run_p811').get()).docs.map(d => d.data());
    assert.equal(saved.length, 1);
    assert.equal(saved[0].status, 'COMPLETE');
    results.push('Pickup Complete saved it (note as the item) and the other screen shows Completed');
    // Who added and completed each pickup (review item 42): the person's name, or the Plant Station's name on a tablet.
    await watcher.click(row('805') + ' button.pu');
    assert.match(await watcher.textContent('#pu-list'), /Added by loader · /, 'a pickup from the sheet shows who added it');
    await watcher.click('#pu-modal [data-close]');
    await loader.waitForSelector('#pu-modal', { state: 'visible' });
    await loader.waitForFunction(() => /Completed by Test Viewer · /.test(document.getElementById('pu-list').textContent), null, { timeout: 8000 });
    await loader.click('#pu-modal [data-close]');
    await loader.evaluate(() => localStorage.setItem('udPlantStation', 'CASE'));
    await loader.click(row('812') + ' button.pu');
    await loader.fill('#pu-item', '2 cases skim');
    await loader.fill('#pu-qty', '2');
    await loader.click('#pu-add');
    await watcher.waitForFunction(r => document.querySelector(r + ' button.pu.open'), row('812'), { timeout: 8000 });
    await watcher.click(row('812') + ' button.pu');
    await watcher.waitForFunction(() => /Added by Case Loadout · /.test(document.getElementById('pu-list').textContent), null, { timeout: 8000 });
    await watcher.click('#pu-list [data-done]');
    await watcher.waitForFunction(() => /Added by Case Loadout · [\s\S]*Completed by Test Manager · /.test(document.getElementById('pu-list').textContent), null, { timeout: 8000 });
    if (SHOTS) await watcher.screenshot({ path: path.join(SHOTS, 'pickup-who-1920.png'), scale: 'css' });
    // The pop-up shows Completed at once; the save lands a moment later, so wait for it before reading the record.
    let skim;
    for (let i = 0; i < 40; i++) { skim = (await db().collection('pickups').where('runDocId', '==', '2026-10-04__run_p812').get()).docs.map(d => d.data())[0]; if (skim && skim.status === 'COMPLETE') break; await watcher.waitForTimeout(200); }
    assert.equal(skim.createdByName, 'Case Loadout');
    assert.equal(skim.completedByName, 'Test Manager');
    results.push('Pickups pop-up: "Added by Case Loadout" from the tablet, "Completed by Test Manager", with the times');
    for (const p of [loader, watcher]) assert.deepEqual(p.errors, []);
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('NOTE ' + r));
})().catch(e => { console.error(e); process.exit(1); });

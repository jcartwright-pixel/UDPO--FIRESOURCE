'use strict';
/*
 * Browser check of the unit lists on Loadout (Joe 10/10): the Truck and Trailer boxes offer the fleet's trucks and trailers
 * (open first), any number can still be typed, and the trailer list starts with TBA, saved as plain TBA (never T-TBA).
 * Pictures go to SHOTS_DIR.
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
const row = (route) => 'tr[data-row^="2026-10-04__run_p' + route + '|"]';

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date('2026-10-08T14:00:00Z') });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 950 }, deviceScaleFactor: SHOTS ? 2 : 1 });
    await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, r => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, r.request().url().split('/').pop())) }));
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(HOSTING + '/loadout.html?date=' + PD.PLANT_DATE + '&testEmail=manager.test@uniteddairy.com');
    await page.waitForFunction(() => document.querySelectorAll('#lo-trucks option').length > 0 && document.querySelectorAll('#lo-trailers option').length > 1);
    const trucks = await page.$$eval('#lo-trucks option', o => o.map(x => x.value)), trailers = await page.$$eval('#lo-trailers option', o => o.map(x => [x.value, x.label]));
    assert.ok(trucks.indexOf('900001') >= 0, 'the trucks are listed: ' + trucks.join(','));
    assert.deepEqual(trailers[0], ['TBA', 'Trailer not known yet'], 'TBA is first on the trailer list');
    assert.ok(trailers.some(t => t[0] === 'T-901'));
    assert.equal(await page.getAttribute(row('812') + ' input[data-k="truck"]', 'list'), 'lo-trucks');
    // TBA, typed in any case, is kept as plain TBA.
    await page.fill(row('812') + ' input[data-k="trailer"]', 'tba');
    await page.press(row('812') + ' input[data-k="trailer"]', 'Enter');
    await page.click('#foot'); // out of the table, so it is drawn again
    await page.waitForFunction(() => { const i = document.querySelector('tr[data-row^="2026-10-04__run_p812|"] input[data-k="trailer"]'); return i && i.value === 'TBA'; }, null, { timeout: 8000 });
    // A truck not on the list is kept as typed.
    await page.fill(row('812') + ' input[data-k="truck"]', '777777');
    await page.press(row('812') + ' input[data-k="truck"]', 'Enter');
    await page.click('#foot');
    await page.waitForFunction(() => { const i = document.querySelector('tr[data-row^="2026-10-04__run_p812|"] input[data-k="truck"]'); return i && i.value === '777777'; }, null, { timeout: 8000 });
    let kept = [];
    for (let i = 0; i < 40; i++) { kept = (await db().collection('runs').get()).docs.map(d => d.data()).filter(d => JSON.stringify(d).indexOf('"TBA"') >= 0); if (kept.length && JSON.stringify(kept[0]).indexOf('777777') >= 0) break; await page.waitForTimeout(250); }
    assert.equal(kept.length, 1, 'one load saved with trailer TBA');
    assert.ok(JSON.stringify(kept[0]).indexOf('T-TBA') < 0 && JSON.stringify(kept[0]).indexOf('777777') >= 0, 'TBA, never T-TBA, and the typed truck');
    if (SHOTS) {
      // The browser's own drop-down is not in screenshots; this picture draws the trailer list the box opens.
      await page.evaluate(() => {
        const box = document.querySelector('tr[data-row^="2026-10-04__run_p813|"] input[data-k="trailer"]') || document.querySelector('input[data-k="trailer"]');
        const r = box.getBoundingClientRect(), pop = document.createElement('div');
        pop.style.cssText = 'position:fixed;z-index:99;left:' + r.left + 'px;top:' + (r.bottom + 2) + 'px;width:260px;background:#fff;border:1px solid #9bb;box-shadow:0 6px 18px #0003;font:15px system-ui;border-radius:6px;overflow:hidden';
        pop.innerHTML = [...document.querySelectorAll('#lo-trailers option')].slice(0, 9).map(o => '<div style="display:flex;justify-content:space-between;padding:7px 10px;border-bottom:1px solid #eee"><b>' + o.value + '</b><span style="color:#667">' + o.label + '</span></div>').join('');
        box.focus(); document.body.appendChild(pop);
      });
      await page.screenshot({ path: path.join(SHOTS, 'loadout-trailer-list-1920.png'), scale: 'css' });
      await page.screenshot({ path: path.join(SHOTS, 'loadout-trailer-list-top-2x.png'), clip: { x: 0, y: 0, width: 1920, height: 600 }, scale: 'device' });
    }
    assert.deepEqual(errors, []);
    console.log('UNITS truck and trailer lists on Loadout; TBA kept as TBA; a truck not on the list kept as typed');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });

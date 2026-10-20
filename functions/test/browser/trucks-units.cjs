'use strict';
/*
 * Joe 10/20: Trucks Today > All Fleet Units. Units kept at another plant (Charleston, Martins Ferry) or written without the
 * T- in Equipment Master read "not in Equipment"; each unit's location sits beside its number; the trailer temperature from
 * the GPS takes the Last Report column; rows are tighter. At 1536 and 1920, and on phones and tablets (390 to 1024).
 * With SHOTS_DIR=<folder> it saves pictures; with BEFORE=1 it only saves them (for the screen as it was).
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
const SHOTS = process.env.SHOTS_DIR, BEFORE = !!process.env.BEFORE;

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES });
  const ago = (m) => new Date(Date.now() - m * 60000).toISOString(), now = ago(0);
  const b = db().batch();
  const E = (id, type, unit, facilityId, location) => b.set(db().collection('equipment').doc(id), { type, unit, status: 'ACTIVE', facilityId, location });
  E('eq_t934', 'TRAILER', 'T-934', 'fac_uniontown', 'UNIONTOWN');
  E('eq_t933', 'TRAILER', 'T-933', 'fac_charleston', 'CHARLESTON'); // another plant's trailer: still ours
  E('eq_t935', 'TRAILER', '935', 'fac_martins_ferry', 'MARTINS FERRY'); // written without the T-
  E('eq_tr1', 'TRUCK', '123901', 'fac_uniontown', 'MARIETTA');
  [['123901', 52, '', 'US|45750|Ohio|Marietta|Pike St', 30], ['T-933', 48, '', 'US|25510|West Virginia|Culloden|I-64 E', 3], ['T-934', 0, 'Uniontown Branch', 'US|15401|Pennsylvania|Uniontown|King St', 12],
    ['T-935', 0, 'Martins Ferry Branch', 'US|43935|Ohio|Martins Ferry|N 5th St', 4], ['777001', 0, 'Beckley Branch', 'US|25801|West Virginia|Beckley|Main St', 2000]]
    .forEach(([tag, mph, place, address, min]) => b.set(db().collection('gpsTrucks').doc(tag), { tag, unitId: 'u' + tag, lastReport: ago(min), place, address, speedMph: mph, ignitionOn: mph > 0,
      odometerMiles: 100000, engineHours: 9000, active: true, updatedAt: now }));
  b.set(db().collection('gpsTemps').doc('now'), { readAt: now, units: { 'T-933': { tempF: 34.5, at: ago(6) }, 'T-934': { tempF: 41.2, at: ago(20) } } });
  await b.commit();

  const browser = await chromium.launch();
  try {
    for (const [w, h] of [[1536, 864], [1920, 1080], [1024, 768], [390, 844]]) {
      const page = await browser.newPage({ viewport: { width: w, height: h }, serviceWorkers: 'block' });
      await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, r => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, r.request().url().split('/').pop())) }));
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.goto(HOSTING + '/trucks.html?testEmail=dispatch.test@uniteddairy.com');
      await page.click('[data-mode="units"]');
      await page.waitForFunction(() => document.querySelectorAll('.tt-board > tbody > tr').length >= 5, null, { timeout: 15000 });
      await page.waitForTimeout(800);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'all-fleet-units-' + w + '.png') });
      if (BEFORE) { await page.close(); continue; }
      assert.deepEqual(errors, []);
      assert.deepEqual(await page.$$eval('.tt-board > thead th', a => a.map(x => x.textContent)),
        ['Fleet unit', 'Location', 'Ours', 'Status', 'Where now', 'Temp (°F)', 'Miles today', 'Odometer', 'Engine hours'], 'Location beside the number; Temp in place of Last report');
      const rows = Object.fromEntries(await page.$$eval('.tt-board > tbody > tr', a => a.map(r => [r.cells[0].textContent, [r.cells[1].textContent, r.cells[2].textContent, r.cells[5].textContent]])));
      assert.deepEqual(rows['T-933'], ['Charleston', 'Trailer', '34.5°'], 'a Charleston trailer is ours, with its GPS temperature');
      assert.deepEqual(rows['T-934'], ['Uniontown', 'Trailer', '41.2°']);
      assert.deepEqual(rows['T-935'], ['Martins Ferry', 'Trailer', ''], 'Equipment Master "935" is trailer T-935');
      assert.deepEqual(rows['123901'], ['Marietta', 'Truck', '']);
      assert.deepEqual(rows['777001'], ['', 'not in Equipment', '']);
      assert.equal(await page.$eval('#kpis', e => e.innerText.replace(/\s+/g, ' ')).then(t => /3 Our trailers/i.test(t)), true, 'three trailers are ours');
      // Tighter: one line per unit where it fits (the place, then the address on the same line), rows at most 44px high on a laptop.
      if (w >= 1536) {
        // A Where now too long for its column wraps onto a second line (the app never cuts words off), so only that row is taller.
        const heights = await page.$$eval('.tt-board > tbody > tr', a => a.filter(r => !r.querySelector('td.fit-wrap')).map(r => Math.round(r.getBoundingClientRect().height)));
        assert.ok(heights.length >= 2 && Math.max(...heights) <= 44, 'rows are tight: ' + heights); // how many addresses wrap depends on the machine's fonts
      }
      const small = await page.$$eval('.tt-board td, .tt-board th', a => a.filter(x => x.textContent.trim() && parseFloat(getComputedStyle(x).fontSize) < 16).length);
      assert.equal(small, 0, 'text at least 16px');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, 'no sideways page scroll at ' + w);
      assert.equal(await page.$eval('.tt-board > thead th', th => getComputedStyle(th).position), 'sticky', 'sticky header');
      await page.close();
    }
  } finally { await browser.close(); }
  console.log(BEFORE ? 'pictures saved' : 'ok - All Fleet Units: other plants\' units are ours, Location beside the number, GPS temperature, tighter rows');
})().catch(e => { console.error(e); process.exit(1); });

'use strict';
/*
 * Browser check (Joe 10/22: "When these are paused, you're showing time like total time. That shouldn't count as loading
 * time"). On Daily Box Loadout at 10:00 AM:
 *   - Aldi Load 2, started 8:00 AM, paused 15 minutes earlier and again since 9:00 AM: Total Time 45 min, and it stays 45 min
 *     while it sits paused;
 *   - Aldi Load 3, started 8:00 AM, paused before pauses were timed (its note says Paused 10/8, 9:30 AM): 2 hours by 10:00 AM
 *     less the 30 paused minutes, so 90 min.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const F = require('../fixtures/fake-sheets');
const PD = require('../fixtures/plant-demo');
const localCalls = require('./local-calls.cjs');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const MANAGER = 'testEmail=manager.test@uniteddairy.com';
const NOW = '2026-10-08T14:00:00Z';   // Thursday 10:00 AM

const a1 = PD.SCHEDULE.find(r => r.record_id === 'SCHED-a1');
const more = (id, p) => Object.assign({}, a1, { record_id: id, payload_json: JSON.stringify(Object.assign(JSON.parse(a1.payload_json), p)) });
PD.SCHEDULE.push(
  more('SCHED-a2', { pickupTime: '08:05', trailer: 'T-962', poNumber: 'AC-2', work: { state: 'PAUSED', startedAt: '2026-10-08T12:00:00Z', pauseMark: { at: '2026-10-08T13:00:00Z', minutes: 15 }, notes: 'Paused 10/8, 9:00 AM: Carrier late' } }),
  more('SCHED-a3', { pickupTime: '09:00', trailer: 'T-963', poNumber: 'AC-3', work: { state: 'PAUSED', startedAt: '2026-10-08T12:00:00Z', notes: 'Paused 10/8, 9:30 AM: No pallets' } }));

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date(NOW) });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1536, height: 790 }, serviceWorkers: 'block' });
    await page.clock.install({ time: new Date(NOW) });
    await localCalls(page);
    await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
      route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
    });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(HOSTING + '/loadout.html?date=2026-10-08&area=BOXING&' + MANAGER);
    const row = (id) => '#rows tr[data-row="' + id + '"]';
    await page.waitForSelector(row('sch:SCHED-a3'), { timeout: 15000 });
    const total = (id) => page.$eval(row(id), tr => tr.querySelector('td:nth-last-child(3)').textContent.trim());
    assert.match(await page.textContent(row('sch:SCHED-a2') + ' button.state'), /Paused/);
    assert.equal(await total('sch:SCHED-a2'), '45 min', 'started 8:00, paused 15 min before and since 9:00: 45 minutes of loading');
    assert.equal(await total('sch:SCHED-a3'), '90 min', 'a load paused before pauses were timed: its note gives the pause start');
    // An hour later it is still paused: the time does not grow.
    await page.clock.fastForward('01:00:00');
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await page.waitForTimeout(500);
    assert.equal(await total('sch:SCHED-a2'), '45 min', 'a paused load\'s time stands still');
    assert.deepEqual(errors, []);
    console.log('PAUSED TIME CHECK PASSED\n - Paused loads: Total Time leaves out the paused minutes (45 min, 90 min) and stands still while paused');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });

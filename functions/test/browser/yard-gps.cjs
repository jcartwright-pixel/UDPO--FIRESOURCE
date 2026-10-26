'use strict';
/*
 * Joe 10/22 (Manager Center Walkthrough, Yard): a loaded trailer whose GPS temperature is in range (30 to 42°F) does not need a
 * yard check and is not past due. Exactly 32°F is what a reefer sends when it has no real reading: 32 at every reading for 4 hours
 * (more than 2 readings in a row, 2 hours apart) is a fault, and the trailer is checked by hand.
 *
 * Five loaded trailers on the yard, never checked: T-711 GPS 35.4°F (in range), T-712 49.8°F (too warm), T-713 exactly 32°F for
 * 5 hours (stuck), T-714 exactly 32°F for 1 hour (in range for now), T-715 36°F read 3 hours ago (too old to go by).
 * Yard Checks, Manager Center and the Manager Walkthrough at 1536 and 1920, and the phone. Pictures go to SHOTS_DIR (SHOT_NAME
 * prefix); BEFORE=1 only takes pictures, for the old code.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const L = require('../../src/logic');
const F = require('../fixtures/fake-sheets');
const PD = require('../fixtures/plant-demo');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR || '';
const NAME = process.env.SHOT_NAME || 'yard-gps';
const BEFORE = process.env.BEFORE === '1';
const MANAGER = '?testEmail=manager.test@uniteddairy.com';

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
const shot = (page, what, w) => SHOTS ? page.screenshot({ path: path.join(SHOTS, NAME + '-' + what + '-' + w + '.png'), scale: 'css' }) : null;

async function seed() {
  const date = L.operatingDay(new Date()), week = L.weekStart(date), p = L.dayPrefix(L.addDays(date, 2)), d = db();
  for (const r of (await d.collection('runs').get()).docs) await r.ref.delete();
  const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
  const loads = [['711', '849', 'SUN VALLEY', 35.4, 3, ''], ['712', '852', 'JERSEY 1', 49.8, 4, ''], ['713', '855', 'SUNSHINE', 32, 2, 300], ['714', '860', 'HILLTOP', 32, 5, 60],
    ['715', '907_1', 'FAIRMONT TRANSFER', 36, 180, '']];
  for (const [i, [t, route, run, tempF, readMin, flatMin]] of loads.entries()) {
    // Loaded today for two days from now, leaving at 10 AM: on the yard all of today's operating day.
    await d.collection('runs').doc(week + '__gps' + t).set({ weekStart: week, sheetRow: 910 + i, route, run, routeId: 'rte_g' + t, runId: 'run_g' + t, active: true,
      days: { [p]: { runs: true, loadDate: date, deliveryDate: L.addDays(date, 2), dispatchTime: 600, trailer: 'T-' + t, loadStatus: 'COMPLETE' } } });
    // What the 5-minute Fleet read writes for this load's trip (fleetgps.js pullReefer).
    await d.collection('gpsReefer').doc('T-' + t).set({ trailer: 'T-' + t, id: week + '__gps' + t + '|' + p, routeRun: run, unitId: 'u' + t, tag: 'T-' + t, startedAt: ago(400), recording: true,
      out: '', back: '', stoppedAt: '', stopReason: '', tempF, readingAt: ago(readMin), flatSince: flatMin ? ago(flatMin) : '', updatedAt: ago(2) });
  }
}

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date('2026-10-08T14:00:00Z') });
  await seed();
  const browser = await chromium.launch();
  const seen = [];
  try {
    for (const [w, h] of [[1536, 790], [1920, 1080]]) {
      const yd = await openPage(browser, w, h, '/yard.html' + MANAGER);
      await yd.waitForFunction(() => document.querySelectorAll('#rows tr[data-trailer]').length >= 3 && /49\.8/.test(document.getElementById('rows').textContent));
      await yd.waitForTimeout(500);
      await shot(yd, 'yard', w);
      const rows = await yd.$$eval('#rows tr[data-trailer]', r => r.map(x => x.dataset.trailer + ' ' + x.querySelector('.yd-next').textContent.replace(/\s+/g, ' ').trim()));
      seen.push(w + ' Yard Checks: ' + (await yd.textContent('#hstats')) + ' | ' + rows.join(' / '));
      if (!BEFORE) {
        assert.match(await yd.textContent('#hstats'), /^5Active3Due0Checked/, 'only the three the GPS cannot vouch for are due');
        assert.deepEqual(rows, ['T-712 Due nowJERSEY 1', 'T-713 Due nowGPS stuck at 32°SUNSHINE', 'T-715 Due nowFAIRMONT TRANSFER', 'T-711 GPS in rangeSUN VALLEY', 'T-714 GPS in rangeHILLTOP']);
        assert.equal(await yd.$eval('#rows tr[data-trailer="T-711"] .yd-next', e => getComputedStyle(e).color), 'rgb(21, 122, 58)', 'in range is green');
        assert.equal(await yd.$eval('#rows tr[data-trailer="T-713"] .yd-stuck', e => getComputedStyle(e).color), 'rgb(191, 32, 32)', 'stuck at 32 is red');
        assert.match(await yd.textContent('#foot'), /^3 trailers due, 0 checked in the last 2 hours, 2 in range on the GPS \(30 to 42°F, no check needed\)\./);
        const cut = await yd.$$eval('#rows td, #rows td small', a => a.filter(e => e.scrollWidth > e.clientWidth + 1 && !e.querySelector('input,select,button')).map(e => e.textContent));
        assert.deepEqual(cut, [], 'nothing cut off');
      }

      const mc = await openPage(browser, w, h, '/manager.html' + MANAGER);
      // Joe 10/26: the walkthrough's Yard stop is an action card (no trailer list); its count leaves out the trailers in range on the GPS.
      await mc.waitForFunction(() => /past due|trailers to check/.test((document.querySelector('[data-card="walk"] .wk-tile') || {}).textContent || ''));
      await mc.waitForTimeout(800);
      await mc.$eval('[data-card="walk"]', e => e.scrollIntoView({ block: 'end' }));
      await shot(mc, 'manager', w);
      const yardTile = (await mc.textContent('[data-card="walk"] .wk-tile:nth-child(1)')).replace(/\s+/g, ' ').trim();
      seen.push(w + ' Manager Center Yard: ' + yardTile);
      if (!BEFORE) {
        assert.match(yardTile, /^Yard PAST DUE 3 3 past due /);
        assert.match(yardTile, /Check now View$/);
      }
      for (const pg of [yd, mc]) { assert.deepEqual(pg.errors, []); await pg.close(); }
    }
    const ph = await openPage(browser, 390, 844, '/yard.html' + MANAGER);
    await ph.waitForFunction(() => /49\.8/.test((document.getElementById('cards') || {}).textContent || ''));
    await ph.waitForTimeout(500);
    await shot(ph, 'yard-phone', 390);
    const cards = await ph.$$eval('#cards tr.yd-card[data-trailer] .yd-ptrailer', a => a.map(x => x.textContent.replace(/\s+/g, ' ').trim()));
    seen.push('390 phone: ' + cards.join(' / '));
    if (!BEFORE) assert.ok(cards.includes('T-711GPS in range') && cards.includes('T-713GPS stuck at 32°'), cards.join(' / '));
    assert.deepEqual(ph.errors, []);
    await ph.close();
  } finally {
    await browser.close();
  }
  seen.forEach(s => console.log('YARD-GPS ' + s));
  console.log('ok - Yard Checks: a trailer with its GPS temperature in range (30 to 42°F) is not due; one stuck at exactly 32°F is');
})().catch(e => { console.error(e); process.exit(1); });

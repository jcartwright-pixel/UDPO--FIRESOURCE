'use strict';
/*
 * Browser check of the office Unloading & Washing list (Joe 11-6-26: "This screen should work just like my side on the app.
 * It should be sorted by what I need first ... on the bottom ... the unloaded ones. But if a trailer is not in yet, according
 * to the GPS, then move it down the list. But it should always be updating. And if it's in the parking lot, make it green."):
 *   - the trailer being unloaded is on top; the unloaded ones are at the bottom;
 *   - a trailer the live GPS (gpsTrucks) shows in the parking lot is green and says IN THE LOT;
 *   - a trailer the GPS shows away from the plant says NOT BACK YET and sits below every trailer that is back, even one
 *     today's loadout needs (T-777);
 *   - the dispatch tractor in the lot with a newer report than its trailer's counts as back;
 *   - when a trailer comes in, the list moves and turns it green by itself, with no reload;
 *   - a trailer today's loadout needs that is in the lot is the first one waiting (Joe, later the same day).
 * With SHOTS_DIR=<folder> it also saves pictures at 1536 and 1920.
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

const HOSTING = process.argv[2] || 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR || '';
const MANAGER = 'testEmail=manager.test@uniteddairy.com';
const NOW = '2026-10-08T14:00:00Z';
const LOT = { lat: 39.9, lon: -79.72, address: '', place: 'Uniontown Plant', speedMph: 0, ignitionOn: false };
const ROAD = { lat: 39.63, lon: -79.95, address: 'I-79 S, Morgantown, WV', place: '', speedMph: 58, ignitionOn: false };

async function openPage(browser, width, height, url) {
  const page = await browser.newPage({ viewport: { width, height }, serviceWorkers: 'block' });
  await page.clock.setFixedTime(new Date(NOW));
  await localCalls(page);
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
  });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(HOSTING + url);
  page.errors = errors;
  return page;
}
const unit = (tag, where, at) => Object.assign({ tag, unitId: 'U' + tag, lastReport: at || '2026-10-08T13:55:00Z', updatedAt: '2026-10-08T13:58:00Z' }, where);
const rowsNow = (p) => p.$$eval('#rows tr[data-key]', trs => trs.map(t => ({
  key: t.dataset.key, cls: t.className, trailer: (t.querySelector('td.trlcell .trl') || { textContent: '' }).textContent.trim(),
  where: (t.querySelector('td.trlcell small.where') || { textContent: '' }).textContent.trim(), status: (t.querySelector('.pill') || { textContent: '' }).textContent.trim()
})));

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date(NOW) });
  const d = db();
  // 812's Friday load (loaded today) takes T-777, which did not deliver today: it is needed today.
  await d.collection('runs').doc('2026-10-04__run_p812').update({ 'days.fri.trailer': 'T-777' });
  const browser = await chromium.launch();
  const results = [];
  try {
    const o = await openPage(browser, 1536, 790, '/unloading.html?' + MANAGER + '&area=CASE&date=2026-10-08');
    await o.waitForSelector('#rows tr[data-key]', { timeout: 15000 });
    await o.click('[data-tab="all"]');
    await o.waitForTimeout(1500);
    const first = await rowsNow(o);
    const waiting = first.filter(r => r.status === 'Waiting' && r.trailer && /^T-/.test(r.trailer));
    assert.ok(waiting.length >= 4, 'several trailers waiting: ' + JSON.stringify(first));
    // The live GPS: T-777 (needed today) and the next trailer are on the road; two others are in the lot. The tractor of a
    // fifth is in the lot with a newer report than its trailer's old road reading.
    const [needed] = waiting.filter(r => r.trailer === 'T-777'), others = waiting.filter(r => r.trailer !== 'T-777' && !r.where); // not checked in
    assert.ok(needed, 'T-777 is on the list');
    const roadOne = others[0].trailer, lotOnes = [others[1].trailer, others[2].trailer], comeIn = others[3].trailer;
    const b = d.batch();
    b.set(d.collection('gpsTrucks').doc('T-777'), unit('T-777', ROAD));
    b.set(d.collection('gpsTrucks').doc(roadOne), unit(roadOne, ROAD));
    lotOnes.forEach(t => b.set(d.collection('gpsTrucks').doc(t), unit(t, LOT)));
    b.set(d.collection('gpsTrucks').doc(comeIn), unit(comeIn, ROAD, '2026-10-08T12:30:00Z'));
    await b.commit();
    await o.waitForFunction((t) => [...document.querySelectorAll('#rows tr.lot .trl')].some(x => x.textContent.trim() === t), lotOnes[0], { timeout: 15000 });
    let rows = await rowsNow(o);
    const at = (t) => rows.findIndex(r => r.trailer === t), row = (t) => rows[at(t)];
    lotOnes.forEach(t => { assert.match(row(t).cls, /\blot\b/, t + ' in the lot is green'); assert.equal(row(t).where, 'IN THE LOT'); });
    ['T-777', roadOne, comeIn].forEach(t => { assert.match(row(t).cls, /\broad\b/, t + ' not back'); assert.equal(row(t).where, 'NOT BACK YET'); });
    assert.ok(lotOnes.every(t => at(t) < at('T-777') && at(t) < at(roadOne)), 'the trailers in the lot are above the ones not back yet, even T-777 that is needed today ' + JSON.stringify(rows.map(r => r.trailer + ' ' + r.where)));
    const firstDone = rows.findIndex(r => r.status === 'Done'), lastWaiting = rows.map(r => r.status).lastIndexOf('Waiting');
    assert.ok(firstDone < 0 || firstDone > lastWaiting, 'the unloaded ones are at the bottom');
    if (rows.some(r => r.status === 'Unloading')) assert.equal(rows[0].status, 'Unloading', 'the one being unloaded is on top');
    assert.match(await o.textContent('#foot'), /GPS CHECKED 9:58 AM\./);
    const lotColour = await o.$eval('#rows tr.lot .trl', e => getComputedStyle(e).backgroundColor);
    assert.equal(lotColour, 'rgb(31, 122, 77)', 'green trailer chip');
    results.push('lot: ' + lotOnes.join(', ') + ' green on top; not back: T-777, ' + roadOne + ', ' + comeIn + ' lower');
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await o.screenshot({ path: path.join(SHOTS, 'after-1536.png') }); }
    // It keeps updating: the trailer comes into the lot and the list moves by itself (no reload).
    await d.collection('gpsTrucks').doc(comeIn).set(unit(comeIn, LOT, '2026-10-08T14:00:00Z'));
    await o.waitForFunction((t) => [...document.querySelectorAll('#rows tr.lot .trl')].some(x => x.textContent.trim() === t), comeIn, { timeout: 15000 });
    rows = await rowsNow(o);
    assert.ok(at(comeIn) < at('T-777') && at(comeIn) < at(roadOne), comeIn + ' moved up when it came in');
    assert.equal(row(comeIn).where, 'IN THE LOT');
    results.push(comeIn + ' came in: green and moved up with no reload');
    // Joe 11-6-26 (later): a trailer you need that is in the lot goes on top. T-777 (today's loadout needs it) comes in.
    await d.collection('gpsTrucks').doc('T-777').set(unit('T-777', LOT, '2026-10-08T14:00:00Z'));
    await o.waitForFunction(() => [...document.querySelectorAll('#rows tr.lot .trl')].some(x => x.textContent.trim() === 'T-777'), null, { timeout: 15000 });
    rows = await rowsNow(o);
    const wait = rows.filter(r => r.status === 'Waiting'), i777 = wait.findIndex(r => r.trailer === 'T-777');
    assert.ok(wait.slice(0, i777).every(r => r.where === 'IN THE LOT') && wait.slice(i777).filter(r => r.where !== 'IN THE LOT').length === wait.length - wait.filter(r => r.where === 'IN THE LOT').length,
      'T-777, needed and in the lot, is above every trailer not in the lot ' + JSON.stringify(wait.map(r => r.trailer + ' ' + r.where)));
    assert.ok(i777 < wait.findIndex(r => r.trailer === lotOnes[1]) || i777 < wait.findIndex(r => r.trailer === comeIn), 'and above trailers in the lot that are not needed today');
    results.push('T-777 needed and in the lot: up top (' + wait.slice(0, i777 + 1).map(r => r.trailer).join(', ') + ')');
    assert.deepEqual(o.errors, []);
    await o.close();
    if (SHOTS) {
      const w = await openPage(browser, 1920, 1040, '/unloading.html?' + MANAGER + '&area=CASE&date=2026-10-08');
      await w.waitForSelector('#rows tr.lot', { timeout: 15000 });
      await w.click('[data-tab="all"]');
      await w.waitForTimeout(1500);
      await w.click('[data-mode="view"]');
      await w.waitForTimeout(500);
      await w.screenshot({ path: path.join(SHOTS, 'after-1920.png') });
      await w.setViewportSize({ width: 1536, height: 790 });
      await w.waitForTimeout(500);
      await w.screenshot({ path: path.join(SHOTS, 'needed-in-lot-1536.png') });
      await w.setViewportSize({ width: 1920, height: 1040 });
      await w.waitForTimeout(500);
      // The lower part of the list: the trailers not back yet, then the unloaded ones.
      await w.$eval('#rows tr.road', e => e.scrollIntoView({ block: 'start' }));
      await w.waitForTimeout(300);
      await w.screenshot({ path: path.join(SHOTS, 'after-1920-lower.png') });
      await w.close();
    }
  } finally {
    await browser.close();
  }
  console.log('unload-office-gps: ' + results.join(' | '));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });

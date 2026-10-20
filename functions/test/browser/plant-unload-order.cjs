'use strict';
/*
 * Browser check of Case Unloading's order on the Plant Station (Joe 10/15, mock-up A: "the trailer and the run needs to be big.
 * The route number doesn't matter ... if there's no trailer number, the run ... drop and hook, then it's just the run"):
 *   - the trailers come back in the order the next loads leave (the next unfinished load needing the same trailer, by its
 *     departure), numbered 1, 2, 3 ... with the trailer then the run in big type and no route number or times;
 *   - Fleet's yard return (gpsDays yardIn after yardOut) shows "Back 9:42 AM"; a trailer Fleet shows out of the yard is
 *     "On the road", greyed, below the ones back, unnumbered and with no Start button on the card;
 *   - a drop-and-hook load (Marietta) with no trailer is a "Transfer trailer" card that NEEDS A TRAILER, counted at the top;
 *   - the trailer being unloaded now is number 1, at the top.
 * With SHOTS_DIR=<folder> it also saves pictures at 1024 and 800.
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
const SHOTS = process.env.SHOTS_DIR || '';
const MANAGER = 'testEmail=manager.test@uniteddairy.com';
const NOW = '2026-10-08T14:00:00Z';

async function openPage(browser, width, height, url, touch) {
  const page = await browser.newPage(Object.assign(touch ? { viewport: { width, height }, hasTouch: true, isMobile: true } : { viewport: { width, height } }, { serviceWorkers: 'block' }));
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

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date(NOW) });
  const d = db();
  // Marietta (909) is drop and hook: its Thursday delivery left its trailer at the customer, so it needs a transfer trailer.
  const base = (await d.collection('runs').doc('2026-10-04__run_p801').get()).data();
  await d.collection('runs').doc('2026-10-04__run_m909_1').set(Object.assign({}, base, { route: '909_1', run: 'MARIETTA LOAD 1', routeId: 'rte_m909', runId: 'run_m909_1', routeName: 'Marietta', dropAndHook: true,
    days: { thu: Object.assign({}, base.days.thu, { trailer: 'T-10285' }) } }));
  // Fleet: T-953 left the yard at 1:00 AM and came back at 9:42 AM; T-955 left at 2:00 AM and is still out.
  await d.collection('gpsDays').doc('2026-10-08__T953').set({ tag: 'T-953', date: '2026-10-08', yardOut: '2026-10-08T05:00:00Z', yardIn: '2026-10-08T13:42:00Z' });
  await d.collection('gpsDays').doc('2026-10-08__T955').set({ tag: 'T-955', date: '2026-10-08', yardOut: '2026-10-08T06:00:00Z' });
  // When each trailer is next needed: its Friday load (loaded today), unless that load is already loaded. A load made the day
  // before leaves in the operating day before (the day rolls at 6 a.m., Joe 10/19): 6 a.m. on is Thursday, earlier is Friday.
  const nextDepart = {};
  (await d.collection('runs').get()).docs.forEach(doc => { const f = (doc.data().days || {}).fri; if (f && f.trailer && f.loadStatus !== 'COMPLETE' && f.dispatchTime != null) {
    const t = Number(f.dispatchTime), early = f.loadDate && f.deliveryDate && String(f.loadDate) < String(f.departureDate || f.deliveryDate);
    nextDepart[f.trailer] = early && t >= 360 ? t - 1440 : t; } });

  const browser = await chromium.launch();
  const results = [];
  try {
    for (const [w, h] of [[1024, 768], [800, 1280]]) {
      const p = await openPage(browser, w, h, '/plant-station.html?' + MANAGER + '&station=CASE_UNLOADING', true);
      await p.waitForSelector('#work .sw-card .sw-chips i.back', { timeout: 15000 });
      await p.waitForSelector('#work .sw-card.road');
      const cards = await p.$$eval('#work .sw-card[data-sw]', cs => cs.map(c => ({
        key: c.dataset.sw, order: (c.querySelector('.sw-order') || {}).textContent || '', trailer: (c.querySelector('.sw-trailer') || {}).textContent || '',
        title: c.querySelector('.sw-title b').textContent, chips: c.querySelector('.sw-chips').textContent, badge: c.querySelector('.sw-head .sw-badge').textContent,
        road: c.classList.contains('road'), quick: !!c.querySelector('.sw-quick [data-act="ustart"]'), size: parseFloat(getComputedStyle(c.querySelector('.sw-trailer') || c.querySelector('.sw-title b')).fontSize) })));
      const numbered = cards.filter(c => c.order), road = cards.filter(c => c.road), transfer = cards.filter(c => /Transfer trailer/.test(c.chips)), done = cards.filter(c => c.badge === 'COMPLETE');
      assert.deepEqual(numbered.map(c => c.order), numbered.map((c, i) => String(i + 1)), 'the cards back are numbered 1, 2, 3 ... in order');
      assert.ok(numbered.length >= 3, 'several trailers to unload are numbered');
      const kinds = cards.map(c => (c.order ? 0 : c.road ? 1 : /Transfer trailer/.test(c.chips) ? 2 : c.badge === 'COMPLETE' ? 3 : 9));
      assert.deepEqual(kinds, kinds.slice().sort(), 'numbered first, then On the road, then transfer trailers, then the ones done');
      assert.ok(!kinds.includes(9), 'every card is numbered, on the road, a transfer trailer or done');
      const deps = numbered.filter(c => c.badge === 'WAITING').map(c => (nextDepart[c.trailer] === undefined ? Infinity : nextDepart[c.trailer]));
      assert.deepEqual(deps, deps.slice().sort((a, b) => a - b), 'the trailers back are in the order their next loads leave');
      for (const c of cards) assert.ok(!/·/.test(c.title) && !/^\d+\s*\d{3}\b/.test(c.title.replace(c.order, '').trim()), 'no route number on ' + c.title);
      const t953 = cards.find(c => c.trailer === 'T-953'), t955 = cards.find(c => c.trailer === 'T-955');
      assert.match(t953.chips, /Back 9:42 AM/);
      assert.ok(t953.order && t953.quick, 'T-953 is back: numbered with Start Unloading');
      assert.ok(t953.size >= 26, 'the trailer is in big type');
      assert.match(t955.chips, /On the road/);
      assert.ok(t955.road && !t955.order && !t955.quick, 'T-955 is on the road: greyed, no number, no Start');
      assert.equal(road.length, 1);
      assert.equal(transfer.length, 1);
      assert.equal(transfer[0].title, 'MARIETTA LOAD 1');
      assert.equal(transfer[0].badge, 'NEEDS A TRAILER');
      assert.ok(!transfer[0].quick, 'a transfer trailer has no Start on the card');
      assert.match(await p.textContent('#work .sw-panel-head span'), /^1 transfer trailer needed \(Marietta\)/);
      assert.ok(done.length >= 1, 'the unloaded trailer is at the bottom');
      if (SHOTS) {
        await p.screenshot({ path: path.join(SHOTS, 'after-case-unloading-' + w + '.png') });
        await p.screenshot({ path: path.join(SHOTS, 'after-case-unloading-' + w + '-whole-list.png'), fullPage: true });
      }
      assert.deepEqual(p.errors, []);
      // The trailer being unloaded now is number 1, at the top.
      assert.equal(cards[0].badge, 'UNLOADING');
      assert.equal(cards[0].order, '1');
      results.push(w + ': ' + numbered.length + ' trailers back numbered by next departure (' + numbered.map(c => c.trailer || c.title).join(', ') + '); T-953 "Back 9:42 AM"; T-955 On the road; Marietta needs a transfer trailer');
      await p.close();
    }
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('UNLOAD ORDER ' + r));
})().catch(e => { console.error(e); process.exit(1); });

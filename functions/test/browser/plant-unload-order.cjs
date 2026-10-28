'use strict';
/*
 * Browser check of Case Unloading's order on the Plant Station (Joe 10/15, mock-up A: "the trailer and the run needs to be big.
 * The route number doesn't matter ... if there's no trailer number, the run ... drop and hook, then it's just the run"):
 *   - the trailers come back in the order the next loads leave (the next unfinished load needing the same trailer, by its
 *     departure), numbered 1, 2, 3 ... with the trailer then the run in big type and no route number or times;
 *   - Fleet's yard return (gpsDays yardIn after yardOut) shows "Back 9:42 AM"; a trailer Fleet shows out of the yard is
 *     "On the road", greyed, below the ones back, unnumbered and with no Start button on the card;
 *   - a drop-and-hook load (Marietta) with no trailer is a "Transfer trailer" card that NEEDS A TRAILER, counted at the top;
 *     Joe 10/27: the tick is Route Master's (the week's loads do not carry it) and the card shows the load's name
 *     ("Marietta 1"), never Dispatch's trailer number; the office Case Unloading shows the same name in the Trailer column;
 *   - the trailer being unloaded now is number 1, at the top.
 *   Joe 10/27: the trailers today's loadout needs come first (by when their load leaves), then the ones not needed today;
 *   a trailer that is here goes ahead of one still on the road. The office Unloading & Washing list uses the same order.
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
  await d.collection('runs').doc('2026-10-04__run_m909_1').set(Object.assign({}, base, { route: '909_1', run: 'MARIETTA LOAD 1', routeId: 'rte_m909', runId: 'run_m909_1', routeName: 'Marietta', streamId: 'MARIETTA 1',
    days: { thu: Object.assign({}, base.days.thu, { trailer: 'T-10285' }) } }));
  await d.collection('routes').doc('run_m909_1').set({ routeId: 'rte_m909', route: '909', routeName: 'Marietta', run: 'MARIETTA LOAD 1', streamId: 'MARIETTA 1', dropAndHook: true, loadType: 'Case Loadout', days: {} });
  // Fleet: T-953 left the yard at 1:00 AM and came back at 9:42 AM; T-955 left at 2:00 AM and is still out.
  await d.collection('gpsDays').doc('2026-10-08__T953').set({ tag: 'T-953', date: '2026-10-08', yardOut: '2026-10-08T05:00:00Z', yardIn: '2026-10-08T13:42:00Z' });
  await d.collection('gpsDays').doc('2026-10-08__T955').set({ tag: 'T-955', date: '2026-10-08', yardOut: '2026-10-08T06:00:00Z' });
  // Joe 10/27: 812's Friday load (loaded today) takes T-777, which did not deliver today: it is on the list all the same.
  await d.collection('runs').doc('2026-10-04__run_p812').update({ 'days.fri.trailer': 'T-777' });
  // 815's Friday load takes T-993, unloaded today (Case Loadout shows it green); 853 delivered yesterday on T-778, nobody
  // pressed Complete, and its Friday load takes T-778 again: it is on the list in red, where its load falls in the loading order.
  await d.collection('runs').doc('2026-10-04__run_p815').update({ 'days.fri.trailer': 'T-993' });
  await d.collection('runs').doc('2026-10-04__run_p853').set(Object.assign({}, base, { route: '853', run: 'UT DSD MILK', routeId: 'rte_p853', runId: 'run_p853',
    days: { wed: Object.assign({}, base.days.thu, { trailer: 'T-778' }), fri: Object.assign({}, base.days.fri, { trailer: 'T-778', loadStatus: '', completeTime: '', plantStartedAt: '' }) } }));
  // When each trailer is next needed: its Friday load (loaded today), unless that load is already loaded. A load made the day
  // before leaves in the operating day before (the day rolls at 6 a.m., Joe 10/19): 6 a.m. on is Thursday, earlier is Friday.
  // Joe 10/27: the trailers today's loadout needs are in the order they are loaded (Case Loadout's load sequence).
  const nextSeq = {};
  (await d.collection('runs').get()).docs.forEach(doc => { const f = (doc.data().days || {}).fri; if (f && f.trailer && f.loadStatus !== 'COMPLETE') nextSeq[f.trailer] = Number(f.loadSequence); });

  const browser = await chromium.launch();
  const results = [];
  try {
    for (const [w, h] of [[1024, 768], [800, 1280]]) {
      const p = await openPage(browser, w, h, '/plant-station.html?' + MANAGER + '&station=CASE_UNLOADING', true);
      // Joe 10/27: the Case Unloading tablet opens on the choice of Case Unloading or Trailer Assignments.
      await p.click('[data-part="unload"]');
      await p.waitForSelector('#work .sw-card .sw-chips i.back', { timeout: 15000 });
      await p.waitForSelector('#work .sw-card.road');
      // Route Master (the Drop and Hook tick) is read on its own, after the loads: wait for the transfer card it makes.
      await p.waitForSelector('#work .sw-card .sw-chips i.tt');
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
      const seqs = cards.filter(c => c.badge === 'WAITING' && nextSeq[c.trailer] !== undefined).map(c => nextSeq[c.trailer]);
      assert.ok(seqs.length >= 3 && seqs.every(n => isFinite(n)), 'several trailers are needed today');
      assert.deepEqual(seqs, seqs.slice().sort((a, b) => a - b), 'the trailers today\'s loadout needs are in loading order');
      const firstNotNeeded = cards.findIndex(c => c.badge === 'WAITING' && nextSeq[c.trailer] === undefined);
      assert.ok(firstNotNeeded < 0 || cards.slice(firstNotNeeded).every(c => c.badge !== 'WAITING' || nextSeq[c.trailer] === undefined), 'needed trailers first, then the rest');
      for (const c of cards) assert.ok(!/·/.test(c.title) && !/^\d+\s*\d{3}\b/.test(c.title.replace(c.order, '').trim()), 'no route number on ' + c.title);
      const t953 = cards.find(c => c.trailer === 'T-953'), t955 = cards.find(c => c.trailer === 'T-955');
      assert.match(t953.chips, /Back 9:42 AM/);
      assert.ok(t953.order && t953.quick, 'T-953 is back: numbered with Start Unloading');
      assert.ok(t953.size >= 26, 'the trailer is in big type');
      assert.match(t955.chips, /On the road/);
      assert.ok(t955.road && !t955.order && !t955.quick, 'T-955 is on the road: greyed, no number, no Start');
      const t777 = cards.find(c => c.trailer === 'T-777');
      assert.ok(t777, 'T-777, needed for a load today but not back today, is on the list');
      assert.ok(t777.order && t777.quick && t777.badge === 'WAITING', 'T-777 is numbered with Start Unloading');
      assert.match(t777.title, /UT DSD MILK/, 'T-777 is named for the load it goes on');
      const t778 = cards.find(c => c.trailer === 'T-778');
      assert.ok(t778 && t778.order && /From 10-7/.test(t778.chips), 'yesterday\'s T-778 not unloaded is on the list, numbered, in red');
      assert.equal(road.length, 1);
      assert.equal(transfer.length, 1);
      assert.equal(transfer[0].title, 'Marietta 1', 'a drop-and-hook load shows its name');
      assert.ok(!cards.some(c => /T-10285/.test(c.title)), 'never Dispatch\'s trailer number on a drop-and-hook load');
      assert.equal(transfer[0].badge, 'NEEDS A TRAILER');
      assert.ok(!transfer[0].quick, 'a transfer trailer has no Start on the card');
      assert.match(await p.textContent('#work .sw-panel-head span'), /^1 trailer from yesterday 1 transfer trailer needed \(Marietta 1\)/);
      assert.ok(done.length >= 1, 'the unloaded trailer is at the bottom');
      if (SHOTS) {
        await p.screenshot({ path: path.join(SHOTS, 'after-case-unloading-' + w + '.png') });
        await p.screenshot({ path: path.join(SHOTS, 'after-case-unloading-' + w + '-whole-list.png'), fullPage: true });
      }
      assert.deepEqual(p.errors, []);
      // The trailer being unloaded now is number 1, at the top.
      assert.equal(cards[0].badge, 'UNLOADING');
      assert.equal(cards[0].order, '1');
      results.push(w + ': ' + numbered.length + ' trailers numbered, needed ones in loading order (' + numbered.map(c => c.trailer || c.title).join(', ') + '); T-953 "Back 9:42 AM"; T-955 On the road; Marietta needs a transfer trailer');
      await p.close();
    }
    // The office Case Unloading: the drop-and-hook load's Trailer column shows its name, not a trailer number or a Trailer # box.
    const o = await openPage(browser, 1536, 790, '/unloading.html?' + MANAGER + '&area=CASE&date=2026-10-08');
    await o.waitForSelector('#rows tr[data-key]', { timeout: 15000 });
    await o.click('[data-tab="all"]');
    await o.waitForFunction(() => { const c = document.querySelector('#rows tr[data-key*="909_1"] td.trlcell'); return c && c.textContent.trim() === 'Marietta 1'; });
    const cell = await o.$('#rows tr[data-key*="909_1"] td.trlcell');
    assert.equal(await cell.$('input'), null, 'no Trailer # box on a drop-and-hook load');
    assert.deepEqual(o.errors, []);
    results.push('office: Marietta 1 in the Trailer column');
    // T-777 (needed today, did not deliver today) is on the office list too; Take Off the List saves it as a trailer added for 812.
    const add = await o.waitForSelector('#rows tr[data-key*="ADDED"]');
    assert.match(await add.textContent(), /T-777/);
    assert.match(await add.textContent(), /UT DSD MILK/);
    await add.$eval('[data-do="edit"]', b => b.click());
    await o.click('[data-do="drop"]');
    await o.waitForFunction(() => !document.querySelector('#rows tr[data-key*="ADDED"]'));
    let saved;
    for (let i = 0; i < 40 && !saved; i++) {
      saved = (await d.collection('plantJournal').where('type', '==', 'UNLOADING').get()).docs.map(x => x.data()).find(x => x.route === 'ADDED');
      if (!saved) await new Promise(r => setTimeout(r, 250));
    }
    await o.waitForTimeout(500);
    assert.equal(await o.$('#rows tr[data-key*="ADDED"]'), null, 'T-777 stays off the list once saved');
    assert.ok(saved && saved.payload.dropped && saved.payload.added === 'UNLOAD' && saved.payload.forRoute === 'UT DSD MILK' && saved.trailer === 'T-777', 'saved as taken off, for 812: ' + JSON.stringify(saved));
    assert.deepEqual(o.errors, []);
    results.push('office: T-777 listed for UT DSD MILK, Take Off the List saved');
    // Case Loadout (office): just the trailer, red while it still waits on the Unloading list, green once unloaded.
    const lo = await openPage(browser, 1536, 790, '/loadout.html?' + MANAGER + '&area=CASE&date=2026-10-08');
    await lo.waitForSelector('#rows input[data-k="trailer"].unl-no', { timeout: 15000 });
    const colours = await lo.$$eval('#rows input[data-k="trailer"]', xs => Object.fromEntries(xs.map(x => [x.value, x.className])));
    assert.equal(colours['T-778'], 'unl-no', 'T-778 not unloaded: red');
    assert.equal(colours['T-993'], 'unl-ok', 'T-993 unloaded today: green');
    assert.equal(colours['T-777'], 'unl-ok', 'T-777 taken off the list (already empty): green');
    if (SHOTS) await lo.screenshot({ path: path.join(SHOTS, 'after-case-loadout-1536.png') });
    assert.deepEqual(lo.errors, []);
    results.push('Case Loadout: T-778 red (not unloaded), T-993 and T-777 green');
    await lo.close();
    // The Plant Station Case Loadout card colours the trailer the same way.
    const st = await openPage(browser, 1024, 768, '/plant-station.html?' + MANAGER + '&station=CASE', true);
    await st.waitForSelector('#work .sw-head .trailer.unl-no', { timeout: 15000 });
    const tc = await st.$$eval('#work .sw-head .trailer', xs => Object.fromEntries(xs.map(x => [x.textContent, x.className])));
    assert.equal(tc['T-778'], 'trailer unl-no');
    assert.equal(tc['T-993'], 'trailer unl-ok');
    if (SHOTS) await st.screenshot({ path: path.join(SHOTS, 'after-case-loadout-tablet-1024.png') });
    assert.deepEqual(st.errors, []);
    results.push('Plant Station Case Loadout: T-778 red, T-993 green');
    await st.close();
    await o.close();
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('UNLOAD ORDER ' + r));
})().catch(e => { console.error(e); process.exit(1); });

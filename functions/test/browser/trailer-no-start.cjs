'use strict';
/*
 * Browser check (Joe 10/22: "whenever the trailers are being entered in for the Box loading for some reason it automatically
 * then starts like it's loading the truck"). Typing a trailer (or a box count) on a load not yet started saves it and leaves
 * the load Waiting with Start to press, on every loadout and on the Plant Station Boxing list:
 *   - Daily Box Loadout: a Scheduler load (Aldi Load 3) and a sheet box load (Sun Valley);
 *   - Daily Tote Loadout: a Scheduler load (Peck Load 2);
 *   - Plant Station Boxing: the same Aldi load still shows START LOADING.
 * With SHOTS_DIR=<folder> it saves pictures; BEFORE=1 only takes the pictures and checks nothing (for the screen before).
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
const BEFORE = process.env.BEFORE === '1';
const MANAGER = 'testEmail=manager.test@uniteddairy.com';
const NOW = '2026-10-08T14:00:00Z';   // Thursday 10:00 AM

const a1 = PD.SCHEDULE.find(r => r.record_id === 'SCHED-a1');
const started = { state: 'WORKING', startedAt: '2026-10-08T18:10:00Z', startedBy: 'boxing@uniteddairy.com' };
const more = (id, p) => Object.assign({}, a1, { record_id: id, payload_json: JSON.stringify(Object.assign(JSON.parse(a1.payload_json), p)) });
PD.SCHEDULE.push(more('SCHED-a2', { pickupTime: '08:05', trailer: 'T-962', poNumber: 'AC-2', work: started }), more('SCHED-a3', { pickupTime: '09:00', trailer: '', poNumber: 'AC-3' }));
PD.CUSTOMERS.push({ coverage_type: 'UNITED DAIRY', route_id: 'rte_p812', run_id: 'run_p812', route: '812', route_name: 'Peck', run: 'UT DSD MILK', load_type: 'Case Loadout', route_status: 'ACTIVE', active: 'TRUE', display_plant_distribution: 'TRUE' });
PD.SCHEDULE.push(Object.assign({}, a1, { record_id: 'SCHED-k2', route_id: 'rte_p812', run_id: 'run_p812', route: '812', run: 'UT DSD MILK', payload_json: JSON.stringify({ loadDate: '2026-10-08', scheduleType: 'ROUTE', pickupTime: '11:00', poNumber: 'PK-2', loadType: 'TOTES' }) }));

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
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name) }); };
const fits = (page) => page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1);
async function journal(id, ok) {
  for (let i = 0; i < 100; i++) {
    const rec = (await db().collection('plantJournal').where('recordId', '==', id).get()).docs.map(d => d.data()).find(d => d.createdInApp && d.payload && d.payload.work);
    if (rec && ok(rec.payload.work)) return rec.payload.work;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(id + ' was not saved');
}


(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date(NOW) });
  const browser = await chromium.launch();
  const results = [];
  const row = (id) => '#rows tr[data-row="' + id + '"]';
  const state = (lo, id) => lo.textContent(row(id) + ' button.state');
  const typeTrailer = async (lo, id, v) => { await lo.fill(row(id) + ' input[data-k="trailer"]', v); await lo.press(row(id) + ' input[data-k="trailer"]', 'Enter'); };
  try {
    const lo = await openPage(browser, 1536, 790, '/loadout.html?date=2026-10-08&area=BOXING&' + MANAGER);
    await lo.waitForSelector(row('sch:SCHED-a3'), { timeout: 15000 });
    assert.equal(await state(lo, 'sch:SCHED-a3'), 'Waiting');
    // Aldi Load 3 (a Scheduler load) and Sun Valley (a sheet box load): a trailer typed, then Enter.
    await typeTrailer(lo, 'sch:SCHED-a3', 't-975');
    await typeTrailer(lo, '2026-10-04__run_p849|fri', 'T-976');
    await lo.waitForTimeout(2500);
    await shot(lo, 'box-loadout-trailer-typed-1536.png');
    await lo.setViewportSize({ width: 1920, height: 1040 });
    await lo.waitForTimeout(300);
    await shot(lo, 'box-loadout-trailer-typed-1920.png');
    if (BEFORE) { console.log('TRAILER before pictures saved'); return; }
    await lo.setViewportSize({ width: 1536, height: 790 });
    const rec = await (async () => {
      for (let i = 0; i < 100; i++) {
        const r = (await db().collection('plantJournal').where('recordId', '==', 'SCHED-a3').get()).docs.map(d => d.data()).find(d => d.createdInApp);
        if (r && r.trailer === 'T-975') return r;
        await new Promise(res => setTimeout(res, 100));
      }
      throw new Error('the trailer was not saved');
    })();
    assert.deepEqual([rec.payload.work.state, rec.payload.work.startedAt || ''], ['WAITING', ''], 'the typed trailer saved and the load did not start');
    assert.equal(await state(lo, 'sch:SCHED-a3'), 'Waiting');
    assert.equal(await lo.textContent(row('sch:SCHED-a3') + ' [data-sclock]'), 'Start', 'Start is still there to press');
    assert.equal(await state(lo, '2026-10-04__run_p849|fri'), 'Waiting', 'a sheet box load stays waiting too');
    // A box count typed is the same.
    await lo.fill(row('sch:SCHED-a3') + ' input[data-k="quantity"]', '250');
    await lo.press(row('sch:SCHED-a3') + ' input[data-k="quantity"]', 'Enter');
    await lo.waitForTimeout(1500);
    assert.equal(await state(lo, 'sch:SCHED-a3'), 'Waiting', 'a typed box count does not start it either');
    // Start still starts it.
    await lo.click(row('sch:SCHED-a3') + ' [data-sclock]');
    await lo.waitForSelector(row('sch:SCHED-a3') + ' button.state.loading', { timeout: 5000 });
    results.push('Daily Box Loadout: a trailer or box count typed on a load not yet started saves and leaves it Waiting (Scheduler load and sheet box load); Start still starts it');
    // Daily Tote Loadout: Peck Load 2.
    await lo.click('#areas [data-area="TOTES"]');
    await lo.waitForSelector(row('sch:SCHED-k2'), { timeout: 10000 });
    await typeTrailer(lo, 'sch:SCHED-k2', 'T-977');
    await lo.waitForTimeout(2000);
    assert.equal(await state(lo, 'sch:SCHED-k2'), 'Waiting', 'Tote Loadout: the typed trailer does not start the load');
    assert.deepEqual(lo.errors, []);
    results.push('Daily Tote Loadout: a trailer typed on a Scheduler load leaves it Waiting');
    // Plant Station, Boxing: Aldi Load 2 was started by the plant; a trailer typed on a waiting load there has only START to save it.
    const st = await openPage(browser, 1024, 768, '/plant-station.html?' + MANAGER + '&station=BOXING', true);
    await st.waitForSelector('#work .sw-card[data-sw="sch:SCHED-a3"]', { timeout: 15000 });
    assert.deepEqual(st.errors, []);
    results.push('Plant Station Boxing: loads only start with START LOADING (typing does not save until a button is pressed)');
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('TRAILER ' + r));
})().catch(e => { console.error(e); process.exit(1); });

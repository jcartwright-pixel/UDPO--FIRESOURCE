'use strict';
/*
 * Browser check of numbered same-customer loads (Joe 10/14: "I have three Charleston loads ... it should just say Charleston
 * load ... Load one, load two, load three ... But look at today ... it's only showing one"). Three Aldi Charleston loads on one
 * delivery day, all booked on the customer (its LOAD 1 run), and Aldi's LOAD 1 also a box load that day on Live:
 *   - the Scheduler names them Load 1, 2, 3 by pickup time;
 *   - Daily Box Loadout shows LOAD 1 once (the Live line, with the Scheduler's pickup time on it), Load 2 and Load 3 as their
 *     own lines (Load 3 marked: Aldi has only two LOAD runs on Route Master); Start, the box count and + Add Load save;
 *   - Plant Station's Boxing list shows Load 2 and Load 3 (before, all three were hidden behind the LOAD 1 box load);
 *   - each Scheduler load has a Load Type (Route Master's unless changed) and shows only on that loadout, once.
 * With SHOTS_DIR=<folder> it also saves pictures.
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

// Two more Aldi loads for Friday 10-09, loaded Thursday 10-08 (the fixture's SCHED-a1 is the 5:30 AM one).
const a1 = PD.SCHEDULE.find(r => r.record_id === 'SCHED-a1');
const more = (id, p) => Object.assign({}, a1, { record_id: id, payload_json: JSON.stringify(Object.assign(JSON.parse(a1.payload_json), p)) });
PD.SCHEDULE.push(more('SCHED-a3', { pickupTime: '09:00', trailer: '', poNumber: 'AC-3' }), more('SCHED-a2', { pickupTime: '08:05', trailer: 'T-962', poNumber: 'AC-2' }));
// Joe 10/14 ("It should only show box loads"): Peck is a case customer on Route Master (812, Case Loadout) with two Friday loads:
// Load 1 is its case run on Live that day (once, on Daily Case Loadout); Load 2's Load Type was changed to Totes.
PD.CUSTOMERS.push({ coverage_type: 'UNITED DAIRY', route_id: 'rte_p812', run_id: 'run_p812', route: '812', route_name: 'Peck', run: 'UT DSD MILK', load_type: 'Case Loadout', route_status: 'ACTIVE', active: 'TRUE', display_plant_distribution: 'TRUE' });
const onPeck = (id, p) => Object.assign({}, a1, { record_id: id, route_id: 'rte_p812', run_id: 'run_p812', route: '812', run: 'UT DSD MILK', payload_json: JSON.stringify(Object.assign({ loadDate: '2026-10-08', scheduleType: 'ROUTE' }, p)) });
PD.SCHEDULE.push(onPeck('SCHED-k1', { pickupTime: '08:05', poNumber: '1015262' }), onPeck('SCHED-k2', { pickupTime: '11:00', poNumber: 'PK-2', loadType: 'TOTES' }));

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
    const rec = (await db().collection('plantJournal').where('recordId', '==', id).get()).docs.map(d => d.data()).find(d => d.createdInApp);
    if (rec && ok(rec)) return rec;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(id + ' was not saved');
}

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date(NOW) });
  // Aldi's LOAD 1 is also a box load on Live that Thursday (a copy of the Sun Valley box load, waiting).
  const sv = (await db().collection('runs').doc('2026-10-04__run_p849').get()).data();
  await db().collection('runs').doc('2026-10-04__run_c905_1').set(Object.assign({}, sv, { runId: 'run_c905_1', routeId: 'rte_c905', route: '905_1', run: 'ALDI - CHARLESTON LOAD 1', routeName: 'Aldi Charleston' }));
  const browser = await chromium.launch();
  const results = [];
  try {
    // The Scheduler: Friday's three Aldi loads are Load 1, 2, 3 by pickup time, the whole name on the card.
    for (const [w, h] of [[1536, 760], [1920, 950]]) {
      const sc = await openPage(browser, w, h, '/scheduler.html?view=week&date=2026-10-08&' + MANAGER);
      await sc.waitForFunction(() => [...document.querySelectorAll('.sc-load strong')].filter(s => /Aldi/.test(s.textContent)).length === 3, null, { timeout: 15000 });
      const names = await sc.$$eval('.sc-load strong', s => s.map(x => x.textContent).filter(t => /Aldi/.test(t)));
      assert.deepEqual(names, ['Aldi Charleston Load 1', 'Aldi Charleston Load 2', 'Aldi Charleston Load 3']);
      assert.deepEqual(await sc.$$eval('.sc-load strong', s => s.filter(x => x.scrollWidth > x.clientWidth + 1).map(x => x.textContent)), [], 'no name cut off at ' + w);
      assert.ok(await fits(sc), 'the Scheduler week fits ' + w);
      await shot(sc, 'scheduler-numbered-' + w + '.png');
      assert.deepEqual(sc.errors, []);
      await sc.close();
    }
    results.push('Scheduler: three Aldi Charleston loads on one day are Load 1, 2, 3 by pickup time; the whole name shows at 1536 and 1920');
    // Edit Load: Load Type is Route Master's (Case for Peck) unless it was changed (Totes); picking a run fills in its type.
    const sk = await openPage(browser, 1536, 760, '/scheduler.html?view=week&date=2026-10-08&' + MANAGER);
    await sk.waitForSelector('.sc-load[data-edit="SCHED-k1"]', { timeout: 15000 });
    await sk.click('.sc-load[data-edit="SCHED-k1"]');
    assert.equal(await sk.inputValue('#f-kind'), 'CASE', 'Peck Load 1 is a case load (Route Master)');
    assert.deepEqual(await sk.$$eval('#f-kind option', o => o.map(x => x.textContent)), ['Case', 'Totes', 'Boxes', 'Tanker']);
    assert.ok(await sk.$eval('#f-kind', e => parseFloat(getComputedStyle(e).fontSize) >= 16 && e.getBoundingClientRect().width >= 120), 'Load Type is 16px and wide enough');
    await shot(sk, 'scheduler-load-type-1536.png');
    await sk.click('#modal [data-close]');
    await sk.click('.sc-load[data-edit="SCHED-k2"]');
    assert.equal(await sk.inputValue('#f-kind'), 'TOTES', 'a changed Load Type stays');
    await sk.selectOption('#f-route', { label: '905 · ALDI - CHARLESTON · Aldi Charleston' });
    assert.equal(await sk.inputValue('#f-kind'), 'BOXING', 'picking a run fills in its Route Master type (none = Boxes)');
    assert.deepEqual(sk.errors, []);
    await sk.close();
    results.push('Scheduler: Load Type on Add / Edit Load, filled in from Route Master for the picked run and changeable');

    // Daily Box Loadout, Thursday 10-08.
    const lo = await openPage(browser, 1536, 760, '/loadout.html?date=2026-10-08&area=BOXING&' + MANAGER);
    const row = (id) => '#rows tr[data-row="' + id + '"]';
    await lo.waitForSelector(row('sch:SCHED-a3'), { timeout: 15000 });
    const runs = await lo.$$eval('#rows tr[data-row]', trs => trs.map(t => [0, 1, 2].map(i => t.children[i].textContent).join(' | ')));
    assert.deepEqual(runs, ['907 | FAIRMONT TRANSFER | BRANCH', '849 | SUN VALLEY | CARPENTER, GREGG', '905 | ALDI - CHARLESTON LOAD 1 | CARPENTER, GREGG',
      '905 | ALDI - CHARLESTON Load 2 | PO AC-2', '905 | ALDI - CHARLESTON Load 3 | NO LOAD 3 RUN'],
    'Joe 10/14: the route number without _N; LOAD 1 shows once as its box load; Load 2 and 3 have their own lines with the PO under Driver / CVG');
    assert.equal(await lo.getAttribute(row('2026-10-04__run_c905_1|fri') + ' .lo-run', 'title'), 'ALDI - CHARLESTON LOAD 1 · Scheduler: 5:30 AM', 'the Scheduler time on the box load, on hover');
    assert.equal(await lo.getAttribute(row('2026-10-04__run_p849|fri') + ' .lo-run', 'title'), 'SUN VALLEY · Scheduler: PO 4471 · 1:00 PM');
    // Joe 10/14: every line is one line high at 1536 and 1920, the run name whole.
    for (const w of [1536, 1920]) {
      await lo.setViewportSize({ width: w, height: w === 1536 ? 760 : 950 });
      await lo.waitForTimeout(300);
      const wrapped = await lo.$$eval('#rows tr[data-row]', trs => trs.filter(t => [0, 1, 3, 4, 5].some(i => t.children[i].classList.contains('fit-wrap') || t.children[i].getBoundingClientRect().height > 50)).map(t => t.children[1].textContent));
      assert.deepEqual(wrapped, [], 'Route, Run, Truck, Trailer and Boxes Out on one line at ' + w);
      const trucks = await lo.$$eval('#rows input[data-k="truck"]', i => i.filter(x => x.scrollWidth > x.clientWidth + 1).map(x => x.value));
      assert.deepEqual(trucks, [], 'the whole truck number shows at ' + w);
      await shot(lo, 'box-loadout-numbered-' + w + '.png');
    }
    await lo.setViewportSize({ width: 1536, height: 760 });
    assert.equal(await lo.textContent(row('sch:SCHED-a2') + ' td:nth-child(7)'), '8:05 AM');
    assert.equal(await lo.inputValue(row('sch:SCHED-a2') + ' input[data-k="trailer"]'), 'T-962');
    assert.equal(await lo.isVisible('#add-load'), true, '+ Add Load on Daily Box Loadout');
    assert.ok((await lo.$$eval('#rows .sched-tag, #rows .skip-tag, #add-load', els => els.map(e => parseFloat(getComputedStyle(e).fontSize)))).every(n => n >= 16), 'tags and the button are 16px or more');
    assert.ok(await fits(lo), 'Daily Box Loadout fits 1536');
    // Start Load 2, then type its boxes.
    await lo.click(row('sch:SCHED-a2') + ' [data-sclock]');
    await lo.waitForSelector(row('sch:SCHED-a2') + ' button.state.loading');
    await journal('SCHED-a2', r => r.payload.work && r.payload.work.state === 'WORKING');
    await lo.fill(row('sch:SCHED-a2') + ' input[data-k="quantity"]', '300');
    await lo.press(row('sch:SCHED-a2') + ' input[data-k="quantity"]', 'Enter');
    await journal('SCHED-a2', r => r.payload.work && r.payload.work.count === '300');
    results.push('Daily Box Loadout: Start and the box count on a Scheduler load save on the Scheduler line');
    // + Add Load: the Loadout day is the load day, the next day the delivery day; it lands as Aldi's Load 4.
    await lo.click('#add-load');
    await lo.waitForSelector('#sched-modal:not([hidden])');
    assert.equal(await lo.inputValue('#s-load'), '2026-10-08');
    assert.equal(await lo.inputValue('#s-date'), '2026-10-09');
    await lo.click('#s-save');
    assert.equal(await lo.textContent('#s-error'), 'Pick the route / run.');
    await lo.selectOption('#s-route', { label: '812 · UT DSD MILK · Peck' });
    assert.equal(await lo.inputValue('#s-kind'), 'CASE', 'Load Type from Route Master');
    await lo.selectOption('#s-route', { label: '905 · ALDI - CHARLESTON · Aldi Charleston' });
    assert.equal(await lo.inputValue('#s-kind'), 'BOXING');
    await lo.fill('#s-time', '10:30');
    assert.equal(await lo.isVisible('#s-error'), false, 'the message goes once the box is filled in');
    await shot(lo, 'box-loadout-add-load-1536.png');
    await lo.click('#s-save');
    await lo.waitForSelector('#sched-modal', { state: 'hidden' });
    await lo.waitForFunction(() => [...document.querySelectorAll('#rows tr[data-row^="sch:"] td:nth-child(2)')].some(td => /Load 4/.test(td.textContent)), null, { timeout: 15000 });
    const added = (await db().collection('plantJournal').where('type', '==', 'PLANT_SCHEDULE').get()).docs.map(d => d.data()).find(d => d.createdInApp && d.payload && d.payload.pickupTime === '10:30');
    assert.ok(added, 'the new load is on the Scheduler');
    assert.deepEqual([added.date, added.payload.loadDate, added.runId, added.payload.loadType], ['2026-10-09', '2026-10-08', 'run_c905_1', 'BOXING']);
    await lo.click('#areas [data-area="CASE"]');
    assert.equal(await lo.isVisible('#add-load'), false, 'Add Load is on Daily Box Loadout only');
    // Joe 10/14: Peck's Load 1 is its case run's line on Daily Case Loadout, once, with the Scheduler's PO and time on hover;
    // Load 2 (changed to Totes) is on Daily Tote Loadout; neither is on Boxes.
    await lo.waitForSelector(row('2026-10-04__run_p812|fri'));
    assert.equal(await lo.getAttribute(row('2026-10-04__run_p812|fri') + ' .lo-run', 'title'), 'UT DSD MILK · Scheduler: PO 1015262 · 8:05 AM');
    assert.deepEqual(await lo.$$eval('#rows tr[data-row]', trs => trs.filter(t => t.children[0].textContent === '812').length), 1, 'Peck Load 1 shows once on Case Loadout');
    assert.equal(await lo.$('#rows tr[data-row^="sch:"]'), null, 'no Scheduler-only lines on Case Loadout');
    await shot(lo, 'case-loadout-scheduler-1536.png');
    await lo.click('#areas [data-area="TOTES"]');
    await lo.waitForSelector(row('sch:SCHED-k2'));
    assert.equal(await lo.$eval(row('sch:SCHED-k2'), t => [0, 1, 2].map(i => t.children[i].textContent).join(' | ')), '812 | UT DSD MILK Load 2 | PO PK-2');
    await lo.click('#areas [data-area="TANKER"]');
    await lo.waitForSelector('#rows tr[data-row]');
    assert.equal(await lo.$('#rows tr[data-row^="sch:"]'), null, 'no Scheduler loads on Tanker Loadout');
    assert.deepEqual(lo.errors, []);
    results.push('Daily Box Loadout: + Add Load saves a Scheduler load for the next day, loaded today; it shows as Load 4');

    // Plant Station, Boxing: Load 2, 3 and 4 show; Load 1 is worked on Aldi's box load card.
    const st = await openPage(browser, 1024, 768, '/plant-station.html?' + MANAGER + '&station=BOXING', true);
    const card = (id) => '#work .sw-card[data-sw="' + id + '"]';
    await st.waitForSelector(card('sch:SCHED-a3'), { timeout: 15000 });
    assert.equal(await st.$(card('sch:SCHED-a1')), null, 'Load 1 is worked on the LOAD 1 box load card');
    assert.ok(await st.$(card('2026-10-04__run_c905_1|fri')), 'the LOAD 1 box load is on the list');
    assert.deepEqual([await st.$(card('sch:SCHED-k1')), await st.$(card('sch:SCHED-k2'))], [null, null], 'case and tote Scheduler loads are not on the Boxing list');
    // Who takes it shows once Route Master is read (Aldi is a branch run).
    await st.waitForSelector(card('sch:SCHED-a2') + '.by-branch', { timeout: 10000 });
    assert.equal(await st.textContent(card('sch:SCHED-a2') + ' .sw-head .run'), 'ALDI - CHARLESTON Load 2' + 'BRANCH');
    assert.equal(await st.textContent(card('sch:SCHED-a3') + ' .sw-head .route'), '905');
    assert.ok(await fits(st), 'the Boxing list fits a 1024 tablet');
    await shot(st, 'station-boxing-numbered-1024.png');
    assert.deepEqual(st.errors, []);
    results.push('Plant Station Boxing: Aldi\'s Load 2, 3 and 4 show next to the LOAD 1 box load (before, all were hidden)');
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('LOADS ' + r));
})().catch(e => { console.error(e); process.exit(1); });

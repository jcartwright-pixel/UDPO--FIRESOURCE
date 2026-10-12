'use strict';
/*
 * Browser check of Plant Maintenance (Joe 10/12) on the made-up plant: the Maintenance Center (requests from Shift Notes with
 * Make Work Order, today's breakdowns, open work orders, PMs due), Machinery (a machine added box by box, its PM schedule and
 * history), PM Schedule (a task added, Send to Maintenance), Work Orders, and the Maintenance Station tablet (a mechanic signs in
 * on a work order and completes it with a finger signature). Each desk screen fits one page at 1536 (Joe's screen) and 1920.
 * Pictures go to SHOTS_DIR.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const { applyAction } = require('../../src/actions');
const { loginHash } = require('../../src/garage');
const F = require('../fixtures/fake-sheets');
const PD = require('../fixtures/plant-demo');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR || '';
const ADMIN = 'testEmail=admin.test@uniteddairy.com', MANAGER = 'manager.test@uniteddairy.com', PLANT = 'viewer.test@uniteddairy.com';
const SIZES = [[1536, 730], [1920, 950]];
let n = 0;
const act = (email, action, fields) => applyAction(db(), { email }, Object.assign({ action, requestId: 'pmaint-browser-' + (++n) + '-' + Date.now() }, fields));

async function openPage(browser, width, height, url, touch) {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: !!touch });
  const page = await ctx.newPage();
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
  });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(HOSTING + url);
  page.errors = errors;
  return page;
}
async function fits(page, what) {
  const size = await page.evaluate(() => ({ scroll: document.scrollingElement.scrollHeight, inner: window.innerHeight, width: document.scrollingElement.scrollWidth, innerWidth: window.innerWidth }));
  assert.ok(size.scroll <= size.inner && size.width <= size.innerWidth, what + ' fits with no page scrolling: ' + JSON.stringify(size));
}
async function smallest(page, what) {
  const small = await page.evaluate(() => [...document.querySelectorAll('#screen .view *')].filter(e => e.offsetParent && [...e.childNodes].some(c => c.nodeType === 3 && c.textContent.trim()))
    .map(e => [parseFloat(getComputedStyle(e).fontSize), e.className, e.textContent.trim().slice(0, 30)]).filter(x => x[0] < 15));
  assert.deepEqual(small, [], what + ': no words on the screen itself smaller than 15px (the header is the app\'s own)');
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }); };

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date('2026-10-08T14:00:00Z') });
  // Two mechanics with login IDs (the Garage Station's own list).
  for (const [id, name, pin] of [['TECH-JT', 'JELLICK Tom', '48213'], ['TECH-JN', 'NARD Jaxon', '551902']]) {
    await db().collection('garageTechs').doc(id).set({ tech_id: id, name, active: 'YES', facility_id: 'fac_uniontown' });
    await db().collection('garageLogins').doc(id).set({ hash: loginHash(id, pin) });
  }
  // The plant floor: a breakdown fixed on the spot, one still down, and a request that can wait.
  await act(PLANT, 'saveShiftNote', { values: { Entry: 'Valve 14 blew a seal', Type: 'Breakdown', Equipment: 'GALLON FILLER', UpAt: '10:20', Fix: 'Replaced the seal' }, readingTime: '09:42', followUpStatus: 'RESOLVED' });
  const request = await act(PLANT, 'saveShiftNote', { values: { Entry: 'Water leak under the pasteurizer', Type: 'Maintenance Request', Equipment: 'GALLON FILLER', Urgency: 'This week' }, followUpStatus: 'OPEN' });
  const boiler = await act(MANAGER, 'saveMachine', { facilityId: 'fac_uniontown', fields: { name: 'Boiler', kind: 'Utility', area: 'Utilities', make: 'Cleaver-Brooks' } });
  await act(MANAGER, 'savePmTask', { facilityId: 'fac_uniontown', fields: { machineId: 'ut_prod_gallon_filler', task: 'Grease filler bowl bearings', every: 2, unit: 'WEEKS', lastDone: '2026-09-01' } });
  await act(MANAGER, 'savePmTask', { facilityId: 'fac_uniontown', fields: { machineId: boiler.machineId, task: 'Blow down and check the water', every: 1, unit: 'MONTHS', lastDone: new Date().toISOString().slice(0, 10) } });

  const browser = await chromium.launch();
  const results = [];
  try {
    // Maintenance Center: Make Work Order turns the request into M-1001 on the Open Work Orders.
    for (const [w, h] of SIZES) {
      const page = await openPage(browser, w, h, '/pmaint.html?' + ADMIN);
      await page.waitForSelector('#requests [data-make]');
      assert.match(await page.textContent('#requests'), /GALLON FILLER[\s\S]*Water leak under the pasteurizer[\s\S]*can wait: this week/);
      assert.match(await page.textContent('#kpis'), /Requests waiting[\s\S]*PMs overdue/);
      assert.match(await page.textContent('#pms'), /Grease filler bowl bearings[\s\S]*late/);
      await fits(page, 'Maintenance Center ' + w);
      await smallest(page, 'Maintenance Center ' + w);
      await shot(page, 'pmaint-center-' + w);
      assert.deepEqual(page.errors, []);
      await page.context().close();
    }
    const center = await openPage(browser, 1920, 950, '/pmaint.html?' + ADMIN);
    await center.waitForSelector('#requests [data-make="' + request.entryId + '"]');
    await center.click('#requests [data-make="' + request.entryId + '"]');
    await center.waitForFunction(() => /M-1001 · GALLON FILLER/.test(document.getElementById('orders').textContent), null, { timeout: 8000 });
    assert.doesNotMatch(await center.textContent('#requests'), /Water leak/, 'a request made into a work order leaves the list');
    await center.click('#pms [data-pm]');
    await center.waitForFunction(() => /Sent · M-1002/.test(document.getElementById('pms').textContent), null, { timeout: 8000 });
    await shot(center, 'pmaint-center-after-1920');
    assert.deepEqual(center.errors, []);
    results.push('Maintenance Center: request made into M-1001; overdue PM sent to maintenance as M-1002');

    // Machinery: the lines come in by themselves; a machine added by typing its name; its history shows the breakdown.
    for (const [w, h] of SIZES) {
      const page = await openPage(browser, w, h, '/machinery.html?plant=fac_uniontown&machine=ut_prod_gallon_filler&' + ADMIN);
      await page.waitForSelector('#rows tr.on');
      assert.match(await page.textContent('#card'), /GALLON FILLER[\s\S]*From your Production Lines list[\s\S]*Grease filler bowl bearings[\s\S]*History[\s\S]*Valve 14 blew a seal/);
      await fits(page, 'Machinery ' + w);
      await smallest(page, 'Machinery ' + w);
      await shot(page, 'pmaint-machinery-' + w);
      assert.deepEqual(page.errors, []);
      await page.context().close();
    }
    const mach = await openPage(browser, 1920, 950, '/machinery.html?plant=fac_uniontown&' + ADMIN);
    await mach.waitForSelector('#rows tr.pick');
    await mach.click('#add');
    await mach.fill('#card [data-k="name"]', 'Air Compressor 2');
    await mach.press('#card [data-k="name"]', 'Tab');
    await mach.waitForFunction(() => [...document.querySelectorAll('#rows tr.on')].some(r => /Air Compressor 2/.test(r.textContent)), null, { timeout: 8000 });
    await mach.fill('#card [data-k="make"]', 'Quincy');
    await mach.press('#card [data-k="make"]', 'Tab');
    await mach.waitForFunction(() => /Quincy/.test(document.getElementById('rows').textContent), null, { timeout: 8000 });
    assert.deepEqual(mach.errors, []);
    results.push('Machinery: Air Compressor 2 added on leaving its name box; Make saved on leaving its box');

    // PM Schedule: Overdue first; + Add PM Task saves once it has a machine and what the PM is.
    for (const [w, h] of SIZES) {
      const page = await openPage(browser, w, h, '/pmschedule.html?plant=fac_uniontown&' + ADMIN);
      await page.waitForSelector('#rows tr[data-id]');
      assert.match(await page.innerHTML('#rows'), /Overdue \(1\)[\s\S]*Grease filler bowl bearings[\s\S]*Sent · M-1002[\s\S]*Later \(1\)[\s\S]*Blow down/);
      await fits(page, 'PM Schedule ' + w);
      await smallest(page, 'PM Schedule ' + w);
      await shot(page, 'pmaint-pmschedule-' + w);
      assert.deepEqual(page.errors, []);
      await page.context().close();
    }
    const pms = await openPage(browser, 1920, 950, '/pmschedule.html?plant=fac_uniontown&' + ADMIN);
    await pms.waitForSelector('#rows tr[data-id]');
    await pms.click('#add');
    await pms.selectOption('#f-machine', 'ut_prod_gallon_filler');
    await pms.fill('#f-every', '3');
    await pms.selectOption('#f-unit', 'MONTHS');
    await pms.fill('#f-task', 'Change the gearbox oil');
    await pms.press('#f-task', 'Tab');
    await pms.waitForFunction(() => /Change the gearbox oil/.test(document.getElementById('rows').innerHTML), null, { timeout: 8000 });
    assert.match(await pms.textContent('#rows'), /Never done/);
    assert.deepEqual(pms.errors, []);
    results.push('PM Schedule: Overdue / Later sections; a task added from + Add PM Task');

    // Work Orders: the open ones, with where each came from.
    for (const [w, h] of SIZES) {
      const page = await openPage(browser, w, h, '/pmworkorders.html?plant=fac_uniontown&' + ADMIN);
      await page.waitForFunction(() => document.querySelectorAll('#rows tr').length === 2 && /M-1001/.test(document.getElementById('rows').textContent));
      assert.match(await page.textContent('#rows'), /M-1002[\s\S]*PM[\s\S]*M-1001[\s\S]*Request[\s\S]*This week/);
      await fits(page, 'Work Orders ' + w);
      await smallest(page, 'Work Orders ' + w);
      await shot(page, 'pmaint-workorders-' + w);
      assert.deepEqual(page.errors, []);
      await page.context().close();
    }
    results.push('Work Orders: M-1001 (request) and M-1002 (PM) listed');

    // Maintenance Station: no sign-in to see the work orders; name + login ID to start; Complete with a signature.
    for (const [w, h] of [[1280, 800], [1920, 1080]]) {
      const page = await openPage(browser, w, h, '/maint-station.html', true);
      await page.waitForSelector('#jobs .gs-job');
      assert.match(await page.textContent('#jobs'), /GALLON FILLER[\s\S]*M-1001/);
      await fits(page, 'Maintenance Station ' + w);
      await shot(page, 'pmaint-station-' + w);
      assert.deepEqual(page.errors, []);
      await page.context().close();
    }
    const st = await openPage(browser, 1280, 800, '/maint-station.html', true);
    await st.waitForSelector('#jobs .gs-job');
    await st.click('#jobs .gs-job:has-text("M-1002") button');
    await st.click('#job-start');
    await st.click('#names [data-who="TECH-JT"]');
    for (const k of '48213') await st.click('#keys [data-key="' + k + '"]');
    await st.click('#keys [data-key="go"]');
    await st.waitForFunction(() => /JELLICK Tom started/.test(document.getElementById('gs-message').textContent), null, { timeout: 8000 });
    await st.waitForSelector('#crew .gs-clock');
    await shot(st, 'pmaint-station-job-1280');
    await st.click('#job-done');
    await st.click('#names [data-who="TECH-JT"]');
    for (const k of '48213') await st.click('#keys [data-key="' + k + '"]');
    await st.click('#keys [data-key="go"]');
    await st.waitForSelector('#view-fix:not([hidden])');
    await st.click('#fixes [data-fix="PM done"]');
    await st.click('[data-safe="yes"]');
    const sig = await st.$('#sig'), b = await sig.boundingBox();
    await st.mouse.move(b.x + 20, b.y + 20); await st.mouse.down(); await st.mouse.move(b.x + 160, b.y + 60, { steps: 6 }); await st.mouse.up();
    await shot(st, 'pmaint-station-complete-1280');
    await st.click('#finish');
    await st.waitForFunction(() => /completed by JELLICK Tom[\s\S]*Next PM due/.test(document.getElementById('gs-message').textContent), null, { timeout: 8000 });
    const wo = (await db().collection('plantWorkOrders').where('woNumber', '==', 'M-1002').get()).docs[0].data();
    assert.deepEqual([wo.status, wo.completedBy, wo.fixed], ['DONE', 'JELLICK Tom', 'PM done']);
    assert.deepEqual(st.errors, []);
    results.push('Maintenance Station: M-1002 started with name + login ID, completed with a signature; the PM\'s next due day moved on');
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('PMAINT ' + r));
})().catch(e => { console.error(e); process.exit(1); });

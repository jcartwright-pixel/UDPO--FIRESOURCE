'use strict';
/*
 * Browser check of the new screens against the local test database (npm run test:browser):
 * made-up sheets are transferred, then Daily and Weekly Dispatch are opened at 1920x950 and 1366x650.
 * It checks the loads shown, that nothing scrolls, that a save is one call, and that an open screen shows
 * the save without reloading. Pictures go to SHOTS_DIR when it is set.
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
const SHOTS = process.env.SHOTS_DIR || '';

async function openPage(browser, width, height, url, init) {
  // The Safety Walkthrough's offline screen cache (sw.js) fetches the Firebase code itself, outside page.route; it is
  // checked in safety.cjs, which serves that code to it.
  const page = await browser.newPage({ viewport: { width, height }, serviceWorkers: 'block' });
  // The screens load Google's Firebase files from www.gstatic.com; here they come from the installed package.
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    const file = route.request().url().split('/').pop();
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, file)) });
  });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  if (init) await page.addInitScript(init);
  await page.goto(HOSTING + url);
  page.errors = errors;
  return page;
}

async function noScroll(page) {
  return page.evaluate(() => ({ scroll: document.scrollingElement.scrollHeight, inner: window.innerHeight, width: document.scrollingElement.scrollWidth, innerWidth: window.innerWidth }));
}

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: () => new Date('2026-10-09T12:00:00Z') });
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const [w, h] of [[1920, 950], [1366, 650]]) {
      const page = await openPage(browser, w, h, '/daily.html?date=2026-10-05&testEmail=dispatch.test@uniteddairy.com');
      await page.waitForSelector('#rows tr[data-id]');
      const routes = await page.$$eval('#rows tr[data-id] td:first-child', tds => tds.map(td => td.textContent));
      assert.deepEqual(routes, ['801', '802'], 'Monday 10/5 loads Tuesday 801 then 802');
      const group = await page.textContent('#rows tr.group td');
      assert.equal(group, 'TUESDAY DELIVERIES, 10-6-26');
      const size = await noScroll(page);
      assert.ok(size.scroll <= size.inner && size.width <= size.innerWidth, 'Daily fits ' + w + 'x' + h + ' with no scrolling: ' + JSON.stringify(size));
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'daily-' + w + '.png') });
      assert.deepEqual(page.errors, []);
      await page.close();

      const weekly = await openPage(browser, w, h, '/weekly.html?week=2026-10-04&testEmail=dispatch.test@uniteddairy.com');
      await weekly.waitForSelector('#rows tr td.day');
      const first = await weekly.$$eval('#rows tr td:first-child', tds => tds.map(td => td.textContent));
      assert.deepEqual(first, ['802', '801', '810', '810', '899'], 'Route Master week order; 899 is hidden on Daily only');
      const wsize = await noScroll(weekly);
      assert.ok(wsize.scroll <= wsize.inner && wsize.width <= wsize.innerWidth, 'Weekly fits ' + w + 'x' + h + ': ' + JSON.stringify(wsize));
      if (SHOTS) await weekly.screenshot({ path: path.join(SHOTS, 'weekly-' + w + '.png') });
      await weekly.close();
    }

    // A save from one screen shows on another open screen without a reload.
    const watcher = await openPage(browser, 1920, 950, '/daily.html?date=2026-10-05&testEmail=manager.test@uniteddairy.com');
    const saver = await openPage(browser, 1920, 950, '/daily.html?date=2026-10-05&testEmail=dispatch.test@uniteddairy.com');
    await watcher.waitForSelector('#rows tr[data-id]');
    await saver.waitForSelector('#rows tr[data-id]');
    const timing = await saver.evaluate(async () => {
      const { save } = await import('./js/app.js');
      const t0 = performance.now();
      const out = await save('assignDriver', { runDocId: '2026-10-04__run_t802', day: 'tue', driverId: 'drv_test_adams' });
      const ms = Math.round(performance.now() - t0);
      const t1 = performance.now();
      await save('assignTruck', { runDocId: '2026-10-04__run_t802', day: 'tue', equipmentId: 'veh_truck_900002' });
      return { ms, warm: Math.round(performance.now() - t1), out };
    });
    assert.equal(timing.out.ok, true);
    await watcher.waitForFunction(() => {
      const row = document.querySelector('tr[data-id="2026-10-04__run_t802|tue"]');
      return row && row.children[3].textContent === 'ADAMS, PAT';
    }, null, { timeout: 5000 });
    results.push('save from the screen: one call, ' + timing.ms + ' ms first (server starting), ' + timing.warm + ' ms next, on the local test database; the other open screen showed it without reloading');

    // Editing on the screens: pick a trailer on Daily, the change shows at once and on the other open screen.
    const editor = await openPage(browser, 1920, 950, '/daily.html?date=2026-10-05&testEmail=dispatch.test@uniteddairy.com');
    await editor.waitForSelector('tr[data-id="2026-10-04__run_t802|tue"] td[data-edit="trailer"]');
    await editor.dblclick('tr[data-id="2026-10-04__run_t802|tue"] td[data-edit="trailer"]');
    const t0 = Date.now();
    await editor.click('.cell-pop [data-i]:has-text("T-901")');
    await editor.waitForFunction(() => document.querySelector('tr[data-id="2026-10-04__run_t802|tue"]').children[6].textContent === 'T-901');
    const shownMs = Date.now() - t0;
    await watcher.waitForFunction(() => document.querySelector('tr[data-id="2026-10-04__run_t802|tue"]').children[6].textContent === 'T-901', null, { timeout: 5000 });
    const seenMs = Date.now() - t0;
    // Joe 10/10: a trailer on the road on another run at the same time (T-902 on 801) is left out of the list unless OVR is ticked;
    // with OVR it is offered and says why.
    await editor.dblclick('tr[data-id="2026-10-04__run_t802|tue"] td[data-edit="trailer"]');
    const labels = await editor.$$eval('.cell-pop [data-i]', os => os.map(o => o.textContent));
    assert.ok(!labels.some(t => /T-902/.test(t)), 'T-902 (on the road on 801) is left out: ' + labels.join(' | '));
    await editor.keyboard.press('Escape');
    await editor.check('tr[data-id="2026-10-04__run_t802|tue"] input[data-ovr]');
    await editor.dblclick('tr[data-id="2026-10-04__run_t802|tue"] td[data-edit="trailer"]');
    const ovrLabels = await editor.$$eval('.cell-pop [data-i]', os => os.map(o => o.textContent));
    assert.ok(ovrLabels.some(t => /T-902\s+\[ON ROAD.*\(801\)\]/.test(t)), 'with OVR, T-902 is offered as on the road on 801: ' + ovrLabels.join(' | '));
    await editor.keyboard.press('Escape');
    await editor.uncheck('tr[data-id="2026-10-04__run_t802|tue"] input[data-ovr]');
    results.push('picking a trailer on Daily: on screen in ' + shownMs + ' ms, on another open screen in ' + seenMs + ' ms (local test database)');

    // A driver note.
    await editor.click('tr[data-id="2026-10-04__run_t802|tue"] td[data-edit="note"]');
    await editor.fill('tr[data-id="2026-10-04__run_t802|tue"] input.picker', 'Call store on arrival');
    await editor.keyboard.press('Enter');
    await watcher.waitForFunction(() => document.querySelector('tr[data-id="2026-10-04__run_t802|tue"]').children[9].textContent === 'Call store on arrival', null, { timeout: 5000 });

    // Joe 10/12: no grab dots and no arrows. A dispatcher cannot move lines; a manager grabs 802's line and drags it above 801,
    // and the order saves as one call.
    assert.equal(await editor.$('#rows tr.mover'), null, 'a dispatcher cannot move lines');
    assert.equal(await watcher.$('#rows [data-grip], #rows .dd-grip, #rows button[data-move]'), null, 'no grab dots and no arrows');
    await watcher.waitForSelector('tr[data-id="2026-10-04__run_t802|tue"].mover');
    assert.equal(await watcher.$eval('tr[data-id="2026-10-04__run_t802|tue"] td.route', td => getComputedStyle(td).cursor), 'grab', 'the line shows the hand');
    {
      const from = await watcher.$eval('tr[data-id="2026-10-04__run_t802|tue"] td:nth-child(2)', td => { const b = td.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; });
      const to = await watcher.$eval('tr[data-id="2026-10-04__run_t801|tue"] td:nth-child(2)', td => { const b = td.getBoundingClientRect(); return [b.left + b.width / 2, b.top + 4]; });
      await watcher.mouse.move(from[0], from[1]);
      await watcher.mouse.down();
      await watcher.mouse.move(from[0], from[1] - 10, { steps: 3 });
      await watcher.mouse.move(to[0], to[1], { steps: 8 });
      await watcher.mouse.up();
    }
    await editor.waitForFunction(() => [...document.querySelectorAll('#rows tr[data-id] td:first-child')].map(td => td.textContent).join(',') === '802,801', null, { timeout: 5000 });
    results.push('a manager dragged 802\'s line above 801 (hand cursor, no dots or arrows) and the dispatcher\'s screen showed the new order without reloading');

    // The current Daily Dispatch buttons: RUNS / NO RUN, Edit box (depart time, jack), Add Route / Run, Down Trucks / Trailers, Driver Call-Off, OVR.
    const r801 = 'tr[data-id="2026-10-04__run_t801|tue"]', r802 = 'tr[data-id="2026-10-04__run_t802|tue"]';
    await editor.click(r801 + ' button[data-runs]');
    await editor.waitForSelector(r801 + '.off');
    assert.equal(await editor.textContent(r801 + ' button[data-runs]'), 'NO RUN', 'a run switched to NO RUN stays on screen');
    await watcher.waitForFunction(() => !document.querySelector('tr[data-id="2026-10-04__run_t801|tue"]'), null, { timeout: 5000 });
    await editor.click('#open-add');
    const addable = await editor.$$eval('#add-pick option', os => os.map(o => o.textContent));
    assert.ok(addable.some(t => /^801 /.test(t)), 'Add Route / Run offers 801: ' + addable.join(' | '));
    await editor.selectOption('#add-pick', { label: addable.find(t => /^801 .*Tuesday/.test(t)) });
    await editor.click('#add-save');
    await watcher.waitForSelector(r801, { timeout: 5000 });
    assert.equal(await editor.textContent(r801 + ' button[data-runs]'), 'RUNS');
    results.push('Daily: 801 switched to NO RUN stayed on the screen greyed, then Add Route / Run put it back');

    // Joe 10/12: an added route can be placed in the load order (a manager's Add Route / Run asks where it loads).
    await watcher.waitForFunction(() => [...document.querySelectorAll('#rows tr[data-id] td:first-child')].map(td => td.textContent).join(',') === '802,801', null, { timeout: 5000 });
    await watcher.click(r801 + ' button[data-runs]');
    await watcher.waitForSelector(r801 + '.off');
    await watcher.click('#open-add');
    await watcher.selectOption('#add-pick', { label: (await watcher.$$eval('#add-pick option', os => os.map(o => o.textContent))).find(t => /^801 .*Tuesday/.test(t)) });
    assert.equal(await watcher.isVisible('#add-where'), true, 'a manager can place the added route');
    assert.equal(await editor.$eval('#add-where-box', b => b.hidden), true, 'a dispatcher (no reorder right) is not asked');
    await watcher.selectOption('#add-where', 'first');
    await watcher.click('#add-save');
    await editor.waitForFunction(() => [...document.querySelectorAll('#rows tr[data-id] td:first-child')].map(td => td.textContent).join(',') === '801,802', null, { timeout: 5000 });
    assert.ok(await watcher.$(r801 + '.mover'), 'the added route can be dragged like the rest');
    results.push('Daily: a manager added 801 back as the first load, and its line can be dragged like the rest');

    await editor.click(r802 + ' button[data-open]');
    await editor.fill('#edit-modal input[data-field="time"]', '4:15 AM');
    await editor.press('#edit-modal input[data-field="time"]', 'Tab');
    await editor.fill('#edit-modal input[data-field="jack"]', 'pj-7');
    await editor.press('#edit-modal input[data-field="jack"]', 'Tab');
    if (SHOTS) await editor.screenshot({ path: path.join(SHOTS, 'daily-edit-1920.png') });
    await editor.click('#edit-modal [data-close]');
    await watcher.waitForFunction(() => { const tr = document.querySelector('tr[data-id="2026-10-04__run_t802|tue"]'); return tr.children[7].textContent === '4:15 AM' && tr.children[8].textContent === 'PJ-7'; }, null, { timeout: 5000 });
    results.push('Daily Edit box: depart time 4:15 AM and jack PJ-7 saved and showed on the other open screen');

    await editor.click('#open-down');
    await editor.fill('#down-unit', '900001');
    await editor.fill('#down-reason', 'Brakes');
    await editor.click('#down-add');
    await editor.waitForFunction(() => /900001.*Brakes/.test(document.getElementById('down-rows').textContent));
    if (SHOTS) await editor.screenshot({ path: path.join(SHOTS, 'daily-down-trucks-1920.png') });
    await editor.click('#down-panel [data-close]');
    const downDoc = await editor.evaluate(async () => {
      const { start } = await import('./js/app.js');
      const { doc, getDoc } = await import('/js/firebase.js');
      const { db } = await start();
      for (let i = 0; i < 20; i++) { const d = (await getDoc(doc(db, 'equipment', 'veh_truck_900001'))).data(); if (d.status === 'DOWN') return d; await new Promise(r => setTimeout(r, 250)); }
      return null;
    });
    assert.ok(downDoc && downDoc.notes === 'DOWN: Brakes', 'Down saved to Equipment Master copy: ' + JSON.stringify(downDoc));
    await editor.dblclick(r802 + ' td[data-edit="truck"]');
    let trucks = await editor.$$eval('.cell-pop [data-i]', os => os.map(o => o.textContent));
    assert.ok(!trucks.some(t => /900001/.test(t)), 'a down truck is not offered: ' + trucks.join(' | '));
    await editor.keyboard.press('Escape');
    await editor.check(r802 + ' input[data-ovr]');
    await editor.dblclick(r802 + ' td[data-edit="truck"]');
    trucks = await editor.$$eval('.cell-pop [data-i]', os => os.map(o => o.textContent));
    assert.ok(trucks.some(t => /900001\s+\[DOWN\]/.test(t)), 'with OVR the down truck is offered and marked: ' + trucks.join(' | '));
    await editor.keyboard.press('Escape');
    await editor.uncheck(r802 + ' input[data-ovr]');
    await editor.click('#open-down');
    await editor.click('#down-rows button[data-up]');
    await editor.waitForFunction(() => !/900001/.test(document.getElementById('down-rows').textContent) && /T-903.*INACTIVE/.test(document.getElementById('down-rows').textContent), null, { timeout: 5000 });
    await editor.click('#down-panel [data-close]');
    results.push('Down Trucks / Trailers: 900001 down for Brakes left the truck list (shown as [DOWN] with OVR), then Back in service');

    await editor.click('#open-calloff');
    await editor.selectOption('#off-driver', 'drv_test_casey');
    await editor.selectOption('#off-reason', 'CALLED OFF');
    await editor.fill('#off-start', '2026-10-06');
    await editor.fill('#off-end', '2026-10-06');
    await editor.click('#off-save');
    await editor.waitForTimeout(300);
    await editor.dblclick(r802 + ' td[data-edit="driver"]');
    const drivers = await editor.$$eval('.cell-pop [data-i]:not(.off)', os => os.map(o => o.textContent));
    assert.ok(!drivers.some(t => /CASEY/.test(t)), 'a called-off driver is not offered: ' + drivers.join(' | '));
    await editor.keyboard.press('Escape');
    const callOff = await editor.evaluate(async () => {
      const { start } = await import('./js/app.js');
      const { collection, query, where, getDocs } = await import('/js/firebase.js');
      const { db } = await start();
      for (let i = 0; i < 20; i++) {
        const s = await getDocs(query(collection(db, 'exceptions'), where('driverId', '==', 'drv_test_casey')));
        const hit = s.docs.map(d => d.data()).find(e => e.startDate === '2026-10-06');
        if (hit) return hit;
        await new Promise(r => setTimeout(r, 250));
      }
      return null;
    });
    assert.ok(callOff && callOff.reasonCode === 'CALLED OFF', 'Driver Call-Off saved: ' + JSON.stringify(callOff));
    results.push('Driver Call-Off: CASEY called off 10/6 is saved to Driver Exceptions and left out of the 10/6 driver list');

    // Weekly (Joe 10/10): clicking a run box opens the driver drop-down right on the box; trucks and trailers are picked on Daily Dispatch.
    const wkEdit = await openPage(browser, 1920, 950, '/weekly.html?week=2026-10-04&testEmail=dispatch.test@uniteddairy.com');
    await wkEdit.waitForSelector('tr td.day.editable[data-day="mon"]');
    const monCell = 'xpath=//tr[td[1][text()="899"]]/td[@data-day="mon"]';
    await wkEdit.click(monCell);
    await wkEdit.waitForSelector('.popover.cell-pick select[data-kind="driver"]');
    assert.deepEqual(await wkEdit.$$eval('.popover select', s => s.map(x => x.dataset.kind)), ['driver'], 'only the driver is picked on Weekly');
    const monBox = await wkEdit.$eval(monCell, td => { const r = td.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)]; });
    const pickBox = await wkEdit.$eval('.popover.cell-pick', p => { const r = p.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)]; });
    assert.ok(Math.abs(pickBox[0] - monBox[0]) <= 4 && Math.abs(pickBox[1] - monBox[1]) <= 4, 'the drop-down sits on the box: ' + JSON.stringify([monBox, pickBox]));
    await wkEdit.selectOption('.popover select[data-kind="driver"]', 'drv_test_brook');
    await wkEdit.waitForSelector('.popover', { state: 'detached' });
    await wkEdit.waitForFunction(() => [...document.querySelectorAll('#rows tr')].some(tr => tr.children[0].textContent === '899' && /BROOK/.test(tr.children[3].textContent)), null, { timeout: 5000 });
    results.push('Weekly: clicking 899 Monday opened the driver drop-down on the box; BROOK picked saved, closed it and shows in the grid');
    if (SHOTS) await wkEdit.screenshot({ path: path.join(SHOTS, 'weekly-after-edit-1920.png') });

    // Weekly like the current screen: CARRIER, Route Run Days, the Driver Assignment Board's availability box, Publish.
    const tueCell = 'xpath=//tr[td[1][text()="802"]]/td[@data-day="tue"]';
    await wkEdit.click(tueCell);
    await wkEdit.selectOption('.popover select[data-kind="driver"]', '__CARRIER__');
    await wkEdit.waitForSelector('.popover', { state: 'detached' });
    await wkEdit.waitForFunction(() => [...document.querySelectorAll('#rows tr')].some(tr => tr.children[0].textContent === '802' && tr.children[4].firstChild.textContent === 'CARRIER' && tr.children[4].classList.contains('c-carrier')), null, { timeout: 5000 });
    // Plant Load: 801 does not run Thursdays, but the plant scheduler has a load for it on 10/8, so the day needs a driver.
    const thu801 = 'xpath=//tr[td[1][text()="801"]]/td[@data-day="thu"]';
    assert.deepEqual(await wkEdit.$eval(thu801, td => [td.classList.contains('c-plant'), td.classList.contains('plant-load'), td.textContent, /pickup 7:00 AM, T-902, PO 4411/.test(td.title)]), [true, true, 'PLANT LOAD', true]);
    // Joe 10/23 (849 Sun Valley Friday): 802 does not run Saturdays, but the Scheduler has a carrier pickup for it on 10/10, so
    // the day shows CARRIER (from the Scheduler, outlined) and is not counted as needing a driver.
    const sat802 = 'xpath=//tr[td[1][text()="802"]]/td[@data-day="sat"]', pickupRef = db().collection('plantJournal').doc('PLANT_SCHEDULE_app_carrier_802');
    assert.equal(await wkEdit.$eval(sat802, td => td.classList.contains('off')), true, '802 does not run Saturdays');
    await pickupRef.set({ recordId: 'carrier_802', type: 'PLANT_SCHEDULE', date: '2026-10-10', status: 'SCHEDULED', routeId: 'rte_t802', runId: 'run_t802', route: '802', run: 'UT DSD MILK',
      area: 'SCHEDULER', createdInApp: true, recordedAt: '2026-10-09T12:00:00Z', payload: { scheduleType: 'CARRIER', carrier: true, pickupTime: '16:00', loadDate: '2026-10-09', poNumber: '46020', trailer: 'T-922' } });
    await wkEdit.waitForFunction(() => { const td = [...document.querySelectorAll('#rows tr')].find(tr => tr.children[0].textContent === '802').children[8]; return td.classList.contains('c-carrier'); }, null, { timeout: 5000 });
    assert.deepEqual(await wkEdit.$eval(sat802, td => [td.classList.contains('c-carrier'), td.classList.contains('plant-load'), td.textContent, /PO 46020/.test(td.title)]), [true, true, 'CARRIER', true]);
    if (SHOTS) await wkEdit.screenshot({ path: path.join(SHOTS, 'weekly-carrier-pickup-1920.png') });
    await pickupRef.delete();
    await wkEdit.waitForFunction(() => [...document.querySelectorAll('#rows tr')].find(tr => tr.children[0].textContent === '802').children[8].classList.contains('off'), null, { timeout: 5000 });
    // Joe 10/13 (836 PECK): a plant load can be marked Not running (the day goes black) and put back to PLANT LOAD.
    await wkEdit.click(thu801);
    await wkEdit.selectOption('.popover select[data-kind="driver"]', '__OFF__');
    await wkEdit.waitForSelector('.popover', { state: 'detached' });
    await wkEdit.waitForFunction(() => { const td = [...document.querySelectorAll('#rows tr')].find(tr => tr.children[0].textContent === '801').children[6]; return td.classList.contains('off') && !td.classList.contains('c-plant') && /not running/.test(td.title); }, null, { timeout: 5000 });
    if (SHOTS) await wkEdit.screenshot({ path: path.join(SHOTS, 'weekly-plant-load-not-running-1920.png') });
    await wkEdit.click(thu801);
    await wkEdit.selectOption('.popover select[data-kind="driver"]', '__PLANT__');
    await wkEdit.waitForSelector('.popover', { state: 'detached' });
    await wkEdit.waitForFunction(() => [...document.querySelectorAll('#rows tr')].find(tr => tr.children[0].textContent === '801').children[6].classList.contains('c-plant'), null, { timeout: 5000 });
    await wkEdit.click(thu801);
    assert.match(await wkEdit.$eval('.popover select[data-kind="driver"] option', o => o.textContent), /PLANT LOAD/);
    await wkEdit.selectOption('.popover select[data-kind="driver"]', 'drv_test_adams');
    await wkEdit.waitForSelector('.popover', { state: 'detached' });
    await wkEdit.waitForFunction(() => { const td = [...document.querySelectorAll('#rows tr')].find(tr => tr.children[0].textContent === '801').children[6]; return /ADAMS/.test(td.textContent) && td.classList.contains('plant-load') && !td.classList.contains('c-plant'); }, null, { timeout: 5000 });
    if (SHOTS) await wkEdit.screenshot({ path: path.join(SHOTS, 'weekly-plant-load-1920.png') });
    // The grid shows ADAMS at once; leave the page only once both saves (day on, then the driver) are stored.
    for (let i = 0; i < 50; i++) {
      const thu = (await db().collection('runs').doc('2026-10-04__run_t801').get()).data().days.thu;
      if (thu.runs === true && thu.driverId === 'drv_test_adams') break;
      await new Promise(r => setTimeout(r, 200));
    }
    // Route Run Days opens Route Week Override at this week (as in the current app); 802 Thursday turned on there needs a driver here.
    await Promise.all([wkEdit.waitForURL(/routeweek\.html\?week=2026-10-04/), wkEdit.click('#run-days')]);
    await wkEdit.click('xpath=//tbody[@id="rows"]/tr[td[1][text()="802"]]/td[2+5]/button');
    await wkEdit.waitForFunction(() => /RUNS/.test([...document.querySelectorAll('#rows tr')].find(tr => tr.children[0].textContent === '802').children[6].textContent) && !/NOT/.test([...document.querySelectorAll('#rows tr')].find(tr => tr.children[0].textContent === '802').children[6].textContent), null, { timeout: 5000 });
    if (SHOTS) await wkEdit.screenshot({ path: path.join(SHOTS, 'weekly-run-days-1920.png') });
    // Go back once the Thursday is stored (the box shows RUNS before the save comes back).
    let thu802 = {};
    for (let i = 0; i < 50 && thu802.runs !== true; i++) {
      thu802 = (await db().collection('runs').doc('2026-10-04__run_t802').get()).data().days.thu;
      if (thu802.runs !== true) await new Promise(r => setTimeout(r, 200));
    }
    await wkEdit.goBack();
    await wkEdit.waitForFunction(() => [...document.querySelectorAll('#rows tr')].some(tr => tr.children[0].textContent === '802' && tr.children[6].classList.contains('c-needs')), null, { timeout: 8000 });
    // Joe 10/10: no tab buttons; the menu's Driver Assignment Board opens Weekly at the board (the test sign-in rides on the address).
    assert.equal(await wkEdit.$('#tab-board'), null, 'no tab buttons');
    await wkEdit.$eval('.side-flyouts a[href="weekly.html#board"]', a => { a.href = 'weekly.html?week=2026-10-04&testEmail=dispatch.test@uniteddairy.com#board'; a.click(); });
    // The link reloads the page: while the new page has no body yet, keep waiting instead of failing on it.
    await wkEdit.waitForFunction(() => !!document.body && document.body.dataset.view === 'board' && !!document.getElementById('board-panel') && document.getElementById('board-panel').getBoundingClientRect().top < innerHeight, null, { timeout: 8000 });
    await wkEdit.waitForSelector('#board-rows tr[data-driver="drv_test_casey"]');
    const boardNames = await wkEdit.$$eval('#board-rows tr[data-driver] td:first-child', tds => tds.map(td => td.textContent));
    assert.deepEqual(boardNames, ['BROOK, SAM', 'ADAMS, PAT', 'CASEY, LEE'], 'relief first, then seniority');
    await wkEdit.click('#board-rows tr[data-driver="drv_test_casey"] td:nth-child(3) button');
    await wkEdit.selectOption('#avail-reason', 'VACATION');
    await wkEdit.click('#avail-save');
    await wkEdit.waitForFunction(() => /VACATION/.test(document.querySelector('#board-rows tr[data-driver="drv_test_casey"] td:nth-child(3)').textContent), null, { timeout: 5000 });
    if (SHOTS) await wkEdit.screenshot({ path: path.join(SHOTS, 'weekly-board-1920.png') });
    await wkEdit.evaluate(() => { document.getElementById('wk-scroll').scrollTop = 0; });
    await wkEdit.waitForFunction(() => [...document.querySelectorAll('#rows tr')].some(tr => tr.children[0].textContent === '802' && tr.children[3].classList.contains('c-vacation-needs') && /CASEY/.test(tr.children[3].textContent)), null, { timeout: 5000 });
    // Joe 10/20: a run whose driver is off reads NEEDS DRIVER in white on solid red, with who is off and why, all at 16px.
    const offLook = await wkEdit.$eval('#rows td.c-vacation-needs', td => ({ text: td.innerText.split('\n'), bg: getComputedStyle(td, '::before').backgroundColor, color: getComputedStyle(td.querySelector('.nm')).color, sizes: [...td.querySelectorAll('.nm, .off-who, .off-why')].map(e => parseFloat(getComputedStyle(e).fontSize)) }));
    assert.deepEqual(offLook.text, ['NEEDS DRIVER', 'CASEY, LEE', 'VACATION'], 'driver-off cell: NEEDS DRIVER, then who is off and why');
    assert.equal(offLook.bg, 'rgb(200, 30, 30)', 'driver-off cell is solid red');
    assert.equal(offLook.color, 'rgb(255, 255, 255)', 'NEEDS DRIVER is white');
    assert.ok(offLook.sizes.every(n => n >= 16), 'driver-off cell text is at least 16px: ' + offLook.sizes);
    await wkEdit.click('#publish');
    // Joe 10/24: no "Published ..." line under the title once published (more board rows); when and who is on the Publish button's hover.
    await wkEdit.waitForFunction(() => /^Last published .* by dispatch\.test$/.test(document.getElementById('publish').title) && document.getElementById('published').hidden, null, { timeout: 5000 });
    await wkEdit.setViewportSize({ width: 1536, height: 790 });
    // The buttons are measured again a frame after the window changes size, so give the row a moment to settle.
    const sameRow = () => { const t = document.querySelector('.head h1').getBoundingClientRect(), a = document.querySelector('.head .actions.in-head').getBoundingClientRect(); return a.top < t.bottom; };
    await wkEdit.waitForFunction(sameRow, null, { timeout: 3000 }).catch(() => {});
    const headRow = await wkEdit.evaluate(() => { const t = document.querySelector('.head h1').getBoundingClientRect(), a = document.querySelector('.head .actions.in-head').getBoundingClientRect(); return { titleBottom: t.bottom, actionsTop: a.top, title: [t.left, t.right], actions: [a.left, a.right], buttons: [...document.querySelectorAll('.head .actions.in-head button, .head .actions.in-head a.button')].map(b => b.textContent + ':' + Math.round(b.getBoundingClientRect().width)), head: document.querySelector('.head').clientWidth }; });
    assert.ok(headRow.actionsTop < headRow.titleBottom, 'at 1536 the Weekly buttons sit on the title row: ' + JSON.stringify(headRow));
    await wkEdit.setViewportSize({ width: 1920, height: 950 });
    // Reset Week (managers): the dispatcher's button is off; a manager's second click rebuilds the week from the masters.
    assert.equal(await wkEdit.$eval('#reset', b => b.disabled), true, 'a dispatcher cannot Reset Week');
    const wkMgr = await openPage(browser, 1366, 650, '/weekly.html?week=2026-10-04&testEmail=manager.test@uniteddairy.com');
    await wkMgr.waitForSelector('tr td.day.editable[data-day="mon"]');
    await wkMgr.click('#reset');
    assert.equal(await wkMgr.$eval('#reset', b => b.textContent), 'Click again', 'the first click only asks to confirm');
    await wkMgr.click('#reset');
    await wkMgr.waitForFunction(() => [...document.querySelectorAll('#rows tr')].some(tr => tr.children[0].textContent === '802' && !/CARRIER/.test(tr.children[4].textContent) && tr.children[4].classList.contains('c-vacation-needs') && /CASEY/.test(tr.children[4].textContent) && tr.children[6].classList.contains('off') && tr.children[3].classList.contains('c-vacation-needs')), null, { timeout: 8000 });
    const rsFit = await wkMgr.evaluate(() => ({ scroll: document.documentElement.scrollHeight, inner: window.innerHeight }));
    assert.ok(rsFit.scroll <= rsFit.inner, 'Weekly still fits after Reset Week');
    if (SHOTS) await wkMgr.screenshot({ path: path.join(SHOTS, 'weekly-after-reset-1366.png') });
    // Joe 10/12 ("grab the line and move it"): Weekly lines drag too, no arrows and no dots; a dispatcher cannot move them.
    assert.equal(await wkEdit.$('#rows tr.mover'), null, 'a dispatcher cannot move Weekly lines');
    assert.equal(await wkMgr.$('#rows [data-grip], #rows .dd-grip, #rows button[data-move]'), null, 'no grab dots and no arrows on Weekly');
    await wkMgr.waitForSelector('#rows tr.mover');
    assert.equal(await wkMgr.$eval('#rows tr.mover td', td => getComputedStyle(td).cursor), 'grab', 'the Weekly line shows the hand');
    {
      const order = () => wkMgr.$$eval('#rows tr.mover', trs => trs.map(tr => tr.children[0].textContent + '/' + tr.children[1].textContent));
      const was = await order();
      const second = await wkMgr.$$eval('#rows tr.mover td:nth-child(2)', tds => tds.slice(0, 2).map(td => { const b = td.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2, b.top]; }));
      await wkMgr.mouse.move(second[1][0], second[1][1]);
      await wkMgr.mouse.down();
      await wkMgr.mouse.move(second[1][0], second[1][1] - 10, { steps: 3 });
      await wkMgr.mouse.move(second[0][0], second[0][2] + 4, { steps: 8 });
      await wkMgr.mouse.up();
      const want = [was[1], was[0]].concat(was.slice(2)).join(',');
      await wkMgr.waitForFunction((w) => [...document.querySelectorAll('#rows tr.mover')].map(tr => tr.children[0].textContent + '/' + tr.children[1].textContent).join(',') === w, want, { timeout: 5000 });
      assert.equal(await wkMgr.$('.popover'), null, 'letting go of a drag does not open a day');
      results.push('Weekly: a manager dragged ' + was[1] + ' above ' + was[0] + ' (no arrows, no dots); a dispatcher sees no drag');
    }
    results.push('Reset Week: a dispatcher cannot; a manager clicked twice: 802 Tuesday CARRIER went back to its standard driver CASEY, who is called off that day, so it is red as Driver Off - Needs Driver (Joe 10/11); Thursday off again; Monday still Vacation - Needs Driver');
    results.push('Weekly: 801 Thursday showed PLANT LOAD from the plant scheduler and took ADAMS (the run turned on, the mark stayed); CARRIER picked for 802 Tuesday, Route Run Days turned 802 Thursday on (Needs Driver), CASEY on vacation Monday from the Driver Assignment Board left 802 Monday as Vacation - Needs Driver, Publish recorded');

    // Someone with no dispatch role sees no edit controls.
    const viewer = await openPage(browser, 1366, 650, '/daily.html?date=2026-10-05&testEmail=viewer.test@uniteddairy.com');
    await viewer.waitForSelector('#rows tr[data-id]');
    await viewer.waitForTimeout(500);
    assert.equal(await viewer.$$eval('td[data-edit]', tds => tds.length), 0);
    assert.equal(await viewer.textContent('#mode-text'), 'TEST COPY, READ ONLY');
    results.push('a person without a dispatch role sees the screen read only');
    await Promise.all([editor.close(), wkEdit.close(), viewer.close()]);

    // Vacation Schedule: Time Off, Calendar and Eligibility each fit one page; a manager adds and edits time off; the holiday limit holds.
    for (const [w, h] of [[1920, 950], [1366, 650]]) {
      const vac = await openPage(browser, w, h, '/vacations.html?testEmail=manager.test@uniteddairy.com');
      await vac.waitForSelector('#filters option[value="all"]', { state: 'attached' });
      await vac.selectOption('#filters', 'all');
      await vac.waitForSelector('#rows tr[data-id="vac_test_1"]');
      for (const v of ['time', 'calendar', 'eligibility']) {
        await vac.click('.tabs [data-view="' + v + '"]');
        const size = await noScroll(vac);
        assert.ok(size.scroll <= size.inner && size.width <= size.innerWidth, 'Vacation ' + v + ' fits ' + w + 'x' + h + ': ' + JSON.stringify(size));
        if (SHOTS) await vac.screenshot({ path: path.join(SHOTS, 'vacation-' + v + '-' + w + '.png') });
      }
      assert.deepEqual(vac.errors, []);
      await vac.close();
    }
    const vac = await openPage(browser, 1920, 950, '/vacations.html?testEmail=manager.test@uniteddairy.com');
    await vac.waitForSelector('#filters option[value="all"]', { state: 'attached' });
    await vac.selectOption('#filters', 'all');
    await vac.waitForSelector('#rows tr[data-id="vac_test_1"]');
    assert.match(await vac.textContent('#rows tr[data-id="vac_test_1"]'), /ADAMS, PAT.*Vacation Day.*10-12-26.*10-16-26.*5.*APPROVED/);
    await vac.click('#add');
    await vac.selectOption('#form select[name="driverId"]', 'drv_test_brook');
    await vac.fill('#form input[name="startDate"]', '2026-11-23');
    await vac.fill('#form input[name="endDate"]', '2026-11-24');
    await vac.selectOption('#form select[name="type"]', 'PERSONAL');
    await vac.fill('#form input[name="notes"]', 'Family');
    await vac.click('#save');
    await vac.waitForFunction(() => [...document.querySelectorAll('#rows tr')].some(tr => /BROOK, SAM.*Personal Day.*11-23-26.*11-24-26.*2.*APPROVED.*Family/.test(tr.textContent) && !/^new-/.test(tr.dataset.id)), null, { timeout: 5000 });
    // Thanksgiving week allows 2 off: ADAMS makes 2, CASEY on the same day is refused and taken back off the screen.
    await vac.click('.tabs [data-view="calendar"]');
    await vac.fill('#cal-month', '2026-11');
    await vac.dispatchEvent('#cal-month', 'change');
    await vac.click('#calendar [data-day="2026-11-24"]');
    await vac.selectOption('#day-form select[name="driverId"]', 'drv_test_adams');
    await vac.click('#day-save');
    await vac.waitForFunction(() => /2 of 2 drivers off \(Thanksgiving week/.test(document.getElementById('day-sub').textContent), null, { timeout: 5000 });
    await vac.selectOption('#day-form select[name="driverId"]', 'drv_test_casey');
    await vac.click('#day-save');
    await vac.waitForFunction(() => /FULL during Thanksgiving week/.test(document.getElementById('error').textContent), null, { timeout: 5000 });
    await vac.waitForFunction(() => !/CASEY/.test(document.getElementById('day-list').textContent));
    if (SHOTS) await vac.screenshot({ path: path.join(SHOTS, 'vacation-day-full-1920.png') });
    await vac.keyboard.press('Escape');
    // Edit: the Personal Day entry becomes Cancelled.
    await vac.click('.tabs [data-view="time"]');
    const brookRow = 'xpath=//tbody[@id="rows"]/tr[td[1]/b[text()="BROOK, SAM"]]';
    await vac.click(brookRow + '//button[@data-edit-id]');
    await vac.selectOption('#form select[name="status"]', 'CANCELLED');
    await vac.click('#save');
    await vac.waitForFunction(() => [...document.querySelectorAll('#rows tr')].some(tr => /BROOK, SAM.*CANCELLED/.test(tr.textContent)), null, { timeout: 5000 });
    const dispatcherVac = await openPage(browser, 1366, 650, '/vacations.html?testEmail=dispatch.test@uniteddairy.com');
    await dispatcherVac.waitForSelector('#filters option', { state: 'attached' });
    await dispatcherVac.waitForTimeout(300);
    assert.equal(await dispatcherVac.isDisabled('#add'), true, 'a dispatcher sees the schedule read only, as on the current screen');
    await Promise.all([vac.close(), dispatcherVac.close()]);
    results.push('Vacation Schedule: Time Off, Calendar and Eligibility fit at both sizes; a manager added a Personal Day, the Thanksgiving-week limit of 2 refused a third driver, and an entry was edited to Cancelled');

    // Route Editor: every view fits at both sizes; a manager changes a start time, turns a day on, edits a detail, adds a run and drags the load order.
    for (const [w, h] of [[1920, 950], [1366, 650]]) {
      const rt = await openPage(browser, w, h, '/routes.html?testEmail=manager.test@uniteddairy.com');
      await rt.waitForSelector('table.routes tr[data-id="run_t801"]');
      for (const v of ['times', 'days', 'seq', 'details', 'recap']) {
        await rt.selectOption('#view-select', v);
        const size = await noScroll(rt);
        assert.ok(size.scroll <= size.inner && size.width <= size.innerWidth, 'Route Editor ' + v + ' fits ' + w + 'x' + h + ': ' + JSON.stringify(size));
        if (SHOTS && (v === 'times' || v === 'days' || w === 1920)) await rt.screenshot({ path: path.join(SHOTS, 'routes-' + v + '-' + w + '.png') });
      }
      assert.deepEqual(rt.errors, []);
      await rt.close();
    }
    const rt = await openPage(browser, 1920, 950, '/routes.html?testEmail=manager.test@uniteddairy.com');
    await rt.waitForSelector('table.routes tr[data-id="run_t801"]');
    await rt.selectOption('#view-select', 'times');
    await rt.fill('tr[data-id="run_t801"] input.cell[data-day="mon"]', '5 AM');
    await rt.press('tr[data-id="run_t801"] input.cell[data-day="mon"]', 'Tab');
    await rt.waitForFunction(() => document.querySelector('tr[data-id="run_t801"] input.cell[data-day="mon"]').value === '5:00 AM', null, { timeout: 5000 });
    assert.equal(await rt.evaluate(() => document.activeElement.dataset.day), 'tue', 'Tab moved on to Tuesday while Monday saved');
    // Block paste (from Excel / Sheets or this grid): two runs by two days, one save per run; Shift+click and copy give the block back.
    await rt.focus('tr[data-id="run_t802"] input.cell[data-day="wed"]');
    await rt.evaluate(() => {
      const dt = new DataTransfer(); dt.setData('text/plain', '6 AM\t6:15 AM\r\n7 AM\t7:15 AM\r\n');
      document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await rt.waitForFunction(() => document.querySelector('tr[data-id="run_t802"] input.cell[data-day="thu"]').value === '6:15 AM' && document.querySelector('tr[data-id="run_t801"] input.cell[data-day="wed"]').value === '7:00 AM', null, { timeout: 5000 });
    await rt.click('tr[data-id="run_t802"] input.cell[data-day="wed"]');
    await rt.click('tr[data-id="run_t801"] input.cell[data-day="thu"]', { modifiers: ['Shift'] });
    const copied = await rt.evaluate(() => {
      const dt = new DataTransfer();
      document.querySelector('tr[data-id="run_t801"] input.cell[data-day="thu"]').dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }));
      return dt.getData('text/plain');
    });
    assert.equal(copied, '6:00 AM\t6:15 AM\n7:00 AM\t7:15 AM', 'the marked block copies as rows and columns');
    if (SHOTS) await rt.screenshot({ path: path.join(SHOTS, 'routes-block-paste-1920.png') });
    await rt.selectOption('#view-select', 'days');
    await rt.click('tr[data-id="run_t802"] button[data-runday="wed"]');
    await rt.waitForFunction(() => document.querySelector('tr[data-id="run_t802"] button[data-runday="wed"]').textContent === 'RUNS');
    await rt.click('tr[data-id="run_t802"] [data-edit-route]');
    await rt.selectOption('form.details select[data-f="loadType"]', 'Tote');
    if (SHOTS) await rt.screenshot({ path: path.join(SHOTS, 'routes-details-802-1920.png') });
    await rt.selectOption('#view-select', 'recap');
    await rt.waitForFunction(() => [...document.querySelectorAll('table.routes tbody tr')].some(tr => tr.children[0].textContent === '802' && tr.children[3].textContent === 'Tote' && /Wed/.test(tr.children[4].textContent)), null, { timeout: 5000 });
    await rt.click('#add-run');
    await rt.fill('#add-form input[name="run"]', 'WHEELING');
    // Joe 10/21: Departure Day is picked from a list and must be picked (802's runs have none to copy).
    await rt.selectOption('#add-form select[name="departureDay"]', 'Delivery Day');
    await rt.click('#add-save');
    await rt.waitForFunction(() => [...document.querySelectorAll('table.routes tbody tr')].some(tr => /WHEELING/.test(tr.textContent)), null, { timeout: 5000 });
    await rt.selectOption('#route-select', '');
    await rt.selectOption('#view-select', 'seq');
    // The Load Order list is drawn and the saves above have settled, so no copy redraws the rows in the middle of the drag.
    await rt.waitForFunction(() => document.querySelector('table.routes thead th') && document.querySelector('table.routes thead th').textContent === 'Order' && document.querySelector('table.routes tr[data-i="1"]'), null, { timeout: 5000 });
    // On a slow runner a save takes several seconds: wait until 802's Tote and the WHEELING run are stored, so their
    // Route Master updates do not redraw the list in the middle of the drag.
    await rt.waitForFunction(async () => {
      const { start } = await import('./js/app.js');
      const { collection, getDocs } = await import('/js/firebase.js');
      const { db } = await start();
      const all = (await getDocs(collection(db, 'routes'))).docs.map(d => Object.assign({ id: d.id }, d.data()));
      return all.some(r => r.run === 'WHEELING') && all.some(r => r.id === 'run_t802' && r.loadType === 'Tote');
    }, null, { timeout: 20000, polling: 250 });
    await rt.waitForTimeout(600);
    const orderShown = () => rt.evaluate(() => [...document.querySelectorAll('table.routes tbody tr[data-i]')].map(tr => tr.children[1].textContent).join(','));
    const beforeDrag = await orderShown();
    await rt.dragAndDrop('table.routes tr[data-i="1"] td:nth-child(2)', 'table.routes tr[data-i="0"] td:nth-child(2)');
    await rt.waitForFunction(() => document.querySelector('table.routes tr[data-i="0"] td:nth-child(2)').textContent === '801', null, { timeout: 5000 })
      .catch(async e => { throw new Error('Load order drag: before ' + beforeDrag + ', after ' + await orderShown() + ' (' + e.message + ')'); });
    const saved801 = await rt.evaluate(async () => {
      const { start } = await import('./js/app.js');
      const { doc, getDoc } = await import('/js/firebase.js');
      const { db } = await start();
      for (let i = 0; i < 80; i++) { const d = (await getDoc(doc(db, 'routes', 'run_t801'))).data(); if (d.days.mon.loadOrder === 10 && d.days.mon.dispatchTime === 300) return d.days.mon; await new Promise(r => setTimeout(r, 250)); }
      return null;
    });
    assert.ok(saved801, 'Monday start time 5:00 AM and load order 10 saved for 801');
    const dispRt = await openPage(browser, 1366, 650, '/routes.html?testEmail=dispatch.test@uniteddairy.com');
    await dispRt.waitForSelector('table.routes tr[data-id="run_t801"]');
    await dispRt.waitForTimeout(300);
    assert.equal(await dispRt.isDisabled('#add-route'), true, 'a dispatcher sees Route Master read only');
    await Promise.all([rt.close(), dispRt.close()]);
    results.push('Route Editor: Start Times, Route Days, Load Order, Route Details and Recap fit at both sizes; a manager set 801 Monday to 5 AM (Tab kept moving), pasted a two-by-two block of start times and copied it back, turned 802 Wednesday on, set 802 to Tote, added a run to 802 and dragged 801 first on Monday');

    // Phone Check-In: a manager makes the code on Driver Check-ins (second click); a driver's phone asks for it once, then the name.
    const ciMgr = await openPage(browser, 1366, 650, '/checkins.html?testEmail=manager.test@uniteddairy.com');
    await ciMgr.waitForSelector('#new-code:not([hidden])');
    await ciMgr.click('#new-code');
    await ciMgr.click('#new-code');
    await ciMgr.waitForSelector('#phone-code', { timeout: 8000 });
    const phoneCode = await ciMgr.$eval('#phone-code', b => b.textContent);
    const ciFit = await noScroll(ciMgr);
    assert.ok(ciFit.scroll <= ciFit.inner, 'Driver Check-ins still fits with the code shown');
    // Give CASEY a load today (the made-up weeks cover 9/27 - 10/17; another day only checks the screens).
    const phoneLoad = await ciMgr.evaluate(async () => {
      const L = window.UDLogic, { save } = await import('./js/app.js');
      const today = L.operatingDay(new Date()), week = L.weekStart(today), p = L.dayPrefix(today);
      if (['2026-09-27', '2026-10-04', '2026-10-11'].indexOf(week) < 0) return null;
      const runDocId = week + '__run_t802';
      await save('setRuns', { runDocId, day: p, runs: true });
      await save('assignDriver', { runDocId, day: p, driverId: 'drv_test_casey', override: true });
      return today;
    });
    const phone = await openPage(browser, 390, 844, '/route.html');
    await phone.fill('#code', phoneCode.toLowerCase());
    await phone.click('#step-code button[type=submit]');
    // Joe 10/12: the three choices first; Check-In asks for the name.
    await phone.waitForSelector('#step-menu:not([hidden])', { timeout: 8000 });
    await phone.click('#m-checkin');
    await phone.waitForSelector('#step-name:not([hidden])', { timeout: 8000 });
    if (SHOTS) await phone.screenshot({ path: path.join(SHOTS, 'phone-name-390.png') });
    await phone.selectOption('#name', 'drv_test_casey');
    await phone.click('#step-name button[type=submit]');
    await phone.waitForSelector('#step-loads:not([hidden])', { timeout: 8000 });
    assert.equal(await phone.$eval('#who', e => e.textContent), 'CASEY, LEE');
    if (phoneLoad) {
      await phone.click('.phone-load');
      await phone.fill('#step-form input[name=casesDelivered]', '400');
      await phone.fill('#step-form input[name=tractorIssues]', 'Check engine light');
      await phone.click('#step-form .ci-loaded label:has([value=YES])');
      if (SHOTS) await phone.screenshot({ path: path.join(SHOTS, 'phone-checkin-390.png') });
      const pf = await noScroll(phone);
      assert.ok(pf.scroll <= pf.inner && pf.width <= pf.innerWidth, 'the phone Check-In fits a 390x844 phone: ' + JSON.stringify(pf));
      await phone.click('#send');
      await phone.waitForSelector('.phone-load.done', { timeout: 8000 });
      if (SHOTS) await phone.screenshot({ path: path.join(SHOTS, 'phone-loads-390.png') });
      await ciMgr.goto(HOSTING + '/checkins.html?date=' + phoneLoad + '&testEmail=manager.test@uniteddairy.com');
      await ciMgr.waitForFunction(() => [...document.querySelectorAll('#rows tr')].some(tr => tr.children[0].textContent === '802' && /400/.test(tr.textContent) && /Check engine light/.test(tr.textContent)), null, { timeout: 8000 });
    }
    // The name and the code stay on the phone: it opens on the three choices, and Check-In needs no name again.
    await phone.reload();
    await phone.waitForSelector('#step-menu:not([hidden])', { timeout: 8000 });
    assert.match(await phone.textContent('#m-who'), /CASEY, LEE/);
    await phone.click('#m-checkin');
    await phone.waitForSelector('#step-loads:not([hidden])', { timeout: 8000 });
    assert.deepEqual([...ciMgr.errors, ...phone.errors], []);
    await Promise.all([ciMgr.close(), phone.close()]);
    results.push('Phone Check-In: a manager made the code; the phone took it once and the driver name once' + (phoneLoad ? ', CASEY checked in 802 (400 delivered, a truck problem) and Driver Check-ins showed it' : ' (today is outside the made-up weeks, so no load to check in)'));

    // Equipment: fits at both sizes; a dispatcher puts a truck down with a reason and back in service.
    for (const [w, h] of [[1920, 950], [1366, 650]]) {
      const eq = await openPage(browser, w, h, '/equipment.html?testEmail=dispatch.test@uniteddairy.com');
      await eq.waitForSelector('#rows tr[data-id="veh_truck_900001"]');
      const size = await noScroll(eq);
      assert.ok(size.scroll <= size.inner && size.width <= size.innerWidth, 'Equipment fits ' + w + 'x' + h + ': ' + JSON.stringify(size));
      assert.deepEqual(eq.errors, []);
      // Review item 40 (Joe 10/13): the last column is headed Action and "Put down" stays on one line.
      assert.equal(await eq.$eval('thead th:last-child', t => t.textContent), 'Action');
      assert.ok(await eq.$$eval('#rows [data-down]', b => b.every(x => x.getClientRects().length === 1 && x.offsetHeight < 40 && x.getBoundingClientRect().right <= x.closest('td').getBoundingClientRect().right + 1)), 'Put down on one line inside its column');
      if (w === 1366) {
        await eq.click('#rows tr[data-id="veh_truck_900002"] [data-down]');
        await eq.fill('#rows tr[data-id="veh_truck_900002"] [data-reason]', 'Flat tire');
        await eq.click('#rows tr[data-id="veh_truck_900002"] [data-down-save]');
        await eq.waitForFunction(() => /DOWN.*Flat tire/.test(document.querySelector('#rows tr[data-id="veh_truck_900002"]').textContent));
        if (SHOTS) await eq.screenshot({ path: path.join(SHOTS, 'equipment-' + w + '.png') });
        await eq.click('#rows tr[data-id="veh_truck_900002"] [data-up]');
        await eq.waitForFunction(() => /ACTIVE/.test(document.querySelector('#rows tr[data-id="veh_truck_900002"]').textContent), null, { timeout: 5000 });
      } else if (SHOTS) await eq.screenshot({ path: path.join(SHOTS, 'equipment-' + w + '.png') });
      await eq.close();
    }
    results.push('Equipment: fits at both sizes; a dispatcher put 900002 down for a flat tire and back in service');

    // A busy day: 32 loads (more than the 27 routes a day today) still fit with no scrolling, at both sizes.
    const busy = F.fakeSheets();
    const extra = [];
    for (let i = 0; i < 30; i++) {
      extra.push({ route: String(700 + i), routeId: 'rte_b' + i, runId: 'run_b' + i, days: { tue: { seq: 100 + i, driverId: 'drv_test_adams', driver: 'ADAMS, PAT', truckId: 'veh_truck_900001', truck: '900001', trailerId: 'veh_trailer_t_901', trailer: 'T-901' } } });
    }
    busy["'LIVE CURRENT WEEK'"] = F.liveTab('2026-10-04', '2026-10-04', F.weekRoutes('2026-10-04').concat(extra));
    await runTransfer({ db: db(), reader: F.fakeReader(busy), sources: F.SOURCES, now: () => new Date('2026-10-09T12:05:00Z') });
    for (const [w, h] of [[1920, 950], [1366, 650]]) {
      const page = await openPage(browser, w, h, '/daily.html?date=2026-10-05&testEmail=dispatch.test@uniteddairy.com');
      await page.waitForFunction(() => document.querySelectorAll('#rows tr[data-id]').length === 32);
      const size = await noScroll(page);
      assert.ok(size.scroll <= size.inner && size.width <= size.innerWidth, 'busy Daily fits ' + w + 'x' + h + ': ' + JSON.stringify(size));
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'daily-busy-' + w + '.png') });
      const wk = await openPage(browser, w, h, '/weekly.html?week=2026-10-04&testEmail=dispatch.test@uniteddairy.com');
      await wk.waitForFunction(() => document.querySelectorAll('#rows tr').length === 35);
      const ws = await noScroll(wk);
      if (SHOTS) await wk.screenshot({ path: path.join(SHOTS, 'weekly-busy-' + w + '.png') });
      assert.ok(ws.scroll <= ws.inner && ws.width <= ws.innerWidth, 'busy Weekly fits ' + w + 'x' + h + ': ' + JSON.stringify(ws));
      await page.close(); await wk.close();
    }
    results.push('a 32-load day and a 35-run week fit on one page at 1920x950 and 1366x650');

    // Route Distribution home, Drivers and Driver Check-ins fit one page at both sizes.
    for (const [w, h] of [[1920, 950], [1366, 650]]) {
      for (const [url, ready] of [['/distribution.html?testEmail=dispatch.test@uniteddairy.com', '[data-n="drivers.active"]:not(:empty)'],
        ['/drivers.html?testEmail=manager.test@uniteddairy.com', '#rows tr[data-id]'],
        ['/checkins.html?date=2026-10-06&testEmail=dispatch.test@uniteddairy.com', '#rows tr[data-index]']]) {
        const page = await openPage(browser, w, h, url);
        await page.waitForSelector(ready);
        await page.waitForTimeout(300);
        const size = await noScroll(page);
        assert.ok(size.scroll <= size.inner && size.width <= size.innerWidth, url + ' fits ' + w + 'x' + h + ': ' + JSON.stringify(size));
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, url.slice(1).split('.')[0] + '-' + w + '.png') });
        assert.deepEqual(page.errors, []);
        await page.close();
      }
    }
    const home = await openPage(browser, 1366, 650, '/distribution.html?testEmail=dispatch.test@uniteddairy.com');
    await home.waitForFunction(() => document.querySelector('[data-n="drivers.active"]').textContent === '3');
    await home.close();
    results.push('Route Distribution home, Drivers and Driver Check-ins fit on one page at 1920x950 and 1366x650');

    const roster = await openPage(browser, 1366, 650, '/drivers.html?testEmail=manager.test@uniteddairy.com');
    await roster.waitForSelector('#rows tr[data-id]');
    const firstNames = await roster.$$eval('#rows tr td.name', tds => tds.map(td => td.textContent.replace('RELIEF', '')));
    assert.deepEqual(firstNames.slice(0, 3), ['ADAMS, PAT', 'BROOK, SAM', 'CASEY, LEE'], 'seniority order');
    // Edit: rename, relief, new seniority date.
    await roster.click('#rows tr[data-id="drv_test_casey"] [data-edit]');
    await roster.fill('#d-name', 'Casey, Leigh');
    await roster.check('#d-relief');
    await roster.fill('#d-seniority', '2025-11-15');
    // Batch 5: an existing driver has no Save Driver button; each box saves when it is left.
    assert.equal(await roster.$('#d-save'), null, 'no Save Driver button on an existing driver');
    await roster.press('#d-seniority', 'Tab');
    assert.match(await roster.textContent('#rows tr[data-id="drv_test_casey"] td.name'), /CASEY, LEIGH\s*RELIEF/, 'shown at once');
    const casey = async () => (await db().collection('drivers').doc('drv_test_casey').get()).data();
    // Each box saves in turn, so wait for the last one (the seniority date).
    for (let i = 0; i < 100 && (await casey()).seniorityDate !== '2025-11-15'; i++) await roster.waitForTimeout(100);
    assert.equal((await casey()).name, 'CASEY, LEIGH');
    assert.equal((await casey()).reliefDriver, true);
    assert.equal((await casey()).seniorityDate, '2025-11-15');
    // Add a driver, then remove two with Remove in the Edit panel, pressed twice (they stay as Inactive). Joe 10/17: the select
    // boxes and the # count are gone; Employee ID is the first column.
    assert.deepEqual((await roster.$$eval('.sheet thead th', t => t.map(x => x.textContent.replace(/\u00ad/g, '')))).slice(0, 2), ['Employee ID', 'Driver']);
    assert.equal(await roster.$$eval('[data-select], #remove, #all', x => x.length), 0);
    await roster.click('#add');
    await roster.fill('#d-name', 'Evans, Kim');
    await roster.fill('#d-hire', '2019-04-01');
    await roster.fill('#d-seniority', '2019-04-01');
    await roster.fill('#d-truck', '900002');
    assert.equal(await roster.textContent('#d-save'), 'Add Driver');
    await roster.click('#d-save');
    await roster.waitForFunction(() => [...document.querySelectorAll('#rows td.name')].some(td => td.textContent === 'EVANS, KIM'));
    const kim = async () => (await db().collection('drivers').where('name', '==', 'EVANS, KIM').get()).docs.map(d => d.data())[0];
    for (let i = 0; i < 50 && !(await kim()); i++) await roster.waitForTimeout(100);
    assert.equal((await kim()).defaultTruckId, 'veh_truck_900002');
    await roster.waitForSelector('#rows tr[data-id="' + (await kim()).id + '"]');
    for (const id of [(await kim()).id, 'drv_test_brook']) {
      await roster.click('#rows tr[data-id="' + id + '"] [data-edit]');
      await roster.click('#d-remove');
      assert.equal(await roster.textContent('#d-remove'), 'Press again', 'one press does not remove');
      await roster.click('#d-remove');
      await roster.waitForFunction((i) => document.querySelector('#rows tr[data-id="' + i + '"]').classList.contains('off'), id);
    }
    for (let i = 0; i < 50 && (await kim()).status !== 'INACTIVE'; i++) await roster.waitForTimeout(100);
    assert.equal((await kim()).status, 'INACTIVE');
    const brook = async () => (await db().collection('drivers').doc('drv_test_brook').get()).data();
    for (let i = 0; i < 50 && (await brook()).unavailableReason !== 'Removed from operational roster'; i++) await roster.waitForTimeout(100);
    assert.equal((await db().collection('drivers').doc('drv_test_brook').get()).data().unavailableReason, 'Removed from operational roster');
    if (SHOTS) await roster.screenshot({ path: path.join(SHOTS, 'drivers-after-edits-1366.png') });
    // Typing a truck in the list saves it.
    await roster.fill('#rows tr[data-id="drv_test_adams"] [data-truck]', '900001');
    await roster.press('#rows tr[data-id="drv_test_adams"] [data-truck]', 'Enter');
    const adams = async () => (await db().collection('drivers').doc('drv_test_adams').get()).data();
    for (let i = 0; i < 50 && (await adams()).defaultTruckId !== 'veh_truck_900001'; i++) await roster.waitForTimeout(100);
    assert.equal((await adams()).defaultTruckId, 'veh_truck_900001');
    // Panel open while editing: still one page.
    await roster.click('#rows tr[data-id="drv_test_adams"] [data-edit]');
    const rs = await noScroll(roster);
    assert.ok(rs.scroll <= rs.inner && rs.width <= rs.innerWidth, 'Driver Roster with the edit panel fits 1366x650: ' + JSON.stringify(rs));
    if (SHOTS) await roster.screenshot({ path: path.join(SHOTS, 'drivers-edit-panel-1366.png') });
    await roster.close();
    const rosterView = await openPage(browser, 1366, 650, '/drivers.html?testEmail=dispatch.test@uniteddairy.com');
    await rosterView.waitForSelector('#rows tr[data-id]');
    await rosterView.waitForTimeout(500);
    assert.equal(await rosterView.$$eval('button[data-toggle]:not([disabled])', b => b.length), 0, 'a dispatcher sees the driver list read only');
    await rosterView.close();
    results.push('Driver Roster: a manager renamed a driver, set relief and seniority, added a driver, removed two (kept as Inactive), typed a truck; each shows at once and saves as one call; a dispatcher sees it read only');

    const ci = await openPage(browser, 1366, 650, '/checkins.html?date=2026-10-06&testEmail=dispatch.test@uniteddairy.com');
    await ci.waitForSelector('#rows tr[data-index]');
    const route = await ci.textContent('#rows tr[data-index="0"] td:first-child');
    await ci.click('#rows tr[data-index="0"]');
    await ci.fill('#ci-casesDelivered', '412');
    await ci.fill('#ci-driverCaseReturn', '3');
    await ci.fill('#ci-trailerIssues', 'Door seal torn');
    await ci.click('.popover [data-save]');
    await ci.waitForFunction(() => /412/.test(document.querySelector('#rows tr[data-index="0"]').textContent));
    const saved = async () => (await db().collection('runs').get()).docs.map(d => d.data()).find(r => r.route === route).days.tue;
    for (let i = 0; i < 50 && (await saved()).casesDelivered !== 412; i++) await ci.waitForTimeout(100);
    assert.equal((await saved()).casesDelivered, 412, 'check-in saved');
    assert.equal(await ci.textContent('#n-issues'), '1');
    if (SHOTS) await ci.screenshot({ path: path.join(SHOTS, 'checkins-after-entry-1366.png') });
    await ci.close();
    results.push('Driver Check-ins: a dispatcher entered a check-in for route ' + route + '; it shows at once and saved as one call');

    // With the write-back on: the badge says saves go to the sandbox sheet, and the conflict list is one click away.
    await db().collection('config').doc('app').set({ writeBack: { enabled: true } }, { merge: true });
    const batch = db().batch();
    // 40 different cells, plus the newest one refused 4 more times: the repeats are one line with one Checked button.
    for (let i = 0; i < 44; i++) {
      const route = String(802 + (i < 40 ? i : 39));
      batch.set(db().collection('conflicts').doc('test-conflict-' + String(i).padStart(2, '0')), { open: true, at: new Date(Date.parse('2026-10-09T12:00:00Z') + i * 60000).toISOString(),
        by: 'dispatch.test@uniteddairy.com', tab: 'LIVE CURRENT WEEK', route, run: 'TEST ' + route, column: 'tue_trailer', sheetValue: 'T-902', newValue: 'T-901',
        problem: 'changed in the sheet since the app last saw it; the sheet value was kept' });
    }
    await batch.commit();
    const withWb = await openPage(browser, 1366, 650, '/daily.html?date=2026-10-05&testEmail=dispatch.test@uniteddairy.com');
    await withWb.waitForSelector('#to-conflicts:not([hidden])');
    assert.equal(await withWb.textContent('#mode-text'), 'TEST COPY: SAVES GO TO THE SANDBOX SHEET');
    await withWb.close();
    for (const [w, h] of [[1920, 950], [1366, 650]]) {
      const page = await openPage(browser, w, h, '/conflicts.html?testEmail=dispatch.test@uniteddairy.com');
      await page.waitForFunction(() => document.querySelectorAll('#rows button.check').length === 40);
      const size = await noScroll(page);
      assert.ok(size.scroll <= size.inner && size.width <= size.innerWidth, 'Sheet Conflicts with 40 lines fits ' + w + 'x' + h + ': ' + JSON.stringify(size));
      assert.equal(await page.textContent('#rows tr:first-child td:nth-child(4)'), 'Tue trailer');
      assert.equal(await page.textContent('#rows tr:first-child button.check'), 'Checked (5)', 'the cell refused 5 times is one line');
      assert.match(await page.textContent('#rows tr:first-child td:first-child'), /5 times since/);
      assert.match(await page.textContent('#count'), /^44 open on 40 lines/);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'conflicts-' + w + '.png') });
      assert.deepEqual(page.errors, []);
      await page.close();
    }
    const checker = await openPage(browser, 1366, 650, '/conflicts.html?testEmail=dispatch.test@uniteddairy.com');
    await checker.waitForSelector('#rows button.check');
    const firstIds = (await checker.getAttribute('#rows button.check', 'data-ids')).split(' ');
    assert.equal(firstIds.length, 5);
    await checker.click('#rows button.check');
    const allChecked = async () => (await Promise.all(firstIds.map(id => db().collection('conflicts').doc(id).get()))).every(d => d.data().open === false);
    for (let i = 0; i < 80 && !(await allChecked()); i++) await checker.waitForTimeout(100);
    assert.ok(await allChecked(), 'one Checked saves every repeat of that cell');
    await checker.waitForFunction(() => document.querySelectorAll('#rows button.check').length === 39);
    await checker.close();
    results.push('Sheet Conflicts: 40 open lines fit on one page at both sizes; a cell refused 5 times is one line, and its one Checked saves all 5');

    // Back: closes what is open first (an opened driver), then a main screen goes Home. Home has no Back.
    const backPage = await openPage(browser, 1366, 768, '/drivers.html?testEmail=manager.test@uniteddairy.com');
    await backPage.waitForSelector('#rows tr td.name');
    assert.equal(await backPage.$('.sidemenu a[href="index.html"]'), null, 'Back takes the place of Home');
    await backPage.click('#rows tr td.name');
    await backPage.waitForSelector('#d-cancel');
    await backPage.click('#go-back');
    await backPage.waitForSelector('.split.closed');
    assert.match(backPage.url(), /drivers\.html/, 'first Back only closes the driver');
    // Joe 10/10: Back goes up one level: a Route Distribution screen goes to the Route Distribution page, and that page goes Home.
    await Promise.all([backPage.waitForURL(/distribution\.html/), backPage.click('#go-back')]);
    await backPage.waitForSelector('.cards');
    await Promise.all([backPage.waitForURL(/index\.html/), backPage.click('#go-back')]);
    await backPage.waitForSelector('.launch-card');
    assert.equal(await backPage.$('#go-back'), null, 'Home has no Back');
    await backPage.close();
    results.push('Back: closes an opened driver first, then goes up to Route Distribution, then Home; Home has no Back');

    // Driver Weekly Template: a manager makes ADAMS Available on Monday and Off on Tuesday, copies ADAMS's week onto CASEY's line
    // (review item 12: one Copy / Paste per driver line); each day saves as soon as it changes (batch 5: no Save Template).
    // (BROOK was removed above.)
    const tpl = await openPage(browser, 1920, 950, '/template.html?testEmail=manager.test@uniteddairy.com');
    const day = (d, p) => '.tcell[data-driver="' + d + '"][data-day="' + p + '"] select[data-status]';
    await tpl.waitForSelector(day('drv_test_adams', 'tue'));
    assert.equal(await tpl.$('#save'), null, 'batch 5: no Save Template button');
    await tpl.selectOption(day('drv_test_adams', 'mon'), 'AVAILABLE');
    await tpl.selectOption(day('drv_test_adams', 'tue'), 'OFF');
    await tpl.click('tr[data-line="drv_test_adams"] td.tpl-name [data-copy]');
    await tpl.click('tr[data-line="drv_test_casey"] td.tpl-name [data-paste]');
    // ADAMS Monday and Tuesday; CASEY Monday (802 comes off: Available like ADAMS) and Tuesday (Off like ADAMS).
    if (SHOTS) await tpl.screenshot({ path: path.join(SHOTS, 'template-1920.png') });
    const tplCells = await tpl.evaluate(async () => {
      const { start } = await import('./js/app.js');
      const { doc, getDoc } = await import('/js/firebase.js');
      const { db } = await start();
      const read = async () => [(await getDoc(doc(db, 'drivers', 'drv_test_adams'))).data().cells, (await getDoc(doc(db, 'drivers', 'drv_test_casey'))).data().cells];
      for (let i = 0; i < 100; i++) {
        const c = await read();
        if (c[0].tue_available === 'FALSE' && c[1].tue_available === 'FALSE' && JSON.parse(c[1].mon_assignments_json || '[]').length === 0) return c;
        await new Promise(r => setTimeout(r, 200));
      }
      return read();
    });
    assert.equal(tplCells[0].tue_available, 'FALSE');
    assert.equal(tplCells[1].tue_available, 'FALSE');
    assert.deepEqual(JSON.parse(tplCells[1].mon_assignments_json || '[]'), [], 'CASEY Monday has no run, like ADAMS');
    await tpl.waitForFunction(() => !document.querySelector('.tcell.changed'), null, { timeout: 10000 });
    assert.deepEqual(tpl.errors, []);
    const dispatcherTpl = await openPage(browser, 1366, 650, '/template.html?testEmail=dispatch.test@uniteddairy.com');
    await dispatcherTpl.waitForSelector('.tcell select[data-status]');
    assert.equal(await dispatcherTpl.isDisabled('.tcell select[data-status]'), true, 'a dispatcher sees the template read only');
    await Promise.all([tpl.close(), dispatcherTpl.close()]);
    // Fleet Service: the four tabs open with no page errors; Equipment's menu opens it in this window.
    const fs2 = await openPage(browser, 1920, 950, '/fleet.html?testEmail=manager.test@uniteddairy.com');
    await fs2.waitForSelector('.kpis div');
    for (const v of ['work', 'history', 'setup', 'due']) { await fs2.click('.tabs [data-view="' + v + '"]'); await fs2.waitForSelector('#sheet table'); }
    assert.equal(await fs2.textContent('#fs-print'), 'Print Fleet Service Report');
    assert.deepEqual(fs2.errors, []);
    await fs2.close();
    results.push('Fleet Service: Due, Work Orders, History and Setup open with no errors');
    // Joe 10/10: every screen, plant screens included, shows Back and Home together; Joe 10/10 evening: in the header, not the menu.
    // The drivers' no-account pages aside: the phone page and the Driver Room Check-In tablet (Joe 10/12, leaves only by
    // Release and the manager release code).
    const fsMod = require('fs'), pathMod = require('path');
    // Review item 49 (Joe 10/13): the Maintenance Station and Plant Performance are stations too: only the Release bar (checked below).
    const LOCKED = ['maint-station.html', 'plant-kiosk.html'];
    const pages = fsMod.readdirSync(pathMod.join(__dirname, '../../../public')).filter(f => f.endsWith('.html') && f !== 'route.html' && f !== 'driver-room.html' && LOCKED.indexOf(f) < 0);
    const bh = await openPage(browser, 1366, 768, '/index.html?testEmail=manager.test@uniteddairy.com');
    const missing = [];
    for (const pg of pages) {
      await bh.goto(bh.url().replace(/\/[a-z-]+\.html.*/, '/' + pg + '?testEmail=manager.test@uniteddairy.com'));
      // #go-home is drawn as the page loads; the screen shows once the sign-in is checked (later on the Safety Walkthrough's
      // screens, which open their on-device copy of the data first), so wait until it can be seen.
      await bh.waitForSelector('#go-home', { state: 'visible', timeout: 20000 }).catch(() => {});
      const seen = await bh.evaluate(() => ['go-back', 'go-home'].filter(id => { const e = document.getElementById(id); return e && e.getBoundingClientRect().width > 0; }));
      const want = pg === 'index.html' || pg === 'company.html' ? ['go-home'] : ['go-back', 'go-home'];
      if (want.some(id => seen.indexOf(id) < 0)) missing.push(pg + ': ' + seen.join(','));
    }
    assert.deepEqual(missing, [], 'every screen has Back and Home');
    for (const pg of LOCKED) {
      await bh.goto(bh.url().replace(/\/[a-z-]+\.html.*/, '/' + pg + '?testEmail=manager.test@uniteddairy.com'));
      await bh.waitForSelector('body.station-locked .station-release', { state: 'visible', timeout: 8000 });
      const shown = await bh.evaluate(() => ['go-back', 'go-home', 'signout'].filter(id => { const e = document.getElementById(id); return e && e.getBoundingClientRect().width > 0; }));
      assert.deepEqual(shown, [], pg + ' is locked: no Back, Home or Sign out, only Release');
    }
    results.push('Back and Home: all ' + pages.length + ' screens show both in the header (Home and the all-plants overview show Home)');
    // Joe 10/10: "move the action buttons all in a line up above": on every screen the action buttons sit in one row in the top
    // line, all the same size, above the tables; no action row is left down in the screen.
    const topBad = [];
    for (const pg of ['daily.html?date=2026-10-05', 'weekly.html?week=2026-10-04', 'routes.html?x=1', 'routeweek.html?x=1', 'drivers.html?x=1', 'vacations.html?x=1', 'template.html?x=1', 'equipment.html?x=1', 'fleet.html?x=1', 'otr.html?x=1', 'scorecard.html?x=1', 'ops.html?x=1', 'print.html?x=1', 'settings.html?x=1', 'maint.html?x=1']) {
      await bh.goto(bh.url().replace(/\/[a-z-]+\.html.*/, '/' + pg + '&testEmail=manager.test@uniteddairy.com'));
      await bh.waitForSelector('#screen:not([hidden]) .head', { timeout: 8000 });
      await bh.waitForTimeout(700);
      const r = await bh.evaluate(() => {
        const vis = e => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
        const head = document.querySelector('#screen .head'), hb = head.getBoundingClientRect();
        const stray = [...document.querySelectorAll('#screen .actions')].filter(a => vis(a) && !head.contains(a) && !a.closest('.modal, form, .soon-card, #view-calendar') && a.querySelector('button, a.button'));
        const tiles = [...head.querySelectorAll('.actions button, .actions a.button')].filter(b => vis(b) && !b.closest('.chips, .seg, .stepper') && !/^(prev|next)$/.test(b.id)).map(b => b.getBoundingClientRect());
        const table = [...document.querySelectorAll('#screen table')].find(vis);
        return { stray: stray.map(a => a.textContent.trim().slice(0, 40)), tiles: tiles.map(t => [Math.round(t.top), Math.round(t.width), Math.round(t.height)]), headBottom: Math.round(hb.bottom), tableTop: table ? Math.round(table.getBoundingClientRect().top) : null };
      });
      if (r.stray.length) topBad.push(pg + ': action row left in the screen: ' + r.stray.join(' / '));
      if (r.tiles.some(t => Math.abs(t[0] - r.tiles[0][0]) > 4 || t[2] !== r.tiles[0][2])) topBad.push(pg + ': buttons not one even row: ' + JSON.stringify(r.tiles));
      if (r.tableTop !== null && r.tableTop < r.headBottom - 8) topBad.push(pg + ': a table above the buttons');
    }
    assert.deepEqual(topBad, [], 'action buttons in one even row at the top');
    results.push('Action buttons: on 15 screens they sit in one even row in the top line, above the tables');
    await bh.close();
    // Joe 10/10 picked mock-up A: one row per unit with PM / Reefer, Annual Inspection and Plates side by side, Miles / hours now and Status, units that need something first.
    const fsB = await openPage(browser, 1920, 950, '/fleet.html?testEmail=manager.test@uniteddairy.com');
    await fsB.waitForSelector('table.fs-grid tbody tr');
    // Review item 41 (Joe 10/13): no empty column after Status; the Send to Garage column (headed Garage) shows only when a unit has something to send.
    const fsHeads = await fsB.$$eval('table.fs-grid thead th', t => t.map(x => x.textContent));
    assert.deepEqual(fsHeads.slice(0, 7), ['Unit', 'Type', 'PM / Reefer', 'Annual Inspection', 'Plates', 'Miles / hours now', 'Status']);
    // Joe 10/13: the screen says Annual Inspection, never DOT.
    assert.deepEqual(await fsB.evaluate(() => document.body.innerText.match(/\bDOT\b/g)), null, 'no DOT words on Fleet Service');
    assert.ok(fsHeads.length === 7 || (fsHeads.length === 8 && fsHeads[7] === 'Garage' && (await fsB.$$('table.fs-grid [data-send]')).length > 0), 'no empty column after Status: ' + JSON.stringify(fsHeads));
    assert.ok(await fsB.$eval('.fs-legend em', e => e.getBoundingClientRect().right <= e.closest('.fs-legend').getBoundingClientRect().right - 8), '"units need something" sits in from the right edge');
    assert.ok(await fsB.$$eval('table.fs-grid td.gc small, .fs-legend em', e => e.every(x => parseFloat(getComputedStyle(x).fontSize) >= 16)), 'the helper text is 16px');
    const fsRows = await fsB.$$eval('table.fs-grid tbody tr[data-unit]', r => r.map(x => [x.dataset.unit, x.dataset.worst]));
    assert.equal(new Set(fsRows.map(r => r[0])).size, fsRows.length, 'one row per unit');
    const rank = { OVERDUE: 0, AT_GARAGE: 1, DUE_SOON: 2, NO_MILES: 3, SET_UP: 4, OK: 5 };
    assert.ok(fsRows.every((r, i) => i === 0 || rank[fsRows[i - 1][1]] <= rank[r[1]]), 'units that need something come first: ' + JSON.stringify(fsRows.slice(0, 8)));
    assert.match(await fsB.textContent('.fs-legend em'), /of \d+ units need something/);
    assert.deepEqual(fsB.errors, []);
    await fsB.close();
    results.push('Fleet Service (mock-up A): one row per unit, PM / Reefer, Annual Inspection, Plates, Miles / hours now and Status, units that need something first');
    // Over the Road: a manager marks route 801 Carrier Pickup, picks its By Date column (SAL), ticks it in OTR Routes Setup and types a
    // month's figures on Recap; Tuesday 10/6 counts it. Then Joe's workbook tabs: By Date, Month Recap and Cost Per Gallon.
    const otr = await openPage(browser, 1920, 950, '/otr.html?view=routes&testEmail=manager.test@uniteddairy.com');
    await otr.waitForSelector('[data-by="run_t801"]');
    await otr.selectOption('[data-by="run_t801"]', 'Carrier Pickup');
    await otr.waitForFunction(() => !document.querySelector('[data-col="run_t801"]').disabled);
    await otr.selectOption('[data-col="run_t801"]', 'SAL');
    await otr.waitForFunction(() => !document.querySelector('[data-inc="run_t801"]').disabled);
    await otr.check('[data-inc="run_t801"]');
    await otr.waitForSelector('tr.otr-on [data-inc="run_t801"]');
    await otr.click('.tabs [data-view="figures"]');
    await otr.fill('.otr-in[data-m="9"][data-k="gallons_sold"]', '1000000');
    await otr.press('.otr-in[data-m="9"][data-k="gallons_sold"]', 'Tab');
    await otr.fill('.otr-in[data-m="9"][data-k="distribution_cost"]', '400000');
    await otr.press('.otr-in[data-m="9"][data-k="distribution_cost"]', 'Tab');
    await otr.waitForFunction(() => /\$0\.400/.test(document.querySelector('.otr-in[data-m="9"]').closest('tr').textContent), null, { timeout: 5000 });
    // Joe 10/13: money boxes read like $400,000.00, gallons get commas, and last year's gray numbers show only when asked for.
    await otr.waitForFunction(() => document.querySelector('.otr-in[data-m="9"][data-k="distribution_cost"]').value === '$400,000.00', null, { timeout: 5000 });
    assert.equal(await otr.inputValue('.otr-in[data-m="9"][data-k="gallons_sold"]'), '1,000,000');
    assert.equal(await otr.$$eval('table.otr-fig small', s => s.length), 0, 'no last-year numbers until Compare to last year is ticked');
    await otr.check('#otr-compare');
    await otr.waitForFunction(() => document.querySelectorAll('table.otr-fig small').length > 0, null, { timeout: 5000 });
    await otr.uncheck('#otr-compare');
    const otrSaved = await otr.evaluate(async () => {
      const { start } = await import('./js/app.js');
      const { doc, getDoc } = await import('/js/firebase.js');
      const { db } = await start();
      for (let i = 0; i < 20; i++) { const a = (await getDoc(doc(db, 'otrRoutes', 'run_t801'))).data(), b = (await getDoc(doc(db, 'otrMonthly', new Date().getFullYear() + '-09'))).data(); if (a && b && b.distribution_cost === 400000) return [a, b]; await new Promise(r => setTimeout(r, 250)); }
      return null;
    });
    assert.ok(otrSaved, 'the tick and both figures saved');
    assert.equal(otrSaved[0].deliveredBy, 'Carrier Pickup');
    assert.equal(otrSaved[0].destination, 'SAL', 'the run counts in the By Date column picked for it');
    await otr.click('.tabs [data-view="dash"]');
    await otr.waitForSelector('.otr-week');
    // Review items 16-17 (Joe 10/13): no Month Recap / OTR Routes Setup buttons under the tabs; dates read 10-8-26.
    assert.equal(await otr.$$eval('#bar [data-go]', b => b.length), 0);
    assert.match(await otr.textContent('#bar .hint'), /^\d{1,2}-\d{1,2}-\d\d · /);
    assert.ok((await otr.$$eval('.otr-week small', s => s.map(x => x.textContent))).every(t => /^\d{1,2}-\d{1,2}-\d\d$/.test(t)));
    await otr.click('.tabs [data-view="report"]');
    await otr.waitForSelector('#otr-report table');
    assert.equal(await otr.$$eval('#otr-report thead tr:first-child th:not(.gap)', ths => ths.map(t => t.textContent).join(' ')), 'Trip Dec Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec', 'Month Recap: last December, then January to December');
    await otr.click('.tabs [data-view="bydate"]');
    await otr.waitForSelector('table.otr-bydate');
    assert.equal(await otr.$$eval('table.otr-bydate thead th', ths => ths.length), 24, 'By Date: Date, the 21 workbook columns, Total and Comment');
    await otr.click('.tabs [data-view="cpg"]');
    await otr.waitForSelector('table.otr-cpg');
    assert.match(await otr.textContent('table.otr-cpg'), /\$0\.40000/, 'Cost Per Gallon shows the month typed on Recap');
    // Joe 10/13: OTR Routes Setup adds a By Date column of his own (Darden) and fixes a run's round-trip miles in Route Master.
    await otr.click('.tabs [data-view="routes"]');
    await otr.click('#otr-cols');
    await otr.fill('#otr-col-new', 'Darden');
    await otr.click('#otr-col-add');
    await otr.waitForFunction(() => [...document.querySelectorAll('[data-col="run_t801"] option')].some(o => o.value === 'Darden'), null, { timeout: 5000 });
    await otr.waitForSelector('[data-col-remove]', { timeout: 5000 });
    await otr.click('[data-miles="run_t801"]');
    await otr.fill('[data-miles-in="run_t801"]', '412');
    // Batch 5: no Save button; the miles save when the box is left.
    assert.equal(await otr.$('[data-miles-save]'), null, 'no Save button by the miles');
    await otr.press('[data-miles-in="run_t801"]', 'Tab');
    // The routes table is drawn again after the save, so the button can be missing for a moment: wait until it is back with 412.
    await otr.waitForFunction(() => (document.querySelector('[data-miles="run_t801"]') || {}).textContent === '412', null, { timeout: 5000 });
    const otrMore = await otr.evaluate(async () => {
      const { start } = await import('./js/app.js');
      const { doc, getDoc } = await import('/js/firebase.js');
      const { db } = await start();
      for (let i = 0; i < 20; i++) {
        const c = (await getDoc(doc(db, 'otrColumns', 'DARDEN'))).data(), r = (await getDoc(doc(db, 'routes', 'run_t801'))).data();
        const miles = r && Object.values(r.days || {}).map(d => d && d.miles).filter(m => m != null);
        if (c && miles.length && miles.every(m => m === 412)) return { column: c.name, miles };
        await new Promise(res => setTimeout(res, 250));
      }
      return null;
    });
    assert.ok(otrMore, 'the Darden column and the 412 miles saved');
    assert.equal(otrMore.column, 'Darden');
    await otr.click('.tabs [data-view="bydate"]');
    await otr.waitForSelector('table.otr-bydate');
    assert.ok((await otr.$$eval('table.otr-bydate thead th', ths => ths.map(t => t.textContent))).includes('Darden'), 'By Date shows the column added in OTR Routes Setup');
    await otr.click('.tabs [data-view="routes"]');
    // The By Date Columns box stays open from before; the button opens or closes it.
    await otr.waitForSelector('#otr-cols');
    if (!(await otr.$('.otr-cols'))) await otr.click('#otr-cols');
    // A rename saves when its box is left (batch 5: no Save button).
    await otr.click('[data-col-rename]');
    assert.equal(await otr.$('[data-col-save]'), null, 'no Save button by the new name');
    await otr.fill('[data-rename]', 'Darden Foods');
    await otr.press('[data-rename]', 'Tab');
    await otr.waitForFunction(() => [...document.querySelectorAll('[data-col="run_t801"] option')].some(o => o.value === 'Darden Foods'), null, { timeout: 5000 });
    await otr.click('[data-col-remove]');
    await otr.waitForFunction(() => ![...document.querySelectorAll('[data-col="run_t801"] option')].some(o => /^Darden/.test(o.value)), null, { timeout: 5000 });
    assert.deepEqual(otr.errors, []);
    await otr.close();
    results.push('Over the Road: a manager ticked 801 (Carrier Pickup) and typed September figures (cost per gallon $0.400); Dashboard and Report open; Darden column added and removed; 801 miles fixed to 412');
    // Driver Scorecard: the month board, a driver's misses, the year and Settings open with no errors; a manager changes a point value.
    const sc = await openPage(browser, 1920, 950, '/scorecard.html?testEmail=manager.test@uniteddairy.com');
    await sc.waitForSelector('.sc-board');
    // Review items 18 and 60 (Joe 10/13): no empty "later" columns, and the month reads like Oct 26.
    // Joe 10/13 (GPS, then "I just want to see the driver"): the driver, a grade for each area, the overall score (scorecard-gps.cjs).
    // Joe 10/13: sleepers, seatbelt, fuel, accidents and complaints joined (long headings may break with a soft hyphen).
    assert.deepEqual(await sc.$$eval('table.sc-board thead th', t => t.map(x => x.textContent.replace(/\u00ad/g, ''))), ['#', 'Driver', 'Check-in', 'Cases', 'Inspections', 'Attendance', 'Speeding', 'Hard Stops', 'Idling', 'Seatbelt', 'Fuel MPG', 'Time', 'Truck Clean', 'Accidents', 'Complaints', 'PDA', 'Overall']);
    assert.match(await sc.textContent('.sc-period'), /^[A-Z][a-z]{2} \d\d$/);
    await sc.click('.tabs [data-mode="year"]');
    await sc.waitForSelector('.sc-board');
    await sc.click('.tabs [data-mode="settings"]');
    await sc.waitForFunction(() => document.querySelector('.sc-n[data-k="callOff"]') && !document.querySelector('.sc-n[data-k="callOff"]').disabled);
    await sc.fill('.sc-n[data-k="callOff"]', '5');
    await sc.press('.sc-n[data-k="callOff"]', 'Tab');
    const scSaved = await sc.evaluate(async () => {
      const { start } = await import('./js/app.js');
      const { doc, getDoc } = await import('/js/firebase.js');
      const { db } = await start();
      for (let i = 0; i < 20; i++) { const d = (await getDoc(doc(db, 'scorecard', 'settings'))).data(); if (d && d.callOff === 5) return d; await new Promise(r => setTimeout(r, 250)); }
      return null;
    });
    assert.ok(scSaved, 'the call-off points saved');
    assert.deepEqual(sc.errors, []);
    await sc.close();
    results.push('Driver Scorecard: Month, Year and Settings open; a manager set call-offs to 5 points and it saved');
    // Dispatch Administration: the current app's cards; a built screen opens in this window. Joe 10/10: it opens from the menu
    // (Administration section); the Route Editor has no Dispatch Administration button.
    const adm = await openPage(browser, 1920, 950, '/routes.html?testEmail=manager.test@uniteddairy.com');
    await adm.waitForSelector('.sidemenu .side-sec-btn[title="Administration"]');
    assert.equal(await adm.$('#to-admin'), null, 'no Dispatch Administration button on the Route Editor');
    await adm.hover('.sidemenu .side-sec-btn[title="Administration"]');
    await adm.waitForSelector('.side-flyouts .flyout.open a[href="admin.html"]', { state: 'visible' });
    await Promise.all([adm.waitForURL(/admin\.html/), adm.click('.side-flyouts .flyout.open a[href="admin.html"]')]);
    await adm.waitForSelector('.admin-card');
    assert.equal(await adm.$$eval('.admin-card', a => a.length), 13, 'one card per screen (review item 13), Go-Live Switches too (batch 8)');
    assert.equal(await adm.$$eval('.admin-card:not([hidden])', a => a.length), 12, 'Go-Live Switches shows only to Administrators');
    assert.equal(await adm.$$eval('.admin-card[target="_blank"]', a => a.length), 0, 'no card opens a new window');
    await Promise.all([adm.waitForURL(/template\.html/), adm.click('.admin-card[href="template.html"]')]);
    await adm.waitForSelector('.tcell');
    assert.deepEqual(adm.errors, []);
    await adm.close();
    results.push('Dispatch Administration: 13 cards, one per screen, opened from the menu; Driver Weekly Template opens in the same window');
    // Joe 10/10: Print Layouts took him into the old program. Every Dispatch Administration card opens a new-app screen; Operational
    // Assignments, Print Layouts and Dispatch Settings are built here, and an active assignment is a driver choice on Daily.
    const ops = await openPage(browser, 1920, 950, '/admin.html?testEmail=manager.test@uniteddairy.com');
    await ops.waitForSelector('.admin-card');
    assert.deepEqual(await ops.$$eval('.admin-card', a => a.filter(x => !/^[a-z]+\.html/.test(x.getAttribute('href')) || x.textContent.includes('current app')).map(x => x.textContent)), [], 'no card leaves the new app');
    for (const [name, page, sel] of [['Print Layouts', 'print', '#sheets .pl-item'], ['Dispatch Settings', 'settings', '#owners tr'], ['Operational Assignments', 'ops', '#rows tr[data-name]']]) {
      await ops.goto(ops.url().replace(/\/[a-z]+\.html.*/, '/admin.html?testEmail=manager.test@uniteddairy.com'));
      await ops.waitForSelector('.admin-card');
      await Promise.all([ops.waitForURL(new RegExp('/' + page + '\\.html')), ops.click('.admin-card:has-text("' + name + '")')]);
      await ops.waitForSelector(sel);
    }
    assert.deepEqual(await ops.$$eval('#rows tr[data-name]', r => r.map(x => x.dataset.name)), ['Carrier', 'Fairmont', 'Marietta', 'Martins Ferry']);
    await ops.waitForFunction(() => !document.getElementById('add').disabled);
    await ops.click('#add');
    await ops.fill('#new-name', 'Beckley');
    await ops.press('#new-name', 'Enter');
    await ops.waitForSelector('#rows tr[data-name="Beckley"]');
    await ops.click('#rows tr[data-name="Marietta"] [data-active]');
    await ops.waitForSelector('#rows tr.off[data-name="Marietta"]');
    await ops.waitForFunction(() => document.querySelector('#rows tr[data-name="Beckley"] td.muted').textContent.includes('manager'), null, { timeout: 8000 });
    assert.deepEqual(ops.errors, []);
    const cvgDaily = await openPage(browser, 1920, 950, '/daily.html?date=2026-10-05&testEmail=dispatch.test@uniteddairy.com');
    await cvgDaily.waitForSelector('tr[data-id="2026-10-04__run_t802|tue"] td[data-edit="driver"]');
    await cvgDaily.dblclick('tr[data-id="2026-10-04__run_t802|tue"] td[data-edit="driver"]');
    const cvg = await cvgDaily.$$eval('.cell-pop h6 ~ [data-i]', o => o.filter(x => /^OTHER CVG/.test([...x.parentNode.querySelectorAll('h6')].filter(h => h.compareDocumentPosition(x) & 4).pop().textContent)).map(x => x.textContent));
    assert.deepEqual(cvg, ['Carrier', 'Fairmont', 'Martins Ferry', 'Beckley'], 'active assignments are driver choices: ' + cvg.join(', '));
    await cvgDaily.keyboard.press('Escape');
    assert.deepEqual(cvgDaily.errors, []);
    await cvgDaily.close();
    await ops.goto(ops.url().replace(/\/[a-z]+\.html.*/, '/maint.html?testEmail=manager.test@uniteddairy.com'));
    await ops.waitForSelector('#to-garage-station');
    await Promise.all([ops.waitForURL(/garage-station\.html/), ops.click('#to-garage-station')]);
    await ops.waitForFunction(() => document.getElementById('title').textContent === 'Garage Station');
    assert.deepEqual(ops.errors, []);
    await ops.close();
    results.push('Dispatch Administration: no card leaves the new app; Print Layouts, Dispatch Settings and Operational Assignments open here; a manager added Beckley and turned Marietta off, and Daily offers the active ones under Other CVG / Carriers; Garage Station opens the new Garage Station screen (Joe 10/10)');
    // Joe 10/10: Daily and Weekly each have a tile to the other (same window, same week); the menu's Driver Assignment Board opens Weekly at the board.
    const hop = await openPage(browser, 1920, 950, '/daily.html?date=2026-10-05&testEmail=dispatch.test@uniteddairy.com');
    await hop.waitForSelector('#go-weekly[href*="week=2026-10-06"]');
    await Promise.all([hop.waitForURL(/weekly\.html\?week=2026-10-04/), hop.click('#go-weekly')]);
    await hop.waitForSelector('#rows tr');
    assert.equal(await hop.$$eval('#legend i.assigned', a => a.length), 0, 'no Assigned key');
    await hop.waitForSelector('#go-daily[href*="daily.html?date="]');
    await Promise.all([hop.waitForURL(/daily\.html\?date=2026-10-0[3-9]/), hop.click('#go-daily')]);
    await hop.waitForSelector('#go-weekly');
    await hop.goto(hop.url().replace(/daily\.html\?[^#]*/, 'weekly.html?week=2026-10-04&testEmail=dispatch.test@uniteddairy.com') + '#board');
    await hop.waitForFunction(() => document.body.dataset.view === 'board' && document.getElementById('board-panel').getBoundingClientRect().top < innerHeight, null, { timeout: 8000 });
    assert.deepEqual(hop.errors, []);
    await hop.close();
    results.push('Daily and Weekly: a tile on each opens the other for the same week in this window; Weekly has no Assigned key; Menu > Driver Assignment Board opens Weekly at the board');
    // Joe 10/10: a menu fly-out draws above the screen (tables, cards, pop-ups), with the menu open and folded, on Daily and Manager Center
    // (Fleet & Maintenance lists its screens straight in the menu since 10/10 evening, so Equipment has no fly-out).
    for (const url of ['/daily.html?date=2026-10-05', '/manager.html?x=1']) {
      for (const folded of [false, true]) {
        const fly = await openPage(browser, 1920, 950, url + '&testEmail=dispatch.test@uniteddairy.com');
        await fly.waitForSelector('.sidemenu .side-sec');
        if (folded) await fly.evaluate(() => document.body.classList.add('side-folded'));
        const sec = fly.locator('.sidemenu .side-sec').first();
        await sec.hover();
        await fly.waitForSelector('.side-flyouts .flyout.open', { state: 'visible' });
        const covered = await fly.evaluate(() => {
          const f = document.querySelector('.side-flyouts .flyout.open'), r = f.getBoundingClientRect(), bad = [];
          for (const fx of [0.25, 0.5, 0.85]) for (const fy of [0.2, 0.5, 0.8]) {
            const x = r.left + r.width * fx, y = r.top + r.height * fy, hit = document.elementFromPoint(x, y);
            if (!hit || !f.contains(hit)) bad.push(Math.round(x) + ',' + Math.round(y) + ' ' + (hit ? hit.tagName + '.' + hit.className : 'none'));
          }
          return bad;
        });
        assert.deepEqual(covered, [], url + (folded ? ' folded' : '') + ': the fly-out is drawn over the screen');
        assert.equal(await fly.$$eval('.sidemenu .flyout', f => f.length), 0, 'fly-outs live in their own layer, not inside the menu');
        if (!folded && url.startsWith('/daily')) await Promise.all([fly.waitForURL(/weekly\.html/), fly.click('.side-flyouts .flyout.open a[href="weekly.html"]')]);
        assert.deepEqual(fly.errors, []);
        await fly.close();
      }
    }
    results.push('Menu fly-outs draw above the screen on Daily Dispatch and Manager Center, with the menu open and folded');
    // Joe 10/10: the menu is a slim icon strip until the mouse is over it; then it opens over the screen (nothing moves), a
    // section's screens open beside it, and leaving folds it again. The menu button pins it open; a tablet tap opens it first.
    const rail = await openPage(browser, 1920, 950, '/daily.html?date=2026-10-05&testEmail=dispatch.test@uniteddairy.com');
    await rail.waitForSelector('.sidemenu .side-sec');
    const box = () => rail.evaluate(() => ({ menu: Math.round(document.querySelector('.sidemenu').getBoundingClientRect().width), main: Math.round(document.querySelector('.side-main').getBoundingClientRect().left) }));
    const folded = await box();
    assert.ok(folded.menu <= 70, 'folded to icons: ' + JSON.stringify(folded));
    await rail.hover('.sidemenu .side-sec-btn[title="Drivers"]');
    await rail.waitForSelector('.side-flyouts .flyout.open', { state: 'visible' });
    const peeked = await box();
    assert.ok(peeked.menu >= 190, 'opens on hover: ' + JSON.stringify(peeked));
    assert.equal(peeked.main, folded.main, 'the screen does not move when the menu opens');
    assert.equal(await rail.evaluate(() => getComputedStyle(document.querySelector('.sidemenu .side-sec-btn span')).display !== 'none'), true, 'names show when open');
    const flyLeft = await rail.$eval('.side-flyouts .flyout.open', f => f.getBoundingClientRect().left);
    assert.ok(flyLeft >= peeked.menu - 2, 'the fly-out sits beside the open menu: ' + flyLeft);
    await rail.hover('.side-flyouts .flyout.open a[href="drivers.html"]');
    assert.ok((await box()).menu >= 190, 'stays open while the mouse is on the fly-out');
    await rail.mouse.move(1400, 600);
    await rail.waitForFunction(() => document.querySelector('.sidemenu').getBoundingClientRect().width <= 70 && !document.querySelector('.side-flyouts .flyout.open'));
    await rail.click('.sidemenu .side-toggle');
    await rail.mouse.move(1400, 600);
    await rail.waitForTimeout(400);
    const pinned = await box();
    assert.ok(pinned.menu >= 190 && pinned.main >= pinned.menu, 'pinned open beside the screen: ' + JSON.stringify(pinned));
    // Joe 10/11: the open menu ends with the version line (the deploy stamps it; a local copy says so), in 16px text.
    await rail.waitForFunction(() => /\S/.test((document.querySelector('.sidemenu .side-version') || {}).textContent || ''));
    const ver = await rail.$eval('.sidemenu .side-version', el => ({ text: el.textContent, size: getComputedStyle(el).fontSize, last: el === el.parentNode.lastElementChild, seen: el.getBoundingClientRect().height > 0 }));
    assert.deepEqual(ver, { text: 'Test copy on this computer', size: '16px', last: true, seen: true }, 'the version line closes the open menu');
    await rail.reload();
    await rail.waitForSelector('.sidemenu .side-sec');
    assert.ok((await box()).menu >= 190, 'the pin is remembered');
    await rail.click('.sidemenu .side-toggle');
    await rail.mouse.move(1400, 600);
    await rail.waitForFunction(() => document.querySelector('.sidemenu').getBoundingClientRect().width <= 70);
    assert.deepEqual(rail.errors, []);
    await rail.close();
    const tab = await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true });
    const tp = await tab.newPage();
    await tp.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) }));
    await tp.goto(HOSTING + '/daily.html?date=2026-10-05&testEmail=dispatch.test@uniteddairy.com');
    await tp.waitForSelector('.sidemenu a.side-name');
    await tp.tap('.sidemenu a.side-name');
    await tp.waitForFunction(() => document.querySelector('.sidemenu').getBoundingClientRect().width >= 190);
    // The second tap waits until the menu has finished opening (open, and the same width twice running), so it lands on the
    // opened menu and not while the strip is still widening.
    await tp.waitForFunction(() => { const w = Math.round(document.querySelector('.sidemenu').getBoundingClientRect().width), ok = document.body.classList.contains('side-open') && w === window.__menuW; window.__menuW = w; return ok; }, null, { polling: 150 });
    assert.match(tp.url(), /daily\.html/, 'the first tap only opens the menu');
    await Promise.all([tp.waitForURL(/distribution\.html/), tp.tap('.sidemenu a.side-name')]);
    await tab.close();
    results.push('Menu: a slim icon strip that opens over the screen on hover (screen does not move), fly-outs beside it, folds when the mouse leaves; the menu button pins it open and is remembered and ends with the version line; a tablet tap opens it before picking');
    // Joe 10/10: a menu click always opens the screen's own first view (first tab), never the last one used.
    // Joe 10/17: except the week: Weekly keeps the week he picked (date-keep.cjs).
    let dv = await openPage(browser, 1920, 950, '/weekly.html?testEmail=dispatch.test@uniteddairy.com');
    await dv.waitForSelector('#rows tr');
    const thisWeek = new URL(dv.url()).searchParams.get('week');
    await dv.evaluate(() => { location.hash = 'board'; });
    await dv.waitForFunction(() => document.body.dataset.view === 'board');
    await dv.click('#next');
    await dv.waitForFunction((w) => new URL(location.href).searchParams.get('week') !== w, thisWeek);
    const pickedWeek = new URL(dv.url()).searchParams.get('week');
    // (The test sign-in rides on the address, so the menu link carries it here.)
    const viaMenu = async (href, who) => {
      const moved = dv.waitForEvent('framenavigated', f => f === dv.mainFrame());
      await dv.$eval('.sidemenu a[href="' + href + '"], .side-flyouts a[href="' + href + '"]', (a, who) => { a.href = a.getAttribute('href') + '?testEmail=' + who; a.click(); }, who);
      await moved;
      await dv.waitForLoadState('load');
    };
    await viaMenu('weekly.html', 'dispatch.test@uniteddairy.com');
    await dv.waitForSelector('#rows tr');
    assert.equal(await dv.evaluate(() => document.body.dataset.view), 'routes', 'Weekly opens on Route / Run Assignments');
    assert.equal(new URL(dv.url()).searchParams.get('week'), pickedWeek, 'Weekly opens on the week picked');
    assert.deepEqual(dv.errors, []);
    await dv.close();
    for (const [pg, pick] of [['fleet.html', '[role="tab"][data-view="history"]'], ['vacations.html', '[role="tab"][data-view="calendar"]'], ['otr.html', '[role="tab"][data-view="figures"]']]) {
      dv = await openPage(browser, 1920, 950, '/' + pg + '?testEmail=manager.test@uniteddairy.com');
      await dv.waitForSelector('#screen:not([hidden]) ' + pick, { state: 'visible' });
      await dv.click(pick);
      await viaMenu(pg, 'manager.test@uniteddairy.com');
      await dv.waitForSelector('#screen:not([hidden]) [role="tab"][aria-selected="true"]', { state: 'visible' });
      assert.equal(await dv.$eval('[role="tab"][aria-selected="true"]', t => t === t.parentElement.querySelector('[role="tab"]')), true, pg + ' opens on its first tab');
      assert.deepEqual(await dv.evaluate(() => Object.keys(localStorage).filter(k => k !== 'udSidePinned')), [], pg + ' keeps no last-used view');
      assert.deepEqual(dv.errors, []);
      await dv.close();
    }
    results.push('Menu clicks open each screen\'s first view: Weekly on Route / Run Assignments (on the week he picked, Joe 10/17), Fleet Service, Vacations and Over the Road on their first tab');
    // Joe 10/10: Equipment leaves off inactive units that are not down, and shows each unit's default runs Sun to Sat (Route Master).
    await db().collection('equipment').doc('veh_trailer_t_904').set({ id: 'veh_trailer_t_904', type: 'TRAILER', unit: 'T-904', status: 'INACTIVE', location: 'UNIONTOWN', notes: 'External Fleet: 2001 | GREAT DANE' });
    const eqd = await openPage(browser, 1920, 950, '/equipment.html?testEmail=dispatch.test@uniteddairy.com');
    await eqd.waitForSelector('#rows tr[data-id="veh_truck_900001"]');
    assert.deepEqual(await eqd.$$eval('thead th.eq-day', t => t.map(x => x.textContent)), ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    assert.equal(await eqd.$eval('#rows tr[data-id="veh_truck_900001"] td:nth-child(6)', td => td.textContent), '801', '900001 runs 801 on Monday by default');
    assert.equal(await eqd.$eval('#rows tr[data-id="veh_trailer_t_901"] td:nth-child(6)', td => td.textContent), '801');
    assert.equal(await eqd.$('#rows tr[data-id="veh_trailer_t_904"]'), null, 'an inactive unit that is not down is left off');
    assert.equal(/External Fleet/.test(await eqd.$eval('#rows', t => t.textContent)), false);
    assert.deepEqual(eqd.errors, []);
    await eqd.close();
    await db().collection('equipment').doc('veh_trailer_t_904').delete();
    results.push('Equipment: Sun to Sat show each unit\'s default runs from Route Master; an inactive unit that is not down is left off');
    // Joe 10/10: the fleet list syncs every night; a manager sees Sync fleet list and when it last ran, a dispatcher does not.
    await db().collection('config').doc('fleetSync').set({ ok: true, at: '2026-10-11T06:00:00.000Z', by: 'nightly', added: ['T-950'], inactive: ['900002'], back: [], changed: [] });
    const eqm = await openPage(browser, 1920, 950, '/equipment.html?testEmail=manager.test@uniteddairy.com');
    await eqm.waitForSelector('#fleet-sync:not([hidden])');
    await eqm.waitForFunction(() => /synced 10-11-26 2:00/.test(document.getElementById('fleet-synced').textContent));
    assert.match(await eqm.textContent('#fleet-synced'), /1 added, 1 off the list/);
    await eqm.click('#fleet-sync');
    // The test project names no sandbox Equipment Master copy, so the server says so on the line (no pop-up).
    await eqm.waitForFunction(() => /not set up here/.test(document.getElementById('fleet-synced').textContent));
    assert.equal(await eqm.$eval('#fleet-synced', x => x.className), 'bad');
    // Joe 10/12 ("Yes, preview first"): Preview fleet sync lists every change by plant, with why a unit comes off; nothing is written.
    await db().collection('config').doc('fleetSyncPreview').set({ ok: true, preview: true, at: '2026-10-12T19:45:00.000Z', by: 'manager.test@uniteddairy.com', changes: [
      { unit: 'T-095', plant: 'Charleston', row: 4, field: 'Status', from: 'INACTIVE', to: 'ACTIVE', kind: 'back', why: '' },
      { unit: 'T-10212', plant: 'Uniontown', row: 7, field: 'Status', from: 'ACTIVE', to: 'INACTIVE', kind: 'inactive', why: 'Fleet list: Marietta OH Branch' },
      { unit: '9715', plant: 'Charleston', row: 9, field: 'Status', from: 'ACTIVE', to: 'INACTIVE', kind: 'inactive', why: 'Yard truck on the fleet list' }] });
    await eqm.waitForSelector('#fleet-preview:not([hidden])');
    await eqm.click('#fleet-preview');
    await eqm.waitForSelector('#fp-rows tr');
    assert.equal(await eqm.$$eval('#fp-rows tr', r => r.length), 3);
    assert.match(await eqm.textContent('#fp-modal'), /Nothing has been changed/);
    assert.match(await eqm.textContent('#fp-sum'), /Charleston\s*1 back on the list, 1 off the list/);
    assert.match(await eqm.textContent('#fp-rows'), /Fleet list: Marietta OH Branch/);
    await eqm.click('[data-fp="Uniontown"]');
    assert.equal(await eqm.$$eval('#fp-rows tr', r => r.length), 1);
    assert.equal(await eqm.$eval('#fp-csv', b => b.disabled), false, 'the list can be downloaded');
    assert.ok(await eqm.$eval('#fp-rows td', td => parseFloat(getComputedStyle(td).fontSize) >= 16), 'text at least 16px');
    await eqm.click('#fp-close');
    assert.equal(await eqm.$eval('#fp-modal', m => m.hidden), true);
    await db().collection('config').doc('fleetSyncPreview').delete();
    await eqm.close();
    const eqv = await openPage(browser, 1920, 950, '/equipment.html?testEmail=dispatch.test@uniteddairy.com');
    await eqv.waitForSelector('#rows tr[data-id="veh_truck_900001"]');
    assert.equal(await eqv.$eval('#fleet-sync', b => b.hidden), true, 'a dispatcher has no Sync button');
    assert.equal(await eqv.$eval('#fleet-preview', b => b.hidden), true, 'a dispatcher has no Preview button');
    assert.match(await eqv.textContent('#fleet-synced'), /Fleet list synced/);
    await eqv.close();
    await db().collection('config').doc('fleetSync').delete();
    results.push('Equipment: a manager sees Sync fleet list with when it last synced; the button answers on the line; Preview fleet sync lists each change by plant with why; a dispatcher has neither button');
    // Joe 10/10 (route 855): the one-run editor has every day field of the old one (Order, Day Notes), a blank unit default on a
    // running day says "none set", and the action buttons are square tiles in one row.
    for (const [w, h] of [[1920, 950], [1366, 650]]) {
      const one = await openPage(browser, w, h, '/routes.html?testEmail=manager.test@uniteddairy.com');
      await one.waitForFunction(() => [...document.querySelectorAll('#route-select option')].some(o => o.textContent === '802'));
      await one.selectOption('#route-select', '802');
      await one.selectOption('#run-select', 'run_t802');
      await one.selectOption('#view-select', 'details');
      await one.waitForSelector('table.day-table');
      assert.deepEqual(await one.$$eval('table.day-table thead th', t => t.map(x => x.textContent.trim().toUpperCase())), ['DAY', 'RUNS?', 'START TIME', 'LOAD DAY', 'MILES', 'HOURS', 'ORDER', 'TRUCK', 'TRAILER', 'JACK', 'DAY NOTES']);
      assert.equal(await one.$eval('table.day-table tr:nth-child(2) input[data-field="tractor"]', i => i.placeholder), 'none set', '802 runs Monday with no default truck');
      const tiles = await one.$$eval('.actions.tiles > button, .actions.tiles > a.button', b => b.map(x => { const r = x.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), fits: x.scrollWidth <= x.clientWidth }; }));
      assert.equal(tiles.length, 4);
      assert.equal(await one.$('#to-template'), null, 'Joe 10/10: Driver Weekly Template is on the Drivers menu, not the Route Editor');
      assert.ok(tiles.every(t => t.h === 42 && t.fits && t.top === tiles[0].top), 'one-line tiles in one row at ' + w + ': ' + JSON.stringify(tiles));
      assert.deepEqual(one.errors, []);
      await one.close();
    }
    results.push('Route Editor (one run): Order and Day Notes per day, "none set" for a blank unit default, square tiles in one row at both sizes');
    // Joe 10/10: the Route Days action buttons sit together in one neat row, all the same size, not split left and right.
    for (const [w, h] of [[1920, 950], [1366, 650]]) {
      const rd = await openPage(browser, w, h, '/routes.html?testEmail=manager.test@uniteddairy.com');
      await rd.waitForSelector('table.routes tr[data-id="run_t801"]');
      for (const v of ['days', 'seq', 'rules']) {
        await rd.selectOption('#view-select', v);
        const row = await rd.$$eval('.actions.tiles > button, .actions.tiles > a.button', b => b.map(x => { const r = x.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), left: Math.round(r.left), right: Math.round(r.right) }; }));
        assert.equal(row.length, 4);
        assert.ok(row.every((t, i) => t.w === row[0].w && t.h === row[0].h && t.top === row[0].top && (i === 0 || t.left - row[i - 1].right <= 12)), 'Route Days ' + v + ' buttons in one even row at ' + w + ': ' + JSON.stringify(row));
      }
      assert.deepEqual(rd.errors, []);
      await rd.close();
    }
    results.push('Route Days: Refresh, Add Route, Add Run and Holiday Week Editor sit together in one even row at both sizes');
    // Joe 10/10: Home is the old app's launcher, one big picture per side; each side's menu lists only its own screens.
    // Joe 10/11: six cards after picking a plant: Plant Distribution, Plant Production and Plant Maintenance (both Under
    // Construction), Route Distribution, Fleet & Maintenance and Reports. Five carry pictures; Reports has a drawn icon.
    // Joe 10/12: a seventh, Safety Walkthrough, next to Reports, with a drawn icon too. Joe 10/13: an eighth, Inventory (its box picture), in the last open spot.
    const SIX = ['Plant Distribution', 'Plant Production', 'Plant Maintenance', 'Route Distribution', 'Fleet & Maintenance', 'Reports', 'Safety Walkthrough', 'Inventory'];
    const lp = await openPage(browser, 1920, 950, '/index.html?testEmail=manager.test@uniteddairy.com');
    await lp.waitForSelector('.launch-card');
    assert.deepEqual(await lp.$$eval('.launch-card strong', s => s.map(x => x.textContent)), SIX);
    await lp.waitForFunction(() => [...document.querySelectorAll('.launch-card img')].filter(i => i.complete && i.naturalWidth > 0).length === 6, null, { timeout: 10000 });
    assert.equal(await lp.$$eval('.launch-card[data-side="reports"] svg.launch-icon', s => s.length), 1, 'Reports shows its icon');
    assert.equal(await lp.$('.sidemenu .side-sec'), null, 'Home lists the sides, not every screen');
    assert.deepEqual(await lp.$$eval('.sidemenu a[data-side]', a => a.map(x => x.textContent.trim())), SIX);
    if (SHOTS) await lp.screenshot({ path: path.join(SHOTS, 'home-launcher-1920.png') });
    // Joe 10/10: the Plant Distribution picture opens Manager Center; the Plant side shows its sections (Manager Center's cards)
    // with fly-outs, and Back from a plant screen goes up to Manager Center.
    await Promise.all([lp.waitForURL(/manager\.html/), lp.click('.launch-card[data-side="plant"]')]);
    await lp.waitForSelector('.sidemenu a.side-name');
    assert.equal(await lp.getAttribute('.sidemenu a.side-name', 'data-side'), 'plant');
    const plantMenu = await lp.$$eval('.sidemenu > a:not(.side-name), .sidemenu > .side-sec', e => e.map(x => x.matches('a') ? x.textContent.trim() : x.querySelector('.side-sec-btn').getAttribute('title')));
    assert.deepEqual(plantMenu.filter(x => x !== 'Home'), ['Send Report', 'Plant Distribution Departments', 'Plant Operations Scheduler', 'Shift Notes', 'Quality Checks', 'Cooler Temperature', 'Yard Checks'], 'the Plant side lists its own sections');
    assert.equal(await lp.$$eval('.sidemenu .side-sec-btn[title="Plant Distribution Departments"]', b => b.length), 1, 'a section with several screens has a fly-out');
    assert.deepEqual(await lp.$$eval('.side-flyouts .flyout-title', t => t.map(x => x.textContent)).then(t => t.filter(x => ['Dispatch', 'Drivers', 'Equipment', 'GPS / Fleet'].indexOf(x) >= 0)), [], 'no Dispatch, Drivers or Equipment sections on the Plant side');
    await lp.hover('.sidemenu .side-sec-btn[title="Plant Distribution Departments"]');
    await lp.waitForSelector('.side-flyouts .flyout.open a[href="loadout.html"]', { state: 'visible' });
    await Promise.all([lp.waitForURL(/loadout\.html/), lp.click('.side-flyouts .flyout.open a[href="loadout.html"]')]);
    await lp.waitForSelector('.sidemenu a.side-name[data-side="plant"]');
    await Promise.all([lp.waitForURL(/manager\.html/), lp.click('#go-back')]);
    await Promise.all([lp.waitForURL(/index\.html/), lp.click('#go-home')]);
    await Promise.all([lp.waitForURL(/maint\.html/), lp.click('.launch-card[data-side="fleet"]')]);
    await lp.waitForSelector('.sidemenu a[href="fleet.html"]');
    // Joe 10/10 evening: GPS / Fleet is not on the Fleet & Maintenance side; its one section (Equipment) lists its screens straight in the menu.
    assert.deepEqual(await lp.$$eval('.side-flyouts .flyout-title', t => t.map(x => x.textContent)), [], 'the Fleet & Maintenance side lists only its own screens');
    assert.equal(await lp.$$eval('.sidemenu a[href="gps.html"], .sidemenu a[href="scorecard.html"]', a => a.length), 0, 'no GPS screens on the Fleet & Maintenance side');
    // Joe 10/10: Over the Road and Trucks Today are manager reports, only under Route Distribution's Manager Reports; opened
    // after Fleet & Maintenance, Over the Road shows the Route Distribution side.
    await lp.goto(lp.url().replace(/maint\.html.*/, 'otr.html?testEmail=manager.test@uniteddairy.com'));
    await lp.waitForSelector('.sidemenu a.side-name');
    assert.equal(await lp.getAttribute('.sidemenu a.side-name', 'data-side'), 'distribution');
    assert.deepEqual(lp.errors, []);
    await lp.close();
    results.push('Home: seven cards (Plant Distribution, Plant Production, Plant Maintenance, Route Distribution, Fleet & Maintenance, Reports, Safety Walkthrough); each side\'s menu lists only its own screens; Back goes up to the side, Home goes to the pictures');
    // Joe 10/10: an Administration section holds Dispatch Administration; Driver Weekly Template is under Drivers only.
    const mp = await openPage(browser, 1920, 950, '/daily.html?testEmail=manager.test@uniteddairy.com');
    await mp.waitForSelector('.side-flyouts .flyout', { state: 'attached' });
    const menu = await mp.$$eval('.side-flyouts .flyout', fs => fs.map(f => [f.querySelector('.flyout-title').textContent, [...f.querySelectorAll('a')].map(a => a.textContent.trim())]));
    const sec = (name) => (menu.find(m => m[0] === name) || [name, []])[1];
    assert.deepEqual(sec('Administration'), ['Dispatch Administration', 'Operational Assignments', 'Print Layouts', 'Dispatch Settings']);
    assert.equal(sec('Dispatch').indexOf('Dispatch Administration'), -1, 'not under Dispatch');
    assert.deepEqual(menu.filter(m => m[1].indexOf('Driver Weekly Template (assign routes)') >= 0).map(m => m[0]), ['Drivers']);
    assert.deepEqual(sec('Drivers'), ['Driver Roster', 'Driver Weekly Template (assign routes)', 'Driver Assignment Board', 'Vacation Schedule'], 'Joe 10/10: route assignment has a link under Drivers');
    assert.ok(sec('Dispatch').indexOf('Driver Assignment Board') >= 0, 'the board stays under Dispatch too');
    assert.deepEqual(menu.map(m => m[0]), ['Dispatch', 'Drivers', 'Manager Reports', 'Overall', 'Administration'], 'the Route Distribution side lists only its own sections');
    assert.deepEqual(sec('Manager Reports'), ['Driver Scorecard', 'Over the Road', 'Trucks Today', 'GPS Setup'], 'Joe 10/10: the manager reports, GPS included');
    await mp.close();
    const mq = await openPage(browser, 1920, 950, '/equipment.html?testEmail=manager.test@uniteddairy.com');
    // Joe 10/10 evening: Fleet & Maintenance lists its screens straight in the menu (no fly-out); the side's name opens the hub.
    await mq.waitForSelector('.sidemenu a.side-name', { state: 'attached' });
    assert.equal(await mq.$eval('.sidemenu a.side-name', a => a.textContent.trim()), 'Fleet & Maintenance', 'the maintenance side starts on the hub');
    assert.equal(await mq.getAttribute('.sidemenu a.side-name', 'href'), 'maint.html');
    // Audit batch 8 (mock-up 2): the same eight lines under Fleet, Issues and Garage; none removed.
    assert.deepEqual(await mq.$$eval('.sidemenu .side-group, .sidemenu a:not(.side-name)', x => x.map(e => (e.classList.contains('side-group') ? '# ' : '') + e.textContent.trim())),
      ['# Fleet', 'Equipment', 'Fleet Service', '# Issues', 'Equipment Issues', 'Truck Issues', 'Trailer Issues', 'Fork Truck / Pallet Jack Issues', '# Garage', 'Garage Work Orders', 'Garage Station']);
    await mq.close();
    // Joe 10/10 (old hub picture): Fleet & Maintenance shows the six counts, four cards with the icon library pictures and the
    // latest write-ups; a card opens its list in this window, with the old columns and Lessor | Garage on trucks.
    const hub = await openPage(browser, 1920, 950, '/maint.html?testEmail=manager.test@uniteddairy.com');
    await hub.waitForSelector('.hub-card[data-kind="GARAGE"] .hub-tile');
    assert.equal(await hub.$$eval('.hub-kpis div', d => d.length), 6);
    assert.deepEqual(await hub.$$eval('.hub-card strong', d => d.map(x => x.textContent)), ['Truck Issues', 'Trailer Issues', 'Fork Truck / Pallet Jack Issues', 'Garage']);
    // Joe 10/10: Over the Road and Trucks Today are off the hub (they are under Reports); no page scrolling.
    assert.deepEqual(await hub.$$eval('.hub-tiles > a', a => a.map(x => x.textContent.trim())), ['Garage Station', 'Fleet Service', 'Equipment']);
    // Review item 42 (Joe 10/13): Latest write-ups runs the full height (its own list scrolls); the small tiles are bigger, their labels 16px on one line.
    assert.ok(await hub.$$eval('#latest tr', r => r.length) <= 40);
    assert.ok(await hub.evaluate(() => { const v = document.querySelector('.hub-view').getBoundingClientRect(), l = document.querySelector('.hub-latest').getBoundingClientRect(), c = document.querySelector('.hub-cards').getBoundingClientRect(); return l.bottom >= v.bottom - 30 && l.bottom >= c.bottom - 2; }), 'Latest write-ups runs to the bottom');
    // Joe 10/19: a long label (Annual inspections this month) may take two lines in its tile, but is never cut off. Joe 10/23: the
    // label lines are taller so the bottoms of letters show, so two lines are now up to 46px.
    assert.deepEqual(await hub.$$eval('.hub-tile span', s => s.filter(x => parseFloat(getComputedStyle(x).fontSize) < 16 || x.scrollWidth > x.clientWidth + 1 || x.offsetHeight > 46 || x.closest('.hub-tile').scrollHeight > x.closest('.hub-tile').clientHeight + 1).map(x => x.textContent)), [], 'tile labels 16px and whole');
    assert.ok(await hub.evaluate(() => document.scrollingElement.scrollHeight <= innerHeight && document.querySelector('.hub-view').scrollHeight <= document.querySelector('.hub-view').clientHeight), 'the hub fits 1920x950');
    await hub.waitForFunction(() => [...document.querySelectorAll('.hub-card img')].filter(i => i.complete && i.naturalWidth > 0).length === 3, null, { timeout: 10000 });
    await Promise.all([hub.waitForNavigation(), hub.click('.hub-card[data-kind="TRUCK"] .hub-card-head')]);
    assert.match(hub.url(), /issues\.html\?kind=TRUCK$/);
    await hub.waitForSelector('#head th');
    assert.equal(await hub.textContent('#title'), 'Truck Issues');
    assert.deepEqual(await hub.$$eval('#head th', t => t.map(x => x.textContent)), ['Truck #', 'Driver', 'Date Reported', "What's Wrong", 'Report Count', 'Reviewed', 'Emailed', 'Garage', 'Work Actions']);
    // Review item 43 (Joe 10/13): the filter buttons on the line are one size (Trucks / Trailers / Fork Truck and All open / Need review / ...).
    assert.equal(new Set(await hub.$$eval('.issue-bar #kinds button, .issue-bar #filters button', b => b.map(x => Math.round(x.getBoundingClientRect().height) + '/' + getComputedStyle(x).fontSize))).size, 1, 'one button size');
    if (await hub.$('#rows tr[data-id]')) assert.deepEqual(await hub.$$eval('#rows tr[data-id]:first-child .seg button', b => b.map(x => x.textContent)), ['Lessor', 'Garage']);
    await hub.click('#kinds [data-kind="FORK_TRUCK"]');
    assert.equal(await hub.textContent('#title'), 'Fork Truck / Pallet Jack Issues');
    assert.deepEqual(await hub.$$eval('#head th', t => t.map(x => x.textContent)), ['Unit', 'Date Reported', "What's Wrong", 'Report Count', 'Reviewed', 'Garage', 'Work Actions']);
    await Promise.all([hub.waitForNavigation(), hub.click('#go-back')]);
    assert.match(hub.url(), /\/maint\.html$/, 'Back returns to the hub');
    assert.deepEqual(hub.errors, []);
    await hub.close();
    results.push('Fleet & Maintenance: six counts, four cards with the library pictures; Truck Issues opens with the old columns and Lessor | Garage; Fork Truck has the trailer columns');
    // Joe 10/10 (old-screen picture): the template lists relief drivers first; every day shows + Add Run, Copy, Paste and Paste + Add.
    const tl = await openPage(browser, 1920, 950, '/template.html?testEmail=manager.test@uniteddairy.com');
    await tl.waitForSelector('td.tpl-name [data-copy]');
    const groups = await tl.$$eval('tr.tpl-group td', t => t.map(x => x.textContent));
    assert.match(groups[0], /Relief/i, 'relief drivers first: ' + groups.join(' | '));
    assert.equal(await tl.$eval('td.tpl-name [data-copy]', b => getComputedStyle(b.parentElement).visibility), 'visible', 'Copy shows without pointing at the line');
    assert.equal(await tl.$$eval('.tcell [data-copy]', b => b.length), 0, 'no Copy in the day boxes (one per driver line)');
    assert.equal(await tl.$eval('.tcell [data-add]', b => b.textContent), '+ Add Run');
    assert.equal(await tl.$eval('td.tpl-name', t => getComputedStyle(t).textAlign), 'left');
    assert.deepEqual(tl.errors, []);
    await tl.close();
    results.push('Menu: Administration holds Dispatch Administration; Driver Weekly Template is under Drivers only. Template: relief first, + Add Run on every day, Copy / Paste / Paste + Add once per driver line');
    results.push('Driver Weekly Template: a manager set Off, copied and pasted it, and each day saved to Driver Master as it changed; a dispatcher sees it read only');

    // The per-screen switch (Joe 10/12): Administration > Go-Live Switches is the only place to see and change which screens
    // are switched on. Joe 10/12 later ("remove the old stuff like new app current app"): the cards carry no tags at all.
    const adminHome = await openPage(browser, 1366, 650, '/distribution.html?testEmail=admin.test@uniteddairy.com');
    await adminHome.waitForSelector('#card-daily');
    assert.equal(await adminHome.$('[data-owner]'), null, 'no New app / Current app tags on the cards');
    assert.doesNotMatch(await adminHome.innerText('body'), /New app|Current app/);
    // Batch 8, mock-up 2 (10/23): Go-Live Switches is a card on Dispatch Administration; it opens in Administration.
    const gl = await openPage(browser, 1536, 730, '/admin.html?testEmail=admin.test@uniteddairy.com');
    await gl.waitForSelector('.admin-card');
    await Promise.all([gl.waitForURL(/administration\.html\?item=switch/), gl.click('.admin-card:has-text("Go-Live Switches")')]);
    await gl.waitForSelector('.adm-item.on[data-key="switch"]');
    assert.equal(await gl.textContent('.adm-item[data-key="switch"] .adm-name'), 'Go-Live Switches');
    await gl.waitForSelector('#gl-rows tr[data-row="dailyDispatch"]');
    // Joe 10/12 ("... and make Driver Check-ins ready"): every screen is ready now. A screen that is not ready still cannot be
    // moved: checked on a second page where Driver Check-ins is marked not ready for this test only.
    assert.equal(await gl.isDisabled('#gl-rows tr[data-row="checkIns"] [data-act="new"]'), false, 'Driver Check-ins is ready');
    {
      const nr = await openPage(browser, 1536, 730, '/administration.html?item=switch&testEmail=admin.test@uniteddairy.com', () => {
        let v;
        Object.defineProperty(window, 'UDLogic', { configurable: true, get: () => v, set: (x) => { v = x; if (x && x.GO_LIVE && x.GO_LIVE.checkIns) x.GO_LIVE.checkIns = Object.assign({}, x.GO_LIVE.checkIns, { ready: false, why: 'Not built yet.' }); } });
      });
      await nr.waitForSelector('#gl-rows tr[data-row="checkIns"]');
      assert.equal(await nr.isDisabled('#gl-rows tr[data-row="checkIns"] [data-act="new"]'), true, 'a screen that is not ready cannot be moved');
      assert.match(await nr.textContent('#gl-rows tr[data-row="checkIns"]'), /Not built yet/);
      await nr.close();
    }
    // Joe 10/12: Drivers, Vacation Schedule and Route Editor are ready (they write Driver Master, Vacations, Route Master).
    assert.equal(await gl.isDisabled('#gl-rows tr[data-row="drivers"] [data-act="new"]'), false);
    // Joe 10/12 ("Let the new app write plant loading to the real Live sheet."): Plant Loading is a switch of its own, ready.
    assert.match(await gl.textContent('#gl-rows tr[data-row="plantLoading"]'), /Plant Loading[\s\S]*Off[\s\S]*Ready[\s\S]*Loadout History/);
    assert.equal(await gl.isDisabled('#gl-rows tr[data-row="plantLoading"] [data-act="new"]'), false);
    // Joe 10/12 ("turn all 8 sheets on"): the plant check screens, Products, Safety and Plant Maintenance have a switch, ready.
    assert.match(await gl.textContent('#gl-rows tr[data-row="plant"]'), /Plant Operations[\s\S]*Off[\s\S]*Ready/);
    // Turn on everything that is ready: pressed twice; every ready screen goes to the new app (Driver Check-ins too, Joe 10/12).
    await gl.click('#gl-all');
    assert.match(await gl.textContent('#gl-all'), /Press again/);
    assert.equal((await db().collection('config').doc('app').get()).data().screenOwners.dailyDispatch, 'old', 'one press does nothing');
    await gl.click('#gl-all');
    await gl.waitForSelector('#gl-rows tr[data-row="dailyDispatch"] .gl-chip.new');
    let cfg = (await db().collection('config').doc('app').get()).data();
    assert.equal(cfg.screenOwners.dailyDispatch, 'new');
    assert.equal(cfg.screenOwners.weeklyDispatch, 'new');
    assert.equal(cfg.screenOwners.plantLoading, 'new');
    assert.equal(cfg.screenOwners.drivers, 'new');
    assert.equal(cfg.screenOwners.checkIns, 'new');
    assert.equal(cfg.screenOwners.plant, 'new');
    if (SHOTS) await gl.screenshot({ path: path.join(SHOTS, 'go-live-switches-1536.png') });
    const onNew = await openPage(browser, 1366, 650, '/daily.html?date=2026-10-05&testEmail=dispatch.test@uniteddairy.com');
    await onNew.waitForFunction(() => document.getElementById('mode-text').textContent === 'LIVE: SAVES GO TO THE SHEET');
    assert.equal(await onNew.isVisible('#golive-note'), false, 'a switched-on screen has no such line');
    await onNew.close();
    // Plant Loading moved with them: the Loadout Center saves in the new app (and its loads go to the Live sheet).
    const loNew = await openPage(browser, 1366, 650, '/loadout.html?date=2026-10-05&testEmail=manager.test@uniteddairy.com');
    await loNew.waitForFunction(() => document.getElementById('mode-text').textContent === 'LIVE');
    assert.deepEqual(loNew.errors, []);
    await loNew.close();
    // A screen that is on has no Switch off (audit batch 2): it stays on so it keeps saving.
    assert.equal(await gl.$('#gl-rows [data-act="old"]'), null, 'no Switch off button on any screen');
    // A screen not switched on is view only and says where to switch it on. Every screen is ready now (Joe 10/12) and can no
    // longer be moved back, so Driver Check-ins is set back to the current app straight in the app's settings.
    await db().collection('config').doc('app').set({ screenOwners: { checkIns: 'old' } }, { merge: true });
    await gl.waitForSelector('#gl-rows tr[data-row="checkIns"] .gl-chip.old');
    const onOld = await openPage(browser, 1366, 650, '/checkins.html?testEmail=dispatch.test@uniteddairy.com');
    await onOld.waitForFunction(() => document.getElementById('mode-text').textContent === 'VIEW ONLY UNTIL SWITCHED ON IN GO-LIVE SWITCHES');
    assert.equal(await onOld.textContent('#golive-note'), 'View only until switched on in Go-Live Switches.', 'the screen itself says it is not switched on');
    assert.equal(await onOld.isVisible('#golive-note'), true);
    if (SHOTS) await onOld.screenshot({ path: path.join(SHOTS, 'checkins-view-only-1366.png') });
    await onOld.close();
    // Mark fully live, and the cards still carry no tags.
    await gl.click('#gl-rows tr[data-row="dailyDispatch"] [data-act="live"]');
    await gl.click('#gl-rows tr[data-row="dailyDispatch"] [data-act="live"]');
    await gl.waitForSelector('#gl-rows tr[data-row="dailyDispatch"] .gl-chip.live');
    await adminHome.goto(adminHome.url().replace(/daily\.html.*$/, 'distribution.html?testEmail=admin.test@uniteddairy.com'));
    await adminHome.waitForFunction(() => document.getElementById('mode-text').textContent === 'Live');
    assert.equal(await adminHome.$('[data-owner]'), null, 'still no tags once screens are switched on');
    const homeSize = await noScroll(adminHome);
    assert.ok(homeSize.scroll <= homeSize.inner && homeSize.width <= homeSize.innerWidth, 'home fits 1366x650');
    if (SHOTS) await adminHome.screenshot({ path: path.join(SHOTS, 'home-switch-1366.png') });
    // Pause writing to the sheets (audit batch 2): the screens stay on and keep saving; Resume writes the waiting saves.
    assert.equal(await gl.textContent('#gl-wb-btn'), 'Pause writing to the sheets');
    await gl.click('#gl-wb-btn');
    await gl.click('#gl-wb-btn');
    await gl.waitForFunction(() => document.getElementById('gl-wb').textContent === 'Writing to the sheets: Paused');
    cfg = (await db().collection('config').doc('app').get()).data();
    assert.equal(cfg.sheetWrites.paused, true);
    assert.equal(cfg.writeBack.enabled, true, 'the write-back stays on, so saves keep queuing');
    assert.equal(cfg.screenOwners.dailyDispatch, 'new', 'the screens stay on');
    const whilePaused = await openPage(browser, 1366, 650, '/daily.html?date=2026-10-05&testEmail=dispatch.test@uniteddairy.com');
    await whilePaused.waitForFunction(() => document.getElementById('mode-text').textContent === 'LIVE: SAVES GO TO THE SHEET');
    await whilePaused.close();
    assert.equal(await gl.textContent('#gl-wb-btn'), 'Resume writing to the sheets');
    await gl.click('#gl-wb-btn');
    await gl.click('#gl-wb-btn');
    await gl.waitForFunction(() => document.getElementById('gl-wb').textContent === 'Writing to the sheets: On');
    assert.equal((await db().collection('config').doc('app').get()).data().sheetWrites.paused, false);
    // Undo fully live still works.
    await gl.click('#gl-rows tr[data-row="dailyDispatch"] [data-act="unlive"]');
    await gl.click('#gl-rows tr[data-row="dailyDispatch"] [data-act="unlive"]');
    await gl.waitForSelector('#gl-rows tr[data-row="dailyDispatch"] .gl-chip.new');
    assert.deepEqual(adminHome.errors, []);
    assert.deepEqual(gl.errors, []);
    await adminHome.close();
    await gl.close();
    results.push('Go-Live Switches: Turn on everything that is ready (pressed twice) moves Daily and Weekly Dispatch, Plant Loading and Plant Operations only; Mark fully live takes the tag off the card; card tags are plain labels; no screen can be switched off; Pause writing to the sheets keeps every screen saving and Resume undoes it');

    // Someone outside United Dairy is signed straight back out.
    const outsider = await openPage(browser, 1366, 650, '/daily.html?testEmail=someone@gmail.com');
    await outsider.waitForSelector('#signin-error:not([hidden])');
    assert.match(await outsider.textContent('#signin-error'), /Only United Dairy Google accounts/);
    assert.equal(await outsider.isHidden('#screen'), true);
    results.push('a gmail.com account is signed out and sees no dispatch data');

    // A United Dairy account that is not in the Users list is told so and signed out.
    const newHire = await openPage(browser, 1366, 650, '/daily.html?testEmail=new.hire@uniteddairy.com');
    await newHire.waitForSelector('#signin-error:not([hidden])');
    assert.match(await newHire.textContent('#signin-error'), /not an active user in the Users list/);
    assert.equal(await newHire.isHidden('#screen'), true);
    results.push('a United Dairy account not in the Users list is told to ask an administrator and sees no data');
  } finally {
    await browser.close();
  }
  console.log('BROWSER CHECKS PASSED');
  results.forEach(r => console.log(' - ' + r));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });

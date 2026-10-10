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

async function openPage(browser, width, height, url) {
  const page = await browser.newPage({ viewport: { width, height } });
  // The screens load Google's Firebase files from www.gstatic.com; here they come from the installed package.
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    const file = route.request().url().split('/').pop();
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, file)) });
  });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
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
      assert.equal(group, 'TUESDAY DELIVERIES, 10/6/2026');
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
    await editor.click('tr[data-id="2026-10-04__run_t802|tue"] td[data-edit="trailer"]');
    const t0 = Date.now();
    await editor.selectOption('tr[data-id="2026-10-04__run_t802|tue"] select.picker', 'veh_trailer_t_901');
    await editor.waitForFunction(() => document.querySelector('tr[data-id="2026-10-04__run_t802|tue"]').children[6].textContent === 'T-901');
    const shownMs = Date.now() - t0;
    await watcher.waitForFunction(() => document.querySelector('tr[data-id="2026-10-04__run_t802|tue"]').children[6].textContent === 'T-901', null, { timeout: 5000 });
    const seenMs = Date.now() - t0;
    // The picker marks units already used that day.
    await editor.click('tr[data-id="2026-10-04__run_t802|tue"] td[data-edit="trailer"]');
    const labels = await editor.$$eval('tr[data-id="2026-10-04__run_t802|tue"] select.picker option', os => os.map(o => o.textContent));
    assert.ok(labels.some(t => /T-902\s+\(on 801\)/.test(t)), 'T-902 is shown as on 801: ' + labels.join(' | '));
    await editor.keyboard.press('Escape');
    results.push('picking a trailer on Daily: on screen in ' + shownMs + ' ms, on another open screen in ' + seenMs + ' ms (local test database)');

    // A driver note.
    await editor.click('tr[data-id="2026-10-04__run_t802|tue"] td[data-edit="note"]');
    await editor.fill('tr[data-id="2026-10-04__run_t802|tue"] input.picker', 'Call store on arrival');
    await editor.keyboard.press('Enter');
    await watcher.waitForFunction(() => document.querySelector('tr[data-id="2026-10-04__run_t802|tue"]').children[9].textContent === 'Call store on arrival', null, { timeout: 5000 });

    // A dispatcher cannot drag; a manager drags 802 above 801 and the order saves as one call.
    assert.equal(await editor.getAttribute('tr[data-id="2026-10-04__run_t801|tue"]', 'draggable'), null);
    await watcher.waitForSelector('tr[data-id="2026-10-04__run_t802|tue"][draggable="true"]');
    await watcher.dragAndDrop('tr[data-id="2026-10-04__run_t802|tue"] td:first-child', 'tr[data-id="2026-10-04__run_t801|tue"] td:first-child');
    await editor.waitForFunction(() => [...document.querySelectorAll('#rows tr[data-id] td:first-child')].map(td => td.textContent).join(',') === '802,801', null, { timeout: 5000 });
    results.push('a manager dragged 802 above 801 and the dispatcher\'s screen showed the new order without reloading');

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
      const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js');
      const { db } = await start();
      for (let i = 0; i < 20; i++) { const d = (await getDoc(doc(db, 'equipment', 'veh_truck_900001'))).data(); if (d.status === 'DOWN') return d; await new Promise(r => setTimeout(r, 250)); }
      return null;
    });
    assert.ok(downDoc && downDoc.notes === 'DOWN: Brakes', 'Down saved to Equipment Master copy: ' + JSON.stringify(downDoc));
    await editor.click(r802 + ' td[data-edit="truck"]');
    let trucks = await editor.$$eval(r802 + ' select.picker option', os => os.map(o => o.textContent));
    assert.ok(!trucks.some(t => /900001/.test(t)), 'a down truck is not offered: ' + trucks.join(' | '));
    await editor.keyboard.press('Escape');
    await editor.check(r802 + ' input[data-ovr]');
    await editor.click(r802 + ' td[data-edit="truck"]');
    trucks = await editor.$$eval(r802 + ' select.picker option', os => os.map(o => o.textContent));
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
    await editor.click(r802 + ' td[data-edit="driver"]');
    const drivers = await editor.$$eval(r802 + ' select.picker option', os => os.map(o => o.textContent));
    assert.ok(!drivers.some(t => /CASEY/.test(t)), 'a called-off driver is not offered: ' + drivers.join(' | '));
    await editor.keyboard.press('Escape');
    const callOff = await editor.evaluate(async () => {
      const { start } = await import('./js/app.js');
      const { collection, query, where, getDocs } = await import('https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js');
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

    // Weekly: click a day, pick a truck in the editor.
    const wkEdit = await openPage(browser, 1920, 950, '/weekly.html?week=2026-10-04&testEmail=dispatch.test@uniteddairy.com');
    await wkEdit.waitForSelector('tr td.day.editable[data-day="mon"]');
    const monCell = 'xpath=//tr[td[1][text()="802"]]/td[@data-day="mon"]';
    await wkEdit.click(monCell);
    await wkEdit.selectOption('.popover select[data-kind="truck"]', 'veh_truck_900002');
    await wkEdit.click('.popover .close');
    await wkEdit.waitForFunction(() => [...document.querySelectorAll('#rows tr')].some(tr => tr.children[0].textContent === '802' && /900002/.test(tr.children[3].textContent)), null, { timeout: 5000 });
    results.push('Weekly: a truck picked for 802 Monday saved and shows in the grid');
    if (SHOTS) await wkEdit.screenshot({ path: path.join(SHOTS, 'weekly-after-edit-1920.png') });

    // Weekly like the current screen: CARRIER, Route Run Days, the Driver Assignment Board's availability box, Publish.
    const tueCell = 'xpath=//tr[td[1][text()="802"]]/td[@data-day="tue"]';
    await wkEdit.click(tueCell);
    await wkEdit.selectOption('.popover select[data-kind="driver"]', '__CARRIER__');
    await wkEdit.click('.popover .close');
    await wkEdit.waitForFunction(() => [...document.querySelectorAll('#rows tr')].some(tr => tr.children[0].textContent === '802' && tr.children[4].firstChild.textContent === 'CARRIER' && tr.children[4].classList.contains('c-carrier')), null, { timeout: 5000 });
    // Plant Load: 801 does not run Thursdays, but the plant scheduler has a load for it on 10/8, so the day needs a driver.
    const thu801 = 'xpath=//tr[td[1][text()="801"]]/td[@data-day="thu"]';
    assert.deepEqual(await wkEdit.$eval(thu801, td => [td.classList.contains('c-plant'), td.classList.contains('plant-load'), td.textContent, /pickup 7:00 AM, T-902, PO 4411/.test(td.title)]), [true, true, 'PLANT LOAD', true]);
    await wkEdit.click(thu801);
    assert.match(await wkEdit.$eval('.popover select[data-kind="driver"] option', o => o.textContent), /PLANT LOAD/);
    await wkEdit.selectOption('.popover select[data-kind="driver"]', 'drv_test_adams');
    await wkEdit.click('.popover .close');
    await wkEdit.waitForFunction(() => { const td = [...document.querySelectorAll('#rows tr')].find(tr => tr.children[0].textContent === '801').children[6]; return /ADAMS/.test(td.textContent) && td.classList.contains('plant-load') && !td.classList.contains('c-plant'); }, null, { timeout: 5000 });
    if (SHOTS) await wkEdit.screenshot({ path: path.join(SHOTS, 'weekly-plant-load-1920.png') });
    await wkEdit.click('#run-days');
    await wkEdit.click('xpath=//tbody[@id="days-rows"]/tr[td[1]/b[text()="802"]]/td[2+5]/button');
    await wkEdit.waitForFunction(() => [...document.querySelectorAll('#rows tr')].some(tr => tr.children[0].textContent === '802' && tr.children[6].classList.contains('c-needs')), null, { timeout: 5000 });
    if (SHOTS) await wkEdit.screenshot({ path: path.join(SHOTS, 'weekly-run-days-1920.png') });
    await wkEdit.click('#days-modal [data-close]');
    await wkEdit.click('#tab-board');
    await wkEdit.waitForSelector('#board-rows tr[data-driver="drv_test_casey"]');
    const boardNames = await wkEdit.$$eval('#board-rows tr[data-driver] td:first-child', tds => tds.map(td => td.textContent));
    assert.deepEqual(boardNames, ['BROOK, SAM', 'ADAMS, PAT', 'CASEY, LEE'], 'relief first, then seniority');
    await wkEdit.click('#board-rows tr[data-driver="drv_test_casey"] td:nth-child(3) button');
    await wkEdit.selectOption('#avail-reason', 'VACATION');
    await wkEdit.click('#avail-save');
    await wkEdit.waitForFunction(() => /VACATION/.test(document.querySelector('#board-rows tr[data-driver="drv_test_casey"] td:nth-child(3)').textContent), null, { timeout: 5000 });
    if (SHOTS) await wkEdit.screenshot({ path: path.join(SHOTS, 'weekly-board-1920.png') });
    await wkEdit.click('#tab-routes');
    await wkEdit.waitForFunction(() => [...document.querySelectorAll('#rows tr')].some(tr => tr.children[0].textContent === '802' && tr.children[3].classList.contains('c-vacation-needs') && /CASEY/.test(tr.children[3].textContent)), null, { timeout: 5000 });
    await wkEdit.click('#publish');
    await wkEdit.waitForFunction(() => /Published .* by dispatch\.test$/.test(document.getElementById('published').textContent), null, { timeout: 5000 });
    // Reset Week (managers): the dispatcher's button is off; a manager's second click rebuilds the week from the masters.
    assert.equal(await wkEdit.$eval('#reset', b => b.disabled), true, 'a dispatcher cannot Reset Week');
    const wkMgr = await openPage(browser, 1366, 650, '/weekly.html?week=2026-10-04&testEmail=manager.test@uniteddairy.com');
    await wkMgr.waitForSelector('tr td.day.editable[data-day="mon"]');
    await wkMgr.click('#reset');
    assert.equal(await wkMgr.$eval('#reset', b => b.textContent), 'Click again', 'the first click only asks to confirm');
    await wkMgr.click('#reset');
    await wkMgr.waitForFunction(() => [...document.querySelectorAll('#rows tr')].some(tr => tr.children[0].textContent === '802' && !/CARRIER/.test(tr.children[4].textContent) && tr.children[4].classList.contains('c-needs') && tr.children[6].classList.contains('off') && tr.children[3].classList.contains('c-vacation-needs')), null, { timeout: 8000 });
    const rsFit = await wkMgr.evaluate(() => ({ scroll: document.documentElement.scrollHeight, inner: window.innerHeight }));
    assert.ok(rsFit.scroll <= rsFit.inner, 'Weekly still fits after Reset Week');
    if (SHOTS) await wkMgr.screenshot({ path: path.join(SHOTS, 'weekly-after-reset-1366.png') });
    results.push('Reset Week: a dispatcher cannot; a manager clicked twice: 802 Tuesday CARRIER went back to its standard driver CASEY, who is called off that day, so it needs a driver; Thursday off again; Monday still Vacation - Needs Driver');
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
      await vac.waitForSelector('#filters button[data-filter="all"]');
      await vac.click('#filters button[data-filter="all"]');
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
    await vac.waitForSelector('#filters button[data-filter="all"]');
    await vac.click('#filters button[data-filter="all"]');
    await vac.waitForSelector('#rows tr[data-id="vac_test_1"]');
    assert.match(await vac.textContent('#rows tr[data-id="vac_test_1"]'), /ADAMS, PAT.*Vacation Day.*10\/12\/2026.*10\/16\/2026.*5.*APPROVED/);
    await vac.click('#add');
    await vac.selectOption('#form select[name="driverId"]', 'drv_test_brook');
    await vac.fill('#form input[name="startDate"]', '2026-11-23');
    await vac.fill('#form input[name="endDate"]', '2026-11-24');
    await vac.selectOption('#form select[name="type"]', 'PERSONAL');
    await vac.fill('#form input[name="notes"]', 'Family');
    await vac.click('#save');
    await vac.waitForFunction(() => [...document.querySelectorAll('#rows tr')].some(tr => /BROOK, SAM.*Personal Day.*11\/23\/2026.*11\/24\/2026.*2.*APPROVED.*Family/.test(tr.textContent) && !/^new-/.test(tr.dataset.id)), null, { timeout: 5000 });
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
    await dispatcherVac.waitForSelector('#filters button');
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
    await rt.click('#add-save');
    await rt.waitForFunction(() => [...document.querySelectorAll('table.routes tbody tr')].some(tr => /WHEELING/.test(tr.textContent)), null, { timeout: 5000 });
    await rt.selectOption('#route-select', '');
    await rt.selectOption('#view-select', 'seq');
    // The Load Order list is drawn and the saves above have settled, so no copy redraws the rows in the middle of the drag.
    await rt.waitForFunction(() => document.querySelector('table.routes thead th') && document.querySelector('table.routes thead th').textContent === 'Order' && document.querySelector('table.routes tr[data-i="1"]'), null, { timeout: 5000 });
    await rt.waitForTimeout(600);
    const orderShown = () => rt.evaluate(() => [...document.querySelectorAll('table.routes tbody tr[data-i]')].map(tr => tr.children[1].textContent).join(','));
    const beforeDrag = await orderShown();
    await rt.dragAndDrop('table.routes tr[data-i="1"] td:nth-child(2)', 'table.routes tr[data-i="0"] td:nth-child(2)');
    await rt.waitForFunction(() => document.querySelector('table.routes tr[data-i="0"] td:nth-child(2)').textContent === '801', null, { timeout: 5000 })
      .catch(async e => { throw new Error('Load order drag: before ' + beforeDrag + ', after ' + await orderShown() + ' (' + e.message + ')'); });
    const saved801 = await rt.evaluate(async () => {
      const { start } = await import('./js/app.js');
      const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js');
      const { db } = await start();
      for (let i = 0; i < 20; i++) { const d = (await getDoc(doc(db, 'routes', 'run_t801'))).data(); if (d.days.mon.loadOrder === 10 && d.days.mon.dispatchTime === 300) return d.days.mon; await new Promise(r => setTimeout(r, 250)); }
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
      if (SHOTS) await phone.screenshot({ path: path.join(SHOTS, 'phone-checkin-390.png') });
      const pf = await noScroll(phone);
      assert.ok(pf.scroll <= pf.inner && pf.width <= pf.innerWidth, 'the phone Check-In fits a 390x844 phone: ' + JSON.stringify(pf));
      await phone.click('#send');
      await phone.waitForSelector('.phone-load.done', { timeout: 8000 });
      if (SHOTS) await phone.screenshot({ path: path.join(SHOTS, 'phone-loads-390.png') });
      await ciMgr.goto(HOSTING + '/checkins.html?date=' + phoneLoad + '&testEmail=manager.test@uniteddairy.com');
      await ciMgr.waitForFunction(() => [...document.querySelectorAll('#rows tr')].some(tr => tr.children[0].textContent === '802' && /400/.test(tr.textContent) && /Check engine light/.test(tr.textContent)), null, { timeout: 8000 });
    }
    // The name and the code stay on the phone.
    await phone.reload();
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
    await roster.click('#d-save');
    assert.match(await roster.textContent('#rows tr[data-id="drv_test_casey"] td.name'), /CASEY, LEIGH\s*RELIEF/, 'shown at once');
    const casey = async () => (await db().collection('drivers').doc('drv_test_casey').get()).data();
    for (let i = 0; i < 50 && (await casey()).name !== 'CASEY, LEIGH'; i++) await roster.waitForTimeout(100);
    assert.equal((await casey()).name, 'CASEY, LEIGH');
    assert.equal((await casey()).reliefDriver, true);
    assert.equal((await casey()).seniorityDate, '2025-11-15');
    // Add a driver, then remove two with Remove Selected (they stay as Inactive).
    await roster.click('#add');
    await roster.fill('#d-name', 'Evans, Kim');
    await roster.fill('#d-hire', '2019-04-01');
    await roster.fill('#d-seniority', '2019-04-01');
    await roster.fill('#d-truck', '900002');
    await roster.click('#d-save');
    await roster.waitForFunction(() => [...document.querySelectorAll('#rows td.name')].some(td => td.textContent === 'EVANS, KIM'));
    const kim = async () => (await db().collection('drivers').where('name', '==', 'EVANS, KIM').get()).docs.map(d => d.data())[0];
    for (let i = 0; i < 50 && !(await kim()); i++) await roster.waitForTimeout(100);
    assert.equal((await kim()).defaultTruckId, 'veh_truck_900002');
    await roster.waitForSelector('#rows tr[data-id="' + (await kim()).id + '"]');
    await roster.check('#rows tr[data-id="' + (await kim()).id + '"] [data-select]');
    await roster.check('#rows tr[data-id="drv_test_brook"] [data-select]');
    await roster.click('#remove');
    for (let i = 0; i < 50 && (await kim()).status !== 'INACTIVE'; i++) await roster.waitForTimeout(100);
    assert.equal((await kim()).status, 'INACTIVE');
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
    for (let i = 0; i < 40; i++) {
      batch.set(db().collection('conflicts').doc('test-conflict-' + String(i).padStart(2, '0')), { open: true, at: new Date(Date.parse('2026-10-09T12:00:00Z') + i * 60000).toISOString(),
        by: 'dispatch.test@uniteddairy.com', tab: 'LIVE CURRENT WEEK', route: '802', run: 'TEST 802', column: 'tue_trailer', sheetValue: 'T-902', newValue: 'T-901',
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
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'conflicts-' + w + '.png') });
      assert.deepEqual(page.errors, []);
      await page.close();
    }
    const checker = await openPage(browser, 1366, 650, '/conflicts.html?testEmail=dispatch.test@uniteddairy.com');
    await checker.waitForSelector('#rows button.check');
    const firstId = await checker.getAttribute('#rows button.check', 'data-id');
    await checker.click('#rows button.check');
    for (let i = 0; i < 50 && (await db().collection('conflicts').doc(firstId).get()).data().open !== false; i++) await checker.waitForTimeout(100);
    assert.equal((await db().collection('conflicts').doc(firstId).get()).data().open, false, 'Checked is saved');
    await checker.close();
    results.push('Sheet Conflicts: 40 open lines fit on one page at both sizes; Checked takes a line off the list and saves it');

    // Back: closes what is open first (an opened driver), then a main screen goes Home. Home has no Back.
    const backPage = await openPage(browser, 1366, 768, '/drivers.html?testEmail=manager.test@uniteddairy.com');
    await backPage.waitForSelector('#rows tr td.name');
    assert.equal(await backPage.$('.sidemenu a[href="index.html"]'), null, 'Back takes the place of Home');
    await backPage.click('#rows tr td.name');
    await backPage.waitForSelector('#d-cancel');
    await backPage.click('#go-back');
    await backPage.waitForSelector('.panel-empty');
    assert.match(backPage.url(), /drivers\.html/, 'first Back only closes the driver');
    // Joe 10/10: Back goes up one level: a Route Distribution screen goes to the Route Distribution page, and that page goes Home.
    await Promise.all([backPage.waitForURL(/distribution\.html/), backPage.click('#go-back')]);
    await backPage.waitForSelector('.cards');
    await Promise.all([backPage.waitForURL(/index\.html/), backPage.click('#go-back')]);
    await backPage.waitForSelector('.launch-card');
    assert.equal(await backPage.$('#go-back'), null, 'Home has no Back');
    await backPage.close();
    results.push('Back: closes an opened driver first, then goes up to Route Distribution, then Home; Home has no Back');

    // Driver Weekly Template: a manager turns ADAMS Off on Tuesday, copies it to Wednesday, and Save Template saves both cells.
    const tpl = await openPage(browser, 1920, 950, '/template.html?testEmail=manager.test@uniteddairy.com');
    await tpl.waitForSelector('.tcell[data-driver="drv_test_adams"][data-day="tue"] select[data-status]');
    assert.equal(await tpl.isDisabled('#save'), true, 'nothing to save yet');
    await tpl.selectOption('.tcell[data-driver="drv_test_adams"][data-day="tue"] select[data-status]', 'OFF');
    await tpl.hover('.tcell[data-driver="drv_test_adams"][data-day="tue"]');
    await tpl.click('.tcell[data-driver="drv_test_adams"][data-day="tue"] [data-copy]');
    await tpl.hover('.tcell[data-driver="drv_test_adams"][data-day="wed"]');
    await tpl.click('.tcell[data-driver="drv_test_adams"][data-day="wed"] [data-paste]');
    assert.equal(await tpl.textContent('#dirty'), '2 unsaved changes');
    if (SHOTS) await tpl.screenshot({ path: path.join(SHOTS, 'template-1920.png') });
    await tpl.click('#save');
    await tpl.waitForFunction(() => /^Template saved/.test(document.getElementById('dirty').textContent), null, { timeout: 10000 });
    const adamsTpl = await tpl.evaluate(async () => {
      const { start } = await import('./js/app.js');
      const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js');
      const { db } = await start();
      return (await getDoc(doc(db, 'drivers', 'drv_test_adams'))).data().cells;
    });
    assert.equal(adamsTpl.tue_available, 'FALSE');
    assert.equal(adamsTpl.wed_available, 'FALSE');
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
    // Joe 10/10: every screen, plant screens included, shows Back and Home together at the top of the menu.
    const fsMod = require('fs'), pathMod = require('path');
    const pages = fsMod.readdirSync(pathMod.join(__dirname, '../../../public')).filter(f => f.endsWith('.html') && f !== 'route.html');
    const bh = await openPage(browser, 1366, 768, '/index.html?testEmail=manager.test@uniteddairy.com');
    const missing = [];
    for (const pg of pages) {
      await bh.goto(bh.url().replace(/\/[a-z-]+\.html.*/, '/' + pg + '?testEmail=manager.test@uniteddairy.com'));
      await bh.waitForSelector('#go-home', { timeout: 8000 }).catch(() => {});
      const seen = await bh.evaluate(() => ['go-back', 'go-home'].filter(id => { const e = document.getElementById(id); return e && e.getBoundingClientRect().width > 0; }));
      const want = pg === 'index.html' ? ['go-home'] : ['go-back', 'go-home'];
      if (want.some(id => seen.indexOf(id) < 0)) missing.push(pg + ': ' + seen.join(','));
    }
    assert.deepEqual(missing, [], 'every screen has Back and Home');
    results.push('Back and Home: all ' + pages.length + ' screens show both at the top of the menu (Home shows Home)');
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
      if (r.tiles.some(t => Math.abs(t[0] - r.tiles[0][0]) > 4 || t[1] !== r.tiles[0][1] || t[2] !== r.tiles[0][2])) topBad.push(pg + ': buttons not one even row: ' + JSON.stringify(r.tiles));
      if (r.tableTop !== null && r.tableTop < r.headBottom - 8) topBad.push(pg + ': a table above the buttons');
    }
    assert.deepEqual(topBad, [], 'action buttons in one even row at the top');
    results.push('Action buttons: on 15 screens they sit in one even row in the top line, above the tables');
    await bh.close();
    // Joe 10/10 picked mock-up A: one row per unit with PM / Reefer, DOT and Plates side by side, Miles / hours now and Status, units that need something first.
    const fsB = await openPage(browser, 1920, 950, '/fleet.html?testEmail=manager.test@uniteddairy.com');
    await fsB.waitForSelector('table.fs-grid tbody tr');
    assert.deepEqual(await fsB.$$eval('table.fs-grid thead th', t => t.map(x => x.textContent)), ['Unit', 'Type', 'PM / Reefer', 'DOT', 'Plates', 'Miles / hours now', 'Status', '']);
    const fsRows = await fsB.$$eval('table.fs-grid tbody tr[data-unit]', r => r.map(x => [x.dataset.unit, x.dataset.worst]));
    assert.equal(new Set(fsRows.map(r => r[0])).size, fsRows.length, 'one row per unit');
    const rank = { OVERDUE: 0, AT_GARAGE: 1, DUE_SOON: 2, NO_MILES: 3, SET_UP: 4, OK: 5 };
    assert.ok(fsRows.every((r, i) => i === 0 || rank[fsRows[i - 1][1]] <= rank[r[1]]), 'units that need something come first: ' + JSON.stringify(fsRows.slice(0, 8)));
    assert.match(await fsB.textContent('.fs-legend em'), /of \d+ units need something/);
    assert.deepEqual(fsB.errors, []);
    await fsB.close();
    results.push('Fleet Service (mock-up A): one row per unit, PM / Reefer, DOT, Plates, Miles / hours now and Status, units that need something first');
    // Over the Road: a manager ticks route 801 for Jersey in OTR Routes Setup and types a month's figures; Tuesday 10/6 counts it.
    const otr = await openPage(browser, 1920, 950, '/otr.html?view=routes&testEmail=manager.test@uniteddairy.com');
    await otr.waitForSelector('[data-dest="run_t801"]');
    await otr.selectOption('[data-dest="run_t801"]', 'Jersey');
    await otr.waitForFunction(() => !document.querySelector('[data-inc="run_t801"]').disabled);
    await otr.check('[data-inc="run_t801"]');
    await otr.waitForSelector('tr.otr-on [data-inc="run_t801"]');
    await otr.click('.tabs [data-view="figures"]');
    await otr.fill('.otr-in[data-m="9"][data-k="gallons_sold"]', '1000000');
    await otr.press('.otr-in[data-m="9"][data-k="gallons_sold"]', 'Tab');
    await otr.fill('.otr-in[data-m="9"][data-k="distribution_cost"]', '400000');
    await otr.press('.otr-in[data-m="9"][data-k="distribution_cost"]', 'Tab');
    await otr.waitForFunction(() => /\$0\.400/.test(document.querySelector('.otr-in[data-m="9"]').closest('tr').textContent), null, { timeout: 5000 });
    const otrSaved = await otr.evaluate(async () => {
      const { start } = await import('./js/app.js');
      const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js');
      const { db } = await start();
      for (let i = 0; i < 20; i++) { const a = (await getDoc(doc(db, 'otrRoutes', 'run_t801'))).data(), b = (await getDoc(doc(db, 'otrMonthly', new Date().getFullYear() + '-09'))).data(); if (a && b && b.distribution_cost === 400000) return [a, b]; await new Promise(r => setTimeout(r, 250)); }
      return null;
    });
    assert.ok(otrSaved, 'the tick and both figures saved');
    assert.equal(otrSaved[0].destination, 'Jersey');
    await otr.click('.tabs [data-view="dash"]');
    await otr.waitForSelector('.otr-week');
    await otr.click('.tabs [data-view="report"]');
    await otr.waitForSelector('#otr-report table');
    assert.deepEqual(otr.errors, []);
    await otr.close();
    results.push('Over the Road: a manager ticked 801 for Jersey and typed September figures (cost per gallon $0.400); Dashboard and Report open');
    // Driver Scorecard: the month board, a driver's misses, the year and Settings open with no errors; a manager changes a point value.
    const sc = await openPage(browser, 1920, 950, '/scorecard.html?testEmail=manager.test@uniteddairy.com');
    await sc.waitForSelector('.sc-board');
    await sc.click('.tabs [data-mode="year"]');
    await sc.waitForSelector('.sc-board');
    await sc.click('.tabs [data-mode="settings"]');
    await sc.waitForFunction(() => document.querySelector('.sc-n[data-k="callOff"]') && !document.querySelector('.sc-n[data-k="callOff"]').disabled);
    await sc.fill('.sc-n[data-k="callOff"]', '5');
    await sc.press('.sc-n[data-k="callOff"]', 'Tab');
    const scSaved = await sc.evaluate(async () => {
      const { start } = await import('./js/app.js');
      const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js');
      const { db } = await start();
      for (let i = 0; i < 20; i++) { const d = (await getDoc(doc(db, 'scorecard', 'settings'))).data(); if (d && d.callOff === 5) return d; await new Promise(r => setTimeout(r, 250)); }
      return null;
    });
    assert.ok(scSaved, 'the call-off points saved');
    assert.deepEqual(sc.errors, []);
    await sc.close();
    results.push('Driver Scorecard: Month, Year and Settings open; a manager set call-offs to 5 points and it saved');
    // Dispatch Administration: the current app's cards; a built screen opens in this window, from the Route Editor too.
    const adm = await openPage(browser, 1920, 950, '/routes.html?testEmail=manager.test@uniteddairy.com');
    await adm.waitForSelector('#to-admin');
    await Promise.all([adm.waitForURL(/admin\.html/), adm.click('#to-admin')]);
    await adm.waitForSelector('.admin-card');
    assert.equal(await adm.$$eval('.admin-card', a => a.length), 15);
    assert.equal(await adm.$$eval('.admin-card[target]', a => a.length), 0, 'no card opens a new window');
    await Promise.all([adm.waitForURL(/template\.html/), adm.click('.admin-card[href="template.html"]')]);
    await adm.waitForSelector('.tcell');
    assert.deepEqual(adm.errors, []);
    await adm.close();
    results.push('Dispatch Administration: 15 cards from the Route Editor button; Driver Weekly Template opens in the same window');
    // Joe 10/10: Print Layouts took him into the old program. Every Dispatch Administration card opens a new-app screen; Operational
    // Assignments, Print Layouts and Dispatch Settings are built here, and an active assignment is a driver choice on Daily.
    const ops = await openPage(browser, 1920, 950, '/admin.html?testEmail=manager.test@uniteddairy.com');
    await ops.waitForSelector('.admin-card');
    assert.deepEqual(await ops.$$eval('.admin-card', a => a.filter(x => !/^[a-z]+\.html/.test(x.getAttribute('href')) || x.textContent.includes('current app')).map(x => x.textContent)), [], 'no card leaves the new app');
    for (const [name, page, sel] of [['Print Layouts', 'print', '#grid .admin-card'], ['Dispatch Settings', 'settings', '#owners tr'], ['Operational Assignments', 'ops', '#rows tr[data-name]']]) {
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
    await cvgDaily.click('tr[data-id="2026-10-04__run_t802|tue"] td[data-edit="driver"]');
    const cvg = await cvgDaily.$$eval('tr[data-id="2026-10-04__run_t802|tue"] select.picker optgroup[label="Other CVG / Carriers"] option', o => o.map(x => x.textContent));
    assert.deepEqual(cvg, ['Carrier', 'Fairmont', 'Martins Ferry', 'Beckley'], 'active assignments are driver choices: ' + cvg.join(', '));
    await cvgDaily.keyboard.press('Escape');
    assert.deepEqual(cvgDaily.errors, []);
    await cvgDaily.close();
    await ops.goto(ops.url().replace(/\/[a-z]+\.html.*/, '/maint.html?testEmail=manager.test@uniteddairy.com'));
    await ops.waitForSelector('#to-garage-station');
    await Promise.all([ops.waitForURL(/soon\.html\?what=garage-station/), ops.click('#to-garage-station')]);
    await ops.waitForFunction(() => document.getElementById('title').textContent === 'Garage Station');
    assert.deepEqual(ops.errors, []);
    await ops.close();
    results.push('Dispatch Administration: no card leaves the new app; Print Layouts, Dispatch Settings and Operational Assignments open here; a manager added Beckley and turned Marietta off, and Daily offers the active ones under Other CVG / Carriers; Garage Station opens a being-built page inside the new app');
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
    await hop.waitForFunction(() => document.getElementById('tab-board').getAttribute('aria-selected') === 'true' && document.getElementById('board-panel').getBoundingClientRect().top < innerHeight, null, { timeout: 8000 });
    assert.deepEqual(hop.errors, []);
    await hop.close();
    results.push('Daily and Weekly: a tile on each opens the other for the same week in this window; Weekly has no Assigned key; Menu > Driver Assignment Board opens Weekly at the board');
    // Joe 10/10: a menu fly-out draws above the screen (tables, cards, pop-ups), with the menu open and folded, on Daily and Equipment.
    for (const url of ['/daily.html?date=2026-10-05', '/equipment.html?x=1']) {
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
    results.push('Menu fly-outs draw above the screen on Daily Dispatch and Equipment, with the menu open and folded');
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
    assert.match(tp.url(), /daily\.html/, 'the first tap only opens the menu');
    await Promise.all([tp.waitForURL(/distribution\.html/), tp.tap('.sidemenu a.side-name')]);
    await tab.close();
    results.push('Menu: a slim icon strip that opens over the screen on hover (screen does not move), fly-outs beside it, folds when the mouse leaves; the menu button pins it open and is remembered; a tablet tap opens it before picking');
    // Joe 10/10: a menu click always opens the screen's own first view (first tab, this week), never the last one used.
    const dv = await openPage(browser, 1920, 950, '/weekly.html?testEmail=dispatch.test@uniteddairy.com');
    await dv.waitForSelector('#rows tr');
    const thisWeek = new URL(dv.url()).searchParams.get('week');
    await dv.click('#tab-board');
    await dv.click('#next');
    await dv.waitForFunction((w) => new URL(location.href).searchParams.get('week') !== w, thisWeek);
    // (The test sign-in rides on the address, so the menu link carries it here.)
    const viaMenu = async (href, who) => {
      const moved = dv.waitForEvent('framenavigated', f => f === dv.mainFrame());
      await dv.$eval('.sidemenu a[href="' + href + '"], .side-flyouts a[href="' + href + '"]', (a, who) => { a.href = a.getAttribute('href') + '?testEmail=' + who; a.click(); }, who);
      await moved;
      await dv.waitForLoadState('load');
    };
    await viaMenu('weekly.html', 'dispatch.test@uniteddairy.com');
    await dv.waitForSelector('#rows tr');
    assert.equal(await dv.getAttribute('#tab-routes', 'aria-selected'), 'true', 'Weekly opens on Route / Run Assignments');
    assert.equal(new URL(dv.url()).searchParams.get('week'), thisWeek, 'Weekly opens on this week');
    for (const [pg, menuHref, pick] of [['fleet.html', 'fleet.html', '[role="tab"][data-view="history"]'], ['vacations.html', 'vacations.html', '[role="tab"][data-view="calendar"]'], ['otr.html', 'otr.html', '[role="tab"][data-view="figures"]']]) {
      await dv.goto(HOSTING + '/' + pg + '?testEmail=manager.test@uniteddairy.com');
      await dv.waitForSelector(pick);
      await dv.click(pick);
      await viaMenu(menuHref, 'manager.test@uniteddairy.com');
      await dv.waitForSelector('[role="tab"][aria-selected="true"]');
      assert.equal(await dv.$eval('[role="tab"][aria-selected="true"]', t => t === t.parentElement.querySelector('[role="tab"]')), true, pg + ' opens on its first tab');
    }
    assert.deepEqual(await dv.evaluate(() => Object.keys(localStorage).filter(k => k !== 'udSidePinned')), [], 'distribution and fleet screens keep no last-used view');
    assert.deepEqual(dv.errors, []);
    await dv.close();
    results.push('Menu clicks open each screen\'s first view: Weekly on Route / Run Assignments and this week, Fleet Service, Vacations and Over the Road on their first tab');
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
    await eqm.waitForFunction(() => /synced Oct 11, 2:00/.test(document.getElementById('fleet-synced').textContent));
    assert.match(await eqm.textContent('#fleet-synced'), /1 added, 1 off the list/);
    await eqm.click('#fleet-sync');
    // The test project names no sandbox Equipment Master copy, so the server says so on the line (no pop-up).
    await eqm.waitForFunction(() => /not set up here/.test(document.getElementById('fleet-synced').textContent));
    assert.equal(await eqm.$eval('#fleet-synced', x => x.className), 'bad');
    await eqm.close();
    const eqv = await openPage(browser, 1920, 950, '/equipment.html?testEmail=dispatch.test@uniteddairy.com');
    await eqv.waitForSelector('#rows tr[data-id="veh_truck_900001"]');
    assert.equal(await eqv.$eval('#fleet-sync', b => b.hidden), true, 'a dispatcher has no Sync button');
    assert.match(await eqv.textContent('#fleet-synced'), /Fleet list synced/);
    await eqv.close();
    await db().collection('config').doc('fleetSync').delete();
    results.push('Equipment: a manager sees Sync fleet list with when it last synced; the button answers on the line; a dispatcher has no button');
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
      assert.equal(tiles.length, 5);
      assert.equal(await one.$('#to-template'), null, 'Joe 10/10: Driver Weekly Template is on the Drivers menu, not the Route Editor');
      assert.ok(tiles.every(t => t.w <= 116 && t.h >= 56 && t.fits && t.top === tiles[0].top), 'square tiles in one row at ' + w + ': ' + JSON.stringify(tiles));
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
        assert.equal(row.length, 5);
        assert.ok(row.every((t, i) => t.w === row[0].w && t.h === row[0].h && t.top === row[0].top && (i === 0 || t.left - row[i - 1].right <= 12)), 'Route Days ' + v + ' buttons in one even row at ' + w + ': ' + JSON.stringify(row));
      }
      assert.deepEqual(rd.errors, []);
      await rd.close();
    }
    results.push('Route Days: Refresh, Add Route, Add Run, Holiday Week Editor and Dispatch Administration sit together in one even row at both sizes');
    // Joe 10/10: Home is the old app's launcher, one big picture per side; each side's menu lists only its own screens.
    const lp = await openPage(browser, 1920, 950, '/index.html?testEmail=manager.test@uniteddairy.com');
    await lp.waitForSelector('.launch-card');
    assert.deepEqual(await lp.$$eval('.launch-card strong', s => s.map(x => x.textContent)), ['Route Distribution', 'Plant Operations', 'Fleet & Maintenance']);
    await lp.waitForFunction(() => [...document.querySelectorAll('.launch-card img')].filter(i => i.complete && i.naturalWidth > 0).length === 3, null, { timeout: 10000 });
    assert.equal(await lp.$('.sidemenu .side-sec'), null, 'Home lists the sides, not every screen');
    assert.deepEqual(await lp.$$eval('.sidemenu a[data-side]', a => a.map(x => x.textContent.trim())), ['Route Distribution', 'Plant Operations', 'Fleet & Maintenance']);
    if (SHOTS) await lp.screenshot({ path: path.join(SHOTS, 'home-launcher-1920.png') });
    await Promise.all([lp.waitForURL(/plant\.html/), lp.click('.launch-card[data-side="plant"]')]);
    await lp.waitForSelector('.sidemenu a.side-name');
    const plantMenu = await lp.$$eval('.sidemenu > a', a => a.map(x => x.textContent.trim()));
    assert.deepEqual(plantMenu, ['Plant Operations', 'Loadout Center', 'Unloading & Washing', 'Product Returns', 'Truck Washing', 'Plant Operations Scheduler', 'Yard Checks', 'Production Line Status & Quality', 'Shift Notes', 'Temperatures & Coolers', 'Manager Center'], 'the Plant side lists only plant screens');
    assert.equal(await lp.$('.sidemenu .side-sec'), null, 'no Dispatch, Drivers or Equipment sections on the Plant side');
    await Promise.all([lp.waitForURL(/scheduler\.html/), lp.click('.sidemenu a[href="scheduler.html"]')]);
    await lp.waitForSelector('.sidemenu a[href="scheduler.html"].on');
    await Promise.all([lp.waitForURL(/plant\.html/), lp.click('#go-back')]);
    await Promise.all([lp.waitForURL(/index\.html/), lp.click('#go-home')]);
    await Promise.all([lp.waitForURL(/maint\.html/), lp.click('.launch-card[data-side="fleet"]')]);
    await lp.waitForSelector('.sidemenu .side-sec');
    assert.deepEqual(await lp.$$eval('.side-flyouts .flyout-title', t => t.map(x => x.textContent)), ['Equipment', 'GPS / Fleet'], 'the Fleet & Maintenance side lists only its own sections');
    // Over the Road is on two sides: opened from Fleet & Maintenance, its menu stays on that side.
    await lp.goto(lp.url().replace(/maint\.html.*/, 'otr.html?testEmail=manager.test@uniteddairy.com'));
    await lp.waitForSelector('.sidemenu a.side-name');
    assert.equal(await lp.getAttribute('.sidemenu a.side-name', 'data-side'), 'fleet');
    assert.deepEqual(lp.errors, []);
    await lp.close();
    results.push('Home: three big pictures (Route Distribution, Plant Operations, Fleet & Maintenance); each side\'s menu lists only its own screens; Back goes up to the side, Home goes to the pictures');
    // Joe 10/10: an Administration section holds Dispatch Administration; Driver Weekly Template is under Drivers only.
    const mp = await openPage(browser, 1920, 950, '/daily.html?testEmail=manager.test@uniteddairy.com');
    await mp.waitForSelector('.side-flyouts .flyout', { state: 'attached' });
    const menu = await mp.$$eval('.side-flyouts .flyout', fs => fs.map(f => [f.querySelector('.flyout-title').textContent, [...f.querySelectorAll('a')].map(a => a.textContent.trim())]));
    const sec = (name) => (menu.find(m => m[0] === name) || [name, []])[1];
    assert.deepEqual(sec('Administration'), ['Dispatch Administration', 'Operational Assignments', 'Print Layouts', 'Dispatch Settings']);
    assert.equal(sec('Dispatch').indexOf('Dispatch Administration'), -1, 'not under Dispatch');
    assert.deepEqual(menu.filter(m => m[1].indexOf('Driver Weekly Template (assign routes)') >= 0).map(m => m[0]), ['Drivers']);
    assert.deepEqual(sec('Drivers'), ['Drivers', 'Driver Weekly Template (assign routes)', 'Driver Assignment Board', 'Vacation Schedule'], 'Joe 10/10: route assignment has a link under Drivers');
    assert.ok(sec('Dispatch').indexOf('Driver Assignment Board') >= 0, 'the board stays under Dispatch too');
    assert.deepEqual(menu.map(m => m[0]), ['Dispatch', 'Drivers', 'Reports', 'Overall', 'Administration'], 'the Route Distribution side lists only its own sections');
    await mp.close();
    const mq = await openPage(browser, 1920, 950, '/equipment.html?testEmail=manager.test@uniteddairy.com');
    await mq.waitForSelector('.side-flyouts .flyout', { state: 'attached' });
    assert.equal(await mq.$eval('.side-flyouts .flyout a', a => a.textContent.trim()), 'Fleet & Maintenance', 'the maintenance side starts on the hub');
    await mq.close();
    // Joe 10/10 (old hub picture): Fleet & Maintenance shows the six counts, four cards with the icon library pictures and the
    // latest write-ups; a card opens its list in this window, with the old columns and Lessor | Garage on trucks.
    const hub = await openPage(browser, 1920, 950, '/maint.html?testEmail=manager.test@uniteddairy.com');
    await hub.waitForSelector('.hub-card[data-kind="GARAGE"] .hub-tile');
    assert.equal(await hub.$$eval('.hub-kpis div', d => d.length), 6);
    assert.deepEqual(await hub.$$eval('.hub-card strong', d => d.map(x => x.textContent)), ['Truck Issues', 'Trailer Issues', 'Fork Truck / Pallet Jack Issues', 'Garage']);
    await hub.waitForFunction(() => [...document.querySelectorAll('.hub-card img')].filter(i => i.complete && i.naturalWidth > 0).length === 3, null, { timeout: 10000 });
    await Promise.all([hub.waitForNavigation(), hub.click('.hub-card[data-kind="TRUCK"] .hub-card-head')]);
    assert.match(hub.url(), /issues\.html\?kind=TRUCK$/);
    await hub.waitForSelector('#head th');
    assert.equal(await hub.textContent('#title'), 'Truck Issues');
    assert.deepEqual(await hub.$$eval('#head th', t => t.map(x => x.textContent)), ['Truck #', 'Driver', 'Date Reported', "What's Wrong", 'Report Count', 'Reviewed', 'Emailed', 'Garage', 'Work Actions']);
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
    await tl.waitForSelector('.tcell [data-copy]');
    const groups = await tl.$$eval('tr.tpl-group td', t => t.map(x => x.textContent));
    assert.match(groups[0], /Relief/i, 'relief drivers first: ' + groups.join(' | '));
    assert.equal(await tl.$eval('.tcell [data-copy]', b => getComputedStyle(b.parentElement).visibility), 'visible', 'Copy shows without pointing at the cell');
    assert.equal(await tl.$eval('.tcell [data-add]', b => b.textContent), '+ Add Run');
    assert.equal(await tl.$eval('td.tpl-name', t => getComputedStyle(t).textAlign), 'left');
    assert.deepEqual(tl.errors, []);
    await tl.close();
    results.push('Menu: Administration holds Dispatch Administration; Driver Weekly Template is under Drivers only. Template: relief first, + Add Run and Copy / Paste / Paste + Add on every day');
    results.push('Driver Weekly Template: a manager set Off, copied and pasted it, and Save Template saved both cells to Driver Master; a dispatcher sees it read only');

    // The per-screen switch: an administrator moves Daily Dispatch to the new app from the home page (two clicks).
    const adminHome = await openPage(browser, 1366, 650, '/distribution.html?testEmail=admin.test@uniteddairy.com');
    await adminHome.waitForSelector('[data-owner="dailyDispatch"].can');
    await adminHome.waitForSelector('[data-owner="writeBack"].new');
    await adminHome.click('[data-owner="dailyDispatch"]');
    assert.equal(await adminHome.textContent('[data-owner="dailyDispatch"]'), 'Click again');
    assert.match(adminHome.url(), /distribution\.html/, 'the tag does not open the screen');
    await adminHome.click('[data-owner="dailyDispatch"]');
    await adminHome.waitForSelector('[data-owner="dailyDispatch"].new');
    assert.equal((await db().collection('config').doc('app').get()).data().screenOwners.dailyDispatch, 'new');
    const homeSize = await noScroll(adminHome);
    assert.ok(homeSize.scroll <= homeSize.inner && homeSize.width <= homeSize.innerWidth, 'home with the switch fits 1366x650');
    if (SHOTS) await adminHome.screenshot({ path: path.join(SHOTS, 'home-switch-1366.png') });
    const onNew = await openPage(browser, 1366, 650, '/daily.html?date=2026-10-05&testEmail=dispatch.test@uniteddairy.com');
    await onNew.waitForFunction(() => document.getElementById('mode-text').textContent === 'NEW APP: SAVES GO TO THE SHEET');
    await onNew.close();
    const onOld = await openPage(browser, 1366, 650, '/weekly.html?week=2026-10-04&testEmail=dispatch.test@uniteddairy.com');
    await onOld.waitForFunction(() => document.getElementById('mode-text').textContent === 'RUN FROM THE CURRENT APP: VIEW ONLY');
    assert.equal(await onOld.isDisabled('#publish'), true, 'Weekly is view only while it is run from the current app');
    if (SHOTS) await onOld.screenshot({ path: path.join(SHOTS, 'weekly-view-only-1366.png') });
    await onOld.close();
    // A manager sees which app runs each screen but cannot move one.
    const mgrHome = await openPage(browser, 1366, 650, '/distribution.html?testEmail=manager.test@uniteddairy.com');
    await mgrHome.waitForSelector('[data-owner="dailyDispatch"].new');
    assert.equal(await mgrHome.$('[data-owner].can'), null);
    await mgrHome.close();
    // The write-back cannot go off while a screen is on the new app; moving Daily back makes every screen a test copy again.
    await adminHome.click('[data-owner="writeBack"]');
    await adminHome.click('[data-owner="writeBack"]');
    await adminHome.waitForSelector('#error:not([hidden])');
    assert.match(await adminHome.textContent('#error'), /back to the current app/);
    await adminHome.click('[data-owner="dailyDispatch"]');
    await adminHome.click('[data-owner="dailyDispatch"]');
    await adminHome.waitForSelector('[data-owner="dailyDispatch"]:not(.new):not(.armed)');
    assert.equal((await db().collection('config').doc('app').get()).data().mode, 'test');
    assert.deepEqual(adminHome.errors, []);
    await adminHome.close();
    results.push('per-screen switch: an administrator moves Daily Dispatch to the new app and back from the home page; other screens turn view only; a manager cannot switch');

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

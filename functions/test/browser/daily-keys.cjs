'use strict';
/*
 * Browser check of Daily Dispatch's sheet keys (review item D1; the current app's 7.0.267-7.0.275): a click only selects a
 * Driver / Truck / Trailer cell; Enter / arrows / Tab move; typing lists the close matches with the best one highlighted and
 * Enter takes it; Esc keeps the old value; a double-click opens the whole list. Pictures go to SHOTS_DIR.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { clear, db } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const F = require('../fixtures/fake-sheets');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR;

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

const R801 = 'tr[data-id="2026-10-04__run_t801|tue"]', R802 = 'tr[data-id="2026-10-04__run_t802|tue"]';
const at = (p) => p.evaluate(() => { const a = document.activeElement; return a && a.dataset.edit ? a.closest('tr').dataset.id.split('__')[1] + ' ' + a.dataset.edit : a && a.tagName; });
const text = (p, row, i) => p.evaluate(([s, n]) => document.querySelector(s).children[n].textContent, [row, i]);

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: () => new Date('2026-10-09T12:00:00Z') });
  const browser = await chromium.launch();
  const results = [];
  try {
    const p = await openPage(browser, 1920, 1080, '/daily.html?date=2026-10-05&testEmail=dispatch.test@uniteddairy.com');
    await p.waitForSelector(R801 + ' td[data-edit="truck"]');

    // A click selects the cell; no list opens.
    await p.click(R801 + ' td[data-edit="truck"]');
    assert.equal(await at(p), 'run_t801|tue truck');
    assert.equal(await p.$('.cell-pop'), null, 'a click does not open the list');

    // Down / Up / Enter move in the column; Tab / Right across; Shift+Tab back.
    await p.keyboard.press('ArrowDown');
    assert.equal(await at(p), 'run_t802|tue truck');
    await p.keyboard.press('ArrowUp');
    assert.equal(await at(p), 'run_t801|tue truck');
    await p.keyboard.press('Enter');
    assert.equal(await at(p), 'run_t802|tue truck');
    await p.keyboard.press('Tab');
    assert.equal(await at(p), 'run_t802|tue trailer');
    await p.keyboard.press('ArrowRight');
    assert.equal(await at(p), 'run_t802|tue time');
    await p.keyboard.press('Shift+Tab');
    await p.keyboard.press('Shift+Tab');
    assert.equal(await at(p), 'run_t802|tue truck');
    results.push('a click selects a cell; Enter / Down go down, Up up, Tab / Right across, Shift+Tab back');

    // Typing lists the close matches, best first: "1" finds 900001 (ends in 1). Enter takes it and the cell stays selected (last row).
    await p.keyboard.type('1');
    await p.waitForSelector('.cell-pop [data-i].active');
    assert.equal(await p.textContent('.cell-pop [data-i].active'), '900001');
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'daily-keys-typing-1920.png') });
    await p.keyboard.press('Enter');
    await p.waitForFunction((s) => document.querySelector(s).children[5].textContent === '900001', R802);
    // The Saving... / Saved sign beside the title (shared by Daily and Weekly through edit.js).
    await p.waitForFunction(() => { const x = document.getElementById('save-pill'); return x && !x.hidden && /Saved/.test(x.textContent); });
    assert.equal(await p.evaluate(() => { const r = document.getElementById('save-pill').getBoundingClientRect(), h = document.querySelector('.head .title h1').getBoundingClientRect(); return Math.abs((r.top + r.bottom) / 2 - (h.top + h.bottom) / 2) < 20; }), true, 'the sign sits beside the title');
    assert.equal(await at(p), 'run_t802|tue truck');
    results.push('typing 1 in the Truck cell highlighted 900001; Enter saved it and "Saved \u2713" showed beside the title');

    // Esc keeps the old value.
    await p.keyboard.press('ArrowUp');
    await p.keyboard.press('Tab');
    assert.equal(await at(p), 'run_t801|tue trailer');
    await p.keyboard.type('901');
    await p.waitForSelector('.cell-pop [data-i].active');
    assert.equal(await p.textContent('.cell-pop [data-i].active'), 'T-901');
    await p.keyboard.press('Escape');
    assert.equal(await p.$('.cell-pop'), null);
    assert.equal(await text(p, R801, 6), 'T-902', 'Esc kept T-902');
    assert.equal(await at(p), 'run_t801|tue trailer');
    results.push('typing 901 found T-901; Esc kept T-902');

    // A trailer number that is not on Equipment Master is kept as typed, as T-###.
    await p.keyboard.type('777');
    await p.waitForSelector('.cell-pop p');
    await p.keyboard.press('Enter');
    // Joe 10/12: the typed unit shows at once (it used to go blank until the save came back).
    await p.waitForFunction((s) => document.querySelector(s).children[6].textContent === 'T-777', R801, { timeout: 1000 });
    await p.waitForFunction((s) => document.querySelector(s).children[6].textContent === 'T-777', R801, { timeout: 8000 });
    await p.keyboard.press('ArrowUp');
    assert.equal(await at(p), 'run_t801|tue trailer');
    results.push('typing 777 (not on Equipment Master) and Enter kept trailer T-777');

    // Joe 10/12 ("891 now won't show whole number"): the short number of a truck taken on another load finds it, greyed with
    // why, and Enter does not save the short number as typed; the old truck stays.
    await p.keyboard.press('Shift+Tab');
    assert.equal(await at(p), 'run_t801|tue truck');
    const truckBefore = await text(p, R801, 5);
    await p.keyboard.type('0001');
    await p.waitForSelector('.cell-pop [data-i].off');
    assert.match(await p.textContent('.cell-pop [data-i].off'), /^900001.*802/);
    assert.match(await p.textContent('.cell-pop p'), /Tick OVR/);
    await p.keyboard.press('Enter');
    await p.waitForTimeout(500);
    assert.equal(await text(p, R801, 5), truckBefore, 'the short number was not saved as typed');
    await p.keyboard.press('ArrowUp');
    await p.keyboard.press('Tab');
    assert.equal(await at(p), 'run_t801|tue trailer');
    results.push('typing 0001 on 801 found 900001 greyed "on 802" with "Tick OVR"; Enter kept ' + truckBefore + ' instead of saving 0001');

    // Typing a driver name: Enter takes the best match and moves down.
    await p.keyboard.press('Shift+Tab');
    await p.keyboard.press('Shift+Tab');
    assert.equal(await at(p), 'run_t801|tue driver');
    await p.keyboard.type('ad');
    await p.waitForSelector('.cell-pop [data-i].active');
    assert.match(await p.textContent('.cell-pop [data-i].active'), /^ADAMS, PAT/);
    await p.keyboard.press('Enter');
    await p.waitForFunction((s) => document.querySelector(s).children[3].textContent === 'ADAMS, PAT', R801);
    assert.equal(await at(p), 'run_t802|tue driver');
    results.push('typing "ad" in Driver highlighted ADAMS, PAT; Enter saved it and moved down');

    // A double-click opens the whole list; a click on a name takes it.
    await p.dblclick(R802 + ' td[data-edit="driver"]');
    await p.waitForSelector('.cell-pop [data-i]');
    const names = await p.$$eval('.cell-pop [data-i]', n => n.map(x => x.textContent));
    assert.ok(names.some(t => /^CASEY, LEE/.test(t)), 'whole list: ' + names.join(' | '));
    // Joe 10/12: Regular drivers (seniority order) first, then Relief drivers on their own, names only; then Other CVG /
    // Carriers, then Unavailable with the reason.
    const heads = await p.$$eval('.cell-pop h6', n => n.map(x => x.textContent));
    assert.deepEqual(heads.map(h => h.split(' \u00b7 ')[0]), ['REGULAR DRIVERS', 'RELIEF DRIVERS', 'OTHER CVG / CARRIERS', 'UNAVAILABLE'], heads.join(' | '));
    assert.deepEqual(await p.$$eval('.cell-pop [data-i]', n => n.slice(1, 3).map(x => x.textContent)), ['CASEY, LEE', 'BROOK, SAM']);
    const off = await p.$$eval('.cell-pop [data-i].off', n => n.map(x => x.textContent));
    assert.ok(off.includes('ADAMS, PATOn 801') && off.some(t => /^DUNN, ROBININACTIVE/.test(t)), 'unavailable: ' + off.join(' | '));
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'daily-keys-list-1920.png') });
    await p.click('.cell-pop [data-i]:has-text("ADAMS, PAT")');
    assert.ok(await p.$('.cell-pop'), 'an unavailable driver cannot be clicked without OVR');
    await p.click('.cell-pop [data-i]:has-text("CASEY, LEE")');
    await p.waitForFunction((s) => document.querySelector(s).children[3].textContent === 'CASEY, LEE', R802);
    results.push('a double-click opened the whole driver list grouped Regular (seniority order), Relief, Other CVG, Unavailable (ADAMS "On 801", DUNN INACTIVE, greyed and not pickable); clicking CASEY, LEE saved it');

    // Time: typing on the selected cell starts over; Enter saves and moves down; Tab from Jack goes to Notes.
    await p.click(R801 + ' td[data-edit="driver"]');
    for (let i = 0; i < 3; i++) await p.keyboard.press('Tab');
    assert.equal(await at(p), 'run_t801|tue time');
    await p.keyboard.type('3:45 AM');
    await p.keyboard.press('Enter');
    await p.waitForFunction((s) => document.querySelector(s).children[7].textContent === '3:45 AM', R801);
    assert.equal(await at(p), 'run_t802|tue time');
    await p.keyboard.press('Tab');
    await p.keyboard.press('F2');
    await p.keyboard.type('PJ-3');
    await p.keyboard.press('Tab');
    await p.waitForFunction((s) => document.querySelector(s).children[8].textContent === 'PJ-3', R802);
    assert.equal(await at(p), 'run_t802|tue note');
    results.push('Time: typed 3:45 AM and Enter saved it and moved down; Jack: F2, PJ-3, Tab saved it and moved to Notes');

    // The driver's own truck goes with him (Driver Master); Carrier takes the truck off and Truck shows N/A.
    const t1 = (await db().collection('equipment').doc('veh_truck_900001').get()).data();
    await db().collection('equipment').doc('veh_truck_900003').set(Object.assign({}, t1, { id: 'veh_truck_900003', unit: '900003' }));
    await db().collection('drivers').doc('drv_test_brook').update({ defaultTruckId: 'veh_truck_900003' });
    await p.waitForTimeout(500);
    await p.click(R802 + ' td[data-edit="driver"]');
    await p.keyboard.type('brook');
    await p.keyboard.press('Enter');
    await p.waitForFunction((s) => document.querySelector(s).children[3].textContent === 'BROOK, SAM' && document.querySelector(s).children[5].textContent === '900003', R802, { timeout: 8000 });
    await p.click(R802 + ' td[data-edit="driver"]');
    await p.keyboard.type('carr');
    await p.keyboard.press('Enter');
    await p.waitForFunction((s) => document.querySelector(s).children[3].textContent === 'Carrier' && document.querySelector(s).children[5].textContent === 'N/A', R802, { timeout: 8000 });
    await p.waitForTimeout(1500);
    assert.equal(await text(p, R802, 5), 'N/A', 'the truck stays off after the saves');
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'daily-keys-carrier-1920.png') });
    results.push('picking BROOK, SAM brought his own truck 900003; picking Carrier took the truck off and Truck shows N/A');

    // Joe 10/12: the Edit box lists the drivers (Regular by seniority, then Relief), and a driver picked there brings his own
    // truck into the box and the row.
    await db().collection('drivers').doc('drv_test_casey').update({ defaultTruckId: 'veh_truck_900003' });
    await p.waitForTimeout(500);
    await p.click(R802 + ' button:has-text("Edit")');
    await p.waitForSelector('#edit-modal select[data-field="driver"]');
    assert.deepEqual(await p.$$eval('#edit-modal select[data-field="driver"] optgroup', g => g.map(x => x.label)).then(l => l.slice(0, 2)), ['Regular Drivers \u2014 Seniority Order', 'Relief Drivers']);
    await p.selectOption('#edit-modal select[data-field="driver"]', 'drv_test_casey');
    await p.waitForFunction(() => { const t = document.querySelector('#edit-modal select[data-field="truck"]'); return t && t.selectedOptions[0] && t.selectedOptions[0].textContent.startsWith('900003'); }, null, { timeout: 8000 });
    await p.waitForFunction((s) => document.querySelector(s).children[3].textContent === 'CASEY, LEE' && document.querySelector(s).children[5].textContent === '900003', R802, { timeout: 8000 });
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'daily-edit-driver-truck-1920.png') });
    await p.click('#edit-modal [data-close]');
    results.push('the Edit box lists Regular then Relief drivers; picking CASEY, LEE there brought his truck 900003 into the box and the row');

    // A refused save says Not saved, and leaving while a save is going asks first. The Edit box's driver and truck saves finish
    // first: a save still waiting in line would start after the refused one and turn the sign back to Saved.
    await p.evaluate(async () => { window.__udEdit = await import('./js/edit.js'); });
    await p.waitForFunction(() => window.__udEdit.savesPending() === 0, null, { timeout: 8000 });
    await p.evaluate(async () => { const m = await import('./js/edit.js'); try { await m.saveOptimistic('noSuchAction', {}, () => {}, () => {}, () => {}); } catch (e) { /* shown on screen */ } });
    await p.waitForFunction(() => /Not saved/.test(document.getElementById('save-pill').textContent));
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'daily-save-pill-failed-1920.png'), clip: { x: 0, y: 70, width: 1920, height: 300 } });
    results.push('a refused save showed "Not saved" beside the title');

    // A double-click on a row (not on a cell that edits) flips RUNS / NO RUN, and back.
    await p.dblclick(R801 + ' td:nth-child(2)');
    await p.waitForSelector(R801 + '.off');
    await p.dblclick(R801 + ' td:nth-child(2)');
    await p.waitForSelector(R801 + ':not(.off)');
    results.push('a double-click on the 801 row switched it to NO RUN, a second one back to RUNS');

    // Joe 10/11: a loadout day's sheet shows only the loads loaded that day. Saturday shows 801 (loaded Saturday for Monday);
    // 802, loaded Sunday for Monday, shows only on Sunday's sheet.
    const next = (id) => db().collection('runs').doc('2026-10-11__' + id);
    const n801 = (await next('run_t801').get()).data(), n802 = (await next('run_t802').get()).data();
    await next('run_t801').update({ 'days.mon': Object.assign({}, n801.days.mon, { runs: true, loadDayOffset: -2 }) });
    await next('run_t802').update({ 'days.mon': Object.assign({}, n802.days.mon, { runs: true, loadDayOffset: -1 }) });
    const bandsOf = (pg) => pg.$$eval('#rows tr.group, #rows tr[data-id]', n => n.map(x => x.dataset.id ? x.dataset.id.split('__')[1] : x.textContent));
    const sat = await openPage(browser, 1920, 1080, '/daily.html?date=2026-10-10&testEmail=dispatch.test@uniteddairy.com');
    await sat.waitForSelector('#rows tr[data-id="2026-10-11__run_t801|mon"]');
    const bands = await bandsOf(sat);
    assert.deepEqual(bands.slice(bands.indexOf('MONDAY DELIVERIES, 10-12-26')), ['MONDAY DELIVERIES, 10-12-26', 'run_t801|mon'], bands.join(' | '));
    if (SHOTS) await sat.screenshot({ path: path.join(SHOTS, 'daily-saturday-loaded-1920.png') });
    assert.deepEqual(sat.errors, []);
    const sun = await openPage(browser, 1920, 1080, '/daily.html?date=2026-10-11&testEmail=dispatch.test@uniteddairy.com');
    await sun.waitForSelector('#rows tr[data-id="2026-10-11__run_t802|mon"]');
    assert.deepEqual(await bandsOf(sun), ['MONDAY DELIVERIES, 10-12-26', 'run_t802|mon']);
    assert.deepEqual(sun.errors, []);
    results.push('Saturday 10/10 shows only Saturday-loaded 801; Sunday-loaded 802 shows on Sunday 10/11');

    // Joe 10/11, as the current app's weekend sheet: Sunday also shows Sunday's deliveries already loaded Saturday, under
    // ALREADY LOADED SATURDAY, then what is loading today under LOADING TODAY. The already-loaded rows are for reference:
    // no grab handle, and not in the count, the coverage or the print.
    await next('run_t801').update({ 'days.sun': Object.assign({}, n801.days.sun, { runs: true, loadDayOffset: -1 }) });
    await next('run_t802').update({ 'days.sun': Object.assign({}, n802.days.sun, { runs: true, loadDayOffset: 0 }) });
    await sun.waitForSelector('#rows tr.already[data-id="2026-10-11__run_t801|sun"]');
    await sun.waitForSelector('#rows tr[data-id="2026-10-11__run_t802|sun"]');
    assert.deepEqual(await bandsOf(sun), ['SUNDAY DELIVERIES, 10-11-26', 'ALREADY LOADED SATURDAY, 10-10-26', 'run_t801|sun',
      'LOADING TODAY, SUNDAY 10-11-26', 'run_t802|sun', 'MONDAY DELIVERIES, 10-12-26', 'run_t802|mon']);
    assert.equal(await sun.$$eval('#rows tr.already.mover, #rows [data-move], #rows [data-grip]', g => g.length), 0, 'an already-loaded line cannot be dragged; no arrows or grab dots');
    assert.match(await sun.textContent('#count'), /^2 loads/, 'the count leaves out the already-loaded row');
    if (SHOTS) await sun.screenshot({ path: path.join(SHOTS, 'daily-sunday-already-loaded-1920.png') });
    assert.deepEqual(sun.errors, []);
    results.push('Sunday 10/11 shows 801 under ALREADY LOADED SATURDAY, 10-10-26, then 802 under LOADING TODAY; count 2 loads');

    // Joe 10/12: the picked day stays after leaving and coming back; a move into another week asks first (Continue or Cancel).
    const dp = await openPage(browser, 1536, 730, '/daily.html?date=2026-10-10&testEmail=dispatch.test@uniteddairy.com');
    await dp.waitForSelector('#rows tr');
    await dp.click('#prev');
    await dp.waitForSelector('#week-panel:not([hidden])');
    assert.match(await dp.textContent('#week-text'), /week beginning 10-11-26 to the week beginning 10-4-26/, await dp.textContent('#week-text'));
    await dp.click('#week-panel [data-close]');
    assert.equal(await dp.$eval('#load-day', s => s.value), '2026-10-10', 'Cancel stays on Saturday');
    await dp.click('#prev');
    await dp.click('#week-go');
    await dp.waitForFunction(() => document.getElementById('load-day').value === '2026-10-09');
    await dp.click('#next');
    await dp.waitForSelector('#week-panel:not([hidden])');
    await dp.click('#week-go');
    await dp.waitForFunction(() => document.getElementById('load-day').value === '2026-10-10');
    await dp.click('#next');
    await dp.waitForFunction(() => document.getElementById('load-day').value === '2026-10-11');
    assert.equal(await dp.$eval('#week-panel', w => w.hidden), true, 'a move inside the week does not ask');
    await dp.goto(HOSTING + '/daily.html?testEmail=dispatch.test@uniteddairy.com');
    await dp.waitForFunction(() => document.getElementById('load-day').value === '2026-10-11');
    // Joe 10/13 ("REMOVE THE GO TO TODAY"): Daily has no Go to today button; the arrows and the day box change the day.
    assert.equal(await dp.$$eval('#go-today, #day-pin', n => n.length), 0, 'no Go to today on Daily');
    assert.deepEqual(dp.errors, []);
    results.push('Daily keeps the picked day after leaving and coming back; moving into another week asks Continue or Cancel');

    assert.deepEqual(p.errors, []);
    console.log('Daily keys:\n- ' + results.join('\n- '));
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });

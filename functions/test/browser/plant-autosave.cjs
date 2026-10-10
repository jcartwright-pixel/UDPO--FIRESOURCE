'use strict';
/*
 * Browser check of auto-save on the plant side (Joe 10/10: "I don't want them to have to hit record"): Quality, Temperatures,
 * Shift Notes and the desktop Yard Checks have no Record, Save or Clear button; each box saves as it is left, shows "Saved"
 * with the time, and a second open screen follows. After Send Current Report the Quality boxes start empty with the last check
 * small and grey, and the report lists a line not checked since then as "Not checked". Pictures go to SHOTS_DIR.
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
const MANAGER = 'testEmail=manager.test@uniteddairy.com';

async function openPage(browser, width, height, url) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: SHOTS && width === 1920 ? 2 : 1 });
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
  });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(HOSTING + url + (url.indexOf('?') >= 0 ? '&' : '?') + MANAGER);
  page.errors = errors;
  return page;
}
async function shots(page, name) {
  if (!SHOTS) return;
  await page.screenshot({ path: path.join(SHOTS, name + '-1920.png'), scale: 'css' });
  await page.screenshot({ path: path.join(SHOTS, name + '-top-2x.png'), clip: { x: 0, y: 0, width: 1920, height: 475 }, scale: 'device' });
}
// Leaves a box the way a person does: type, then Tab out.
async function leave(page, sel, value) { await page.fill(sel, value); await page.press(sel, 'Tab'); }
const rows = (page, sel) => page.$$eval(sel, r => r.length);

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date('2026-10-08T14:00:00Z') });
  const browser = await chromium.launch();
  const results = [];
  try {
    /* ---------- Quality ---------- */
    const watcher = await openPage(browser, 1920, 950, '/quality.html?view=history');
    const desk = await openPage(browser, 1920, 950, '/quality.html?line=ut_prod_totes');
    await desk.waitForFunction(() => document.getElementById('form-title').textContent === 'TOTES Quality Check');
    await watcher.waitForSelector('#pane-history:not([hidden])');
    assert.equal(await desk.$('#record'), null, 'Quality has no Record button');
    assert.equal(await desk.$('#clear'), null, 'Quality has no Clear button');
    assert.ok((await desk.$$eval('#fields select', s => s.map(x => x.value))).every(v => v === ''), 'the drop-downs start blank: nothing passes without a real check');
    const before = await rows(watcher, '#history tr:not(:has(td.empty))');
    const t0 = Date.now();
    // Joe 10/10 (typed): the product is picked from the machine's own drop-down; one not on it goes under Other (type it).
    await desk.focus('.prod-product');
    await desk.selectOption('.prod-product', '__other__');
    await leave(desk, '.prod-other', 'Orange drink');
    await desk.waitForFunction(() => /^Saved \d/.test(document.querySelector('[data-note="prod-product"]').textContent));
    const shown = Date.now() - t0;
    await watcher.waitForFunction((n) => document.querySelectorAll('#history tr:not(:has(td.empty))').length === n + 1 && /TOTES[\s\S]*Orange drink/.test(document.querySelector('#history tr').textContent), before, { timeout: 8000 });
    await leave(desk, '.prod-temperature', '38');
    await desk.selectOption('.prod-status', 'REVIEW');
    await desk.waitForFunction(() => /^Saved/.test(document.querySelector('[data-note="prod-status"]').textContent));
    await leave(desk, '.prod-notes', 'Cap torque low');
    await watcher.waitForFunction((n) => document.querySelectorAll('#history tr:not(:has(td.empty))').length === n + 1 && /TOTES[\s\S]*Orange drink[\s\S]*Temp 38[\s\S]*Review[\s\S]*Cap torque low/.test(document.querySelector('#history tr').textContent), before, { timeout: 8000 });
    results.push('Quality: Orange drink saved on leaving the box in ' + shown + ' ms; temperature, result and notes filled in the same check on the other screen');
    await shots(desk, 'autosave-quality');

    /* ---------- Send Current Report starts a new round ---------- */
    const mgr = await openPage(browser, 1920, 950, '/manager.html');
    await mgr.waitForSelector('#screen:not([hidden])');
    await mgr.waitForFunction(() => /TOTES[\s\S]*REVIEW/.test(document.getElementById('pv-list').textContent), null, { timeout: 8000 });
    await mgr.click('#send-card');
    await mgr.waitForFunction(() => /Report saved/.test(document.getElementById('saved').textContent), null, { timeout: 8000 });
    await mgr.waitForFunction(() => /TOTES[\s\S]*NOT CHECKED/.test(document.getElementById('pv-list').textContent), null, { timeout: 8000 });
    await desk.waitForFunction(() => document.querySelector('.prod-product').value === '' && /Last: Orange drink/.test(document.getElementById('fields').textContent), null, { timeout: 8000 });
    results.push('Send Current Report: TOTES boxes start empty with "Last: Orange drink" in grey; the next report lists TOTES as NOT CHECKED');
    await shots(desk, 'autosave-quality-new-round');

    /* ---------- Temperatures ---------- */
    const temps = await openPage(browser, 1920, 950, '/temps.html');
    const tWatch = await openPage(browser, 1920, 950, '/temps.html?view=history');
    const row = '#rows [data-location="ut_temp_cooler_north"]';
    await temps.waitForSelector(row);
    assert.equal(await temps.$('[data-save]'), null, 'Temperatures has no Save button');
    await leave(temps, row + ' .tp-manual', '44.5');
    await temps.waitForFunction((r) => /Saved \d[\s\S]*HIGH/.test(document.querySelector(r + ' .tp-act').textContent), row, { timeout: 8000 });
    await leave(temps, row + ' .tp-notes', 'Door left open');
    await tWatch.waitForFunction(() => { const r = [...document.querySelectorAll('#history tr')].filter(x => /Cooler North/.test(x.textContent)); return r.length === 1 && /44\.5[\s\S]*Door left open/.test(r[0].textContent); }, null, { timeout: 8000 });
    assert.equal(await temps.$eval(row + ' .tp-notes', x => x.disabled), false, 'the reading can be finished inside its 2-hour lock');
    results.push('Temperatures: 44.5 saved on leaving the box (HIGH), the notes filled in the same reading on the other screen');
    await shots(temps, 'autosave-temps');

    /* ---------- Shift Notes ---------- */
    const notes = await openPage(browser, 1920, 950, '/shiftnotes.html');
    const nWatch = await openPage(browser, 1920, 950, '/shiftnotes.html?view=history');
    await notes.waitForSelector('#fields .sn-entry');
    assert.equal(await notes.$('#record'), null, 'Shift Notes has no Save button');
    const cards = await rows(nWatch, '#history .sn-card');
    await leave(notes, '.sn-equip', 'Cooler 2 floor');
    await leave(notes, '.sn-entry', 'Water on the floor by the north door');
    await nWatch.waitForFunction((n) => document.querySelectorAll('#history .sn-card').length === n + 1, cards, { timeout: 8000 });
    await leave(notes, '.sn-notes', 'Maintenance to check the drain');
    await nWatch.waitForFunction((n) => document.querySelectorAll('#history .sn-card').length === n + 1 && /Water on the floor[\s\S]*Maintenance to check the drain/.test(document.getElementById('history').textContent), cards, { timeout: 8000 });
    await notes.waitForSelector('#another:not([hidden])');
    // Option A (Joe 10/10): no shift to pick; the shift comes from the time of the entry and is kept with it.
    assert.equal(await notes.$('select.sn-shift'), null, 'Shift Notes has no shift picker');
    assert.match(await notes.textContent('#shift-now'), /^(First|Second|Third) shift$/);
    assert.deepEqual(await notes.$$eval('#lines [data-kind]', b => b.map(x => x.dataset.kind)), ['Handoff', 'Breakdown', 'Incident', 'Safety', 'Quality', 'Other']);
    assert.match(await nWatch.textContent('#history'), /Cooler 2 floor · (FIRST|SECOND|THIRD) SHIFT/);
    await notes.click('#another');
    assert.equal(await notes.inputValue('.sn-entry'), '', 'Start Another Entry empties the form');
    // The breakdown just made is now on the Still open list at the top, with its status drop-down and review box.
    const open = '#open-box .sn-card:has-text("Water on the floor")';
    await notes.waitForSelector(open + ' .tag.new', { timeout: 8000 });
    await notes.waitForSelector(open + ' select[data-status]');
    await notes.selectOption(open + ' select[data-status]', 'MONITOR');
    await nWatch.waitForFunction(() => /Marked Monitor/.test(document.getElementById('history').textContent), null, { timeout: 8000 });
    await leave(notes, open + ' [data-review]', 'Drain snaked, still slow');
    await nWatch.waitForFunction(() => /Drain snaked, still slow/.test(document.getElementById('history').textContent), null, { timeout: 8000 });
    await notes.waitForFunction(() => /1 monitor/.test(document.querySelector('#lines [data-kind="Breakdown"]').textContent), null, { timeout: 8000 });
    results.push('Shift Notes: the entry went on the other screen\'s log at the first box with the shift from the clock (no shift picker); Start Another Entry empties the form; the breakdown sits under Still open, and its status and review note save as they are changed');

    /* ---------- Yard Checks (desktop) ---------- */
    // Trailer T-701, loaded today and never checked (the yard list follows the real clock).
    const date = L.operatingDay(new Date()), week = L.weekStart(date), p = L.dayPrefix(L.addDays(date, 2));
    await db().collection('runs').doc(week + '__yard701').set({ weekStart: week, sheetRow: 900, route: '849', run: 'SUN VALLEY', routeId: 'rte_y701', runId: 'run_y701', active: true,
      days: { [p]: { runs: true, loadDate: date, deliveryDate: L.addDays(date, 2), dispatchTime: 600, trailer: 'T-701', loadStatus: 'COMPLETE' } } });
    const yard = await openPage(browser, 1920, 950, '/yard.html');
    await yard.waitForSelector('#rows tr[data-trailer="T-701"]');
    assert.equal(await yard.$('[data-record]'), null, 'Yard Checks has no Record button');
    await leave(yard, '#rows tr[data-trailer="T-701"] .yd-temp', '35');
    await yard.waitForFunction(() => /Saved \d/.test((document.querySelector('#rows tr[data-trailer="T-701"] .yd-act') || {}).textContent || ''), null, { timeout: 8000 });
    await leave(yard, '#rows tr[data-trailer="T-701"] .yd-notes', 'Reefer on, doors sealed');
    await yard.click('[data-pane="history"]');
    await yard.waitForFunction(() => { const r = [...document.querySelectorAll('#history tr')].filter(x => /T-701/.test(x.textContent)); return r.length === 1 && /35[\s\S]*Reefer on, doors sealed/.test(r[0].textContent); }, null, { timeout: 8000 });
    results.push('Yard Checks: T-701 saved on leaving the box and stayed on the list for its notes; one check in the history');
    await yard.click('[data-pane="current"]');
    await yard.waitForSelector('#rows tr[data-trailer="T-701"]');
    await mgr.click('#send-card');
    await yard.waitForFunction(() => !document.querySelector('#rows tr[data-trailer="T-701"]'), null, { timeout: 8000 });
    results.push('Yard Checks: the next Send Current Report clears the screen; T-701 (checked) leaves the list until it is due again');

    /* ---------- Shift Notes after the report: open breakdowns carry over, a fixed one goes in the next report ---------- */
    await notes.waitForSelector('#open-box .sn-card:has-text("Water on the floor") .tag.carry', { timeout: 8000 });
    assert.match(await notes.textContent('#carry'), /1 breakdown from earlier shifts/);
    await mgr.waitForFunction(() => /Plant breakdowns[\s\S]*Water on the floor[\s\S]*carried over · Monitor/.test(document.getElementById('pv-list').textContent), null, { timeout: 8000 });
    await shots(notes, 'shift-notes-A');
    await notes.selectOption('#open-box .sn-card:has-text("Water on the floor") select[data-status]', 'RESOLVED');
    await notes.waitForFunction(() => !/Water on the floor/.test(document.getElementById('open-box').textContent), null, { timeout: 8000 });
    await mgr.waitForFunction(() => /Fixed since last report[\s\S]*Cooler 2 floor/.test(document.getElementById('pv-list').textContent) && !/Plant breakdowns[\s\S]*Water on the floor/.test(document.getElementById('pv-list').textContent), null, { timeout: 8000 });
    results.push('Shift Notes: after Send Current Report the open breakdown stays as CARRIED OVER, and the report lists it every time until it is marked Resolved; then it goes under Fixed since last report');

    for (const p of [watcher, desk, mgr, temps, tWatch, notes, nWatch, yard]) assert.deepEqual(p.errors, []);
    console.log(results.map(r => 'AUTOSAVE ' + r).join('\n'));
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });

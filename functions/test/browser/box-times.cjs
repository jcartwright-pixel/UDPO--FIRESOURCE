'use strict';
/*
 * Browser check of typed Start and End times on Daily Box Loadout (Joe 10/20: "in the boxing section. I need to be able to edit
 * the start and quit times of the route. In case the plant forgot"). Two Aldi Charleston Scheduler loads were started at 2:10 PM
 * and never ended, so at 7:30 PM they still show End and 5 h 20 min:
 *   - Edit Load shows Start Time and End Time (not on + Add Load);
 *   - typing an End time (any form: 3:45p) marks the load loaded, the same as pressing End, and Total Time is worked out from it;
 *   - an End time before the Start, or a time not come yet, shows the red line and nothing is saved;
 *   - a loaded load's times can be fixed, and the Plant Station Boxing list shows it loaded too.
 * With SHOTS_DIR=<folder> it also saves pictures (BEFORE=1: only the Edit Load box, for the picture of the screen before).
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
const NOW = '2026-10-08T23:30:00Z';   // Thursday 7:30 PM

const a1 = PD.SCHEDULE.find(r => r.record_id === 'SCHED-a1');
const started = { state: 'WORKING', startedAt: '2026-10-08T18:10:00Z', startedBy: 'boxing@uniteddairy.com' };
const more = (id, p) => Object.assign({}, a1, { record_id: id, payload_json: JSON.stringify(Object.assign(JSON.parse(a1.payload_json), p)) });
PD.SCHEDULE.push(more('SCHED-a2', { pickupTime: '08:05', trailer: 'T-962', poNumber: 'AC-2', work: started }), more('SCHED-a3', { pickupTime: '09:00', trailer: '', poNumber: 'AC-3', work: started }));

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
  const total = (id) => row(id) + ' td:nth-child(10)';
  try {
    const lo = await openPage(browser, 1536, 790, '/loadout.html?date=2026-10-08&area=BOXING&' + MANAGER);
    await lo.waitForSelector(row('sch:SCHED-a3'), { timeout: 15000 });
    assert.equal(await lo.textContent(row('sch:SCHED-a2') + ' [data-sclock]'), 'End', 'the plant forgot End');
    assert.equal(await lo.textContent(total('sch:SCHED-a2')), '5 h 20 min');
    await shot(lo, 'box-loadout-1536.png');
    await lo.click(row('sch:SCHED-a2') + ' [data-sedit]');
    await lo.waitForSelector('#sched-modal:not([hidden])');
    for (const [w, h] of [[1536, 790], [1920, 1040]]) {
      await lo.setViewportSize({ width: w, height: h });
      await lo.waitForTimeout(200);
      await shot(lo, 'edit-load-' + w + '.png');
    }
    if (BEFORE) { console.log('TIMES before pictures saved'); return; }
    await lo.setViewportSize({ width: 1536, height: 790 });
    // Edit Load: Start Time shows when it was started, End Time is blank; the box fits the window without scrolling.
    assert.equal(await lo.inputValue('#s-start'), '2:10 PM');
    assert.equal(await lo.inputValue('#s-end'), '');
    assert.ok(await lo.$eval('#sched-modal', m => m.scrollHeight <= m.clientHeight + 1), 'the Edit Load box fits 1536 x 790 without scrolling');
    assert.ok(await lo.$$eval('#s-start, #s-end, #sched-modal label', els => els.every(e => parseFloat(getComputedStyle(e).fontSize) >= 16)), 'the time boxes are 16px or more');
    // An End time before the Start: the red line, nothing saved.
    await lo.fill('#s-end', '1:50p');
    await lo.click('#s-save');
    assert.equal(await lo.textContent('#s-error'), 'End Time cannot be before Start Time.');
    assert.equal(await lo.isVisible('#sched-modal'), true, 'the box stays open');
    // A time not come yet (9:45 PM at 7:30 PM): the red line.
    await lo.fill('#s-end', '9:45p');
    await lo.click('#s-save');
    assert.equal(await lo.textContent('#s-error'), 'That time has not come yet. Check the time.');
    await lo.fill('#s-end', 'soon');
    await lo.click('#s-save');
    assert.equal(await lo.textContent('#s-error'), 'End Time: type a time, like 5:30 PM.');
    // 3:45p: loaded, the same as pressing End; Total Time from the typed time.
    await lo.fill('#s-end', '3:45p');
    await shot(lo, 'edit-load-typed-1536.png');
    await lo.click('#s-save');
    await lo.waitForSelector('#sched-modal', { state: 'hidden' });
    await lo.waitForSelector(row('sch:SCHED-a2') + ' button.state.done', { timeout: 5000 });
    let w = await journal('SCHED-a2', x => x.state === 'COMPLETE');
    assert.deepEqual([w.startedAt, w.completedAt, w.startedBy, w.completedBy], ['2026-10-08T18:10:00Z', '2026-10-08T19:45:00.000Z', 'boxing@uniteddairy.com', 'manager.test@uniteddairy.com']);
    await lo.waitForFunction((s) => document.querySelector(s).textContent === '95 min', total('sch:SCHED-a2'), { timeout: 5000 });
    results.push('Edit Load: typing End 3:45p marks Load 2 loaded (Done) and Total Time is 95 min; Start stays as the plant pressed it');
    // A loaded load's times can be fixed: 345 is read as PM (the box held a PM time).
    await lo.click(row('sch:SCHED-a2') + ' [data-sedit]');
    await lo.waitForSelector('#sched-modal:not([hidden])');
    assert.deepEqual([await lo.inputValue('#s-start'), await lo.inputValue('#s-end')], ['2:10 PM', '3:45 PM']);
    await lo.fill('#s-start', '2');
    await lo.fill('#s-end', '330');
    await lo.click('#s-save');
    await lo.waitForSelector('#sched-modal', { state: 'hidden' });
    w = await journal('SCHED-a2', x => x.completedAt === '2026-10-08T19:30:00.000Z');
    assert.deepEqual([w.state, w.startedAt], ['COMPLETE', '2026-10-08T18:00:00.000Z']);
    await lo.waitForFunction((s) => document.querySelector(s).textContent === '90 min', total('sch:SCHED-a2'), { timeout: 5000 });
    results.push('Edit Load: a loaded load\'s Start and End can be fixed (2 and 330 read as 2:00 PM and 3:30 PM)');
    // Load 3: both typed; a time before 6 AM is the night after the load date.
    await lo.click(row('sch:SCHED-a3') + ' [data-sedit]');
    await lo.waitForSelector('#sched-modal:not([hidden])');
    await lo.fill('#s-start', '1:30 PM');
    await lo.fill('#s-end', '17:05');
    await lo.click('#s-save');
    await lo.waitForSelector('#sched-modal', { state: 'hidden' });
    w = await journal('SCHED-a3', x => x.state === 'COMPLETE');
    assert.deepEqual([w.startedAt, w.completedAt], ['2026-10-08T17:30:00.000Z', '2026-10-08T21:05:00.000Z']);
    await lo.waitForSelector(row('sch:SCHED-a3') + ' button.state.done', { timeout: 5000 });
    await shot(lo, 'box-loadout-after-1536.png');
    await lo.setViewportSize({ width: 1920, height: 1040 });
    await lo.waitForTimeout(200);
    await shot(lo, 'box-loadout-after-1920.png');
    assert.ok(await fits(lo), 'Daily Box Loadout fits 1920');
    // Clearing End puts a load back to loading.
    await lo.click(row('sch:SCHED-a3') + ' [data-sedit]');
    await lo.waitForSelector('#sched-modal:not([hidden])');
    await lo.fill('#s-end', '');
    await lo.click('#s-save');
    w = await journal('SCHED-a3', x => x.state === 'WORKING');
    assert.equal(w.completedAt, '');
    await lo.waitForSelector(row('sch:SCHED-a3') + ' button.state.loading', { timeout: 5000 });
    // + Add Load has no Start or End.
    await lo.click('#add-load');
    await lo.waitForSelector('#sched-modal:not([hidden])');
    assert.deepEqual([await lo.isVisible('#s-start'), await lo.isVisible('#s-end')], [false, false], 'a new load has no Start or End to type');
    await lo.click('#sched-modal [data-close]');
    assert.deepEqual(lo.errors, []);
    results.push('Edit Load: both times typed on Load 3; End cleared puts it back to loading; + Add Load has no time boxes');

    // Phone and tablet: the box fits the width.
    for (const [pw, ph] of [[390, 844], [1024, 768]]) {
      const ph1 = await openPage(browser, pw, ph, '/loadout.html?date=2026-10-08&area=BOXING&' + MANAGER, true);
      await ph1.waitForSelector(row('sch:SCHED-a2'), { timeout: 15000 });
      await ph1.click(row('sch:SCHED-a2') + ' [data-sedit]');
      await ph1.waitForSelector('#sched-modal:not([hidden])');
      await ph1.$eval('#s-start', e => e.scrollIntoView({ block: 'center' }));
      assert.ok(await ph1.$eval('#sched-modal', m => m.getBoundingClientRect().right <= window.innerWidth + 1), 'the Edit Load box fits ' + pw);
      assert.ok(await fits(ph1), 'no sideways scroll at ' + pw);
      await shot(ph1, 'edit-load-' + pw + '.png');
      assert.deepEqual(ph1.errors, []);
      await ph1.close();
    }
    results.push('Edit Load with the time boxes fits a 390 phone and a 1024 tablet');

    // Plant Station, Boxing: Load 2 shows loaded.
    const st = await openPage(browser, 1024, 768, '/plant-station.html?' + MANAGER + '&station=BOXING', true);
    await st.waitForSelector('#work .sw-card[data-sw="sch:SCHED-a3"]', { timeout: 15000 });
    await st.waitForFunction(() => { const c = document.querySelector('#work .sw-card[data-sw="sch:SCHED-a2"]'); return !c || /done|loaded|complete/i.test(c.className + ' ' + c.textContent); }, null, { timeout: 10000 });
    assert.deepEqual(st.errors, []);
    results.push('Plant Station Boxing shows the typed End the same as a pressed End');
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('TIMES ' + r));
})().catch(e => { console.error(e); process.exit(1); });

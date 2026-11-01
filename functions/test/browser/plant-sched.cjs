'use strict';
/*
 * Browser check of the Plant Operations Scheduler against the local test database (npm run test:browser), on the made-up
 * plant week (test/fixtures/plant-demo.js): Month, Week and Day views (Sunday first), Shipping and Receiving. A manager adds,
 * edits and deletes a load and adds a supplier; a second open screen follows each change without reloading.
 * Pictures go to SHOTS_DIR.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const F = require('../fixtures/fake-sheets');
const PD = require('../fixtures/plant-demo');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR || '';
const DATE = PD.PLANT_DATE;
const MANAGER = '&testEmail=manager.test@uniteddairy.com';
const NOW = '2026-10-08T14:00:00Z';

async function openPage(browser, width, height, url) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: SHOTS && width === 1920 ? 2 : 1 });
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    const file = route.request().url().split('/').pop();
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, file)) });
  });
  // The screen's clock reads the same day as the made-up plant week, so "today" does not move with the real date
  // (leaving the month that holds today for Week shows today's week).
  await page.clock.setFixedTime(new Date(NOW));
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
async function shots(page, name, w) {
  if (!SHOTS) return;
  await page.screenshot({ path: path.join(SHOTS, name + '-' + w + '.png'), scale: 'css' });
  if (w === 1920) await page.screenshot({ path: path.join(SHOTS, name + '-top-2x.png'), clip: { x: 0, y: 0, width: 1920, height: 475 }, scale: 'device' });
}

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date(NOW) });
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const [w, h] of [[1920, 950], [1536, 760], [1366, 650]]) {
      // Month: October 2026 starts on Thursday; Sunday is the first column.
      const page = await openPage(browser, w, h, '/scheduler.html?view=month&date=' + DATE + MANAGER);
      await page.waitForFunction(() => /3 loads/.test((document.querySelector('[data-day="2026-10-08"]') || {}).textContent || ''));
      assert.equal(await page.textContent('.sc-wd'), 'SUN');
      assert.equal(await page.getAttribute('.sc-day', 'data-day'), '2026-09-27');
      // Review item 60 (Joe 10/13): the month reads Oct 26.
      assert.equal(await page.textContent('#range'), 'Oct 26');
      assert.match(await page.textContent('#hstats'), /6Loads4Days booked0Holidays/);
      // Joe 10/12: a legend at the top, and each load colored by who delivers it (Uniontown truck, Branch, Carrier).
      assert.deepEqual(await page.$$eval('#legend .sc-by', s => s.map(x => x.textContent)), ['Uniontown truck', 'Branch', 'Carrier']);
      const by = (sel) => page.$$eval(sel, els => els.map(e => (e.className.match(/by-(\w+)/) || [])[1] + ':' + e.textContent.split(' · ')[0].trim()));
      assert.deepEqual(await by('[data-day="2026-10-08"] small[class*="by-"]'), ['ut:Walmart DC Load 1', 'ut:Garber Farms Load 1', 'carrier:Sun Valley Load 1'], 'our own runs blue, the carrier load purple; Joe 10/14: a single load that day is Load 1');
      assert.deepEqual(await by('[data-day="2026-10-09"] small[class*="by-"]'), ['branch:Aldi Charleston Load 1'], 'a branch run (Route Master coverage BRANCH) green');
      assert.ok(await page.$eval('.sc-by', e => parseFloat(getComputedStyle(e).fontSize) >= 16), 'the legend reads at 16px or more');
      await fits(page, 'Scheduler month ' + w + 'x' + h);
      if (w === 1920) {
        // Print Monthly carries the same legend and colors.
        await page.click('#print');
        await page.waitForFunction(() => { const f = document.getElementById('print-frame'); return f && f.contentDocument && f.contentDocument.querySelector('.legend'); });
        const printed = await page.evaluate(() => { const d = document.getElementById('print-frame').contentDocument; return { legend: d.querySelector('.legend').textContent, by: [...d.querySelectorAll('small[class^="by-"]')].map(x => x.className + ':' + x.textContent.split(' · ')[0]), html: d.documentElement.outerHTML }; });
        assert.equal(printed.legend, 'Uniontown truckBranchCarrier');
        assert.deepEqual(printed.by.sort(), ['by-branch:Aldi Charleston Load 1', 'by-carrier:Sun Valley Load 1', 'by-ut:Garber Farms Load 1', 'by-ut:Garber Farms Load 1', 'by-ut:Walmart DC Load 1', 'by-ut:Walmart DC Load 1'], 'Print Monthly colors each load by who delivers it');
        if (SHOTS) { const pp = await browser.newPage({ viewport: { width: 1056, height: 816 } }); await pp.setContent(printed.html); await pp.emulateMedia({ media: 'print' }); await pp.screenshot({ path: path.join(SHOTS, 'sched-print-monthly.png') }); await pp.close(); }
      }
      await shots(page, 'sched-month', w);
      // Week: the customers list and Sunday to Saturday.
      await page.click('[data-view="week"]');
      await page.waitForSelector('.sc-weekgrid');
      assert.deepEqual(await page.$$eval('.sc-count span', s => s.map(x => x.textContent)), ['SUN 10-4', 'MON 10-5', 'TUE 10-6', 'WED 10-7', 'THU 10-8', 'FRI 10-9', 'SAT 10-10']);
      assert.deepEqual(await page.$$eval('.sc-who strong', s => s.map(x => x.textContent)), ['Aldi Charleston', 'Fairmont', 'Garber Farms', 'Sun Valley', 'Walmart DC'], 'Joe 10/20: the customers in alphabetical order');
      assert.deepEqual([...new Set(await page.$$eval('.sc-load', els => els.map(e => (e.className.match(/by-(\w+)/) || [])[1])))].sort(), ['branch', 'carrier', 'ut'], 'the week colors each load by who delivers it');
      await fits(page, 'Scheduler week ' + w + 'x' + h);
      await shots(page, 'sched-week', w);
      // Day.
      await page.click('[data-view="day"]');
      await page.waitForSelector('table.sc-table');
      // Leaving a week that holds today shows today (as the current app); step to Thursday with the arrows (review item 37,
      // Joe 10/13: no date box, the arrows move the dates).
      assert.equal(await page.$('#pick'), null, 'no date box on the Scheduler');
      const dayShown = () => page.evaluate(() => { const m = /(\d+)-(\d+)-(\d+)\s*$/.exec(document.getElementById('range').textContent.trim()); return m ? '20' + m[3] + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0') : ''; });
      for (let i = 0; i < 400 && (await dayShown()) !== DATE; i++) { const before = await page.textContent('#range'); await page.click((await dayShown()) < DATE ? '#next' : '#prev'); await page.waitForFunction((b) => document.getElementById('range').textContent !== b, before); }
      await page.waitForFunction(() => /Thursday 10-8-26/.test(document.getElementById('range').textContent));
      assert.deepEqual(await page.$$eval('table.sc-table tbody tr td:nth-child(3)', t => t.map(x => x.textContent)), ['6:30 AM', '7:00 AM', '1:00 PM']);
      assert.deepEqual(await page.$$eval('table.sc-table tbody tr', t => t.map(x => x.className)), ['by-ut', 'by-ut', 'by-carrier'], 'the day colors each load by who delivers it');
      await fits(page, 'Scheduler day ' + w + 'x' + h);
      await shots(page, 'sched-day', w);
      // Receiving: the same screen with the suppliers (Joe 11/1: its own screen, opened from the menu; no switch).
      assert.equal(await page.$('[data-lane]'), null, 'no Shipping | Receiving switch');
      await page.goto(HOSTING + '/scheduler.html?lane=receiving&view=day&date=' + DATE + MANAGER);
      // Joe 10/13: no sample suppliers; a load booked with one still shows its name.
      await page.waitForFunction(() => /Valley Farms Milk Co-op/.test(document.getElementById('body').textContent));
      await page.click('[data-view="week"]');
      await page.waitForFunction(() => document.querySelectorAll('.sc-who').length === 1);
      assert.deepEqual([...new Set(await page.$$eval('.sc-load', els => els.map(e => (e.className.match(/by-(\w+)/) || [])[1])))].sort(), ['carrier', 'ut'], 'Receiving: the carrier load purple, our own truck blue');
      await fits(page, 'Scheduler receiving ' + w + 'x' + h);
      await shots(page, 'sched-receiving', w);
      assert.deepEqual(page.errors, []);
      await page.close();
    }

    // Two open screens: one adds, edits and deletes; the other follows.
    const watcher = await openPage(browser, 1920, 950, '/scheduler.html?view=week&date=' + DATE + MANAGER);
    const desk = await openPage(browser, 1920, 950, '/scheduler.html?view=week&date=' + DATE + MANAGER);
    await watcher.waitForSelector('.sc-load');
    await desk.waitForSelector('.sc-load');
    // Add a Garber load on Saturday from the customer's ＋ (the dialog picks Garber).
    await desk.click('.sc-weekgrid > .sc-col:last-child .sc-add');
    await desk.waitForSelector('#f-route');
    await desk.selectOption('#f-route', { label: '892 · GARBER · Garber Farms' });
    // Joe 10/20: the time starts as Route Master's time for Garber's Saturday.
    assert.equal(await desk.inputValue('#f-time'), '05:15', 'the Route Master time');
    assert.equal(await desk.textContent('#f-time-note'), 'Route Master time');
    await desk.fill('#f-time', '');
    await desk.click('#f-save');
    assert.match(await desk.textContent('#f-error'), /pickup time/, 'the box says what is missing');
    await desk.fill('#f-time', '05:45');
    await desk.fill('#f-trailer', '961');
    await desk.fill('#f-cases', '300');
    if (SHOTS) await desk.screenshot({ path: path.join(SHOTS, 'sched-add-1920.png'), scale: 'css' });
    // Joe 10/20: Save Load first shows "Confirm this load". A load date that has passed, or is not the run's usual load day,
    // is in red; Go back keeps what was typed; nothing is saved until Confirm.
    const saturday = await desk.inputValue('#f-date');
    await desk.fill('#f-load', '2026-10-05');
    await desk.click('#f-save');
    await desk.waitForSelector('#f-confirm');
    const box = await desk.textContent('#modal');
    assert.match(box, /Confirm this load[\s\S]*892 · GARBER[\s\S]*United Dairy Delivery[\s\S]*Monday 10-05-26[\s\S]*Saturday 10-10-26[\s\S]*5:45 AM[\s\S]*300/, 'the box shows what will be saved');
    assert.deepEqual(await desk.$$eval('.sched-warn', w => w.map(e => e.textContent)), ['⚠ The load date, Monday 10-05-26, has already passed.', '⚠ Garber Farms usually loads Friday 10-09-26 for a Saturday delivery.']);
    assert.ok(await desk.$eval('.sched-confirm dd.big', e => parseFloat(getComputedStyle(e).fontSize) >= 16));
    if (SHOTS) await desk.screenshot({ path: path.join(SHOTS, 'sched-confirm-warn-1920.png'), scale: 'css' });
    assert.equal((await db().collection('plantJournal').where('type', '==', 'PLANT_SCHEDULE').get()).docs.filter(d => d.data().run === 'GARBER' && d.data().date === saturday).length, 0, 'nothing saved before Confirm');
    await desk.click('#f-back');
    await desk.waitForSelector('#f-load');
    assert.deepEqual([await desk.inputValue('#f-load'), await desk.inputValue('#f-time'), await desk.inputValue('#f-cases')], ['2026-10-05', '05:45', '300'], 'Go back keeps what was typed');
    await desk.fill('#f-load', '2026-10-09');
    await desk.click('#f-save');
    await desk.waitForSelector('#f-confirm');
    assert.equal(await desk.$$eval('.sched-warn', w => w.length), 0, 'the usual load day: no warning');
    if (SHOTS) await desk.screenshot({ path: path.join(SHOTS, 'sched-confirm-1920.png'), scale: 'css' });
    results.push('Save Load: "Confirm this load" first; a passed or unusual load day in red; Go back keeps the entries; nothing saved before Confirm');
    const t0 = Date.now();
    await desk.click('#f-confirm');
    await desk.waitForFunction(() => /Garber Farms/.test(document.querySelector('.sc-weekgrid > .sc-col:last-child').textContent));
    const shown = Date.now() - t0;
    await watcher.waitForFunction(() => /Garber Farms[\s\S]*5:45 AM/.test(document.querySelector('.sc-weekgrid > .sc-col:last-child').textContent), null, { timeout: 8000 });
    const shownMs = Date.now() - t0;
    // Joe 10/25: the week card shows only the name and the time; the trailer is in the box the card opens.
    const satCard = '.sc-weekgrid > .sc-col:last-child .sc-load:has-text("Garber Farms")';
    assert.deepEqual(await watcher.$eval(satCard, b => [...b.children].map(c => c.textContent)), ['Garber Farms Load 1', '5:45 AM'], 'the week card: name and time only');
    await watcher.click(satCard);
    await watcher.waitForSelector('#f-trailer');
    assert.match(await watcher.inputValue('#f-trailer'), /961/, 'the trailer is in the load box');
    await watcher.click('#modal [data-close]');
    results.push('Add Load (Garber, Saturday 5:45 AM, trailer 961): on screen in ' + shown + ' ms, on the other screen in ' + shownMs + ' ms; the card shows name and time, the box shows the trailer');
    // Edit Sun Valley: carrier needs a PO; change the time.
    await desk.click('.sc-load.car');
    await desk.fill('#f-po', '');
    await desk.click('#f-save');
    assert.match(await desk.textContent('#f-error'), /PO number/);
    await desk.fill('#f-po', '4471-B');
    await desk.fill('#f-time', '14:30');
    await desk.click('#f-save');
    await watcher.waitForFunction(() => [...document.querySelector('.sc-load.car').children].map(c => c.textContent).join('|') === 'Sun Valley Load 1|2:30 PM', null, { timeout: 8000 });
    await watcher.click('.sc-load.car');
    await watcher.waitForSelector('#f-po');
    assert.equal(await watcher.inputValue('#f-po'), '4471-B', 'the PO is in the load box, not on the card');
    await watcher.click('#modal [data-close]');
    results.push('Edit Load (Sun Valley carrier): blank PO refused in the box; 2:30 PM on the other screen\'s card and PO 4471-B in its box');
    // Joe 10/20: once the Live week has Garber's Thursday with a dispatch time, the Scheduler shows that time (the dispatch sheet
    // always wins over the Scheduler's own 7:00 AM).
    const thu = () => desk.textContent('.sc-weekgrid > .sc-col:nth-child(12)');
    assert.match(await thu(), /Garber Farms Load 1\s*7:00 AM/);
    await db().collection('runDays').doc('2026-10-04__run_c892__thu').set({ runDocId: '2026-10-04__run_c892', runId: 'run_c892', route: '892', run: 'GARBER', weekStart: '2026-10-04', day: 'thu',
      dates: ['2026-10-07', '2026-10-08'], days: { thu: { runs: true, dispatchTime: 330, deliveryDate: '2026-10-08', trailer: 'T-1188' } } });
    await desk.waitForFunction(() => /Garber Farms Load 1\s*5:30 AM/.test(document.querySelector('.sc-weekgrid > .sc-col:nth-child(12)').textContent), null, { timeout: 8000 });
    if (SHOTS) await desk.screenshot({ path: path.join(SHOTS, 'sched-dispatch-time-1920.png'), scale: 'css' });
    // The ＋ beside a customer: Add Load for that customer on today, with the dispatch sheet's time.
    await desk.click('.sc-who:has(strong:text-is("Garber Farms")) .sc-plus');
    await desk.waitForSelector('#f-route');
    assert.equal(await desk.$eval('#f-route', s => s.selectedOptions[0].textContent), '892 · GARBER · Garber Farms');
    assert.deepEqual([await desk.inputValue('#f-date'), await desk.inputValue('#f-time'), await desk.textContent('#f-time-note')], ['2026-10-08', '05:30', 'From the dispatch sheet']);
    if (SHOTS) await desk.screenshot({ path: path.join(SHOTS, 'sched-plus-1920.png'), scale: 'css' });
    await desk.click('#f-save');
    await desk.waitForSelector('#f-confirm');
    await desk.click('#f-back');
    await desk.click('#modal [data-close]');
    results.push('Dispatch time: Garber Thursday shows the dispatch sheet time 5:30 AM, not the Scheduler 7:00 AM; the customer ＋ opens Add Load for today with that time, through Confirm');
    // Delete the Walmart Tuesday load after the confirm box.
    await desk.click('.sc-weekgrid > .sc-col:nth-child(10) .sc-load');
    await desk.click('#f-delete');
    assert.match(await desk.textContent('#modal'), /Delete this load\?[\s\S]*Walmart DC/);
    await desk.click('#yes-delete');
    await watcher.waitForFunction(() => /No loads/.test(document.querySelector('.sc-weekgrid > .sc-col:nth-child(10)').textContent), null, { timeout: 8000 });
    results.push('Delete Load (Walmart, Tuesday) after "Delete this load?": gone from the other screen');
    // Receiving: New Supplier.
    const receiving = (p, v) => p.goto(HOSTING + '/scheduler.html?lane=receiving&view=' + v + '&date=' + DATE + MANAGER);
    await receiving(desk, 'week'); await receiving(watcher, 'week');
    await desk.waitForSelector('.sc-wholist'); await watcher.waitForSelector('.sc-wholist');
    await desk.click('#supplier-add');
    await desk.fill('#s-name', 'Ohio Valley Fruit');
    await desk.fill('#s-label', 'Ohio Fruit');
    await desk.click('#s-save');
    await watcher.waitForFunction(() => /Ohio Fruit[\s\S]*S02 · OHIO VALLEY FRUIT/.test(document.querySelector('.sc-wholist').textContent), null, { timeout: 8000 });
    results.push('New Supplier (Ohio Valley Fruit): on the other screen as S02');
    // Joe 10/13: the suppliers are listed (Joe 11/1: on Suppliers & Products, in the page); Edit renames one, Remove takes one off
    // (after "Remove this supplier?").
    await desk.setViewportSize({ width: 1536, height: 864 });
    await desk.click('#suppliers');
    const supNames = () => desk.$$eval('.sc-suppick button strong', b => b.map(x => x.textContent));
    await desk.waitForFunction(() => document.querySelectorAll('.sc-suppick button').length === 2 && !/Saving/.test(document.querySelector('.sc-suppick').textContent));
    assert.deepEqual(await supNames(), ['Mountain Sugar', 'Ohio Fruit']);
    assert.ok(await desk.$eval('.sc-suppick strong', e => parseFloat(getComputedStyle(e).fontSize) >= 16), 'the list text is at least 16px');
    if (SHOTS) await desk.screenshot({ path: path.join(SHOTS, 'suppliers-list-1536.png'), scale: 'css' });
    for (const w of [390, 800]) {
      await desk.setViewportSize({ width: w, height: 844 });
      assert.ok(await desk.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth + 1), 'Suppliers & Products fits at ' + w);
      if (SHOTS) await desk.screenshot({ path: path.join(SHOTS, 'suppliers-list-' + w + '.png'), scale: 'css' });
    }
    await desk.setViewportSize({ width: 1536, height: 864 });
    await desk.click('.sc-suppick button:nth-child(1)');
    await desk.click('.sc-prods [data-supplier]');
    assert.equal(await desk.inputValue('#s-name'), 'MOUNTAIN STATE SUGAR');
    assert.equal(await desk.isVisible('#modal-back'), false, 'the box opens in the page, not over it');
    await desk.fill('#s-name', 'Dean Foods Milk');
    await desk.fill('#s-label', 'Dean');
    if (SHOTS) await desk.screenshot({ path: path.join(SHOTS, 'suppliers-edit-1536.png'), scale: 'css' });
    await desk.click('#s-save');
    await desk.waitForFunction(() => /Dean/.test((document.querySelector('.sc-suppick') || {}).textContent || ''), null, { timeout: 8000 });
    await watcher.waitForFunction(() => /Dean[\s\S]*S06 · DEAN FOODS MILK/.test(document.querySelector('.sc-wholist').textContent), null, { timeout: 8000 });
    results.push('Edit Supplier (Mountain State Sugar to Dean Foods Milk): on the other screen');
    await desk.click('.sc-suppick button:nth-child(2)');
    await desk.click('.sc-prods [data-supplier]');
    await desk.click('#s-remove');
    assert.match(await desk.textContent('#modal'), /Remove this supplier\?[\s\S]*OHIO VALLEY FRUIT/);
    if (SHOTS) await desk.screenshot({ path: path.join(SHOTS, 'suppliers-remove-1536.png'), scale: 'css' });
    await desk.click('#s-go');
    await desk.waitForFunction(() => document.querySelectorAll('.sc-suppick button').length === 1, null, { timeout: 8000 });
    await watcher.waitForFunction(() => !/OHIO VALLEY FRUIT/.test(document.querySelector('.sc-wholist').textContent), null, { timeout: 8000 });
    results.push('Remove Supplier (Ohio Valley Fruit) after "Remove this supplier?": gone from the other screen');
    // Month view of the day: the day box lists the loads.
    await desk.goto(HOSTING + '/scheduler.html?view=month&date=' + DATE + MANAGER);
    await desk.click('[data-day="2026-10-08"]');
    await desk.waitForSelector('.sc-dayrow');
    if (SHOTS) await desk.screenshot({ path: path.join(SHOTS, 'sched-daybox-1920.png'), scale: 'css' });
    assert.equal(await desk.$$eval('.sc-dayrow', r => r.length), 3);
    // Joe 10/20 ("I want to be able to see the trailer also"): the day box has a Trailer column, the trailer Daily Dispatch has
    // on that run and day (Garber's Thursday T-1188), else the Scheduler's own, else a dash; it fits with no sideways scrolling.
    assert.deepEqual(await desk.$$eval('.sc-dayhead span', s => s.map(x => x.textContent)), ['Run', 'Time', 'Trailer', 'Product', 'Cases', '']);
    const trailerCol = () => desk.$$eval('.sc-dayrow', r => r.map(x => x.querySelector('.run').textContent + ':' + x.querySelector('.sc-trl').textContent));
    assert.deepEqual((await trailerCol()).find(t => /^Garber/.test(t)), 'Garber Farms Load 1:T-1188');
    assert.ok((await trailerCol()).every(t => /:(T-\d+|TBA|—)$/.test(t)), 'every load shows a trailer or a dash: ' + (await trailerCol()).join(', '));
    for (const [w, h] of [[1536, 790], [1920, 950], [390, 844]]) {
      await desk.setViewportSize({ width: w, height: h });
      const box = await desk.evaluate(() => { const l = document.querySelector('.sc-daylist'), m = document.getElementById('modal'), t = document.querySelector('.sc-dayrow .sc-trl');
        return { list: l.scrollWidth <= l.clientWidth, modal: m.scrollWidth <= m.clientWidth, font: parseFloat(getComputedStyle(t).fontSize), seen: t.getBoundingClientRect().width > 20 }; });
      assert.deepEqual(box, { list: true, modal: true, font: 16, seen: true }, 'the day box with Trailer fits at ' + w + 'x' + h);
      if (SHOTS) await desk.screenshot({ path: path.join(SHOTS, 'sched-daybox-trailer-' + w + '.png'), scale: 'css' });
    }
    await desk.setViewportSize({ width: 1920, height: 950 });
    results.push('Day box: a Trailer column (Garber Thursday T-1188 from the dispatch sheet), fits at 1536, 1920 and phone width');
    assert.deepEqual(desk.errors, []);
    assert.deepEqual(watcher.errors, []);
    const log = await db().collection('actions').where('action', '==', 'savePlantSchedule').get();
    assert.equal(log.size, 6, 'each change is one save in the save log');
    // Joe 10/13 ("NEEDS ADDED", his 20 receiving suppliers): Add a List takes them pasted one per line, keeps his spelling
    // as the Short Name, skips one already on the list, and a second paste adds nothing.
    const JOE = ['Charles Stube', 'Dairy Ingredient', 'West Rock', 'Sig', 'Profile Films', 'Crest', 'Danisco', 'Silgan', 'Dairy House', 'Jogue',
      'Virginia Dare', 'Synergy', 'KDV', 'Brenntag', 'Green Spot', 'Robertet Tea', 'Heritage', 'Forbes', 'Liquid B.I.B', 'U LINE'];
    await desk.setViewportSize({ width: 1536, height: 864 });
    await desk.click('#modal [data-close]');
    // 6.63 full test: on a tablet (1024x768) the week's days were about 70px, names broke mid-word and the top buttons ran off the
    // right edge. Each day keeps at least 130px (the week scrolls sideways in its own box), every top button is on screen, and no
    // card's name or time is cut, on a tablet and a phone.
    await desk.click('[data-view="week"]');
    await desk.waitForSelector('.sc-load');
    for (const [w, h] of [[1024, 768], [390, 844]]) {
      await desk.setViewportSize({ width: w, height: h });
      const look = await desk.evaluate(() => ({
        narrowest: Math.min(...[...document.querySelectorAll('.sc-col')].map(c => Math.round(c.getBoundingClientRect().width))),
        offRight: [...document.querySelectorAll('.head .top-row button')].filter(b => b.getBoundingClientRect().width && b.getBoundingClientRect().right > innerWidth).map(b => b.textContent.trim()),
        cut: [...document.querySelectorAll('.sc-load strong, .sc-load span')].filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent),
        pageWide: document.scrollingElement.scrollWidth > innerWidth }));
      assert.ok(look.narrowest >= 130, 'each day at least 130px wide at ' + w + 'x' + h + ': ' + look.narrowest);
      assert.deepEqual([look.offRight, look.cut, look.pageWide], [[], [], false], 'week at ' + w + 'x' + h + ': buttons on screen, no card cut, no page scrolling sideways');
      if (SHOTS) await desk.screenshot({ path: path.join(SHOTS, 'sched-week-tablet-' + w + '.png'), scale: 'css' });
    }
    await desk.setViewportSize({ width: 1536, height: 864 });
    results.push('Week on a tablet (1024x768) and a phone: each day at least 130px, the top buttons wrap on screen, no load card cut');
    await receiving(desk, 'products');
    await desk.waitForSelector('#supplier-list');
    await desk.click('#supplier-list');
    await desk.fill('#s-list', JOE.concat(['  dean foods milk ', '', 'Sig']).join('\n'));
    if (SHOTS) await desk.screenshot({ path: path.join(SHOTS, 'suppliers-add-list-1536.png'), scale: 'css' });
    assert.ok(await desk.$eval('#s-list', e => parseFloat(getComputedStyle(e).fontSize) >= 16), 'the list box text is at least 16px');
    await desk.click('#s-addall');
    await desk.waitForFunction(() => /Added 20 suppliers\. Already on the list: dean foods milk, Sig\./.test((document.querySelector('.sc-supnote') || {}).textContent || ''), null, { timeout: 30000 });
    await desk.waitForFunction(() => document.querySelectorAll('.sc-suppick button').length === 21 && !/Saving/.test(document.querySelector('.sc-suppick').textContent), null, { timeout: 15000 });
    assert.deepEqual(await supNames(), ['Dean'].concat(JOE), 'his spelling, in his order');
    assert.ok(await desk.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth + 1), 'Suppliers & Products fits');
    if (SHOTS) await desk.screenshot({ path: path.join(SHOTS, 'suppliers-after-list-1536.png'), scale: 'css' });
    await desk.click('#supplier-list');
    await desk.fill('#s-list', JOE.join('\n'));
    await desk.click('#s-addall');
    assert.equal(await desk.textContent('#f-error'), 'All of these are already on the list.');
    await watcher.waitForFunction(() => /Liquid B\.I\.B/.test(document.querySelector('.sc-wholist').textContent), null, { timeout: 8000 });
    results.push('Add a List (Joe\'s 20 receiving suppliers): added in his spelling and order, one already on the list skipped, pasting again adds nothing; on the other screen');
    // Joe 10/18 (screen speed): the screen reads only the loads near the month, week or day it shows, not every load ever made;
    // stepping back to an old month still shows that month's loads, and a load from long ago does not show in October.
    await db().collection('plantJournal').doc('PLANT_SCHEDULE_app_old1').set({ recordId: 'SCHED-old1', type: 'PLANT_SCHEDULE', date: '2026-05-12', status: 'SCHEDULED', routeId: 'rte_c892', runId: 'run_c892',
      route: '892', run: 'GARBER', createdInApp: true, recordedAt: '2026-05-01T12:00:00Z', payload: { pickupTime: '07:00', scheduleType: 'ROUTE', product: 'Old May load' } });
    await desk.keyboard.press('Escape');
    await desk.goto(HOSTING + '/scheduler.html?view=month&date=' + DATE + MANAGER);
    await desk.waitForFunction(() => /Oct 26/.test(document.getElementById('range').textContent));
    assert.ok(!(await desk.textContent('#body')).includes('Old May load'), 'the May load is not in October');
    for (let i = 0; i < 5; i++) { const before = await desk.textContent('#range'); await desk.click('#prev'); await desk.waitForFunction((b) => document.getElementById('range').textContent !== b, before); }
    assert.match(await desk.textContent('#range'), /May 26/);
    await desk.click('[data-day="2026-05-12"]');
    await desk.waitForFunction(() => document.querySelectorAll('.sc-dayrow').length === 1, null, { timeout: 8000 });
    assert.match(await desk.textContent('.sc-dayrow'), /Garber[\s\S]*Old May load/);
    results.push('Old month (May): stepping back five months still shows its load; the screen reads only the loads near what it shows');
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('SCHED ' + r));
})().catch(e => { console.error(e); process.exit(1); });

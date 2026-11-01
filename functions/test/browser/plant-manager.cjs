'use strict';
/*
 * Browser check of Manager Center on the made-up plant: every card's mini-card numbers from the same rules as its screen, the Send
 * Current Report preview and full report, and Send (kept, not emailed). Today's loads are seeded from the real clock: one loaded, one
 * behind, two still to come. Pictures go to SHOTS_DIR.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear, runDaysSettled } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const F = require('../fixtures/fake-sheets');
const PD = require('../fixtures/plant-demo');
const L = require('../../src/logic');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR || '';
const MANAGER = '?testEmail=manager.test@uniteddairy.com';

async function openPage(browser, width, height, url) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: SHOTS && width === 1920 ? 2 : 1 });
  if (CLOCK.pinned) await page.clock.setFixedTime(new Date(CLOCK.ms));
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
async function fits(page, what) {
  const size = await page.evaluate(() => ({ scroll: document.scrollingElement.scrollHeight, inner: window.innerHeight, width: document.scrollingElement.scrollWidth, innerWidth: window.innerWidth }));
  assert.ok(size.scroll <= size.inner && size.width <= size.innerWidth, what + ' fits with no page scrolling: ' + JSON.stringify(size));
}
async function shots(page, name, w) {
  if (!SHOTS) return;
  await page.screenshot({ path: path.join(SHOTS, name + '-' + w + '.png'), scale: 'css' });
  if (w === 1920) await page.screenshot({ path: path.join(SHOTS, name + '-top-2x.png'), clip: { x: 0, y: 0, width: 1920, height: 475 }, scale: 'device' });
}

function nyMinutes(ms) {
  const p = {};
  new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).forEach(x => { p[x.type] = x.value; });
  return Number(p.hour) * 60 + Number(p.minute);
}
// The test's clock. The four loads fit inside the operating day (2 hours before to 5 hours after now) only from 6:00 AM to 6:59 PM,
// and the line checks seeded 200 minutes back are on today's operating day only from 9:30 AM; at any other hour the screens run on
// a clock pinned to 6:00 PM of the operating day, so the check is the same every hour of the night.
const CLOCK = (() => {
  const real = Date.now(), m = nyMinutes(real);
  if (m >= 570 && m <= 1139) return { ms: real, pinned: false };
  const day = L.operatingDay(new Date(real));
  const ms = ['-04:00', '-05:00'].map(z => Date.parse(day + 'T18:00:00' + z)).find(t => nyMinutes(t) === 1080 && L.operatingDay(new Date(t)) === day);
  return { ms, pinned: true };
})();
seed.behind = 0;
async function seed() {
  const at0 = CLOCK.ms, date = L.operatingDay(new Date(at0)), week = L.weekStart(date), p = L.dayPrefix(date), d = db(), now = nyMinutes(at0);
  // Only these four loads: the made-up plant's own runs are dated in another week.
  for (const r of (await d.collection('runs').get()).docs) await r.ref.delete();
  // Times are on the operating day's clock; with CLOCK they always fit inside it, so exactly one load (502, an hour past its
  // depart time) is behind. The count still follows the screen's rule: not loaded and more than 45 minutes past the depart time.
  const at = (m) => now + m;
  const loads = [['501', 'AKRON', at(-120), { loadStatus: 'COMPLETE', completeTime: new Date(at0 - 3 * 3600000).toISOString(), truck: '214', trailer: 'T-11' }],
    ['502', 'CANTON', at(-60), { truck: '220', trailer: 'T-12' }], ['503', 'MASSILLON', at(240), {}], ['504', 'WOOSTER', at(300), {}]];
  for (const [i, [route, run, time, extra]] of loads.entries()) {
    assert.ok(time >= 0 && time <= 1439, 'load ' + route + ' fits inside the operating day');
    if (!extra.loadStatus && now - time > 45) seed.behind++;
    await d.collection('runs').doc(week + '__mc' + route).set({ weekStart: week, sheetRow: 950 + i, route, run, routeId: 'rte_mc' + route, runId: 'run_mc' + route, active: true, loadType: 'CASE LOADOUT',
      days: { [p]: Object.assign({ runs: true, loadDayOffset: 0, loadDate: date, deliveryDate: date, dispatchTime: time, loadSequence: i + 1 }, extra) } });
  }
  await d.collection('pickups').doc('mc_pu1').set({ pickupId: 'mc_pu1', date, runId: 'run_mc503', route: '503', run: 'MASSILLON', item: 'Chocolate milk', quantity: '3 cases', status: 'PENDING' });
  await d.collection('plantJournal').doc('SHIFT_REPORT_app_mcseed').set({ recordId: 'SHIFT-mcseed', type: 'SHIFT_REPORT', date, area: 'HANDOFF', recordedAt: new Date(at0 - 2 * 3600000).toISOString(), recordedBy: 'supervisor.test@uniteddairy.com',
    createdInApp: true, payload: { entryId: 'SHIFT-mcseed', section: 'HANDOFF', shift: 'FIRST SHIFT', values: { Entry: 'Infeed belt jammed twice', Type: 'Breakdown', Equipment: 'Palletizer' }, notes: '', followUpStatus: 'OPEN' } });
  await d.collection('plantJournal').doc('PLANT_TEMPERATURE_CHECK_app_mcseed').set({ recordId: 'TEMP-mcseed', type: 'PLANT_TEMPERATURE_CHECK', date, status: 'HIGH', recordedAt: new Date(at0 - 30 * 60000).toISOString(),
    recordedBy: 'supervisor.test@uniteddairy.com', createdInApp: true, payload: { locationId: 'ut_temp_cooler_north', location: 'Cooler North', manualTemperature: 44, status: 'HIGH' } });
  // Joe 10/18: two lines running today: the Gallon Filler checked 200 minutes ago (past due, red at 3 hours) and HTST #1
  // 130 minutes ago (due, yellow at 2 hours). The other lines have no check today, so they are not running.
  const line = (id, op, mins) => d.collection('plantJournal').doc(id).set({ recordId: id, type: 'PRODUCTION_QUALITY', date, status: 'RUNNING', recordedAt: new Date(at0 - mins * 60000).toISOString(),
    recordedBy: 'supervisor.test@uniteddairy.com', createdInApp: true, payload: { operationId: op, product: 'Whole milk', status: 'RUNNING', qualityCheck: 'PASS' } });
  await line('PRODUCTION_QUALITY_app_mcgal', 'ut_prod_gallon_filler', 200);
  await line('PRODUCTION_QUALITY_app_mchtst', 'ut_prod_htst_1', 130);
}
// A tile's name (the walkthrough's DONE / DUE / PAST DUE word beside it is read on its own).
// Joe 10/26: a department card's four counts and the line under its bar.
const deptText = (page, title) => page.$eval('[data-card="dept"]', (c, t) => { const d = [...c.querySelectorAll('.dp-card')].find(x => x.querySelector('strong').textContent === t); return d ? [...d.querySelectorAll('.dp-counts b')].map(b => b.textContent).join(',') + ' | ' + d.querySelector('.dp-note').textContent : ''; }, title);
const tileText = (page, card, label) => page.$eval('[data-card="' + card + '"]', (c, l) => { const t = [...c.querySelectorAll('.mc-tile')].find(x => x.querySelector('span').firstChild.textContent.trim() === l); return t ? t.querySelector('b').textContent + ' | ' + t.querySelector('i').textContent : ''; }, label);

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date('2026-10-08T14:00:00Z') });
  await seed();
  assert.equal(seed.behind, 1, 'one load (502) is behind');
  // Manager Center reads the loads through runDays (a trigger on each run): wait until the four loads' records are written
  // and the deleted runs' records are gone, as behind-depart.cjs does, before opening the page.
  await runDaysSettled(db());
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const [w, h] of [[1920, 950], [1536, 886], [1536, 730], [1366, 650]]) {
      const page = await openPage(browser, w, h, '/manager.html' + MANAGER);
      await page.waitForFunction(() => /Plant Update/.test(document.getElementById('pv-subject').textContent) && /of 4/.test(document.querySelector('[data-card="dept"]').textContent));
      const behind = seed.behind;
      assert.match(await page.textContent('#pv-subject'), new RegExp('^Plant Update .+: ' + behind + ' routes? behind$'));
      // Joe 10/26: four department cards, two by two (Today, Waiting, Loading, Done), each opening its own screen.
      assert.deepEqual(await page.$$eval('[data-card="dept"] .dp-card', d => d.map(x => x.querySelector('strong').textContent + ' ' + x.dataset.href)),
        ['Case Loading loadout.html?area=CASE', 'Tote Loading loadout.html?area=TOTES', 'Box Loading loadout.html?area=BOXING', 'Case Unloading unloading.html']);
      assert.equal(await deptText(page, 'Case Loading'), '4,3,0,1 | 1 of 4 loads complete');
      assert.deepEqual(await page.$$eval('[data-card="dept"] .dp-card:last-child .dp-line span', s => s.map(x => x.firstChild.textContent)), ['Back, not started', 'Truck Washing', 'Returns pending']);
      // The scheduler is not on this page (Joe 10/26: it is Shipping & Receiving's).
      assert.deepEqual(await page.$$('[data-card="sched"]'), []);
      // Joe 10/15 (Manager Walkthrough): one card in walking order instead of Quality, Cooler Temperatures and Yard Checks.
      // Two lines are running (one past due, one due); Cooler North read 44°F (too warm) 30 minutes ago, the newest check.
      assert.deepEqual(await page.$$('[data-card="quality"], [data-card="temps"], [data-card="yard"]'), []);
      assert.equal(await tileText(page, 'walk', 'Production'), '2of 5 | 1 past due');
      assert.match(await tileText(page, 'walk', 'Coolers'), /^\d+ \| 1 out of range$/);
      assert.ok(await page.$eval('[data-card="walk"]', c => [...c.querySelectorAll('.mc-tile.bad')].map(t => t.querySelector('span').firstChild.textContent.trim()).join() === 'Coolers,Production'), 'Coolers and Production are red');
      // Joe 10/18: each area says DONE (green), DUE (yellow) or PAST DUE (red), and who did its newest check. No trucks on the
      // yard: the Yard is done automatically.
      assert.deepEqual(await page.$$eval('[data-card="walk"] .wk-state', a => a.map(x => x.textContent)), ['DONE', 'PAST DUE', 'PAST DUE']);
      // Read once the card has stopped redrawing (a tile caught mid-redraw has no style yet).
      // The card can redraw again between a wait and the read, so read until the colors settle (up to 5 seconds).
      const goodColors = () => page.$$eval('[data-card="walk"] .wk-tile.good', a => a.map(x => getComputedStyle(x).backgroundColor));
      let good = await goodColors();
      for (let i = 0; i < 20 && JSON.stringify(good) !== JSON.stringify(['rgb(238, 248, 241)']); i++) { await page.waitForTimeout(250); good = await goodColors(); }
      assert.deepEqual(good, ['rgb(238, 248, 241)']);
      assert.equal(await page.textContent('[data-card="walk"] .wk-tile:nth-child(1) .wk-who'), 'Done automatically');
      assert.match(await page.textContent('[data-card="walk"] .wk-tile:nth-child(3) .wk-who'), /^Last done \d{1,2}:\d\d [AP]M · Supervisor Test$/);
      assert.match(await tileText(page, 'walk', 'Last Walkthrough'), /^\d{1,2}:\d\d [AP]M \| Supervisor Test$/);
      assert.match(await page.textContent('[data-card="walk"] .mc-pill'), /^\d+ past due$/);
      // Joe 10/26: no lists on the walkthrough card; each stop has Check now (the walkthrough check) and View (its screen).
      assert.deepEqual(await page.$$('[data-card="walk"] .wk-items'), []);
      assert.ok((await page.getAttribute('[data-card="walk"] a.mc-bar', 'href')) === 'walkthrough.html', 'the card opens the walkthrough');
      assert.deepEqual(await page.$$eval('[data-card="walk"] .wk-acts', a => a.map(x => [...x.querySelectorAll('a')].map(l => l.textContent + '=' + l.getAttribute('href')).join(' '))),
        ['Check now=yard.html?walk=1 View=yard.html', 'Check now=temps.html?walk=1 View=temps.html', 'Check now=quality.html?walk=1 View=quality.html']);
      assert.equal((await page.$$eval('[data-card="walk"] .mc-tile', t => t.map(x => x.getAttribute('href') || x.dataset.href || ''))).join(), 'yard.html?walk=1,temps.html?walk=1,quality.html?walk=1,walkthrough.html,',
        'a tap on a stop opens its walkthrough check (Joe 10/23: the Pictures stop is not a link; it has Take Picture)');
      assert.deepEqual(await page.$$eval('[data-card="walk"] .mc-tile > span', a => a.map(x => x.firstChild.textContent.trim())), ['Yard', 'Coolers', 'Production', 'Last Walkthrough', 'Pictures']);
      assert.deepEqual(await page.$$eval('[data-card="notes"] .mc-tile > span', a => a.map(x => x.textContent)), ['Breakdowns', 'Handoffs', 'Carryover']);
      // The card's tiles are redrawn as data arrives, so wait for the drawn tile rather than reading the first one.
      const bigSize = () => page.$eval('[data-card="walk"] .mc-tile b', b => getComputedStyle(b).fontSize + ' ' + b.className + ' ' + b.textContent);
      await page.waitForFunction(() => { const b = document.querySelector('[data-card="walk"] .mc-tile b'); return b && parseFloat(getComputedStyle(b).fontSize) >= 40; }, null, { timeout: 8000 })
        .catch(async () => assert.fail('big numbers at ' + w + ': ' + await bigSize()));
      // Shift Notes A (Joe 10/10): breakdowns still open, carried over from earlier shifts; Joe 10/15: handoff notes still open
      // (they stay until resolved, not only since the last report).
      assert.deepEqual([await tileText(page, 'notes', 'Breakdowns'), await tileText(page, 'notes', 'Handoffs'), await tileText(page, 'notes', 'Carryover')],
        ['1 | still open', '0 | open', '0 | from earlier shifts']);
      // The loads reach Manager Center through runDays (a trigger on each run), so wait for all four before reading the chips.
      await page.waitForFunction(() => /of 4 To load/.test(document.getElementById('pv-chips').textContent), null, { timeout: 20000 });
      assert.match(await page.textContent('#pv-chips'), new RegExp(behind + ' Behind[\\s\\S]*3 of 4 To load[\\s\\S]*1 Pickups[\\s\\S]*1 Breakdowns[\\s\\S]*0 Lines down[\\s\\S]*1 Temps out'));
      // Review item 30 (Joe 10/13): the buttons are words only (no 📊 ✉ ✎), a tile label is one 16px line, and a route behind
      // shows its whole BEHIND line.
      assert.deepEqual(await page.$$eval('#reports, .mc-btn, .mc-pvnote', b => b.map(x => x.textContent.trim()).filter(t => !/^[A-Za-z][A-Za-z /…]*$/.test(t))), []);
      assert.deepEqual(await page.$$eval('.mc-tile > span', sp => sp.filter(x => parseFloat(getComputedStyle(x).fontSize) < 16 || x.getClientRects().length > 1 || x.offsetHeight > 26).map(x => x.textContent)), []);
      assert.deepEqual(await page.$$eval('.mc-rt i', i => i.filter(x => x.scrollWidth > x.clientWidth + 1).map(x => x.textContent)), []);
      if (w === 1920) await fits(page, 'Manager Center ' + w + 'x' + h);
      // Joe 10/19: on his laptop (a 1536 x 886 window) and at 1920 the page shows without scrolling. Joe 10/26: the department
      // cards went two by two (bigger, like the Departments screen), so the four cards show whole and the walkthrough row is
      // reached by scrolling the cards (the page itself still never scrolls).
      if (h >= 886) {
        const g = await page.$eval('#grid', x => ({ deptBottom: Math.round(x.querySelector('[data-card="dept"]').getBoundingClientRect().bottom), gridBottom: Math.round(x.getBoundingClientRect().bottom) }));
        assert.ok(g.deptBottom <= g.gridBottom + 1, 'Plant Distribution ' + w + 'x' + h + ' shows the four department cards whole: ' + JSON.stringify(g));
      }
      await shots(page, 'manager', w === 1536 && h === 886 ? '1536x886' : w);
      // The Manager Walkthrough card at the bottom of the cards (scrolled to it where the screen is short).
      if (SHOTS) { await page.$eval('#grid', g => { g.scrollTop = g.scrollHeight; }); await page.screenshot({ path: path.join(SHOTS, 'manager-walk-card-' + w + '.png'), scale: 'css' }); }
      assert.deepEqual(page.errors, []);
      await page.close();
    }
    const page = await openPage(browser, 1920, 950, '/manager.html' + MANAGER);
    await page.waitForFunction(() => /Plant Update/.test(document.getElementById('pv-subject').textContent) && /of 4/.test(document.querySelector('[data-card="dept"]').textContent));
    // The Plant menu with a section open beside it (Joe 10/10: sections like the Distribution side, no Manager Menu on the screen).
    if (SHOTS) {
      for (const sec of ['Plant Distribution Departments']) {
        await page.hover('.sidemenu .side-sec-btn[title="' + sec + '"]');
        await page.waitForSelector('.side-flyouts .flyout.open');
        await page.screenshot({ path: path.join(SHOTS, 'plant-menu-' + sec.toLowerCase().replace(/ /g, '-') + '-open-1920.png'), scale: 'css' });
      }
      await page.mouse.move(1500, 900);
      await page.mouse.click(1500, 940);
    }
    // Joe 10/11: the card's preview is a brief: routes behind and other problems only, never the loaded or still-to-load list.
    const brief = await page.textContent('#pv-list');
    assert.match(brief, /Routes1 of 4 loaded[\s\S]*Routes late or behind[\s\S]*502[\s\S]*LATE/, brief);
    assert.doesNotMatch(brief, /501|LOADED$|NOT LOADED/, brief);
    await page.click('.mc-preview');
    await page.waitForSelector('#modal:not([hidden])');
    const body = await page.textContent('#rp-body');
    // Joe 10/14: each tile is the route number and the run's short name; only a late (Joe 11/1: truck should have left) or
    // behind route has a word (green is loaded, red is not).
    assert.match(body, new RegExp(seed.behind + ' ROUTES? LATE[\\s\\S]*Loaded \\(1\\)501 Akron[\\s\\S]*Not loaded \\(3\\)502 CantonLATE503 Massillon(LATE)?504 Wooster(LATE)?Routes late or behind'));
    assert.doesNotMatch((await page.$$eval('#rp-body .mc-routes', d => d.map(x => x.textContent))).join(' '), /LOADED/, 'the route tiles have no LOADED / NOT LOADED words');
    assert.match(body, /Pickups open1PICKUP 503 MASSILLON3 cases Chocolate milk/);
    assert.match(body, /Plant breakdowns1Palletizer/);
    assert.match(body, /Cooler North44°F · HIGH · limit 33–41/);
    await page.fill('#note', 'Short staffed on second shift');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'manager-report-1920.png'), scale: 'css' });
    await page.click('#send');
    await page.waitForFunction(() => /Report saved\. Email is not set up in Operations yet/.test(document.getElementById('saved').textContent) && document.getElementById('modal').hidden);
    const kept = (await db().collection('plantReports').get()).docs.map(x => x.data());
    assert.equal(kept.length, 1);
    assert.match(kept[0].text, new RegExp('^NOTE: Short staffed on second shift\\n\\nROUTES LATE OR BEHIND \\(' + seed.behind + '\\)'));
    results.push('Send Current Report: kept as sent (' + kept[0].subject + '), not emailed');
    const phone = await openPage(browser, 412, 860, '/manager.html' + MANAGER);
    await phone.waitForFunction(() => /of 4/.test(document.getElementById('pv-chips').textContent) && !document.getElementById('send-card').hidden);
    if (SHOTS) await phone.screenshot({ path: path.join(SHOTS, 'manager-phone-412.png'), scale: 'css', fullPage: true });
    for (const p of [page, phone]) assert.deepEqual(p.errors, []);
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('MANAGER ' + r));
})().catch(e => { console.error(e); process.exit(1); });

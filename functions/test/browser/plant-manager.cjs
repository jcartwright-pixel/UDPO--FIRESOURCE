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
const { db, clear } = require('../emulator/helpers');
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
// The test's clock. The four loads fit inside the operating day (2 hours before to 5 hours after now) only from 6:00 AM to 6:59 PM;
// at any other hour the screens run on a clock pinned to 6:00 PM of the operating day, so the check is the same every hour of the night.
const CLOCK = (() => {
  const real = Date.now(), m = nyMinutes(real);
  if (m >= 360 && m <= 1139) return { ms: real, pinned: false };
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
}
const tileText = (page, card, label) => page.$eval('[data-card="' + card + '"]', (c, l) => { const t = [...c.querySelectorAll('.mc-tile')].find(x => x.querySelector('span').textContent === l); return t ? t.querySelector('b').textContent + ' | ' + t.querySelector('i').textContent : ''; }, label);

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date('2026-10-08T14:00:00Z') });
  await seed();
  assert.equal(seed.behind, 1, 'one load (502) is behind');
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const [w, h] of [[1920, 950], [1366, 650]]) {
      const page = await openPage(browser, w, h, '/manager.html' + MANAGER);
      await page.waitForFunction(() => /Plant Update/.test(document.getElementById('pv-subject').textContent) && /of 4/.test(document.querySelector('[data-card="dept"]').textContent));
      const behind = seed.behind;
      assert.match(await page.textContent('#pv-subject'), new RegExp('^Plant Update .+: ' + behind + ' routes? behind$'));
      assert.equal(await tileText(page, 'dept', 'Loadout Center'), '1of 4 | 3 waiting · 0 loading');
      assert.equal(await tileText(page, 'quality', 'Quality Checks'), '5lines | all running');
      // Joe 10/15: Status says OK when all is well, otherwise how many need checking (red).
      assert.equal(await tileText(page, 'temps', 'Status'), '1 | need checking');
      assert.ok(await page.$eval('[data-card="temps"] .mc-tile.bad', t => /Status/.test(t.textContent)), 'Status is red');
      // Joe 10/15: Scheduler shows Shipping and Receiving only, today's loads big with this week under; Yard tiles say what they count.
      assert.deepEqual(await page.$$eval('[data-card="sched"] .mc-tile > span', a => a.map(x => x.textContent)), ['Shipping', 'Receiving']);
      assert.match(await tileText(page, 'sched', 'Shipping'), /^\d+today \| \d+ this week$/);
      // Joe 10/15 (later): Yard Checks and Cooler Temperature Reports are two big tiles each.
      assert.deepEqual(await page.$$eval('[data-card="yard"] .mc-tile > span', a => a.map(x => x.textContent)), ['In the Yard', 'Checked']);
      assert.deepEqual(await page.$$eval('[data-card="temps"] .mc-tile > span', a => a.map(x => x.textContent)), ['Status', 'Last Manual Read']);
      assert.ok(await page.$eval('[data-card="yard"] .mc-tile b', b => parseFloat(getComputedStyle(b).fontSize) >= 40), 'big numbers');
      // Shift Notes A (Joe 10/10): breakdowns still open, carried over from earlier shifts; Joe 10/15: handoff notes still open
      // (they stay until resolved, not only since the last report).
      assert.deepEqual([await tileText(page, 'notes', 'Breakdowns'), await tileText(page, 'notes', 'Carried Over'), await tileText(page, 'notes', 'Handoff')],
        ['1 | still open', '0 | from earlier shifts', '0 | none open']);
      assert.match(await page.textContent('#pv-chips'), new RegExp(behind + ' Behind[\\s\\S]*3 of 4 To load[\\s\\S]*1 Pickups[\\s\\S]*1 Breakdowns[\\s\\S]*0 Lines down[\\s\\S]*1 Temps out'));
      // Review item 30 (Joe 10/13): the buttons are words only (no 📊 ✉ ✎), a tile label is one 16px line, and a route behind
      // shows its whole BEHIND line.
      assert.deepEqual(await page.$$eval('#reports, .mc-btn, .mc-pvnote', b => b.map(x => x.textContent.trim()).filter(t => !/^[A-Za-z][A-Za-z /…]*$/.test(t))), []);
      assert.deepEqual(await page.$$eval('.mc-tile > span', sp => sp.filter(x => parseFloat(getComputedStyle(x).fontSize) < 16 || x.getClientRects().length > 1 || x.offsetHeight > 26).map(x => x.textContent)), []);
      assert.deepEqual(await page.$$eval('.mc-rt i', i => i.filter(x => x.scrollWidth > x.clientWidth + 1).map(x => x.textContent)), []);
      if (w === 1920) await fits(page, 'Manager Center ' + w + 'x' + h);
      await shots(page, 'manager', w);
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
    assert.match(brief, /Routes1 of 4 loaded[\s\S]*Routes behind[\s\S]*502[\s\S]*BEHIND/, brief);
    assert.doesNotMatch(brief, /501|LOADED$|NOT LOADED/, brief);
    await page.click('.mc-preview');
    await page.waitForSelector('#modal:not([hidden])');
    const body = await page.textContent('#rp-body');
    // Joe 10/14: each tile is the route number and the run's short name; only BEHIND has a word (green is loaded, red is not).
    assert.match(body, new RegExp(seed.behind + ' ROUTES? BEHIND[\\s\\S]*Loaded \\(1\\)501 Akron[\\s\\S]*Not loaded \\(3\\)502 CantonBEHIND503 Massillon(BEHIND)?504 Wooster(BEHIND)?Routes behind'));
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
    assert.match(kept[0].text, new RegExp('^NOTE: Short staffed on second shift\\n\\nROUTES BEHIND \\(' + seed.behind + '\\)'));
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

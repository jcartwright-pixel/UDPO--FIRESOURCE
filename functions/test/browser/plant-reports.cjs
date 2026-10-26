'use strict';
/*
 * Browser check of Plant Reports (Joe 10/10, the Reports button on Manager Center) on made-up history: three weeks of ten loads a
 * day where Thursdays run late and have the most pickups. Checks the Reports drop-down on Manager Center, the one-day report, the
 * week, the Day-of-Week Trends and the Plant Performance kiosk. Pictures go to SHOTS_DIR.
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
const MANAGER = 'testEmail=manager.test@uniteddairy.com';

async function openPage(browser, width, height, url) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: SHOTS && width === 1920 ? 2 : 1 });
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
async function shots(page, name, w) {
  if (!SHOTS) return;
  await page.screenshot({ path: path.join(SHOTS, name + '-' + w + '.png'), scale: 'css' });
  if (w === 1920) await page.screenshot({ path: path.join(SHOTS, name + '-top-2x.png'), clip: { x: 0, y: 0, width: 1920, height: 540 }, scale: 'device' });
}

// A New York wall time (date + minutes of the day) as a UTC stamp.
function nyStamp(date, minutes) {
  const [y, m, d] = date.split('-').map(Number);
  let t = Date.UTC(y, m - 1, d, 0, 0) + minutes * 60000 + 4 * 3600000;
  for (let i = 0; i < 2; i++) {
    const p = {};
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(t)).forEach(x => { p[x.type] = x.value; });
    const wall = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute));
    t += (Date.UTC(y, m - 1, d, 0, 0) + minutes * 60000) - wall;
  }
  return new Date(t).toISOString();
}

const AREAS = ['CASE LOADOUT', 'CASE LOADOUT', 'CASE LOADOUT', 'CASE LOADOUT', 'CASE LOADOUT', 'CASE LOADOUT', 'CASE LOADOUT', 'TOTE', 'BOXING', 'TANKER'];
const NAMES = ['AKRON', 'CANTON', 'MASSILLON', 'WOOSTER', 'FAIRMONT', 'WHEELING', 'MARIETTA', 'ALDI CHARLESTON', 'KROGER BOX', 'TANKER EAST'];
const seen = { thursdayLate: 0 };
async function seed() {
  const d = db(), today = L.operatingDay(new Date()), first = L.addDays(L.weekStart(today), -21);
  for (const r of (await d.collection('runs').get()).docs) await r.ref.delete();
  for (const r of (await d.collection('pickups').get()).docs) await r.ref.delete();
  const runs = {};
  for (let date = first; date <= today; date = L.addDays(date, 1)) {
    const week = L.weekStart(date), p = L.dayPrefix(date), thursday = L.dayName(date).toUpperCase() === 'THURSDAY', isToday = date === today;
    for (let i = 0; i < 10; i++) {
      const route = String(501 + i), id = week + '__rp' + route;
      const run = runs[id] || (runs[id] = { weekStart: week, sheetRow: 900 + i, route, run: NAMES[i], routeId: 'rte_rp' + route, runId: 'run_rp' + route, active: true, loadType: AREAS[i], days: {} });
      const depart = 13 * 60 + i * 50;
      const day = { runs: true, loadDayOffset: 0, dispatchTime: depart, loadSequence: i + 1, truck: String(200 + i), trailer: 'T-' + (10 + i) };
      // Thursdays: three loads late (55-95 minutes) and one never loaded; other days one load 40 minutes late on Saturdays.
      let late = null;
      if (thursday && i < 3) late = 55 + i * 20;
      if (L.dayName(date).toUpperCase() === 'SATURDAY' && i === 4) late = 40;
      // Thursdays: the driver of 507 reports a shortage at check-in.
      if (thursday && i === 6) Object.assign(day, { overageShortage: 'YES', overageShortageDetails: '2 cs 1/2 GAL WHOLE short' });
      const missed = thursday && i === 9;
      if (isToday) {
        if (i < 4) Object.assign(day, { loadStatus: 'COMPLETE', plantStartedAt: nyStamp(date, depart - 70), completeTime: nyStamp(date, depart - 25) });
        else if (i === 4) Object.assign(day, { loadStatus: 'LOADING', plantStartedAt: new Date(Date.now() - 20 * 60000).toISOString() });
      } else if (!missed) {
        const done = late === null ? depart - 20 - (i % 3) * 5 : depart + late;
        Object.assign(day, { loadStatus: 'COMPLETE', plantStartedAt: nyStamp(date, done - 35 - i), completeTime: nyStamp(date, done) });
      }
      if (thursday && late !== null) seen.thursdayLate++;
      run.days[p] = day;
    }
    // Pickups: three on Thursdays, one on Mondays and Fridays.
    const wd = L.dayName(date).toUpperCase(), picks = wd === 'THURSDAY' ? 3 : ['MONDAY', 'FRIDAY'].indexOf(wd) >= 0 ? 1 : 0;
    for (let k = 0; k < picks; k++) {
      await d.collection('pickups').doc('rp_' + date + '_' + k).set({ pickupId: 'rp_' + date + '_' + k, date, runId: 'run_rp' + (502 + k), route: String(502 + k), run: NAMES[1 + k],
        item: ['1/2 GAL WHOLE MILK', 'QT CHOC MILK', 'GAL 2%'][k], quantity: (4 + k * 3) + ' cases', status: isToday ? 'PENDING' : 'COMPLETE' });
    }
    if (wd === 'THURSDAY' || wd === 'WEDNESDAY') {
      await d.collection('plantJournal').doc('SHIFT_REPORT_app_rp' + date).set({ recordId: 'SHIFT-rp' + date, type: 'SHIFT_REPORT', date, area: 'HANDOFF', recordedAt: nyStamp(date, 15 * 60), recordedBy: 'supervisor.test@uniteddairy.com',
        createdInApp: true, payload: { entryId: 'SHIFT-rp' + date, section: 'HANDOFF', shift: 'FIRST SHIFT', values: { Entry: 'Infeed belt jammed', Type: 'Breakdown', Equipment: 'Palletizer' }, notes: '', followUpStatus: 'RESOLVED' } });
    }
  }
  const yesterday = L.addDays(today, -1);
  await d.collection('plantJournal').doc('PLANT_TEMPERATURE_CHECK_app_rp').set({ recordId: 'TEMP-rp', type: 'PLANT_TEMPERATURE_CHECK', date: yesterday, status: 'HIGH', recordedAt: nyStamp(yesterday, 16 * 60),
    recordedBy: 'supervisor.test@uniteddairy.com', createdInApp: true, payload: { locationId: 'ut_temp_cooler_north', location: 'Cooler North', manualTemperature: 44, status: 'HIGH' } });
  for (const [id, run] of Object.entries(runs)) await d.collection('runs').doc(id).set(run);
  return { today, yesterday };
}

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date('2026-10-08T14:00:00Z') });
  const { today, yesterday } = await seed();
  const browser = await chromium.launch();
  const results = [];
  try {
    // Manager Center: the Reports button opens the Reports module (Joe 10/11: every report in one place); its Plant Reports
    // card opens the Plant Scorecard (look B): seven day cards and the week, yesterday picked.
    const mc = await openPage(browser, 1920, 950, '/manager.html?' + MANAGER);
    await mc.waitForFunction(() => /Plant Update/.test(document.getElementById('pv-subject').textContent) && /of 10 To load/.test(document.getElementById('pv-chips').textContent));
    const size = await mc.evaluate(() => ({ scroll: document.scrollingElement.scrollHeight, inner: window.innerHeight }));
    assert.ok(size.scroll <= size.inner, 'Manager Center still fits with the Reports button');
    await shots(mc, 'manager-reports-button', 1920);
    await Promise.all([mc.waitForURL(/reportcenter\.html/), mc.click('#reports')]);
    await Promise.all([mc.waitForURL(/\/reports\.html/), mc.click('.rc-card[href="reports.html"]')]);
    await mc.waitForSelector('.rp-days .rp-day.on');
    assert.equal(await mc.$$eval('.rp-day', b => b.length), 8);
    assert.equal(await mc.$eval('.rp-day.on', b => b.dataset.day), yesterday);
    assert.deepEqual(mc.errors, []);
    await mc.close();
    results.push('Manager Center: Reports opens the Plant Scorecard on yesterday');

    // One day: the last Thursday (3 late, 1 not loaded, 3 pickups, a breakdown, a check-in shortage).
    let thu = L.addDays(today, -1);
    while (L.dayName(thu).toUpperCase() !== 'THURSDAY') thu = L.addDays(thu, -1);
    for (const [w, h] of [[1920, 1080], [1366, 768]]) {
      const pg = await openPage(browser, w, h, '/reports.html?view=scorecard&week=' + L.weekStart(thu) + '&date=' + thu + '&' + MANAGER);
      await pg.waitForSelector('#detail .rp-kpis');
      const k = await pg.$$eval('#detail .rp-kpi', ks => ks.map(x => x.querySelector('span').textContent + '=' + x.querySelector('b').textContent));
      assert.deepEqual(k.slice(0, 4), ['Loads=10', 'On time=60%', 'Late=3', 'Not loaded=1']);
      assert.equal(k[6], 'Pickups=3');
      // Review item 29 (Joe 10/13): the Loadout times keep their AM/PM and are not cut off; "No loads" is never giant letters.
      assert.match(k[4], /^Loadout=(\d+:\d\d\s[AP]M|—) – (\d+:\d\d\s[AP]M|—)$/);
      assert.ok(await pg.$eval('#detail .rp-kpi:nth-child(5) b', b => b.scrollWidth <= b.clientWidth + 1 && b.getBoundingClientRect().right <= b.parentElement.getBoundingClientRect().right + 1), 'the Loadout times fit their tile at ' + w);
      assert.deepEqual(await pg.$$eval('.rp-day b', bs => bs.filter(b => b.textContent === 'No loads' && (!b.classList.contains('rp-none-day') || b.getClientRects().length > 1 || b.offsetHeight > 40)).length), 0);
      assert.equal(k[7], 'Breakdowns=1');
      assert.match(await pg.textContent('#detail .rp-grid'), /503 MASSILLON[\s\S]*1 h 35 min[\s\S]*510 TANKER EAST[\s\S]*NOT LOADED/);
      assert.match(await pg.textContent('#detail'), /Check-in: 2 cs 1\/2 GAL WHOLE short/);
      assert.equal(await pg.$eval('.rp-day[data-day="' + thu + '"] b', b => b.textContent), '60%');
      assert.ok(await pg.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth), 'no sideways page scrolling at ' + w);
      await shots(pg, 'scorecard-thursday', w);
      // The week's card: the seven days, Sunday to Saturday, and the week's total.
      await pg.click('.rp-day[data-day="week"]');
      await pg.waitForSelector('tr[data-day]');
      const days = await pg.$$eval('#detail tr[data-day]', r => r.map(x => x.querySelector('td').textContent));
      assert.equal(days.length, 7);
      assert.match(days[0], /^Sunday/);
      assert.match(days[6], /^Saturday/);
      if (w === 1920) await shots(pg, 'scorecard-week', w);
      assert.deepEqual(pg.errors, []);
      await pg.close();
    }
    results.push('Scorecard: last Thursday reads 10 loads, 60% on time, 3 late, 1 not loaded, 3 pickups, 1 breakdown, the check-in shortage; Week card lists Sunday to Saturday');

    // Shift Comparison: the three Uniontown shifts; every load counted once.
    const sh = await openPage(browser, 1920, 1080, '/reports.html?view=shifts&week=' + L.weekStart(thu) + '&' + MANAGER);
    await sh.waitForSelector('.rp-lead');
    const shiftRows = await sh.$$eval('.rp-card:first-of-type tbody tr', r => r.map(x => [x.children[0].textContent, Number(x.children[1].textContent)]));
    assert.deepEqual(shiftRows.map(r => r[0].split(' ').slice(0, 2).join(' ')), ['First Shift', 'Second Shift', 'Third Shift']);
    assert.match(await sh.textContent('#body'), /Shortages drivers reported at check-in1[\s\S]*507 MARIETTASecond Shift/);
    await shots(sh, 'shift-comparison', 1920);
    assert.deepEqual(sh.errors, []);
    await sh.close();
    results.push('Shift Comparison: ' + shiftRows.map(r => r[0].split(' ').slice(0, 2).join(' ') + ' ' + r[1] + ' loads').join(', '));

    // Trends: Thursdays stand out (late and pickups).
    const tr = await openPage(browser, 1920, 1080, '/reports.html?view=trends&weeks=4&' + MANAGER);
    await tr.waitForSelector('.rp-lead');
    const lead = await tr.textContent('.rp-lead');
    assert.match(lead, /Thursdays run late most often: 60% on time/);
    assert.match(lead, /Thursdays have the most pickups/);
    assert.equal(await tr.$eval('tr.rp-flag td', t => t.textContent), 'Thursday');
    await shots(tr, 'reports-trends', 1920);
    assert.deepEqual(tr.errors, []);
    await tr.close();
    results.push('Trends: "' + lead.trim().slice(0, 120) + '…"');

    // Administration > Plant Shifts: Uniontown's three shifts to start with, and the rule the reports use.
    const ps = await openPage(browser, 1920, 1080, '/shifts.html?' + MANAGER);
    await ps.waitForSelector('#rows tr[data-i]');
    assert.deepEqual(await ps.$$eval('#rows tr[data-i]', r => r.map(x => [...x.querySelectorAll('input')].map(i => i.value).join(' '))), ['First Shift 06:00 14:30', 'Second Shift 14:00 22:30', 'Third Shift 22:00 05:30']);
    assert.match(await ps.textContent('.rp-lead'), /stays with the earlier shift/);
    // Joe 10/11: a Side column; the starting shifts are Distribution, and a Plant Production shift saves beside them.
    assert.deepEqual(await ps.$$eval('#rows select[data-k="side"]', s => s.map(x => x.value)), ['DISTRIBUTION', 'DISTRIBUTION', 'DISTRIBUTION']);
    await ps.click('#add');
    const last = '#rows tr[data-i="3"] ';
    await ps.fill(last + 'input[data-k="name"]', 'First Shift');
    await ps.selectOption(last + 'select[data-k="side"]', 'PRODUCTION');
    await ps.fill(last + 'input[data-k="start"]', '07:00');
    await ps.fill(last + 'input[data-k="end"]', '15:30');
    await shots(ps, 'plant-shifts', 1920);
    // Review items 31 and 38 (Joe 10/13): no plant drop-down and no Save Shifts button; the list saves once the new shift's
    // last box is left.
    assert.equal(await ps.$('#plant'), null, 'no plant drop-down');
    assert.equal(await ps.$('#save'), null, 'no Save Shifts button');
    assert.equal(await ps.textContent('#plant-name'), 'Uniontown');
    await ps.press(last + 'input[data-k="end"]', 'Tab');
    // Audit batch 4 (Joe's rule: no save messages): the list saves quietly.
    for (let i = 0; i < 40 && ((((await db().collection('plantShifts').doc('fac_uniontown').get()).data() || {}).shifts || []).length !== 4); i++) await ps.waitForTimeout(250);
    assert.equal(((await db().collection('plantShifts').doc('fac_uniontown').get()).data().shifts || []).length, 4, 'the four shifts saved');
    assert.equal(await ps.isVisible('#saved'), false, 'no save message');
    await ps.reload();
    await ps.waitForFunction(() => document.querySelectorAll('#rows tr[data-i]').length === 4 && /Last changed/.test(document.getElementById('last').textContent));
    assert.deepEqual(await ps.$$eval('#rows select[data-k="side"]', s => s.map(x => x.value)), ['DISTRIBUTION', 'DISTRIBUTION', 'DISTRIBUTION', 'PRODUCTION']);
    assert.deepEqual(ps.errors, []);
    await ps.close();
    results.push('Plant Shifts: Uniontown starts with 6:00-2:30, 2:00-10:30, 10:00-5:30 (Distribution); a Plant Production shift saves beside them');

    // Kiosk: today's loads, 4 of 10 loaded, the next to load listed; the TV hides the header.
    for (const [w, h, url, name] of [[1920, 1080, '/plant-kiosk.html?' + MANAGER, 'kiosk'], [1920, 1080, '/plant-kiosk.html?tv=1&' + MANAGER, 'kiosk-tv'], [1280, 800, '/plant-kiosk.html?' + MANAGER, 'kiosk-tablet'], [1024, 768, '/plant-kiosk.html?' + MANAGER, 'kiosk-tablet']]) {
      const ks = await openPage(browser, w, h, url);
      await ks.waitForFunction(() => /of 10/.test(document.getElementById('k-loaded').textContent));
      assert.equal(await ks.textContent('#k-loaded'), '4 of 10');
      assert.ok((await ks.$$('#next .pk-row')).length >= 6);
      assert.equal(await ks.isVisible('.topbar'), name !== 'kiosk-tv');
      assert.ok(!(await ks.$('.sidemenu')), 'no desktop menu on the kiosk');
      // Review item 39 (Joe 10/13): a plant screen's header word, and each big number fits its own tile ("100%" at 1024).
      if (name !== 'kiosk-tv') assert.equal(await ks.textContent('.topbar .brand small'), 'UNITED DAIRY · PLANT DISTRIBUTION');
      const over = await ks.$$eval('.pk-kpis b', bs => bs.filter(b => { const t = b.parentElement.getBoundingClientRect(), r = document.createRange(); r.selectNodeContents(b); return r.getBoundingClientRect().right > t.right + 1; }).map(b => b.textContent));
      assert.deepEqual(over, [], 'every kiosk number fits its tile at ' + w);
      if (SHOTS) await ks.screenshot({ path: path.join(SHOTS, name + '-' + w + '.png'), scale: 'css' });
      assert.deepEqual(ks.errors, []);
      await ks.close();
    }
    results.push('Kiosk: 4 of 10 loaded today, next to load listed, TV without the header');
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('REPORTS ' + r));
})().catch(e => { console.error(e); process.exit(1); });

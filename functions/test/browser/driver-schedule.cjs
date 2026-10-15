'use strict';
/*
 * Joe 10/15: My Schedule on the drivers' phone (route.html). The driver types his employee number once (the phone keeps
 * it) and sees his week, Sunday to Saturday, from the Weekly's runs; from Saturday 6 AM the coming week. A day with no run
 * says why (Off, the Day Off reason) or Not scheduled, never blank. Pictures at 390 and 800 go to SHOTS_DIR.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const F = require('../fixtures/fake-sheets');
const L = require('../../src/logic');
const { newRouteCode, scheduleWeek } = require('../../src/phone');
const localCalls = require('./local-calls.cjs');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR;
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, name), fullPage: true }); };

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: () => new Date('2026-10-09T12:00:00Z') });
  const week = scheduleWeek(L.operatingDay(new Date())), day = (i) => L.addDays(week, i);
  await db().collection('drivers').doc('drv_test_casey').update({ employeeId: '10903', 'cells.sun_available': 'FALSE', 'cells.sat_available': 'FALSE', 'cells.mon_available': 'TRUE', 'cells.tue_available': 'TRUE', 'cells.wed_available': 'TRUE', 'cells.thu_available': 'TRUE', 'cells.fri_available': 'TRUE' });
  const casey = { driverId: 'drv_test_casey', driver: 'CASEY, LEE' };
  // Only this test's runs in the week shown.
  const b = db().batch();
  (await db().collection('runs').where('weekStart', '==', week).get()).docs.forEach(d => b.delete(d.ref));
  b.set(db().collection('runs').doc(week + '__run_s905'), { weekStart: week, route: '905_1', run: 'UT DSD MILK', routeId: 'rte_s905', runId: 'run_s905', rev: 0,
    days: { mon: Object.assign({ runs: true, truck: '537', trailer: 'T-905', dispatchTime: 210 }, casey), tue: Object.assign({ runs: true, truck: '537', trailer: 'T-905', dispatchTime: 210 }, casey), wed: { runs: true, driverId: 'drv_x_other', driver: 'OTHER, PAT' } } });
  b.set(db().collection('runs').doc(week + '__run_s836'), { weekStart: week, route: '836', run: 'PECK', routeId: 'rte_s836', runId: 'run_s836', rev: 0,
    days: { wed: Object.assign({ runs: true, truck: '541', trailer: 'T-836', dispatchTime: 1290 }, casey), fri: Object.assign({ runs: true, truck: '541', trailer: 'T-836' }, casey) } });
  b.set(db().collection('exceptions').doc('ex_sched_casey'), { driverId: 'drv_test_casey', startDate: day(4), endDate: day(4), type: 'VACATION', status: 'APPROVED' });
  // Published: the week shown is the Live Current week.
  b.set(db().collection('config').doc('app'), { liveWeeks: { previous: L.addDays(week, -7), current: week, next: L.addDays(week, 7) } }, { merge: true });
  await b.commit();
  const { code } = await newRouteCode(db(), { email: 'manager.test@uniteddairy.com' });
  const browser = await chromium.launch();
  try {
    for (const w of [390, 800]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, isMobile: w < 700, hasTouch: true, serviceWorkers: 'block' });
      await ctx.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (r) => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, r.request().url().split('/').pop())) }));
      await localCalls(ctx);
      const pg = await ctx.newPage();
      const errors = [];
      pg.on('pageerror', e => errors.push(e.message));
      await pg.goto(HOSTING + '/route.html');
      await pg.fill('#code', code); await pg.click('#step-code button[type=submit]');
      await pg.waitForSelector('#step-menu:not([hidden]) #m-schedule');
      assert.deepEqual(await pg.$$eval('#step-menu .drv-card b', x => x.map(e => e.textContent)), ['View Loadout', 'DVIR', 'Check-In', 'My Schedule']);
      await shot(pg, 'after-menu-' + w + '.png');
      await pg.click('#m-schedule');
      await pg.waitForSelector('#step-sched-id:not([hidden])');
      assert.equal(await pg.inputValue('#emp-id'), '', 'the box starts empty');
      assert.equal(await pg.getAttribute('#emp-id', 'placeholder'), null, 'no placeholder that looks like a number');
      // A wrong number says so and keeps what was typed.
      await pg.fill('#emp-id', '55555'); await pg.click('#step-sched-id button[type=submit]');
      await pg.waitForFunction(() => /not on the driver list/.test(document.getElementById('error').textContent));
      assert.equal(await pg.isVisible('#step-sched-id'), true);
      await shot(pg, 'after-id-' + w + '.png');
      await pg.fill('#emp-id', '010903'); await pg.click('#step-sched-id button[type=submit]');
      await pg.waitForSelector('#step-sched:not([hidden]) .sched-day');
      assert.match(await pg.textContent('#sched-name'), /CASEY, LEE · 10903/);
      const short = (k) => { const [y, m, d] = k.split('-'); return Number(m) + '-' + Number(d) + '-' + y.slice(2); };
      assert.equal(await pg.textContent('#sched-week'), 'Week of ' + short(week) + ' to ' + short(day(6)));
      const days = await pg.$$eval('.sched-day', x => x.map(e => ({ date: e.querySelector('.sched-date').textContent, text: e.querySelector('.sched-what').textContent })));
      assert.equal(days.length, 7);
      assert.match(days[0].date, /^Sunday/); assert.match(days[6].date, /^Saturday/);
      assert.equal(days[0].text, 'Off');
      assert.match(days[1].text, /^905 UT DSD MILKTruck 537 · Trailer T-905 · Leaves 3:30 AM$/);
      assert.match(days[3].text, /^836 PECKTruck 541 · Trailer T-836 · Leaves 9:30 PM$/, 'another driver\'s run that day is not his');
      assert.equal(days[4].text, 'Off: Vacation');
      assert.match(days[5].text, /^836 PECK/);
      assert.equal(days[6].text, 'Off');
      assert.equal(await pg.isVisible('#sched-note'), false, 'the week is posted');
      // The schedule's sign-in also tells DVIR and Check-In who is driving.
      assert.equal(await pg.textContent('#who'), 'CASEY, LEE');
      const fit = await pg.evaluate(() => ({ side: document.scrollingElement.scrollWidth - innerWidth, small: [...document.querySelectorAll('#step-sched *')].filter(e => e.offsetParent && e.childNodes.length && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) < 16).map(e => e.textContent) }));
      assert.ok(fit.side <= 0, 'no side scroll at ' + w);
      assert.deepEqual(fit.small, [], 'text at least 16px at ' + w);
      await shot(pg, 'after-schedule-' + w + '.png');
      // The phone keeps the number: back and in again goes straight to the week.
      await pg.click('#step-sched [data-back]');
      await pg.click('#m-schedule');
      await pg.waitForSelector('#step-sched:not([hidden]) .sched-day');
      // Not you? forgets the number and the name and asks for the number again.
      await pg.click('#sched-not-me');
      await pg.waitForSelector('#step-sched-id:not([hidden])');
      assert.equal(await pg.textContent('#who'), '');
      assert.equal(await pg.inputValue('#emp-id'), '');
      assert.deepEqual(errors, []);
      await ctx.close();
    }
    // A week Dispatch has built but not posted yet: shown, with a line that it can still change.
    await db().collection('config').doc('app').set({ liveWeeks: { previous: L.addDays(week, -14), current: L.addDays(week, -7), next: week } }, { merge: true });
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    await ctx.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (r) => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, r.request().url().split('/').pop())) }));
    await localCalls(ctx);
    const pg = await ctx.newPage();
    await pg.goto(HOSTING + '/route.html?view=schedule');
    await pg.fill('#code', code); await pg.click('#step-code button[type=submit]');
    // route.html?view=schedule opens My Schedule straight away (a link or home-screen icon for it).
    await pg.waitForSelector('#step-sched-id:not([hidden])');
    await pg.fill('#emp-id', '10903'); await pg.click('#step-sched-id button[type=submit]');
    await pg.waitForSelector('#step-sched:not([hidden]) .sched-day');
    assert.equal(await pg.textContent('#sched-note'), 'Dispatch has not posted this week yet, so it can still change.');
    assert.match((await pg.$$eval('.sched-what', x => x.map(e => e.textContent)))[1], /^905 UT DSD MILK/);
    await shot(pg, 'after-not-posted-390.png');
    // A week with no runs at all: every day still says something.
    await db().collection('runs').doc(week + '__run_s905').delete(); await db().collection('runs').doc(week + '__run_s836').delete();
    await pg.click('#sched-refresh');
    await pg.waitForFunction(() => /Check back later/.test(document.getElementById('sched-note').textContent));
    const texts = await pg.$$eval('.sched-what', x => x.map(e => e.textContent));
    assert.deepEqual(texts, ['Off', 'Not scheduled', 'Not scheduled', 'Not scheduled', 'Off: Vacation', 'Not scheduled', 'Off']);
    await ctx.close();
    console.log('driver-schedule: ok');
  } finally { await browser.close(); }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });

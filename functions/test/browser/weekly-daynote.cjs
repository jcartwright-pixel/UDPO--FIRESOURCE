'use strict';
/*
 * Joe 10/23: a Day Note on Weekly Dispatch's Driver Assignment Board ("riding with ..."). The Driver availability box has
 * "Day Note — No Route"; the day then shows the note in teal (with a legend entry), the run's driver list shows the note
 * beside the driver, and his My Schedule on the phone reads the note. Nothing is assigned and no day needs a driver.
 * Pictures at 1536 and 1920 go to SHOTS_DIR when it is set.
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
const SHOTS = process.env.SHOTS_DIR || '';
const NOTE = 'Riding with Pat Adams';
const sdk = (route) => route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });

async function openPage(browser, width, height, url) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, sdk);
  await page.clock.setFixedTime(new Date('2026-10-09T12:00:00Z'));
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(HOSTING + url);
  page.errors = errors;
  return page;
}
// CASEY, LEE: Wednesday (his regular day off) and Thursday.
const cell = (n) => '#board-rows tr[data-driver="drv_test_casey"] td:nth-child(' + n + ')';
// The footer count settles once every list has loaded (plant loads can add a Needs Driver day a moment later): read it
// once it has stayed the same for a second.
async function countText(page) {
  let last = await page.textContent('#count'), same = 0;
  for (let i = 0; i < 40 && same < 4; i++) { await page.waitForTimeout(250); const now = await page.textContent('#count'); same = now === last ? same + 1 : 0; last = now; }
  return last;
}

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: () => new Date('2026-10-09T12:00:00Z') });
  for (const id of ['run_t801', 'run_t802', 'run_t810']) await db().collection('routes').doc(id).update({ displayDaily: true, displayWeekly: true });
  const browser = await chromium.launch();
  try {
    for (const [w, h] of [[1920, 950], [1536, 790]]) {
      const page = await openPage(browser, w, h, '/weekly.html?week=2026-10-04&testEmail=dispatch.test@uniteddairy.com#board');
      await page.waitForSelector(cell(5) + ' button');
      assert.match(await page.textContent('#legend'), /Day Note — No Route/);
      const before = await countText(page);
      await page.click(cell(5) + ' button');
      const choices = await page.$$eval('#avail-reason option', o => o.map(x => x.textContent));
      assert.deepEqual(choices.slice(0, 3), ['Available', 'Backup', 'Day Note — No Route']);
      assert.equal(await page.isVisible('#daynote-help'), false, 'the help shows only for Day Note');
      await page.selectOption('#avail-reason', 'DAYNOTE');
      assert.equal(await page.isVisible('#daynote-help'), true);
      // Without a note nothing is saved and the box stays open.
      await page.click('#avail-save');
      assert.equal(await page.isVisible('#avail-modal'), true);
      await page.fill('#avail-note', NOTE);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'after-popup-' + w + '.png') });
      await page.click('#avail-save');
      await page.waitForFunction((sel) => { const td = document.querySelector(sel); return td.classList.contains('b-daynote') && td.textContent === 'RIDING WITH PAT ADAMS'; }, cell(5), { timeout: 5000 });
      const look = await page.$eval(cell(5), td => { const s = getComputedStyle(td); return { bg: s.backgroundColor, color: s.color, size: parseFloat(s.fontSize), cut: td.scrollWidth > td.clientWidth + 1 }; });
      assert.equal(look.bg, 'rgb(31, 122, 140)');
      assert.equal(look.color, 'rgb(255, 255, 255)');
      assert.ok(look.size >= 16, 'text at least 16px');
      assert.equal(look.cut, false, 'the whole note shows');
      assert.equal(await countText(page), before, 'no new day needs a driver');
      await page.evaluate(() => document.getElementById('board-panel').scrollIntoView());
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'after-board-' + w + '.png') });
      // Stays after a reload (saved on the server); the box opens on Day Note with the note.
      await page.reload();
      await page.waitForFunction((sel) => { const td = document.querySelector(sel); return td && td.classList.contains('b-daynote'); }, cell(5), { timeout: 8000 });
      await page.click(cell(5) + ' button');
      assert.equal(await page.$eval('#avail-reason', s => s.value), 'DAYNOTE');
      assert.equal(await page.inputValue('#avail-note'), NOTE);
      // Available takes it off.
      await page.selectOption('#avail-reason', 'AVAILABLE');
      await page.click('#avail-save');
      await page.waitForFunction((sel) => document.querySelector(sel).textContent === 'AVAILABLE', cell(5), { timeout: 5000 });
      let saved = '';
      for (let i = 0; i < 50 && saved !== 'drv_test_casey__2026-10-07:AVAILABLE'; i++) {
        await page.waitForTimeout(200);
        saved = (await db().collection('driverBackups').get()).docs.map(d => d.id + ':' + (d.data().kind || '')).join();
      }
      assert.equal(saved, 'drv_test_casey__2026-10-07:AVAILABLE');
      await db().collection('driverBackups').doc('drv_test_casey__2026-10-07').delete();
      assert.deepEqual(page.errors, []);
      await page.close();
    }
    assert.equal((await db().collection('masterOutbox').get()).docs.filter(d => JSON.stringify(d.data()).includes('Pat Adams')).length, 0, 'nothing for the sheets');

    // The run's driver list (Override shows everyone) shows the note beside the driver.
    await db().collection('driverBackups').doc('drv_test_casey__2026-10-10').set({ driverId: 'drv_test_casey', date: '2026-10-10', kind: 'DAYNOTE', note: NOTE });
    const page = await openPage(browser, 1920, 950, '/weekly.html?week=2026-10-04&testEmail=dispatch.test@uniteddairy.com');
    await page.waitForSelector('#rows td.day.editable[data-day="sat"]');
    await page.click('xpath=//tbody[@id="rows"]/tr[td[1][text()="810"]]/td[@data-day="sat"]');
    await page.waitForSelector('.popover select[data-kind="driver"]');
    const names = await page.$$eval('.popover select[data-kind="driver"] option', o => o.map(x => x.textContent));
    assert.ok(names.includes('CASEY, LEE — RIDING WITH PAT ADAMS'), names.join(' | '));
    assert.ok(!names.includes('CASEY, LEE — BACKUP'), 'a Day Note is not Backup');
    assert.deepEqual(page.errors, []);
    await page.close();

    // My Schedule on the phone reads the note on that day.
    const week = scheduleWeek(L.operatingDay(new Date())), day = (i) => L.addDays(week, i);
    await db().collection('drivers').doc('drv_test_casey').update({ employeeId: '10903' });
    await db().collection('driverBackups').doc('drv_test_casey__' + day(2)).set({ driverId: 'drv_test_casey', date: day(2), kind: 'DAYNOTE', note: NOTE });
    await db().collection('config').doc('app').set({ liveWeeks: { previous: L.addDays(week, -7), current: week, next: L.addDays(week, 7) } }, { merge: true });
    const { code } = await newRouteCode(db(), { email: 'manager.test@uniteddairy.com' });
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    await ctx.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, sdk);
    await localCalls(ctx);
    const pg = await ctx.newPage();
    const errors = [];
    pg.on('pageerror', e => errors.push(e.message));
    await pg.goto(HOSTING + '/route.html');
    await pg.fill('#code', code); await pg.click('#step-code button[type=submit]');
    await pg.waitForSelector('#step-menu:not([hidden]) #m-schedule');
    await pg.click('#m-schedule');
    await pg.fill('#emp-id', '10903'); await pg.click('#step-sched-id button[type=submit]');
    await pg.waitForSelector('#step-sched:not([hidden]) .sched-day');
    const tue = await pg.$eval('.sched-day:nth-child(3)', e => ({ cls: e.className, text: e.querySelector('.sched-what').textContent }));
    assert.equal(tue.text, NOTE);
    assert.match(tue.cls, /daynote/);
    if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, 'after-phone-schedule.png'), fullPage: true });
    assert.deepEqual(errors, []);
    await ctx.close();
    console.log('weekly-daynote: OK');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });

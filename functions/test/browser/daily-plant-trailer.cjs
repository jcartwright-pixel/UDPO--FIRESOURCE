'use strict';
/*
 * Browser check (Joe 10/20: "the trailer number should have already been in here for Garber, Ventura, Ohio Processor"): a load on
 * Daily Dispatch with no trailer of its own shows the trailer the plant put on its Plant Scheduler load, at 1536 and 1920 wide,
 * plain (not the orange "missing" box), with a hover that says where it came from. A load with its own trailer keeps it.
 * Pictures go to SHOTS_DIR.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { clear, db } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const F = require('../fixtures/fake-sheets');
const L = require('../../src/logic');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR;
const DATE = '2026-10-05';

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

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: () => new Date('2026-10-09T12:00:00Z') });
  const runs = (await db().collection('runs').get()).docs.map(d => Object.assign({ id: d.id }, d.data()));
  const day = L.dailyRows(runs, DATE);
  assert.ok(day.length >= 2, 'the made-up day has two loads');
  const [plantRow, ownRow] = day;
  // The first load has no trailer on dispatch; the plant put T-10295 on its Scheduler load. The second keeps its own trailer.
  await db().collection('runs').doc(plantRow.runDocId).update({ ['days.' + plantRow.day + '.trailer']: '', ['days.' + plantRow.day + '.trailerId']: '' });
  await db().collection('runs').doc(ownRow.runDocId).update({ ['days.' + ownRow.day + '.trailer']: 'T-901', ['days.' + ownRow.day + '.trailerId']: 'veh_trailer_t_901' });
  await db().collection('plantLoads').doc('SCHED-test-trailer').set({ runId: plantRow.runId, route: plantRow.route, run: plantRow.run, date: plantRow.deliveryDate, status: 'SCHEDULED', pickupTime: '16:00', trailer: 'T-10295' });
  await db().collection('plantLoads').doc('SCHED-test-own').set({ runId: ownRow.runId, route: ownRow.route, run: ownRow.run, date: ownRow.deliveryDate, status: 'SCHEDULED', pickupTime: '17:00', trailer: 'T-777' });
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const [w, h] of [[1536, 790], [1920, 1080]]) {
      const p = await openPage(browser, w, h, '/daily.html?date=' + DATE + '&testEmail=dispatch.test@uniteddairy.com');
      const cellOf = (r) => '#rows tr[data-id="' + r.id + '"] td[data-edit="trailer"]';
      await p.waitForFunction((sel) => { const td = document.querySelector(sel); return td && td.textContent.trim() === 'T-10295'; }, cellOf(plantRow), { timeout: 15000 });
      const td = await p.$(cellOf(plantRow));
      assert.equal(await td.evaluate(x => x.classList.contains('missing')), false, 'not the orange missing box');
      assert.match(await td.getAttribute('title'), /T-10295 from the Plant Scheduler/);
      assert.equal((await p.textContent(cellOf(ownRow))).trim(), 'T-901', 'a load with its own trailer keeps it');
      if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'daily-plant-trailer-' + w + '.png') });
      assert.deepEqual(p.errors, []);
      await p.close();
    }
    results.push('Daily Dispatch: a load with no trailer shows the Plant Scheduler\'s trailer (1536 and 1920); one with its own trailer keeps it');
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('DAILY PLANT TRAILER ' + r));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });

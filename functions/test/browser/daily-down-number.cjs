'use strict';
/*
 * Browser check (Joe 10/23: "This allowed 532 to be displayed, and it shouldn't have ... Same with 537. Both of them are on the down
 * list."): a load holding a down trailer as its number only (no trailer ID, as Publish seeded it from Route Master's default) shows
 * it red with DOWN on Daily Dispatch, like a down trailer held by its ID, at 1536 and 1920 wide. A usable trailer stays plain.
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
  const [downRow, okRow] = day;
  // The first load holds T-902 by its number only, and T-902 is on the down list; the second holds T-901 (usable) the same way.
  await db().collection('equipment').doc('veh_trailer_t_902').update({ status: 'DOWN', notes: 'DOWN: Down' });
  await db().collection('runs').doc(downRow.runDocId).update({ ['days.' + downRow.day + '.trailer']: 'T-902', ['days.' + downRow.day + '.trailerId']: '' });
  await db().collection('runs').doc(okRow.runDocId).update({ ['days.' + okRow.day + '.trailer']: 'T-901', ['days.' + okRow.day + '.trailerId']: '' });
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const [w, h] of [[1536, 790], [1920, 1080]]) {
      const p = await openPage(browser, w, h, '/daily.html?date=' + DATE + '&testEmail=dispatch.test@uniteddairy.com');
      const cellOf = (r) => '#rows tr[data-id="' + r.id + '"] td[data-edit="trailer"]';
      await p.waitForFunction((sel) => { const td = document.querySelector(sel); return td && /T-902/.test(td.textContent); }, cellOf(downRow), { timeout: 15000 });
      const td = await p.$(cellOf(downRow));
      assert.match((await td.textContent()).trim(), /^T-902 DOWN$/);
      assert.equal(await td.evaluate(x => x.classList.contains('unit-down')), true, 'shown red as down');
      assert.match(await td.getAttribute('title'), /T-902 is down\. Pick another trailer/);
      assert.equal(await td.evaluate(x => getComputedStyle(x, '::before').content), 'none', 'no NEEDS DRIVER words on a trailer');
      const ok = await p.$(cellOf(okRow));
      assert.equal((await ok.textContent()).trim(), 'T-901', 'a usable trailer held by its number stays plain');
      assert.equal(await ok.evaluate(x => x.classList.contains('unit-down')), false);
      if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'daily-down-number-' + w + '.png') });
      assert.deepEqual(p.errors, []);
      await p.close();
    }
    results.push('Daily Dispatch: a down trailer held by its number only shows red with DOWN (1536 and 1920); a usable one stays plain');
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('DAILY DOWN NUMBER ' + r));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });

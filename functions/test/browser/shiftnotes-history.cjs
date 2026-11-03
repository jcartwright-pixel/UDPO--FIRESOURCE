'use strict';
/*
 * Browser check of Joe's 11-3-26 Shift Notes asks: the tiles at the top (Entries 24 h, Needs attention, Monitor, Resolved) are
 * buttons that show their entries; no box starts with example words or a time in it; a side button is red while anything of its
 * kind is still open and green only when all of it is resolved; and each kind has its history under the entry boxes (breakdowns:
 * what broke, down at, reported, back up at, down time, what fixed it). Pictures go to SHOTS_DIR.
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
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
// The plant's wall-clock time h hours ago, as a breakdown's down time is saved (16:30).
const clockAgo = (h) => new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(Date.now() - h * 3600000));

async function note(id, at, values, status, extra) {
  await db().collection('plantJournal').doc('SHIFT_REPORT_app_' + id).set({ recordId: id, type: 'SHIFT_REPORT', date: L.operatingDay(new Date(at)), area: 'HANDOFF', recordedAt: at, recordedBy: 'pat.sample@uniteddairy.com', createdInApp: true,
    payload: Object.assign({ entryId: id, section: 'HANDOFF', shift: 'SECOND SHIFT', values, notes: '', followUpStatus: status }, extra || {}) });
}

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date('2026-10-08T14:00:00Z') });
  // Made-up entries: one breakdown still down, one fixed today, one fixed three days ago; handoff notes open, watched and done.
  await note('SN-h1', ago(2), { Entry: 'Bowl valve leaking, line stopped', Type: 'Breakdown', Equipment: 'Filler 4' }, 'OPEN', { readingTime: clockAgo(2.5) });
  await note('SN-h2', ago(5), { Entry: 'Jammed on the third layer', Type: 'Breakdown', Equipment: 'Palletizer', UpAt: clockAgo(4.25), Fix: 'Cleared the jam and reset the eye' }, 'RESOLVED', { readingTime: clockAgo(5.25) });
  await note('SN-h3', ago(74), { Entry: 'Glue gun stopped heating', Type: 'Breakdown', Equipment: 'Case packer', UpAt: clockAgo(73), Fix: 'Swapped the heater' }, 'RESOLVED', { readingTime: clockAgo(74.5), shift: 'FIRST SHIFT' });
  await note('SN-h4', ago(3), { Entry: 'Cooler 2 door sticking', Type: 'Handoff', Equipment: 'Cooler 2 door' }, 'MONITOR', { notes: 'Keep an eye on it' });
  await note('SN-h5', ago(1), { Entry: 'Short two people on the line', Type: 'Handoff', Equipment: '' }, 'OPEN', { notes: 'Call in a fill-in for first shift' });
  await note('SN-h6', ago(20), { Entry: 'Dock 6 light out', Type: 'Handoff', Equipment: 'Dock 6' }, 'RESOLVED');
  await db().collection('plantReports').doc('hist-report').set({ at: ago(4), by: 'pat.sample@uniteddairy.com' });
  const results = [];
  const browser = await chromium.launch();
  try {
    for (const [w, h] of [[1920, 1140], [1536, 790]]) {
      const page = await browser.newPage({ viewport: { width: w, height: h } });
      await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) }));
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(HOSTING + '/shiftnotes.html' + MANAGER);
      await page.waitForSelector('#kind-history .sn-past-table tbody tr', { timeout: 15000 });
      const shot = async (name, full) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '-' + w + '.png'), fullPage: !!full }); };

      if (w === 1920) {
        // No example words, and the time boxes start empty.
        assert.deepEqual(await page.$$eval('#fields [placeholder]', a => a.map(x => x.className)), [], 'no box has example words');
        assert.equal(await page.inputValue('#fields .sn-time'), '', 'Down at starts empty');
        assert.deepEqual(await page.$$eval('#open-box [placeholder]', a => a.length), 0, 'no example words in the open entries either');
        results.push('No box starts with example words; Down at starts empty');

        // Breakdowns side button: red while Filler 4 is down.
        const side = () => page.$eval('#lines [data-kind="Breakdown"]', b => ({ red: b.classList.contains('k-red'), green: b.classList.contains('k-green'), words: b.querySelector('small').textContent }));
        assert.deepEqual(await side(), { red: true, green: false, words: '1 still open' });
        results.push('Breakdowns button is red with "1 still open" while Filler 4 is down');

        // Its history: the three breakdowns of the last 7 days, newest first, with plain 12-hour times.
        const rows = () => page.$$eval('#kind-history tbody tr', r => r.map(x => [...x.cells].map(c => c.textContent.trim())));
        let r = await rows();
        assert.equal(r.length, 3);
        assert.deepEqual(await page.$$eval('#kind-history thead th', a => a.map(x => x.textContent)), ['Status', 'What broke', 'Down at', 'Reported', 'Back up at', 'Down time', 'What fixed it', 'Shift', 'By']);
        assert.match(r[0][0], /Still down/i); assert.match(r[0][1], /^Filler 4/); assert.match(r[0][4], /Still down/); assert.match(r[0][5], /so far/);
        assert.match(r[1][1], /^Palletizer/); assert.match(r[1][5], /^1 hr$/); assert.equal(r[1][6], 'Cleared the jam and reset the eye');
        assert.match(r[1][2], /^\d{1,2}-\d{1,2}-\d\d \d{1,2}:\d\d (AM|PM)$/, 'down at like 11-2-26 4:30 PM');
        assert.match(r[2][1], /^Case packer/); assert.equal(r[2][7], 'First shift'); assert.equal(r[2][8], 'pat.sample');
        assert.match(await page.textContent('#kind-history .sn-sec'), /Breakdowns history\s*3/);
        await shot('1-breakdowns');
        await page.$eval('#kind-history', x => x.scrollIntoView({ block: 'end' }));
        await shot('1b-breakdowns-history');
        await page.$eval('.sn-form', x => x.scrollTo(0, 0));
        results.push('Breakdowns history lists Filler 4 (still down), Palletizer (1 hr down, its fix) and Case packer, newest first');

        // The open breakdown shows 12-hour times, not 24-hour.
        assert.match(await page.textContent('#open-box .sn-down'), /Down at \d{1,2}:\d\d (AM|PM)/);

        // Handoff tab: its history too.
        await page.click('#lines [data-kind="Handoff"]');
        await page.waitForFunction(() => /Handoff history/.test(document.querySelector('#kind-history .sn-sec').textContent));
        r = await rows();
        assert.equal(r.length, 3);
        assert.deepEqual(r.map(x => x[0].toUpperCase()), ['NEEDS ATTENTION', 'MONITOR', 'RESOLVED']);
        assert.equal(r[0][5], 'Call in a fill-in for first shift');
        const hand = await page.$eval('#lines [data-kind="Handoff"]', b => [b.classList.contains('k-red'), b.querySelector('small').textContent]);
        assert.deepEqual(hand, [true, '1 open']);
        await shot('2-handoff');
        await page.$eval('#kind-history', x => x.scrollIntoView({ block: 'end' }));
        await shot('2b-handoff-history');
        await page.$eval('.sn-form', x => x.scrollTo(0, 0));
        results.push('Handoff shows its own history (Needs attention, Monitor, Resolved) and its button is red with 1 open');

        // The tiles: Needs attention shows just those entries; pressing it again goes back.
        await page.click('#hstats [data-filter="OPEN"]');
        await page.waitForSelector('#pane-history:not([hidden])');
        assert.equal(await page.$$eval('#history .sn-card', a => a.length), 2);
        assert.match(await page.textContent('#history-title'), /Needs attention \(2\)/);
        assert.ok(await page.$eval('#hstats [data-filter="OPEN"]', b => b.classList.contains('on')));
        await shot('3-needs-attention');
        await page.click('#hstats [data-filter="RESOLVED"]');
        await page.waitForFunction(() => /Resolved \(2\)/.test(document.getElementById('history-title').textContent));
        await page.click('#hstats [data-filter="MONITOR"]');
        await page.waitForFunction(() => /Monitor \(1\)/.test(document.getElementById('history-title').textContent));
        await page.click('#show-all');
        await page.waitForFunction(() => /Last 24 Hours/.test(document.getElementById('history-title').textContent) && document.querySelectorAll('#history .sn-card').length === 5);
        await page.click('#hstats [data-filter="all"]');
        await page.click('#hstats [data-filter="all"]');
        await page.waitForSelector('#pane-current:not([hidden])');
        results.push('Tiles: Needs attention shows its 2, Resolved its 2, Monitor its 1; Show everything and a second press go back');

        // Filler 4 back up: the Breakdowns button turns green, "all back up".
        await page.click('#lines [data-kind="Breakdown"]');
        await page.fill('#open-box [data-fix="SN-h1"]', 'New valve gasket');
        await page.press('#open-box [data-fix="SN-h1"]', 'Tab');
        await page.waitForFunction(() => document.querySelector('#lines [data-kind="Breakdown"]').classList.contains('k-green'), null, { timeout: 10000 });
        assert.equal(await page.textContent('#lines [data-kind="Breakdown"] small'), 'all back up');
        await page.waitForFunction(() => /New valve gasket/.test(document.querySelector('#kind-history tbody tr').textContent), null, { timeout: 10000 });
        await shot('4-all-back-up');
        await page.$eval('#kind-history', x => x.scrollIntoView({ block: 'end' }));
        await shot('4b-all-back-up-history');
        results.push('Filler 4 marked back up with its fix: the Breakdowns button turns green, "all back up", and its row shows the fix');

        // 30 days.
        await page.click('#past-days');
        await page.waitForFunction(() => /last 30 days/.test(document.querySelector('#kind-history .sn-sec').textContent));
      } else {
        await shot('1-breakdowns');
        const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert.ok(over <= 0, 'no sideways scroll at 1536');
        const tops = await page.$$eval('.head > .title, .head > .tabs, .head > .hstats, .head > .sn-since', a => a.map(x => Math.round(x.getBoundingClientRect().bottom)));
        assert.ok(Math.max(...tops) < 150, 'header on one line at 1536: ' + tops);
        results.push('1536: header on one line, no sideways scroll');
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('SHIFTHIST ' + r));
})().catch(e => { console.error(e); process.exit(1); });

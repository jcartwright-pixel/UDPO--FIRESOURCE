'use strict';
/*
 * Browser check of Joe's 10/15 Shift Notes case: a handoff note written before the last Send Current Report stays on Current
 * until someone marks it Resolved; the 24-Hour History tab carries a "need review" badge for anything in it not resolved; the
 * badge and the note go once it is resolved. Pictures go to SHOTS_DIR.
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

async function note(id, at, values, status) {
  await db().collection('plantJournal').doc('SHIFT_REPORT_app_' + id).set({ recordId: id, type: 'SHIFT_REPORT', date: L.operatingDay(new Date(at)), area: 'HANDOFF', recordedAt: at, recordedBy: 'supervisor.test@uniteddairy.com', createdInApp: true,
    payload: { entryId: id, section: 'HANDOFF', shift: 'SECOND SHIFT', values, notes: '', followUpStatus: status } });
}

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date('2026-10-08T14:00:00Z') });
  // Written at 4 PM, a report sent after it, and a handoff from two days ago still open (past the old 24-hour reach).
  await note('SHIFT-keep1', ago(7), { Entry: 'Cooler 2 door sticking', Type: 'Handoff', Equipment: 'Cooler 2 door' }, 'OPEN');
  await note('SHIFT-keep2', ago(50), { Entry: 'Dock 6 light out', Type: 'Handoff', Equipment: 'Dock 6' }, 'OPEN');
  await note('SHIFT-keep3', ago(5), { Entry: 'Palletizer jam cleared', Type: 'Breakdown', Equipment: 'Palletizer' }, 'RESOLVED');
  await db().collection('plantReports').doc('keep-report').set({ at: ago(2), by: 'zmiller@uniteddairy.com' });
  const results = [];
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1536, height: 730 } });
    await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) }));
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const notesCard = () => page.$eval('[data-card="notes"]', c => ({ alert: c.classList.contains('mc-alert'), pill: (c.querySelector('.mc-pill') || {}).textContent || '', lines: [...c.querySelectorAll('.mc-wait')].map(a => a.textContent),
      tiles: [...c.querySelectorAll('.mc-tile')].map(t => t.querySelector('span').textContent + '=' + t.querySelector('b').textContent + (t.classList.contains('bad') ? ' red' : '') + ' ' + t.querySelector('i').textContent) }));

    // Manager Center: the Shift Notes card turns red, says how many need review and lists them, oldest open handoff included.
    await page.goto(HOSTING + '/manager.html' + MANAGER);
    await page.waitForSelector('[data-card="notes"].mc-alert', { timeout: 15000 });
    let mc = await notesCard();
    assert.equal(mc.pill.trim(), '2 need review');
    assert.equal(mc.lines.length, 2);
    assert.match(mc.lines.join(' | '), /Needs attention.*Handoff · Cooler 2 door \| Needs attention.*Handoff · Dock 6/);
    assert.deepEqual(mc.tiles, ['Breakdowns=0 still open', 'Handoffs=2 red open', 'Carryover=2 from earlier shifts']);
    // Read once the card has stopped redrawing (a number caught mid-redraw has no style yet).
    await page.waitForFunction(() => { const b = document.querySelector('[data-card="notes"] .mc-tile b'); return b && b.isConnected && getComputedStyle(b).fontSize; }, null, { timeout: 5000 });
    assert.ok(await page.$eval('[data-card="notes"] .mc-tile b', b => parseFloat(getComputedStyle(b).fontSize) >= 30), 'bigger numbers on the Shift Notes card');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'shift-keep-manager-1536.png') });
    results.push('Manager Center: the Shift Notes card is red with "2 need review", lists both handoff notes, Handoffs 2 open in red, 2 carried over from earlier shifts');
    // A line opens that note on Shift Notes, outlined.
    await page.click('[data-card="notes"] .mc-wait');
    await page.waitForSelector('#open-box .sn-card.sn-asked[data-entry="SHIFT-keep1"]', { timeout: 15000 });
    assert.deepEqual(await page.$$eval('#lines .active', b => b.map(x => x.dataset.kind)), ['Handoff']);
    results.push('A line on the card opens that note on Shift Notes (Handoff picked, the note outlined)');
    await page.goto(HOSTING + '/shiftnotes.html' + MANAGER);
    await page.click('#lines [data-kind="Handoff"]');
    await page.waitForFunction(() => document.querySelectorAll('#open-box .sn-card').length === 2, null, { timeout: 10000 });
    assert.match(await page.textContent('#open-box .sn-sec'), /Still open\s*2/);
    assert.match(await page.textContent('#open-box'), /Cooler 2 door[\s\S]*CARRIED OVER[\s\S]*Dock 6/);
    assert.match(await page.textContent('#lines [data-kind="Handoff"]'), /2 open/);
    assert.match(await page.textContent('#hstats'), /2Needs attention/);
    assert.equal((await page.textContent('#need-badge')).trim(), '1 needs review', 'only the last 24 hours count on the tab');
    // The header stays on one line at Joe's 1536 width with the badge on.
    const tops = await page.$$eval('.head > .title, .head > .tabs, .head > .hstats, .head > .sn-since', a => a.map(x => Math.round(x.getBoundingClientRect().bottom)));
    assert.ok(Math.max(...tops) < 150, 'header on one line at 1536: ' + tops);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'shift-keep-current-1536.png') });
    results.push('A handoff written before the last report stays under Still open (CARRIED OVER), and one from two days ago too');

    await page.click('[data-pane="history"]');
    await page.waitForSelector('#history .sn-card .tag.need');
    assert.equal(await page.$$eval('#history .sn-card .tag.need', a => a.length), 1);
    results.push('24-Hour History tab says "1 needs review"; that note is tagged STILL NEEDS REVIEW');

    await page.click('[data-pane="current"]');
    await page.selectOption('#open-box [data-status="SHIFT-keep1"]', 'RESOLVED');
    await page.waitForFunction(() => document.querySelectorAll('#open-box .sn-card').length === 1 && !document.getElementById('need-badge'), null, { timeout: 10000 });
    results.push('Marked Resolved: it leaves Still open and the tab badge goes');
    await page.selectOption('#open-box [data-status="SHIFT-keep2"]', 'RESOLVED');
    await page.waitForFunction(() => !document.querySelector('#open-box .sn-card'), null, { timeout: 10000 });
    await page.goto(HOSTING + '/manager.html' + MANAGER);
    await page.waitForFunction(() => /Handoffs0open/.test((document.querySelector('[data-card="notes"]') || { textContent: '' }).textContent), null, { timeout: 15000 });
    mc = await notesCard();
    assert.deepEqual([mc.alert, mc.pill, mc.lines.length], [false, '', 0]);
    assert.deepEqual(mc.tiles, ['Breakdowns=0 still open', 'Handoffs=0 open', 'Carryover=0 from earlier shifts']);
    results.push('All resolved: the Manager Center card is calm again');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('SHIFTKEEP ' + r));
})().catch(e => { console.error(e); process.exit(1); });

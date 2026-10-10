'use strict';
/*
 * Browser check of Shift Notes (Incident & Breakdown Log) on the made-up plant: the desktop form as the current app, a saved
 * entry on another open screen's 24-hour log at once, a review note under it that changes its status, and the phone form.
 * One entry from earlier in the day is seeded with the real clock, since the log keeps the last 24 hours. Pictures go to SHOTS_DIR.
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
const cards = (page) => page.$$eval('#history .sn-card', c => c.length);

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date('2026-10-08T14:00:00Z') });
  const at = new Date(Date.now() - 3 * 3600000).toISOString();
  await db().collection('plantJournal').doc('SHIFT_REPORT_app_SHIFTseed1').set({ recordId: 'SHIFT-seed1', type: 'SHIFT_REPORT', date: L.operatingDay(new Date()), area: 'HANDOFF', recordedAt: at, recordedBy: 'supervisor.test@uniteddairy.com', createdInApp: true,
    payload: { entryId: 'SHIFT-seed1', section: 'HANDOFF', shift: 'FIRST SHIFT', values: { Entry: 'Dock 3 door will not close all the way', Type: 'Breakdown', Equipment: 'Dock 3 door' }, notes: 'Door company called; check the seal at shift change', followUpStatus: 'OPEN' } });
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const [w, h] of [[1920, 950], [1366, 650]]) {
      const page = await openPage(browser, w, h, '/shiftnotes.html' + MANAGER);
      await page.waitForSelector('#fields .sn-entry');
      assert.deepEqual(await page.$$eval('#fields label', l => l.map(x => x.childNodes[0].textContent.trim())), ['Type', 'Equipment / area', 'Shift', 'Reading Time', 'Entry / Measurements', 'Notes / Follow-up', 'Follow-up']);
      assert.equal(await page.textContent('#record'), 'Save Timestamped Entry');
      await fits(page, 'Shift Notes ' + w + 'x' + h);
      await shots(page, 'shiftnotes-current', w);
      await page.click('[data-pane="history"]');
      await page.waitForFunction(() => document.querySelectorAll('#history .sn-card').length === 1);
      assert.match(await page.textContent('#history .sn-card'), /Breakdown · Dock 3 door · FIRST SHIFT[\s\S]*Needs attention[\s\S]*Next steps:/);
      await fits(page, 'Shift Notes log ' + w + 'x' + h);
      await shots(page, 'shiftnotes-history', w);
      assert.deepEqual(page.errors, []);
      await page.close();
    }
    const watcher = await openPage(browser, 1920, 950, '/shiftnotes.html?view=history&' + MANAGER.slice(1));
    const desk = await openPage(browser, 1920, 950, '/shiftnotes.html' + MANAGER);
    await watcher.waitForFunction(() => document.querySelectorAll('#history .sn-card').length === 1);
    await desk.waitForSelector('#fields .sn-entry');
    await desk.click('#record');
    await desk.waitForFunction(() => /Enter report information before saving/.test(document.getElementById('error').textContent));
    await desk.selectOption('.sn-type', 'Safety');
    await desk.fill('.sn-equip', 'Cooler 2 floor');
    await desk.fill('.sn-entry', 'Water on the floor by the north door');
    await desk.fill('.sn-notes', 'Maintenance to check the drain');
    const t0 = Date.now();
    await desk.click('#record');
    await desk.waitForFunction(() => document.querySelector('.sn-entry').value === '' && !document.getElementById('saved').hidden);
    const shown = Date.now() - t0;
    await watcher.waitForFunction(() => document.querySelectorAll('#history .sn-card').length === 2 && /Safety · Cooler 2 floor[\s\S]*Water on the floor/.test(document.querySelector('#history .sn-card').textContent), null, { timeout: 8000 });
    results.push('Save Timestamped Entry: form cleared in ' + shown + ' ms, top of the other screen\'s log in ' + (Date.now() - t0) + ' ms');
    // A review note on the seeded entry marks it resolved on both screens.
    await watcher.waitForSelector('[data-review-text="SHIFT-seed1"]');
    await watcher.fill('[data-review-text="SHIFT-seed1"]', 'Seal replaced, door closes');
    await watcher.selectOption('[data-review-status="SHIFT-seed1"]', 'RESOLVED');
    const t1 = Date.now();
    await watcher.click('[data-review-save="SHIFT-seed1"]');
    await watcher.waitForFunction(() => [...document.querySelectorAll('#history .sn-card')].some(c => /Dock 3 door[\s\S]*Resolved[\s\S]*Review ·[\s\S]*Seal replaced/.test(c.textContent)));
    const reviewShown = Date.now() - t1;
    await desk.click('[data-pane="history"]');
    await desk.waitForFunction(() => [...document.querySelectorAll('#history .sn-card')].some(c => /Seal replaced/.test(c.textContent) && !/saving/.test(c.textContent)), null, { timeout: 8000 });
    results.push('Review note (Resolved): on screen in ' + reviewShown + ' ms, on the other screen in ' + (Date.now() - t1) + ' ms');
    assert.equal(await cards(desk), 2);
    if (SHOTS) await watcher.screenshot({ path: path.join(SHOTS, 'shiftnotes-reviewed-1920.png'), scale: 'css' });
    const phone = await openPage(browser, 412, 860, '/shiftnotes.html' + MANAGER);
    await phone.waitForSelector('#fields .sn-entry');
    assert.deepEqual(await phone.$$eval('#fields label', l => l.map(x => x.childNodes[0].textContent.trim())), ['Type', 'Shift', 'Equipment / area', 'What happened?', 'Next steps Optional', 'Status']);
    assert.equal(await phone.textContent('#record'), 'Save Entry');
    if (SHOTS) await phone.screenshot({ path: path.join(SHOTS, 'shiftnotes-phone-412.png'), scale: 'css' });
    await phone.click('[data-pane="history"]');
    await phone.waitForFunction(() => document.querySelectorAll('#history .sn-card').length === 2);
    if (SHOTS) await phone.screenshot({ path: path.join(SHOTS, 'shiftnotes-phone-log-412.png'), scale: 'css' });
    for (const p of [desk, watcher, phone]) assert.deepEqual(p.errors, []);
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('SHIFT ' + r));
})().catch(e => { console.error(e); process.exit(1); });

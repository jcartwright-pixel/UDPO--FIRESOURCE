'use strict';
/*
 * Browser check (Joe 10/16): on Daily Dispatch a save is quiet. No "Saving... / Saved" sign pops up beside the title, and
 * the sheet does not jump: a busy day that scrolls inside the table keeps its scroll place after a save. A save that fails
 * still shows "Not saved" in red. Pictures go to SHOTS_DIR.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { clear, db } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const F = require('../fixtures/fake-sheets');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR;

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
  // A busy day: 30 more loads like 802, so the table scrolls inside itself as it does on a real day.
  const runs = await db().collection('runs').get();
  const base = runs.docs.find(d => d.id === '2026-10-04__run_t802');
  for (let i = 0; i < 30; i++) {
    const n = String(810 + i), data = JSON.parse(JSON.stringify(base.data()).split('t802').join('t' + n).split('802').join(n));
    await db().collection('runs').doc(base.id.split('t802').join('t' + n)).set(data);
  }
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const [w, h] of [[1536, 420], [1920, 520]]) {
      const p = await openPage(browser, w, h, '/daily.html?date=2026-10-05&testEmail=dispatch.test@uniteddairy.com');
      await p.waitForSelector('#rows tr[data-id] td[data-edit="time"]');
      await p.waitForTimeout(800);
      const info = () => p.evaluate(() => {
        const s = document.querySelector('.sheet'), pill = document.getElementById('save-pill');
        return { scroll: s.scrollTop, fit: s.classList.contains('fit-scroll'), pill: pill && !pill.hidden ? pill.textContent : '', head: document.querySelector('.head').getBoundingClientRect().height };
      });
      // Scroll the table down and save a depart time on a row near the bottom.
      await p.evaluate(() => { const s = document.querySelector('.sheet'); s.scrollTop = s.scrollHeight; });
      await p.waitForTimeout(200);
      const scrolled = await info();
      const cells = await p.$$('#rows tr[data-id]:not(.off) td[data-edit="time"]');
      const td = cells[cells.length - 1];
      const rowId = await td.evaluate(x => x.closest('tr').dataset.id);
      await td.dblclick();
      await p.waitForTimeout(150);
      await p.keyboard.press('Control+A');
      await p.keyboard.type('4:15');
      await p.keyboard.press('Enter');
      const seen = [];
      for (let i = 0; i < 25; i++) { seen.push(await info()); await p.waitForTimeout(100); }
      if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'daily-save-quiet-' + w + '.png') });
      {
        assert.equal(seen.some(s => s.pill), false, 'no Saving / Saved sign at ' + w);
        assert.equal(seen.every(s => Math.abs(s.scroll - scrolled.scroll) <= 2), true, 'the table keeps its scroll place at ' + w);
        assert.equal(await p.evaluate(id => document.querySelector('tr[data-id="' + id + '"] td[data-edit="time"]').textContent, rowId).then(t => /4:15/.test(t)), true, 'the time saved');
        results.push(w + ': a depart-time save showed no sign and the table stayed where it was scrolled');
        // A refused save still says so in red.
        await p.evaluate(async () => { const m = await import('./js/edit.js'); try { await m.saveOptimistic('noSuchAction', {}, () => {}, () => {}, () => {}); } catch (e) { /* shown on screen */ } });
        await p.waitForFunction(() => { const x = document.getElementById('save-pill'); return x && !x.hidden && /Not saved/.test(x.textContent); });
        results.push(w + ': a refused save still showed "Not saved"');
      }
      assert.deepEqual(p.errors, []);
      await p.close();
    }
  } finally { await browser.close(); }
  console.log(results.join('\n'));
})().catch(e => { console.error(e); process.exit(1); });

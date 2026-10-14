'use strict';
/*
 * Browser check of Joe's 10/14 ask ("The manager should be able to view all the work orders. And delete them"): Fleet
 * Service's Work Orders shows everything the Garage Station lists (work orders, and write-ups with no work order yet), a
 * manager deletes one after a confirm, and a dispatcher has no Delete. At 1536 and 1920. With SHOTS_DIR=<folder> it saves
 * pictures; BEFORE=1 only takes the pictures (for the screen as it was).
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const { applyAction } = require('../../src/actions');
const G = require('../fixtures/garage-demo');
const localCalls = require('./local-calls.cjs');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR;
const BEFORE = !!process.env.BEFORE;

async function openPage(browser, width, height, url) {
  const page = await browser.newPage({ viewport: { width, height }, serviceWorkers: 'block' });
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
  });
  await localCalls(page);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(HOSTING + url);
  page.errors = errors;
  return page;
}
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, name) }); };
const noSideScroll = (p) => p.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth + 1);

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F().fakeReader(G.sheets()), sources: G.SOURCES, now: () => new Date() });
  await db().collection('users').doc('dispatch.test@uniteddairy.com').set({ name: 'Test Dispatcher', status: 'ACTIVE', roles: ['DISPATCHER'], facilities: ['fac_uniontown'], cells: { id: 'usr_disp', version: '1' } }, { merge: true });
  // 223876 sent to the garage from Truck Issues: a work order. T-901 and 900001: write-ups the Garage Station lists with no work order.
  const sent = await applyAction(db(), { email: 'manager.test@uniteddairy.com' }, { action: 'updateIssue', requestId: 'fwd-' + Date.now(), recordId: 'TRK-2', step: 'garage' });
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const [w, h] of [[1536, 864], [1920, 1080]]) {
      const p = await openPage(browser, w, h, '/fleet.html?view=work&testEmail=manager.test@uniteddairy.com');
      await p.waitForFunction(() => /223876/.test(document.getElementById('sheet').textContent), null, { timeout: 15000 });
      if (BEFORE) { await p.waitForTimeout(1500); await shot(p, 'before-work-orders-' + w + '.png'); await p.close(); continue; }
      await p.waitForFunction(() => /T-901/.test(document.getElementById('sheet').textContent), null, { timeout: 15000 });
      const rows = await p.$$eval('.fleet-split > div:first-child tbody tr', trs => trs.map(t => t.dataset.unit));
      assert.deepEqual(rows.slice().sort(), ['223876', '900001', 'T-901'], 'the work order and the two write-ups the station lists');
      assert.match(await p.textContent('#kpis'), /3\s*Open work orders/);
      assert.equal((await p.$$eval('#sheet td small', s => s.filter(x => x.textContent === 'Write-up').length)), 2, 'the write-ups say so');
      // Every cell's words fit without breaking inside a word.
      assert.deepEqual(await p.$$eval('.fleet-split > div:first-child td', tds => tds.filter(td => td.scrollWidth > td.clientWidth + 1).map(td => td.textContent)), [], 'no cell overflows');
      assert.equal((await p.$$('[data-del-wo]')).length + (await p.$$('[data-del-wu]')).length, 3, 'a Delete on each row');
      assert.ok(await noSideScroll(p), 'no sideways scroll at ' + w);
      const small = await p.$$eval('#sheet td, #sheet th, #sheet button', els => els.filter(e => e.textContent.trim() && parseFloat(getComputedStyle(e).fontSize) < 16).map(e => e.textContent.trim()));
      assert.deepEqual(small, [], 'text at least 16px');
      await shot(p, 'after-work-orders-' + w + '.png');
      if (w === 1920) {
        // Cancel leaves it; OK deletes it.
        p.once('dialog', d => d.dismiss());
        await p.click('[data-del-wo="' + sent.workOrderId + '"]');
        await p.waitForTimeout(500);
        assert.equal((await db().collection('workOrders').doc(sent.workOrderId).get()).exists, true, 'Cancel keeps it');
        let asked = '';
        p.once('dialog', d => { asked = d.message(); d.accept(); });
        await p.click('[data-del-wo="' + sent.workOrderId + '"]');
        await p.waitForFunction(() => !/223876/.test(document.getElementById('sheet').textContent), null, { timeout: 15000 });
        assert.match(asked, /Delete work order WO-[0-9A-F]{8} \(223876 · Mirror cracked\)\?/);
        assert.equal((await db().collection('workOrders').doc(sent.workOrderId).get()).exists, false);
        assert.match(await p.textContent('#kpis'), /2\s*Open work orders/);
        await shot(p, 'after-deleted-1920.png');
      }
      assert.deepEqual(p.errors, []);
      await p.close();
    }
    if (!BEFORE) {
      results.push('Fleet Service Work Orders: the work order and the write-ups the Garage Station lists, a Delete on each, 16px, no sideways scroll at 1536 and 1920');
      results.push('Delete asks first: Cancel keeps the work order, OK deletes it and the counts follow');
      const d = await openPage(browser, 1536, 864, '/fleet.html?view=work&testEmail=dispatch.test@uniteddairy.com');
      await d.waitForFunction(() => /T-901/.test(document.getElementById('sheet').textContent), null, { timeout: 15000 });
      assert.equal((await d.$$('[data-del-wo],[data-del-wu]')).length, 0, 'a dispatcher has no Delete');
      results.push('A dispatcher sees the same list with no Delete');
      await d.close();
    }
  } finally {
    await browser.close();
  }
  console.log(results.map(r => 'ok - ' + r).join('\n'));
})().catch(e => { console.error(e); process.exit(1); });

function F() { return require('../fixtures/fake-sheets'); }

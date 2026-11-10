'use strict';
/*
 * Browser check of Joe 11/2 ("I also want the ability to delete a driver. I want to keep inactive, but also delete too. An
 * inactive driver should never show up on my drop-down list, no matter what"): on the Driver Roster, Delete asks twice and
 * takes the driver off the roster (the record is kept, marked DELETED); Make Inactive stays. On Daily Dispatch the driver
 * list leaves out inactive and deleted drivers, even with OVR ticked. Made-up drivers only. Pictures go to SHOTS_DIR.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { clear, db } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const F = require('../fixtures/fake-sheets');

const HOSTING = process.argv[2] || 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR;

async function openPage(browser, width, height, url) {
  const page = await browser.newPage({ viewport: { width, height }, serviceWorkers: 'block' });
  await page.addInitScript(() => { try { sessionStorage.setItem('udPlant', 'fac_uniontown'); } catch (e) { /* none */ } });
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
  });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(HOSTING + url);
  page.errors = errors;
  return page;
}
async function shot(p, name) {
  if (!SHOTS) return;
  await p.waitForFunction(() => !document.body.classList.contains('ud-drawing'));
  await p.screenshot({ path: path.join(SHOTS, name) });
}
const BROOK = 'tr[data-id="drv_test_brook"]', DUNN = 'tr[data-id="drv_test_dunn"]';
const R802 = 'tr[data-id="2026-10-04__run_t802|tue"]';

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: () => new Date('2026-10-09T12:00:00Z') });
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const [w, h] of [[1536, 790], [1920, 1080]]) {
      await clear();
      await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: () => new Date('2026-10-09T12:00:00Z') });
      const p = await openPage(browser, w, h, '/drivers.html?testEmail=manager.test@uniteddairy.com');
      await p.waitForSelector(BROOK);
      // Make Inactive stays: DUNN (Inactive in Driver Master) is on the roster, marked Inactive.
      assert.match(await p.textContent(DUNN), /Inactive/);
      await p.click(BROOK + ' [data-edit]');
      await p.waitForSelector('#d-delete');
      assert.equal((await p.textContent('#d-remove')).trim(), 'Make Inactive');
      await shot(p, 'roster-edit-' + w + '.png');
      // First press: it asks, in words, and nothing is deleted yet.
      await p.click('#d-delete');
      assert.equal((await p.textContent('#d-delete')).trim(), 'Yes, delete BROOK, SAM');
      assert.match(await p.textContent('#d-delete-ask'), /Delete BROOK, SAM for good\? Old loads and history keep the name/);
      assert.ok(await p.isVisible('#d-delete-ask'));
      assert.equal((await db().collection('drivers').doc('drv_test_brook').get()).data().status, 'ACTIVE', 'nothing deleted after one press');
      await shot(p, 'roster-delete-ask-' + w + '.png');
      // Second press deletes: off the roster at once, kept as DELETED in the database.
      await p.click('#d-delete');
      await p.waitForSelector(BROOK, { state: 'detached', timeout: 8000 });
      for (let i = 0; i < 40 && (await db().collection('drivers').doc('drv_test_brook').get()).data().status !== 'DELETED'; i++) await p.waitForTimeout(250);
      const d = (await db().collection('drivers').doc('drv_test_brook').get()).data();
      assert.equal(d.status, 'DELETED');
      assert.equal(d.name, 'BROOK, SAM', 'the name is kept for old loads');
      await p.waitForTimeout(500);
      assert.equal(!!(await p.$(BROOK)), false, 'still off the roster after the save came back');
      assert.ok(await p.$(DUNN), 'the Inactive driver stays on the roster');
      await shot(p, 'roster-after-delete-' + w + '.png');
      assert.deepEqual(p.errors, []);
      await p.close();
      results.push(w + ': Delete asked first ("Yes, delete BROOK, SAM" and a red line), the second press took BROOK off the roster; the record is kept as DELETED with the name; DUNN stays, Inactive; Make Inactive is still there');

      // Daily Dispatch: the whole driver list, OVR ticked, has neither the Inactive driver nor the deleted one.
      const q = await openPage(browser, w, h, '/daily.html?date=2026-10-05&testEmail=dispatch.test@uniteddairy.com');
      await q.waitForSelector(R802 + ' td[data-edit="driver"]');
      await q.check(R802 + ' [data-ovr]');
      await q.dblclick(R802 + ' td[data-edit="driver"]');
      await q.waitForSelector('.cell-pop [data-i]');
      const names = await q.$$eval('.cell-pop [data-i]', n => n.map(x => x.textContent));
      assert.ok(names.some(t => /^CASEY, LEE/.test(t)), names.join(' | '));
      assert.ok(!names.some(t => /DUNN, ROBIN/.test(t)), 'no Inactive driver with OVR: ' + names.join(' | '));
      assert.ok(!names.some(t => /BROOK, SAM/.test(t)), 'no deleted driver with OVR: ' + names.join(' | '));
      await shot(q, 'daily-driver-list-ovr-' + w + '.png');
      assert.deepEqual(q.errors, []);
      await q.close();
      results.push(w + ': Daily Dispatch driver list with OVR ticked has no DUNN (Inactive) and no BROOK (deleted)');
    }
    console.log('PASS driver-delete\n- ' + results.join('\n- '));
  } catch (e) {
    console.error('FAIL driver-delete: ' + (e && e.stack || e));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();

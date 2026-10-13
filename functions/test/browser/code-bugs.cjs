'use strict';
/*
 * Browser check of the server and data fixes of review items 69, 72 and 73 (Joe 10/13) on the made-up plant:
 *   69: a call that timed out is tried again with the same requestId, so the server saves it once;
 *   72: a pickup's route is shown as text on Plant Home's "Pickups open" (made safe with escapeHtml);
 *   73: Home reads only the write-ups still open (its Maintenance number unchanged), and the dispatch screens read only the
 *       days off that end in the recent weeks.
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
const ADMIN = 'testEmail=admin.test@uniteddairy.com';
const NOW = new Date('2026-10-08T14:00:00Z'); // 10 AM on the made-up plant's day (PD.PLANT_DATE)

async function openPage(browser, url, onRequest) {
  const page = await browser.newPage({ viewport: { width: 1536, height: 864 }, serviceWorkers: 'block' });
  await page.clock.setFixedTime(NOW);
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
  });
  const errors = [], listens = [];
  page.on('pageerror', e => errors.push(e.message));
  // What the screen asks the database to listen to (the Firestore Listen channel's request bodies).
  page.on('request', r => { if (/Listen\/channel/.test(r.url()) && r.postData()) { try { listens.push(decodeURIComponent(r.postData().replace(/\+/g, ' '))); } catch (e) { listens.push(r.postData()); } } });
  if (onRequest) await onRequest(page);
  await page.goto(HOSTING + url);
  page.errors = errors; page.listens = listens;
  return page;
}

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => NOW });
  const d = db(), results = [];
  const browser = await chromium.launch();
  try {
    // ---- 72: a pickup route with HTML in it shows as text on Plant Home and runs nothing.
    const pu = (await d.collection('pickups').where('pickupId', '==', 'pu_demo_1').get()).docs[0];
    assert.ok(pu, 'the made-up open pickup');
    await pu.ref.update({ route: '<img src=x onerror="window.__bad=1">805' });
    const home = await openPage(browser, '/plant.html?' + ADMIN);
    await home.waitForFunction(() => /Pickups open/.test(document.body.textContent) && /805/.test(document.body.textContent), null, { timeout: 15000 });
    const chip = await home.evaluate(() => { const c = [...document.querySelectorAll('.chip')].find(x => /Pickups open/.test(x.textContent)); return c ? { text: c.textContent, imgs: c.querySelectorAll('img').length } : null; });
    assert.ok(chip, 'the Pickups open chip is shown');
    assert.match(chip.text, /<img src=x onerror="window\.__bad=1">805/, 'the route is shown as typed');
    assert.equal(chip.imgs, 0, 'no element is made from it');
    assert.equal(await home.evaluate(() => window.__bad), undefined, 'nothing ran');
    assert.deepEqual(home.errors, []);
    await home.close();
    results.push('72: a pickup route with HTML shows as text on Plant Home\'s Pickups open, nothing runs');

    // ---- 73: Home reads only the write-ups not finished; its Maintenance number is the same as from the whole list.
    await d.collection('maintenance').doc('cb_done_1').set({ record_id: 'cb_done_1', kind: 'TRUCK', status: 'COMPLETE', truck_number: '900001', issue_details: 'Old brake job', opened_at: '2025-01-02T10:00:00Z' });
    await d.collection('maintenance').doc('cb_open_1').set({ record_id: 'cb_open_1', kind: 'TRUCK', status: 'OPEN', truck_number: '900002', issue_details: 'Mirror cracked', opened_at: '2024-06-02T10:00:00Z' });
    const all = (await d.collection('maintenance').get()).docs.map(x => Object.assign({}, x.data(), { id: x.id }));
    const want = ['TRUCK', 'TRAILER', 'FORK_TRUCK'].reduce((n, k) => n + L.issueRows(all, k, NOW.getTime()).length, 0);
    const company = await openPage(browser, '/company.html?' + ADMIN);
    await company.waitForFunction(() => [...document.querySelectorAll('.co-cell')].some(c => /Maintenance/.test(c.textContent)), null, { timeout: 15000 });
    await company.waitForFunction(n => [...document.querySelectorAll('.co-cell')].some(c => /Maintenance/.test(c.textContent) && c.querySelector('b').textContent === String(n)), want, { timeout: 15000 });
    assert.ok(company.listens.some(b => /"collectionId":"maintenance"/.test(b) && /NOT_IN/.test(b) && /"fieldPath":"status"/.test(b)), 'Home listens to the open write-ups only');
    assert.ok(!company.listens.some(b => /"collectionId":"maintenance"/.test(b) && !/"where"/.test(b)), 'Home never listens to the whole maintenance list');
    assert.deepEqual(company.errors, []);
    await company.close();
    results.push('73: Home reads only open write-ups; Maintenance shows ' + want + ' as from the whole list (a 2024 open one still counts)');

    // ---- 73: the dispatch screens read the days off that end in the recent weeks only.
    for (const url of ['/distribution.html?' + ADMIN, '/daily.html?date=' + PD.PLANT_DATE + '&' + ADMIN]) {
      const page = await openPage(browser, url);
      await page.waitForFunction(() => document.readyState === 'complete');
      await page.waitForTimeout(2500);
      const ex = page.listens.filter(b => /"collectionId":"exceptions"/.test(b));
      assert.ok(ex.length, url + ' listens to the days off');
      assert.ok(ex.every(b => /"fieldPath":"endDate"/.test(b) && /GREATER_THAN_OR_EQUAL/.test(b)), url + ': only days off ending recently or later');
      assert.deepEqual(page.errors, []);
      await page.close();
    }
    results.push('73: Dispatch home and Daily listen to days off with endDate >= the window start, not the whole list');

    // ---- 69: a save that timed out is tried again with the same requestId; a new save gets a new one.
    const seen = [];
    let answer = 'timeout';
    const page = await openPage(browser, '/plant.html?' + ADMIN, async (p) => {
      await p.route(/:5001\/[^/]+\/[^/]+\/save$/, async (route) => {
        const data = (route.request().postDataJSON() || {}).data || {};
        if (data.checkSaves) { await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ result: { allowed: {} } }) }); return; }
        seen.push(data.requestId);
        if (answer === 'timeout') await route.fulfill({ status: 504, contentType: 'application/json', body: JSON.stringify({ error: { status: 'DEADLINE_EXCEEDED', message: 'deadline-exceeded' } }) });
        else if (answer === 'refused') await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { status: 'FAILED_PRECONDITION', message: 'Type the item' } }) });
        else await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ result: { ok: true, requestId: data.requestId } }) });
      });
    });
    await page.waitForFunction(() => /Pickups open/.test(document.body.textContent), null, { timeout: 15000 });
    const send = (fields) => page.evaluate(async (f) => { const { saveNow } = await import('./js/app.js'); try { return await saveNow('addPickup', f); } catch (e) { return { failed: String(e.code || e.message) }; } }, fields);
    const pickup = { runDocId: 'x', day: 'thu', item: 'Gallon whole', quantity: '2' };
    assert.match((await send(pickup)).failed, /deadline-exceeded/);
    answer = 'ok';
    assert.equal((await send(pickup)).ok, true);
    assert.equal(seen[1], seen[0], 'the retry after the time-out sends the same requestId');
    await send(pickup);
    assert.notEqual(seen[2], seen[1], 'once answered, the same pickup again is a new save');
    answer = 'timeout';
    await send(pickup);
    await send(Object.assign({}, pickup, { quantity: '3' }));
    assert.notEqual(seen[4], seen[3], 'a different save never borrows the timed-out one\'s requestId');
    answer = 'refused';
    await send(pickup);
    assert.equal(seen[5], seen[3], 'the retry of the timed-out pickup');
    answer = 'ok';
    await send(pickup);
    assert.notEqual(seen[6], seen[5], 'a clear refusal ends the hold: the next try is a new save');
    await page.close();
    results.push('69: a retry after a time-out reuses the requestId; an answer (saved or refused) ends it; other saves get their own');
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('ok - ' + r));
})().catch(e => { console.error(e); process.exit(1); });

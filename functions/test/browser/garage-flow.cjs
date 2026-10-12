'use strict';
/*
 * Browser check of the Garage Station flow Joe asked for (10/10 evening), on a 1280 x 800 tablet: the open work orders
 * first with no sign-in (fork trucks too), a work order asks the mechanic's name and login ID to Start, a second
 * mechanic joins with their own clock, Stop leaves the job open, and Complete closes it. With SHOTS=<folder> it saves
 * a picture of each step.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const { garageCall } = require('../../src/garage');
const F = require('../fixtures/fake-sheets');
const G = require('../fixtures/garage-demo');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS || process.env.SHOTS_DIR || '';
const FORK = ['record_id', 'facility_id', 'status', 'opened_at', 'driver', 'issue_details', 'notes', 'source_type', 'unit_number', 'equipment_type'];

async function openPage(browser, width, height, url) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.clock.install();
  if (process.env.LOCAL_CALLS) {
    await page.route(/:5001\/[^/]+\/[^/]+\/garage$/, async (route) => {
      const data = (route.request().postDataJSON() || {}).data;
      try { route.fulfill({ contentType: 'application/json', body: JSON.stringify({ result: await garageCall(db(), data) }) }); }
      catch (e) { route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { status: 'FAILED_PRECONDITION', message: e.message } }) }); }
    });
  }
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
  });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(HOSTING + url);
  page.errors = errors;
  return page;
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name) }); };
const fits = (page) => page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1);
async function login(page, techId, digits) {
  await page.waitForSelector('#view-sign:not([hidden])');
  await page.click('[data-who="' + techId + '"]');
  for (const k of digits) await page.click('[data-key="' + k + '"]');
}

(async () => {
  await clear();
  const extra = { "'FORK TRUCK LIVE'": F.table(FORK, [{ record_id: 'FRK-1', status: 'OPEN', opened_at: new Date(Date.now() - 5 * 3600000).toISOString(), issue_details: 'Pallet jack wheel broken, will not roll', notes: 'source: new app check-in', unit_number: 'PJ-7', equipment_type: 'FORK_TRUCK' }]) };
  await runTransfer({ db: db(), reader: F.fakeReader(G.sheets(extra)), sources: G.SOURCES, now: () => new Date() });
  // Tom has been on the pallet jack for 40 minutes (the picture shows a running clock).
  const ago = (min) => () => new Date(Date.now() - min * 60000);
  const pj = (await garageCall(db(), { op: 'board' })).jobs.find(j => j.unit === 'PJ-7');
  const tom = await garageCall(db(), { op: 'signIn', techId: 'TECH-JT', loginId: '48213', tokens: [] }, ago(40));
  await garageCall(db(), { op: 'step', tokens: [tom.token], step: 'START', writeUp: pj.writeUp, requestId: 'flow-tom-pj-' + Date.now() }, ago(40));

  const browser = await chromium.launch();
  const results = [];
  try {
    const gs = await openPage(browser, 1280, 800, '/garage-station.html?testEmail=manager.test@uniteddairy.com');
    // 1. The list first, no sign-in.
    await gs.waitForFunction(() => /Air leak/.test(document.getElementById('jobs').textContent) && /PJ-7/.test(document.getElementById('jobs').textContent), null, { timeout: 10000 });
    assert.equal(await gs.isVisible('#view-sign'), false, 'no sign-in before the list');
    assert.equal(await gs.$('.sidemenu'), null, 'no desktop side menu');
    assert.ok(await fits(gs), 'the list fits the tablet');
    assert.match(await gs.textContent('#strip'), /JELLICK Tom\s*PJ-7/);
    await shot(gs, '1-work-orders-tablet-1280.png');
    results.push('Work orders first, no sign-in: write-ups and the pallet jack, Tom on the clock on PJ-7');

    // 2. Tap 900001, Start work: name + login ID.
    await gs.click('.gs-job:has-text("900001") button');
    await gs.waitForSelector('#view-job:not([hidden])');
    await gs.click('#job-start');
    await login(gs, 'TECH-JT', '48213');
    await shot(gs, '2-sign-in-tablet-1280.png');
    await gs.click('[data-key="go"]');
    await gs.waitForFunction(() => /Stopped Tom's clock on PJ-7/.test(document.getElementById('gs-message').textContent), null, { timeout: 10000 });
    results.push('Start asks name + login ID; starting 900001 stops Tom\'s clock on PJ-7 (still open)');

    // 3. Add another mechanic: John joins with his own clock.
    await gs.waitForSelector('#view-job:not([hidden])');
    assert.match(await gs.textContent('#job-start'), /Add another mechanic/);
    await gs.click('#job-start');
    await login(gs, 'TECH-JM', '551902');
    await gs.click('[data-key="go"]');
    await gs.waitForFunction(() => document.querySelectorAll('#crew .gs-clock').length === 2, null, { timeout: 10000 });
    assert.deepEqual(await gs.$$eval('#crew .gs-clock b', b => b.map(x => x.textContent)), ['JELLICK Tom', 'MYERS John']);
    assert.ok(await fits(gs));
    assert.ok(await gs.evaluate(() => { const r = document.getElementById('job-done').getBoundingClientRect(), p = document.getElementById('job-parts').getBoundingClientRect(); return p.bottom <= r.top; }), 'Complete does not cover Need Parts');
    // Twenty-five minutes later on the tablet: the clocks tick.
    await gs.clock.fastForward('25:00');
    await gs.waitForFunction(() => /0:2\d/.test(document.getElementById('crew').textContent), null, { timeout: 10000 });
    await shot(gs, '3-two-mechanics-tablet-1280.png');
    results.push('Add another mechanic: Tom and John each have a clock on 900001');

    // 4. Complete: who completed it, what was fixed, safe + signature.
    await gs.click('#job-done');
    await login(gs, 'TECH-JM', '551902');
    await gs.click('[data-key="go"]');
    await gs.waitForSelector('#view-fix:not([hidden])');
    await gs.click('[data-fix="Brakes"]');
    await gs.waitForSelector('#view-safe:not([hidden])');
    await gs.click('[data-safe="yes"]');
    const box = await gs.$('#sig'), b = await box.boundingBox();
    await gs.mouse.move(b.x + 40, b.y + b.height / 2); await gs.mouse.down();
    for (let i = 1; i <= 12; i++) await gs.mouse.move(b.x + 40 + i * 30, b.y + b.height / 2 + (i % 2 ? -25 : 25));
    await gs.mouse.up();
    await shot(gs, '4-complete-tablet-1280.png');
    await gs.click('#finish');
    await gs.waitForFunction(() => /completed by MYERS John/.test(document.getElementById('gs-message').textContent), null, { timeout: 10000 });
    await gs.waitForFunction(() => !/900001/.test(document.getElementById('jobs').textContent), null, { timeout: 10000 });
    await shot(gs, '5-after-complete-tablet-1280.png');
    const wo = (await db().collection('workOrders').where('unit', '==', '900001').get()).docs[0].data();
    assert.deepEqual([wo.status, wo.completed_by, wo.on_now, wo.labor.length], ['DONE', 'MYERS John', '', 2]);
    assert.equal((await db().collection('maintenance').doc('TRK-1').get()).data().status, 'COMPLETE');
    results.push('Complete: John signs, 900001 leaves the list, labour kept for Tom and John, the write-up is repaired');

    // 5. The pallet jack stayed open; its job shows Tom's earlier time.
    await gs.click('.gs-job:has-text("PJ-7") button');
    await gs.waitForSelector('#view-job:not([hidden])');
    assert.match(await gs.textContent('#crew-done'), /Tom 4\d m/);
    await shot(gs, '6-stopped-job-open-tablet-1280.png');
    assert.deepEqual(gs.errors, []);
    results.push('PJ-7 stays open with nobody on it and Tom\'s 40 minutes kept');
  } finally {
    await browser.close();
  }
  console.log(results.map(r => 'ok - ' + r).join('\n'));
})().catch(e => { console.error(e); process.exit(1); });

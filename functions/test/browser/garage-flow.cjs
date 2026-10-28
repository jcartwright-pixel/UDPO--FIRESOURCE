'use strict';
/*
 * Browser check of the Garage Station Joe asked for, on a 1280 x 800 tablet. Joe 10/10 evening: the open work orders with no
 * sign-in, a work order asks the mechanic's name and login ID, a second mechanic joins with their own clock, Complete closes
 * it. Joe 10/28 (mock-up 1, "set it up like for the garage"): three big cards (Trucks, Trailers, Fork trucks) with their open
 * work orders, no mechanics row and no Report a Problem; a work order has a big Back and Start Work, Pause, Waiting on Parts
 * (the parts in his own words) and Complete; notes and the parts put on are typed (or spoken) on it and go with the mechanic's
 * name; Complete asks what was done and the parts put on; a service that is due has its checklist. With SHOTS=<folder> it
 * saves a picture of each step.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const { garageCall } = require('../../src/garage');
const CHECK = require('../../src/garage-checklists');
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
const msg = (page, re) => page.waitForFunction((src) => new RegExp(src).test(document.getElementById('gs-message').textContent), re.source, { timeout: 10000 })
  .catch(async (e) => { throw new Error('Waited for "' + re.source + '"; the message says "' + (await page.textContent('#gs-message')) + '"' + (SHOTS ? '' : '') + ' (' + e.message.split('\n')[0] + ')'); });
async function login(page, techId, digits) {
  await page.waitForSelector('#view-sign:not([hidden])');
  await page.click('[data-who="' + techId + '"]');
  for (const k of digits) await page.click('[data-key="' + k + '"]');
  await page.click('[data-key="go"]');
}
const order = async (unit) => (await db().collection('workOrders').where('unit', '==', unit).get()).docs.map(d => d.data()).find(o => o.status !== 'DONE');

(async () => {
  await clear();
  const extra = { "'FORK TRUCK LIVE'": F.table(FORK, [{ record_id: 'FRK-1', status: 'OPEN', opened_at: new Date(Date.now() - 5 * 3600000).toISOString(), issue_details: 'Pallet jack wheel broken, will not roll', notes: 'source: new app check-in', unit_number: 'PJ-7', equipment_type: 'FORK_TRUCK' }]) };
  await runTransfer({ db: db(), reader: F.fakeReader(G.sheets(extra)), sources: G.SOURCES, now: () => new Date() });
  // A second write-up on 900001 two days earlier: one line, one work order (Joe 10/28, 326 showed twice).
  const trk1 = (await db().collection('maintenance').doc('TRK-1').get()).data();
  await db().collection('maintenance').doc('TRK-9').set(Object.assign({}, trk1, { record_id: 'TRK-9', opened_at: new Date(Date.now() - 2 * 86400000).toISOString(), issue_details: 'Brake light out on the right side' }));
  // A PM that Fleet Service shows due, already on the station (garage.js serviceOrders makes it).
  await db().collection('workOrders').doc('WO-PM1').set({ work_order_id: 'WO-PM1', facility_id: 'fac_uniontown', unit: '900002', unit_type: 'TRUCK', problem: 'PM service due 11-2-26', source: 'SERVICE',
    source_from: 'Fleet Service (due)', service_key: 'PM', status: 'NEW', can_run: 'YES', created_at: new Date(Date.now() - 3600000).toISOString(), version: 1 });
  // Tom has been on the pallet jack for 40 minutes (the picture shows a running clock).
  const ago = (min) => () => new Date(Date.now() - min * 60000);
  const pj = (await garageCall(db(), { op: 'board' })).jobs.find(j => j.unit === 'PJ-7');
  const tom = await garageCall(db(), { op: 'signIn', techId: 'TECH-JT', loginId: '48213', tokens: [] }, ago(40));
  await garageCall(db(), { op: 'step', tokens: [tom.token], step: 'START', writeUp: pj.writeUp, requestId: 'flow-tom-pj-' + Date.now() }, ago(40));

  const browser = await chromium.launch();
  const results = [];
  try {
    const gs = await openPage(browser, 1280, 800, '/garage-station.html?testEmail=manager.test@uniteddairy.com');
    // 1. Three big cards first, no sign-in, no mechanics row, no Report a Problem.
    await gs.waitForFunction(() => document.querySelectorAll('#cards [data-type]').length === 3 && /Tom on PJ-7/.test(document.getElementById('cards').textContent), null, { timeout: 15000 });
    assert.deepEqual(await gs.$$eval('#cards [data-type]', b => b.map(x => x.querySelector('span').textContent + ' ' + x.querySelector('b').textContent)), ['Trucks 2', 'Trailers 1', 'Fork trucks 1']);
    assert.match(await gs.textContent('[data-type="TRAILER"]'), /1 can't run/);
    assert.equal(await gs.isVisible('#view-sign'), false, 'no sign-in before the cards');
    for (const gone of ['#strip', '#to-report', '#people', '#go-back', '#go-home', '.sidemenu']) assert.equal(await gs.$(gone), null, gone + ' is gone');
    assert.ok(await fits(gs), 'the cards fit the tablet');
    await shot(gs, '1-cards-tablet-1280.png');
    results.push('Three big cards first, no sign-in: Trucks 2, Trailers 1 (can\'t run), Fork trucks 1 with Tom on PJ-7; no mechanics row, no Report a Problem');

    // 2. Trucks: 900001 once with both write-ups, and the PM that is due.
    await gs.click('[data-type="TRUCK"]');
    await gs.waitForSelector('#view-jobs:not([hidden])');
    assert.match(await gs.textContent('#jobs-title'), /^Trucks · 2 open$/);
    assert.equal(await gs.$$eval('.gs-job', r => r.filter(x => /900001/.test(x.textContent)).length), 1, '900001 is one line');
    assert.match(await gs.textContent('.gs-job:has-text("900001")'), /Also written: Brake light out on the right side/);
    await shot(gs, '2-trucks-list-tablet-1280.png');
    await gs.click('#to-home');
    await gs.waitForSelector('#view-home:not([hidden])');
    await gs.click('[data-type="TRUCK"]');
    results.push('Trucks: 900001 shows once with its two write-ups; the PM that is due is on the list; "All work orders" goes back to the cards');

    // 3. Open 900001: big Back, four buttons; Start Work with name + login ID (Tom's clock moves from PJ-7), John joins.
    await gs.click('.gs-job:has-text("900001") button');
    await gs.waitForSelector('#view-job:not([hidden])');
    assert.deepEqual(await gs.$$eval('#view-job .gs-four .gs-btn', b => b.filter(x => !x.hidden).map(x => x.textContent)), ['Start Work', 'Pause', 'Waiting on Parts', 'Complete']);
    assert.equal(await gs.isVisible('#view-job .gs-back'), true);
    await gs.click('#job-start');
    await login(gs, 'TECH-JT', '48213');
    await msg(gs, /Stopped Tom's clock on PJ-7/);
    await gs.waitForSelector('#view-job:not([hidden])');
    await gs.click('#job-start');
    await login(gs, 'TECH-JM', '551902');
    await gs.waitForFunction(() => document.querySelectorAll('#crew .gs-clock').length === 2, null, { timeout: 10000 });
    assert.deepEqual(await gs.$$eval('#crew .gs-clock b', b => b.map(x => x.textContent)), ['JELLICK Tom', 'MYERS John']);
    const wo = await order('900001');
    assert.deepEqual(wo.also_ids, ['TRK-9'], 'one work order for both write-ups');
    results.push('A work order: big Back, Start Work / Pause / Waiting on Parts / Complete; Tom starts (his clock leaves PJ-7), John joins with his own clock');

    // 4. Notes typed while working go with Pause under the mechanic's name.
    await gs.fill('#job-did', 'Found the air leak at the left chamber');
    await gs.fill('#job-used', '2 hose clamps');
    // Nine minutes later on the tablet: the clocks tick (after ten minutes left alone it goes back to the cards).
    await gs.clock.fastForward('09:00');
    await gs.waitForFunction(() => /0:0[89]/.test(document.getElementById('crew').textContent), null, { timeout: 10000 });
    assert.ok(await fits(gs));
    await gs.evaluate(() => { document.querySelector('#view-job .gs-scroll').scrollTop = 0; });
    await shot(gs, '3-work-order-two-mechanics-tablet-1280.png');
    await gs.click('#job-pause');
    await login(gs, 'TECH-JT', '48213');
    await msg(gs, /JELLICK Tom stopped\. 900001 stays open/);
    let saved = await order('900001');
    assert.deepEqual(saved.notes_log.map(e => [e.by, e.did, e.used]), [['JELLICK Tom', 'Found the air leak at the left chamber', '2 hose clamps']]);
    results.push('Notes and the parts put on, typed on the work order, go on it with Tom\'s name when he presses Pause');

    // 5. Waiting on Parts: the parts in his own words; the list says so; Parts are here starts it again.
    await gs.click('.gs-job:has-text("900001") button');
    await gs.waitForSelector('#view-job:not([hidden])');
    assert.match(await gs.textContent('#job-log'), /Tom: Found the air leak/);
    await gs.click('#job-parts');
    await gs.waitForSelector('#view-parts:not([hidden])');
    await gs.fill('#parts-need', 'Brake chamber, left side');
    await shot(gs, '4-waiting-on-parts-tablet-1280.png');
    await gs.click('#parts-send');
    await login(gs, 'TECH-JM', '551902');
    await msg(gs, /900001 is waiting on parts/);
    await gs.waitForFunction(() => /WAITING ON PARTS/.test(document.getElementById('jobs').textContent), null, { timeout: 10000 });
    saved = await order('900001');
    assert.deepEqual([saved.status, saved.parts_needed], ['PARTS', 'Brake chamber, left side']);
    await gs.click('.gs-job:has-text("900001") button');
    assert.match(await gs.textContent('#job-now'), /Waiting on parts: Brake chamber, left side/);
    assert.match(await gs.textContent('#job-start'), /Parts are here/);
    assert.equal(await gs.isVisible('#job-parts'), false);
    await gs.click('#job-start');
    await login(gs, 'TECH-JM', '551902');
    await msg(gs, /MYERS John started on 900001 again/);
    results.push('Waiting on Parts keeps the parts list ("Brake chamber, left side"); Parts are here starts it again');

    // 6. Complete: what you did and the parts put on (from the notes), what was fixed, safe + signature.
    await gs.fill('#job-did', 'Put in the new chamber');
    await gs.click('#job-done');
    await login(gs, 'TECH-JM', '551902');
    await gs.waitForSelector('#view-fix:not([hidden])');
    assert.equal(await gs.inputValue('#fix-note'), 'Put in the new chamber', 'Complete starts from the notes');
    await gs.fill('#fix-used', 'Brake chamber');
    await gs.click('#fix-next');
    await msg(gs, /Tap what you fixed/);
    await gs.click('[data-fix="Brakes"]');
    await shot(gs, '5-complete-notes-tablet-1280.png');
    await gs.click('#fix-next');
    await gs.waitForSelector('#view-safe:not([hidden])');
    await gs.click('[data-safe="yes"]');
    const box = await gs.$('#sig'), b = await box.boundingBox();
    await gs.mouse.move(b.x + 40, b.y + b.height / 2); await gs.mouse.down();
    for (let i = 1; i <= 12; i++) await gs.mouse.move(b.x + 40 + i * 30, b.y + b.height / 2 + (i % 2 ? -25 : 25));
    await gs.mouse.up();
    await gs.click('#finish');
    await msg(gs, /completed by MYERS John/);
    await gs.waitForFunction(() => !/900001/.test(document.getElementById('jobs').textContent), null, { timeout: 10000 });
    const done = (await db().collection('workOrders').where('unit', '==', '900001').get()).docs[0].data();
    assert.deepEqual([done.status, done.completed_by, done.fixed_note, done.parts_used], ['DONE', 'MYERS John', 'Put in the new chamber', 'Brake chamber']);
    for (const id of ['TRK-1', 'TRK-9']) assert.equal((await db().collection('maintenance').doc(id).get()).data().status, 'COMPLETE', id + ' repaired');
    results.push('Complete asks what was done and the parts put on (filled in from the notes), then safe + signature; both write-ups are repaired');

    // 7. The PM that is due: its checklist (OK / Needs work / N/A) has to be answered before Complete.
    await gs.click('.gs-job:has-text("900002") button');
    await gs.waitForSelector('#job-checks:not([hidden])');
    const lines = CHECK.items('PM_TRUCK').length;
    assert.equal(await gs.$$eval('#job-checks .gs-ck', r => r.length), lines);
    await gs.click('#job-done');
    await msg(gs, new RegExp('Answer every line of the checklist first \\(' + lines + ' left\\)'));
    // Each tap redraws the list, so each line's button is looked up fresh.
    const tapAll = (ids) => gs.evaluate((list) => list.forEach(id => { const b = document.querySelector('#job-checks [data-ck="' + id + '"][data-r="OK"]'); if (!b.classList.contains('on')) b.click(); }), ids);
    await tapAll(CHECK.items('PM_TRUCK').slice(0, 12).map(i => i.id));
    await gs.click('#job-checks [data-ck="tires"][data-r="FIX"]');
    await gs.evaluate(() => { const box = document.querySelector('#view-job .gs-scroll'); box.scrollTop = document.getElementById('job-checks').offsetTop - box.offsetTop; });
    await shot(gs, '6-service-checklist-tablet-1280.png');
    await tapAll(CHECK.items('PM_TRUCK').filter(i => i.id !== 'tires').map(i => i.id));
    assert.match(await gs.textContent('#job-checks .gs-label'), new RegExp(lines + ' of ' + lines + ' done'));
    await gs.click('#job-done');
    await login(gs, 'TECH-JN', '70001');
    await gs.waitForSelector('#view-fix:not([hidden])');
    assert.equal(await gs.isVisible('#fix-pick'), false, 'a service needs no "What did you fix?"');
    await gs.click('#fix-next');
    await gs.click('[data-safe="yes"]');
    const box2 = await gs.$('#sig'), b2 = await box2.boundingBox();
    await gs.mouse.move(b2.x + 40, b2.y + 40); await gs.mouse.down(); await gs.mouse.move(b2.x + 200, b2.y + 80); await gs.mouse.up();
    await gs.click('#finish');
    await msg(gs, /900002 completed by NARD Jaxon/);
    const pm = (await db().collection('workOrders').doc('WO-PM1').get()).data();
    assert.equal(pm.status, 'DONE');
    assert.equal(pm.checklist.length, lines);
    assert.match(pm.fixed_note, /^Needs work: Tire condition and air pressure/);
    results.push('A PM that is due: its ' + lines + '-line checklist must be answered; Complete keeps it, with the Needs work lines on the work order');

    // 8. Back to the cards; the pallet jack stayed open with Tom's earlier time; Android's Back goes list -> cards.
    await gs.click('#to-home');
    await gs.click('[data-type="FORK_TRUCK"]');
    await gs.click('.gs-job:has-text("PJ-7") button');
    await gs.waitForSelector('#view-job:not([hidden])');
    assert.match(await gs.textContent('#crew-done'), /Tom 4\d m/);
    await gs.click('#view-job .gs-back');
    await gs.waitForSelector('#view-jobs:not([hidden])');
    assert.equal(await gs.evaluate(() => window.udBack()), true);
    await gs.waitForSelector('#view-home:not([hidden])');
    assert.deepEqual(gs.errors, []);
    results.push('PJ-7 stays open with Tom\'s 40 minutes; Back goes work order -> list -> cards');

    // 9. The other screen sizes: a 1920 screen and a phone fit with no sideways scroll.
    for (const [w, h, name] of [[1920, 1080, '1920'], [1536, 864, '1536'], [390, 844, 'phone-390']]) {
      const p = await openPage(browser, w, h, '/garage-station.html?testEmail=manager.test@uniteddairy.com');
      await p.waitForFunction(() => document.querySelectorAll('#cards [data-type]').length === 3, null, { timeout: 15000 });
      assert.ok(await fits(p), 'the cards fit ' + name);
      await p.clock.fastForward(1000);
      await shot(p, '7-cards-' + name + '.png');
      await p.click('[data-type="FORK_TRUCK"]');
      await p.click('.gs-job:has-text("PJ-7") button');
      await p.waitForSelector('#view-job:not([hidden])');
      assert.ok(await fits(p), 'a work order fits ' + name);
      await p.clock.fastForward(1000);
      await shot(p, '8-work-order-' + name + '.png');
      assert.deepEqual(p.errors, []);
      await p.close();
    }
    results.push('The cards and a work order fit 1920, 1536 and a 390 phone');
  } finally {
    await browser.close();
  }
  console.log(results.map(r => 'ok - ' + r).join('\n'));
})().catch(e => { console.error(e); process.exit(1); });

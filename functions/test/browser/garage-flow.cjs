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
// Joe 10/28 evening: a mechanic's first sign-in on the Garage Station asks for their signature once (kept on file).
async function signOnce(page) {
  await page.waitForSelector('#view-mysig:not([hidden])');
  await page.waitForTimeout(200);
  const b = await page.locator('#mysig-pad').boundingBox();
  await page.mouse.move(b.x + 30, b.y + b.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + 120, b.y + 30, { steps: 5 }); await page.mouse.move(b.x + 220, b.y + b.height - 30, { steps: 5 }); await page.mouse.up();
  await page.click('#mysig-save');
}
async function login(page, techId, digits) {
  await page.waitForSelector('#view-sign:not([hidden])');
  await page.click('[data-who="' + techId + '"]');
  for (const k of digits) await page.click('[data-key="' + k + '"]');
  await page.click('[data-key="go"]');
  await page.waitForFunction(() => document.getElementById('view-sign').hidden, null, { timeout: 10000 });
  if (await page.isVisible('#view-mysig')) { if (!signShot) { signShot = true; await shot(page, '3b-sign-once-tablet-1280.png'); } await signOnce(page); }
}
let signShot = false;
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
    // Joe 10/28: each card shows the app's own picture of a truck, a trailer or a fork truck.
    await gs.waitForFunction(() => [...document.querySelectorAll('#cards img')].every(i => i.complete && i.naturalWidth > 0), null, { timeout: 10000 });
    assert.deepEqual(await gs.$$eval('#cards [data-type] img', i => i.map(x => x.getAttribute('src').replace('img/library/', ''))), ['maintenance-tractor-v1-560.webp', 'maintenance-trailer-v1-560.webp', 'forklift-truck-v1-560.webp']);
    assert.equal(await gs.isVisible('#view-sign'), false, 'no sign-in before the cards');
    for (const gone of ['#strip', '#to-report', '#people', '#go-back', '#go-home', '.sidemenu']) assert.equal(await gs.$(gone), null, gone + ' is gone');
    assert.ok(await fits(gs), 'the cards fit the tablet');
    await shot(gs, '1-cards-tablet-1280.png');
    results.push('Three big cards first, each with its picture, no sign-in: Trucks 2, Trailers 1 (can\'t run), Fork trucks 1 with Tom on PJ-7; no mechanics row, no Report a Problem');

    // 2. Trucks: 900001 once with both write-ups, and the PM that is due.
    await gs.click('[data-type="TRUCK"]');
    await gs.waitForSelector('#view-jobs:not([hidden])');
    assert.match(await gs.textContent('#jobs-title'), /^Trucks · 2 open$/);
    assert.deepEqual(await gs.$$eval('.gs-job .unit', r => r.map(x => x.textContent)), ['900001', '900002'], 'the driver write-up above the service');
    assert.equal(await gs.$$eval('.gs-job', r => r.filter(x => /900001/.test(x.textContent)).length), 1, '900001 is one line');
    assert.match(await gs.textContent('.gs-job:has-text("900001")'), /Also written: Brake light out on the right side/);
    // Joe 10/28: the day it was first written up and how many times.
    assert.match(await gs.textContent('.gs-job:has-text("900001") .gs-written'), /^Written up 2 times · first \d{1,2}-\d{1,2}-\d\d$/);
    await shot(gs, '2-trucks-list-tablet-1280.png');
    await gs.click('#to-home');
    await gs.waitForSelector('#view-home:not([hidden])');
    await gs.click('[data-type="TRUCK"]');
    results.push('Trucks: 900001 shows once with its two write-ups ("Written up 2 times", first day); the PM that is due is on the list; "All work orders" goes back to the cards');

    // 3. Open 900001: big Back, four buttons; Start Work with name + login ID (Tom's clock moves from PJ-7), John joins.
    await gs.click('.gs-job:has-text("900001") button');
    await gs.waitForSelector('#view-job:not([hidden])');
    assert.deepEqual(await gs.$$eval('#view-job .gs-four .gs-btn', b => b.filter(x => !x.hidden).map(x => x.textContent)), ['Start Work', 'Pause', 'Waiting on Parts', 'Complete']);
    assert.equal(await gs.isVisible('#view-job .gs-back'), true);
    assert.match(await gs.textContent('#job-written'), /^Written up 2 times · first \d{1,2}-\d{1,2}-\d\d$/);
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
    assert.match(await gs.textContent('#job-written'), /^Written up 2 times · first /, 'the started work order keeps the count and first day');
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
    // Joe 10/28 evening: John's signature on file signs it; nothing to draw.
    assert.match(await gs.textContent('#sign-line'), /Signed by MYERS John \(signature on file\)/);
    assert.equal(await gs.isVisible('#sig'), false);
    assert.equal(await gs.isVisible('#sig-file'), true);
    await gs.click('#finish');
    await msg(gs, /completed by MYERS John/);
    await gs.waitForFunction(() => !/900001/.test(document.getElementById('jobs').textContent), null, { timeout: 10000 });
    const done = (await db().collection('workOrders').where('unit', '==', '900001').get()).docs[0].data();
    assert.deepEqual([done.status, done.completed_by, done.fixed_note, done.parts_used], ['DONE', 'MYERS John', 'Put in the new chamber', 'Brake chamber']);
    assert.equal(done.signature, (await db().collection('garageSignatures').doc('TECH-JM').get()).data().signature, 'the work order carries John\'s signature on file');
    for (const id of ['TRK-1', 'TRK-9']) assert.equal((await db().collection('maintenance').doc(id).get()).data().status, 'COMPLETE', id + ' repaired');
    results.push('Complete asks what was done and the parts put on (filled in from the notes), then safe; signed with the signature on file (each mechanic signed once at first sign-in); both write-ups are repaired');

    // 7. The PM that is due: its checklist (OK / Needs work / N/A), the 8 tires' tread depth, the hours, miles and day finished,
    // and the whole work order looked over, before Complete (Joe 10/28 evening).
    await gs.click('.gs-job:has-text("900002") button');
    await gs.waitForSelector('#job-checks:not([hidden])');
    const lines = CHECK.items('PM_TRUCK').length;
    assert.equal(await gs.$$eval('#job-checks .gs-ck', r => r.length), lines);
    assert.equal(await gs.evaluate(() => document.getElementById('job-done').classList.contains('locked')), true, 'Complete is locked');
    await gs.click('#job-done');
    await msg(gs, new RegExp('Mark every line of the checklist before Complete: ' + lines + ' left \\(in red\\)'));
    assert.equal(await gs.$$eval('#job-checks .gs-ck.need', r => r.length), lines, 'every line not marked is red');
    // Each tap redraws the list, so each line's button is looked up fresh.
    const tapAll = (ids) => gs.evaluate((list) => list.forEach(id => { const b = document.querySelector('#job-checks [data-ck="' + id + '"][data-r="OK"]'); if (!b.classList.contains('on')) b.click(); }), ids);
    await tapAll(CHECK.items('PM_TRUCK').slice(0, 12).map(i => i.id));
    await gs.click('#job-checks [data-ck="tires"][data-r="FIX"]');
    await tapAll(CHECK.items('PM_TRUCK').filter(i => i.id !== 'tires').map(i => i.id));
    assert.equal(await gs.$$eval('#job-checks [data-ck="tread"]', b => b.map(x => x.textContent).join(',')), 'OK,Needs work', 'tread depth has no N/A');
    assert.match(await gs.textContent('#ck-count'), new RegExp((lines - 1) + ' of ' + lines + ' done'), 'the tread line waits for its 8 tires');
    const depths = ['12', '12', '11', '11', '9', '9', '10', '8'];
    const tires = await gs.$$('#job-checks [data-tire]');
    assert.equal(tires.length, 8);
    for (let i = 0; i < 8; i++) await tires[i].fill(depths[i]);
    assert.match(await gs.textContent('#ck-count'), new RegExp(lines + ' of ' + lines + ' done'));
    await gs.evaluate(() => document.querySelector('#job-checks [data-row="tread"]').scrollIntoView({ block: 'center' }));
    await shot(gs, '6b-tread-depth-tablet-1280.png');
    await gs.evaluate(() => { const box = document.querySelector('#view-job .gs-scroll'); box.scrollTop = document.getElementById('job-reading').offsetTop - box.offsetTop - 20; });
    await shot(gs, '6-service-checklist-tablet-1280.png');
    // No GPS on 900002: the hours and miles are typed; the day finished starts as today.
    await gs.click('#job-done');
    await msg(gs, /Fill in the hours and the miles before Complete/);
    await gs.fill('[data-read="~hours"]', '8,240');
    await gs.fill('[data-read="~miles"]', '97500');
    await gs.evaluate(() => { const box = document.querySelector('#view-job .gs-scroll'); box.scrollTop = 0; box.dispatchEvent(new Event('scroll')); });
    await gs.click('#job-done');
    await msg(gs, /Scroll down and look over the whole work order before Complete/);
    await gs.evaluate(() => { const box = document.querySelector('#view-job .gs-scroll'); box.scrollTop = box.scrollHeight; box.dispatchEvent(new Event('scroll')); });
    await gs.waitForFunction(() => !document.getElementById('job-done').classList.contains('locked'), null, { timeout: 5000 });
    await gs.click('#job-done');
    await login(gs, 'TECH-JN', '70001');
    await gs.waitForSelector('#view-fix:not([hidden])');
    assert.equal(await gs.isVisible('#fix-pick'), false, 'a service needs no "What did you fix?"');
    await gs.click('#fix-next');
    await gs.click('[data-safe="yes"]');
    await gs.click('#finish');
    await msg(gs, /900002 completed by NARD Jaxon/);
    const pm = (await db().collection('workOrders').doc('WO-PM1').get()).data();
    assert.equal(pm.status, 'DONE');
    assert.equal(pm.checklist.length, lines);
    assert.deepEqual(pm.checklist.find(r => r.id === 'tread').depth, { lfo: '12', lfi: '12', rfo: '11', rfi: '11', rro: '9', rri: '9', lro: '10', lri: '8' });
    assert.deepEqual([pm.hours, pm.odometer], [8240, 97500]);
    assert.match(pm.completed_on, /^\d{4}-\d\d-\d\d$/);
    assert.match(pm.fixed_note, /^Needs work: Tire condition and air pressure/);
    results.push('A PM that is due: Complete stays locked until all ' + lines + ' lines (8 tires\' tread depth too), the hours and miles are in and the work order was scrolled to the bottom; the unmarked lines show red');

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

    // 10. Joe 10/28 evening: drivers' write-ups on top, newest first; services last and no more than 15 on a card; 688 says Yard
    // Truck; something new flashes until it is opened; 20 minutes with no taps goes back to the cards.
    const svc = (n, unit, due) => db().collection('workOrders').doc('WO-S' + n).set({ work_order_id: 'WO-S' + n, facility_id: 'fac_uniontown', unit, unit_type: 'TRUCK', problem: 'PM service due',
      source: 'SERVICE', source_from: 'Fleet Service (due)', service_key: 'PM', status: 'NEW', can_run: 'YES', due_at: due, created_at: new Date(Date.now() - 7200000).toISOString(), version: 1 });
    for (let n = 1; n <= 17; n++) await svc(n, String(910000 + n), '2026-11-' + String(n + 5).padStart(2, '0'));
    await svc(18, '688', '2026-10-01');
    const p2 = await openPage(browser, 1280, 800, '/garage-station.html?testEmail=manager.test@uniteddairy.com');
    await p2.waitForFunction(() => document.querySelectorAll('#cards [data-type]').length === 3, null, { timeout: 15000 });
    // The first list this tablet sees counts as seen: nothing flashes.
    assert.equal(await p2.$$eval('.gs-new', r => r.length), 0);
    assert.match(await p2.textContent('[data-type="TRUCK"]'), /15\s*Trucks.*3 more services come on as these are done/);
    // A driver writes up 900001 again: the Trucks card and the new line flash.
    await db().collection('maintenance').doc('TRK-20').set(Object.assign({}, trk1, { record_id: 'TRK-20', status: 'OPEN', opened_at: new Date().toISOString(), issue_details: 'Mirror cracked' }));
    // The next time the tablet reads the list (here: a tap on Trucks), the new line flashes, and back on the cards so does Trucks.
    await p2.click('[data-type="TRUCK"]');
    await p2.waitForSelector('.gs-job.gs-new:has-text("Mirror cracked")', { timeout: 15000 });
    await p2.click('#to-home');
    await p2.waitForSelector('[data-type="TRUCK"].gs-new');
    assert.match(await p2.textContent('[data-type="TRUCK"]'), /New: 1/);
    await p2.clock.fastForward(1000);
    await shot(p2, '9-new-flashes-tablet-1280.png');
    await p2.click('[data-type="TRUCK"]');
    const rows = await p2.$$eval('.gs-job', r => r.map(x => x.querySelector('.what').firstChild.textContent + (x.classList.contains('gs-new') ? ' (new)' : '')));
    assert.equal(rows.length, 15, 'no more than 15');
    assert.equal(rows[0], 'Mirror cracked (new)', 'the newest write-up on top, flashing');
    assert.equal(rows[1], 'PM service due', 'then the services, the most overdue (688) first');
    assert.match(await p2.textContent('.gs-job:has-text("688")'), /Yard Truck/);
    await shot(p2, '10-list-order-tablet-1280.png');
    await p2.click('.gs-job.gs-new button');
    await p2.waitForSelector('#view-job:not([hidden])');
    await p2.click('#view-job .gs-back');
    assert.equal(await p2.$$eval('.gs-new', r => r.length), 0, 'opened: it stops flashing');
    await p2.click('.gs-job:has-text("688") button');
    assert.match(await p2.textContent('#job-unit'), /^688 · Yard Truck/);
    await p2.clock.fastForward('19:00');
    assert.equal(await p2.isVisible('#view-job'), true, 'still there after 19 minutes');
    await p2.clock.fastForward('02:00');
    await p2.waitForSelector('#view-home:not([hidden])', { timeout: 10000 });
    assert.deepEqual(p2.errors, []);
    await p2.close();
    results.push('Write-ups on top (newest first), services last, 15 a card ("4 more services come on as these are done"); 688 says Yard Truck; a new write-up flashes until opened; 20 minutes with no taps goes back to the cards');
  } finally {
    await browser.close();
  }
  console.log(results.map(r => 'ok - ' + r).join('\n'));
})().catch(e => { console.error(e); process.exit(1); });

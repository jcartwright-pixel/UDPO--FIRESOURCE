'use strict';
/*
 * Browser check of Joe's 10/19 bug on Fleet Service Due ("I tried to start the date in here and nothing was working"): every
 * box said "Needs start date / type the last date" but the box could not be clicked. Now a manager clicks PM / Reefer or
 * Annual Inspection and types the last service in the box; each box saves on its own (no Save button), the same save as
 * Fleet Service Setup's Edit, and the row shows the new due date. A dispatcher still only reads. At Joe's 1536x790 window.
 * SHOTS_DIR=<folder> saves pictures; BEFORE=1 only takes the picture (for the screen as it was).
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const F = require('../fixtures/fake-sheets');
const L = require('../../src/logic');
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
const setupOf = async (unit) => ((await db().collection('fleetSetup').doc(unit.replace(/[^A-Za-z0-9_-]+/g, '_')).get()).data() || {});
const cellText = (p, unit, key) => p.$eval('#sheet tr[data-unit="' + unit + '"] td[data-cell="' + key + '"]', td => td.textContent.replace(/\s+/g, ' ').trim());

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: () => new Date() });
  // Yard truck 688 (no GPS, Joe 10/19: goes by days), copied from one of the plant's own trucks.
  const road = (await db().collection('equipment').get()).docs.find(d => L.fleetKind(d.data().type) === 'TRUCK' && !L.unitLeased(d.data()));
  await db().collection('equipment').doc('eq_truck_688').set(Object.assign({}, road.data(), { unit: '688', id: 'eq_truck_688', notes: '' }));
  await db().collection('users').doc('dispatch.test@uniteddairy.com').set({ name: 'Test Dispatcher', status: 'ACTIVE', roles: ['DISPATCHER'], facilities: ['fac_uniontown'], cells: { id: 'usr_disp', version: '1' } }, { merge: true });
  const browser = await chromium.launch();
  const results = [];
  try {
    const p = await openPage(browser, 1536, 790, '/fleet.html?view=due&testEmail=manager.test@uniteddairy.com');
    await p.waitForFunction(() => /Needs start date/.test(document.getElementById('sheet').textContent), null, { timeout: 15000 });
    await p.waitForTimeout(800);
    if (BEFORE) { await shot(p, 'before-due-1536.png'); return; }
    // A trailer and a truck that need a start date.
    const pick = (type) => p.$$eval('#sheet tr[data-unit]', (rows, type) => rows.filter(r => r.children[1].textContent === type && r.dataset.unit !== '688' && /Needs start date/.test(r.children[2].textContent)).map(r => r.dataset.unit)[0], type);
    const trailer = await pick('Trailer'), truck = await pick('Truck');
    assert.ok(trailer && truck, 'a trailer and a truck need a start date');
    assert.match(await cellText(p, trailer, 'PM'), /Needs start date\s*Click to type the last date/);

    // Trailer reefer service: click the box, type the date, then the hours; each saves on its own.
    await p.click('#sheet tr[data-unit="' + trailer + '"] td[data-cell="PM"]');
    const box = '#sheet td.fs-cell.editing';
    await p.waitForSelector(box + ' input[data-f="last_service_date"]');
    assert.equal(await p.$$eval(box + ' button', b => b.length), 0, 'no Save button');
    await p.fill(box + ' input[data-f="last_service_date"]', '2026-04-01');
    await p.waitForFunction(() => /Saved/.test(document.querySelector('#sheet td.fs-cell.editing .fs-cell-saved').textContent), null, { timeout: 10000 });
    assert.equal((await setupOf(trailer)).last_service_date, '2026-04-01');
    await p.fill(box + ' input[data-f="last_service_hours"]', '20,500');
    await p.press(box + ' input[data-f="last_service_hours"]', 'Enter');
    await p.waitForFunction((u) => !document.querySelector('#sheet td.editing') && /Overdue|Due|days/.test(document.querySelector('#sheet tr[data-unit="' + u + '"] td[data-cell="PM"]').textContent), trailer, { timeout: 10000 });
    for (let i = 0; i < 40 && (await setupOf(trailer)).last_service_hours !== '20500'; i++) await p.waitForTimeout(250);
    assert.equal((await setupOf(trailer)).last_service_hours, '20500', 'the hours saved as the box closed');
    const reeferDue = L.addMonths('2026-04-01', L.FLEET_RULES.trailerMonths);
    assert.match(await p.$eval('#sheet tr[data-unit="' + trailer + '"] td[data-cell="PM"]', td => td.title), new RegExp('Due ' + Number(reeferDue.slice(5, 7)) + '-' + Number(reeferDue.slice(8)) + '-' + reeferDue.slice(2, 4)));

    // Annual inspection: the last inspection date makes the next one due by the rule (12 months).
    await p.click('#sheet tr[data-unit="' + trailer + '"] td[data-cell="DOT"]');
    await p.waitForSelector(box + ' input[data-f="dot_last"]');
    await p.fill(box + ' input[data-f="dot_last"]', '2026-04-01');
    await p.waitForFunction(() => /Saved/.test(document.querySelector('#sheet td.fs-cell.editing .fs-cell-saved').textContent), null, { timeout: 10000 });
    assert.equal((await setupOf(trailer)).dot_due, L.addMonths('2026-04-01', L.fleetRule(L.FLEET_RULES, 'TRAILER', 'dotMonths')));
    assert.deepEqual(await p.$$eval(box + ' label, ' + box + ' input', a => a.filter(x => parseFloat(getComputedStyle(x).fontSize) < 16).length), 0, 'text 16px or larger');
    await shot(p, 'after-typing-1536.png');
    // A click anywhere else closes the box; the row shows the new date.
    await p.click('#kpis');
    await p.waitForFunction((u) => !document.querySelector('#sheet td.editing') && !/Needs start date/.test(document.querySelector('#sheet tr[data-unit="' + u + '"] td[data-cell="DOT"]').textContent), trailer, { timeout: 10000 });

    // Truck PM: date and miles.
    await p.click('#sheet tr[data-unit="' + truck + '"] td[data-cell="PM"]');
    await p.waitForSelector(box + ' input[data-f="last_service_miles"]');
    await p.fill(box + ' input[data-f="last_service_date"]', '2026-04-01');
    await p.fill(box + ' input[data-f="last_service_miles"]', '412000');
    await p.press(box + ' input[data-f="last_service_miles"]', 'Enter');
    await p.waitForFunction(() => !document.querySelector('#sheet td.editing'), null, { timeout: 10000 });
    for (let i = 0; i < 20 && (await setupOf(truck)).last_service_miles !== '412000'; i++) await p.waitForTimeout(250);
    assert.deepEqual([(await setupOf(truck)).last_service_date, (await setupOf(truck)).last_service_miles], ['2026-04-01', '412000']);
    await p.waitForFunction((u) => !/Needs start date/.test(document.querySelector('#sheet tr[data-unit="' + u + '"] td[data-cell="PM"]').textContent), truck, { timeout: 10000 });

    // Yard truck 688 goes by days: its box asks only for the date and shows the due date, never miles.
    assert.match(await cellText(p, '688', 'PM'), /Needs start date\s*Click to type the last date/);
    await p.click('#sheet tr[data-unit="688"] td[data-cell="PM"]');
    await p.waitForSelector(box + ' input[data-f="last_service_date"]');
    assert.equal(await p.$$eval(box + ' input[data-f="last_service_miles"]', x => x.length), 0, 'no miles box for a yard truck');
    await p.fill(box + ' input[data-f="last_service_date"]', '2026-04-01');
    await p.press(box + ' input[data-f="last_service_date"]', 'Enter');
    await p.waitForFunction(() => !document.querySelector('#sheet td.editing'), null, { timeout: 10000 });
    for (let i = 0; i < 20 && (await setupOf('688')).last_service_date !== '2026-04-01'; i++) await p.waitForTimeout(250);
    assert.equal((await setupOf('688')).last_service_date, '2026-04-01');
    const due688 = L.addMonths('2026-04-01', L.FLEET_RULES.truckDaysMonths), md = due688.replace(/^\d\d(\d\d)-0?(\d+)-0?(\d+)$/, '$2-$3-$1');
    await p.waitForFunction(([u, t]) => document.querySelector('#sheet tr[data-unit="' + u + '"] td[data-cell="PM"]').textContent.indexOf(t) >= 0, ['688', md], { timeout: 10000 });
    assert.doesNotMatch(await cellText(p, '688', 'PM'), /mi\b|miles/);
    assert.ok(await p.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth + 1), 'no sideways scroll');
    await shot(p, 'after-due-1536.png');
    assert.deepEqual(p.errors, []);
    await p.close();

    // A dispatcher reads the list; the boxes do not open.
    const d = await openPage(browser, 1536, 790, '/fleet.html?view=due&testEmail=dispatch.test@uniteddairy.com');
    await d.waitForFunction(() => /Needs start date/.test(document.getElementById('sheet').textContent), null, { timeout: 15000 });
    assert.equal(await d.$$eval('#sheet td.fs-cell', t => t.length), 0);
    assert.doesNotMatch(await d.textContent('#sheet'), /Click to type/);
    await d.close();
    // The fleet-service-start-2026-04-01 load (test copy): every unit gets 4-1-26; the trailers' boxes all show their due dates.
    const fs0 = await db().collection('fleetSetup').get(); for (const x of fs0.docs) await x.ref.delete();
    await require('../../src/data-loads').loadFleetServiceStartOnce(db(), { project: 'ud-distribution-sandbox' });
    const q = await openPage(browser, 1536, 790, '/fleet.html?view=due&testEmail=manager.test@uniteddairy.com');
    await q.waitForSelector('#sheet tr[data-unit]', { timeout: 15000 });
    await q.waitForTimeout(800);
    const left = await q.$$eval('#sheet tr[data-unit]', rows => rows.filter(r => r.children[1].textContent === 'Trailer').map(r => r.children[2].textContent + r.children[3].textContent).filter(t => /Needs start date/.test(t)));
    assert.deepEqual(left, [], 'every trailer has its reefer service and annual inspection dates');
    assert.doesNotMatch(await cellText(q, '688', 'PM'), /Needs start date|miles/, 'yard truck 688 goes by its 4-1-26 date');
    await shot(q, 'after-start-load-1536.png');
    await q.close();
    results.push('fleet-service-start-2026-04-01 on the test copy: every trailer shows its reefer service and annual inspection due from 4-1-26');
    results.push('Fleet Service Due: a manager clicks PM / Reefer or Annual Inspection, types the last date (and miles or hours) and each box saves on its own; the row shows the new due date (1536x790)');
    results.push('Yard truck 688 (no GPS) goes by days: the PM box asks only for the date and shows the due date');
    results.push('A dispatcher reads the same list with no boxes to type in');
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('ok - ' + r));
})().catch(e => { console.error(e); process.exit(1); });

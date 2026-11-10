'use strict';
/*
 * Joe 11-7-26: Administration > Fleet Maintenance Setup > Garage Technicians (fleet.html?view=techs) lists the garage mechanics
 * on their own. Picking a name from the Employees list fills the employee ID, and what is typed in the two boxes stays when the
 * screen redraws for new information (it used to be wiped). A technician not found on the Employees list is picked on it.
 * At 1536x790. Made-up people only.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const F = require('../fixtures/fake-sheets');
const localCalls = require('./local-calls.cjs');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const until = async (fn, what) => { for (let i = 0; i < 60; i++) { if (await fn()) return; await new Promise(r => setTimeout(r, 250)); } assert.fail(what); };

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: () => new Date() });
  const d = db();
  for (const t of (await d.collection('garageTechs').get()).docs) await t.ref.delete();
  await d.collection('garageTechs').doc('TECH-PS').set({ tech_id: 'TECH-PS', name: 'PAT SAMPLE', active: 'YES', facility_id: 'fac_uniontown' });
  await d.collection('garageTechs').doc('TECH-TX').set({ tech_id: 'TECH-TX', name: 'TOMMY EXAMPLE', active: 'YES', facility_id: 'fac_uniontown' });
  await d.collection('garageTechs').doc('TECH-DU').set({ tech_id: 'TECH-DU', name: 'DREW UNLISTED', active: 'YES', facility_id: 'fac_uniontown' });
  for (const [id, name, dept] of [['009354', 'SAMPLE, PAT', 'GARAGE'], ['004567', 'NEWHIRE, SAM', 'GARAGE'], ['007311', 'EXAMPLE, THOMAS', 'GARAGE'], ['006060', 'LISTED, JORDAN', 'GARAGE'], ['007777', 'DRIVER, ALEX', 'DRIVER']])
    await d.collection('employees').doc(id).set({ employeeId: id, name, department: dept, active: true, status: 'ACTIVE', facilityId: 'fac_uniontown' });
  const browser = await chromium.launch();
  try {
    const p = await browser.newPage({ viewport: { width: 1536, height: 790 }, serviceWorkers: 'block' });
    await p.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, r => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, r.request().url().split('/').pop())) }));
    await localCalls(p);
    const errors = [];
    p.on('pageerror', e => errors.push(e.message));
    await p.goto(HOSTING + '/fleet.html?view=techs&testEmail=manager.test@uniteddairy.com');
    await p.waitForSelector('#tech-name');
    assert.equal(!!(await p.$('[data-rule]')), false, 'only the technicians: no service rules');
    assert.equal(await p.$eval('#tech-name', e => e.getBoundingClientRect().bottom <= innerHeight), true, 'the add box is on screen without scrolling');
    // The Employees list fills in after the page shows; wait for it (it raced on GitHub 11-10-26).
    await p.waitForFunction(() => [...document.querySelectorAll('#tech-people option')].some(o => o.value === 'ALEX DRIVER'), null, { timeout: 15000 });
    const people = await p.$$eval('#tech-people option', o => o.map(x => x.value));
    assert.ok(people.indexOf('THOMAS EXAMPLE') >= 0 && people.indexOf('SAM NEWHIRE') >= 0 && Math.max(people.indexOf('THOMAS EXAMPLE'), people.indexOf('SAM NEWHIRE')) < people.indexOf('ALEX DRIVER'), 'the Employees list, GARAGE first');
    assert.ok(people.includes('ALEX DRIVER') && !people.includes('PAT SAMPLE'), 'everyone else after; Pat is already a technician');
    // Picked from the list: the employee ID fills in.
    await p.fill('#tech-name', 'SAM NEWHIRE');
    assert.equal(await p.inputValue('#tech-login'), '004567');
    // New information comes in and the screen redraws: the boxes keep what is in them.
    await d.collection('gpsTrucks').doc('900001').set({ tag: '900001', odometerMiles: 1, lastReport: new Date().toISOString() });
    await d.collection('odometers').doc('redraw').set({ unit: '900001', miles: 5, date: '2026-11-07', at: new Date().toISOString() });
    await p.waitForTimeout(1500);
    assert.deepEqual([await p.inputValue('#tech-name'), await p.inputValue('#tech-login')], ['SAM NEWHIRE', '004567'], 'kept across a redraw');
    // Typed last name first, any case: still found.
    await p.fill('#tech-name', ''); await p.fill('#tech-login', '');
    await p.fill('#tech-name', 'newhire, sam');
    assert.equal(await p.inputValue('#tech-login'), '004567', 'typed "newhire, sam" finds Sam');
    // A technician whose name is not on the Employees list: red line and a box to pick them.
    const row = (n) => p.locator('#sheet tr', { hasText: n });
    // Joe 11-7-26: every row shows the LOGIN ID in a box, filled from the employee ID on its own (Tommy is THOMAS EXAMPLE).
    const box = (t) => p.locator('[data-login-tech="' + t + '"]');
    assert.equal(await box('TECH-PS').inputValue(), '009354');
    assert.equal(await box('TECH-TX').inputValue(), '007311', 'Tommy is Thomas: filled by itself');
    assert.equal(await p.locator('text=Set login ID').count(), 0, 'no Set login ID button');
    assert.match(await row('DREW UNLISTED').innerText(), /Not found on the Employees list/);
    assert.equal(await box('TECH-DU').inputValue(), '');
    await p.selectOption('[data-emp-tech="TECH-DU"]', '006060');
    await until(async () => ((await d.collection('garageTechs').doc('TECH-DU').get()).data() || {}).employee_id === '006060', 'the picked employee saved on the technician');
    await until(async () => (await box('TECH-DU').inputValue()) === '006060', 'Drew now shows that employee ID');
    // Wrong? Type the right one in the box: a number that is not an employee ID is their own login ID (kept only as a hash,
    // so the box says SET BY HAND).
    await box('TECH-TX').fill('2468'); await box('TECH-TX').press('Enter');
    await until(async () => ((await d.collection('garageTechs').doc('TECH-TX').get()).data() || {}).login_set === true, 'the typed login ID saved');
    await until(async () => (await box('TECH-TX').inputValue()) === '' && (await box('TECH-TX').getAttribute('placeholder')) === 'SET BY HAND', 'the box says SET BY HAND');
    assert.ok(!JSON.stringify((await d.collection('garageTechs').doc('TECH-TX').get()).data()).includes('2468'), 'the typed number is not on the readable entry');
    assert.ok(!(await d.collection('garageLogins').where('techId', '==', 'TECH-TX').get()).empty, 'and it signs them in');
    // Someone's employee ID typed (zeros or not) links them to that person.
    await box('TECH-TX').fill('7311'); await box('TECH-TX').press('Enter');
    await until(async () => { const t = (await d.collection('garageTechs').doc('TECH-TX').get()).data() || {}; return t.employee_id === '007311' && t.login_set === false; }, 'typing 7311 links Thomas');
    await until(async () => (await box('TECH-TX').inputValue()) === '007311', 'his employee ID shows again');
    // Adding Sam keeps the employee and empties the boxes.
    await p.fill('#tech-name', 'SAM NEWHIRE');
    await p.click('#tech-add');
    await until(async () => (await d.collection('garageTechs').where('name', '==', 'SAM NEWHIRE').get()).docs.some(x => x.data().employee_id === '004567'), 'Sam added with the employee ID');
    await until(async () => (await p.inputValue('#tech-name')) === '', 'the boxes empty after adding');
    assert.deepEqual(errors, []);
    // (home-access.cjs checks Administration > Fleet Maintenance Setup lists Fleet Service Setup and Garage Technicians.)
    console.log('ok - Garage Technicians on its own (Administration > Fleet Maintenance Setup): picking a name fills the employee ID and the boxes keep it across a redraw; "newhire, sam" is found; every row shows its LOGIN ID box filled from the employee ID (Tommy is Thomas), changed by typing in it; one not on the Employees list is picked on it');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });

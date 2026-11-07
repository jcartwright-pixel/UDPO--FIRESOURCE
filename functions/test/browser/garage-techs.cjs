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
  for (const [id, name, dept] of [['009354', 'SAMPLE, PAT', 'GARAGE'], ['004567', 'NEWHIRE, SAM', 'GARAGE'], ['007311', 'EXAMPLE, THOMAS', 'GARAGE'], ['007777', 'DRIVER, ALEX', 'DRIVER']])
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
    assert.equal(await p.$('[data-rule]'), null, 'only the technicians: no service rules');
    assert.equal(await p.$eval('#tech-name', e => e.getBoundingClientRect().bottom <= innerHeight), true, 'the add box is on screen without scrolling');
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
    assert.match(await row('PAT SAMPLE').innerText(), /Signs in with employee ID/);
    assert.match(await row('TOMMY EXAMPLE').innerText(), /Not found on the Employees list/);
    await p.selectOption('[data-emp-tech="TECH-TX"]', '007311');
    await until(async () => ((await d.collection('garageTechs').doc('TECH-TX').get()).data() || {}).employee_id === '007311', 'the picked employee saved on the technician');
    await until(async () => /Signs in with employee ID/.test(await row('TOMMY EXAMPLE').innerText()), 'Tommy now signs in with the employee ID');
    // Adding Sam keeps the employee and empties the boxes.
    await p.fill('#tech-name', 'SAM NEWHIRE');
    await p.click('#tech-add');
    await until(async () => (await d.collection('garageTechs').where('name', '==', 'SAM NEWHIRE').get()).docs.some(x => x.data().employee_id === '004567'), 'Sam added with the employee ID');
    await until(async () => (await p.inputValue('#tech-name')) === '', 'the boxes empty after adding');
    assert.deepEqual(errors, []);
    // (home-access.cjs checks Administration > Fleet Maintenance Setup lists Fleet Service Setup and Garage Technicians.)
    console.log('ok - Garage Technicians on its own (Administration > Fleet Maintenance Setup): picking a name fills the employee ID and the boxes keep it across a redraw; "newhire, sam" is found; a technician not on the Employees list is picked on it and then signs in with that employee ID');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });

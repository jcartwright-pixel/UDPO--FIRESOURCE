'use strict';
/*
 * Browser check of the Employees list from UDMS (Joe 10/31, mock-ups 1 to 4), on the local test database: the list on
 * Administration > Employees (who left in red, where each person is used); + Add Driver picks an employee and the name,
 * ID, hire date and phone fill in; Plant Schedule Setup's + Add Person picks one and the picked boxes are gray.
 * The list is filled the way the server's 15-minute copy fills it (src/employees.js), from a made-up UDMS database.
 * Pictures go to SHOTS_DIR.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const EMP = require('../../src/employees');
const F = require('../fixtures/fake-sheets');
const localCalls = require('./local-calls.cjs');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR || '';
const MANAGER = 'testEmail=manager.test@uniteddairy.com';
const UDMS_DB = 'udms-browser';

async function openPage(browser, width, height, url) {
  const page = await browser.newPage({ viewport: { width, height }, serviceWorkers: 'block' });
  await page.addInitScript(() => { try { sessionStorage.setItem('udPlant', 'fac_uniontown'); } catch (e) { /* none */ } });
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
const shot = (p, name) => SHOTS ? p.screenshot({ path: path.join(SHOTS, name) }) : null;
const noSideScroll = (p) => p.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth);

// Made-up people only. Each UDMS record also carries private fields, which must never show.
const PEOPLE = [
  ['10412', 'Pat', 'Adams', 'Driver', '2010-03-01'], ['10744', 'Jamie', 'Farrell', 'Loader', '2019-04-02'],
  ['10802', 'Morgan', 'Grant', 'Filler Operator', '2021-08-20', ''], ['10815', 'Taylor', 'Hollis', 'Mechanic', '2017-01-09'],
  ['10877', 'Riley', 'Kemp', 'Driver', '2026-10-20'], ['10881', 'Casey', 'Lane', 'Loader', '2026-10-27', ''],
  ['10522', 'Avery', 'Nolan', 'Loader', '2020-05-11', '330-555-0111', '2026-10-29']
];

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: () => new Date('2026-10-09T12:00:00Z') });
  await fetch('http://' + process.env.FIRESTORE_EMULATOR_HOST + '/emulator/v1/projects/demo-ud-distribution/databases/' + UDMS_DB + '/documents', { method: 'DELETE' });
  const udms = require('firebase-admin/firestore').getFirestore(UDMS_DB);
  for (const [id, first, last, job, hired, phone, left] of PEOPLE) {
    await udms.collection('people').doc('p' + id).set({ firstName: first, lastName: last, phone: phone === undefined ? '330555' + id.slice(1) : phone, dob: '1980-01-01', ssn: '123-45-6789', address: { line1: '1 Made Up Lane' },
      current: { employeeId: id, jobTitle: job, hireDate: hired, location: 'Uniontown PA Branch', workStatus: left ? 'Terminated' : 'Active', active: !left, termDate: left || null } });
  }
  // Adams is already a driver (the made-up Driver Master has no employee IDs, so give him his).
  const adams = (await db().collection('drivers').get()).docs.find(d => /ADAMS/.test(d.data().name));
  await adams.ref.set({ employeeId: '10412' }, { merge: true });
  const sync = await EMP.runEmployeeSync({ udmsDb: udms, plantDbs: { fac_uniontown: db() }, now: () => new Date('2026-10-30T23:45:00Z') });
  assert.equal(sync.ok, true);
  const browser = await chromium.launch();
  const results = [];
  try {
    // 1. The Employees list.
    for (const [w, h] of [[1536, 790], [1920, 1080], [390, 844]]) {
      const p = await openPage(browser, w, h, '/employees.html?' + MANAGER);
      await p.waitForFunction(() => document.querySelectorAll('#rows tr').length === 6);
      assert.match(await p.textContent('#sync'), /Up to date with UDMS/);
      const names = await p.$$eval('#rows tr td:first-child', t => t.map(x => x.textContent));
      assert.deepEqual(names, ['ADAMS, PAT', 'FARRELL, JAMIE', 'GRANT, MORGAN', 'HOLLIS, TAYLOR', 'KEMP, RILEY', 'LANE, CASEY'], 'Active people, A to Z; Nolan left');
      const text = await p.textContent('body');
      ['1980', '123-45', 'Made Up Lane'].forEach(x => assert.ok(text.indexOf(x) < 0, x + ' never shows'));
      assert.match(await p.textContent('#rows tr:first-child'), /Driver Roster/);
      assert.match(await p.textContent('#rows tr:nth-child(3)'), /No phone in UDMS/);
      if (w !== 390) assert.ok(await noSideScroll(p), 'no side scrolling at ' + w);
      await p.selectOption('#status', 'ALL');
      await p.waitForFunction(() => document.querySelectorAll('#rows tr.left-row').length === 1);
      assert.match(await p.textContent('#rows tr.left-row'), /Left 10-29-26/);
      await shot(p, '1-employees-list-' + w + '.png');
      assert.deepEqual(p.errors, []);
      await p.close();
    }
    results.push('Employees list: active people A to Z, where each is used, no phone said plainly, who left in red with the day; nothing private shows');

    // Administration opens it.
    const a = await openPage(browser, 1536, 790, '/administration.html?item=employees&' + MANAGER.replace('manager', 'admin'));
    await a.waitForSelector('#frame');
    await a.frameLocator('#frame').locator('#rows tr').first().waitFor();
    await shot(a, '1-employees-in-administration-1536.png');
    await a.close();
    results.push('Administration > Employees opens the list');

    // 2 and 3. + Add Driver picks an employee.
    const d = await openPage(browser, 1536, 790, '/drivers.html?' + MANAGER);
    await d.waitForSelector('#rows tr[data-id]');
    await d.click('#add');
    await d.fill('#d-pick', 'ke');
    await d.waitForSelector('#d-picks [data-emp]');
    const offered = await d.$$eval('#d-picks [data-emp]', b => b.map(x => x.dataset.emp));
    assert.deepEqual(offered, ['10877'], 'only matching employees who are not drivers yet');
    await shot(d, '2-add-driver-pick-1536.png');
    await d.click('#d-picks [data-emp="10877"]');
    assert.equal(await d.inputValue('#d-name'), 'KEMP, RILEY');
    assert.equal(await d.inputValue('#d-emp'), '10877');
    assert.equal(await d.inputValue('#d-hire'), '2026-10-20');
    assert.equal(await d.inputValue('#d-phone'), '330-555-0877');
    assert.ok(await d.$eval('#d-hire', x => x.readOnly), 'the hire date is gray');
    await shot(d, '3-add-driver-filled-1536.png');
    await d.click('#d-save');
    await d.waitForFunction(() => [...document.querySelectorAll('#rows tr')].some(r => /KEMP, RILEY/.test(r.textContent) && /10877/.test(r.textContent)), null, { timeout: 15000 });
    const kemp = (await db().collection('drivers').where('employeeId', '==', '10877').get()).docs[0].data();
    assert.equal(kemp.hireDate, '2026-10-20');
    await d.click('#add');
    await d.fill('#d-pick', 'ke');
    await d.waitForSelector('#d-picks p');
    assert.equal(await d.$$eval('#d-picks [data-emp]', b => b.length), 0, 'a driver is not offered twice');
    assert.deepEqual(d.errors, []);
    await d.close();
    results.push('+ Add Driver: pick Kemp by typing "ke"; name, ID, hire date (gray) and phone fill in; Add Driver saves him with his ID; he is not offered again');

    // 4. Plant Schedule Setup's + Add Person.
    const c = await openPage(browser, 1536, 790, '/crew.html?view=setup&tab=people&plant=fac_uniontown&' + MANAGER);
    await c.waitForSelector('#add-row');
    await c.waitForFunction(() => !/Reading/.test(document.getElementById('body').textContent));
    await c.click('#add-row');
    await c.waitForSelector('.crew-picker [data-emp]');
    await c.fill('#emp-q', 'lane');
    await c.waitForFunction(() => document.querySelectorAll('.crew-picker [data-emp]').length === 1);
    await shot(c, '4-plant-schedule-pick-1536.png');
    await c.click('.crew-picker [data-emp]');
    await c.waitForSelector('tr[data-op="person"] input.from-udms[data-k="name"]', { timeout: 15000 });
    assert.equal(await c.inputValue('tr[data-op="person"] [data-k="name"]'), 'LANE, CASEY');
    assert.equal(await c.inputValue('tr[data-op="person"] [data-k="hireDate"]'), '2026-10-27');
    assert.ok(await c.$eval('tr[data-op="person"] [data-k="employeeId"]', x => x.readOnly && x.classList.contains('from-udms')));
    await shot(c, '4-plant-schedule-added-1536.png');
    assert.deepEqual(c.errors, []);
    await c.close();
    results.push('Plant Schedule Setup: + Add Person, type "lane", pick; the line is added with her name, ID, phone and hire date gray');
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('EMPLOYEES ' + r));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });

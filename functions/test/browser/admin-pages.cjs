'use strict';
/*
 * Browser check of Administration's own pages (Joe 10/10: "complete this"): People & Roles with + Add Person and + Add Role
 * pop-ups, Role Templates, Access & QR Codes, Manager Links, Plant Station Codes, Garage Station Codes, Driver Station Codes, Manager Report Recipients, Sent Email
 * Log and Remaining Repair Items all open inside the panel with their buttons on one line at the top; none says "Being built"
 * or "View only". Pictures go to SHOTS_DIR.
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
const SHOTS = process.env.SHOTS_DIR;
const ADMIN = '?testEmail=admin.test@uniteddairy.com';

async function openPage(browser, width, height, url) {
  const page = await browser.newPage({ viewport: { width, height } });
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
const shot = async (p, name, clip) => { if (SHOTS) await p.screenshot(Object.assign({ path: path.join(SHOTS, name) }, clip ? { clip } : {})); };
const noSideScroll = (p) => p.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth);
// The buttons of a page sit on one line at the top.
// Review item 52 (Joe 10/13): each part of an email (before and after the @) sits on one line.
const emailsWhole = (p) => p.$$eval('#people td.email', tds => tds.length > 0 && tds.every(td => [...td.childNodes].filter(n => n.nodeType === 3).every(n => { const r = document.createRange(); r.selectNodeContents(n); return new Set([...r.getClientRects()].map(x => Math.round(x.top))).size === 1; })));
const oneLine = (p) => p.$eval('#view .ap > .ap-bar', bar => { const tops = [...bar.querySelectorAll(':scope > button, :scope > a, :scope > .ap-right')].map(b => Math.round(b.getBoundingClientRect().top)); return new Set(tops).size === 1; });

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: () => new Date('2026-10-09T12:00:00Z') });
  await db().collection('users').doc('super.test@uniteddairy.com').set({ name: 'Test Supervisor', status: 'ACTIVE', roles: ['SUPERVISOR'], facilities: ['fac_uniontown'], cells: { id: 'usr_sup', version: '1' } });
  await db().collection('config').doc('app').set({ writeBack: { enabled: true } }, { merge: true });
  const browser = await chromium.launch();
  const results = [];
  try {
    const p = await openPage(browser, 1920, 1080, '/administration.html' + ADMIN);
    await p.waitForSelector('.adm-item.on[data-key="people"]');
    await p.waitForSelector('#people tr[data-email="super.test@uniteddairy.com"]');
    const pills = await p.$$eval('.adm-item', s => s.filter(x => x.querySelector('em')).map(x => x.dataset.key));
    assert.deepEqual(pills, [], 'nothing in Administration says Being built or View only: ' + pills.join(', '));
    assert.equal(await p.$('.adm-state'), null);
    assert.equal(/Users sheet; editing here is being built/.test(await p.textContent('#view')), false);
    assert.deepEqual(await p.$$eval('#view .ap-bar > button', b => b.map(x => x.textContent)), ['+ Add Person', '+ Add Role', 'Refresh']);
    assert.ok(await oneLine(p));
    // Review items 51-53 (Joe 10/13): the side menu is words only; People & Roles has no info boxes; an email address never
    // breaks mid-word (each piece, before and after the @, stays on one line).
    assert.equal(await p.$$eval('.adm-nav .adm-item svg, .adm-nav .adm-item img, .adm-nav .adm-ic', x => x.length), 0);
    assert.equal(await p.$('#view .ap-tiles'), null);
    assert.equal(await emailsWhole(p), true);
    await shot(p, 'people-1920.png');
    await shot(p, 'people-top-2x.png', { x: 0, y: 0, width: 1920, height: 540 });

    // Click a person: the pop-up to change or disable them.
    await p.click('#people tr[data-email="super.test@uniteddairy.com"]');
    await p.waitForSelector('#p-modal:not([hidden]) #p-save');
    assert.equal(await p.inputValue('#p-name'), 'Test Supervisor');
    await p.selectOption('#p-role', 'MANAGER');
    await p.selectOption('#p-edit select[data-right="otr.write"]', 'deny');
    await shot(p, 'person-popup-1920.png');
    await p.click('#p-save');
    await p.waitForSelector('#p-modal[hidden]', { state: 'attached' });
    await p.waitForFunction(() => /Manager/.test(document.querySelector('#people tr[data-email="super.test@uniteddairy.com"]').textContent));
    const q = (await db().collection('masterOutbox').where('list', '==', 'users').get()).docs.map(d => d.data());
    assert.equal(q.length, 1, 'the Users sheet copy gets the change');
    results.push('People & Roles: + Add Person and + Add Role at the top; a person opens in a pop-up; Save changes their role and rights and queues the Users sheet copy');

    // + Add Person
    await p.click('#p-add');
    await p.waitForSelector('#p-modal:not([hidden])');
    assert.match(await p.textContent('#p-edit h3'), /New Person/);
    await p.fill('#p-name', 'Pat Plant');
    await p.fill('#p-email', 'pat.plant@uniteddairy.com');
    await p.selectOption('#p-role', 'PLANT_EMPLOYEE');
    await p.check('#p-plants input[value="fac_uniontown"]');
    await shot(p, 'add-person-popup-1920.png');
    await p.click('#p-save');
    await p.waitForSelector('#people tr[data-email="pat.plant@uniteddairy.com"]');
    // + Add Role
    await p.click('#p-add-role');
    await p.waitForSelector('#r-modal:not([hidden])');
    await p.fill('#r-name', 'Yard Lead');
    await p.check('#r-edit [data-code="plant.read"]');
    await p.check('#r-edit [data-code="plant.write"]');
    await shot(p, 'add-role-popup-1920.png');
    await p.click('#r-save');
    await p.waitForSelector('#r-modal[hidden]', { state: 'attached' });
    await p.waitForFunction(() => /Yard lead added/.test(document.querySelector('#view .ap-msg').textContent));
    results.push('+ Add Person adds Pat Plant; + Add Role adds Yard Lead with its rights');

    const open = async (key, ready) => { await p.click('.adm-item[data-key="' + key + '"]'); await p.waitForSelector(ready); await p.waitForTimeout(300); };
    await open('role-templates', '#rt-body table');
    assert.ok((await p.$$eval('#rt-role option', o => o.map(x => x.value))).indexOf('YARD_LEAD') >= 0);
    assert.ok(await oneLine(p));
    await shot(p, 'role-templates-1920.png');

    await open('access-codes', '#ac-rows tr');
    await p.click('#ac-rows [data-gen="super.test@uniteddairy.com"]');
    await p.waitForSelector('.ap-reveal .ap-qr svg');
    assert.match(await p.textContent('.ap-reveal .ap-url'), /index\.html\?access=/);
    await shot(p, 'access-qr-1920.png');

    // Joe 10/11: each link where it belongs. Manager Links keeps the manager links; the tablet links go with Plant Station
    // Codes; the Driver Station and the drivers' phone link (with its Route Distribution code) go to Driver Station Codes.
    await open('app-links', '.ap-link');
    // Review item 54 (Joe 10/13): no Phone Screens card; it only listed the same links again.
    assert.deepEqual(await p.$$eval('.ap-link', l => l.map(x => x.dataset.link)), ['company', 'phone', 'manager', 'personal']);
    // Joe 10/12: Launch opens the screen in a new window, so Administration stays where it was.
    assert.deepEqual(await p.$$eval('.ap-link a.ap-btn', a => [...new Set(a.map(x => x.target))]), ['_blank']);
    await shot(p, 'app-links-1920.png');
    await shot(p, 'app-links-top-2x.png', { x: 0, y: 0, width: 1920, height: 540 });
    // Joe 10/12: each plant's manager release code is on Manager Links (it was on Plant Station Codes).
    await p.waitForSelector('#sc-list .ap-item');
    await p.click('#sc-list [data-plant="fac_uniontown"]');
    await p.waitForSelector('#sc-list code');
    await shot(p, 'manager-release-codes-1920.png');

    await open('driver-codes', '#st-list .ap-item');
    // Joe 10/12: one Driver Station link (the code decides TV or the drivers' Check-In tablet), then the drivers' phone link.
    assert.deepEqual(await p.$$eval('.ap-link', l => l.map(x => x.dataset.link)), ['driver', 'route']);
    await p.click('#al-new-code');
    await p.click('#al-new-code');
    await p.waitForSelector('.ap-code-row code');
    await shot(p, 'driver-station-codes-1920.png');

    // Joe 10/12: one Plant Station link and the no-account phone app link, then the stations with their own codes; the
    // Garage Station has its own page, and Driver Station Codes lists the kiosks (station-codes.cjs types the codes).
    await open('station-codes', '#st-list .ap-item');
    assert.deepEqual(await p.$$eval('.ap-link', l => l.map(x => x.dataset.link)), ['plant', 'public']);
    assert.equal(await p.$$eval('#st-list .ap-item', l => l.length), 5);
    // The release codes moved to Manager Links: one line here points there.
    assert.equal(await p.$('#sc-list'), null);
    await shot(p, 'plant-station-codes-1920.png');
    await p.click('#release-moved a');
    await p.waitForSelector('.adm-item.on[data-key="app-links"]');
    await p.waitForSelector('#sc-list .ap-item');
    await open('garage-codes', '#st-list .ap-item');
    assert.deepEqual(await p.$$eval('.ap-link', l => l.map(x => x.dataset.link)), ['garage', 'maint']);
    await shot(p, 'garage-station-codes-1920.png');

    await open('report-recipients', '#rr-list');
    await p.fill('#rr-new-name', 'Plant Management');
    await p.fill('#rr-new-to', 'mgr@uniteddairy.com, gm@uniteddairy.com');
    await p.click('#rr-save');
    await p.waitForSelector('#rr-list [data-group="Plant Management"]');
    await shot(p, 'report-recipients-1920.png');

    await open('sent-log', '#sl-rows tr');
    await p.click('#sl-off');
    await p.waitForSelector('#sl-on');
    await shot(p, 'sent-email-log-1920.png');
    await p.click('#sl-on'); await p.click('#sl-on');
    await p.waitForSelector('#sl-off');

    // Joe 10/11: each plant's email comes from its own mailbox.
    await open('email-senders', '#es-rows tr');
    assert.deepEqual(await p.$$eval('#view .ap-bar > button', b => b.map(x => x.textContent)), ['Save', 'Refresh']);
    assert.ok(await oneLine(p));
    assert.deepEqual(await p.$$eval('#es-rows td:first-child', t => t.map(x => x.textContent)), ['Uniontown', 'Charleston', 'Martins Ferry']);
    assert.equal(await p.inputValue('#es-who'), 'PERSON', 'the standard: from whoever presses Send');
    await shot(p, 'email-senders-before-1920.png');
    await p.fill('[data-addr="fac_uniontown"]', 'uniontown.operations@uniteddairy.com');
    await p.fill('[data-name="fac_uniontown"]', 'United Dairy Uniontown Operations');
    await p.fill('[data-addr="fac_charleston"]', 'charleston.operations@uniteddairy.com');
    await p.fill('[data-name="fac_charleston"]', 'United Dairy Charleston Operations');
    await p.selectOption('#es-who', 'PLANT');
    await p.click('#es-save');
    await p.waitForFunction(() => /Saved/.test(document.querySelector('#view .ap-msg').textContent));
    await p.waitForSelector('#es-rows td small');
    assert.equal(await p.inputValue('[data-addr="fac_uniontown"]'), 'uniontown.operations@uniteddairy.com');
    assert.equal(await p.inputValue('#es-who'), 'PLANT');
    const es = (await db().collection('private').doc('emailSettings').get()).data();
    assert.deepEqual([es.senders.fac_charleston.address, es.fromWho], ['charleston.operations@uniteddairy.com', 'PLANT']);
    await shot(p, 'email-senders-1920.png');
    await shot(p, 'email-senders-top-2x.png', { x: 0, y: 0, width: 1920, height: 540 });
    await p.fill('[data-addr="fac_martins_ferry"]', 'someone@gmail.com');
    await p.click('#es-save');
    await p.waitForFunction(() => /not a United Dairy email address/.test(document.querySelector('#view .ap-msg').textContent));

    await open('repair-items', '#ri-list');
    await p.fill('#ri-title', 'Dock door 3 sensor');
    await p.fill('#ri-notes', 'Check after the next wash');
    await p.selectOption('#ri-priority', 'HIGH');
    await p.click('#ri-add');
    await p.waitForSelector('#ri-list [data-complete]');
    await p.waitForSelector('#repairs:not([hidden])');
    assert.match(await p.textContent('#repairs'), /Repairs · 1/);
    await shot(p, 'repair-items-1920.png');
    assert.ok(await noSideScroll(p));
    assert.deepEqual(p.errors, []);
    results.push('Role Templates, Access & QR (QR drawn on screen), Manager Links (with the release codes), Driver Station Codes (new Route code), Plant Station Codes (tablet links, pointer to the release codes), Report Recipients, Sent Email Log (Sending off and on), Email Senders (per plant) and Repair Items (header badge) all work inside the panel');

    // The tablet: once Uniontown has a release code, Release asks for it.
    const code = (await db().collection('private').doc('releaseCodes').get()).data().fac_uniontown.code;
    const ps = await openPage(browser, 1280, 800, '/plant-station.html' + ADMIN);
    await ps.waitForSelector('[data-station="CASE"]');
    await ps.click('[data-station="CASE"]');
    await ps.waitForSelector('#change:not([hidden])');
    // A link naming another station does not move a tablet that already has one (only Release does).
    await ps.goto(HOSTING + '/plant-station.html' + ADMIN + '&station=TOTES');
    await ps.waitForSelector('#change:not([hidden])');
    assert.equal(await ps.textContent('#title'), 'Case Loadout', 'a ?station= link does not change a tablet\'s station');
    results.push('Plant Station: a link naming another station does not move a tablet that already has one');
    await ps.click('#change');
    await ps.waitForSelector('#release:not([hidden])');
    await ps.fill('#release-code', 'WRONG999');
    await ps.click('#release-go');
    await ps.waitForFunction(() => /not recognized/.test(document.getElementById('release-msg').textContent));
    await shot(ps, 'plant-station-release-1280.png');
    await ps.fill('#release-code', code);
    await ps.click('#release-go');
    await ps.waitForSelector('[data-station="CASE_UNLOADING"]');
    assert.deepEqual(ps.errors, []);
    results.push('Plant Station: with a release code set, Release asks for it; a wrong code is refused, the right one frees the tablet');

    // Batch 2: email, schedules and diagnostics (js/admin-tools.js).
    await open('repair-email', '#re-where input');
    await p.fill('[data-emails="PENSKE"]', 'repairs@penske.com');
    await p.selectOption('[data-mode="PENSKE"]', 'IMMEDIATE');
    await p.click('#re-save');
    await p.waitForFunction(() => /Saved/.test(document.querySelector('#view .ap-msg').textContent));
    assert.ok(await oneLine(p));
    await shot(p, 'repair-email-1920.png');
    await p.click('#re-send');
    await p.waitForFunction(() => /Sent \d+ repair|Nothing was sent/.test(document.querySelector('#view .ap-msg').textContent));

    await open('checkin-email', '#ce-from');
    // The field shows before the saved settings load into it; wait for the load.
    await p.waitForFunction(() => document.getElementById('ce-from').value !== '', null, { timeout: 10000 }).catch(() => {});
    assert.equal(await p.inputValue('#ce-from'), 'callcenter@lauttamus.com');
    await p.check('#ce-on');
    await p.click('#ce-save');
    await p.waitForFunction(() => /Saved/.test(document.querySelector('#view .ap-msg').textContent));
    await p.click('#ce-now');
    // The emulator cannot reach Gmail: the page says why, plainly.
    await p.waitForFunction(() => /Checked|did not finish/.test(document.querySelector('#view .ap-msg').textContent), null, { timeout: 30000 });
    await shot(p, 'checkin-email-1920.png');

    await open('refresh-rates', '#rr2-rows tr');
    await p.selectOption('[data-minutes="checkinMail"]', '30');
    await p.click('[data-save="checkinMail"]');
    await p.waitForFunction(() => /Schedule saved/.test(document.querySelector('#view .ap-msg').textContent));
    assert.ok(await oneLine(p));
    await shot(p, 'refresh-rates-1920.png');

    await open('preflight', '#pf-run');
    await p.click('#pf-run');
    await p.waitForSelector('#pf-rows tr td .ap-chip');
    assert.match(await p.textContent('#pf-sum'), /checks/);
    await shot(p, 'preflight-1920.png');

    await open('update-live', '#ul-dry');
    await p.click('#ul-dry');
    await p.waitForFunction(() => /Dry run/.test(document.querySelector('#view .ap-msg').textContent));
    await shot(p, 'update-live-1920.png');

    await open('plant-fresh', '#pfr-go');
    await p.click('#pfr-go');
    assert.equal(await p.textContent('#pfr-go'), 'Click Again to Confirm');
    await p.click('#pfr-go');
    await p.waitForFunction(() => /Plant starts fresh from/.test(document.querySelector('#view .ap-msg').textContent));
    await shot(p, 'plant-fresh-1920.png');

    await open('refresh-home', '#rh-go');
    await shot(p, 'refresh-home-1920.png');
    await open('date-inventory', '#di-run');
    await shot(p, 'date-inventory-1920.png');
    await open('date-convert', '#dc-dry');
    assert.equal(await p.$eval('#dc-go', b => b.disabled), true, 'Convert waits for a clean dry run');
    await shot(p, 'date-convert-1920.png');

    await open('window-test', '#wt-run');
    await p.selectOption('#wt-screen', { label: 'Drivers \u2014 drivers.html' });
    await p.click('#wt-run');
    await p.waitForFunction(() => /READ (RESPONSE CONFIRMED|CHECK FAILED)/.test(document.querySelector('#view .ap-msg').textContent), null, { timeout: 40000 });
    assert.ok(await oneLine(p));
    await shot(p, 'window-test-1920.png');
    assert.ok(await noSideScroll(p));
    assert.deepEqual(p.errors, []);
    results.push('Repair Email, Driver Check-In Email, Refresh Rates, Pre-Flight, Update Live Sheets (dry run), Start Plant Fresh, Refresh Home, Date Inventory, Date Convert and Window Test Center all open and work inside the panel');

    // Sharp top crops for Joe (2x).
    if (SHOTS) {
      const hi = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
      await hi.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) }));
      await hi.goto(HOSTING + '/administration.html' + ADMIN);
      for (const [key, ready, name] of [['repair-email', '#re-where input', 'repair-email'], ['refresh-rates', '#rr2-rows tr', 'refresh-rates'], ['checkin-email', '#ce-from', 'checkin-email']]) {
        await hi.waitForSelector('.adm-item[data-key="' + key + '"]');
        await hi.click('.adm-item[data-key="' + key + '"]');
        await hi.waitForSelector(ready);
        await hi.waitForTimeout(400);
        await hi.screenshot({ path: path.join(SHOTS, name + '-top-2x.png'), clip: { x: 0, y: 0, width: 1920, height: 540 } });
      }
      await hi.close();
    }

    const small = await openPage(browser, 1366, 768, '/administration.html' + ADMIN);
    await small.waitForSelector('#people tr');
    assert.ok(await noSideScroll(small));
    assert.equal(await emailsWhole(small), true);
    await shot(small, 'people-1366.png');
    await small.close();
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('OK  ' + r));
})().catch(e => { console.error(e); process.exit(1); });

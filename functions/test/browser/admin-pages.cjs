'use strict';
/*
 * Browser check of Administration's own pages (Joe 10/10: "complete this"): People & Roles with + Add Person and + Add Role
 * pop-ups, Role Templates, Access & QR Codes, App Links & Codes, Plant Station Codes, Manager Report Recipients, Sent Email
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

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR;
const ADMIN = '?testEmail=admin.test@uniteddairy.com';

async function openPage(browser, width, height, url) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
  });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(HOSTING + url);
  page.errors = errors;
  return page;
}
const shot = async (p, name, clip) => { if (SHOTS) await p.screenshot(Object.assign({ path: path.join(SHOTS, name) }, clip ? { clip } : {})); };
const noSideScroll = (p) => p.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth);
// The buttons of a page sit on one line at the top.
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
    const BUILT = ['people', 'role-templates', 'access-codes', 'app-links', 'station-codes', 'report-recipients', 'sent-log', 'repair-items'];
    const pills = await p.$$eval('.adm-item', (s, keys) => s.filter(x => keys.indexOf(x.dataset.key) >= 0 && x.querySelector('em')).map(x => x.dataset.key), BUILT);
    assert.deepEqual(pills, [], 'nothing in Administration says Being built or View only: ' + pills.join(', '));
    assert.equal(await p.$('.adm-state'), null);
    assert.equal(/Users sheet; editing here is being built/.test(await p.textContent('#view')), false);
    assert.deepEqual(await p.$$eval('#view .ap-bar > button', b => b.map(x => x.textContent)), ['+ Add Person', '+ Add Role', 'Reload']);
    assert.ok(await oneLine(p));
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

    await open('app-links', '.ap-link');
    assert.equal(await p.$$eval('.ap-link', l => l.length), 8);
    await p.click('#al-new-code');
    await p.click('#al-new-code');
    await p.waitForSelector('.ap-code-row code');
    await shot(p, 'app-links-1920.png');
    await shot(p, 'app-links-top-2x.png', { x: 0, y: 0, width: 1920, height: 540 });

    await open('station-codes', '#sc-list .ap-item');
    await p.click('#sc-list [data-plant="fac_uniontown"]');
    await p.waitForSelector('#sc-list code');
    await shot(p, 'plant-station-codes-1920.png');

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
    results.push('Role Templates, Access & QR (QR drawn on screen), App Links (new Route code), Plant Station Codes, Report Recipients, Sent Email Log (Sending off and on) and Repair Items (header badge) all work inside the panel');

    // The tablet: once Uniontown has a release code, Change Station asks for it.
    const code = (await db().collection('private').doc('releaseCodes').get()).data().fac_uniontown.code;
    const ps = await openPage(browser, 1280, 800, '/plant-station.html' + ADMIN);
    await ps.waitForSelector('[data-station="CASE"]');
    await ps.click('[data-station="CASE"]');
    await ps.waitForSelector('#change:not([hidden])');
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
    results.push('Plant Station: with a release code set, Change Station asks for it; a wrong code is refused, the right one frees the tablet');

    const small = await openPage(browser, 1366, 768, '/administration.html' + ADMIN);
    await small.waitForSelector('#people tr');
    assert.ok(await noSideScroll(small));
    await shot(small, 'people-1366.png');
    await small.close();
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('OK  ' + r));
})().catch(e => { console.error(e); process.exit(1); });

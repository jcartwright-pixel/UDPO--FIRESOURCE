'use strict';
/*
 * Browser check of Joe's 10/14 per-person screens (People & Roles, mock-up A): an administrator ticks a maintenance manager's
 * screens with Start from a job and saves; that person's Home and menus then show only those areas, and a screen not ticked
 * is refused when its address is typed. Pictures go to SHOTS_DIR.
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
const MAINT = 'maint.test@uniteddairy.com';

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
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, name) }); };
// Joe 10/26: Home is four cards, each listing its departments' buttons; a department shows when any of its buttons shows.
const visibleCards = (p) => p.$$eval('#sides a[data-side]', a => [...new Set(a.filter(x => !x.hidden && !x.closest('[hidden]')).map(x => x.dataset.side))]);

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: () => new Date('2026-10-09T12:00:00Z') });
  await db().collection('users').doc(MAINT).set({ name: 'Maint Manager', status: 'ACTIVE', roles: ['MANAGER'], facilities: ['fac_uniontown'], cells: { id: 'usr_maint', version: '1' } });
  await db().collection('config').doc('app').set({ writeBack: { enabled: true } }, { merge: true });
  const browser = await chromium.launch();
  const results = [];
  try {
    // Before anything is ticked the manager sees every card, as before.
    let m = await openPage(browser, 1536, 864, '/index.html?testEmail=' + MAINT);
    await m.waitForFunction(() => document.querySelectorAll('#sides a[data-side]').length > 0 && document.getElementById('plant-name').textContent.trim());
    await m.waitForTimeout(500);
    assert.deepEqual(await visibleCards(m), ['plant', 'production', 'pmaint', 'shipping', 'distribution', 'fleet', 'garage', 'reports', 'safety'], 'nothing ticked yet: every department');
    await m.close();
    results.push('Nothing ticked yet: the manager sees every Home card, as before');

    for (const [w, h] of [[1536, 864], [1920, 1080]]) {
      const p = await openPage(browser, w, h, '/administration.html?testEmail=admin.test@uniteddairy.com');
      await p.waitForSelector('#people tr[data-email="' + MAINT + '"]');
      await p.click('#people tr[data-email="' + MAINT + '"]');
      await p.waitForSelector('#p-modal:not([hidden]) .sa-t');
      assert.match(await p.textContent('.sa'), /Nothing is limited yet/);
      assert.equal(await p.$('.sa-rights[open]'), null, 'the save-by-save rights are folded');
      await p.selectOption('#p-job', 'plantMaint');
      await p.waitForSelector('.sa-t tr.sa-screen');
      const on = await p.$$eval('.sa-t input[data-sa-plant="fac_uniontown"]:checked', b => b.map(x => x.dataset.saKeys));
      ['pmCenter', 'machinery', 'plantReports', 'shiftReports'].forEach(k => assert.ok(on.indexOf(k) >= 0, k));
      assert.equal(on.indexOf('scheduler'), -1);
      assert.equal(await p.$eval('.sa-t input[data-sa-plant="fac_charleston"]', x => x.disabled), true, 'a plant not in Allowed locations cannot be ticked');
      // Reports is partly ticked: its area box shows a dash.
      assert.equal(await p.$eval('.sa-t tr.sa-area input[data-sa-plant="fac_uniontown"][data-sa-keys^="plantReports"]', x => x.indeterminate), true);
      const font = await p.$$eval('.sa-t td, .sa-t th, .sa .ap-help, .sa-toggle, #p-job', els => Math.min(...els.map(x => parseFloat(getComputedStyle(x).fontSize))));
      assert.ok(font >= 16, 'text at least 16px, was ' + font);
      await shot(p, 'people-top-' + w + '.png');
      await p.evaluate(() => { document.querySelector('.sa').scrollIntoView({ block: 'start' }); });
      await shot(p, 'people-screens-' + w + '.png');
      if (w === 1920) {
        await p.click('#p-save');
        await p.waitForFunction((e) => document.querySelector('#view').textContent.indexOf('Saved ' + e) >= 0, MAINT);
      }
      assert.deepEqual(p.errors, []);
      await p.close();
    }
    const saved = (await db().collection('personRights').doc(MAINT).get()).data().screenAccess;
    assert.deepEqual(saved, { fac_uniontown: ['pmCenter', 'machinery', 'pmEquipment', 'pmWorkOrders', 'pmSchedule', 'maintStation', 'pmCrew', 'plantReports', 'shiftReports'] });
    results.push('Start from a job ticks the maintenance screens (Equipment and the Maintenance Schedule too, Joe 10/25) and two reports; Save keeps them for Uniontown');

    for (const [w, h] of [[1536, 864], [1920, 1080]]) {
      m = await openPage(browser, w, h, '/index.html?testEmail=' + MAINT);
      await m.waitForFunction(() => document.querySelectorAll('#sides a[data-side]').length > 0 && document.getElementById('plant-name').textContent.trim());
      await m.waitForFunction(() => [...document.querySelectorAll('#sides a[data-side]')].filter(x => !x.hidden && !x.closest('[hidden]')).map(x => x.dataset.side).filter((k, i, all) => all.indexOf(k) === i).length === 2);
      assert.deepEqual(await visibleCards(m), ['pmaint', 'reports']);
      await shot(m, 'home-maint-' + w + '.png');
      await m.goto(HOSTING + '/reportcenter.html?testEmail=' + MAINT);
      await m.waitForFunction(() => document.querySelector('.sidemenu'));
      await m.waitForTimeout(400);
      const links = await m.$$eval('.sidemenu a[href], .side-flyouts a[href]', a => a.filter(x => !x.hidden && !x.closest('[hidden]')).map(x => x.getAttribute('href')));
      assert.ok(links.indexOf('reports.html') >= 0 && links.indexOf('shiftreports.html') >= 0, links.join(' '));
      assert.equal(links.some(h => /scorecard|otr|trucks|fleet/.test(h)), false, links.join(' '));
      assert.deepEqual(await m.$$eval('.rc-group', g => g.filter(x => !x.hidden).map(x => x.querySelector('h2').textContent)), ['Plant Reports'], 'empty report groups are hidden');
      await shot(m, 'reports-maint-' + w + '.png');
      // Manager Center: the manager's own plant cards follow the ticks too (no Scheduler card without the Scheduler).
      await db().collection('personRights').doc(MAINT).set({ screenAccess: { fac_uniontown: ['manager', 'plantDepts', 'shiftNotes', 'quality', 'temps', 'yard'] } }, { merge: true });
      await m.goto(HOSTING + '/manager.html?testEmail=' + MAINT);
      await m.waitForFunction(() => document.querySelector('[data-card="dept"] .dp-card'));
      await m.waitForTimeout(400);
      // Joe 10/26: the Scheduler is a menu item only, and without the Scheduler ticked no link on the screen leads to it.
      assert.deepEqual(await m.$$eval('#screen a[href^="scheduler.html"]', a => a.filter(x => !x.hidden && !x.closest('[hidden]')).length), 0, 'no Scheduler link');
      assert.equal(await m.$eval('[data-card="dept"]', x => x.hidden), false);
      assert.equal(await m.$eval('[data-card="notes"]', x => x.hidden), false);
      await shot(m, 'manager-no-scheduler-' + w + '.png');
      await db().collection('personRights').doc(MAINT).set({ screenAccess: saved }, { merge: true });
      await m.goto(HOSTING + '/scheduler.html?testEmail=' + MAINT);
      await m.waitForSelector('.screen-refused');
      assert.match(await m.textContent('.screen-refused'), /don't have access to this screen/);
      await shot(m, 'refused-maint-' + w + '.png');
      assert.deepEqual(m.errors, []);
      await m.close();
    }
    results.push('The manager\'s Home shows only Plant Maintenance and Reports, Reports lists only the two ticked reports, and the Scheduler is refused by address');
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('ok - ' + r));
})().catch(err => { console.error(err); process.exit(1); });

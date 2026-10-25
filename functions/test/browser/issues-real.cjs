'use strict';
/*
 * Browser check of Truck / Trailer / Fork Truck Issues (Joe 10/18): only units with a real problem are listed. The answering
 * service's Pre Trip / Post Trip answers ("YES-NO", "yes-no", "YS") say nothing is wrong and make no row. Each row's What's
 * Wrong starts with one View link (no "From email" tag, no "View email"): it opens the answering-service email or the driver's
 * check-in in the app, whichever the write-up came from.
 * Joe 10/25: a truck the fleet list has as Idealease is leased (its Lessor button works, "Leased from Idealease") even when
 * Equipment Master's old fleet text has no Lease, and the open write-up shows the route number, not the route's inside code.
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
// Joe 10/19: every Work Actions button, the red X included, shows whole inside the table, with no sideways scroll. The last
// button keeps 12px spare so Windows' slightly wider letters still fit.
async function buttonsFit(p, label) {
  const bad = await p.evaluate(() => {
    const sheet = document.querySelector('table.issues').closest('.sheet') || document.querySelector('table.issues').parentElement;
    const edge = Math.min(sheet.getBoundingClientRect().right, document.querySelector('table.issues').getBoundingClientRect().right);
    const out = [];
    if (sheet.scrollWidth > sheet.clientWidth + 1) out.push('the list scrolls sideways');
    document.querySelectorAll('#rows tr[data-id]').forEach(tr => {
      const cell = tr.lastElementChild.getBoundingClientRect();
      tr.querySelectorAll('.work-acts button').forEach(b => {
        const r = b.getBoundingClientRect();
        if (r.right > Math.min(cell.right, edge) - 12) out.push(tr.dataset.id + ' ' + b.textContent.trim() + ' ends at ' + Math.round(r.right) + ' past ' + Math.round(Math.min(cell.right, edge)));
      });
    });
    return out;
  });
  assert.deepEqual(bad, [], label);
}

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: () => new Date('2026-10-09T12:00:00Z') });
  const run = (await db().collection('runs').get()).docs.find(d => Object.values(d.data().days || {}).some(x => x && x.runs));
  const day = Object.keys(run.data().days).find(k => run.data().days[k] && run.data().days[k].runs);
  await run.ref.update({ ['days.' + day + '.checkinCompletedAt']: new Date(Date.now() - 5400000).toISOString(), ['days.' + day + '.tractorIssues']: 'Flat tire on the steer axle',
    ['days.' + day + '.casesDelivered']: 410, ['days.' + day + '.driverCaseReturn']: 3 });
  const at = (h) => new Date(Date.now() - h * 3600000).toISOString();
  const mail = (id, unit, driver, text, h, kind) => ({ record_id: 'MAIL|' + id + '|' + (kind === 'TRAILER' ? 'trailer' : kind === 'FORK_TRUCK' ? 'pallet' : 'tractor'), kind: kind || 'TRUCK',
    [kind === 'TRAILER' ? 'trailer_number' : kind === 'FORK_TRUCK' ? 'unit_number' : 'truck_number']: unit, driver, route_id: '827', issue_details: text, status: 'NEEDS_REVIEW',
    opened_at: at(h), source_type: 'GMAIL', source_id: id });
  const rows = {
    MAIL_m1_tractor: mail('m1', '223876', 'PAT LEE', 'YES-NO', 1),
    MAIL_m2_tractor: mail('m2', '223880', 'Rob Miles', 'air conditioner in tractor don\'t work- screw where load bar hooks up is coming off', 2),
    MAIL_m3_tractor: mail('m3', '223881', 'Chris Hall', 'yes-no', 3),
    MAIL_m4_tractor: mail('m4', '223882', 'Jon Kirk', 'YS', 4),
    MAIL_m5_tractor: mail('m5', '225061', 'CARL HOWE', 'YES-POST- AIR LEAK', 5),
    MAIL_m6_trailer: mail('m6', 'T-941', 'PAT LEE', 'yes-no', 6, 'TRAILER'),
    MAIL_m7_pallet: mail('m7', '331', 'Mike Zane', 'RIGHT FORK NOT AS HIGH AS LEFT ONE', 7, 'FORK_TRUCK'),
    MAIL_m8_pallet: mail('m8', '326', 'PAT LEE', 'Y/N', 8, 'FORK_TRUCK'),
    // Joe 10/19: "UYES" is a mistyped yes (post trip done, nothing wrong), so no row.
    MAIL_m11_tractor: mail('m11', '123885', 'Chris Hall', 'UYES', 0.5),
    // Joe 10/20: "YES - NO WRITE UPS" is a done Post Trip with nothing wrong, so no row either.
    MAIL_m12_tractor: mail('m12', '223870', 'Sam Driver', 'YES - NO WRITE UPS', 0.4),
    MAIL_m10_trailer: mail('m10', 'T-826', 'Rob Miles', '826-back Door Busted Cables Snapped Will Not Open', 10, 'TRAILER'),
    // The same email twice: the old app's copy (one per answer) and the new reader's copy read again a day later.
    MAIL_m9_concerns: Object.assign(mail('m9', '225061', 'Carl Howe', 'store 2318- she was yelling and threatening to refuse the order', 30), { record_id: 'MAIL|m9|concerns' }),
    MAIL_m9_tractor: mail('m9', '225061', 'Carl Howe', 'store 2318- she was yelling and threatening to refuse the order; yes-no', 9),
    ['APP_' + run.id + '_' + day + '_tractor']: { record_id: 'APP|' + run.id + '|' + day + '|tractor', kind: 'TRUCK', truck_number: '900002', driver: 'BROOK', route_id: '802',
      issue_details: 'Flat tire on the steer axle', status: 'OPEN', opened_at: at(1.5), source_type: 'ROUTE_APP', source_id: run.id + '|' + day }
  };
  for (const [id, r] of Object.entries(rows)) await db().collection('maintenance').doc(id).set(r);
  await db().collection('mailCopies').doc('m2').set({ id: 'm2', from: 'Lauttamus Answering Service <CallCenter@lauttamus.com>', subject: 'UNIONTOWN DRIVER CHECK IN', receivedAt: at(2),
    body: 'Name +(UT): Rob Miles\nTractor #: 223880\nRoute #: 8\nPre Trip: yes\nPost Trip: yes-no\nConcerns/Issues: air conditioner in tractor don\'t work- screw where load bar hooks up is coming off' });
  const appId = 'APP_' + run.id + '_' + day + '_tractor';
  // The fleet list (read every half hour) says 900002 is an Idealease truck and 900001 is ours; the app's write-up keeps the route's code.
  await db().collection('config').doc('fleetOwnership').set({ ok: true, at: new Date().toISOString(), units: {
    '900001': { own: true, lease: 'OWN', facilityId: 'fac_uniontown' }, '900002': { own: false, lease: 'Idealease', facilityId: 'fac_uniontown' } } });
  const route802 = (await db().collection('routes').get()).docs.map(d => d.data()).find(r => r.route === '802' && /^rte_/.test(r.routeId || ''));
  assert.ok(route802, 'route 802 is in Route Master');
  await db().collection('maintenance').doc(appId).update({ route_id: route802.routeId });
  await db().collection('maintenance').doc('MAIL_m13_tractor').set(mail('m13', '900001', 'ADAMS, PAT', 'Mirror cracked', 0.3));
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const width of [1536, 1920]) {
      const p = await openPage(browser, width, width === 1536 ? 864 : 1080, '/issues.html?testEmail=manager.test@uniteddairy.com');
      await p.waitForSelector('tr[data-id="MAIL_m2_tractor"]');
      await shot(p, 'trucks-' + width + '.png');
      await buttonsFit(p, 'Trucks at ' + width);
      const list = await p.textContent('#rows');
      for (const id of ['MAIL_m1_tractor', 'MAIL_m3_tractor', 'MAIL_m4_tractor', 'MAIL_m11_tractor', 'MAIL_m12_tractor']) assert.equal(await p.locator('tr[data-id="' + id + '"]').count(), 0, id + ' says nothing is wrong');
      // One email is one row, dated when the email came in.
      assert.equal(await p.locator('tr[data-id^="MAIL_m9_"]').count(), 1);
      assert.match(await p.textContent('tr[data-id^="MAIL_m9_"] td.wrong'), /^View store 2318- she was yelling and threatening to refuse the order$/);
      for (const id of ['MAIL_m2_tractor', 'MAIL_m5_tractor', appId]) assert.equal(await p.locator('tr[data-id="' + id + '"]').count(), 1, id + ' is a real problem');
      assert.doesNotMatch(list, /From email|View email/);
      // One View link at the front of What's Wrong, then the problem.
      assert.match(await p.textContent('tr[data-id="MAIL_m2_tractor"] td.wrong'), /^View air conditioner/);
      assert.match(await p.textContent('tr[data-id="' + appId + '"] td.wrong'), /^View Flat tire/);
      // Joe 10/25: the leased truck's Lessor button works; an owned truck's stays off.
      assert.equal(await p.locator('tr[data-id="' + appId + '"] [data-step="lessor"]').isDisabled(), false, 'the Idealease truck can go to the lessor');
      assert.match(await p.getAttribute('tr[data-id="' + appId + '"] [data-step="lessor"]', 'title'), /Send to Idealease/);
      assert.equal(await p.locator('tr[data-id="MAIL_m13_tractor"] [data-step="lessor"]').isDisabled(), true, 'an owned truck goes to our garage');
      await p.click('tr[data-id="' + appId + '"] [data-open]');
      const more = await p.textContent('tr.issue-more');
      assert.match(more, /route 802 ·/);
      assert.doesNotMatch(more, /rte_/);
      assert.match(more, /Leased from Idealease/);
      await shot(p, 'leased-open-' + width + '.png');
      await p.click('tr[data-id="' + appId + '"] [data-open]');
      if (width === 1536) {
        await p.click('tr[data-id="MAIL_m2_tractor"] [data-source]');
        await p.waitForSelector('#mail-modal:not([hidden]) .mail-text');
        assert.match(await p.textContent('#mail-body'), /Lauttamus Answering Service/);
        assert.match(await p.textContent('#mail-title'), /email/i);
        await shot(p, 'view-email-1536.png');
        await p.click('[data-close-mail]');
        await p.click('tr[data-id="' + appId + '"] [data-source]');
        await p.waitForSelector('#mail-modal:not([hidden]) .mail-meta');
        const shown = await p.textContent('#mail-body');
        assert.match(await p.textContent('#mail-title'), /check-in/i);
        assert.match(shown, /Flat tire on the steer axle/);
        assert.match(shown, /410/);
        await shot(p, 'view-checkin-1536.png');
        await p.click('[data-close-mail]');
      }
      await p.click('[data-kind="TRAILER"]');
      await p.waitForSelector('tr[data-id="MAIL_m10_trailer"]');
      assert.equal(await p.locator('tr[data-id="MAIL_m6_trailer"]').count(), 0);
      await shot(p, 'trailers-' + width + '.png');
      await buttonsFit(p, 'Trailers at ' + width);
      await p.click('[data-kind="FORK_TRUCK"]');
      await p.waitForSelector('tr[data-id="MAIL_m7_pallet"]');
      assert.equal(await p.locator('tr[data-id="MAIL_m8_pallet"]').count(), 0);
      await shot(p, 'forks-' + width + '.png');
      await buttonsFit(p, 'Fork Truck at ' + width);
      assert.deepEqual(p.errors, []);
      await p.close();
    }
    results.push('Pre / Post Trip answers like YES-NO, yes-no, YS, Y/N, YES - NO WRITE UPS and a mistyped UYES make no row on Trucks, Trailers or Fork Truck / Pallet Jack; real problems stay');
    results.push('Every Work Actions button, the red X included, fits inside the list on Trucks, Trailers and Fork Truck at 1536 and 1920');
    results.push('A truck the fleet list has as Idealease can go to the lessor and says Leased from Idealease; an owned one cannot; the open write-up shows route 802, not its code');
    results.push('What\'s Wrong starts with one View link: the email for an answering-service write-up, the check-in for an app one');
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('ok - ' + r));
})().catch(err => { console.error(err); process.exit(1); });

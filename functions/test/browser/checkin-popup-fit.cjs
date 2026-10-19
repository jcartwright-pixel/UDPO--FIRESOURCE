'use strict';
/*
 * Browser check of Joe's 10/19 ask on Driver Check-ins ("the problem in this pop-up, it gets kind of cut off"): with long
 * write-ups like his 808 ("Driver Side Mirror Gone, Thermoking Not Running Properly"), the pop-up shows every word of Refused /
 * returned, Which store, Over / short, Loaded wrong, Truck, Trailer and Jack problem and the Notes, with no box cut off or scrolling inside, the pop-up stays
 * inside the window (1536x790, 1920x950, tablet 1024 and phone 390), text is 16px or larger, and an edited long problem saves.
 * The Driver Check-ins list shows everything the driver wrote in full too: the shortage, the problems and the notes.
 * SHOTS_DIR=<folder> saves pictures; BEFORE=1 only takes the pictures (for the screen as it was).
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const localCalls = require('./local-calls.cjs');
const { db, clear } = require('../emulator/helpers');
const { runTransfer } = require('../../src/transfer');
const F = require('../fixtures/fake-sheets');
const L = require('../../src/logic');

const HOSTING = 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR;
const BEFORE = !!process.env.BEFORE;
const DATE = '2026-10-19';
const LONG = {
  refusedReturned: '2 cs chocolate quarts, 1 case French onion dip 12oz',
  refusedReturnedSource: 'Delmont Walmart and Youngwood Shop n Save',
  tractorIssues: 'Driver Side Mirror Gone, Thermoking Not Running Properly',
  trailerIssues: 'Back door seal torn on the curb side, floor board loose near the front',
  palletJackIssues: "Pallet jack wouldn't run at first stop, was too cold; as soon as it warmed up it ran fine",
  overageShortageDetails: 'SHORT 2 cs · 16 choc. Quarts · Store: Delmont Walmart',
  loadingProblem: '1 case French onion dip 12oz was on the wrong pallet',
  checkinNotes: 'Called the store manager at Youngwood about the dip; he will hold the credit until Wednesday'
};

async function openPage(browser, width, height, url, mobile) {
  const ctx = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block', isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (route) => {
    route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, route.request().url().split('/').pop())) });
  });
  await localCalls(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(HOSTING + url);
  page.errors = errors;
  return page;
}

(async () => {
  await clear();
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: () => new Date('2026-10-09T12:00:00Z') });
  const wk = L.weekStart(DATE), p = L.dayPrefix(DATE), id = wk + '__run_x808';
  await db().collection('runs').doc(id).set({ weekStart: wk, route: '808', run: 'DSD', routeId: 'rte_x808', runId: 'run_x808', rev: 0,
    days: { [p]: Object.assign({ runs: true, driverId: 'drv_x808', driver: 'BARROW, ROGIE', truck: '223880', trailer: 'T-946', casesOut: 416, casesDelivered: 410, driverCaseReturn: 294, overageShortage: 'TRUE', loadedCorrectly: 'NO' }, LONG) } });
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const [w, h, mobile] of [[1536, 790], [1920, 950], [1024, 768, true], [390, 844, true]]) {
      const pg = await openPage(browser, w, h, '/checkins.html?date=' + DATE + '&testEmail=dispatch.test@uniteddairy.com', mobile);
      await pg.waitForSelector('#rows tr[data-index]');
      if (SHOTS && w === 1536) await pg.screenshot({ path: path.join(SHOTS, (BEFORE ? 'before' : 'after') + '-list-1536.png') });
      if (!BEFORE) {
        const list = await pg.$$eval('#rows tr[data-index="0"] td', tds => tds.map(td => ({ text: td.textContent, cut: td.classList.contains('said') && td.scrollWidth > td.clientWidth + 1 || td.scrollHeight > td.clientHeight + 1 })));
        const all = list.map(c => c.text).join(' | ');
        for (const said of [LONG.tractorIssues, LONG.trailerIssues, LONG.palletJackIssues, LONG.overageShortageDetails, LONG.loadingProblem, LONG.checkinNotes, LONG.refusedReturned]) assert.ok(all.includes(said), 'the list shows: ' + said);
        assert.deepEqual(list.filter(c => c.cut).map(c => c.text), [], 'nothing the driver wrote is cut off on the list at ' + w + 'x' + h);
        assert.equal(await pg.textContent('#n-issues'), '1', 'notes do not change the With issues count');
      }
      await pg.click('#rows tr[data-index="0"]');
      await pg.waitForSelector('.popover [data-save]');
      await pg.waitForTimeout(300);
      if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, (BEFORE ? 'before' : 'after') + '-' + w + '.png') });
      if (BEFORE) { await pg.context().close(); continue; }
      const m = await pg.evaluate((names) => {
        const box = document.querySelector('.popover').getBoundingClientRect();
        const field = (n) => n === 'checkinNotes' ? document.getElementById('ci-notes') : document.querySelector('.popover [name="' + n + '"]');
        return {
          inside: box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight,
          // Nothing (the side menu) covers the pop-up's labels.
          covered: [...document.querySelectorAll('.popover label')].filter(l => { const r = l.getBoundingClientRect(), at = document.elementFromPoint(r.left + 4, r.top + r.height / 2); return at && !at.closest('.popover'); }).map(l => l.textContent),
          cut: names.filter(n => { const el = field(n); return el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1; }),
          values: names.map(n => field(n).value),
          small: [...document.querySelectorAll('.popover label, .popover input, .popover textarea, .popover button, .popover b')].filter(x => parseFloat(getComputedStyle(x).fontSize) < 16).map(x => x.outerHTML.slice(0, 60))
        };
      }, Object.keys(LONG));
      console.log('# ' + w + 'x' + h + ' ' + JSON.stringify({ inside: m.inside, cut: m.cut, small: m.small }));
      assert.deepEqual(m.values, Object.values(LONG), 'every write-up is in its box');
      assert.deepEqual(m.cut, [], 'no write-up is cut off at ' + w + 'x' + h);
      assert.ok(m.inside, 'the pop-up stays inside the ' + w + 'x' + h + ' window');
      assert.deepEqual(m.covered, [], 'nothing covers the pop-up at ' + w + 'x' + h);
      assert.deepEqual(m.small, [], 'pop-up text is 16px or larger');
      for (const label of ['Cases delivered', 'Cases returned', 'Refused / returned', 'Which store', 'Over / short', 'Loaded wrong', 'Truck problem', 'Trailer problem', 'Jack problem', 'Trailer needs cleaned', 'Notes']) {
        assert.ok(await pg.isVisible('.popover label:text-is("' + label + '")'), label + ' is still there');
      }
      if (w === 1536) {
        // Typing more makes the box grow; Enter in a problem box still saves; the whole write-up is kept.
        const more = LONG.tractorIssues + ', Left Marker Light Out';
        await pg.fill('#ci-tractorIssues', more);
        assert.equal(await pg.$eval('#ci-tractorIssues', el => el.scrollHeight <= el.clientHeight + 1), true, 'the box grew to fit the new words');
        await pg.press('#ci-tractorIssues', 'Enter');
        await pg.waitForSelector('.popover', { state: 'detached' });
        const saved = async () => (await db().collection('runs').doc(id).get()).data().days[p].tractorIssues;
        for (let i = 0; i < 50 && (await saved()) !== more; i++) await pg.waitForTimeout(100);
        assert.equal(await saved(), more, 'the long truck problem saved whole');
        const day = (await db().collection('runs').doc(id).get()).data().days[p];
        assert.equal(day.overageShortageDetails, LONG.overageShortageDetails, 'the shortage is kept');
        assert.equal(day.loadingProblem, LONG.loadingProblem, 'what was loaded wrong is kept');
        assert.equal(day.loadedCorrectly, 'NO');
        assert.equal(day.checkinNotes, LONG.checkinNotes, 'the notes are kept');
        assert.match(await pg.textContent('#rows tr[data-index="0"]'), /Left Marker Light Out/);
        LONG.tractorIssues = more; // the next window sizes open the saved check-in
      }
      assert.deepEqual(pg.errors, []);
      await pg.context().close();
    }
    if (!BEFORE) results.push('Driver Check-ins pop-up: long refused, store, truck, trailer and jack write-ups and notes show in full at 1536x790, 1920x950, tablet and phone, the pop-up stays in the window, text 16px or larger, and a longer truck problem saves whole with Enter');
  } finally {
    await browser.close();
  }
  results.forEach(r => console.log('ok - ' + r));
})().catch(e => { console.error(e); process.exit(1); });

'use strict';
// Joe 11-6-26: the Hub reads Vicki's weekly route report once and keeps each week (routeWeeks) for Route Cost Analysis.
// Made-up names and numbers only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const R = require('../../src/routereports');
const { adminCall } = require('../../src/admin');
const { routeReport } = require('../fixtures/route-report');

const ADMIN = { email: 'pat.admin@uniteddairy.com' };
const tick = () => new Date('2026-11-06T19:00:00Z');
const admins = async () => {
  await db().collection('users').doc('pat.admin@uniteddairy.com').set({ status: 'ACTIVE', roles: ['Administrator'], name: 'Pat Admin', facilities: ['fac_uniontown'] });
  await db().collection('users').doc('sam.sales@uniteddairy.com').set({ status: 'ACTIVE', roles: ['Sales'], name: 'Sam Sales', facilities: ['fac_uniontown'] });
};

test('The reader takes each stop line and the route totals, in either total layout, .xls or .xlsx', () => {
  for (const bookType of ['biff8', 'xlsx']) {
    const read = R.readReport(routeReport({ bookType }), bookType === 'biff8' ? 'Weekly Daily Avg Cases By Route.xls' : 'r.xlsx');
    assert.equal(read.week_ending, '2026-10-31');
    assert.deepEqual(read.stops.map(s => [s.route, s.chain, s.customer_no, s.customer]),
      [[801, 0, 1001, 'SAMPLE MARKET #1'], [801, 12, 1002, 'MADE-UP DELI'], [805, 0, 2001, 'EXAMPLE GROCERY'], [805, 0, 2002, 'TEST SCHOOL']]);
    assert.deepEqual([read.stops[0].mon, read.stops[0].wed, read.stops[0].fri, read.stops[0].deliveries, read.stops[0].net_sales], [20, 18, 22, 3, 1200.5]);
    assert.deepEqual(read.totals.map(t => [t.route, t.deliveries]), [[801, 5], [805, 2]]);
    assert.deepEqual(R.checkTotals(read), []);
  }
  assert.throws(() => R.readReport(Buffer.from('hello'), 'notes.txt'), /weekly route report/);
  assert.equal(R.labelQuery('ROUTES/SALE BY ROUTE'), 'label:routes-sale-by-route');
});

test('Add a file by hand: the week is kept; the same file again changes nothing; one that does not add up is refused; only administrators', async () => {
  await clear(); await admins();
  const base64 = routeReport().toString('base64');
  await assert.rejects(adminCall(db(), { email: 'sam.sales@uniteddairy.com' }, { op: 'routeReportUpload', fileName: 'r.xls', base64 }), /administrator/i);
  const out = await adminCall(db(), ADMIN, { op: 'routeReportUpload', fileName: 'r.xls', base64 }, { now: tick });
  assert.deepEqual([out.saved.week, out.saved.changed, out.saved.stops, out.saved.routes], ['2026-10-31', true, 4, 2]);
  const wk = (await db().collection('routeWeeks').doc('2026-10-31').get()).data();
  assert.deepEqual([wk.source, wk.file, wk.routes, wk.cases, wk.net_sales, wk.stops.length], ['BY HAND', 'r.xls', 2, 146, 3895.75, 4]);
  assert.equal(out.weeks[0].week_ending, '2026-10-31');
  assert.equal(out.weeks[0].stops, undefined, 'the list does not send every stop to the screen');
  assert.equal((await adminCall(db(), ADMIN, { op: 'routeReportUpload', fileName: 'r.xls', base64 }, { now: tick })).saved.changed, false);
  await assert.rejects(adminCall(db(), ADMIN, { op: 'routeReportUpload', fileName: 'bad.xls', base64: routeReport({ weekEnding: '2026-11-07', breakRoute: 805 }).toString('base64') }), /does not add up for route 805/);
  assert.equal((await db().collection('routeWeeks').doc('2026-11-07').get()).exists, false);
});

test('From email: the labelled report is read once and named for the day it came; off = not checked; a bad file is tried again', async () => {
  await clear(); await admins();
  await assert.rejects(adminCall(db(), ADMIN, { op: 'routeReportSaveSettings', mailbox: '', enabled: true }), /mailbox/);
  const st = await adminCall(db(), ADMIN, { op: 'routeReportSaveSettings', mailbox: 'Pat.Sample@uniteddairy.com', label: '', enabled: false });
  assert.equal(st.settings.label, 'ROUTES/SALE BY ROUTE', 'the label starts as Joe\'s');
  const files = { a: routeReport({ weekEnding: '2026-10-31' }), b: routeReport({ weekEnding: '2026-11-07', breakRoute: 801 }) };
  let inbox = [{ id: 'm1', internalDate: Date.parse('2026-11-04T17:20:07Z'), subject: 'Weekly Daily Avg Cases by Route By Store', files: [{ name: 'Weekly Daily Avg Cases By Route.xls', attachmentId: 'a', size: files.a.length }, { name: 'logo.png', attachmentId: 'x', size: 10 }] }];
  const asked = [];
  const deps = { now: tick, readMail: async (q) => { asked.push(q); return inbox; }, readAttachment: async (q) => { assert.equal(q.owner, 'pat.sample@uniteddairy.com'); return files[q.attachmentId]; } };
  assert.deepEqual(await R.dailyCheck(db(), deps), { skipped: 'off' });
  await adminCall(db(), ADMIN, { op: 'routeReportSaveSettings', mailbox: 'pat.sample@uniteddairy.com', label: 'ROUTES/SALE BY ROUTE', enabled: true });
  const run = await R.dailyCheck(db(), deps);
  assert.deepEqual([run.status, run.read, run.saved], ['OK', 1, 1]);
  assert.match(asked[0].query, /^label:routes-sale-by-route has:attachment/);
  const wk = (await db().collection('routeWeeks').doc('2026-10-31').get()).data();
  assert.equal(wk.source, 'EMAIL 11-4-26');
  assert.match(run.message, /newest week ending 10-31-26/);
  assert.equal((await R.dailyCheck(db(), deps)).skipped, 1, 'the same email is not read twice');
  inbox = inbox.concat([{ id: 'm2', internalDate: Date.parse('2026-11-11T17:20:00Z'), files: [{ name: 'Weekly Daily Avg Cases By Route.xls', attachmentId: 'b', size: files.b.length }] }]);
  const out = await adminCall(db(), ADMIN, { op: 'routeReportCheckNow' }, Object.assign({}, deps));
  assert.equal(out.run.status, 'FAIL');
  assert.match(out.last.message, /does not add up for route 801/);
  assert.equal((await db().collection('routeReportMail').doc('m2').get()).exists, false, 'tried again next time');
});

// Joe 11-6-26 (the BOL): "You just gather the information and store it, and the other programs will gather the data they
// need from your storage area." Vicki's daily Daily Load By Route PDF is kept in dailyLoads/<load date>.
const { sampleLoad } = require('../fixtures/daily-load-pdf');
const L = require('../../src/dailyloads');

test('Daily load (BOL): every line of the PDF is kept by load date with totals by route; by hand or from the BOL label', async () => {
  await clear(); await admins();
  const read = await L.readLoadPdf(sampleLoad(), 'Daily Load UT.pdf');
  assert.equal(read.load_date, '2026-11-06');
  assert.deepEqual(read.lines.map(l => [l.route, l.customer_no, l.item_no, l.qty]),
    [[805, 1001, 305, 20], [805, 1001, 707, 8], [805, 1001, 2526, 6], [805, 1002, 1112, 4], [880, 3001, 401903, 37059], [880, 3001, 7, 48]],
    'a line with the left columns blank belongs to the stop above; a long description gives up its quantity');
  assert.equal(read.lines[4].item, 'SAMPLE .5% BMLK LB TOTE');
  await assert.rejects(L.readLoadPdf(Buffer.from('%PDF-1.4 nothing'), 'x.pdf'), /can be read|not the Daily Load/);

  const out = await adminCall(db(), ADMIN, { op: 'routeReportUpload', fileName: 'Daily Load UT.pdf', base64: sampleLoad().toString('base64') }, { now: tick });
  assert.deepEqual([out.saved.kind, out.saved.date, out.saved.lines, out.saved.routes], ['bol', '2026-11-06', 6, 2]);
  const day = (await db().collection('dailyLoads').doc('2026-11-06').get()).data();
  assert.deepEqual([day.route_count, day.stops, day.qty, day.source, day.lines.length], [2, 3, 37145, 'BY HAND', 6]);
  assert.deepEqual(day.routes[0], { route: 805, stops: 2, lines: 4, qty: 38 });
  assert.equal(out.days[0].load_date, '2026-11-06');
  assert.equal(out.days[0].lines, undefined, 'the list does not send every line to the screen');

  await adminCall(db(), ADMIN, { op: 'routeReportSaveSettings', mailbox: 'pat.sample@uniteddairy.com', enabled: true });
  assert.equal((await R.status(db())).settings.bolLabel, 'ROUTES/BOL', 'the BOL label starts as Joe\'s');
  const asked = [];
  const pdf = sampleLoad('11/07/2026');
  const deps = { now: tick, readMail: async (q) => { asked.push(q.query); return /label:routes-bol/.test(q.query) ? [{ id: 'b1', internalDate: Date.parse('2026-11-07T21:00:00Z'), files: [{ name: 'Daily Load UT.pdf', attachmentId: 'p', size: pdf.length }] }] : []; },
    readAttachment: async () => pdf };
  const run = await R.dailyCheck(db(), deps);
  assert.deepEqual([run.status, run.read, run.saved], ['OK', 1, 1]);
  assert.ok(asked.some(q => /^label:routes-bol has:attachment filename:pdf/.test(q)));
  assert.match(run.message, /newest daily load 11-7-26/);
  assert.equal((await db().collection('dailyLoads').doc('2026-11-07').get()).data().source, 'EMAIL 11-7-26');
  assert.equal((await R.dailyCheck(db(), deps)).skipped, 1, 'the same email is not read twice');
});

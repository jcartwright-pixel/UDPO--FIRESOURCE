'use strict';
// Joe 11-6-26: the Hub reads Vicki's weekly route report once and keeps each week (routeWeekly) for Route Cost Analysis.
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
    const all = R.readReport(routeReport({ bookType }), bookType === 'biff8' ? 'Weekly Daily Avg Cases By Route.xls' : 'r.xlsx');
    assert.deepEqual(all.weeks.map(w => w.week_ending), ['2026-10-31']);
    const read = all.weeks[0];
    assert.deepEqual(read.stops.map(s => [s.route, s.chain, s.customer_no, s.customer]),
      [[801, 0, 1001, 'SAMPLE MARKET #1'], [801, 12, 1002, 'MADE-UP DELI'], [805, 0, 2001, 'EXAMPLE GROCERY'], [805, 0, 2002, 'TEST SCHOOL']]);
    assert.deepEqual([read.stops[0].mon, read.stops[0].wed, read.stops[0].fri, read.stops[0].deliveries, read.stops[0].net_sales], [20, 18, 22, 3, 1200.5]);
    assert.deepEqual(read.totals.map(t => [t.route, t.deliveries]), [[801, 5], [805, 2]]);
    assert.deepEqual(R.checkTotals(read), []);
  }
  // One file with two weeks keeps them apart; the total line's deliveries (it counts invoices) are not checked.
  const two = R.readReport(routeReport({ weeks: ['2026-11-07', '2026-10-31'], invoices: true }), 'two.xls');
  assert.deepEqual(two.weeks.map(w => [w.week_ending, w.stops.length, w.totals.length]), [['2026-10-31', 4, 2], ['2026-11-07', 4, 2]]);
  assert.deepEqual(two.weeks.map(w => R.checkTotals(w)), [[], []]);
  assert.throws(() => R.readReport(Buffer.from('hello'), 'notes.txt'), /weekly route report/);
  assert.equal(R.labelQuery('ROUTES/SALE BY ROUTE'), 'label:routes-sale-by-route');
});

test('Add a file by hand: the week is kept; the same file again changes nothing; one that does not add up is refused; only administrators', async () => {
  await clear(); await admins();
  const base64 = routeReport().toString('base64');
  await assert.rejects(adminCall(db(), { email: 'sam.sales@uniteddairy.com' }, { op: 'routeReportUpload', fileName: 'r.xls', base64 }), /administrator/i);
  const out = await adminCall(db(), ADMIN, { op: 'routeReportUpload', fileName: 'r.xls', base64 }, { now: tick });
  assert.deepEqual([out.saved.week, out.saved.changed, out.saved.stops, out.saved.routes], ['2026-10-31', true, 4, 2]);
  const wk = (await db().collection('routeWeekly').doc('2026-10-31').get()).data();
  assert.deepEqual([wk.source, wk.file, wk.routes, wk.cases, wk.net_sales, wk.stops.length], ['BY HAND', 'r.xls', 2, 146, 3895.75, 4]);
  assert.equal(out.weeks[0].week_ending, '2026-10-31');
  assert.equal(out.weeks[0].stops, undefined, 'the list does not send every stop to the screen');
  assert.equal((await adminCall(db(), ADMIN, { op: 'routeReportUpload', fileName: 'r.xls', base64 }, { now: tick })).saved.changed, false);
  await assert.rejects(adminCall(db(), ADMIN, { op: 'routeReportUpload', fileName: 'bad.xls', base64: routeReport({ weekEnding: '2026-11-07', breakRoute: 805 }).toString('base64') }), /does not add up for route 805/);
  assert.equal((await db().collection('routeWeekly').doc('2026-11-07').get()).exists, false);
  // A file with two weeks: both are kept, in the shape Route Cost Analysis reads.
  const both = await adminCall(db(), ADMIN, { op: 'routeReportUpload', fileName: 'two.xls', base64: routeReport({ weeks: ['2026-10-31', '2026-11-07'], invoices: true }).toString('base64') }, { now: tick });
  assert.deepEqual(both.savedWeeks.map(w => [w.week, w.changed]), [['2026-10-31', false], ['2026-11-07', true]]);
  const nov = (await db().collection('routeWeekly').doc('2026-11-07').get()).data();
  assert.deepEqual([nov.week_ending, nov.stop_count, nov.stops[0].customer_no, nov.stops[0].mon, nov.stops[0].deliveries], ['2026-11-07', 4, 1001, 20, 3]);
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
  // The label OR the office's subject: the 11-11-26 report came in with no label and was missed at 2:00 PM.
  assert.equal(asked[0].query, '{label:routes-sale-by-route subject:"weekly daily avg cases by route by store"} has:attachment newer_than:60d -in:sent');
  const wk = (await db().collection('routeWeekly').doc('2026-10-31').get()).data();
  assert.deepEqual([wk.source, wk.received], ['EMAIL', '2026-11-04T17:20:07.000Z'], 'Route Cost Analysis names it for the day it came');
  assert.match(run.message, /newest week ending 10-31-26/);
  assert.equal((await R.dailyCheck(db(), deps)).skipped, 1, 'the same email is not read twice');
  inbox = inbox.concat([{ id: 'm2', internalDate: Date.parse('2026-11-11T17:20:00Z'), files: [{ name: 'Weekly Daily Avg Cases By Route.xls', attachmentId: 'b', size: files.b.length }] }]);
  const out = await adminCall(db(), ADMIN, { op: 'routeReportCheckNow' }, Object.assign({}, deps));
  assert.equal(out.run.status, 'FAIL');
  assert.match(out.last.message, /does not add up for route 801/);
  assert.equal((await db().collection('routeReportMail').doc('m2').get()).exists, false, 'tried again next time');
});

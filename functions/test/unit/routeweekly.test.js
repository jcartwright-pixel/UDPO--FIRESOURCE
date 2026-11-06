// Weekly Route Report (src/routeweekly.js, Joe 11-6-26): MIS's weekly ROUTE WEEKLY CASE DELIVERY REVIEW BY STORE is read into
// one week of stores with their cases by day, and the email check reads each message under the label once. Made-up stores only.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const X = require('@e965/xlsx');
const W = require('../../src/routeweekly');

const { sampleXls: report } = require('../fixtures/route-weekly');

test('a weekly report reads into one week: each store with its cases by day, in either column layout', () => {
  for (const layout of ['email', 'july']) {
    const { weeks } = W.readReport(report('2026-10-31', layout), 'Weekly Daily Avg Cases By Route.xls');
    assert.equal(weeks.length, 1);
    const w = weeks[0];
    assert.equal(w.week_ending, '2026-10-31');
    assert.equal(w.stop_count, 3);
    assert.equal(w.routes, 2);
    assert.deepEqual(w.stops[0], { route: '805', chain: '0', customer_no: '1001', customer: 'MADEUP GOLF CENTER', sun: 0, mon: 0, tue: 12.5, wed: 0, thu: 9, fri: 0, sat: 14, deliveries: 3, net_sales: 410.2 });
    assert.equal(w.stops[2].fri, 0, 'float dust is no delivery');
    assert.equal(w.cases, 12.5 + 9 + 14 + 6 + 120 + 130);
  }
});

test('a file that is not the report gives no week, and the wrong kind of file is turned away', () => {
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([['hello', 1, 2]]), 'Sheet1');
  assert.deepEqual(W.readReport(X.write(wb, { type: 'buffer', bookType: 'xlsx' }), 'notes.xlsx').weeks, []);
  assert.throws(() => W.readReport(Buffer.from('%PDF-1.4'), 'x.pdf'), /weekly route report/);
  assert.throws(() => W.readReport(Buffer.alloc(0), 'x.xls'), /empty/);
});

function fakeDb() {
  const store = {};
  const doc = (col, id) => ({
    id,
    get: async () => ({ id, exists: store[col + '/' + id] != null, data: () => store[col + '/' + id] }),
    set: async (v) => { store[col + '/' + id] = JSON.parse(JSON.stringify(v)); }
  });
  return {
    store,
    collection: (col) => ({
      doc: (id) => doc(col, id),
      orderBy: () => ({ limit: () => ({ get: async () => ({ docs: Object.keys(store).filter(k => k.startsWith(col + '/')).sort().reverse().map(k => ({ id: k.split('/')[1], data: () => store[k] })) }) }) })
    })
  };
}

test('by hand and from email: each week is kept once under its week ending, and each message is read once', async () => {
  const db = fakeDb();
  const up = await W.OPS.routeWeeklyUpload(db, 'pat.sample@uniteddairy.com', { fileName: 'july.xls', base64: report('2026-07-04', 'july').toString('base64') }, '2026-11-06T22:00:00.000Z');
  assert.equal(up.saved[0].week, '2026-07-04');
  assert.equal(db.store['routeWeekly/2026-07-04'].source, 'BY HAND');
  await assert.rejects(W.OPS.routeWeeklySaveSettings(db, 'pat.sample@uniteddairy.com', { enabled: true, mailbox: '' }, 'x'), /mailbox first/);
  await W.OPS.routeWeeklySaveSettings(db, 'pat.sample@uniteddairy.com', { enabled: true, mailbox: 'pat.sample@uniteddairy.com' }, '2026-11-06T22:00:00.000Z');
  let asked = '';
  const deps = {
    now: () => new Date('2026-11-07T12:30:00Z'),
    readMail: async (q) => { asked = q.query; return [
      { id: 'm2', internalDate: 2, files: [{ name: 'Weekly Daily Avg Cases By Route.xls', attachmentId: 'a2', size: 100 }] },
      { id: 'm1', internalDate: 1, files: [{ name: 'Weekly Daily Avg Cases By Route.xls', attachmentId: 'a1', size: 100 }, { name: 'logo.png', attachmentId: 'x', size: 5 }] }]; },
    readAttachment: async (q) => report(q.attachmentId === 'a1' ? '2026-10-24' : '2026-10-31')
  };
  const run = await W.checkMail(db, 'test', deps);
  assert.match(asked, /^label:routes-sale-by-route has:attachment newer_than:120d$/);
  assert.equal(run.saved, 2);
  assert.match(run.message, /Read 2 weeks, newest week ending 10-31-26/);
  assert.equal(db.store['routeWeekly/2026-10-31'].source, 'EMAIL');
  const again = await W.checkMail(db, 'test', deps);
  assert.equal(again.skipped, 2);
  const st = await W.OPS.routeWeeklyStatus(db, '', {});
  assert.deepEqual(st.weeks.map(w => w.week), ['2026-10-31', '2026-10-24', '2026-07-04']);
  assert.deepEqual(st.open.routes.map(r => [r.route, r.stores, r.cases]), [['805', 2, 42], ['6301', 1, 250]]);
  assert.equal(JSON.stringify(st.open).indexOf('net_sales'), -1, 'the screen gets no sales');
});

test('the morning check only runs when it is switched on', async () => {
  const db = fakeDb();
  assert.deepEqual(await W.morningCheck(db, {}), { skipped: 'off' });
});

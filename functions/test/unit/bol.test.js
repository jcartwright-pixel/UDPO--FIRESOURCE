// Daily BOL (src/bol.js, Joe 11-6-26): the office's Daily Load By Route PDF is read into load days, routes and customers,
// and the email check reads each message under the label once. Made-up customers only.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const B = require('../../src/bol');
const { pdfLines } = require('../../src/bol-pdf');
const { samplePdf, bolPdf, SAMPLE } = require('../fixtures/bol-pdf');

test('the PDF comes back as lines of nine cells, header first on each page', () => {
  const lines = pdfLines(samplePdf());
  assert.equal(lines.length, 2 + SAMPLE.length);
  assert.deepEqual(lines[0].map(c => c.text), ['LoadDate', 'RtNo', 'LoadSeq', 'CusChn', 'CusNo', 'CusName', 'ItemNo', 'Descrip', 'Qty']);
  assert.deepEqual(lines[1].map(c => c.text), SAMPLE[0]);
  assert.equal(lines[4][0].text, 'LoadDate');
  assert.equal(lines[5].map(c => c.text)[5], 'PRETEND MARKET #9001 TOWNVILLE');
});

test('a BOL is grouped into load day, routes in number order and customers in BOL order', () => {
  const { days } = B.readBol(samplePdf(), 'Daily Load UT.pdf');
  assert.equal(days.length, 1);
  const d = days[0];
  assert.equal(d.date, '2026-11-09');
  assert.deepEqual(d.totals, { routes: 2, stops: 3, lines: 5, qty: 606 });
  assert.deepEqual(d.routes.map(r => r.route), ['805', '6301']);
  assert.deepEqual(d.routes[0].stops.map(s => [s.seq, s.custNo, s.name, s.qty]), [[0, '1001', 'MADEUP GOLF CENTER', 46], [2, '1002', 'SAMPLE FOOD MART (CO-OP)', 20]]);
  assert.deepEqual(d.routes[1].stops[0].lines[0], { item: '260205', desc: 'GV HVD GAL', qty: 432 });
});

test('a cell missing from a line still lands under its own header', () => {
  const lines = [
    [{ x: 17.9, text: 'LoadDate' }, { x: 65.4, text: 'RtNo' }, { x: 103.8, text: 'LoadSeq' }, { x: 150, text: 'CusChn' }, { x: 200.2, text: 'CusNo' }, { x: 272.7, text: 'CusName' }, { x: 373.6, text: 'ItemNo' }, { x: 450.9, text: 'Descrip' }, { x: 560.9, text: 'Qty' }],
    [{ x: 11.5, text: '11/09/2026' }, { x: 68, text: '812' }, { x: 118.9, text: '1' }, { x: 197, text: '231069' }, { x: 239.5, text: 'MADEUP STORE' }, { x: 365.5, text: '310' }, { x: 419.5, text: 'UD 2% PLS QT' }, { x: 570.4, text: '3' }]
  ];
  assert.deepEqual(B.orderLines(lines), [{ date: '2026-11-09', route: '812', seq: 1, chain: '', custNo: '231069', name: 'MADEUP STORE', item: '310', desc: 'UD 2% PLS QT', qty: 3 }]);
});

test('an Excel or CSV copy with the same columns reads the same', () => {
  const csv = 'LoadDate,RtNo,LoadSeq,CusChn,CusNo,CusName,ItemNo,Descrip,Qty\n' + SAMPLE.map(r => r.map(c => /,/.test(c) ? '"' + c + '"' : c).join(',')).join('\n');
  const a = B.readBol(Buffer.from(csv), 'bol.csv').days, b = B.readBol(samplePdf(), 'bol.pdf').days;
  assert.deepEqual(a, b);
});

test('dates, label search words and files that are not a BOL', () => {
  assert.equal(B.dayOf('11/6/26'), '2026-11-06');
  assert.equal(B.dayOf('2026-11-06'), '2026-11-06');
  assert.equal(B.labelQuery('ROUTES/BOL'), 'label:routes-bol');
  assert.equal(B.labelQuery('Routes / Sale By Route'), 'label:routes-sale-by-route');
  assert.equal(B.mailQuery({ label: 'ROUTES/BOL', sender: '@uniteddairy.com' }),
    '{label:routes-bol subject:"daily load data"} has:attachment newer_than:10d -in:sent from:uniteddairy.com');
  assert.deepEqual(B.readBol(Buffer.from('%PDF-1.4 nothing here'), 'x.pdf').days, []);
  assert.throws(() => B.readBol(Buffer.from('hello'), 'notes.txt'), /Pick the BOL/);
  assert.throws(() => B.readBol(Buffer.alloc(0), 'x.pdf'), /empty/);
});

// A tiny stand-in for Firestore: enough for bol.js.
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

test('the email check reads each BOL under the label once, and a newer one for the same day takes its place', async () => {
  const db = fakeDb();
  await B.OPS.bolSaveSettings(db, 'pat.admin@uniteddairy.com', { mailbox: 'pat.sample@uniteddairy.com', enabled: true }, '2026-11-09T12:00:00Z');
  assert.equal(db.store['config/bolMail'].label, 'ROUTES/BOL');
  const later = bolPdf(SAMPLE.concat([['11/09/2026', '808', '0', '10', '51', 'MADEUP FOODS #51', '206', 'UD HVD 96 OZ', '1']]), 60);
  const mail = [
    { id: 'm1', internalDate: Date.parse('2026-11-09T16:00:00Z'), subject: 'Daily Load By Route', files: [{ name: 'Daily Load UT.pdf', attachmentId: 'a1', size: 100 }] },
    { id: 'm2', internalDate: Date.parse('2026-11-09T20:00:00Z'), subject: 'Daily Load By Route', files: [{ name: 'Daily Load UT.pdf', attachmentId: 'a2', size: 100 }, { name: 'logo.png', attachmentId: 'a3', size: 10 }] }
  ];
  const asked = [];
  const deps = {
    now: () => new Date('2026-11-09T21:15:00Z'),
    readMail: async (q) => { asked.push(q); return mail; },
    readAttachment: async ({ attachmentId }) => attachmentId === 'a1' ? samplePdf() : later
  };
  const run = await B.hourlyCheck(db, deps);
  assert.equal(asked[0].owner, 'pat.sample@uniteddairy.com');
  // The label OR the office's subject: the office's email comes in with no label (11-7-26 to 11-11-26 were missed).
  assert.equal(asked[0].query, '{label:routes-bol subject:"daily load data"} has:attachment newer_than:10d -in:sent');
  assert.equal(run.status, 'OK');
  assert.equal(run.read, 2);
  assert.match(run.message, /load day 11-9-26, 3 routes/);
  const day = db.store['bolDays/2026-11-09'];
  assert.equal(day.source, 'EMAIL');
  assert.equal(day.received, '2026-11-09T20:00:00.000Z');
  assert.deepEqual(day.routes.map(r => r.route), ['805', '808', '6301']);
  const again = await B.hourlyCheck(db, deps);
  assert.equal(again.skipped, 2);
  assert.equal(again.message, 'No new BOL.');
  const st = await B.OPS.bolStatus(db, 'pat.admin@uniteddairy.com', {});
  assert.equal(st.open.date, '2026-11-09');
  assert.equal(st.open.routes[0].stops[0].name, 'MADEUP GOLF CENTER');
});

test('a file with no BOL lines under the label is red and says the label looks wrong (Joe 11-8-26)', async () => {
  const db = fakeDb();
  await B.OPS.bolSaveSettings(db, 'pat.admin@uniteddairy.com', { mailbox: 'pat.sample@uniteddairy.com', label: 'ROUTES/SALE BY ROUTE', enabled: true }, '2026-11-08T12:00:00Z');
  const deps = { now: () => new Date('2026-11-08T18:16:00Z'),
    readMail: async () => [{ id: 'w1', internalDate: Date.parse('2026-11-04T17:20:00Z'), subject: 'Weekly Daily Avg Cases by Route By Store', files: [{ name: 'Weekly Daily Avg Cases.pdf', attachmentId: 'b1', size: 100 }] }],
    readAttachment: async () => Buffer.from('%PDF-1.4') };
  const run = await B.hourlyCheck(db, deps);
  assert.equal(run.status, 'FAIL', 'red, not green');
  assert.equal(run.message, 'Read Weekly Daily Avg Cases.pdf, but it has no BOL lines: it looks like the weekly route report, not the Daily BOL. Check the email label: the Daily BOL\'s label is ROUTES/BOL.');
  assert.equal(B.notBolText('Other.pdf', 'ROUTES/OTHER'), 'Read Other.pdf, but it has no BOL lines. Check the email label: the Daily BOL\'s label is ROUTES/BOL.');
});

test('the check stays off until it is switched on, and a file added by hand is read the same', async () => {
  const db = fakeDb();
  assert.deepEqual(await B.hourlyCheck(db, { readMail: async () => { throw new Error('should not be read'); } }), { skipped: 'off' });
  const out = await B.OPS.bolUpload(db, 'pat.admin@uniteddairy.com', { fileName: 'Daily Load UT.pdf', base64: samplePdf().toString('base64') }, '2026-11-09T12:00:00Z');
  assert.deepEqual(out.saved, [{ date: '2026-11-09', label: '11-9-26', routes: 2, stops: 3 }]);
  assert.equal(db.store['bolDays/2026-11-09'].source, 'BY HAND');
  await assert.rejects(B.OPS.bolUpload(db, 'pat.admin@uniteddairy.com', { fileName: 'other.pdf', base64: Buffer.from('%PDF-1.4').toString('base64') }, '2026-11-09T12:00:00Z'), /No BOL lines were found/);
});

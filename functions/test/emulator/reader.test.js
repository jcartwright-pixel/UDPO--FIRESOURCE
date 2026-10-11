'use strict';
// Plant Production's label reader (Joe 10/11: the Gallon Filler reads each jug's UPC and code date): the line PC's reads count
// on the line's shift, find the product by UPC, check the date, end a stop; a quiet line stops; the key and the test feed are
// an administrator's; the test feed runs on the sandbox only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const { applyAction } = require('../../src/actions');
const D = require('../../src/demo-sheets');
const PD = require('../fixtures/plant-demo');
const P = require('../../src/production-rules');
const RD = require('../../src/reader');

const ADMIN = 'admin.test@uniteddairy.com', MANAGER = 'manager.test@uniteddairy.com';
const LINE = 'ut_prod_gallon_filler';
// 11:00 a.m. in Uniontown: First Shift (6:00 to 2:30).
const T0 = Date.parse('2026-10-08T15:00:00Z');
const at = (min) => () => new Date(T0 + min * 60000);
const KEY = '2026-10-08_first_shift';
const run = async () => (await db().collection('productionRuns').doc(P.runId(LINE, KEY)).get()).data();
let n = 0;
const save = (action, fields, email) => applyAction(db(), { email: email || MANAGER }, Object.assign({ action, requestId: 'reader-' + (++n) + '-' + Date.now() }, fields));
const PRODUCTS = [
  { name: 'Broughton 2% Gallon', sku: '50305', mfgType: 'GALLON', upc: '070852503050', shelfLifeDays: 17, ratePerMin: 74, targetPct: 57.3 },
  { name: 'Broughton HVD Gallon', sku: '50205', mfgType: 'GALLON', upc: '070852502053', shelfLifeDays: 17, ratePerMin: 74, targetPct: 54.77 }
];

test.beforeEach(async () => {
  await clear();
  await runTransfer({ db: db(), reader: D.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date(T0) });
  await save('saveMachineProducts', { operationId: LINE, products: PRODUCTS });
});

test('The plant clock: the server works out the same shift as the tablet in Uniontown', () => {
  const s = RD.plantShift(null, T0);
  assert.equal(s.key, KEY);
  assert.equal(s.start, '2026-10-08T10:00:00.000Z');
  assert.equal(RD.plantShift(null, Date.parse('2026-10-09T01:00:00Z')).key, '2026-10-08_second_shift');
  assert.equal(RD.dateOf('10/25'), 'OCT 25');
  assert.equal(RD.dateOf('oct 5 2026'), 'OCT 05');
});

test('Reads count only on a Label reader line; jugs count, the UPC picks the product, the date is checked', async () => {
  await assert.rejects(RD.applyReads(db(), LINE, [{ upc: '070852503050', date: 'OCT 25' }], { now: at(0) }), /not counted by a label reader/);
  await save('saveLineCounter', { operationId: LINE, counter: 'READER' });
  // OCT 08 + 17 days = OCT 25.
  await RD.applyReads(db(), LINE, [{ upc: '070852503050', date: 'OCT 25' }, { upc: '070852503050', date: '10/25' }, { upc: '070852503050', date: '' }, { upc: '' }], { now: at(0) });
  let r = await run();
  assert.equal(r.count, 4);
  assert.equal(r.product, 'Broughton 2% Gallon');
  assert.equal(r.runs.length, 1);
  assert.equal(r.runs[0].by, 'label reader');
  assert.equal(r.reader.read, 3);
  assert.equal(r.reader.unreadable, 1);
  assert.equal(r.reader.missing, 1);
  assert.equal(r.reader.dateOk, false, 'the last jug read had no date');
  await RD.applyReads(db(), LINE, [{ upc: '070852502053', date: 'OCT 24' }, { upc: '999999999999', date: 'OCT 25' }, { upc: '070852502053', date: 'OCT 25' }], { now: at(1) });
  r = await run();
  assert.equal(r.count, 7);
  assert.equal(r.product, 'Broughton HVD Gallon', 'a new UPC starts a new product run');
  assert.equal(r.runs.length, 2);
  assert.equal(r.reader.wrong, 1);
  assert.equal(r.reader.unknown, 1);
  assert.equal(r.reader.dateOk, true);
  assert.equal(r.counts.length, 2);
  // The tablet's view of it: speed from the reader's counts.
  const v = P.lineNow(r, P.targetsFor(PRODUCTS), T0 + 61000);
  assert.equal(v.made, 7);
  assert.equal(v.speed, 3);
});

test('A quiet reader line stops after 3 minutes; jugs moving again end the stop; the operator picks why', async () => {
  await save('saveLineCounter', { operationId: LINE, counter: 'READER' });
  await RD.applyReads(db(), LINE, [{ upc: '070852503050', date: 'OCT 25' }], { now: at(0) });
  await RD.readerMinute(db(), { now: at(2), project: 'ud-distribution' });
  assert.equal((await run()).stops.length, 0, 'two quiet minutes is not a stop');
  await RD.readerMinute(db(), { now: at(3), project: 'ud-distribution' });
  let r = await run();
  assert.equal(r.stops.length, 1);
  assert.equal(r.stops[0].start, new Date(T0).toISOString(), 'the stop starts at the last jug');
  assert.equal(r.stops[0].end, null);
  await RD.readerMinute(db(), { now: at(4), project: 'ud-distribution' });
  assert.equal((await run()).stops.length, 1, 'one stop, not one a minute');
  await RD.applyReads(db(), LINE, [{ upc: '070852503050', date: 'OCT 25' }], { now: at(9) });
  r = await run();
  assert.equal(r.stops[0].end, new Date(T0 + 9 * 60000).toISOString());
  assert.equal(P.lineNow(r, P.targetsFor(PRODUCTS), T0 + 9 * 60000).needReason.length, 1, 'the tablet asks why');
  await save('saveLineEntry', { operationId: LINE, op: 'reason', reason: 'Filler jam', stopIndex: 0, shift: RD.plantShift(null, T0) });
  assert.equal((await run()).stops[0].reason, 'Filler jam');
});

test('The line PC needs the line key; only an administrator makes it; the old key stops working', async () => {
  await save('saveLineCounter', { operationId: LINE, counter: 'READER' });
  await assert.rejects(RD.readerCall(db(), { email: MANAGER }, { op: 'makeKey', operationId: LINE }), /Only an administrator/);
  const first = await RD.readerCall(db(), { email: ADMIN }, { op: 'makeKey', operationId: LINE }, { key: () => 'key-one-1234567890' });
  assert.equal(first.key, 'key-one-1234567890');
  const keys = (await db().collection('private').doc('lineReaders').get()).data();
  assert.equal(keys[LINE].hash, RD.hash('key-one-1234567890'), 'only the hash is kept');
  const body = { line: LINE, reads: [{ upc: '070852503050', date: 'OCT 25' }] };
  assert.equal((await RD.handleReads(db(), {}, body))[0], 401);
  assert.equal((await RD.handleReads(db(), { authorization: 'Bearer wrong' }, body))[0], 403);
  const ok = await RD.handleReads(db(), { authorization: 'Bearer key-one-1234567890' }, body, { now: at(0) });
  assert.equal(ok[0], 200);
  assert.equal(ok[1].count, 1);
  await RD.readerCall(db(), { email: ADMIN }, { op: 'makeKey', operationId: LINE }, { key: () => 'key-two-1234567890' });
  assert.equal((await RD.handleReads(db(), { authorization: 'Bearer key-one-1234567890' }, body))[0], 403, 'the old key stops working');
  assert.equal((await RD.handleReads(db(), { authorization: 'Bearer key-two-1234567890' }, { line: 'ut_prod_totes', reads: body.reads }))[0], 403, 'a key is for its own line');
});

test('The test feed: sandbox only, an administrator\'s, pretend jugs every minute with a pause that stops the line', async () => {
  await save('saveLineCounter', { operationId: LINE, counter: 'READER' });
  const products = PRODUCTS.map(p => ({ name: p.name, upc: p.upc }));
  await assert.rejects(RD.readerCall(db(), { email: ADMIN }, { op: 'startTest', operationId: LINE, products }, { project: 'ud-distribution', now: at(0) }), /sandbox only/);
  await assert.rejects(RD.readerCall(db(), { email: MANAGER }, { op: 'startTest', operationId: LINE, products }, { project: 'ud-distribution-sandbox', now: at(0) }), /Only an administrator/);
  await RD.readerCall(db(), { email: ADMIN }, { op: 'startTest', operationId: LINE, products, minutes: 60 }, { project: 'ud-distribution-sandbox', now: at(0) });
  for (let m = 0; m < 3; m++) await RD.readerMinute(db(), { now: at(m), project: 'ud-distribution-sandbox' });
  let r = await run();
  assert.ok(r.count > 200 && r.count < 260, 'about 74 a minute: ' + r.count);
  assert.equal(r.product, 'Broughton 2% Gallon');
  assert.ok(r.reader.missing >= 1, 'a missing date now and then');
  assert.ok(r.reader.unreadable >= 1);
  // Minutes 26 to 29 of each half hour are quiet: the line stops on its own, then runs again.
  for (let m = 3; m < 31; m++) await RD.readerMinute(db(), { now: at(m), project: 'ud-distribution-sandbox' });
  r = await run();
  assert.equal(r.stops.length, 1);
  assert.ok(r.stops[0].end, 'jugs again at minute 30 end the stop');
  assert.equal(r.product, 'Broughton HVD Gallon', 'a product change every 20 minutes');
  // Production never runs the feed, even with one saved.
  const before = (await run()).count;
  await RD.readerMinute(db(), { now: at(31), project: 'ud-distribution' });
  assert.equal((await run()).count, before);
  await RD.readerCall(db(), { email: ADMIN }, { op: 'stopTest', operationId: LINE }, { project: 'ud-distribution-sandbox', now: at(32) });
  await RD.readerMinute(db(), { now: at(32), project: 'ud-distribution-sandbox' });
  assert.equal((await run()).count, before);
});

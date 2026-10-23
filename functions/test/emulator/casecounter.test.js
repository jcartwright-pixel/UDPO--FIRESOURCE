'use strict';
// Case counters (Joe 10/22, the case counter hookup guide; Joe 10/23: "the cases need to be put in prior to loading. And then
// the case counter counts and does a comparison"): the plant PC sends the counter box's running total with the counter's key;
// the new cases go on the Case load being loaded (Palletizer) or the trailer being unloaded (Case Returns), kept on their own so
// Cases Out and Cases In stay as typed. Setup and keys are an administrator's.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const { applyAction } = require('../../src/actions');
const D = require('../../src/demo-sheets');
const PD = require('../fixtures/plant-demo');
const RD = require('../../src/reader');
const CC = require('../../src/casecounter');

const ADMIN = { email: 'admin.test@uniteddairy.com' }, MANAGER = { email: 'manager.test@uniteddairy.com' }, DISPATCHER = { email: 'dispatch.test@uniteddairy.com' };
const DATE = PD.PLANT_DATE;
// 12:00 noon at the plant on the made-up plant day: 808 is loading (and 6303 from yesterday), 805's trailer is being unloaded.
const tick = () => new Date('2026-10-08T16:00:00Z');
let n = 0;
const rid = () => 'cc-' + (++n) + '-' + Date.now();
const admin = (fields, user) => RD.readerAll(db(), user || ADMIN, fields, { now: tick, key: () => 'counter-key-' + fields.counter });
const send = (key, body) => RD.handleReads(db(), { authorization: 'Bearer ' + key }, body, { now: tick });
const counts = async () => Object.fromEntries((await db().collection('caseCounts').get()).docs.map(d => [d.id, d.data()]));
const counter = async (id) => (await db().collection('caseCounters').doc(id).get()).data();
const L808 = 'LOAD_2026-10-04__run_p808_fri';

test.beforeEach(async () => {
  await clear();
  await runTransfer({ db: db(), reader: D.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: tick });
});

async function setUp(id) {
  const made = await admin({ counter: id, op: 'makeKey' });
  for (const [field, value] of [['brand', 'MODBUS'], ['ip', '192.168.1.40'], ['countTag', '40001']]) await admin({ counter: id, op: 'saveCounter', field, value });
  return made.key;
}

test('Setup: administrators only; each box checked; the key works only for its counter; the plant PC gets the setup', async () => {
  await assert.rejects(admin({ counter: 'palletizer', op: 'makeKey' }, MANAGER), /Only an administrator/);
  await assert.rejects(admin({ counter: 'stacker', op: 'makeKey' }), /Pick the Palletizer or the Case Returns counter/);
  const key = await setUp('palletizer');
  await assert.rejects(admin({ counter: 'palletizer', op: 'saveCounter', field: 'ip', value: '192.168.1.300' }), /IP address/);
  assert.equal((await counter('palletizer')).controller.ip, '192.168.1.40', 'the wrong address was not saved');
  const [status, body] = await send(key, { device: 'palletizer', op: 'config' });
  assert.equal(status, 200);
  assert.deepEqual(body.config, { brand: 'MODBUS', ip: '192.168.1.40', port: null, slot: null, rack: null, unit: null, wordOrder: 'HIGH_FIRST', readings: { count: { tag: '40001', size: 32 } } });
  assert.equal((await send(key, { device: 'case_returns', op: 'config' }))[0], 403, 'the Palletizer key is not the Case Returns key');
  assert.equal((await send('wrong', { device: 'palletizer', op: 'config' }))[0], 403);
  const listed = await admin({ op: 'counters' });
  assert.deepEqual(listed.counters.map(c => [c.id, c.name, !!c.keyAt]), [['palletizer', 'Palletizer', true], ['case_returns', 'Case Returns', false]]);
  // Test read: asked from Administration, answered by the plant PC with its next call.
  await admin({ counter: 'palletizer', op: 'testRead' });
  const asked = await send(key, { device: 'palletizer', op: 'config' });
  assert.equal(asked[1].testAsk.reading, 'count');
  await send(key, { device: 'palletizer', test: { askAt: asked[1].testAsk.at, value: 1284 } });
  assert.equal((await counter('palletizer')).controller.testResult.value, 1284);
});

test('Palletizer: the new cases go on the Case load loading now, never on Cases Out; a reset box counts from zero', async () => {
  const key = await setUp('palletizer');
  const before = (await db().collection('runs').doc('2026-10-04__run_p808').get()).data().days.fri.casesOut;
  // The first reading only sets where the box's total is.
  await send(key, { device: 'palletizer', controller: { count: 90000 } });
  assert.deepEqual(await counts(), {});
  const [status, body] = await send(key, { device: 'palletizer', controller: { count: 90036 } });
  assert.equal(status, 200);
  assert.equal(body.counted, 36);
  let c = (await counts())[L808];
  assert.equal(c.counted, 36, 'on 808, the load started last (6303 from yesterday is loading too)');
  assert.equal(c.date, DATE);
  assert.equal(c.kind, 'LOAD');
  assert.equal(c.runDocId + '|' + c.day, '2026-10-04__run_p808|fri');
  await send(key, { device: 'palletizer', controller: { count: 90036 } });
  await send(key, { device: 'palletizer', controller: { count: 90100 } });
  // The counter box was reset: 6 is six new cases. A jump of thousands is a new box or a wrong register, not cases.
  await send(key, { device: 'palletizer', controller: { count: 6 } });
  await send(key, { device: 'palletizer', controller: { count: 9006 } });
  c = (await counts())[L808];
  assert.equal(c.counted, 36 + 64 + 6);
  assert.equal((await db().collection('runs').doc('2026-10-04__run_p808').get()).data().days.fri.casesOut, before, 'Cases Out stays what was typed');
  assert.equal((await counter('palletizer')).last.value, 9006);
});

test('Palletizer: with nothing loading the cases are kept for the day, not put on a load', async () => {
  const key = await setUp('palletizer');
  for (const [runDocId, day] of [['2026-10-04__run_p808', 'fri'], ['2026-10-04__run_p6303', 'thu']]) {
    await applyAction(db(), DISPATCHER, { action: 'savePlantLoad', requestId: rid(), runDocId, day, fields: { status: 'COMPLETE' } }, tick);
  }
  await send(key, { device: 'palletizer', controller: { count: 100 } });
  await send(key, { device: 'palletizer', controller: { count: 112 } });
  assert.deepEqual(await counts(), {});
  assert.deepEqual((await counter('palletizer')).noLoad, { date: DATE, cases: 12, at: tick().toISOString() });
});

test('Case Returns: the new cases go on the trailer being unloaded, never on Cases In', async () => {
  const key = await setUp('case_returns');
  await send(key, { device: 'case_returns', controller: { count: 500 } });
  await send(key, { device: 'case_returns', controller: { count: 523 } });
  const c = (await counts())['UNLOAD_' + DATE + '_805_UT_DSD_MILK'];
  assert.equal(c.counted, 23);
  assert.equal(c.kind, 'UNLOAD');
  assert.equal(c.unloadKey, DATE + '|805|UT DSD MILK');
  assert.equal(c.date, DATE);
  const u805 = (await db().collection('plantJournal').where('date', '==', DATE).get()).docs.map(d => d.data()).filter(d => d.route === '805' && d.type === 'UNLOADING');
  assert.ok(u805.every(d => !d.quantity), 'Cases In stays blank until someone types it');
});

test('The screens compare: counting, matches, short, over', () => {
  const R = require('../../src/plant-rules');
  assert.deepEqual(R.caseCompare(612, 486, 'RUNNING'), { kind: 'run', counted: 486, number: '486 of 612', word: 'counting', off: 0 });
  assert.equal(R.caseCompare(612, 620, 'RUNNING').word, 'over 8');
  assert.equal(R.caseCompare('', 40, 'RUNNING').number, '40');
  assert.equal(R.caseCompare(612, 612, 'DONE').word, 'matches');
  assert.equal(R.caseCompare('588', 576, 'DONE').word, 'short 12');
  assert.equal(R.caseCompare('1,000', 1003, 'DONE').word, 'over 3');
  assert.equal(R.caseCompare(612, null, 'DONE'), null);
  assert.equal(R.caseCompare('', 40, 'DONE').kind, 'plain');
  assert.equal(CC.configOut({ brand: 'MODBUS' }), null, 'no setup without an IP address');
});

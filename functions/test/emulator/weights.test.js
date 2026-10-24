'use strict';
// One weight record (Joe 10/14): the Blow Mold's heads and a filler's filled jugs are the same check on the line tablet and the
// Quality screen; the fill weight check's math against the product's Target Fill Weight g; the Gallon Filler's add-on sensors
// (Joe's pick B: the motor current switch and a second photo-eye on the infeed), read-only through the line PC.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const { applyAction } = require('../../src/actions');
const D = require('../../src/demo-sheets');
const PD = require('../fixtures/plant-demo');
const P = require('../../src/production-rules');
const RD = require('../../src/reader');

const MANAGER = 'manager.test@uniteddairy.com', ADMIN = 'admin.test@uniteddairy.com';
const BLOW = 'ut_prod_blow_mold', GALLON = 'ut_prod_gallon_filler', HALF = 'ut_prod_new_half_gallon';
// 11:00 a.m. in Uniontown: First Shift.
const T0 = Date.parse('2026-10-08T15:00:00Z');
const at = (min) => () => new Date(T0 + min * 60000);
const SHIFT = RD.plantShift(null, T0);
let n = 0;
const save = (action, fields, min, email) => applyAction(db(), { email: email || MANAGER }, Object.assign({ action, requestId: 'weights-' + (++n) + '-' + Date.now() }, fields), at(min || 0));
const entry = (operationId, fields, min) => save('saveLineEntry', Object.assign({ operationId, shift: SHIFT }, fields), min);
const runOf = async (id) => (await db().collection('productionRuns').doc(P.runId(id, SHIFT.key)).get()).data();
const lineDoc = async (id) => (await db().collection('productionLines').doc(id).get()).data() || {};
const quality = async (id) => (await db().collection('plantJournal').where('type', '==', 'PRODUCTION_QUALITY').get()).docs.map(d => Object.assign({ _id: d.id }, d.data())).filter(d => d.payload.operationId === id);

test.beforeEach(async () => {
  await clear();
  await runTransfer({ db: db(), reader: D.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date(T0) });
  // The demo plant has no half gallon filler: NEW 1/2 GALLON, as Plant Operations keeps it.
  await db().collection('plantSetup').doc(HALF).set({ operationId: HALF, type: 'PRODUCTION_AREA', status: 'ACTIVE', name: 'NEW 1/2 GALLON', area: 'NEW 1/2 GALLON', facilityId: 'fac_uniontown', viewSequence: 60 });
  await save('saveMachineProducts', { operationId: BLOW, products: [{ name: 'Gallon Jug', sku: 'Gallon Jug', ratePerMin: 50 }] });
  await save('saveMachineProducts', { operationId: GALLON, products: [{ name: 'Broughton 2% Gallon', sku: '50305', upc: '070852503050', fillGrams: 3800, ratePerMin: 74 }, { name: 'Broughton Skim Gallon', sku: '50105', ratePerMin: 74 }] });
  await save('saveMachineProducts', { operationId: HALF, products: [{ name: 'Broughton 2% Half Gallon', sku: '40305', fillGrams: 1900, ratePerMin: 100 }] });
});

test('Blow Mold heads typed on the station are the Quality screen\'s Blow Mold check, and the other way', async () => {
  for (const [k, v] of [['head1', '57'], ['head2', '58']]) await entry(BLOW, { op: 'check', slot: 2, field: k, value: v }, 1);
  let q = await quality(BLOW);
  assert.equal(q.length, 1, 'one Quality check for the slot');
  assert.deepEqual(q[0].payload.weights, { head1: '57', head2: '58' });
  assert.equal(q[0].payload.status, 'RUNNING');
  assert.equal(q[0].payload.fromLine, true);
  let r = await runOf(BLOW);
  assert.equal(r.checks['2'].qualityId, q[0]._id);
  assert.deepEqual((await lineDoc(BLOW)).headsLast, { avg: 57.5, at: new Date(T0 + 60000).toISOString(), heads: { head1: '57', head2: '58' } });
  // The Quality screen fills in the same check (its form starts from it): heads 3 to 6 go on the station's slot too.
  await save('saveQualityCheck', { operationId: BLOW, product: 'Gallon Jug', status: 'RUNNING', annealerSpeed: '70', checkId: q[0]._id, weights: { head1: '57', head2: '58', head3: '56', head4: '57', head5: '57', head6: '59' } }, 2);
  q = await quality(BLOW);
  assert.equal(q.length, 1, 'still one Quality check');
  r = await runOf(BLOW);
  assert.deepEqual([r.checks['2'].head3, r.checks['2'].head6, r.checks['2'].qualityId], ['56', '59', q[0]._id]);
  assert.equal((await lineDoc(BLOW)).headsLast.avg, 57.3);
  // A head cleared on the Quality screen is cleared on the station.
  await save('saveQualityCheck', { operationId: BLOW, product: 'Gallon Jug', status: 'RUNNING', checkId: q[0]._id, weights: { head1: '57', head2: '58', head3: '56', head4: '57', head5: '57', head6: '' } }, 3);
  assert.equal((await runOf(BLOW)).checks['2'].head6, undefined);
  // A Blow Mold check started on the Quality screen this slot: the station's heads go on it.
  await save('saveLineEntry', { operationId: BLOW, op: 'check', slot: 2, field: 'head5', value: '60', shift: SHIFT }, 4);
  assert.equal((await quality(BLOW))[0].payload.weights.head5, '60');
});

test('A Blow Mold check typed only on the Quality screen goes on the station\'s check due now', async () => {
  // 11:00 a.m. is the sixth hourly check of the shift (6:00 start; Joe 10/23: every hour): slot 5.
  const q = await save('saveQualityCheck', { operationId: BLOW, product: 'Gallon Jug', status: 'REVIEW', weights: { head1: '55', head2: '56' } }, 0);
  const r = await runOf(BLOW);
  assert.deepEqual([r.checks['5'].head1, r.checks['5'].head2, r.checks['5'].qualityId], ['55', '56', q.checkId]);
  // The station's next head keeps the Quality screen's status (Review), on the same check.
  await entry(BLOW, { op: 'check', slot: 5, field: 'head3', value: '57' }, 1);
  const all = await quality(BLOW);
  assert.equal(all.length, 1);
  assert.equal(all[0].payload.status, 'REVIEW');
  assert.equal(all[0].payload.weights.head3, '57');
});

test('Fill weight check: product = filled - Blow Mold heads average - cap, against the product target; the Quality screen sees the jugs', async () => {
  await save('saveLineSetup', { operationId: GALLON, capGrams: '3', tareGrams: '60', fillUnder: '5', fillOver: '15' });
  await save('saveQualityCheck', { operationId: BLOW, product: 'Gallon Jug', status: 'RUNNING', weights: { head1: '57', head2: '57', head3: '57', head4: '57', head5: '57', head6: '57' } }, 0);
  await entry(GALLON, { op: 'product', product: 'Broughton 2% Gallon', sku: '50305' }, 1);
  await entry(GALLON, { op: 'fill', field: 'jug1', value: '3870', index: null }, 2);
  for (const [k, v] of [['jug2', '3852'], ['jug3', '3880']]) await entry(GALLON, { op: 'fill', field: k, value: v, index: 0 }, 3);
  let r = await runOf(GALLON);
  assert.equal(r.fills.length, 1);
  assert.deepEqual([r.fills[0].tare, r.fills[0].tareFrom, r.fills[0].cap, r.fills[0].target, r.fills[0].product], [57, 'BLOWMOLD', 3, 3800, 'Broughton 2% Gallon']);
  const f = P.fillOf(r.fills[0]);
  assert.deepEqual(f.jugs.slice(0, 3).map(j => [j.net, j.flag]), [[3810, ''], [3792, 'LIGHT'], [3820, 'HEAVY']]);
  const q = await quality(GALLON);
  assert.equal(q.length, 1);
  assert.equal(q[0].payload.weights.result, '3870, 3852, 3880 g');
  assert.equal(r.fills[0].qualityId, q[0]._id);
  // The Quality screen fixes a jug on the same check: the tablet's check has it.
  await save('saveQualityCheck', { operationId: GALLON, product: 'Broughton 2% Gallon', status: 'RUNNING', checkId: q[0]._id, weights: { result: '3870, 3862, 3880, 3866 g' } }, 4);
  r = await runOf(GALLON);
  assert.deepEqual([r.fills[0].jug2, r.fills[0].jug4, r.fills.length], [3862, 3866, 1]);
  // Pounds typed on the Quality screen are not jugs in grams: the tablet's check is left alone.
  await save('saveQualityCheck', { operationId: GALLON, product: 'Broughton 2% Gallon', status: 'RUNNING', weights: { result: '8.6' } }, 200);
  assert.equal((await runOf(GALLON)).fills.length, 1);
  // A product with no Target Fill Weight g: the check keeps no target ("set target").
  await entry(GALLON, { op: 'product', product: 'Broughton Skim Gallon', sku: '50105' }, 210);
  await entry(GALLON, { op: 'fill', field: 'jug1', value: '3850', index: null }, 211);
  r = await runOf(GALLON);
  assert.deepEqual([r.fills[1].target, r.fills[1].tareFrom], [null, 'BLOWMOLD']);
  await assert.rejects(entry(GALLON, { op: 'fill', field: 'jug9', value: '3850', index: 1 }, 212), /Pick which jug/);
  await assert.rejects(entry(GALLON, { op: 'fill', field: 'jug2', value: 'heavy', index: 1 }, 212), /grams/);
  await assert.rejects(entry(GALLON, { op: 'fill', field: 'jug2', value: '3850', index: 7 }, 212), /not on this shift/);
});

test('Fill weight check on a half gallon filler: the empty weight typed on Line Targets, and how often it is due', async () => {
  await save('saveLineSetup', { operationId: HALF, tareGrams: '38', capGrams: '2', fillEvery: 'JUGS', fillEveryN: '2000' });
  await save('saveQualityCheck', { operationId: BLOW, product: 'Gallon Jug', status: 'RUNNING', weights: { head1: '57' } }, 0);
  await entry(HALF, { op: 'product', product: 'Broughton 2% Half Gallon' }, 1);
  await entry(HALF, { op: 'fill', field: 'jug1', value: '1945', index: null }, 2);
  const r = await runOf(HALF), ld = await lineDoc(HALF);
  assert.deepEqual([r.fills[0].tare, r.fills[0].tareFrom, r.fills[0].target], [38, 'TYPED', 1900], 'not the Blow Mold\'s gallon jugs');
  assert.deepEqual([ld.fillEvery, ld.fillEveryN], ['JUGS', 2000]);
  assert.equal(P.fillOf(r.fills[0]).jugs[0].net, 1905);
  await assert.rejects(save('saveLineSetup', { operationId: HALF, fillEvery: 'HOURLY' }), /how often/);
});

test('Gallon Filler add-on sensors (B): the motor switch stops and starts the line; jugs in less jugs counted are the rejects', async () => {
  // The Gallon Filler is counted by its label reader; the I/O module is read on the side, read-only.
  await save('saveLineCounter', { operationId: GALLON, counter: 'READER' });
  for (const [field, value] of [['brand', 'MODBUS'], ['ip', '192.168.10.60'], ['runningTag', '10001'], ['infeedTag', '30001']]) await RD.readerCall(db(), { email: ADMIN }, { op: 'saveController', operationId: GALLON, field, value }, { now: at(0) });
  const cfg = RD.configOut((await lineDoc(GALLON)).controller);
  assert.deepEqual(cfg.readings, { running: { tag: '10001', size: 16 }, infeed: { tag: '30001', size: 32 } });
  await RD.applyMachine(db(), GALLON, { running: 1, infeed: 5000 }, { now: at(0) });
  await RD.applyReads(db(), GALLON, Array.from({ length: 100 }, () => ({ upc: '070852503050' })), { now: at(1) });
  await RD.applyMachine(db(), GALLON, { running: 1, infeed: 5104 }, { now: at(1) });
  let r = await runOf(GALLON), m = P.machineNow(r, await lineDoc(GALLON), T0 + 60000, 'FILLER');
  assert.deepEqual([m.running, m.infeed, m.rejects, r.count], [true, 104, 4, 100], 'jugs in counted from the first reading; 104 in, 100 out');
  assert.equal(r.stops.length, 0);
  await RD.applyMachine(db(), GALLON, { running: 0, infeed: 5104 }, { now: at(2) });
  r = await runOf(GALLON);
  assert.deepEqual([r.stops.length, r.stops[0].start, r.stops[0].by, r.machine.running], [1, new Date(T0 + 120000).toISOString(), RD.BY_SWITCH, false]);
  await RD.applyMachine(db(), GALLON, { running: 0 }, { now: at(3) });
  assert.equal((await runOf(GALLON)).stops.length, 1, 'one stop while the motor is off');
  await RD.applyMachine(db(), GALLON, { running: 1 }, { now: at(6) });
  r = await runOf(GALLON);
  assert.equal(r.stops[0].end, new Date(T0 + 360000).toISOString(), 'the motor running again ends its stop');
  assert.equal(r.machine.runningSince, new Date(T0 + 360000).toISOString());
  assert.equal(r.count, 100, 'the I/O module never counts jugs on a label reader line');
});

test('5-gallon bag fillers: bags weighed in grams against the target; Boxing\'s are the Quality check, Raypak\'s (no package weight there) stay on the tablet', async () => {
  const RAYPAK = 'ut_prod_raypak', BOXING = 'ut_prod_boxing', TOTES = 'ut_prod_totes';
  await db().collection('plantSetup').doc(RAYPAK).set({ operationId: RAYPAK, type: 'PRODUCTION_AREA', status: 'ACTIVE', name: 'RAYPAK', area: 'RAYPAK', facilityId: 'fac_uniontown', viewSequence: 15 });
  for (const id of [RAYPAK, BOXING]) {
    await save('saveMachineProducts', { operationId: id, products: [{ name: '5 Gal 2% Dispenser', sku: '90305', fillGrams: 19500, ratePerMin: 10 }] });
    await save('saveLineSetup', { operationId: id, tareGrams: '450', capGrams: '20', fillUnder: '50' });
    await entry(id, { op: 'product', product: '5 Gal 2% Dispenser', sku: '90305' }, 1);
    await entry(id, { op: 'fill', field: 'jug1', value: '19950', index: null }, 2);
    await entry(id, { op: 'fill', field: 'jug2', value: '19900', index: 0 }, 3);
    const f = P.fillOf((await runOf(id)).fills[0]);
    assert.deepEqual([f.jugs[0].net, f.jugs[0].diff, f.jugs[1].net, f.jugs[1].flag], [19480, -20, 19430, 'LIGHT'], id + ': bag - empty bag - fitment against 19,500 g');
  }
  assert.equal((await quality(RAYPAK)).length, 0, 'Raypak\'s Quality check has no package weight: nothing written there');
  assert.equal((await runOf(RAYPAK)).fills[0].qualityId, undefined);
  const q = await quality(BOXING);
  assert.equal(q.length, 1);
  assert.equal(q[0].payload.weights.result, '19950, 19900 g');
  // Totes have no fill weight check.
  await assert.rejects(entry(TOTES, { op: 'fill', field: 'jug1', value: '19950', index: null }, 4), /has no fill weight check/);
  // A bag over 20 kg is still a weight (up to 30 kg).
  await entry(BOXING, { op: 'fill', field: 'jug3', value: '20400', index: 0 }, 5);
  assert.equal((await runOf(BOXING)).fills[0].jug3, 20400);
});

test('Fed by: a packing line keeps the fillers that feed it and the jugs in each box', async () => {
  await save('saveLineSetup', { operationId: 'ut_prod_boxing', fedBy: [GALLON, HALF, GALLON], perBox: '4' });
  const d = await lineDoc('ut_prod_boxing');
  assert.deepEqual([d.fedBy, d.perBox], [[GALLON, HALF], 4]);
  await assert.rejects(save('saveLineSetup', { operationId: 'ut_prod_boxing', fedBy: ['ut_prod_boxing'] }), /cannot feed itself/);
  await assert.rejects(save('saveLineSetup', { operationId: 'ut_prod_boxing', fedBy: 'x' }), /up to 12 lines/);
  await save('saveLineSetup', { operationId: 'ut_prod_boxing', fedBy: [] });
  assert.deepEqual((await lineDoc('ut_prod_boxing')).fedBy, []);
});

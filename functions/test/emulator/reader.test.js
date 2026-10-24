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
  const keys = (await db().collection('private').doc('readDevices').get()).data();
  assert.equal(keys[LINE].hash, RD.hash('key-one-1234567890'), 'only the hash is kept');
  // Joe 10/11, room to grow: every device is tagged by plant, area and what it reads, so a Receiving scanner plugs in later.
  assert.deepEqual([keys[LINE].facilityId, keys[LINE].area, keys[LINE].kind, keys[LINE].reads, keys[LINE].target], ['fac_uniontown', 'PRODUCTION', 'LINE_READER', 'UPC_DATE', LINE]);
  await db().collection('private').doc('readDevices').set({ ut_recv_dock: { hash: RD.hash('dock-key-1234567890'), area: 'RECEIVING', kind: 'HANDHELD', reads: 'UPC', facilityId: 'fac_uniontown', target: 'ut_recv_dock' } }, { merge: true });
  const dock = await RD.handleReads(db(), { authorization: 'Bearer dock-key-1234567890' }, { device: 'ut_recv_dock', reads: [{ upc: '070852503050' }] });
  assert.equal(dock[0], 501, 'Receiving is being built: its reads are not taken yet');
  assert.match(dock[1].error, /RECEIVING is being built/);
  const body = { device: LINE, reads: [{ upc: '070852503050', date: 'OCT 25' }] };
  assert.equal((await RD.handleReads(db(), {}, body))[0], 401);
  assert.equal((await RD.handleReads(db(), { authorization: 'Bearer wrong' }, body))[0], 403);
  const ok = await RD.handleReads(db(), { authorization: 'Bearer key-one-1234567890' }, body, { now: at(0) });
  assert.equal(ok[0], 200);
  assert.equal(ok[1].count, 1);
  assert.equal(ok[1].area, 'PRODUCTION');
  assert.equal((await RD.handleReads(db(), { authorization: 'Bearer key-one-1234567890' }, { line: LINE, reads: body.reads }, { now: at(0) }))[0], 200, 'a line PC may still name its line');
  await RD.readerCall(db(), { email: ADMIN }, { op: 'makeKey', operationId: LINE }, { key: () => 'key-two-1234567890' });
  assert.equal((await RD.handleReads(db(), { authorization: 'Bearer key-one-1234567890' }, body))[0], 403, 'the old key stops working');
  assert.equal((await RD.handleReads(db(), { authorization: 'Bearer key-two-1234567890' }, { device: 'ut_prod_totes', reads: body.reads }))[0], 403, 'a key is for its own line');
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

test('A test setup for every machine (Joe 10/11): each line at its own full speed; a typed line switches to the reader and back', async () => {
  const SB = { project: 'ud-distribution-sandbox', now: at(0) };
  const lines = [
    { operationId: LINE, products: [{ name: 'Broughton 2% Gallon', upc: '070852503050', ratePerMin: 74, shelfLifeDays: 17 }] },
    { operationId: 'ut_prod_boxing', products: [{ name: 'UD 2% 5 Gal Disp Bag', ratePerMin: 8, shelfLifeDays: 21 }] },
    { operationId: 'ut_prod_totes', products: [] }
  ];
  await assert.rejects(RD.readerAll(db(), { email: MANAGER }, { op: 'startAll', lines }, SB), /Only an administrator/);
  await assert.rejects(RD.readerAll(db(), { email: ADMIN }, { op: 'startAll', lines }, { project: 'ud-distribution', now: at(0) }), /sandbox only/);
  const r = await RD.readerAll(db(), { email: ADMIN }, { op: 'startAll', lines, minutes: 60 }, SB);
  assert.deepEqual(r.lines, [LINE, 'ut_prod_boxing'], 'a line with no products is skipped');
  assert.match(r.message, /TOTES has no products/);
  const boxing = () => db().collection('productionLines').doc('ut_prod_boxing').get().then(s => s.data());
  assert.equal((await boxing()).counter, 'READER');
  assert.equal((await boxing()).testFeed.counterBefore, 'TABLET');
  for (let m = 0; m < 3; m++) await RD.readerMinute(db(), { now: at(m), project: 'ud-distribution-sandbox' });
  const box = (await db().collection('productionRuns').doc(P.runId('ut_prod_boxing', KEY)).get()).data();
  assert.ok(box.count >= 20 && box.count <= 30, 'about 8 a minute on Boxing: ' + box.count);
  assert.equal(box.product, 'UD 2% 5 Gal Disp Bag', 'a product not on the saved list still runs in the test');
  assert.ok(box.reader.wrong + box.reader.missing >= 0);
  assert.ok((await run()).count > 200, 'the Gallon Filler at about 74 a minute');
  const s = await RD.readerAll(db(), { email: ADMIN }, { op: 'stopAll', lines }, SB);
  assert.deepEqual(s.lines, [LINE, 'ut_prod_boxing']);
  assert.equal((await boxing()).counter, 'TABLET', 'Boxing is typed again');
  assert.equal((await boxing()).testFeed, null);
  assert.equal((await db().collection('productionLines').doc(LINE).get()).data().counter, 'TABLET', 'a line switched for the test goes back too');
});

// A machine's own controller (Joe 10/14, the Blow Mold): the line PC reads the jug count, speed and temperature, READ-ONLY.
const BLOW = 'ut_prod_blow_mold';
const blowRun = async () => (await db().collection('productionRuns').doc(P.runId(BLOW, KEY)).get()).data();
const blowLine = async () => (await db().collection('productionLines').doc(BLOW).get()).data() || {};
const setup = async (fields) => { for (const [field, value] of Object.entries(fields)) await RD.readerCall(db(), { email: ADMIN }, { op: 'saveController', operationId: BLOW, field, value }, { now: at(0) }); };

test('Controller setup on Line Targets: an administrator\'s, one box at a time, each box checked', async () => {
  await assert.rejects(RD.readerCall(db(), { email: MANAGER }, { op: 'saveController', operationId: BLOW, field: 'brand', value: 'MODBUS' }), /Only an administrator/);
  await assert.rejects(setup({ countTag: '40001' }), /Pick the controller's brand first/);
  await setup({ brand: 'MODBUS', ip: '192.168.10.40', countTag: '40001', speedTag: '40011', speedName: 'Annealer speed', tempTag: '40012', tempDivide: '10', tempLow: '395', tempHigh: '425' });
  await assert.rejects(setup({ ip: '192.168.10.400' }), /IP address like/);
  await assert.rejects(setup({ speedTag: 'Jug_Count' }), /register number, like 40001/);
  const c = (await blowLine()).controller;
  assert.deepEqual([c.brand, c.ip, c.countTag, c.tempDivide, c.tempHigh, c.speedName], ['MODBUS', '192.168.10.40', '40001', 10, 425, 'Annealer speed']);
  assert.deepEqual(RD.configOut(c), { brand: 'MODBUS', ip: '192.168.10.40', port: null, slot: null, rack: null, unit: null, wordOrder: 'HIGH_FIRST',
    readings: { count: { tag: '40001', size: 32 }, speed: { tag: '40011', size: 16 }, temp: { tag: '40012', size: 16 } } });
  await assert.rejects(RD.readerCall(db(), { email: ADMIN }, { op: 'testRead', operationId: BLOW, reading: 'count' }, { now: at(0) }).then(() => setup({ countTag: '' })).then(() =>
    RD.readerCall(db(), { email: ADMIN }, { op: 'testRead', operationId: BLOW, reading: 'count' }, { now: at(0) })), /Type where the jug count is first/);
});

test('Controller readings: jugs made since the last read count on the shift; speed and temperature kept with their flags; Test read answered', async () => {
  await save('saveLineCounter', { operationId: BLOW, counter: 'CONTROLLER' });
  await setup({ brand: 'AB', ip: '192.168.10.41', countTag: 'Jug_Count', speedTag: 'Speed', tempTag: 'Temp', tempDivide: '10', tempLow: '395', tempHigh: '425', speedLow: '38', speedHigh: '46' });
  await RD.readerCall(db(), { email: ADMIN }, { op: 'makeKey', operationId: BLOW, kind: 'CONTROLLER' }, { key: () => 'blow-key-1234567890' });
  assert.equal(((await db().collection('private').doc('readDevices').get()).data() || {})[BLOW].kind, 'CONTROLLER');
  const call = (body, min) => RD.handleReads(db(), { authorization: 'Bearer blow-key-1234567890' }, Object.assign({ device: BLOW }, body), { now: at(min) });
  // The line PC's first call: its setup, nothing counted yet.
  let [status, out] = await call({ op: 'config' }, 0);
  assert.equal(status, 200);
  assert.equal(out.config.brand, 'AB');
  assert.equal(out.testAsk, null);
  // The first reading only marks where the machine's counter is: no jugs yet.
  [, out] = await call({ controller: { count: 1284000, speed: 42, temp: 4100, errors: {} } }, 0);
  assert.equal(out.count, 0);
  [, out] = await call({ controller: { count: 1284330, speed: 42, temp: 4312, errors: {} } }, 1);
  assert.equal(out.count, 330);
  let r = await blowRun();
  assert.equal(r.countBy, 'machine controller');
  assert.deepEqual([r.machine.counter, r.machine.speed, r.machine.temp, r.machine.tempFlag, r.machine.speedFlag], [1284330, 42, 431.2, 'HIGH', '']);
  assert.equal(r.machine.tempOutSince, new Date(T0 + 60000).toISOString());
  assert.equal(r.machineLog.length, 2, 'one reading a minute');
  // The machine's counter was reset: the new number is all new jugs.
  [, out] = await call({ controller: { count: 25, speed: 30, temp: 4200 } }, 2);
  assert.equal(out.count, 355);
  r = await blowRun();
  assert.deepEqual([r.machine.speedFlag, r.machine.tempFlag, r.machine.tempOutSince], ['LOW', '', '']);
  // A jump too big to be jugs (a new counter or the wrong tag): counting starts from there instead.
  [, out] = await call({ controller: { count: 9000000 } }, 3);
  assert.equal(out.count, 355);
  // The hour's average speed and temperature, and the shift's low and high.
  const m = P.machineNow(r, await blowLine(), T0 + 2 * 60000);
  assert.deepEqual([m.tempMin, m.tempMax, m.tempOutMin, m.speedName], [410, 431.2, 1, 'Speed']);
  const hr = P.hourly(r, [], T0 + 3 * 60000).find(h => h.now);
  assert.equal(hr.temp, Math.round((410 + 431.2 + 420) / 3 * 10) / 10);
  // A read that failed is kept on the line for Line Targets to show.
  await call({ controller: { errors: { temp: 'No answer from the controller.' } } }, 4);
  assert.match((await blowLine()).machineError, /temp: No answer/);
  // Test read: Line Targets asks, the line PC sees the ask with its next call and answers it.
  await RD.readerCall(db(), { email: ADMIN }, { op: 'testRead', operationId: BLOW, reading: 'temp' }, { now: at(5) });
  [, out] = await call({ op: 'config' }, 5);
  assert.deepEqual(out.testAsk, { at: new Date(T0 + 5 * 60000).toISOString(), reading: 'temp' });
  await call({ test: { askAt: out.testAsk.at, reading: 'temp', value: 4312 } }, 5);
  assert.deepEqual((await blowLine()).controller.testResult, { askAt: out.testAsk.at, reading: 'temp', value: 4312, error: '', at: new Date(T0 + 5 * 60000).toISOString() });
});

test('A controller line stops after 3 quiet minutes; a typed line keeps the machine\'s speed and temperature but not its count', async () => {
  await save('saveLineCounter', { operationId: BLOW, counter: 'CONTROLLER' });
  await setup({ brand: 'MODBUS', ip: '192.168.10.40', countTag: '40001', tempTag: '40012' });
  await RD.applyMachine(db(), BLOW, { count: 100 }, { now: at(0) });
  await RD.applyMachine(db(), BLOW, { count: 160 }, { now: at(1) });
  await RD.readerMinute(db(), { now: at(3), project: 'demo-ud-distribution' });
  assert.equal((await blowRun()).stops.length, 0, 'two minutes quiet is not a stop');
  await RD.readerMinute(db(), { now: at(5), project: 'demo-ud-distribution' });
  let r = await blowRun();
  assert.equal(r.stops.length, 1);
  assert.equal(r.stops[0].start, new Date(T0 + 60000).toISOString(), 'stopped from the last jug');
  assert.equal(r.stops[0].by, 'machine controller');
  await RD.applyMachine(db(), BLOW, { count: 170 }, { now: at(6) });
  assert.ok((await blowRun()).stops[0].end, 'jugs moving again end the stop');
  await save('saveLineCounter', { operationId: BLOW, counter: 'TABLET' });
  await RD.applyMachine(db(), BLOW, { count: 500, temp: 415 }, { now: at(7) });
  r = await blowRun();
  assert.equal(r.count, 70, 'typed lines are not counted by the controller');
  assert.equal(r.machine.temp, 415);
});

test('The Blow Mold makes only gallon jugs (Joe 10/14): a new shift starts on its one product, from the tablet or the machine', async () => {
  await save('saveMachineProducts', { operationId: BLOW, products: [{ name: 'Gallon Jug', sku: 'Gallon Jug', ratePerMin: 50, targetPct: 75.05 }] });
  await save('saveLineEntry', { operationId: BLOW, op: 'stop', shift: RD.plantShift(null, T0) });
  let r = await blowRun();
  assert.equal(r.product, 'Gallon Jug');
  assert.equal(r.runs[0].by, 'only product');
  await db().collection('productionRuns').doc(P.runId(BLOW, KEY)).delete();
  await save('saveLineCounter', { operationId: BLOW, counter: 'CONTROLLER' });
  await RD.applyMachine(db(), BLOW, { count: 10, temp: 410 }, { now: at(0) });
  r = await blowRun();
  assert.equal(r.product, 'Gallon Jug');
  // A line with more than one product still has the operator pick.
  await save('saveLineEntry', { operationId: LINE, op: 'stop', shift: RD.plantShift(null, T0) });
  assert.equal((await run()).product, '');
});

test('The Blow Mold (Joe 10/23, mock-up 2): shots and belt turns counted, the room read, each resin lot and color a run', async () => {
  await save('saveMachineProducts', { operationId: BLOW, products: [{ name: 'Gallon Jug', sku: 'Gallon Jug', ratePerMin: 50, targetPct: 75.05 }] });
  await save('saveLineCounter', { operationId: BLOW, counter: 'CONTROLLER' });
  await setup({ brand: 'MODBUS', ip: '192.168.10.40', countTag: '40001', shotsTag: '40031', turnsTag: '40041', pulsesPerTurn: '2', tempTag: '40012', jugsPerShot: '6', roomSensor: 'blow-room', roomHigh: '95' });
  await db().collection('sensors').doc('blow-room').set({ sensorId: 'blow-room', name: 'Blow Mold Room', temperatureF: 88, lastReadingAt: new Date(T0).toISOString() });
  const shift = RD.plantShift(null, T0);
  // Last shift ended on lot R-1 White (kept on the line); this shift's first reading marks where each counter is.
  await db().collection('productionLines').doc(BLOW).set({ lot: 'R-1', color: 'WHITE' }, { merge: true });
  await RD.applyMachine(db(), BLOW, { count: 1000, shots: 500, turns: 10000, temp: 1180 }, { now: at(0) });
  let r = await blowRun();
  assert.deepEqual([r.count, r.shots, r.shotsBase, r.machine.room, r.machineLog[0].room], [0, 0, 0, 88, 88]);
  // A minute: 20 shots (120 jugs molded), 117 jugs on the Alpine, 140 pulses = 70 turns = 70 RPM.
  await RD.applyMachine(db(), BLOW, { count: 1117, shots: 520, turns: 10140, temp: 1182 }, { now: at(1) });
  r = await blowRun();
  assert.deepEqual([r.count, r.shots, r.machine.speed, r.machine.speedFrom], [117, 20, 70, 'TURNS']);
  // Under half a minute later the RPM is not worked out again; it keeps the last one.
  await RD.applyMachine(db(), BLOW, { count: 1120, shots: 521, turns: 10150 }, { now: () => new Date(T0 + 70000) });
  r = await blowRun();
  assert.deepEqual([r.machine.speed, r.machine.speedFrom], [70, 'TURNS']);
  let m = P.machineNow(r, await blowLine(), T0 + 70000, 'BLOWMOLD');
  assert.deepEqual([m.molded, m.through, m.kicked, m.rpm, m.speedName], [126, 120, 6, true, 'Annealer belt speed']);
  // The operator scans lot R-2 and picks Clear: two new runs; scanning R-2 again starts none.
  const entry = (op, f) => save('saveLineEntry', Object.assign({ operationId: BLOW, op, shift }, f));
  await entry('lot', { lot: 'R-2' });
  await entry('lot', { lot: ' R-2 ' });
  await entry('color', { color: 'clear' });
  await assert.rejects(entry('color', { color: 'BLUE' }), /White or Clear/);
  await assert.rejects(entry('lot', { lot: '  ' }), /resin lot/);
  r = await blowRun();
  assert.deepEqual(r.lotFrom, { lot: 'R-1', color: 'WHITE' });
  assert.deepEqual(r.lotLog.map(x => [x.lot, x.color, x.count, x.shots]), [['R-2', 'WHITE', 120, 21], ['R-2', 'CLEAR', 120, 21]]);
  assert.deepEqual([r.lot, r.color], ['R-2', 'CLEAR']);
  const line = await blowLine();
  assert.deepEqual([line.lot, line.color], ['R-2', 'CLEAR'], 'the next shift starts on them');
  await RD.applyMachine(db(), BLOW, { count: 1180, shots: 532, turns: 10300 }, { now: at(3) });
  const runs = P.lotRuns(await blowRun(), line, T0 + 3 * 60000);
  assert.deepEqual(runs.map(x => [x.lot, x.colorName, x.carried, x.through, x.molded, x.kicked]), [['R-1', 'White', true, 120, 126, 6], ['R-2', 'White', false, 0, 0, 0], ['R-2', 'Clear', false, 60, 66, 6]]);
});

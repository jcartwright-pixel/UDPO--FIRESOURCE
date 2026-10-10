'use strict';
// The plant side's rules (src/plant.js): load areas, the Start / End / status rule, typed units, pickups and the journal copy.
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../../src/plant');
const { SaveError } = require('../../src/actions');

const tx = (equipment) => ({ get: async () => ({ docs: (equipment || []).map(e => ({ id: e.id, data: () => e })) }) });
const db = { collection: () => ({}) };
const STAMP = '2026-10-08T12:00:00.000Z';
const values = (day, fields, equipment) => P.loadValues(tx(equipment), db, { plant: P.validateLoad({ fields }, SaveError) }, day, STAMP, SaveError);

test('load types map to the four plant areas like the current app', () => {
  assert.equal(P.areaOf('Case Loadout'), 'CASE');
  assert.equal(P.areaOf('totes'), 'TOTES');
  assert.equal(P.areaOf('Box Loadout'), 'BOXING');
  assert.equal(P.areaOf('TANKER'), 'TANKER');
  assert.equal(P.areaOf('NONE'), '');
});

test('Start, End and the status picker follow the current app\'s rule', async () => {
  assert.deepEqual(await values({}, { startedAt: '2026-10-08T10:00:00Z' }), { plantStartedAt: '2026-10-08T10:00:00.000Z', loadStatus: 'LOADING' });
  assert.deepEqual(await values({ plantStartedAt: 'x' }, { completedAt: '2026-10-08T10:40:00Z' }), { completeTime: '2026-10-08T10:40:00.000Z', loadStatus: 'COMPLETE' });
  // Clearing the End goes back to Loading (a Start is still there) or Waiting.
  assert.deepEqual(await values({ plantStartedAt: 'x', completeTime: 'y' }, { completedAt: '' }), { completeTime: '', loadStatus: 'LOADING' });
  // Done from the picker on a load never started: End now, and Start the same.
  assert.deepEqual(await values({}, { status: 'COMPLETE' }), { completeTime: STAMP, plantStartedAt: STAMP, loadStatus: 'COMPLETE' });
  // Waiting clears both times.
  assert.deepEqual(await values({ plantStartedAt: 'x', completeTime: 'y' }, { status: 'NOT_STARTED' }), { completeTime: '', plantStartedAt: '', loadStatus: 'NOT_STARTED' });
  assert.throws(() => P.validateLoad({ fields: { startedAt: '2026-10-08T10:00:00Z', completedAt: '2026-10-08T09:00:00Z' } }, SaveError), /End Time cannot be before Start Time/);
  assert.throws(() => P.validateLoad({ fields: { status: 'MAYBE' } }, SaveError), /Waiting, Loading or Done/);
  assert.throws(() => P.validateLoad({ fields: {} }, SaveError), /Nothing to save/);
});

test('counts, temperature, notes and Ended Up Not Running', async () => {
  assert.deepEqual(await values({}, { quantity: '1,240', temperature: '36.5', notes: ' short 2 ', shift: 'FIRST SHIFT' }), { casesOut: 1240, loadTemperature: 36.5, plantNotes: 'short 2', plantShift: 'FIRST SHIFT' });
  assert.deepEqual(await values({}, { runs: false }), { runs: false });
  assert.throws(() => P.validateLoad({ fields: { quantity: 'lots' } }, SaveError), /Quantity must be a number/);
  assert.throws(() => P.validateLoad({ fields: { runs: true } }, SaveError), /only be marked as not running/);
});

test('typed trucks and trailers match Equipment Master; an unknown trailer number is kept as T- plus the number', async () => {
  const eq = [{ id: 'veh_trailer_t_901', type: 'TRAILER', unit: 'T-901', status: 'ACTIVE' }, { id: 'veh_truck_223870', type: 'TRUCK', unit: '223870', status: 'ACTIVE' }];
  assert.deepEqual(await values({}, { trailer: '901', truck: '223870' }, eq), { truck: '223870', truckId: 'veh_truck_223870', trailer: 'T-901', trailerId: 'veh_trailer_t_901' });
  assert.deepEqual(await values({}, { trailer: '977' }, eq), { trailer: 'T-977', trailerId: '' });
  assert.deepEqual(await values({}, { trailer: '' }, eq), { trailer: '', trailerId: '' });
});

test('pickups need a product and a quantity', () => {
  assert.throws(() => P.validatePickup('addPickup', { runDocId: 'r', day: 'fri', date: '2026-10-08', quantity: 3 }, SaveError), /product or item/);
  assert.throws(() => P.validatePickup('addPickup', { runDocId: 'r', day: 'fri', date: '2026-10-08', item: 'Milk' }, SaveError), /quantity/);
  assert.deepEqual(P.validatePickup('addPickup', { runDocId: 'r', day: 'fri', date: '2026-10-08', item: 'Milk', quantity: '4' }, SaveError), { runDocId: 'r', day: 'fri', date: '2026-10-08', item: 'Milk', quantity: 4, notes: '' });
});

test('the plant journal keeps the last row of each record and only the plant record types', () => {
  const h = ['record_id', 'business_date', 'record_type', 'route', 'run', 'status', 'payload_json'];
  const docs = P.parseJournal([h, ['u1', '10/8/2026', 'UNLOADING', '801', 'MILK', 'WAITING', ''], ['u1', '10/8/2026', 'UNLOADING', '801', 'MILK', 'COMPLETE', '{"casesIn":40}'], ['d1', '10/8/2026', 'DVIR', '', '', '', '']]);
  assert.deepEqual(Object.keys(docs), ['UNLOADING_u1']);
  assert.equal(docs.UNLOADING_u1.status, 'COMPLETE');
  assert.equal(docs.UNLOADING_u1.date, '2026-10-08');
  assert.deepEqual(docs.UNLOADING_u1.payload, { casesIn: 40 });
  const pu = P.parsePickups([P.PICKUP_HEADERS, ['pu_1', 'fac', '2026-10-08', '', 'run_1', '801', 'MILK', 'PICKUP', 'Gallon', '4'], ['x', 'fac', '2026-10-08', '', '', '', '', 'OTHER']]);
  assert.deepEqual(Object.keys(pu), ['pu_1']);
  assert.equal(pu.pu_1.status, 'PENDING');
});

test('a plant tab that cannot be read is skipped and the rest are read', async () => {
  const reader = { async batchGet(id, ranges) { if (/WASH/.test(ranges[0])) throw new Error('no such tab'); return [[['record_id'], ['r1']]]; } };
  const out = await P.readPlant(reader, { live: { spreadsheetId: 'live', plant: true }, plant: {} });
  assert.deepEqual(Object.keys(out.lists).sort(), ['plantJournal', 'plantReturns']);
  assert.equal(out.skipped.length, 2);
  // Without live.plant nothing in the Live workbook is read for the plant.
  assert.deepEqual(Object.keys((await P.readPlant(reader, { live: { spreadsheetId: 'live' } })).lists), []);
});

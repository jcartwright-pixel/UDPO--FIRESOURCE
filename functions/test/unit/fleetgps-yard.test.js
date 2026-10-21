'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { advanceDays, alertType, dtc } = require('../../src/fleetgps');

// Joe 10/13 (scorecard): left the yard and back, from the Fleet place on each 5-minute read.
test('yard out and in: first time seen out of Uniontown Branch / Plant, last time seen back; a Uniontown street is not the yard', () => {
  const truck = (place, odo) => ({ '223876': { tag: '223876', lastReport: String(Math.random()), place, odometerMiles: odo } });
  let seen = {};
  const step = (place, odo, at) => { const r = advanceDays(seen, truck(place, odo), at); seen = r.seen; return r.days['2026-10-13_223876']; };
  step('Uniontown Branch', 100, '2026-10-13T09:00:00.000Z');
  let d = step('', 103, '2026-10-13T09:05:00.000Z');
  assert.deepEqual([d.yardOut, d.yardIn], ['2026-10-13T09:05:00.000Z', '']);
  d = step('Uniontown Plant', 160, '2026-10-13T16:00:00.000Z');
  assert.deepEqual([d.yardOut, d.yardIn], ['2026-10-13T09:05:00.000Z', '2026-10-13T16:00:00.000Z']);
  step('', 170, '2026-10-13T17:00:00.000Z');
  d = step('Uniontown Branch', 180, '2026-10-13T18:00:00.000Z');
  assert.deepEqual([d.yardOut, d.yardIn], ['2026-10-13T09:05:00.000Z', '2026-10-13T18:00:00.000Z'], 'the first leave and the last return');
  seen = {};
  step('', 100, '2026-10-13T09:00:00.000Z');
  d = step('', 110, '2026-10-13T09:05:00.000Z');
  assert.deepEqual([d.yardOut, d.yardIn], ['', ''], 'never seen in the yard: no leave time');
});

// Joe 10/14 (Praster "back at 11:40 PM" while leaving): the Loading Dock is the yard, so dock to Uniontown Branch is no return.
test('yard: parked at the Loading Dock, through Uniontown Branch on the way out, is a leave and not a return', () => {
  const truck = (place) => ({ '223877': { tag: '223877', lastReport: String(Math.random()), place, odometerMiles: 100 } });
  let seen = {};
  const step = (place, at) => { const r = advanceDays(seen, truck(place), at); seen = r.seen; return r.days['2026-10-14_223877']; };
  step('Loading Dock', '2026-10-14T23:00:00.000Z');
  let d = step('Uniontown Branch', '2026-10-14T23:40:00.000Z');
  assert.ok(!d || !d.yardIn, 'dock to Branch is not a return');
  d = step('', '2026-10-14T23:45:00.000Z');
  assert.deepEqual([d.yardOut, d.yardIn], ['2026-10-14T23:45:00.000Z', '']);
});

test('alert kinds from the Fleet condition', () => {
  assert.equal(alertType({ name: 'Over 55', type: 'PostedSpeedCondition' }, {}), 'SPEEDING');
  assert.equal(alertType({ name: 'Hard stop', type: 'DiagnosticBooleanCondition' }, { TriggerName: 'HarshBraking' }), 'HARSH_BRAKING');
  assert.equal(alertType({ name: '', type: '' }, { TriggerName: 'HarshAcceleration' }), 'HARSH_ACCEL');
  assert.equal(alertType({ name: 'Idling 20 min', type: 'IdleCondition' }, {}), 'IDLE');
  assert.equal(alertType({ name: 'Check engine', type: 'DiagnosticEventCondition' }, { TriggerName: 'J1939_DTC' }), 'FAULT');
  assert.equal(alertType({}, { SpeedMph: '70', LimitMph: '55' }), 'SPEEDING');
  // Joe's own Fleet alerts (10-13-26).
  assert.equal(alertType({ name: 'Excessive Idling', type: 'Idle' }, {}), 'IDLE');
  assert.equal(alertType({ name: 'Speeding over 80', type: 'Speeding' }, {}), 'SPEEDING');
  assert.equal(alertType({ name: 'Speeding', type: 'Speeding Against Speed Limit' }, {}), 'SPEEDING');
  assert.equal(alertType({ name: 'DTC CODE', type: 'Diagnostic Trouble Code (DTC)' }, { TriggerValue: ': 791:2(126)' }), 'FAULT');
  assert.equal(alertType({ name: 'Engine code', type: '' }, {}), 'FAULT');
  assert.equal(alertType({ name: 'Engine code', type: 'DiagnosticTroubleCodeCondition' }, {}), 'FAULT');
  assert.equal(alertType({ name: 'DVIR FAILED', type: 'Inspection Failure' }, {}), 'DVIR_FAILED');
  assert.equal(alertType({ name: 'HOS Warning', type: 'HoS Warning X Minutes' }, {}), 'HOS');
  assert.equal(alertType({ name: 'Violation', type: 'HoS Violation' }, {}), 'HOS');
  for (const [n, t] of [['Harsh Braking', 'HARSH_BRAKING'], ['Harsh Acceleration', 'HARSH_ACCEL'], ['Harsh Cornering Left', 'HARSH_TURN'], ['Harsh Turn', 'HARSH_TURN']]) {
    assert.equal(alertType({ name: n, type: 'Event Diagnostic' }, {}), t);
  }
  assert.equal(alertType({ name: 'Maintenance due', type: 'MaintenanceCondition' }, {}), 'OTHER');
});

test('engine fault codes from Fleet\'s DTC trigger value', () => {
  assert.deepEqual(dtc(': 791:2(126)'), { spn: 791, fmi: 2, source: 126, code: '791:2', fmiText: 'Erratic or wrong data' });
  assert.deepEqual(dtc('3251:31'), { spn: 3251, fmi: 31, source: null, code: '3251:31', fmiText: 'Condition is present' });
  assert.deepEqual(dtc(''), {});
});

// Joe 10/18: trailer temperatures from the GPS. "Once the trailer is loaded and it's complete, that's whenever it starts ...
// whenever it returns to the yard, that's whenever we quit recording."
test('reefer recording: starts when the load is complete, keeps going on the road, stops when back in the yard', () => {
  const { reeferTrips } = require('../../src/fleetgps');
  const load = [{ trailer: 'T-701', runDocId: 'w__r1', day: 'mon', routeRun: 'SUN VALLEY', completedAt: '2026-10-18T12:00:00Z' }];
  const unit = (place) => ({ 'T-701': { unitId: 'u1', tag: 'T-701', place } });
  let s = reeferTrips({}, load, unit('Loading Dock'), '2026-10-18T12:05:00.000Z');
  assert.deepEqual([s.trips['T-701'].recording, s.trips['T-701'].unitId, s.trips['T-701'].out], [true, 'u1', ''], 'recording from the first read after the load is complete');
  s = reeferTrips(s, load, unit('Loading Dock'), '2026-10-18T13:00:00.000Z');
  assert.equal(s.trips['T-701'].startedAt, '2026-10-18T12:05:00.000Z', 'the same load keeps its start');
  s = reeferTrips(s, [], unit(''), '2026-10-18T15:00:00.000Z');
  assert.deepEqual([s.trips['T-701'].recording, s.trips['T-701'].out], [true, '2026-10-18T15:00:00.000Z'], 'off the yard list but out on the road: still recording');
  s = reeferTrips(s, [], unit('Uniontown Plant'), '2026-10-18T22:00:00.000Z');
  assert.deepEqual([s.trips['T-701'].recording, s.trips['T-701'].stopReason, s.trips['T-701'].back], [false, 'BACK_IN_YARD', '2026-10-18T22:00:00.000Z']);
  s = reeferTrips(s, load, unit('Uniontown Plant'), '2026-10-18T22:05:00.000Z');
  assert.equal(s.trips['T-701'].recording, false, 'back in the yard: the same load does not start again');
  s = reeferTrips(s, [Object.assign({}, load[0], { runDocId: 'w__r2', day: 'tue' })], unit('Uniontown Plant'), '2026-10-19T12:00:00.000Z');
  assert.deepEqual([s.trips['T-701'].recording, s.trips['T-701'].id], [true, 'w__r2|tue'], 'its next load starts a new recording');
});

test('reefer recording: a load taken off before leaving stops; no GPS unit; 4-day limit; "701" is T-701', () => {
  const { reeferTrips, trailerKey } = require('../../src/fleetgps');
  assert.deepEqual(['701', 'T701', 't-701', 'T 701'].map(trailerKey), ['T-701', 'T-701', 'T-701', 'T-701']);
  const load = [{ trailer: '702', runDocId: 'w__r9', day: 'wed', routeRun: 'JERSEY 1' }];
  let s = reeferTrips({}, load, {}, '2026-10-18T12:00:00.000Z');
  assert.deepEqual([s.trips['T-702'].recording, s.trips['T-702'].unitId], [true, undefined], 'no GPS unit: recorded with nothing to read');
  s = reeferTrips(s, [], {}, '2026-10-18T13:00:00.000Z');
  assert.deepEqual([s.trips['T-702'].recording, s.trips['T-702'].stopReason], [false, 'NOT_LOADED']);
  s = reeferTrips({}, load, { 'T-702': { unitId: 'u2', tag: 'T-702', place: '' } }, '2026-10-18T12:00:00.000Z');
  s = reeferTrips(s, [], { 'T-702': { unitId: 'u2', tag: 'T-702', place: '' } }, '2026-10-22T12:00:00.000Z');
  assert.deepEqual([s.trips['T-702'].recording, s.trips['T-702'].stopReason], [false, 'TOO_LONG']);
  s = reeferTrips(s, [], {}, '2026-10-25T12:00:00.000Z');
  assert.equal(s.trips['T-702'], undefined, 'a stopped recording is forgotten after 2 days');
});

test('yard GPS temperature: red more than 5° from the set point, old after an hour, nothing to compare without a set point', () => {
  const R = require('../../src/plant-rules');
  const now = Date.parse('2026-10-18T14:00:00Z');
  const r = (tempF, min) => ({ recording: true, unitId: 'u', tempF, readingAt: new Date(now - min * 60000).toISOString() });
  assert.deepEqual([R.yardGps(r(36, 5), '34', now).flag, R.yardGps(r(36, 5), '34', now).off], [false, 2]);
  assert.deepEqual([R.yardGps(r(39.5, 5), '34', now).flag, R.yardGps(r(28, 5), '34', now).flag], [true, true]);
  assert.equal(R.yardGps(r(50, 5), '', now).flag, false);
  assert.equal(R.yardGps(r(36, 61), '34', now).stale, true);
  assert.deepEqual(R.yardGps({ recording: true, unitId: '', tempF: null }, '34', now), { has: false, recording: true, noUnit: true });
  assert.equal(R.yardGps(undefined, '34', now).has, false);
});

// Joe 10/18: out of the yard it keeps reporting: Moving, or where it stopped once it has stood still more than 5 minutes.
test('reefer on the road: Moving, a short stop still reads Moving, stopped 5 minutes shows the place, cleared when it moves', () => {
  const { reeferTrips } = require('../../src/fleetgps');
  const R = require('../../src/plant-rules');
  const load = [{ trailer: 'T-701', runDocId: 'w__r1', day: 'mon', routeRun: '801', completedAt: '2026-10-18T12:00:00Z' }];
  const unit = (place, speedMph, lastReport, address) => ({ 'T-701': { unitId: 'u1', tag: 'T-701', place, speedMph, lastReport, address: address || '' } });
  let s = reeferTrips({}, load, unit('Loading Dock', 0, '2026-10-18T12:04:00Z'), '2026-10-18T12:05:00.000Z');
  assert.equal(R.yardOut(s.trips['T-701'], Date.parse('2026-10-18T12:05:00Z')), null, 'on the yard: not out yet');
  s = reeferTrips(s, [], unit('', 54, '2026-10-18T13:00:00Z', 'I-70 E, Zanesville, OH'), '2026-10-18T13:00:00.000Z');
  assert.equal(R.yardOut(s.trips['T-701'], Date.parse('2026-10-18T13:00:00Z')).text, 'Moving');
  s = reeferTrips(s, [], unit('', 0, '2026-10-18T13:05:00Z', 'Main St & 3rd, Zanesville, OH'), '2026-10-18T13:05:00.000Z');
  assert.equal(s.trips['T-701'].stillSince, '2026-10-18T13:05:00Z');
  assert.equal(R.yardOut(s.trips['T-701'], Date.parse('2026-10-18T13:07:00Z')).text, 'Moving', 'a 2-minute stop (a light) still reads Moving');
  s = reeferTrips(s, [], unit('KROGER #512', 0, '2026-10-18T13:10:00Z', '100 Maple Ave, Zanesville, OH'), '2026-10-18T13:10:00.000Z');
  let o = R.yardOut(s.trips['T-701'], Date.parse('2026-10-18T13:10:00Z'));
  assert.deepEqual([o.stopped, o.text, o.since], [true, 'Stopped at KROGER #512', '2026-10-18T13:05:00Z'], 'stopped 5 minutes: the Fleet place (a store)');
  s = reeferTrips(s, [], unit('', 1, '2026-10-18T13:40:00Z', '100 Maple Ave, Zanesville, OH'), '2026-10-18T13:40:00.000Z');
  assert.equal(R.yardOut(s.trips['T-701'], Date.parse('2026-10-18T13:40:00Z')).text, 'Stopped at 100 Maple Ave, Zanesville, OH', 'no place name: the address');
  s = reeferTrips(s, [], unit('', 40, '2026-10-18T13:45:00Z', 'OH-60 N'), '2026-10-18T13:45:00.000Z');
  assert.deepEqual([s.trips['T-701'].stillSince, R.yardOut(s.trips['T-701'], Date.parse('2026-10-18T13:45:00Z')).text], ['', 'Moving'], 'moving again');
  s = reeferTrips(s, [], unit('', null, '2026-10-18T13:50:00Z', 'OH-60 N'), '2026-10-18T13:50:00.000Z');
  assert.equal(R.yardOut(s.trips['T-701'], Date.parse('2026-10-18T13:50:00Z')).text, 'Out of the yard', 'no speed from the GPS: just out of the yard');
  s = reeferTrips(s, [], unit('Uniontown Plant', 0, '2026-10-18T20:00:00Z'), '2026-10-18T20:00:00.000Z');
  assert.equal(R.yardOut(s.trips['T-701'], Date.parse('2026-10-18T20:00:00Z')), null, 'back in the yard: off the list');
});

// Joe 10/18: the GPS says when a loaded trailer has left the yard. Joe 10/20: past its dispatch time it is off the list whatever the GPS says.
test('yard list: off when the GPS sees this load out, and off at its dispatch time even while the GPS sees it in the yard', () => {
  const R = require('../../src/plant-rules');
  const x = { runDocId: 'w__r1', day: 'mon', trailer: 'T-701', departureDate: '2026-10-19', departureTime: 600, loadDate: '2026-10-19', completedAt: '' };
  const before = Date.parse('2026-10-19T12:00:00Z'), after = Date.parse('2026-10-19T15:00:00Z'); // 8 AM and 11 AM, dispatch at 10 AM
  const g = (extra) => Object.assign({ id: 'w__r1|mon', unitId: 'u1', recording: true, out: '' }, extra);
  assert.equal(R.yardGone(x, g({ out: '2026-10-19T11:30:00Z', seenAt: '2026-10-19T11:55:00Z' }), '2026-10-19', before), true, 'seen out of the yard before its dispatch time: gone');
  assert.equal(R.yardGone(x, g({ seenAt: '2026-10-19T14:55:00Z' }), '2026-10-19', after), true, 'past dispatch time with the GPS seeing it in the yard (back from its route): gone');
  assert.equal(R.yardGone(x, g({ seenAt: '2026-10-19T12:00:00Z' }), '2026-10-19', before), false, 'the GPS sees it in the yard before its dispatch time: stays');
  assert.equal(R.yardGone(x, g({ seenAt: '2026-10-19T12:00:00Z' }), '2026-10-19', after), true, 'no GPS report for 3 hours: by dispatch time');
  assert.equal(R.yardGone(x, g({ unitId: '', seenAt: '2026-10-19T14:55:00Z' }), '2026-10-19', after), true, 'no GPS unit: by dispatch time');
  assert.equal(R.yardGone(x, undefined, '2026-10-19', after), true, 'no GPS at all: by dispatch time');
  assert.equal(R.yardGone(x, undefined, '2026-10-19', before), false);
  assert.equal(R.yardGone(x, g({ id: 'w__r0|sun', out: '2026-10-17T10:00:00Z', seenAt: '2026-10-19T11:55:00Z' }), '2026-10-19', before), false, 'an older load out on the same trailer is not this one');
  const runs = [{ id: 'w__r1', weekStart: '2026-10-18', sheetRow: 1, route: '801', run: '', days: { mon: { loadDate: '2026-10-19', deliveryDate: '2026-10-19', dispatchTime: 600, trailer: 'T-701', loadStatus: 'COMPLETE' } } }];
  assert.equal(R.yardQueue(runs, [], '2026-10-19', after).rows.length, 0, 'without GPS: gone at dispatch time, as before');
  assert.equal(R.yardQueue(runs, [], '2026-10-19', after, { 'T-701': g({ seenAt: '2026-10-19T14:55:00Z' }) }).rows.length, 0, 'the GPS still sees it in the yard: gone at dispatch time all the same (Joe 10/20)');
});

// Joe 10/19: the trailer number is found in Fleet's tag however it is written; a bare number only when no truck has it.
test('trailer GPS units: T-864, TRL 888, Trailer 0901, 920 Reefer and a bare 905 all match; a bare truck number does not', () => {
  const { trailerUnits, runTrucks } = require('../../src/fleetgps');
  const trucks = {
    a: { tag: 'T-864', unitId: '1' }, b: { tag: 'TRL 888', unitId: '2' }, c: { tag: 'Trailer 0901', unitId: '3' }, d: { tag: '920 Reefer', unitId: '4' },
    e: { tag: '905', unitId: '5' }, f: { tag: '844', unitId: '6' }, g: { tag: '864', unitId: '7', lastReport: '2026-10-19T12:00:00Z' },
    h: { tag: 'T864', unitId: '8', lastReport: '2026-10-19T13:00:00Z' }, i: { tag: '123456', unitId: '9' } };
  const runs = [{ days: { mon: { truck: '844', trailer: '844' }, tue: { truckId: '0905' } } }];
  assert.deepEqual(runTrucks(runs), ['844', '0905']);
  const out = trailerUnits(trucks, ['T-864', 'T-888', 'T-901', 'T-920', 'T-905', 'T-844', 'T-999'], runTrucks(runs));
  assert.deepEqual(Object.keys(out).sort(), ['T-864', 'T-888', 'T-901', 'T-920']);
  assert.deepEqual([out['T-864'].unitId, out['T-888'].unitId, out['T-901'].unitId, out['T-920'].unitId], ['8', '2', '3', '4'], 'a trailer word wins over a bare number; of two, the newest report');
  assert.deepEqual(Object.keys(trailerUnits({ e: { tag: '905', unitId: '5' } }, ['T-905'], [])), ['T-905'], 'a bare number when no truck has it');
});

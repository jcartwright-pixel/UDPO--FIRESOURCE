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

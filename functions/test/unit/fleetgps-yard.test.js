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

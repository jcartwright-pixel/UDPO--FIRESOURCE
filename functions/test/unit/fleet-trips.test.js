'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { tripsOf, toOurs, plainAddress } = require('../../src/fleettrips');

// Joe 11/1: trip start/end and where, miles, fuel counter at both ends, fuel used and MPG.
const YARD = { lat: 39.9, lon: -79.73 };
const pt = (at, out, miles, fuel, odo) => ({ at: '2026-10-30T' + at + ':00.000Z', lat: out ? 40.2 : YARD.lat, lon: out ? -79.9 : YARD.lon, address: out ? 'Route stop' : 'Uniontown Plant', miles, v: Object.assign({}, fuel == null ? {} : { TotalFuelUsed: fuel }, odo == null ? {} : { Odometer: odo }) });
const cols = [{ name: 'TotalFuelUsed', unit: 'gal' }, { name: 'Odometer', unit: 'mi' }];

test('a trip runs from the last yard point before leaving to the first point back; fuel counter gives fuel used and MPG', () => {
  const t = tripsOf([pt('09:00', false, 0, 1000, 5000), pt('09:10', true, 5, 1001, 5005), pt('12:00', true, 95, 1015, 5100), pt('15:00', false, 20, 1020, 5120), pt('16:00', false, 0, 1020, 5120)], [YARD], cols);
  assert.equal(t.length, 1);
  assert.equal(t[0].left, '2026-10-30T09:00:00.000Z');
  assert.equal(t[0].back, '2026-10-30T15:00:00.000Z');
  assert.equal(t[0].miles, 120);
  assert.deepEqual([t[0].fuelCounterStart, t[0].fuelCounterEnd, t[0].fuelUsed, t[0].odometerMiles, t[0].mpg], [1000, 1020, 20, 120, 6]);
});

test('not back by the end of the day, and no fuel readings: the trip still shows, with no MPG', () => {
  const t = tripsOf([pt('09:00', false, 0), pt('10:00', true, 30), pt('11:00', true, 30)], [YARD], []);
  assert.equal(t.length, 1);
  assert.equal(t[0].back, '');
  assert.equal(t[0].miles, 60);
  assert.equal(t[0].mpg, null);
  assert.match(t[0].note, /Not back/);
});

test('Fleet units become gallons, miles and miles per gallon', () => {
  assert.deepEqual(toOurs('100', 'Liter', 'Volume'), { value: 26.42, unit: 'gal' });
  assert.deepEqual(toOurs('100', 'Kilometer', 'Distance'), { value: 62.1, unit: 'mi' });
  assert.deepEqual(toOurs('2.55', 'Kilometers per liter', 'FuelEfficiency'), { value: 6, unit: 'mpg' });
  assert.equal(toOurs('', 'Liter').value, null);
});

test('Fleet fuel economy (kilometres per litre) becomes MPG, and its addresses read plainly', () => {
  assert.deepEqual(toOurs('2.76', 'KilometersPerLiter', 'FuelEfficiency'), { value: 6.49, unit: 'mpg' });
  assert.equal(plainAddress('US|15401|Pennsylvania|Uniontown|Morgantown St'), 'Morgantown St, Uniontown, Pennsylvania 15401');
  assert.equal(plainAddress('123 Main St'), '123 Main St');
});

// Joe 11/2: every truck's October trips; a trip crossing midnight stays one trip.
test('month read: trips build as points stream in, across midnight, with the fuel counter at both ends', () => {
  const { tripStream } = require('../../src/fleettrips');
  const s = tripStream([YARD]);
  const p = (at, out, miles, fuel) => ({ at, lat: out ? 40.2 : YARD.lat, lon: out ? -79.9 : YARD.lon, address: out ? 'Out' : 'Yard', miles, fuel, tripFuel: null, odo: null });
  [p('2026-10-01T02:00:00Z', false, 0, 500), p('2026-10-01T03:00:00Z', true, 10, 502), p('2026-10-01T05:00:00Z', true, 40, 508), p('2026-10-01T06:00:00Z', false, 10, 510),
   p('2026-10-02T01:00:00Z', false, 0, 510), p('2026-10-02T02:00:00Z', true, 30, 515)].forEach(x => s.add(x));
  const t = s.finish();
  assert.equal(t.length, 2);
  assert.deepEqual([t[0].left, t[0].back, t[0].miles, t[0].fuelUsed, t[0].mpg], ['2026-10-01T02:00:00Z', '2026-10-01T06:00:00Z', 60, 10, 6]);
  assert.equal(t[1].back, '');
  assert.equal(t[1].fuelUsed, 5);
});

// Joe 11/2: the trips live in the app's database: October first, then each new day; one record per trip.
test('GPS trip fuel: the days to store run from October to yesterday, and a trip is one record keyed by unit and time', () => {
  const { daysToStore, tripDoc, tripId } = require('../../src/tripfuel');
  assert.equal(daysToStore('', '2026-11-02').length, 32);
  assert.deepEqual(daysToStore('2026-11-01', '2026-11-02'), []);
  assert.deepEqual(daysToStore('2026-10-30', '2026-11-02'), ['2026-10-31', '2026-11-01']);
  const t = { tag: '123891', unitId: 1421492810, left: '2026-10-31T14:09:00.000Z', back: '', miles: 244.9, fuelUsed: 36.85, mpg: 6.7, note: '' };
  assert.equal(tripId(t), '1421492810_20261031T140900000');
  const d = tripDoc(t, 'now');
  assert.deepEqual([d.day, d.unitId, d.fuelUsed, d.odometerStart], ['2026-10-31', '1421492810', 36.85, null]);
});

// 11/2: a truck that never comes to Uniontown has its own home: where it stands still in the small hours.
test('a truck\'s home is where it stands still between 1 and 4 a.m.', () => {
  const { homeOf } = require('../../src/fleettrips');
  const at = (h) => '2026-10-01T' + String(h + 4).padStart(2, '0') + ':00:00Z'; // New York hour h (EDT)
  const pts = [1, 2, 3].map(h => ({ at: at(h), lat: 37.8104, lon: -82.7991, miles: 0 })).concat([{ at: at(12), lat: 38, lon: -82, miles: 0 }, { at: at(13), lat: 38, lon: -82, miles: 0 }, { at: at(14), lat: 38, lon: -82, miles: 0 }, { at: at(15), lat: 38, lon: -82, miles: 0 }]);
  assert.deepEqual(homeOf(pts), { lat: 37.81, lon: -82.799 });
});

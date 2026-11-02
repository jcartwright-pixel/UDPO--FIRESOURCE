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

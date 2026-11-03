'use strict';
// 6.84 full practice test: typing 014 in a Daily Case Loadout Trailer box saved "T-014". The rules audit (line 12) says a
// trailer is always T-, a dash and the number with no leading zeros, so the plant saves go through logic.js trailerNumber.
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../../src/plant');
const MAINT = require('../../src/maintenance');

const equipment = [{ id: 'veh_trailer_t_533', type: 'TRAILER', unit: 'T-533', status: 'ACTIVE' }];
const saved = (typed) => P.typedTrailer(MAINT.resolveUnit(typed, 'TRAILER', equipment));

test('a trailer number no unit matches saves as T- and the number, with no leading zeros', () => {
  assert.equal(saved('014'), 'T-14');
  assert.equal(saved('T-014'), 'T-14');
  assert.equal(saved('t 014'), 'T-14');
  assert.equal(saved('9999'), 'T-9999');
});

test('a trailer Equipment Master knows saves as its unit', () => {
  assert.equal(saved('533'), 'T-533');
  assert.equal(saved('0533'), 'T-533');
});

test('TBA and N/A stay words', () => {
  assert.equal(saved('tba'), 'TBA');
  assert.equal(saved('N/A'), 'N/A');
});

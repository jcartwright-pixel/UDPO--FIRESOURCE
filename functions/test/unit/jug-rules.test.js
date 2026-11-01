'use strict';
// Plant Material Trailers lists (Joe 11/1, mock-up 2): Trailer Company and Unit, What is on it and Location drop-downs,
// Edit Lists with United Dairy protected (src/jug-rules.js, shared with the screen).
const test = require('node:test');
const assert = require('node:assert/strict');
const J = require('../../src/jug-rules');
const JT = require('../../src/jugtrailers');
class SaveError extends Error { constructor(code, msg) { super(msg); this.code = code; } }

test('trailers saved before 11/1 read as company and unit, with IN DOCK as the location', () => {
  assert.deepEqual(J.parts({ number: 'METRO 4579', items: [{ item: 'Clear 1/2', pallets: '' }] }, J.SEED.companies), { company: 'Metro', unit: '4579', items: [{ item: 'Clear 1/2', pallets: '' }], location: '', unitedDairy: false });
  assert.deepEqual(J.parts({ number: '822', unitedDairy: true, items: [{ item: 'Ferry White 1/2 IN DOCK', pallets: '3' }] }), { company: 'United Dairy', unit: '822', items: [{ item: 'Ferry White 1/2', pallets: '3' }], location: 'In Dock', unitedDairy: true });
  assert.equal(J.parts({ number: 'COMPASS 3113' }, J.SEED.companies).company, 'Compass');
  assert.equal(J.parts({ number: 'PENSKE 12' }, J.SEED.companies).company, 'Penske', 'a company not on the list is written the way people say it');
  assert.equal(J.parts({ number: 'CKS 4304', company: 'CKS', unit: '4304', location: 'In the Lot', items: [{ item: 'White Qt IN DOCK' }] }).location, 'In the Lot', 'a location already picked wins');
});

test('the lists start with what was on the screen and add what the lot uses', () => {
  const l = J.lists(null, [{ number: 'METRO 4579', inLot: true }, { number: 'GREEN 7', inLot: true, items: [{ item: 'Caps' }] }, { number: 'METRO 9', inLot: false }]);
  assert.deepEqual(l.companies.map(c => c.name), ['BW', 'CKS', 'Compass', 'Duval', 'Green', 'JD', 'Metro']);
  assert.deepEqual(l.companies.find(c => c.name === 'Metro').units, ['4579'], 'a trailer that left is not added back');
  assert.deepEqual(l.items, ['Caps', 'Clear 1/2', 'Clear Qt', 'Ferry White 1/2', 'White 1/2', 'White Qt']);
  assert.deepEqual(l.locations, ['In Dock', 'In the Lot']);
  assert.deepEqual(J.lists({ companies: [{ name: 'United Dairy', units: ['T-1'] }, { name: 'JD', units: ['10', '9'] }], items: [], locations: [] }, []).companies, [{ name: 'JD', units: ['9', '10'] }], 'United Dairy is never on the outside list');
});

test('United Dairy is protected and nothing a trailer in the lot uses can be deleted', () => {
  const lot = [{ number: 'CKS 4737', inLot: true, items: [{ item: 'White Qt IN DOCK' }] }];
  assert.match(J.deleteBlock('company', 'United Dairy', '', lot), /protected/);
  assert.match(J.deleteBlock('unit', 'T-601', 'United Dairy', lot), /protected/);
  assert.match(J.deleteBlock('company', 'CKS', '', lot), /1 trailer in the lot/);
  assert.match(J.deleteBlock('unit', '4737', 'CKS', lot), /in the lot/);
  assert.match(J.deleteBlock('item', 'White Qt', '', lot), /on a trailer/);
  assert.match(J.deleteBlock('location', 'In Dock', '', lot), /is at In Dock/);
  assert.equal(J.deleteBlock('company', 'Metro', '', lot), '');
  assert.equal(J.deleteBlock('unit', '4304', 'CKS', lot), '');
  assert.equal(J.deleteBlock('item', 'Clear Qt', '', lot), '');
});

test('the save checks: company then unit, list changes, location', () => {
  const v = (x) => JT.validateJugTrailer(Object.assign({ facilityId: 'fac_uniontown' }, x), SaveError);
  assert.deepEqual([v({ op: 'add', company: 'Metro', unit: ' 4579 ' }).company, v({ op: 'add', company: 'Metro', unit: '4579' }).unit], ['Metro', '4579']);
  assert.equal(v({ op: 'add', number: 'metro 4579' }).unit, 'METRO 4579', 'a number typed on its own is still taken');
  assert.throws(() => v({ op: 'add', company: 'United Dairy', unit: '5' }), /fleet list/);
  assert.throws(() => v({ op: 'add', company: 'Metro' }), /unit number/);
  assert.throws(() => v({ op: 'list', list: 'company', change: 'delete', value: 'united dairy' }), /protected/);
  assert.throws(() => v({ op: 'list', list: 'unit', change: 'delete', value: 'T-601', company: 'United Dairy' }), /protected/);
  assert.equal(v({ op: 'list', list: 'item', change: 'add', value: 'Gallon  jugs' }).value, 'Gallon jugs');
  assert.throws(() => v({ op: 'list', list: 'colour', change: 'add', value: 'x' }), /Pick a list/);
  assert.equal(v({ op: 'edit', trailerId: 'fac_uniontown_METRO_4579', fields: { location: 'In Dock' } }).fields.location, 'In Dock');
  assert.equal(J.number('Metro', '4579'), 'METRO 4579');
  assert.equal(J.number('United Dairy', 'T-601'), 'T-601');
});

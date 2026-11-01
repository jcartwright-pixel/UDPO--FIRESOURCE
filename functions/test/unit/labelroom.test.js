'use strict';
// The Labeling Room (Joe 10/31, mock-up 3, "United Dairy End Zone"): the Labeling Room and the fillers count down together.
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../../src/production-rules');
const LABEL = require('../../src/labelroom');
const PROD = require('../../src/production');

class SaveError extends Error { constructor(code, message) { super(message); this.code = code; } }
const T = Date.parse('2026-10-31T18:00:00Z');

test('the half gallon fillers and the Gallon Filler are in the Labeling Room unless Line Targets unticks them; any other filler when ticked', () => {
  const lines = [{ operationId: 'old', name: 'Old Half Gallon Filler' }, { operationId: 'new', name: 'New Half Gallon Filler' }, { operationId: 'gal', name: 'Gallon Filler' },
    { operationId: 'half', name: 'OLD 1/2 GALLON' }, { operationId: 'cup', name: 'Cup Filler' }, { operationId: 'bm', name: 'Blow Mold' }, { operationId: 'rp', name: 'Raypak' }, { operationId: 'box', name: 'Boxing' }];
  assert.deepEqual(P.labelLines(lines, {}).map(l => l.operationId), ['old', 'new', 'gal', 'half']);
  assert.deepEqual(P.labelLines(lines, { gal: { labelRoom: false }, cup: { labelRoom: true }, bm: { labelRoom: true } }).map(l => l.operationId), ['old', 'new', 'half', 'cup']);
});

test('labels still to put on = left to run less the bottles on the belt; 0 with something next says switch now', () => {
  const v = { product: '2% Half Gallon', runLeft: { left: 1530, qty: 4000, pct: 62 }, next: { product: 'Whole Milk Half Gallon', qty: 3000 }, speed: 100, state: 'RUNNING' };
  const x = P.labelView(v, { beltMin: 4, beltHolds: 380 }, T);
  assert.deepEqual([x.labeling, x.switched, x.toLabel, x.onBelt, x.switchMin, x.switchNow], ['2% Half Gallon', false, 1150, 380, 12, false]);
  const end = P.labelView(Object.assign({}, v, { runLeft: { left: 300 } }), { beltMin: 4, beltHolds: 380 }, T);
  assert.deepEqual([end.toLabel, end.onBelt, end.switchNow], [0, 300, true]);
  // No speed yet: the product's target speed.
  assert.equal(P.labelView(Object.assign({}, v, { speed: null, target: { perHour: 3000 } }), { beltHolds: 380 }, T).switchMin, 23);
});

test('after I switched, the filler\'s bottles left are all on the belt and it counts down to the first new bottle', () => {
  const v = { product: '2% Half Gallon', runLeft: { left: 380 }, next: { product: 'Whole Milk Half Gallon', qty: 3000 }, speed: 100 };
  const x = P.labelView(v, { beltMin: 4, beltHolds: 380, labeling: { product: 'whole milk half gallon', at: new Date(T - 80000).toISOString() } }, T);
  assert.deepEqual([x.switched, x.labeling, x.onBelt, x.toLabel, x.arriveIn], [true, 'whole milk half gallon', 380, null, 160]);
  // Once the filler starts it, the label is what it runs again.
  assert.equal(P.labelView(Object.assign({}, v, { product: 'Whole Milk Half Gallon' }), { labeling: { product: 'Whole Milk Half Gallon', at: new Date(T).toISOString() } }, T).switched, false);
});

test('Hold labels and a filler that is down show on the Labeling Room', () => {
  const x = P.labelView({ product: 'A', state: 'STOPPED' }, { labelHold: { at: '2026-10-31T18:06:00Z', by: 'sam@uniteddairy.com' } }, T);
  assert.deepEqual([!!x.hold, x.down], [true, true]);
  assert.equal(P.labelView({ product: 'A' }, { labelHold: null }, T).hold, null);
});

test('saveLabelRoom takes a label, Hold labels or Running again for one filler', () => {
  assert.deepEqual(LABEL.validateLabelRoom({ op: 'labeling', operationId: 'ut_prod_new', product: ' 1% Pint ' }, SaveError), { op: 'labeling', operationId: 'ut_prod_new', product: '1% Pint' });
  assert.deepEqual(LABEL.validateLabelRoom({ op: 'hold', operationId: 'ut_prod_new' }, SaveError), { op: 'hold', operationId: 'ut_prod_new' });
  assert.throws(() => LABEL.validateLabelRoom({ op: 'labeling', operationId: 'ut_prod_new' }, SaveError), /Pick the label/);
  assert.throws(() => LABEL.validateLabelRoom({ op: 'stop', operationId: 'ut_prod_new' }, SaveError), /Pick a label/);
  assert.throws(() => LABEL.validateLabelRoom({ op: 'hold', operationId: '../x' }, SaveError), /Pick a filler/);
});

test('Line Targets keeps each filler\'s Labeling Room tick, belt minutes and bottles on the belt', () => {
  assert.deepEqual(PROD.validateLineSetup({ operationId: 'ut_prod_new', labelRoom: false, beltMin: '4', beltHolds: '380' }, SaveError), { operationId: 'ut_prod_new', beltMin: 4, beltHolds: 380, labelRoom: false });
  assert.throws(() => PROD.validateLineSetup({ operationId: 'ut_prod_new', beltMin: '500' }, SaveError), /Belt time minutes/);
  assert.throws(() => PROD.validateLineSetup({ operationId: 'ut_prod_new', labelRoom: 'yes' }, SaveError), /Labeling Room/);
});

// 6.78 practice test: NEW 1/2 GALLON had no saved Products list, so the "Labeling now" drop-down showed its starting list but the
// server refused every pick ("38% Cream is not one of NEW 1/2 GALLON's products."). The server now uses the same starting list.
test('a filler with no saved Products list takes a label from its starting list, as the drop-down shows', () => {
  const fs = require('fs'), path = require('path');
  const start = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../public/data/plant-products.json'), 'utf8'));
  const half = start.lines.find(l => l.operationId === 'ut_prod_new_half_gallon');
  assert.ok(half.products.length > 0);
  assert.deepEqual(LABEL.productsOf(null, 'ut_prod_new_half_gallon').map(p => p.name), half.products.map(p => p.name));
  // A saved list still wins, even an empty one.
  assert.deepEqual(LABEL.productsOf({ products: [{ name: '1% Pint' }] }, 'ut_prod_new_half_gallon'), [{ name: '1% Pint' }]);
  assert.deepEqual(LABEL.productsOf({ products: [] }, 'ut_prod_new_half_gallon'), []);
  assert.deepEqual(LABEL.productsOf(null, 'no_such_line'), []);
});

test('functions/src/plant-products.json is the same as public/data/plant-products.json (copy it after changing the starting list)', () => {
  const fs = require('fs'), path = require('path');
  assert.equal(fs.readFileSync(path.join(__dirname, '../../src/plant-products.json'), 'utf8'),
    fs.readFileSync(path.join(__dirname, '../../../public/data/plant-products.json'), 'utf8'));
});

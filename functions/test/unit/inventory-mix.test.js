'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const R = require('../../src/plant-rules');
const INV = require('../../src/inventory');
const C = require('../../../public/js/code128.js');

// Joe 11-4-26 (Inventory mock-ups A to F, "a mix of everything", milk products "a separate type").
class SaveError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const v = (input) => INV.validate(input, { lane: 'RECEIVING', op: input.op }, SaveError);

test('the plant rules are the same file on the server and in the browser', () => {
  const a = fs.readFileSync(path.join(__dirname, '../../src/plant-rules.js'), 'utf8');
  const b = fs.readFileSync(path.join(__dirname, '../../../public/js/plant-rules.js'), 'utf8');
  assert.equal(a, b);
});

test('Should have counts what was made too, and milk products are their own type', () => {
  assert.equal(R.shouldHave({ countQty: 100, receivedSince: 20, madeSince: 30, usedSince: 45 }), 105);
  assert.equal(R.shouldHave({ countQty: 10, usedSince: 0.25 }), 9.75);
  assert.equal(R.isMilk({ kind: R.MILK_KIND }), true);
  assert.equal(R.isMilk({ kind: 'Packaging' }), false);
  assert.equal(R.inventoryLow({ countQty: 400, low: 450 }), true);
  assert.equal(R.inventoryLow({ countQty: 500, low: 450 }), false);
});

test('what a line made, by product, from its counts', () => {
  const run = { count: 300, counts: [{ at: '2026-10-08T12:00:00Z', count: 100 }, { at: '2026-10-08T13:00:00Z', count: 180 }, { at: '2026-10-08T14:00:00Z', count: 300 }],
    runs: [{ product: 'Gallon Whole Milk', from: '2026-10-08T11:00:00Z' }, { product: 'Gallon 2% Milk', from: '2026-10-08T13:30:00Z' }] };
  assert.deepEqual(R.madeByProduct(run), { 'GALLON WHOLE MILK': 180, 'GALLON 2% MILK': 120 });
  assert.deepEqual(R.madeByProduct({ product: 'Gallon Whole Milk', count: 140 }), { 'GALLON WHOLE MILK': 140 });
  assert.deepEqual(R.madeByProduct({}), {});
});

test('take out, low at, uses and label are checked before saving', () => {
  assert.deepEqual(v({ op: 'use', itemId: 'A', qty: '1,500', forWhat: 'GALLON FILLER', how: 'SCAN' }),
    { lane: 'RECEIVING', op: 'use', itemId: 'A', qty: 1500, forWhat: 'GALLON FILLER', station: '', how: 'SCAN' });
  assert.equal(v({ op: 'use', itemId: 'A', qty: '-1' }).qty, -1, 'the tablet puts one back');
  assert.throws(() => v({ op: 'use', itemId: 'A', qty: '0' }), /whole number/);
  assert.throws(() => v({ op: 'use', itemId: 'A', qty: '2.5' }), /whole number/);
  assert.throws(() => v({ op: 'use', qty: '2' }), /Pick the product/);
  assert.equal(v({ op: 'setLow', itemId: 'A', low: '' }).low, null);
  assert.equal(v({ op: 'setLow', itemId: 'A', low: '450' }).low, 450);
  assert.deepEqual(v({ op: 'setUses', itemId: 'M', uses: [{ itemId: 'J', qty: '1' }, { itemId: 'C', qty: '0.25' }] }).uses, [{ itemId: 'J', qty: 1 }, { itemId: 'C', qty: 0.25 }]);
  assert.throws(() => v({ op: 'setUses', itemId: 'M', uses: [{ itemId: 'M', qty: '1' }] }), /cannot use itself/);
  assert.throws(() => v({ op: 'setUses', itemId: 'M', uses: [{ itemId: 'J', qty: '1' }, { itemId: 'J', qty: '2' }] }), /twice/);
  assert.throws(() => v({ op: 'setUses', itemId: 'M', uses: [{ itemId: 'J', qty: '0' }] }), /above 0/);
  assert.equal(v({ op: 'label', itemId: 'A' }).itemId, 'A');
  assert.deepEqual(v({ op: 'addMilkProducts' }), { lane: 'RECEIVING', op: 'addMilkProducts' });
});

test('label codes are short, plain and never repeat', () => {
  const taken = new Set();
  for (let i = 0; i < 5000; i++) {
    const c = INV.newLabelCode('req' + i + 'ITEM', taken);
    assert.match(c, /^UD[A-HJ-NP-Z2-9]{6}$/, 'no I, O, 0 or 1 to misread');
    assert.ok(!taken.has(c));
    taken.add(c);
  }
  assert.equal(INV.newLabelCode('same', new Set()), INV.newLabelCode('same', new Set()));
});

test('Code 128 barcodes for the Zebra labels', () => {
  // Start B, U(53) D(36), check (104 + 53 + 72) % 103 = 23, stop.
  assert.deepEqual(C.values('UD'), [104, 53, 36, 23, 106]);
  const w = C.encode('UD7WRGL7');
  assert.equal(w.length, 6 * 10 + 7, '6 widths for each of start, 8 letters and the check, and 7 for stop');
  assert.equal(w.reduce((a, b) => a + b, 0), 11 * 10 + 13, 'each symbol is 11 modules wide, stop is 13');
  assert.match(C.svg('UD7WRGL7'), /^<svg [^>]*aria-label="Barcode UD7WRGL7"/);
  assert.throws(() => C.values('é'), /plain letters/);
});

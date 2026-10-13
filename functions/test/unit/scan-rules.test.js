// Receiving's barcode rules (scan-rules.js): what one scan of a supplier's label gives.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const S = require('../../src/scan-rules');

const NOW = new Date('2026-10-13T12:00:00Z'), GS = String.fromCharCode(29);

test('the screens and the server use the same barcode rules', () => {
  assert.equal(fs.readFileSync(path.join(__dirname, '../../src/scan-rules.js'), 'utf8'), fs.readFileSync(path.join(__dirname, '../../../public/js/scan-rules.js'), 'utf8'));
});

test('check digits and item codes: UPC, EAN and the 14-digit case code all match as 14 digits', () => {
  assert.equal(S.checkDigitOk('036000291452'), true);
  assert.equal(S.checkDigitOk('036000291453'), false);
  assert.equal(S.gtinKey('036000291452'), '00036000291452');
  assert.equal(S.gtinKey('0 36000 29145 2'), '00036000291452');
  assert.equal(S.gtinKey('4006381333931'), '04006381333931');
  assert.equal(S.gtinKey('96385074'), '00000096385074');
  assert.equal(S.gtinKey('10614141000415'), '10614141000415');
  assert.equal(S.gtinKey('10614141000416'), '', 'a bad check digit is not an item code');
  assert.equal(S.gtinKey('ABC'), '');
  // The case code holds the unit: same middle digits.
  assert.equal(S.itemCore('10614141000415'), S.itemCore('00614141000418'));
});

test('a plain UPC or case code scan says only which item', () => {
  assert.deepEqual(S.parseScan('036000291452\r\n', NOW), { kind: 'ITEM', raw: '036000291452', gtin: '00036000291452' });
  assert.equal(S.parseScan(']E0036000291452', NOW).gtin, '00036000291452');
  assert.equal(S.parseScan('10614141000415', NOW).kind, 'ITEM');
  assert.equal(S.scanQuantity(S.parseScan('036000291452', NOW)), 1);
});

test('a GS1-128 label gives item, lot, dates, count, pallet ID and PO in one scan', () => {
  const p = S.parseScan(']C1' + '0110614141000415' + '11261001' + '17270401' + '3712' + GS + '400' + '44821' + GS + '10C2610A', NOW);
  assert.equal(p.kind, 'GS1');
  assert.equal(p.gtin, '10614141000415');
  assert.equal(p.made, '2026-10-01');
  assert.equal(p.useBy, '2027-04-01');
  assert.equal(p.count, 12);
  assert.equal(p.po, '44821');
  assert.equal(p.lot, 'C2610A');
  assert.equal(S.scanQuantity(p), 12);
  assert.equal(p.raw.indexOf(GS), -1, 'the invisible separator is shown as |');
});

test('the Wasp may type the separator as | or ~, or drop it when the lot comes last', () => {
  const a = S.parseScan('0110614141000415' + '10C2610A|' + '15270330', NOW);
  assert.equal(a.lot, 'C2610A'); assert.equal(a.bestBy, '2027-03-30');
  const b = S.parseScan('0110614141000415~10HG-0930~3720', NOW);
  assert.equal(b.lot, 'HG-0930'); assert.equal(b.count, 20);
  const c = S.parseScan('011061414100041515270330' + '10PT-0928', NOW);
  assert.equal(c.lot, 'PT-0928'); assert.equal(c.bestBy, '2027-03-30');
});

test('the numbers in brackets under the barcode read the same as the scan', () => {
  const p = S.parseScan('(01)10614141000415(10)C2610A(17)270400(37)12', NOW);
  assert.equal(p.kind, 'GS1');
  assert.equal(p.lot, 'C2610A');
  assert.equal(p.useBy, '2027-04-30', 'day 00 is the end of the month');
  assert.equal(p.count, 12);
});

test('a pallet label with only the pallet ID (SSCC) and net weight', () => {
  const p = S.parseScan('00106141410000000101' + '3202001250', NOW);
  assert.equal(p.kind, 'GS1');
  assert.equal(p.sscc, '106141410000000101');
  assert.equal(p.netLb, 12.5);
});

test('anything else is kept as typed, not guessed at', () => {
  assert.equal(S.parseScan('L77', NOW).kind, 'OTHER');
  assert.equal(S.parseScan('(01)10614141000416(10)X', NOW).kind, 'OTHER', 'a bad check digit is refused');
  assert.equal(S.parseScan('0110614141000415' + '17271340', NOW).kind, 'OTHER', 'month 13 is refused');
  assert.equal(S.parseScan('', NOW).kind, 'OTHER');
});

test('dates: two-digit years and Joe\'s 10-8-26 format', () => {
  assert.equal(S.gs1Date('261008', NOW), '2026-10-08');
  assert.equal(S.gs1Date('990101', NOW), '1999-01-01');
  assert.equal(S.gs1Date('270229', NOW), '');
  assert.equal(S.shortDate('2026-10-08'), '10-8-26');
  assert.equal(S.shortDate(''), '');
});

test('the key an item is known by, and the code a person reads', () => {
  const upc = S.parseScan('036000291452', NOW);
  assert.equal(S.barcodeKey(upc), '00036000291452');
  assert.equal(S.shownCode(upc), '036000291452');
  assert.equal(S.shownCode(S.parseScan('4006381333931', NOW)), '4006381333931');
  assert.equal(S.shownCode(S.parseScan('10614141000415', NOW)), '10614141000415');
  assert.equal(S.barcodeKey(S.parseScan('l77  x', NOW)), 'TEXT:L77 X');
  assert.equal(S.shownCode(S.parseScan('L77', NOW)), 'L77');
  assert.equal(S.shownCode(S.parseScan('96385074', NOW)), '96385074', 'an 8-digit EAN as printed');
  assert.equal(S.barcodeKey(null), '');
});

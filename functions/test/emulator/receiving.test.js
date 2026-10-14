'use strict';
// Receiving scan-in (Joe 10/13, mock-up A): each scan of a delivery saves itself; an unknown barcode is named once.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const { applyAction } = require('../../src/actions');
const D = require('../../src/demo-sheets');
const PD = require('../fixtures/plant-demo');

const DISPATCHER = { email: 'dispatch.test@uniteddairy.com' }, MANAGER = { email: 'manager.test@uniteddairy.com' };
const GS = String.fromCharCode(29);
let n = 0;
const rid = () => 'recv-request-' + (++n) + '-' + Date.now();
const tick = () => new Date('2026-10-08T16:00:00Z');
const copy = () => runTransfer({ db: db(), reader: D.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: tick });
const scan = (fields) => applyAction(db(), DISPATCHER, Object.assign({ action: 'saveReceivingScan', requestId: rid() }, fields), tick);
const item = (fields) => applyAction(db(), MANAGER, Object.assign({ action: 'saveReceivingItem', requestId: rid() }, fields), tick);
const line = async (id) => (await db().collection('receivingScans').doc(id).get()).data();

test.beforeEach(async () => { await clear(); await copy(); });

test('a pallet label saves the item code, lot, dates and count against the delivery', async () => {
  const out = await scan({ op: 'scan', scanId: 'scan-aaaa-0001', deliveryId: 'RECV-k1', raw: ']C10110614141000415' + '11261001' + '17270401' + '3712' + GS + '10C2610A', station: 'Boxing' });
  assert.equal(out.kind, 'GS1');
  assert.equal(out.count, 12);
  const s = await line('scan-aaaa-0001');
  assert.deepEqual([s.gtin, s.lot, s.made, s.bestBy, s.count, s.labelCount, s.itemId, s.status], ['10614141000415', 'C2610A', '2026-10-01', '2027-04-01', 12, 12, '', 'ACTIVE']);
  assert.equal(s.deliveryId, 'RECV-k1');
  assert.ok(s.supplier, 'the supplier comes from the delivery');
  assert.equal(s.by, DISPATCHER.email);
  // The same scan sent twice (a retry) is refused, not doubled.
  await assert.rejects(scan({ op: 'scan', scanId: 'scan-aaaa-0001', deliveryId: 'RECV-k1', raw: '036000291452' }), /already saved/);
  await assert.rejects(scan({ op: 'scan', scanId: 'scan-aaaa-0002', deliveryId: 'RECV-nope', raw: '036000291452' }), /no longer on the Receiving schedule/);
});

test('an unknown barcode is named once; the next scan of it knows the item', async () => {
  await scan({ op: 'scan', scanId: 'scan-bbbb-0001', deliveryId: 'RECV-k1', raw: '036000291452' });
  await scan({ op: 'scan', scanId: 'scan-bbbb-0002', deliveryId: 'RECV-k1', raw: '036000291452' });
  await assert.rejects(scan({ op: 'name', scanId: 'scan-bbbb-0001' }), /Pick the item/);
  const named = await scan({ op: 'name', scanId: 'scan-bbbb-0001', newItem: 'Gallon caps, white 38mm' });
  assert.equal(named.itemName, 'Gallon caps, white 38mm');
  assert.equal((await line('scan-bbbb-0002')).itemId, named.itemId, 'the same barcode on the delivery takes the item too');
  const later = await scan({ op: 'scan', scanId: 'scan-bbbb-0003', deliveryId: 'RECV-v1', raw: '0 36000 29145 2' });
  assert.equal(later.itemName, 'Gallon caps, white 38mm');
  // Typing a name already on the list uses that item.
  await scan({ op: 'scan', scanId: 'scan-bbbb-0004', deliveryId: 'RECV-k1', raw: 'L77-CUSTOM' });
  const again = await scan({ op: 'name', scanId: 'scan-bbbb-0004', newItem: 'gallon caps, white 38MM' });
  assert.equal(again.itemId, named.itemId);
  const it = (await db().collection('receivingItems').doc(named.itemId).get()).data();
  assert.deepEqual(it.barcodes, ['00036000291452', 'TEXT:L77-CUSTOM']);
});

test('− and + change a line, 0 or Remove takes it off; items are renamed or removed from the office', async () => {
  await scan({ op: 'scan', scanId: 'scan-cccc-0001', deliveryId: 'RECV-k1', raw: '036000291452' });
  assert.equal((await scan({ op: 'add', scanId: 'scan-cccc-0001', delta: 4 })).count, 5);
  assert.equal((await scan({ op: 'count', scanId: 'scan-cccc-0001', count: 20 })).count, 20);
  assert.equal((await scan({ op: 'add', scanId: 'scan-cccc-0001', delta: -20 })).status, 'REMOVED');
  await assert.rejects(scan({ op: 'add', scanId: 'scan-cccc-0001', delta: 1 }), /was removed/);
  await scan({ op: 'scan', scanId: 'scan-cccc-0002', deliveryId: 'RECV-k1', raw: '036000291452' });
  assert.equal((await scan({ op: 'remove', scanId: 'scan-cccc-0002' })).status, 'REMOVED');
  // Items.
  await scan({ op: 'scan', scanId: 'scan-cccc-0003', deliveryId: 'RECV-k1', raw: '4006381333931' });
  const a = await scan({ op: 'name', scanId: 'scan-cccc-0003', newItem: 'Cocoa powder' });
  await scan({ op: 'scan', scanId: 'scan-cccc-0004', deliveryId: 'RECV-k1', raw: '96385074' });
  await scan({ op: 'name', scanId: 'scan-cccc-0004', newItem: 'Stretch wrap' });
  await assert.rejects(applyAction(db(), DISPATCHER, { action: 'saveReceivingItem', requestId: rid(), op: 'remove', itemId: a.itemId }), /does not have a role/);
  await assert.rejects(item({ op: 'edit', itemId: a.itemId, name: 'stretch wrap' }), /already on the list/);
  assert.equal((await item({ op: 'edit', itemId: a.itemId, name: 'Cocoa powder, 50 lb bag' })).name, 'Cocoa powder, 50 lb bag');
  assert.equal((await item({ op: 'remove', itemId: a.itemId })).status, 'REMOVED');
  // A removed item is no longer matched.
  assert.equal((await scan({ op: 'scan', scanId: 'scan-cccc-0005', deliveryId: 'RECV-k1', raw: '4006381333931' })).itemId, '');
});

'use strict';
// Machine Products (Joe 10/10): a manager or administrator replaces one machine's product list (the Quality check's Product
// drop-down); a dispatcher may not, a product name may not be on the list twice, and the machine must be set up.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const { applyAction } = require('../../src/actions');
const D = require('../../src/demo-sheets');
const PD = require('../fixtures/plant-demo');

let n = 0;
const rid = () => 'products-request-' + (++n) + '-' + Date.now();
const act = (email, fields) => applyAction(db(), { email }, Object.assign({ action: 'saveMachineProducts', requestId: rid() }, fields));
const MANAGER = 'manager.test@uniteddairy.com', DISPATCHER = 'dispatch.test@uniteddairy.com';

test.beforeEach(async () => {
  await clear();
  await runTransfer({ db: db(), reader: D.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date('2026-10-08T16:00:00Z') });
});

test('A manager saves a machine\'s products; blank rows drop out and the change is logged', async () => {
  const list = [{ name: 'GV 2% Gallon', sku: '280305', mfgType: 'Gallon', productGroup: 'Milk' }, { name: 'Jersey 2% Gallon', sku: '280305', mfgType: 'Gallon', productGroup: 'Milk' }, { name: '  ', sku: '1' }];
  const done = await act(MANAGER, { operationId: 'ut_prod_gallon_filler', products: list });
  assert.equal(done.count, 2);
  const saved = (await db().collection('plantProducts').doc('ut_prod_gallon_filler').get()).data();
  assert.deepEqual(saved.products.map(p => p.name), ['GV 2% Gallon', 'Jersey 2% Gallon'], 'GV and Jersey stay two products even with one SKU');
  assert.equal(saved.line, 'GALLON FILLER');
  assert.equal(saved.updatedBy, MANAGER);
  const log = (await db().collection('actions').where('action', '==', 'saveMachineProducts').get()).docs.map(d => d.data());
  assert.equal(log.length, 1);
});

test('Refused: a dispatcher, a name twice, a machine not set up', async () => {
  await assert.rejects(act(DISPATCHER, { operationId: 'ut_prod_totes', products: [] }), /does not have a role/);
  await assert.rejects(act(MANAGER, { operationId: 'ut_prod_totes', products: [{ name: 'Tote milk' }, { name: 'TOTE MILK' }] }), /on the list twice/);
  await assert.rejects(act(MANAGER, { operationId: 'ut_prod_nowhere', products: [] }), /not set up/);
});

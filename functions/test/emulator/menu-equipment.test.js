'use strict';
// Joe 10/25: Plant Maintenance's Equipment (its own list beside Machinery, on the same records so work orders and PMs work the
// same) and Administration > Menu Setup (each plant puts its plant sides' menus in its own order).
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const { applyAction } = require('../../src/actions');
const D = require('../../src/demo-sheets');
const PD = require('../fixtures/plant-demo');
const R = require('../../src/pmaint-rules');
const L = require('../../src/logic');

let n = 0;
const rid = () => 'menu-equip-request-' + (++n) + '-' + Date.now();
const ADMIN = 'admin.test@uniteddairy.com', MANAGER = 'manager.test@uniteddairy.com';
const act = (email, action, fields) => applyAction(db(), { email }, Object.assign({ action, requestId: rid(), facilityId: 'fac_uniontown' }, fields));

test.beforeEach(async () => {
  await clear();
  await runTransfer({ db: db(), reader: D.fakeReader(PD.plantSheets()), sources: PD.PLANT_SOURCES, now: () => new Date('2026-10-08T14:00:00Z') });
});

test('Equipment: added to its own list, keeps it when edited, and is not on Machinery', async () => {
  const comp = await act(MANAGER, 'saveMachine', { group: 'EQUIPMENT', fields: { name: 'Air Compressor', kind: 'Air Compressor', area: 'Utilities' } });
  assert.match(comp.message, /equipment list/);
  await act(MANAGER, 'saveMachine', { machineId: comp.machineId, fields: { make: 'Quincy' } });
  const press = await act(MANAGER, 'saveMachine', { fields: { name: 'Case Press' } });
  const saved = (await db().collection('plantMachines').get()).docs.map(d => Object.assign({ id: d.id }, d.data()));
  const all = R.machines([], saved, 'fac_uniontown');
  assert.deepEqual(all.filter(m => m.group === 'EQUIPMENT').map(m => [m.name, m.make]), [['Air Compressor', 'Quincy']]);
  assert.equal(all.find(m => m.id === press.machineId).group, 'MACHINERY');
  await assert.rejects(act(MANAGER, 'saveMachine', { fields: { name: 'air compressor' } }), /already on this plant's equipment list/);
  await assert.rejects(act(MANAGER, 'saveMachine', { group: 'TOOLS', fields: { name: 'Drill' } }), /Machinery or Equipment/);
});

test('Menu Setup: an administrator moves and reorders sections; a side keeps its own screens on top; Start Over puts it back', async () => {
  const r = await act(ADMIN, 'saveMenuSetup', { sides: { plant: ['Yard Checks', 'Send Report', 'Plant Distribution Departments', 'Plant Distribution Scheduler', 'Shift Notes', 'Cooler Temperature'], production: ['Quality Checks', 'Shift Notes'] } });
  assert.deepEqual(r.sides.plant, ['Yard Checks', 'Send Report', 'Plant Distribution Departments', 'Plant Distribution Scheduler', 'Shift Notes', 'Cooler Temperature']);
  assert.deepEqual(r.sides.production, ['Production Lines', 'Quality Checks', 'Shift Notes']);
  const doc = (await db().collection('menuSetup').doc('fac_uniontown').get()).data();
  assert.deepEqual(doc.sides, r.sides);
  // Nothing drops off the menu: a section left off every side goes back where the app puts it.
  assert.ok(L.menuArrange({ plant: ['Send Report'] }).plant.indexOf('Yard Checks') >= 0);
  await assert.rejects(act(ADMIN, 'saveMenuSetup', { sides: { plant: ['Daily Dispatch'] } }), /Unknown menu item/);
  await assert.rejects(act(ADMIN, 'saveMenuSetup', { sides: { route: [] } }), /Unknown side/);
  await assert.rejects(act(MANAGER, 'saveMenuSetup', { sides: { plant: ['Send Report'] } }));
  await act(ADMIN, 'saveMenuSetup', { reset: true });
  assert.equal((await db().collection('menuSetup').doc('fac_uniontown').get()).exists, false);
});

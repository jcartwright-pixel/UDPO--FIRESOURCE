'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const { runFleetSync } = require('../../src/fleetsync');
const F = require('../fixtures/fake-sheets');

const H = ['equipment_id', 'equipment_type', 'unit_id', 'facility_id', 'location', 'status', 'assignment_class', 'source_present', 'last_source_sync_at', 'notes', 'version', 'created_at', 'created_by', 'updated_at', 'updated_by'];
const row = (o) => H.map(k => o[k] || '');
const FLEET = { spreadsheetId: 'fake-fleet', tab: 'Complete 2025 List of Units' };
const TARGET = { spreadsheetId: 'fake-equipment', tab: 'EQUIPMENT_MASTER' };
const now = () => new Date('2026-10-11T06:00:00Z');

let tabs, sheets;
test.beforeEach(async () => {
  await clear();
  tabs = F.fakeSheets();
  tabs["'EQUIPMENT_MASTER'"] = [H,
    row({ equipment_id: 'veh_truck_900001', equipment_type: 'TRUCK', unit_id: '900001', facility_id: 'fac_uniontown', location: 'UNIONTOWN', status: 'ACTIVE', source_present: 'TRUE' }),
    row({ equipment_id: 'veh_truck_900002', equipment_type: 'TRUCK', unit_id: '900002', facility_id: 'fac_uniontown', location: 'UNIONTOWN', status: 'ACTIVE', source_present: 'TRUE' }),
    row({ equipment_id: 'veh_trailer_t_901', equipment_type: 'TRAILER', unit_id: 'T-901', facility_id: 'fac_uniontown', location: 'UNIONTOWN', status: 'DOWN', source_present: 'TRUE', notes: 'DOWN: brakes' }),
    row({ equipment_id: 'veh_trailer_t_902', equipment_type: 'TRAILER', unit_id: 'T-902', facility_id: 'fac_uniontown', location: 'UNIONTOWN', status: 'ACTIVE', source_present: 'TRUE' })
  ];
  tabs["'" + FLEET.tab + "'"] = [['UD UNIT', 'ASSET TYPE', 'LOCATION', 'MAKE'],
    ['900001', 'Tractor', 'UNIONTOWN', 'Mack'], ['T-901', 'Trailer', 'UNIONTOWN', 'Utility'], ['T-902', 'Trailer', 'UNIONTOWN', 'Utility'],
    ['T-950', 'Trailer', 'UNIONTOWN', 'Wabash'], ['670', 'Yard Truck', 'UNIONTOWN', 'Kalmar']];
  sheets = F.fakeWritableSheets(tabs);
  await runTransfer({ db: db(), reader: sheets, sources: F.SOURCES, now });
});

test('fleet sync writes only the sandbox Equipment Master copy, records when it ran, and the next copy shows the changes', async () => {
  const result = await runFleetSync({ db: db(), reader: sheets, sheets, target: TARGET, fleet: FLEET, by: 'manager.test@uniteddairy.com', now });
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.added, ['T-950']);
  assert.deepEqual(result.inactive, ['900002']);
  assert.deepEqual(result.yard, ['670']);
  assert.ok(sheets.writes.every(w => w.spreadsheetId === 'fake-equipment'), 'only the Equipment Master copy is written');
  const saved = (await db().collection('config').doc('fleetSync').get()).data();
  assert.equal(saved.at, '2026-10-11T06:00:00.000Z');
  assert.equal(saved.by, 'manager.test@uniteddairy.com');
  await runTransfer({ db: db(), reader: sheets, sources: F.SOURCES, now: () => new Date('2026-10-11T06:01:00Z') });
  const eq = {};
  (await db().collection('equipment').get()).docs.forEach(d => { eq[d.data().unit] = d.data(); });
  assert.equal(eq['900002'].status, 'INACTIVE');
  assert.equal(eq['T-901'].status, 'DOWN');
  assert.equal(eq['T-950'].status, 'ACTIVE');
  assert.equal(eq['670'], undefined);
});

test('fleet sync refuses a production sheet and never writes the fleet list', async () => {
  const prod = await runFleetSync({ db: db(), reader: sheets, sheets, target: { spreadsheetId: '1eqZxqZNQs5gwuaRmQgPRbNvSmy7gOnwwwyoqFS3Djb4', tab: 'EQUIPMENT_MASTER' }, fleet: FLEET, now });
  assert.equal(prod.ok, false);
  assert.match(prod.error, /production/);
  const self = await runFleetSync({ db: db(), reader: sheets, sheets, target: { spreadsheetId: '1fASsuj4EYl38yJJb-XlLi0D5nxcmGwE6MBWtRTTP3xc', tab: 'x' }, now });
  assert.equal(self.ok, false);
  assert.equal(sheets.writes.length, 0);
  assert.equal((await db().collection('config').doc('fleetSync').get()).data().ok, false);
});

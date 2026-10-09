'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../../src/transfer');
const L = require('../../src/logic');
const F = require('../fixtures/fake-sheets');

function masters() {
  const tabs = F.fakeSheets();
  return {
    drivers: T.parseMaster('drivers', tabs["'DRIVERS_MASTER'"]),
    equipment: T.parseMaster('equipment', tabs["'EQUIPMENT_MASTER'"]),
    routes: T.parseMaster('routes', tabs["'ROUTES_MASTER'"]),
    users: T.parseMaster('users', tabs["'USERS_MASTER'"])
  };
}

test('master lists are read by their ID column', () => {
  const m = masters();
  assert.equal(m.drivers.docs.drv_test_adams.name, 'ADAMS, PAT');
  assert.equal(m.equipment.docs.veh_trailer_t_901.unit, 'T-901');
  assert.equal(m.equipment.docs.veh_trailer_t_901.type, 'TRAILER');
  assert.equal(m.routes.docs.run_t802.weekOrder, 1);
  assert.deepEqual(m.users.docs['manager.test@uniteddairy.com'].roles, ['MANAGER']);
});

test('a Live week tab becomes one run per row, keyed by run_id', () => {
  const tabs = F.fakeSheets();
  const tab = T.parseLiveTab('LIVE CURRENT WEEK', tabs["'LIVE CURRENT WEEK'"], T.lookupsFrom(masters()));
  assert.equal(tab.weekStart, '2026-10-04');
  const ids = Object.keys(tab.runs).sort();
  assert.deepEqual(ids, ['2026-10-04__run_t801', '2026-10-04__run_t802', '2026-10-04__run_t810__sat', '2026-10-04__run_t810__wed', '2026-10-04__run_t898', '2026-10-04__run_t899']);
  const r801 = tab.runs['2026-10-04__run_t801'];
  assert.equal(r801.route, '801');
  assert.equal(r801.weekOrder, 2);
  assert.equal(r801.days.mon.driverId, 'drv_test_adams');
  assert.equal(r801.days.mon.trailer, 'T-901');
  assert.equal(r801.days.mon.dispatchTime, 240);
  assert.equal(r801.days.mon.loadDayOffset, -1);
  assert.equal(r801.days.sun.runs, false);
  // Every non-blank cell is kept word for word.
  assert.equal(r801.cells.mon_trailer_id, 'veh_trailer_t_901');
  assert.equal(r801.cells.route_status, 'ACTIVE');
});

test('dates written as 10/5/2026 or 2026-10-05 read the same', () => {
  const tabs = F.fakeSheets();
  const tab = T.parseLiveTab('LIVE CURRENT WEEK', tabs["'LIVE CURRENT WEEK'"], T.lookupsFrom(masters()));
  assert.equal(tab.runs['2026-10-04__run_t802'].cells.mon_delivery_date, '10/5/2026');
  assert.equal(tab.runs['2026-10-04__run_t802'].days.mon.deliveryDate, '2026-10-05');
  assert.equal(tab.runs['2026-10-04__run_t801'].days.mon.deliveryDate, '2026-10-05');
});

test('a driver name in the driver ID column is matched to the driver and listed', () => {
  const tabs = F.fakeSheets();
  const tab = T.parseLiveTab('LIVE CURRENT WEEK', tabs["'LIVE CURRENT WEEK'"], T.lookupsFrom(masters()));
  const tue = tab.runs['2026-10-04__run_t801'].days.tue;
  assert.equal(tue.driverId, 'drv_test_brook');
  assert.equal(tue.driverIdInSheet, 'BROOK SAM');
  assert.ok(tab.warnings.some(w => w.fixed && /BROOK SAM/.test(w.problem)));
});

test('the week comes from the rows; a stale Week Start label is reported', () => {
  const tabs = F.fakeSheets();
  const tab = T.parseLiveTab('LIVE CURRENT WEEK', tabs["'LIVE CURRENT WEEK'"], T.lookupsFrom(masters()));
  assert.ok(tab.warnings.some(w => /Week Start label says 2026-09-27/.test(w.problem)));
});

test('row keys do not change when the rows are sorted', () => {
  const tabs = F.fakeSheets();
  const values = tabs["'LIVE CURRENT WEEK'"];
  const shuffled = values.slice(0, 6).concat(values.slice(6).reverse());
  const lookups = T.lookupsFrom(masters());
  const a = T.parseLiveTab('LIVE CURRENT WEEK', values, lookups), b = T.parseLiveTab('LIVE CURRENT WEEK', shuffled, lookups);
  assert.deepEqual(Object.keys(a.runs).sort(), Object.keys(b.runs).sort());
  Object.keys(a.runs).forEach(id => {
    assert.deepEqual(a.runs[id].days, b.runs[id].days, id);
    assert.equal(a.runs[id].fingerprint, b.runs[id].fingerprint, id);
  });
});

test('two rows with the same run and the same days are flagged, not merged', () => {
  const tabs = F.fakeSheets();
  const values = tabs["'LIVE CURRENT WEEK'"].slice();
  values.push(values[6].slice());
  const tab = T.parseLiveTab('LIVE CURRENT WEEK', values, T.lookupsFrom(masters()));
  assert.ok(tab.runs['2026-10-04__run_t801__mon-tue__2']);
  assert.ok(tab.warnings.some(w => /more than one row/.test(w.problem)));
});

test('a missing key column stops the transfer with a plain message', () => {
  const tabs = F.fakeSheets();
  const values = tabs["'LIVE CURRENT WEEK'"].map(r => r.slice());
  values[5][values[5].indexOf('run_id')] = 'runid';
  assert.throws(() => T.parseLiveTab('LIVE CURRENT WEEK', values), /column run_id is missing/);
});

test('the parsed tab feeds the same Daily list rules', () => {
  const tabs = F.fakeSheets();
  const lookups = T.lookupsFrom(masters());
  const runs = [];
  ['LIVE CURRENT WEEK', 'LIVE NEXT WEEK'].forEach(name => {
    const tab = T.parseLiveTab(name, tabs["'" + name + "'"], lookups);
    Object.keys(tab.runs).forEach(id => runs.push(Object.assign({ id }, tab.runs[id])));
  });
  // Monday 10/5 loads Tuesday deliveries: 801 (seq 20) before 802 (override 30).
  assert.deepEqual(L.dailyRows(runs, '2026-10-05').map(r => r.route), ['801', '802']);
  // Thursday 10/8 loads Saturday's 810 (two days early) and Friday nothing.
  assert.deepEqual(L.dailyRows(runs, '2026-10-08').map(r => r.runDocId), ['2026-10-04__run_t810__sat']);
  // Saturday 10/10 loads next week's Monday? No: Monday loads Sunday. Sunday 10/11 loads Monday 10/12.
  assert.deepEqual(L.dailyRows(runs, '2026-10-11').map(r => r.route), ['802', '801']);
});

test('SOURCES_JSON can point the copy at a Live workbook copy and keeps the real masters', () => {
  const { transferSources, UNIONTOWN } = require('../../src/sources');
  assert.equal(transferSources({}), UNIONTOWN);
  const s = transferSources({ SOURCES_JSON: '{"live":{"spreadsheetId":"sandbox-copy"}}' });
  assert.equal(s.live.spreadsheetId, 'sandbox-copy');
  assert.deepEqual(s.masters, UNIONTOWN.masters);
});

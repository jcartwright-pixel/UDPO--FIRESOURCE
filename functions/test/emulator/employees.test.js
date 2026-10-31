'use strict';
// Employees list from UDMS (Joe 10/31, mock-ups 1 to 4): only name, employee ID, position, hire date and phone come over;
// Add Driver and the schedules' + Add Person pick from the list; the people already on them follow UDMS.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const { runTransfer } = require('../../src/transfer');
const { applyAction } = require('../../src/actions');
const EMP = require('../../src/employees');
const F = require('../fixtures/fake-sheets');

const UDMS_DB = 'udms-test';
// UDMS's own database (made up here): its lists are not this app's, so the list guard leaves it alone.
const udms = () => { db(); return require('../../src/list-guard').outsideDb(require('firebase-admin/firestore').getFirestore(UDMS_DB)); };
let n = 0;
const rid = () => 'emp-request-' + (++n) + '-' + Date.now();
const MANAGER = { email: 'manager.test@uniteddairy.com' };
const sync = (now) => EMP.runEmployeeSync({ udmsDb: udms(), plantDbs: { fac_uniontown: db() }, now: () => new Date(now || '2026-10-31T12:00:00Z') });

// A made-up UDMS record with the private fields UDMS keeps on it; none of them may reach Operations.
const person = (id, first, last, more) => Object.assign({
  firstName: first, lastName: last, phone: '(330) 555-01' + id.slice(-2), dob: '1980-01-01', ssn: '123-45-6789',
  address: { line1: '1 Made Up Lane', city: 'Nowhere', zip: '00000' }, masterRow: { DOB: '1/1/1980', 'Address Line 1': '1 Made Up Lane' },
  emergencyContacts: [{ name: 'Pat Example', phone: '330-555-0000' }],
  current: { employeeId: id, jobTitle: 'Driver', hireDate: '2026-10-20', location: 'Uniontown PA Branch', workStatus: 'Active', active: true }
}, more || {});

test.beforeEach(async () => {
  await clear();
  await fetch('http://' + process.env.FIRESTORE_EMULATOR_HOST + '/emulator/v1/projects/demo-ud-distribution/databases/' + UDMS_DB + '/documents', { method: 'DELETE' });
  await runTransfer({ db: db(), reader: F.fakeReader(F.fakeSheets()), sources: F.SOURCES, now: () => new Date('2026-10-09T12:00:00Z') });
});

test('the copy brings only the safe fields, for the plant\'s own branch, and marks people who left', async () => {
  const u = udms();
  await u.collection('people').doc('p1').set(person('010877', 'Riley', 'Kemp'));
  await u.collection('people').doc('p2').set(person('10881', 'Casey', 'Lane', { current: { employeeId: '10881', jobTitle: 'Loader', hireDate: '2026-10-27', location: 'Uniontown PA Branch', workStatus: 'Active', active: true } }));
  await u.collection('people').doc('p3').set(person('20001', 'Avery', 'Other', { current: { employeeId: '20001', jobTitle: 'Driver', location: 'Beckley WV Branch', workStatus: 'Active', active: true } }));
  const out = await sync();
  assert.equal(out.ok, true);
  const list = (await db().collection('employees').get()).docs.map(d => d.data());
  assert.deepEqual(list.map(e => e.name).sort(), ['KEMP, RILEY', 'LANE, CASEY'], 'only Uniontown\'s branch');
  const kemp = list.find(e => e.employeeId === '010877');
  assert.equal(kemp.idKey, '10877');
  assert.equal(kemp.phone, '330-555-0177');
  assert.equal(kemp.hireDate, '2026-10-20');
  assert.equal(kemp.position, 'Driver');
  const text = JSON.stringify(list);
  ['1980', '123-45', 'Made Up Lane', 'Nowhere', 'Pat Example', 'dob', 'ssn', 'address', 'masterRow'].forEach(w => assert.ok(text.indexOf(w) < 0, w + ' never reaches Operations'));
  assert.equal((await db().collection('config').doc('employees').get()).data().ok, true);

  // Someone who leaves in UDMS stays on the list, marked Left with the day.
  await u.collection('people').doc('p2').set({ current: { employeeId: '10881', workStatus: 'Terminated', active: false, termDate: '2026-10-30', location: 'Uniontown PA Branch', jobTitle: 'Loader', hireDate: '2026-10-27' } }, { merge: true });
  await sync('2026-10-31T12:15:00Z');
  const lane = (await db().collection('employees').doc(EMP.docId('10881')).get()).data();
  assert.equal(lane.active, false);
  assert.equal(lane.leftDate, '2026-10-30');
});

test('Add Driver picks an employee: the name, ID and hire date come from the list, the phone fills in; a second add is refused', async () => {
  await udms().collection('people').doc('p1').set(person('10877', 'Riley', 'Kemp'));
  await sync();
  const out = await applyAction(db(), MANAGER, { action: 'saveDriver', requestId: rid(), employeeId: '10877', name: 'typed wrong', hireDate: '2000-01-01', seniorityDate: '', truck: '', relief: false, phone: '330-555-0199' });
  const d = (await db().collection('drivers').doc(out.driverId).get()).data();
  assert.equal(d.name, 'KEMP, RILEY');
  assert.equal(d.employeeId, '10877');
  assert.equal(d.hireDate, '2026-10-20');
  assert.equal(d.seniorityDate, '2026-10-20', 'seniority starts at the hire date');
  assert.equal((await db().collection('driverPhones').doc(out.driverId).get()).data().phone, '330-555-0199');
  await assert.rejects(applyAction(db(), MANAGER, { action: 'saveDriver', requestId: rid(), employeeId: '10877', truck: '', relief: false }), /already on the Driver Roster/);
  await assert.rejects(applyAction(db(), MANAGER, { action: 'saveDriver', requestId: rid(), employeeId: '99999', truck: '', relief: false }), /not on the Employees list/);
  // A hire date fixed in UDMS follows onto the driver.
  await udms().collection('people').doc('p1').set({ current: { hireDate: '2026-10-21' } }, { merge: true });
  await sync('2026-10-31T12:15:00Z');
  assert.equal((await db().collection('drivers').doc(out.driverId).get()).data().hireDate, '2026-10-21');
});

test('+ Add Person picks an employee for the plant schedule; the picked boxes follow UDMS', async () => {
  await udms().collection('people').doc('p2').set(person('10881', 'Casey', 'Lane'));
  await sync();
  const act = (fields) => applyAction(db(), MANAGER, Object.assign({ action: 'saveCrewSetup', requestId: rid(), facilityId: 'fac_uniontown', team: 'plant', op: 'person' }, fields));
  const p = await act({ fields: { employeeId: '10881' } });
  let row = (await db().collection('crewPeople').doc(p.id).get()).data();
  assert.deepEqual([row.name, row.employeeId, row.phone, row.hireDate], ['LANE, CASEY', '10881', '330-555-0181', '2026-10-20']);
  await assert.rejects(act({ fields: { employeeId: '10881' } }), /already on this list/);
  // Typing over a gray box does not change it; UDMS does.
  await act({ id: p.id, fields: { name: 'SOMEONE ELSE' } });
  assert.equal((await db().collection('crewPeople').doc(p.id).get()).data().name, 'LANE, CASEY');
  await udms().collection('people').doc('p2').set({ phone: '330-555-0222' }, { merge: true });
  await sync('2026-10-31T12:15:00Z');
  row = (await db().collection('crewPeople').doc(p.id).get()).data();
  assert.equal(row.phone, '330-555-0222');
});

test('a failed read says so in plain words and changes nothing', async () => {
  const broken = { collection: () => ({ select: () => ({ get: async () => { throw new Error('7 PERMISSION_DENIED: Missing or insufficient permissions.'); } }) }) };
  const out = await EMP.runEmployeeSync({ udmsDb: broken, plantDbs: { fac_uniontown: db() } });
  assert.equal(out.ok, false);
  const s = (await db().collection('config').doc('employees').get()).data();
  assert.equal(s.ok, false);
  assert.equal(s.problem, 'Waiting for permission to read UDMS.');
  assert.equal((await db().collection('employees').get()).size, 0);
});

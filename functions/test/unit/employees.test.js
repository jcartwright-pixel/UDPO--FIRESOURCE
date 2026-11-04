'use strict';
// Employees list from UDMS (Joe 10/31): only the safe fields are ever asked of UDMS or kept.
const test = require('node:test');
const assert = require('node:assert/strict');
const EMP = require('../../src/employees');

test('the UDMS read asks for no private field', () => {
  EMP.UDMS_FIELDS.forEach(f => assert.ok(!EMP.PRIVATE.test(f), f + ' is not private'));
  ['dob', 'ssn', 'address.line1', 'masterRow', 'emergencyContacts', 'driver.licenseNumber'].forEach(f => assert.ok(EMP.UDMS_FIELDS.indexOf(f) < 0));
});

test('pick keeps name, employee ID, position, hire date, phone, branch and status only', () => {
  const e = EMP.pick({ firstName: 'Riley', lastName: 'Kemp', phone: '3305550199', dob: '1980-01-01', ssn: 'x', address: { line1: 'y' },
    current: { employeeId: '010877', jobTitle: 'Driver', hireDate: '2026-10-20', location: 'Uniontown PA Branch', workStatus: 'Active', active: true } });
  assert.deepEqual(Object.keys(e).sort(), ['active', 'branch', 'employeeId', 'hireDate', 'leftDate', 'name', 'phone', 'position', 'status', 'udmsId']);
  assert.equal(e.name, 'KEMP, RILEY');
  assert.equal(e.phone, '330-555-0199');
  assert.equal(EMP.pick({ firstName: 'No', lastName: 'Id', current: {} }), null, 'no Employee ID and no UDMS record, nothing to key it by');
  // Joe 11-4-26: someone with no employee ID in UDMS is still on the list, keyed by their UDMS record.
  const noId = EMP.pick({ firstName: 'No', lastName: 'Id', current: { workStatus: 'Active' } }, 'udmsRec1');
  assert.equal(noId.employeeId, '');
  assert.equal(noId.udmsId, 'udmsRec1');
  assert.equal(noId.active, true);
  assert.equal(EMP.keyOf(noId), 'UDMS_UDMSREC1');
  // A name typed into the ID box is no ID.
  assert.equal(EMP.pick({ firstName: 'Sam', lastName: 'Made', current: { employeeId: 'MADE SAM' } }, 'r2').employeeId, '');
  assert.equal(EMP.realId('MADE SAM'), '');
  assert.equal(EMP.realId('010877'), '010877');
  assert.equal(EMP.pick({ lastName: 'Gone', current: { employeeId: '5', workStatus: 'Terminated', termDate: '2026-10-30' } }).status, 'LEFT');
});

test('a UDMS branch belongs to its plant', () => {
  assert.equal(EMP.plantOfBranch('Uniontown PA Branch'), 'fac_uniontown');
  assert.equal(EMP.plantOfBranch('Martins Ferry OH Branch'), 'fac_martins_ferry');
  assert.equal(EMP.plantOfBranch('Charleston WV Branch'), 'fac_charleston');
  assert.equal(EMP.plantOfBranch('Beckley WV Branch'), '');
  assert.equal(EMP.idKey('010877'), '10877');
  assert.equal(EMP.udmsDatabase('ud-distribution'), '(default)');
  assert.equal(EMP.udmsDatabase('ud-distribution-sandbox'), 'sandbox');
});

// Joe 11-4-26: one list of departments; DOCK is its own department (dock workers are not drivers).
const DEPT = require('../../src/departments');
test('the department list has DOCK apart from DRIVER, all in capitals, no doubles', () => {
  assert.ok(DEPT.DEPARTMENTS.indexOf('DOCK') >= 0 && DEPT.DEPARTMENTS.indexOf('DRIVER') >= 0);
  DEPT.DEPARTMENTS.forEach(d => assert.equal(d, d.toUpperCase()));
  assert.equal(new Set(DEPT.DEPARTMENTS).size, DEPT.DEPARTMENTS.length);
});
test('a job title or a typed department lands on the list', () => {
  [['Dock Worker', 'DOCK'], ['dock driver', 'DOCK'], ['Driver', 'DRIVER'], ['CDL Route Driver', 'DRIVER'], ['drivers', 'DRIVER'], ['Loader', 'LOADOUT'],
    ['Filler Operator', 'PRODUCTION'], ['Mechanic', 'PLANT MAINTENANCE'], ['Garage Mechanic', 'GARAGE'], ['Dispatcher', 'DISPATCH'], ['Shipping Clerk', 'SHIPPING & RECEIVING'],
    ['Lab Technician', 'QUALITY / LAB'], ['Sanitation', 'SANITATION'], ['Plant Manager', 'MANAGEMENT'], ['shipping and receiving', 'SHIPPING & RECEIVING'], ['quality', 'QUALITY / LAB'],
    ['', ''], ['Something Else', '']].forEach(([job, want]) => assert.equal(DEPT.guess(job), want, job));
});
test('the department follows the job title until someone picks one; a pick is kept', () => {
  assert.deepEqual(EMP.departmentOf(null, 'Dock Worker'), { department: 'DOCK', departmentBy: 'JOB TITLE' });
  assert.deepEqual(EMP.departmentOf(null, 'Something Else'), { department: '', departmentBy: '' });
  assert.equal(EMP.departmentOf({ department: 'DOCK', departmentBy: 'HAND' }, 'Driver').department, 'DOCK', 'a pick by hand wins over UDMS');
  assert.equal(EMP.departmentOf({ department: 'DRIVER', departmentBy: 'JOB TITLE' }, 'Dock Worker').department, 'DOCK', 'a guess follows the new job title');
  const E = class extends Error { constructor(code, msg) { super(msg); this.code = code; } };
  assert.throws(() => EMP.validateDepartment({ employeeId: '1', department: 'DOCK WORKERS' }, E), /not one of the departments/);
  assert.deepEqual(EMP.validateDepartment({ employeeId: '1', department: 'DOCK' }, E), { employeeId: '1', department: 'DOCK' });
  assert.deepEqual(EMP.validateDepartment({ employeeId: '1', department: '' }, E), { employeeId: '1', department: '' });
});

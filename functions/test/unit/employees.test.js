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
  assert.deepEqual(Object.keys(e).sort(), ['active', 'branch', 'employeeId', 'hireDate', 'leftDate', 'name', 'phone', 'position', 'status']);
  assert.equal(e.name, 'KEMP, RILEY');
  assert.equal(e.phone, '330-555-0199');
  assert.equal(EMP.pick({ firstName: 'No', lastName: 'Id', current: {} }), null, 'no Employee ID, not on the list');
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

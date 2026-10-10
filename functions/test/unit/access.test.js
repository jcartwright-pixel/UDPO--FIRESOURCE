'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const L = require('../../src/logic');
const T = require('../../src/transfer');

// Joe 10/10: each person sees the plants they are allowed (USERS_MASTER facility_ids_json); someone limited to one plant
// (a supervisor such as Brian Bircher, Uniontown) only ever sees that plant; Administrators see every plant and the
// all-plants overview, and jcartwright@uniteddairy.com is always an Administrator, as in the current app.
const person = (roles, facilities) => ({ status: 'ACTIVE', roles, facilities });

test('the plant list decides which plants a person sees', () => {
  assert.deepEqual(L.plantsFor(person(['SUPERVISOR'], ['fac_uniontown'])), ['fac_uniontown']);
  assert.deepEqual(L.plantsFor(person(['SUPERVISOR'], [])), ['fac_uniontown'], 'no list: Uniontown');
  assert.deepEqual(L.plantsFor(person(['MANAGER'], ['*'])), ['fac_uniontown', 'fac_charleston', 'fac_martins_ferry']);
  assert.deepEqual(L.plantsFor(person(['ADMINISTRATOR'], [])), ['fac_uniontown', 'fac_charleston', 'fac_martins_ferry'], 'an Administrator with no list sees every plant');
  assert.deepEqual(L.plantsFor(person(['ADMINISTRATOR'], ['fac_uniontown'])), ['fac_uniontown'], 'a named list wins');
  assert.deepEqual(L.plantsFor(person(['SUPERVISOR'], ['fac_nowhere'])), ['fac_uniontown']);
  assert.deepEqual(L.plantsFor({ status: 'INACTIVE', roles: ['ADMINISTRATOR'] }), []);
  assert.equal(L.isAdmin(person(['ADMIN'])), true);
  assert.equal(L.isAdmin(person(['MANAGER'])), false);
});

test('the Users list copy keeps each person\'s plants, and the primary administrator is always an Administrator', () => {
  const rows = [['email', 'display_name', 'status', 'roles_json', 'facility_ids_json'],
    ['jcartwright@uniteddairy.com', 'Joe', 'ACTIVE', '["MANAGER"]', '[]'],
    ['bbircher@uniteddairy.com', 'Brian Bircher', 'ACTIVE', '["SUPERVISOR"]', '["fac_uniontown"]'],
    ['rfarber@uniteddairy.com', 'Rich Farber', 'ACTIVE', '["MANAGER"]', '["*"]']];
  const docs = T.parseMaster('users', rows).docs;
  assert.deepEqual(docs['jcartwright@uniteddairy.com'].roles, ['MANAGER', 'ADMINISTRATOR']);
  assert.deepEqual(docs['jcartwright@uniteddairy.com'].facilities, ['*']);
  assert.deepEqual(docs['bbircher@uniteddairy.com'].facilities, ['fac_uniontown']);
  assert.deepEqual(L.plantsFor(docs['bbircher@uniteddairy.com']), ['fac_uniontown']);
  assert.equal(L.plantsFor(docs['rfarber@uniteddairy.com']).length, 3);
});

test('Administration lists every item of the current app\'s Administration', () => {
  const text = fs.readFileSync(path.join(__dirname, '../../../public/js/admin-items.js'), 'utf8');
  ['People & Roles', 'Role Templates', 'Access & QR Codes', 'App Links & Codes', 'Plant Station Codes', 'Repair Email', 'Manager Report Recipients', 'Sent Email Log',
    'Driver Check-In Email', 'Refresh Rates', 'Window Test Center', 'Driver Station', 'MOCREO & Sensors', 'Run Runtime Pre-Flight', 'Update Live Sheets',
    'Refresh Home Summary Now', 'Start Plant Fresh From Today', 'Date Inventory', 'Date Column Dry Run / Convert', 'Remaining Repair Items',
    'Dispatch Administration', 'Operational Assignments', 'Print Layouts', 'Dispatch Settings'].forEach(t => assert.ok(text.indexOf("'" + t + "'") >= 0, t));
});

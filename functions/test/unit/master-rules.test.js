const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../../src/logic');

// Route Master's yes / no rules as the current app reads them (desktopRouteConfigParseCanonicalRowV5054_).
test('Route Master rules: a blank Active cell is inactive, a blank show cell is NO, a missing column stays yes', () => {
  assert.equal(L.masterActive({ routeStatus: '', active: null }), false, 'Rhino 834: status blank, Active blank');
  assert.equal(L.masterActive({ routeStatus: '', active: true }), true);
  assert.equal(L.masterActive({ routeStatus: 'INACTIVE', active: true }), false);
  assert.equal(L.masterActive({ routeStatus: 'ACTIVE' }), true, 'no Active column at all');
  assert.equal(L.masterFlag({ displayMobile: null }, 'displayMobile'), false);
  assert.equal(L.masterFlag({ displayMobile: true }, 'displayMobile'), true);
  assert.equal(L.masterFlag({}, 'displayPlant'), true, 'no column at all');
  assert.equal(L.masterFlag({ movementType: 'CUSTOMER_PICKUP' }, 'displayDaily'), false, 'customer pickups are off Daily by default');
});

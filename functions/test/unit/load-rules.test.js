'use strict';
// Rules audit (Joe 11/2-11/3: "anything more than two calls ... it all goes through the same place"): who hauls a load, whether a
// load is loaded, whether a run is active and drop and hook live once, in src/logic.js. This checks the rules and fails when a new
// copy of one is written anywhere else in the server or the screens.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const L = require('../../src/logic');
const R = require('../../src/plant-rules');

test('who hauls a load: our truck, a branch, an outside carrier or a customer pickup', () => {
  assert.equal(L.hauler({}), 'OURS');
  assert.equal(L.hauler({ coverageType: 'UNITED DAIRY' }), 'OURS');
  // A route marked UNIONTOWN is our own truck everywhere (it used to show an outside carrier's colour on the Scheduler).
  assert.equal(L.hauler({ coverageType: 'Uniontown' }), 'OURS');
  assert.equal(L.hauler({ coverageType: 'BRANCH' }), 'BRANCH');
  assert.equal(L.hauler({ coverageType: 'OUTSIDE CARRIER' }), 'CARRIER');
  assert.equal(L.hauler({ coverageType: 'DARDEN' }), 'CARRIER');
  // The kind of route counts even with nothing in the "who covers it" box.
  assert.equal(L.hauler({ movementType: 'CARRIER_LOAD' }), 'CARRIER');
  assert.equal(L.hauler({ movementType: 'customer pickup' }), 'PICKUP');
  assert.equal(L.hauler({ coverageType: 'CUSTOMER PICKUP' }), 'PICKUP');
  assert.equal(L.hauler({}, 'CARRIER'), 'CARRIER', 'a Scheduler load marked Carrier');
  // Joe 11/3: "intercompany transfer should be considered late": a branch is not an outside carrier.
  assert.equal(L.outsideHauler({ coverageType: 'BRANCH' }), false);
  assert.equal(R.outsideCarrier({ coverageType: 'BRANCH' }), false);
  assert.equal(R.outsideCarrier({ coverageType: 'UNIONTOWN' }), false);
  assert.equal(R.outsideCarrier({ movementType: 'CARRIER_LOAD' }), true);
  // Who needs a driver and who is locked on Weekly follow the same rule.
  assert.equal(L.needsDriver({ coverageType: 'UNIONTOWN' }), true);
  assert.equal(L.needsDriver({ coverageType: 'BRANCH' }), false);
  assert.equal(L.needsDriver({ movementType: 'CARRIER_LOAD' }), false);
  assert.equal(L.coveredRoute({ coverageType: 'BRANCH' }), false);
  assert.equal(L.coveredRoute({ coverageType: 'UNIONTOWN' }), false);
  assert.equal(L.coveredRoute({ coverageType: 'GFS' }), true);
  assert.equal(L.coverageName({ coverageType: 'gfs' }), 'GFS');
  assert.equal(L.coverageName({ coverageType: 'UNIONTOWN' }), '');
  assert.equal(L.coverageName({ movementType: 'CUSTOMER_PICKUP' }), 'CUSTOMER PICKUP');
});

test('whether a load is loaded: one list of words everywhere', () => {
  assert.equal(L.isLoaded({}), false);
  assert.equal(L.isLoaded({ completeTime: '2026-11-03T10:00:00Z' }), true);
  assert.equal(L.isLoaded({ loadedComplete: true }), true);
  assert.equal(L.isLoaded({ loadedComplete: 'Yes' }), true);
  ['COMPLETE', 'Completed', 'LOADED', 'ready'].forEach(w => assert.equal(L.isLoaded({ loadStatus: w }), true, w));
  ['LOADING', 'PAUSED', 'NOT_STARTED', ''].forEach(w => assert.equal(L.isLoaded({ loadStatus: w }), false, w));
});

test('whether a run is active: any capitals, blank counts as active', () => {
  assert.equal(L.runActive({}), true);
  assert.equal(L.runActive({ routeStatus: 'Active' }), true);
  assert.equal(L.runActive({ routeStatus: 'INACTIVE' }), false);
  assert.equal(L.runActive({ routeStatus: 'ACTIVE', active: false }), false);
  // Route Master's own row keeps its rule: a blank active cell is not active.
  assert.equal(L.masterActive({ routeStatus: 'active', active: true }), true);
  assert.equal(L.masterActive({ routeStatus: 'ACTIVE', active: false }), false);
});

test('drop and hook: the tick decides, whatever the route is called', () => {
  assert.equal(L.dropAndHook({ runId: 'r1' }, { r1: { dropAndHook: true } }), true);
  assert.equal(L.dropAndHook({ runId: 'r1', dropAndHook: true }, {}), true);
  assert.equal(L.dropAndHook({ runId: 'r1', routeName: 'Save-A-Lot 1' }, {}), false);
});

// Any of these written outside logic.js is a new copy of a load rule.
const COPIES = [
  [/[!=]==\s*'UNITED DAIRY'/, 'who hauls a load (use L.hauler / L.coverageName)'],
  [/[!=]==\s*'(CARRIER_LOAD|CUSTOMER_PICKUP|BRANCH)'/, 'who hauls a load (use L.hauler / L.outsideHauler)'],
  [/'COMPLETED',\s*'LOADED'|loadedComplete\s*===\s*true/, 'whether a load is loaded (use L.isLoaded)'],
  [/routeStatus[^;\n]{0,60}[!=]==\s*'ACTIVE'/, 'whether a run is active (use L.runActive)'],
  [/SAVE\[\\s-\]\*A\[\\s-\]\*LOT[^\n]*dropAndHook|dropAndHook\s*\|\|\s*m\.dropAndHook/, 'drop and hook (use L.dropAndHook)']
];
// Lines that look like a copy but are a different rule, with the reason.
const ALLOWED = [
  [/salesapp\.js$/, /divisionName/, 'the sales app\'s division rule: a run another location covers is not this division\'s'],
  [/(scheduler\.html|station-work\.js)$/, /h === 'BRANCH'/, 'the result of L.hauler picking a colour']
];

test('the load rules live in one place: no copies in the server or the screens', () => {
  const root = path.join(__dirname, '..', '..', '..');
  const files = [];
  const walk = (dir, ok) => fs.readdirSync(dir).forEach(n => { const p = path.join(dir, n); if (ok(n)) files.push(p); });
  walk(path.join(root, 'functions', 'src'), n => n.endsWith('.js') && n !== 'logic.js');
  walk(path.join(root, 'public', 'js'), n => n.endsWith('.js') && n !== 'logic.js');
  walk(path.join(root, 'public'), n => n.endsWith('.html'));
  const found = [];
  files.forEach(f => fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => COPIES.forEach(([re, what]) => {
    if (!re.test(line)) return;
    if (ALLOWED.some(([fileRe, lineRe]) => fileRe.test(f) && lineRe.test(line))) return;
    found.push(path.relative(root, f) + ':' + (i + 1) + ' ' + what);
  })));
  assert.deepEqual(found, [], 'These are copies of a load rule; call the one in logic.js instead:\n' + found.join('\n'));
});

// Rules audit line 11 (Joe 11/3 "Yes, one plant rule everywhere").
test('one plant rule: blank means Uniontown, a record or an id', () => {
  assert.equal(L.plantOf(''), 'fac_uniontown');
  assert.equal(L.plantOf(null), 'fac_uniontown');
  assert.equal(L.plantOf(' fac_charleston '), 'fac_charleston');
  assert.equal(L.plantOf({ facilityId: 'fac_martins_ferry' }), 'fac_martins_ferry');
  assert.equal(L.plantOf({ facility_id: 'fac_charleston' }), 'fac_charleston');
  assert.equal(L.plantOf({}), 'fac_uniontown');
});

test('the plant rule lives in one place, and screens read their own plant\'s Shift Times', () => {
  const root = path.join(__dirname, '..', '..', '..');
  const files = [];
  const walk = (dir, ok) => fs.readdirSync(dir).forEach(n => { const p = path.join(dir, n); if (ok(n)) files.push(p); });
  walk(path.join(root, 'functions', 'src'), n => n.endsWith('.js') && n !== 'logic.js');
  walk(path.join(root, 'public', 'js'), n => n.endsWith('.js') && n !== 'logic.js');
  walk(path.join(root, 'public'), n => n.endsWith('.html'));
  const found = [];
  files.forEach(f => fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    const at = path.relative(root, f) + ':' + (i + 1);
    if (/\|\|\s*'fac_uniontown'/.test(line)) found.push(at + ' blank means Uniontown (use L.plantOf)');
    if (/'plantShifts',\s*'fac_uniontown'/.test(line)) found.push(at + ' reads Uniontown\'s Shift Times on every plant (use currentPlant())');
    if (/'UNIONTOWN'\)\s*>=\s*0\s*\?\s*'fac_uniontown'/.test(line)) found.push(at + ' plant from a location (use L.plantOfLocation)');
  }));
  assert.deepEqual(found, [], found.join('\n'));
});

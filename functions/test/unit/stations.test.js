'use strict';
// The last six screens (Garage Station, the drivers' View Loadout and DVIR, the Driver Room board, Trailer Assignments, Plant Station).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const B = require('../../src/board-rules');
const G = require('../../src/garage');
const T = require('../../src/transfer');

test('the Driver Room board uses the same rules on the screens and the server', () => {
  assert.equal(fs.readFileSync(path.join(__dirname, '../../src/board-rules.js'), 'utf8'), fs.readFileSync(path.join(__dirname, '../../../public/js/board-rules.js'), 'utf8'));
});

test('board: today\'s loads in load order, LOADED / LOADING / WAITING, and the open pickups', () => {
  const week = '2026-10-04';
  const run = (id, route, seq, day) => ({ id, weekStart: week, route, run: 'R' + id, days: { wed: Object.assign({ runs: true, loadSequence: seq }, day) } });
  const runs = [run('a', '101_2', 2, { completeTime: '2026-10-07T05:00:00-04:00' }), run('b', '102', 1, { plantStartedAt: 'x' }), run('c', '103', 3, {}),
    Object.assign(run('d', '104', 4, {}), { weekStart: '2026-09-27' })];
  const pickups = [{ runDocId: 'c', day: 'wed', date: '2026-10-07', quantity: '10', item: 'cases milk', notes: 'cooler 2', status: 'PENDING' },
    { runDocId: 'c', day: 'wed', date: '2026-10-07', item: 'old', status: 'COMPLETE' }];
  const rows = B.boardRows(runs, pickups, '2026-10-07');
  assert.deepEqual(rows.map(r => [r.route, r.state, r.pickup]), [['102', 'LOADING', false], ['101', 'LOADED', false], ['103', 'WAITING', true]]);
  assert.equal(rows[2].pickupText, '10 cases milk - cooler 2');
  assert.equal(B.remaining(rows), 2);
  assert.equal(B.trailerText('t 123'), 'T-123');
});

test('Garage Station: the login ID copied from the sheet is hashed the way the sign-in checks it', () => {
  const rows = [['tech_id', 'name', 'active', 'login_id'], ['TECH-1', 'JELLICK Tom', 'TRUE', '48213']];
  const out = T.parseQueue('garageTechs', rows);
  assert.equal(out.secrets['TECH-1'].hash, G.loginHash('TECH-1', '48213'));
  assert.ok(!JSON.stringify(out.docs).includes('48213'), 'the login ID is not on the readable list');
});

test('the six screens are pages of the new app, and old "being built" links open them', () => {
  const pub = path.join(__dirname, '../../../public');
  ['garage-station.html', 'driver-station.html', 'trailers.html', 'plant-station.html'].forEach(f => assert.ok(fs.existsSync(path.join(pub, f)), f));
  const soon = fs.readFileSync(path.join(pub, 'soon.html'), 'utf8');
  ['driver-dvir', 'driver-loadout', 'plant-station', 'trailer-assignments', 'admin-driver-station'].forEach(k => assert.match(soon, new RegExp("'" + k + "': '[a-z-]+\\.html")));
  const route = fs.readFileSync(path.join(pub, 'route.html'), 'utf8');
  assert.match(route, /id="step-dvir"/);
  assert.match(route, /id="step-board"/);
});

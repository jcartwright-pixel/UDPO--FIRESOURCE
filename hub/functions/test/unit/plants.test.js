'use strict';
// The plant pop-up's recap (src/plants.js), made-up people and loads only.
const test = require('node:test');
const assert = require('node:assert/strict');
const PL = require('../../src/plants');
const H = require('../../src/hub');
// Operations' own plants and rules: the hub's copy must stay the same.
const L = require('../../../../functions/src/logic');

test('the plants and who sees which are the same as Operations\'', () => {
  assert.deepEqual(PL.PLANTS.map(p => [p.id, p.name, p.status, p.db]), L.PLANTS.map(p => [p.id, p.name, p.status, p.db]));
  const people = [
    { status: 'ACTIVE', roles: ['Administrator'] },
    { status: 'ACTIVE', roles: ['Manager'], facilities: ['fac_charleston'] },
    { status: 'ACTIVE', roles: ['Manager'], facilities: ['*'] },
    { status: 'ACTIVE', roles: ['Sales'] },
    { status: 'INACTIVE', roles: ['Administrator'] }
  ];
  people.forEach(p => assert.deepEqual(PL.plantsFor(p), L.plantsFor(p)));
});

test('the operating day rolls over at 6 AM New York time, like Operations', () => {
  ['2026-11-10T10:59:00Z', '2026-11-10T11:01:00Z', '2026-11-11T03:00:00Z', '2026-07-04T09:30:00Z'].forEach(t =>
    assert.equal(PL.operatingDay(Date.parse(t)), L.operatingDay(new Date(t)), t));
});

// A made-up week: Tuesday 11-10-26 is today; loads load the day before delivery unless the day says otherwise.
const day = (o) => Object.assign({ runs: 1 }, o);
const runs = [
  { weekStart: '2026-11-08', loadType: 'CASE LOADOUT', days: { wed: day({ completeTime: '2026-11-10T14:00:00Z' }) } },
  { weekStart: '2026-11-08', loadType: 'CASE', days: { wed: day({ loadStatus: 'LOADING', plantStartedAt: '2026-11-10T15:00:00Z' }) } },
  { weekStart: '2026-11-08', loadType: 'TOTE', days: { wed: day({}) } },
  { weekStart: '2026-11-08', loadType: 'CASE', days: { wed: day({ loadType: 'NONE' }) } }, // not loaded at the plant that day
  { weekStart: '2026-11-08', loadType: '', days: { wed: day({}) } }, // not a plant load
  { weekStart: '2026-11-08', loadType: 'CASE', routeStatus: 'INACTIVE', days: { wed: day({}) } },
  { weekStart: '2026-11-08', loadType: 'CASE', days: { tue: day({}) } }, // last night's, still open: carried
  { weekStart: '2026-11-08', loadType: 'CASE', days: { tue: day({ loadStatus: 'COMPLETE' }) } }, // last night's, done: not carried
  { weekStart: '2026-11-08', loadType: 'BOXING', days: { tue: day({ loadDayOffset: 0 }) } } // loads on its delivery day, today
];

test('today\'s loads: done, loading now and waiting, with last night\'s still open', () => {
  assert.deepEqual(PL.loadCounts(runs, '2026-11-10'), { total: 5, done: 1, loading: 1, waiting: 3 });
});

test('trucks and trailers with a problem count once each', () => {
  const m = [
    { record_id: 'a', kind: 'TRUCK', status: 'OPEN', truck_number: 'T-901' },
    { record_id: 'b', kind: 'TRUCK', status: 'OPEN', truck_number: '901' },
    { record_id: 'c', kind: 'TRAILER', status: 'NEEDS_REVIEW', trailer_number: '5302' },
    { record_id: 'd', kind: 'TRUCK', status: 'REPAIRED', truck_number: '905' },
    { record_id: 'e', kind: 'BUILDING', status: 'OPEN' }
  ];
  assert.equal(PL.unitsWithProblems(m), 2);
});

// A made-up database per plant: Uniontown has today's loads; Charleston's cannot be read.
function plantDb(name) {
  if (name === 'charleston') throw new Error('no database');
  const data = { runs: name === '(default)' ? runs : [], maintenance: [{ record_id: 'a', kind: 'TRUCK', status: 'OPEN', truck_number: '901' }] };
  const q = (c) => ({ where: () => q(c), get: async () => ({ docs: (data[c] || []).map(d => ({ data: () => d })) }) });
  return { collection: (c) => c === 'users' || c === 'appAccess' ? people(c) : q(c) };
}
const PEOPLE = { 'pat.admin@uniteddairy.com': { status: 'ACTIVE', roles: ['Administrator'], name: 'Pat Admin' },
  'chris.charleston@uniteddairy.com': { status: 'ACTIVE', roles: ['Manager'], facilities: ['fac_charleston'] } };
const people = (c) => ({ doc: (id) => ({ get: async () => ({ exists: c === 'users' && !!PEOPLE[id], data: () => PEOPLE[id] }) }) });

test('the hub call gives each plant\'s recap, and a plant that cannot be read still shows', async () => {
  const r = await H.hubCall(plantDb('(default)'), { email: 'pat.admin@uniteddairy.com' }, { op: 'plants' }, { dbFor: plantDb, now: Date.parse('2026-11-10T16:00:00Z') });
  assert.equal(r.today, '2026-11-10');
  assert.deepEqual(r.plants.map(p => p.name), ['Uniontown', 'Charleston', 'Martins Ferry']);
  assert.deepEqual(r.plants[0].loads, { total: 5, done: 1, loading: 1, waiting: 3 });
  assert.equal(r.plants[0].units, 1);
  assert.equal(r.plants[1].unread, true);
  assert.equal(r.plants[2].live, false);
});

test('Home names the person\'s plants, so a person with one plant is never asked', async () => {
  const admin = await H.hubCall(plantDb('(default)'), { email: 'pat.admin@uniteddairy.com' }, { op: 'home' }, { project: 'ud-distribution' });
  assert.deepEqual(admin.plants.map(p => p.id), ['fac_uniontown', 'fac_charleston', 'fac_martins_ferry']);
  const one = await H.hubCall(plantDb('(default)'), { email: 'chris.charleston@uniteddairy.com' }, { op: 'home' }, { project: 'ud-distribution' });
  assert.deepEqual(one.plants, [{ id: 'fac_charleston', name: 'Charleston' }]);
});

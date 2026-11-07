'use strict';
// Joe 11-7-26, by name: "LOAD THE OCTOBER NEW CUSTOMERS AND ROUTE DAYS". The Customer List gets the missing customers, route
// days and stops; nothing is removed and no load sequence already there changes. Made-up stores stand in for what is there.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, clear } = require('./helpers');
const DL = require('../../src/data-loads');
const U = require('../../src/udcl-rules');

const PLANT = DL.UDCL_OCT.plant;
const tick = () => new Date('2026-11-07T16:00:00Z');
const cust = (key, x) => db().collection('udclCustomers').doc(U.customerId(PLANT, key)).set(Object.assign({ plant: PLANT, key, account: key, name: 'TEST STORE ' + key, chain: '', active: true }, x || {}));
const day = (route, d, stops, map) => db().collection('udclRouteDays').doc(U.routeDayId(PLANT, route, d)).set({ plant: PLANT, route, day: d, stops, startTime: '5:00 AM', notes: 'Back door', map: map || null, rev: 4 });
const getDay = async (route, d) => (await db().collection('udclRouteDays').doc(U.routeDayId(PLANT, route, d)).get()).data();
const stop = (key, loadSeq) => ({ key, account: key, name: 'TEST STORE ' + key, chain: '', loadSeq, note: 'Ring bell' });

test('the October customers and route days load once: only adds, keeps every stop, sequence and closed customer', async () => {
  await clear();
  // 803 FRI is there with two made-up stores; a closed store (no October delivery) stays on it.
  await cust('900001'); await cust('900002'); await cust('900003', { name: 'TEST CLOSED STORE' });
  await day('803', 'FRI', [stop('900001', 3), stop('900002', 1), stop('900003', 2)], U.packMap({ rows: 3, cells: [[1, 1, 1, 1, 1, 1], [2, 2, 2, 2, 2, 2], [3, 3, 3, 3, 3, 3]] }));
  // Wal-Mart 5241 is on the list but marked not active; Youngwood is there by its name only (no account number).
  await cust('5241', { name: 'WAL-MART #5241 N HUNTINGTON', active: false });
  await cust('N-YOUNGWOOD-SNS-211122', { account: '', name: 'YOUNGWOOD SNS #211122' });
  await day('811', 'SAT', [stop('N-YOUNGWOOD-SNS-211122', 0)]);
  // Joe 11-7-26: Helds was bought out; the old account (811495) is on 813 THU at load sequence 3 with a stop note.
  await cust('811495', { name: 'HELDS SNS #211495', address: '1 TEST ST', phone: '555-0100' });
  await cust('900004');
  await day('813', 'THU', [stop('900004', 5), Object.assign(stop('811495', 3), { name: 'HELDS SNS #211495', note: 'Side door' }), stop('900002', 1)]);
  // DQ Herminie is on 803 TUE already.
  await cust('119005', { name: 'DQ HERMINIE' });
  await day('803', 'TUE', [stop('119005', 4)]);

  const out = (await DL.runDataLoads(db(), { now: tick }))[DL.UDCL_OCT_ID];
  assert.ok(out.counts, JSON.stringify(out));

  const fri = await getDay('803', 'FRI');
  assert.deepEqual(fri.stops.slice(0, 3).map(s => [s.key, s.loadSeq, s.note]), [['900001', 3, 'Ring bell'], ['900002', 1, 'Ring bell'], ['900003', 2, 'Ring bell']], 'the stops there keep their order, sequence and note; the closed store stays');
  assert.ok(fri.stops.some(s => s.key === '1860') && fri.stops.some(s => s.key === '119005'), 'Tastyland and DQ Herminie added to 803 FRI');
  assert.equal(fri.startTime, '5:00 AM'); assert.equal(fri.notes, 'Back door'); assert.equal(fri.rev, 5);
  assert.deepEqual(U.cleanMap(fri.map).cells[2], [3, 3, 3, 3, 3, 3], 'the truck drawing stays');

  const tue = await getDay('803', 'TUE');
  assert.equal(tue.stops.filter(s => s.key === '119005').length, 1, 'a stop already there is not added twice');
  assert.equal(tue.stops.find(s => s.key === '119005').loadSeq, 4, 'its load sequence stays');

  const sat = await getDay('811', 'SAT');
  assert.equal(sat.stops.filter(s => /YOUNGWOOD/.test(s.name)).length, 1, 'Youngwood matched by name, not added again');
  assert.ok(sat.stops.some(s => s.account === '811496'), 'Helds #211496 added to 811 SAT');

  const thu = await getDay('8302', 'THU');
  assert.ok(thu && thu.stops.some(s => s.key === '5241' || s.account === '1703'), 'a missing route day is added');
  assert.ok(thu.map && thu.map.cells.length, 'with a starting truck drawing');
  const thu813 = (await getDay('813', 'THU')).stops;
  assert.deepEqual(thu813.slice(0, 3).map(s => [s.account, s.loadSeq, s.note]), [['900004', 5, 'Ring bell'], ['811496', 3, 'Side door'], ['900002', 1, 'Ring bell']], 'Helds has the new account number in the same place, load sequence and note');
  assert.ok(!thu813.some(s => s.account === '811495'), 'the old Helds number is on no route day');
  assert.equal(thu813.filter(s => s.account === '811496').length, 1, 'and the new one is not added twice');
  const oldH = (await db().collection('udclCustomers').doc(U.customerId(PLANT, '811495')).get()).data(), newH = (await db().collection('udclCustomers').doc(U.customerId(PLANT, '811496')).get()).data();
  assert.equal(oldH.active, false); assert.match(oldH.notes, /Account changed to 811496/);
  assert.equal(newH.name, 'HELDS SNS #211496'); assert.equal(newH.address, '1 TEST ST'); assert.equal(newH.phone, '555-0100'); assert.equal(newH.active, true);

  const wm = (await db().collection('udclCustomers').doc(U.customerId(PLANT, '5241')).get()).data();
  assert.equal(wm.active, true, 'a customer on a route day again is active');
  const tasty = (await db().collection('udclCustomers').doc(U.customerId(PLANT, '1860')).get()).data();
  assert.equal(tasty.name, 'TASTYLAND MONROEVILLE'); assert.equal(tasty.dc, '30');
  assert.equal((await db().collection('udclCustomers').where('plant', '==', PLANT).get()).docs.filter(d => /YOUNGWOOD SNS/.test(d.data().name)).length, 1);

  // Nothing is removed.
  const all = (await db().collection('udclRouteDays').where('plant', '==', PLANT).get()).docs.map(d => d.data());
  for (const [r, d, k] of [['803', 'FRI', '900003'], ['803', 'TUE', '119005'], ['811', 'SAT', 'N-YOUNGWOOD-SNS-211122']]) assert.ok(all.find(x => x.route === r && x.day === d).stops.some(s => s.key === k));
  const mark = (await db().collection('dataLoads').doc(DL.UDCL_OCT_ID).get()).data();
  assert.equal(mark.status, 'DONE'); assert.equal(mark.counts.stops, out.counts.stops);

  // A second run changes nothing.
  const again = (await DL.runDataLoads(db(), { now: tick }))[DL.UDCL_OCT_ID];
  assert.deepEqual(again, { skipped: true });
  assert.equal((await getDay('803', 'FRI')).rev, 5);
});

test('with no Customer List yet the load waits and leaves no marker', async () => {
  await clear();
  const out = (await DL.runDataLoads(db(), { now: tick }))[DL.UDCL_OCT_ID];
  assert.ok(out.waiting);
  assert.equal((await db().collection('dataLoads').doc(DL.UDCL_OCT_ID).get()).exists, false);
});

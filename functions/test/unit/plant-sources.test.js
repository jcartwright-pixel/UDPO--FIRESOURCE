'use strict';
// Joe 10/26 (fk): Charleston and Martins Ferry keep typing in their own dispatch sheets; each plant's copy reads only its own
// sheets, into its own database, and never Uniontown's sheets or the Users list.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../src/sources');
const L = require('../../src/logic');
const { withDatabases } = require('../../../tools/plant-databases.cjs');

test("each other plant reads its own Live workbook, never a Uniontown sheet or the Users list", () => {
  assert.equal(S.plantSources({}, 'fac_charleston').live.spreadsheetId, '1UrAzrPIe4x6jcNBCjCJUIE8mjvJAniZMoONRGK8GJmw');
  assert.equal(S.plantSources({}, 'fac_martins_ferry').live.spreadsheetId, '1ac78al6_HhYA3_89kwYU93KbIzOv0vqExYhFsG1i4Rk');
  assert.equal(S.plantSources({}, 'fac_uniontown'), null, 'Uniontown keeps its own copy (transferSources)');
  const copy = { fac_charleston: { live: { spreadsheetId: 'copyLive' }, masters: { routes: { spreadsheetId: 'copyRoutes', tab: 'ROUTES_MASTER' }, users: { spreadsheetId: 'x', tab: 'USERS_MASTER' } } } };
  const got = S.plantSources({ PLANT_SOURCES_JSON: JSON.stringify(copy) }, 'fac_charleston');
  assert.deepEqual(Object.keys(got.masters), ['routes'], 'the Users list is never copied from a plant');
  assert.equal(S.plantSources({ PLANT_SOURCES_JSON: JSON.stringify(copy) }, 'fac_martins_ferry'), null, 'a test copy names only the plants it has copies of');
  const bad = { fac_charleston: { live: { spreadsheetId: S.UNIONTOWN.live.spreadsheetId } } };
  assert.throws(() => S.plantSources({ PLANT_SOURCES_JSON: JSON.stringify(bad) }, 'fac_charleston'), /may not copy a Uniontown sheet/);
});

test('each plant has its own database; the deploy guards each with the same rules', () => {
  assert.deepEqual(L.PLANTS.map(p => [p.id, p.db]), [['fac_uniontown', '(default)'], ['fac_charleston', 'charleston'], ['fac_martins_ferry', 'martins-ferry']]);
  const base = { firestore: { rules: 'firestore.rules', indexes: 'firestore.indexes.json' }, hosting: {} };
  assert.deepEqual(withDatabases(base, []).firestore, base.firestore, 'no plant database yet: as before');
  assert.deepEqual(withDatabases(base, ['charleston', 'nope']).firestore.map(f => f.database), ['(default)', 'charleston']);
  assert.ok(withDatabases(base, ['charleston']).firestore.every(f => f.rules === 'firestore.rules' && f.indexes === 'firestore.indexes.json'));
});

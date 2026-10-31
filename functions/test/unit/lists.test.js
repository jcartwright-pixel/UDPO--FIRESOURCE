'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const LISTS = require('../../src/lists');
const M = require('../../src/model');

// Joe 10/30 ("does all of our reads and writes go through a router? ... We don't have multiple areas where it could read or
// write by accident"): one index of every database list (src/lists.js), and nothing in the app names a list that is not in it.
const ROOT = path.join(__dirname, '../../..');
const files = (dir, re) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory()
  ? (['vendor', 'img', 'node_modules', 'test'].includes(e.name) ? [] : files(path.join(dir, e.name), re))
  : re.test(e.name) ? [path.join(dir, e.name)] : []);
const rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
const ruleLists = [...new Set([...rules.matchAll(/match \/([A-Za-z]+)\//g)].map(m => m[1]))].filter(n => n !== 'databases');

// The list names a screen spells: collection(db, 'x'), doc(db, 'x', ...), doc(db, 'x/id'), collectionGroup(db, 'x').
function screenNames() {
  const out = [];
  files(path.join(ROOT, 'public'), /\.(html|js)$/).forEach(f => {
    const text = fs.readFileSync(f, 'utf8');
    for (const m of text.matchAll(/\b(?:collection|doc|collectionGroup)\(\s*[A-Za-z_$][\w$.]*(?:\(\))?\s*,\s*'([^']+)'/g)) out.push([path.relative(ROOT, f), m[1].split('/')[0]]);
  });
  return out;
}
// The list names a server file spells: .collection('x'), .doc('x/...'), collectionGroup('x').
function serverNames() {
  const out = [];
  files(path.join(ROOT, 'functions'), /\.js$/).forEach(f => {
    const text = fs.readFileSync(f, 'utf8');
    for (const m of text.matchAll(/\.(?:collection|collectionGroup)\(\s*'([^']+)'/g)) out.push([path.relative(ROOT, f), m[1].split('/')[0]]);
    for (const m of text.matchAll(/\bdb\.doc\(\s*'([^']+)'/g)) out.push([path.relative(ROOT, f), m[1].split('/')[0]]);
  });
  return out;
}

test('every list a screen names is in the one index', () => {
  const found = screenNames();
  assert.ok(found.length > 100, 'the screens\' list names were found (' + found.length + ')');
  assert.deepEqual(found.filter(([, n]) => !LISTS.known(n)).map(x => x.join(': ')), []);
});

test('every list a screen names is one the database lets screens read', () => {
  assert.deepEqual([...new Set(screenNames().filter(([, n]) => ruleLists.indexOf(n) < 0).map(x => x.join(': ')))], []);
});

test('every list the server names is in the one index', () => {
  const found = serverNames();
  assert.ok(found.length > 100, 'the server\'s list names were found (' + found.length + ')');
  assert.deepEqual(found.filter(([, n]) => !LISTS.known(n)).map(x => x.join(': ')), []);
  assert.deepEqual(Object.values(M.COLLECTIONS).filter(n => !LISTS.known(n)), []);
});

test('every list the database rules name is in the one index, and the index has no repeats', () => {
  assert.deepEqual(ruleLists.filter(n => !LISTS.known(n)), []);
  assert.equal(new Set(LISTS.NAMES).size, LISTS.NAMES.length);
});

test('the index finds the list names in a path', () => {
  assert.deepEqual(LISTS.unlisted('config/app'), []);
  assert.deepEqual(LISTS.unlisted('cofig/app'), ['cofig']);
  assert.deepEqual(LISTS.unlisted('runs/r1/oops/x'), ['oops']);
  assert.deepEqual(LISTS.unlisted('r1', true), [], 'a record id under a list is not a list name');
  assert.deepEqual(LISTS.unlisted('r1/oops', true), ['oops']);
});

// The server's half: Firestore's own collection / doc / collectionGroup check each name while testing.
test('the server stops a list name that is not in the index while testing', () => {
  process.env.UD_STRICT_LISTS = '1';
  const G = require('../../src/list-guard');
  assert.throws(() => G.check('cofig/app'), /Not in the list index/);
  assert.doesNotThrow(() => G.check('config/app'));
  delete process.env.UD_STRICT_LISTS;
});

// The screens' half: js/firebase.js is the one door, and its collection / doc / collectionGroup check the index.
test('the screens\' one door checks every list name against the index', () => {
  const text = fs.readFileSync(path.join(ROOT, 'public/js/firebase.js'), 'utf8');
  assert.match(text, /import '\.\/lists\.js';/);
  ['collection', 'doc', 'collectionGroup'].forEach(n => assert.match(text, new RegExp('export function ' + n + '\\(')));
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// Review item 82 (Joe 10/13): the Firebase web version is written in public/js/firebase.js only.
const ROOT = path.join(__dirname, '../../..');
const FIREBASE_JS = path.join(ROOT, 'public', 'js', 'firebase.js');

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'img' || e.name === 'node_modules' ? [] : files(p);
    return /\.(html|js|cjs|json|webmanifest)$/.test(e.name) ? [p] : [];
  });
}

test('js/firebase.js names one Firebase version, the same one the browser checks serve in gstatic\'s place', () => {
  const text = fs.readFileSync(FIREBASE_JS, 'utf8');
  const version = /FIREBASE_VERSION = '(\d+\.\d+\.\d+)'/.exec(text)[1];
  const named = [...text.matchAll(/firebasejs\/(\d+\.\d+\.\d+)\//g)].map(m => m[1]);
  assert.deepEqual([...new Set([...text.matchAll(/firebasejs\/[^'"]+/g)].map(m => m[0]))].map(u => u.split('/').pop()).sort(), ['firebase-app.js', 'firebase-auth.js', 'firebase-firestore.js', 'firebase-functions.js'], 'app, auth, firestore and functions (firestore also imported for the read count)');
  named.forEach(v => assert.equal(v, version));
  assert.equal(require('../../package.json').devDependencies.firebase, version);
});

test('no other screen, script, tool or browser check names a Firebase version', () => {
  const found = [];
  ['public', 'sandbox-only', 'tools', 'functions/test/browser'].forEach(d => files(path.join(ROOT, d)).forEach(p => {
    if (p === FIREBASE_JS) return;
    if (/firebasejs\/\d+\.\d+\.\d+/.test(fs.readFileSync(p, 'utf8'))) found.push(path.relative(ROOT, p));
  }));
  assert.deepEqual(found, []);
});

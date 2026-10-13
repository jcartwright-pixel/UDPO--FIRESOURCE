'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// Joe 10/13 ("I don't want it to say new plant operations" ... "It's just going to say operations because it covers
// everything"): the app is Operations everywhere people see it: header, window titles, sign-in, printouts, emails, messages.
const ROOTS = [path.join(__dirname, '../../../public'), path.join(__dirname, '../../src')];
const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? (e.name === 'img' ? [] : files(path.join(dir, e.name)))
  : /\.(html|js|css|webmanifest|json)$/.test(e.name) ? [path.join(dir, e.name)] : []);

test('no screen, message or email calls the app "New Plant Operations"', () => {
  const bad = [];
  ROOTS.forEach(root => files(root).forEach(f => { if (/new plant operations/i.test(fs.readFileSync(f, 'utf8'))) bad.push(path.relative(root, f)); }));
  assert.deepEqual(bad, []);
});

test('the header and every page title say Operations', () => {
  const pub = ROOTS[0];
  assert.match(fs.readFileSync(path.join(pub, 'js/app.js'), 'utf8'), /<strong>Operations<\/strong>/);
  const titled = fs.readdirSync(pub).filter(f => f.endsWith('.html')).filter(f => / · Operations<\/title>/.test(fs.readFileSync(path.join(pub, f), 'utf8')));
  assert.ok(titled.length >= 60, 'pages titled "· Operations": ' + titled.length);
});

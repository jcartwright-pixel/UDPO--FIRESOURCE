'use strict';
// Joe 10/11 (review items 18-23): the drivers' phone page as the current app's.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '../../../public');
const route = fs.readFileSync(path.join(PUBLIC, 'route.html'), 'utf8');

test('saved to the home screen from the driver page, "UD Routes" opens the driver page', () => {
  assert.match(route, /<link rel="manifest" href="route.webmanifest">/);
  const m = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'route.webmanifest'), 'utf8'));
  assert.equal(m.short_name, 'UD Routes');
  assert.equal(m.start_url, '/route.html');
  assert.equal(m.display, 'standalone');
  m.icons.forEach(i => assert.ok(fs.existsSync(path.join(PUBLIC, i.src)), i.src));
});

test('the Check-In asks for over / short, the units, the jack and drop-and-hook trailers; Who is driving has Skip', () => {
  ['name="overageShortage"', 'name="overCases"', 'name="overProduct"', 'name="shortCases"', 'name="shortProduct"', 'name="truck"', 'name="trailer"', 'name="palletJack"', 'id="ci-add"', 'id="skip"', 'Who is driving?']
    .forEach(s => assert.ok(route.includes(s), s));
});

test('the write-up boxes get a Speak button only where the phone can listen', () => {
  const speak = fs.readFileSync(path.join(PUBLIC, 'js/speak.js'), 'utf8');
  assert.match(speak, /SpeechRecognition \|\| window\.webkitSpeechRecognition/);
  assert.match(speak, /if \(!canSpeak \|\| !root\) return;/);
  ['tractorIssues', 'trailerIssues', 'palletJackIssues', 'checkinNotes', 'dv-tractor', 'dv-notes'].forEach(k => assert.match(route, new RegExp('(name|id)="' + k + '"[^>]*data-voice'), k));
});

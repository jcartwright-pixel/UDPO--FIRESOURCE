#!/usr/bin/env node
/*
 * Joe 11/1 ("can we test to see if we can get this from our API?"): GPS Setup's Trip check (functions/src/fleettrips.js) run
 * once against the PRACTICE copy, from GitHub (.github/workflows/gps-trip-check.yml). Read only: it uses the practice copy's
 * saved Verizon Fleet login, asks Fleet for one truck's day, and writes the answer to files in OUT. The Fleet login never
 * leaves the server side of this script and is never printed.
 *   KEY  practice copy deploy key (must be ud-distribution-sandbox)   TAG  truck (blank: most miles that day)
 *   DATE yyyy-mm-dd New York day (blank: yesterday)                   OUT  folder for trip-check.json / .md / .csv
 */
'use strict';
const path = require('path');
const fs = require('fs');
const req = require('module').createRequire(path.join(__dirname, '..', 'functions', 'package.json'));
const admin = req('firebase-admin');
const { getFirestore } = req('firebase-admin/firestore');
const { tripCheck } = require('../functions/src/fleettrips');

const key = require(process.env.KEY);
if (key.project_id !== 'ud-distribution-sandbox') { console.error('Practice copy only.'); process.exit(1); }
const db = getFirestore(admin.initializeApp({ credential: admin.credential.cert(key) }));
const out = process.env.OUT || 'trip-check';
fs.mkdirSync(out, { recursive: true });

const ny = (iso) => iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'numeric', day: 'numeric', year: '2-digit', hour: 'numeric', minute: '2-digit' }).replace(/\//g, '-').replace(',', '') : '';
const cell = (v) => v === null || v === undefined ? '' : String(v);
const csv = (rows) => rows.map(r => r.map(x => /[",\n]/.test(cell(x)) ? '"' + cell(x).replace(/"/g, '""') + '"' : cell(x)).join(',')).join('\n') + '\n';

(async () => {
  const r = await tripCheck(db, { tag: process.env.TAG || '', date: process.env.DATE || '' }, { budgetMs: 600000 });
  fs.writeFileSync(path.join(out, 'trip-check.json'), JSON.stringify(r, null, 2));
  fs.writeFileSync(path.join(out, 'trips.csv'), csv([['Unit', 'Left yard', 'Left from (lat, lon)', 'Left from address', 'Back in yard', 'Back at (lat, lon)', 'Back at address', 'Trip miles (GPS)',
    'Odometer start', 'Odometer end', 'Fuel counter start (gal)', 'Fuel counter end (gal)', 'Fuel used (gal)', 'Trip MPG', 'Lifetime MPG (Fleet)', 'Note']]
    .concat(r.trips.map(t => [r.tag, ny(t.left), t.leftLat + ', ' + t.leftLon, t.leftAddress, ny(t.back), t.backLat + ', ' + t.backLon, t.backAddress, t.miles,
      t.odometerStart, t.odometerEnd, t.fuelCounterStart, t.fuelCounterEnd, t.fuelUsed, t.mpg, t.lifetimeMpg, t.note]))));
  const md = ['# Trip check: ' + r.tag + ' on ' + r.date, '', 'Fleet unit ' + r.unitId + '. ' + r.points + ' GPS points (' + r.how + ').', '',
    '## Trips', '', '| Left yard | From | Back | To | Miles | Fuel counter start | Fuel counter end | Fuel used (gal) | MPG | Note |', '|---|---|---|---|---|---|---|---|---|---|']
    .concat(r.trips.map(t => '| ' + [ny(t.left), t.leftAddress, ny(t.back), t.backAddress, t.miles, t.fuelCounterStart, t.fuelCounterEnd, t.fuelUsed, t.mpg, t.note].map(cell).join(' | ') + ' |'))
    .concat(['', '## Fuel, odometer and trip readings Fleet offers (and how many of this truck\'s points had one)', '', '| Field | What it is | Unit | Points with a value | First | Last |', '|---|---|---|---|---|---|'])
    .concat(r.fields.map(f => '| ' + [f.name, f.description, f.unit, f.points, f.first, f.last].map(cell).join(' | ') + ' |'))
    .concat(['', '## Other trip tables in Fleet', ''].concat(r.otherTables.length ? r.otherTables.map(t => '- ' + t.table + ': ' + t.columns.join(', ')) : ['None.']))
    .concat(['', '## Notes', ''].concat(r.notes.length ? r.notes.map(n => '- ' + n) : ['None.'])).join('\n') + '\n';
  fs.writeFileSync(path.join(out, 'trip-check.md'), md);
  console.log(md);
  process.exit(0);
})().catch(e => { console.error('Trip check failed:', String(e && e.message || e).slice(0, 500)); process.exit(1); });

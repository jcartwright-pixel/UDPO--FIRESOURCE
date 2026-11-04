#!/usr/bin/env node
/*
 * Joe 11/4 ("pull a complete list of drivers in there and their usernames because I want to be able to match up"):
 * every driver (and every login) in Verizon Connect Fleet, with their user names and IDs, side by side with the app's
 * Driver Roster. Run once from GitHub (.github/workflows/gps-driver-list.yml) against the PRACTICE copy, with the practice
 * copy's saved Fleet login (GPS Setup). Read only: nothing in Fleet's drivers or users is changed (Fleet only keeps our
 * UDPO_ report layouts, the way every GPS read works), nothing is written to the sheets. The Fleet login is never printed.
 * Home addresses, birthdays, licence numbers, PINs and passwords are never asked for.
 *   KEY  practice copy deploy key (must be ud-distribution-sandbox)   OUT  folder for the answer files
 */
'use strict';
const path = require('path');
const fs = require('fs');
const req = require('module').createRequire(path.join(__dirname, '..', 'functions', 'package.json'));
const admin = req('firebase-admin');
const { getFirestore } = req('firebase-admin/firestore');
const { internals: F, FleetError } = require('../functions/src/fleetgps');

const key = require(process.env.KEY);
if (key.project_id !== 'ud-distribution-sandbox') { console.error('Practice copy only.'); process.exit(1); }
const db = getFirestore(admin.initializeApp({ credential: admin.credential.cert(key) }));
const out = process.env.OUT || 'driver-list';
fs.mkdirSync(out, { recursive: true });

const SKIP = /password|passcode|pin\b|^pin|ssn|social|birth|dob|address|street|city|state|zip|postal|licen[cs]e|lat$|lon$|latitude|longitude|image|photo|picture/i;
const TABLES = /^(driver|user)[-_ ]?\d/i;
const cell = (v) => v === null || v === undefined ? '' : String(v);
const csv = (rows) => rows.map(r => r.map(x => /[",\n]/.test(cell(x)) ? '"' + cell(x).replace(/"/g, '""') + '"' : cell(x)).join(',')).join('\n') + '\n';
const notes = [];

async function readTable(d, o, token, table, cols) {
  const name = 'UDPO_List' + table.split('-')[0].replace(/[^A-Za-z]/g, '');
  const line = (c) => 'F_' + c.replace(/[^A-Za-z0-9]/g, '_') + ' = Input.' + c;
  const run = async (list) => { await F.saveProbeTemplate(d, o, token, name, table, [], [], list.map(line)); return F.execute(d, o, token, name, {}, { maxPolls: 10 }); };
  try { return { cols, rows: await run(cols) }; } catch (e) {
    if (!(e instanceof FleetError)) throw e;
    notes.push(table + ': asking for every field at once failed (' + F.short(e.message) + '); asked one field at a time.');
  }
  const ok = [];
  for (const c of cols) { try { await run(['Id'].concat(c === 'Id' ? [] : [c])); ok.push(c); } catch (e) { if (!(e instanceof FleetError)) throw e; notes.push(table + '.' + c + ' could not be read.'); } }
  return { cols: ok, rows: ok.length ? await run(ok) : [] };
}

const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim();
const words = (s) => norm(s).split(' ').filter(w => w.length > 1);
// "LAST, FIRST" and "FIRST LAST" read the same; a middle initial is ignored.
function nameKey(s) {
  const raw = String(s || '');
  const parts = raw.indexOf(',') > 0 ? (() => { const [l, f] = raw.split(','); return words(f).concat(words(l)); })() : words(raw);
  return parts.length ? parts[0] + ' ' + parts[parts.length - 1] : '';
}

(async () => {
  const o = F.withDefaults({});
  const ref = db.collection('private').doc('gpsFleet');
  const d = (await ref.get()).data() || {};
  if (!d.fleet || !d.user || !d.password) throw new Error('The practice copy has no Fleet login saved in GPS Setup.');
  const token = await F.key(ref, d, o, false);

  const tables = {}, types = {};
  const quiet = async (name, table, outCols, fill) => { await F.saveProbeTemplate(d, o, token, name, table, [], [], outCols); (await F.execute(d, o, token, name, {}, {})).forEach(fill); };
  await quiet('UDPO_ProbeTables', 'Table-1.0', ['Id = Input.Id', 'Name = Input.Name'], r => { tables[r.Id] = r.Name; });
  await quiet('UDPO_ProbeTypes', 'DataType-1.0', ['Id = Input.Id', 'Name = Input.Name'], r => { types[r.Id] = r.Name; });
  const columns = [];
  await quiet('UDPO_ProbeColumns', 'Column-1.0', ['TableId = Input.TableId', 'Name = Input.Name', 'Description = Input.Description', 'DataType = Input.DataTypeId', 'IsDiagnostic = Input.IsDiagnostic', 'IsReadable = Input.IsReadable'], r => columns.push(r));
  const want = Object.keys(tables).filter(id => TABLES.test(tables[id]));
  const fieldLines = [], skipped = [];
  const got = {};
  for (const id of want) {
    const table = tables[id];
    const all = columns.filter(c => c.TableId === id && !/^true$/i.test(c.IsDiagnostic || '') && !/^false$/i.test(c.IsReadable || ''));
    all.forEach(c => fieldLines.push('| ' + [table, c.Name, types[c.DataType] || c.DataType, (c.Description || '').replace(/\|/g, '/'), SKIP.test(c.Name) ? 'not asked (private)' : 'asked'].join(' | ') + ' |'));
    const cols = all.map(c => c.Name).filter(n => !SKIP.test(n));
    skipped.push(...all.map(c => c.Name).filter(n => SKIP.test(n)).map(n => table + '.' + n));
    if (!cols.length) continue;
    got[table] = await readTable(d, o, token, table, cols.indexOf('Id') >= 0 ? cols : ['Id'].concat(cols));
    console.log(table + ': ' + got[table].rows.length + ' rows, ' + got[table].cols.length + ' fields');
  }

  // Every table as Fleet sent it.
  Object.keys(got).forEach(t => {
    const g = got[t];
    fs.writeFileSync(path.join(out, 'verizon-' + t.split('-')[0].toLowerCase() + 's.csv'), csv([g.cols].concat(g.rows.map(r => g.cols.map(c => r['F_' + c.replace(/[^A-Za-z0-9]/g, '_')])))));
  });

  // The app's drivers (Driver Roster) and the Employees list (UDMS), from the practice copy.
  const L = require('../functions/src/logic');
  const drivers = (await db.collection('drivers').get()).docs.map(x => Object.assign({ _id: x.id }, x.data())).filter(x => !L.driverDeleted(x));
  const phones = {};
  (await db.collection('driverPhones').get()).docs.forEach(x => { const p = x.data(); phones[p.driverId || x.id] = p.phone || ''; });
  const trucks = (await db.collection('gpsTrucks').get()).docs.map(x => x.data());
  const onTruck = {};
  trucks.forEach(t => { const k = nameKey(t.driver); if (k) (onTruck[k] = onTruck[k] || []).push(t.tag); });
  const appMeta = await db.collection('private').doc('copyFromLive').get().catch(() => null);

  fs.writeFileSync(path.join(out, 'app-drivers.csv'), csv([['Name', 'Employee ID', 'App driver ID', 'Status', 'Phone']]
    .concat(drivers.map(x => [x.name, x.employeeId || '', x.id || x._id, x.status || '', phones[x.id || x._id] || ''])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))))));

  const summary = {
    at: new Date().toISOString(), fleet: d.fleet, tables: Object.keys(got).map(t => ({ table: t, rows: got[t].rows.length, fields: got[t].cols })),
    skipped, notes, appDrivers: drivers.length, gpsTrucks: trucks.length, copyFromLive: appMeta && appMeta.exists ? appMeta.data() : null,
    truckDrivers: Object.keys(onTruck).length
  };
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(out, 'truck-drivers.csv'), csv([['Driver name on the truck in Fleet', 'Trucks']].concat(Object.keys(onTruck).sort().map(k => [k, onTruck[k].join(' ')]))));
  fs.writeFileSync(path.join(out, 'fields.md'), ['| Table | Field | Type | What it is | |', '|---|---|---|---|---|'].concat(fieldLines).join('\n') + '\n');
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
})().catch(e => { console.error('Driver list failed:', String(e && e.message || e).slice(0, 500)); process.exit(1); });

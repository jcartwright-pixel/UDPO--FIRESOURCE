#!/usr/bin/env node
/*
 * Joe 11/4 (chose "Yes, read them with the saved login"): Employees & Compliance (UDMS) needs every current driver's
 * Verizon username for its Accounts set up box, and UDMS cannot reach Verizon (the Fleet login is kept here, in
 * private/gpsFleet). One-off, run from .github/workflows/verizon-drivers.yml on the PRACTICE copy's saved Fleet login
 * (the same Verizon account). Read only: it saves its own reports (templates, Intent = Retrieve) in Fleet, as the Test
 * button does, and runs them. Nothing about a driver is printed: the log shows table/column names and counts only, and
 * the driver list is written to OUT, which the workflow encrypts before it leaves the run.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const req = require('module').createRequire(path.join(__dirname, '..', 'functions', 'package.json'));
const admin = req('firebase-admin');
const { getFirestore } = req('firebase-admin/firestore');
const { internals } = require('../functions/src/fleetgps');
const { key, execute, saveProbeTemplate, withDefaults } = internals;

const sa = require(process.env.KEY);
if (sa.project_id !== 'ud-distribution-sandbox') { console.error('Practice copy only.'); process.exit(1); }
const db = getFirestore(admin.initializeApp({ credential: admin.credential.cert(sa) }));
const out = process.env.OUT || 'verizon-drivers';
fs.mkdirSync(out, { recursive: true });
const WANT = /^(Id|Tag|Nickname|Name|FirstName|LastName|MiddleName|FullName|DisplayName|Login|LoginName|UserName|Username|UserId|DriverId|User|EmployeeId|EmployeeNumber|EmployeeCode|DriverCode|DriverNumber|Code|Number|IsActive|Active|IsDeleted|Deleted|IsDisabled|Disabled|Status|Created|CreatedTime|Modified|LastModified|LastLogin|LastLoginTime|PersonnelId|ExternalId)$/i;

(async () => {
  const o = withDefaults();
  const ref = db.collection('private').doc('gpsFleet');
  const d = (await ref.get()).data() || {};
  if (!d.fleet || !d.user || !d.password) throw new Error('No Fleet login saved on the practice copy.');
  const token = await key(ref, d, o, false);
  const run = (name) => execute(d, o, token, name, {}, { maxPolls: 10 });
  const tables = {};
  await saveProbeTemplate(d, o, token, 'UDPO_ProbeTables', 'Table-1.0', [], [], ['Id = Input.Id', 'Name = Input.Name']);
  (await run('UDPO_ProbeTables')).forEach(r => { tables[r.Id] = r.Name; });
  await saveProbeTemplate(d, o, token, 'UDPO_ProbeColumns', 'Column-1.0', [], [], ['TableId = Input.TableId', 'Name = Input.Name', 'Description = Input.Description', 'DataType = Input.DataTypeId', 'IsDiagnostic = Input.IsDiagnostic', 'IsReadable = Input.IsReadable']);
  const cols = await run('UDPO_ProbeColumns');
  const bare = (n) => String(n).replace(/-[\d.]+$/, '');
  const pick = Object.keys(tables).filter(id => /^(driver|user)$/i.test(bare(tables[id])));
  console.log('Tables named driver/user:', pick.map(id => tables[id] + ' (' + id + ')').join(', ') || 'none');
  console.log('Every table:', Object.values(tables).join(', '));
  const done = [];
  for (const id of pick) {
    const all = cols.filter(c => String(c.TableId) === String(id) && !/^false$/i.test(c.IsReadable || '') && !/^true$/i.test(c.IsDiagnostic || ''));
    console.log('\n' + tables[id] + ' columns:', all.map(c => c.Name).join(', '));
    const use = all.filter(c => WANT.test(c.Name));
    const tableName = String(tables[id]);
    const tableId = /-\d/.test(tableName) ? tableName : tableName + '-1.0';
    const tpl = 'UDPO_Accounts_' + bare(tableName).replace(/[^A-Za-z]/g, '');
    let rows = null, err = '';
    const small = use.filter(c => /^(Id|Name|Nickname|FirstName|LastName|Login|LoginName|UserName|Username|UserId|DriverId|Tag)$/i.test(c.Name));
    for (const set of [use, small]) {
      if (!set.length) continue;
      try {
        await saveProbeTemplate(d, o, token, tpl, tableId, [], [], set.map(c => c.Name + ' = Input.' + c.Name));
        rows = await run(tpl);
        console.log('Asked for:', set.map(c => c.Name).join(', '), '->', rows.length, 'rows');
        break;
      } catch (e) { err = String(e.message || e).slice(0, 300); console.log('Asked for', set.length, 'columns: failed:', err); }
    }
    done.push({ table: tableName, rows: rows ? rows.length : null, error: rows ? '' : err });
    if (rows) fs.writeFileSync(path.join(out, bare(tableName).replace(/[^A-Za-z0-9]/g, '_') + '.json'), JSON.stringify(rows, null, 1));
  }
  fs.writeFileSync(path.join(out, 'columns.json'), JSON.stringify({ tables, columns: cols.filter(c => pick.indexOf(String(c.TableId)) >= 0) }, null, 1));
  console.log('\n' + JSON.stringify(done));
  process.exit(0);
})().catch(e => { console.error(String(e && e.message || e)); process.exit(1); });

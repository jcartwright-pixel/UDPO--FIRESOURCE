/*
 * After a deploy: prints the Employees list's line (Administration > Employees) from the copy's database: when it last read
 * UDMS, any problem, and how many employees are on the list. Counts only, never names. Read only.
 * Usage: node test/browser/employees-status.cjs <project>
 */
'use strict';
const admin = require('firebase-admin');

(async () => {
  const [project] = process.argv.slice(2);
  admin.initializeApp({ projectId: project });
  const db = admin.firestore();
  const s = (await db.collection('config').doc('employees').get()).data();
  if (!s) { console.log('Employees: not read from UDMS yet'); return; }
  const list = await db.collection('employees').where('active', '==', true).count().get();
  console.log('Employees: ' + (s.ok === false ? 'RED ' + s.problem : 'GREEN up to date with UDMS') + ', last checked ' + s.checkedAt + ', ' + list.data().count + ' active on the list');
})().catch(e => {
  // The live deploy key may not read the live database (the server's own account reads UDMS, not this key).
  if (/PERMISSION_DENIED|permission/i.test(e.message)) { console.log('Employees: this deploy key cannot read the database here; open Administration > Employees to see the line.'); return; }
  console.error(e.message); process.exit(1);
});

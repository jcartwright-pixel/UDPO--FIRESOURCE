/*
 * After a deploy: waits for the sandbox copy to run once after the given time, then prints what it copied
 * (rows per sheet and the first warnings). Read only. Usage: node test/browser/last-transfer.cjs <project> <ISO time>
 */
'use strict';
const admin = require('firebase-admin');

(async () => {
  const [project, since] = process.argv.slice(2);
  admin.initializeApp({ projectId: project });
  const db = admin.firestore();
  const deadline = Date.now() + 5 * 60 * 1000;
  let last = null;
  while (Date.now() < deadline) {
    const app = (await db.collection('config').doc('app').get()).data() || {};
    last = app.lastTransfer;
    if (last && last.at > since) break;
    await new Promise(r => setTimeout(r, 15000));
  }
  if (!last || last.at <= since) { console.log('::error::The sandbox copy has not run since ' + since + ' (last: ' + JSON.stringify(last) + ')'); process.exit(1); }
  const run = (await db.collection('transfers').doc(last.id).get()).data();
  console.log('Copied at ' + run.at + ', warnings: ' + run.warningCount);
  Object.keys(run.summary.masters).forEach(k => console.log('  ' + k + ': ' + run.summary.masters[k].rows + ' rows'));
  Object.keys(run.summary.weeks).forEach(k => console.log('  week ' + k + ' (' + run.summary.weeks[k].tab + '): ' + run.summary.weeks[k].rows + ' runs'));
  (run.warnings || []).slice(0, 15).forEach(w => console.log('  warning: ' + (typeof w === 'string' ? w : JSON.stringify(w))));
})().catch(e => { console.error(e.message); process.exit(1); });

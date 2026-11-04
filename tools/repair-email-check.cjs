'use strict';
// Read only (Joe 11/4, truck 224001; Joe approved this check): why the Lessor email did not go. Prints statuses and reasons
// only; every email address is hidden, because this run's log can be read by anyone who can see the repository.
const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.cert(require(process.env.KEY)) });
const db = admin.firestore();
const hide = (s) => String(s || '').replace(/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+)/g, '***@$1');
(async () => {
  const es = (await db.collection('private').doc('emailSettings').get()).data() || {};
  console.log('Sending on:', es.sending !== false, '| changed', es.changedAt, 'by', hide(es.changedBy), '| from:', es.fromWho || 'PERSON', '| plant senders set:', Object.keys(es.senders || {}).filter(k => (es.senders[k] || {}).address).join(',') || 'none');
  const re = (await db.collection('private').doc('repairEmail').get()).data() || {};
  Object.entries(re.routes || {}).forEach(([k, r]) => console.log('Route', k, '| mode:', r.mode, '| addresses:', (r.emails || []).length, '| since', r.since));
  console.log('Repair settings saved', re.updatedAt, 'by', hide(re.updatedBy));
  const h = (await db.collection('private').doc('repairEmailHistory').get()).data() || {};
  (h.saves || []).slice(0, 5).forEach(s => { const i = ((s.before || {}).routes || {}).IDEALEASE || {}; console.log('  replaced', s.replacedAt, 'by', hide(s.replacedBy), '| Idealease was', i.mode, (i.emails || []).length, 'addresses'); });
  const since = new Date(Date.now() - 4 * 86400000).toISOString();
  const logs = await db.collection('sentEmails').where('at', '>=', since).get();
  logs.docs.map(d => d.data()).filter(l => /Repair/i.test(l.kind)).sort((a, b) => a.at < b.at ? -1 : 1)
    .forEach(l => console.log('Log', l.at, '|', l.status, '|', l.label, '|', hide(l.detail), '| from', hide(l.from), '|', hide(l.reason)));
  const m = await db.collection('maintenance').where('truck_number', '==', '224001').get();
  m.docs.forEach(d => { const r = d.data(); console.log('Write-up', d.id, '|', r.status, '|', r.facility_id, '|', r.kind, '|', String(r.issue_details || '').slice(0, 40)); String(r.notes || '').split('\n').forEach(x => console.log('   ', hide(x))); });
})().catch(e => { console.error('Check failed:', e.message); process.exit(1); });

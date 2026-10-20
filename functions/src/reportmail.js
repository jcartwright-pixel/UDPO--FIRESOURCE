/*
 * Send Current Report, the email half: runs when a report is saved (plantReports/{id}) and emails it, outside the save.
 *
 *   MAIL_FROM    the United Dairy mailbox the report is sent from (unset: the report is kept, not emailed), unless
 *                it goes from the person who pressed Send (Joe 10/11), or Email Senders sets the plant's own mailbox
 *   REPORT_TO    the Plant Managers group's addresses (comma-separated), used only for a report sent in live mode
 *
 * A report sent from test mode, or from live mode before REPORT_TO is set, goes only to the person who pressed Send,
 * so the sandbox can never email the managers. Send Test to Me (testOnly, Joe 10/19) goes only to that person on live too.
 * The Late Forecast box goes only to that person until Administration > Sent Email Log switches it to everyone. The report's status says what happened: SENT (sentTo), HELD or FAILED
 * (reason in plain words); the Manager Center shows it.
 */
'use strict';

const R = require('./plant-rules');
const { sendMail, addresses } = require('./mail');
const { emailSettings, senderFor, personFor } = require('./adminmail');

const REASON = {
  NOT_DELEGATED: 'Email is waiting on one Google Workspace step (letting the app send Gmail as United Dairy).',
  BAD_SENDER: 'The sender address set for the app is not a United Dairy Gmail account.',
  SIGN: 'The app\'s server account is not allowed to sign for email yet.',
  GMAIL_OFF: 'Gmail is not turned on for the app\'s Google Cloud project yet.'
};

function recipients(report, env) {
  const group = addresses(env.REPORT_TO);
  if (report.mode === 'live' && group.length && !report.testOnly) return { to: group, copy: false };
  return { to: addresses([report.by]), copy: true };
}

// Joe 10/19 (Late Forecast): an email to the groups leaves the forecast box out until it is switched on for everyone.
function withoutForecast(report) {
  let r;
  try { r = JSON.parse(report.reportJson || ''); } catch (e) { return report; }
  if (!r || !r.forecast) return report;
  r.forecast = null;
  return Object.assign({}, report, { reportJson: JSON.stringify(r), text: (report.note ? 'NOTE: ' + report.note + '\n\n' : '') + R.reportText(r) });
}

function reportHtml(report) {
  if (report.reportJson) {
    try { return R.reportHtml(JSON.parse(report.reportJson), report.note); } catch (e) { /* the plain text below */ }
  }
  const e = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return '<!doctype html><html><head><meta charset="utf-8"></head><body><pre style="font:14px/1.4 Consolas,Menlo,monospace;white-space:pre-wrap">' + e(report.text) + '</pre></body></html>';
}

// Administration > Sent Email Log. A log line that cannot be written never stops the report.
async function logReport(db, report, status, sentTo, reason, from) {
  try {
    await db.collection('sentEmails').add({ at: new Date().toISOString(), kind: 'Plant report', label: report.group || report.groupName || 'Current report', detail: report.mode || '', by: report.by || '',
      meantFor: [], subject: String(report.subject || '').slice(0, 300), sentTo, status, reason: String(reason || '').slice(0, 200), testCopy: report.mode !== 'live' || !!report.testOnly, from: from || '' });
  } catch (e) { console.error('Sent Email Log', e.message || e); }
}

// ref: the plantReports document; deps: { env, sendMail } (fakes in the tests).
async function mailReport(ref, report, deps) {
  const d = deps || {};
  let env = d.env || process.env;
  const send = d.sendMail || sendMail;
  let settingsOf = d.settings || null;
  if (!report || report.status !== 'SENDING') return null;
  let sender = { from: String(env.MAIL_FROM || '').trim(), fromName: 'United Dairy Plant Operations' };
  if (!sender.from) {
    await ref.update({ status: 'HELD', emailed: false, reason: 'Email is not set up in Operations yet.' });
    return 'HELD';
  }
  // Administration: the Sending switch, and the location's report group the sender picked (live mode only; the sandbox
  // sends to the sender). Both are read only where the report document comes from the database (not in the unit tests).
  const db = d.db || (ref && ref.firestore) || null;
  if (db) {
    const s = await emailSettings(db);
    settingsOf = s;
    sender = senderFor(s, report.facilityId, env, 'United Dairy Plant Operations', await personFor(db, report.by));
    if (!s.sending) {
      await ref.update({ status: 'HELD', emailed: false, reason: 'Sending is OFF (Administration > Sent Email Log).' });
      await logReport(db, report, 'BLOCKED', [], 'Outbound email is turned off.');
      return 'HELD';
    }
    // Joe 10/14: the report is saved with groupName ("Plant Managers"); reading report.group here missed it, so a live
    // report went only to the sender. The group of that name, else the plant's only group, from Manager Report Recipients.
    const groupName = report.groupName || report.group || '';
    if (report.mode === 'live' && groupName) {
      const groups = (await db.collection('reportGroups').where('facilityId', '==', report.facilityId || 'fac_uniontown').get()).docs.map(x => x.data())
        .filter(x => x.active !== false && x.recipients && x.recipients.length);
      const g = groups.find(x => x.name === groupName) || (groups.length === 1 ? groups[0] : null);
      if (g) { env = Object.assign({}, env, { REPORT_TO: g.recipients.join(',') }); report = Object.assign({}, report, { group: g.name }); }
    }
  }
  const { to, copy } = recipients(report, env);
  if (!copy && !(settingsOf && settingsOf.forecastEveryone)) report = withoutForecast(report);
  if (!to.length) {
    await ref.update({ status: 'FAILED', emailed: false, reason: 'No email address to send to.' });
    return 'FAILED';
  }
  try {
    const sent = await send({ from: sender.from, fromName: sender.fromName, to, subject: report.subject, text: report.text, html: reportHtml(report) });
    await ref.update({ status: 'SENT', emailed: true, sentTo: sent.to, testCopy: copy, groupName: report.group || report.groupName || '', sentAt: Date.now(), gmailId: sent.id || '', reason: '' });
    if (db) await logReport(db, report, 'SENT', sent.to, report.testOnly ? 'Send Test to Me: sent only to ' + sent.to.join(', ') + '.' : copy ? 'Test copy: sent only to ' + sent.to.join(', ') + '.' : '', sender.from);
    return 'SENT';
  } catch (e) {
    const reason = REASON[e.code] || ('The email did not go out: ' + (e.message || e));
    console.error('Send Current Report email failed', e.code || '', e.message || e);
    await ref.update({ status: 'FAILED', emailed: false, reason, errorCode: e.code || 'ERROR' });
    if (db) await logReport(db, report, 'FAILED', [], reason, sender.from);
    return 'FAILED';
  }
}

module.exports = { mailReport, recipients, reportHtml, withoutForecast, REASON };

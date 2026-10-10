/*
 * Send Current Report, the email half: runs when a report is saved (plantReports/{id}) and emails it, outside the save.
 *
 *   MAIL_FROM    the United Dairy mailbox the report is sent from (unset: the report is kept, not emailed)
 *   REPORT_TO    the Plant Managers group's addresses (comma-separated), used only for a report sent in live mode
 *
 * A report sent from test mode, or from live mode before REPORT_TO is set, goes only to the person who pressed Send,
 * so the sandbox can never email the managers. The report's status says what happened: SENT (sentTo), HELD or FAILED
 * (reason in plain words); the Manager Center shows it.
 */
'use strict';

const R = require('./plant-rules');
const { sendMail, addresses } = require('./mail');

const REASON = {
  NOT_DELEGATED: 'Email is waiting on one Google Workspace step (letting the app send Gmail as United Dairy).',
  BAD_SENDER: 'The sender address set for the app is not a United Dairy Gmail account.',
  SIGN: 'The app\'s server account is not allowed to sign for email yet.',
  GMAIL_OFF: 'Gmail is not turned on for the app\'s Google Cloud project yet.'
};

function recipients(report, env) {
  const group = addresses(env.REPORT_TO);
  if (report.mode === 'live' && group.length) return { to: group, copy: false };
  return { to: addresses([report.by]), copy: true };
}

function reportHtml(report) {
  if (report.reportJson) {
    try { return R.reportHtml(JSON.parse(report.reportJson), report.note); } catch (e) { /* the plain text below */ }
  }
  const e = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return '<!doctype html><html><head><meta charset="utf-8"></head><body><pre style="font:14px/1.4 Consolas,Menlo,monospace;white-space:pre-wrap">' + e(report.text) + '</pre></body></html>';
}

// ref: the plantReports document; deps: { env, sendMail } (fakes in the tests).
async function mailReport(ref, report, deps) {
  const d = deps || {};
  const env = d.env || process.env;
  const send = d.sendMail || sendMail;
  if (!report || report.status !== 'SENDING') return null;
  const from = String(env.MAIL_FROM || '').trim();
  if (!from) {
    await ref.update({ status: 'HELD', emailed: false, reason: 'Email is not set up in the new app yet.' });
    return 'HELD';
  }
  const { to, copy } = recipients(report, env);
  if (!to.length) {
    await ref.update({ status: 'FAILED', emailed: false, reason: 'No email address to send to.' });
    return 'FAILED';
  }
  try {
    const sent = await send({ from, fromName: 'United Dairy Plant Operations', to, subject: report.subject, text: report.text, html: reportHtml(report) });
    await ref.update({ status: 'SENT', emailed: true, sentTo: sent.to, testCopy: copy, sentAt: Date.now(), gmailId: sent.id || '', reason: '' });
    return 'SENT';
  } catch (e) {
    const reason = REASON[e.code] || ('The email did not go out: ' + (e.message || e));
    console.error('Send Current Report email failed', e.code || '', e.message || e);
    await ref.update({ status: 'FAILED', emailed: false, reason, errorCode: e.code || 'ERROR' });
    return 'FAILED';
  }
}

module.exports = { mailReport, recipients, reportHtml, REASON };

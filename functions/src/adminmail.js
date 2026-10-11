/*
 * Every email the new app sends goes through here (Administration > Sent Email Log and its Sending switch).
 *
 *   - Sending OFF (private/emailSettings.sending === false): nothing goes out; the log says BLOCKED ("Stopped (off)").
 *   - Until LIVE_EMAIL=1 is set on the server (production, after Joe says go), an email goes only to the person who pressed
 *     the button, never to the addresses it was meant for; the log keeps both. The sandbox never sets LIVE_EMAIL.
 *   - MAIL_FROM unset: nothing goes out (HELD, "Email is not set up").
 * Each email is logged in sentEmails (newest first on the screen) with what happened.
 */
'use strict';

const { sendMail, addresses } = require('./mail');

const REASON = {
  NOT_DELEGATED: 'Email is waiting on one Google Workspace step (letting the app send Gmail as United Dairy).',
  BAD_SENDER: 'The sender address set for the app is not a United Dairy Gmail account.',
  SIGN: 'The app\'s server account is not allowed to sign for email yet.',
  GMAIL_OFF: 'Gmail is not turned on for the app\'s Google Cloud project yet.'
};

const liveEmail = (env) => String((env || process.env).LIVE_EMAIL || '') === '1';

async function emailSettings(db) {
  const d = (await db.collection('private').doc('emailSettings').get()).data() || {};
  return { sending: d.sending !== false, changedAt: d.changedAt || '', changedBy: d.changedBy || '' };
}

/*
 * msg: { kind, by, to: [..] or text, subject, text, html, fromName }. Returns { status: SENT|BLOCKED|HELD|FAILED, sentTo, reason, logId }.
 * deps: { env, sendMail, now } (fakes in the tests).
 */
async function appMail(db, msg, deps) {
  const d = deps || {};
  const env = d.env || process.env;
  const send = d.sendMail || sendMail;
  const at = (d.now ? d.now() : new Date()).toISOString();
  const meant = addresses(msg.to);
  const by = addresses([msg.by])[0] || '';
  const who = by || String(msg.by || 'SCHEDULE');
  const live = liveEmail(env);
  // A scheduled email (no one pressed a button) goes, outside production, to the administrator who set it up (testTo).
  const testTo = by || addresses([msg.testTo])[0] || '';
  const to = live ? meant : (testTo ? [testTo] : []);
  const log = { at, kind: String(msg.kind || 'Email'), label: String(msg.label || '').slice(0, 60), detail: String(msg.detail || '').slice(0, 120), by: who, meantFor: meant, subject: String(msg.subject || '').slice(0, 300), sentTo: [], status: '', reason: '', testCopy: !live };
  const settings = await emailSettings(db);
  const from = String(env.MAIL_FROM || '').trim();
  if (!settings.sending) Object.assign(log, { status: 'BLOCKED', reason: 'Outbound email is turned off.' });
  else if (!from) Object.assign(log, { status: 'HELD', reason: 'Email is not set up in the new app yet.' });
  else if (!to.length) Object.assign(log, { status: 'FAILED', reason: 'No email address to send to.' });
  else {
    try {
      const sent = await send({ from, fromName: msg.fromName || 'United Dairy Operations', to, subject: msg.subject, text: msg.text, html: msg.html || '' });
      Object.assign(log, { status: 'SENT', sentTo: sent.to, reason: live ? '' : 'Test copy: sent only to ' + testTo + ' (the sandbox never emails anyone else).' });
    } catch (e) {
      Object.assign(log, { status: 'FAILED', reason: REASON[e.code] || ('The email did not go out: ' + (e.message || e)) });
    }
  }
  const ref = await db.collection('sentEmails').add(log);
  return { status: log.status, sentTo: log.sentTo, reason: log.reason, logId: ref.id, testCopy: log.testCopy };
}

module.exports = { appMail, emailSettings, liveEmail, REASON };

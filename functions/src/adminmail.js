/*
 * Every email the new app sends goes through here (Administration > Sent Email Log and its Sending switch).
 *
 *   - Sending OFF (private/emailSettings.sending === false): nothing goes out; the log says BLOCKED ("Stopped (off)").
 *   - Until LIVE_EMAIL=1 is set on the server (production since Joe 10/14, production-settings.json), an email goes only to the person who pressed
 *     the button, never to the addresses it was meant for; the log keeps both. The sandbox never sets LIVE_EMAIL.
 *   - MAIL_FROM unset and no plant mailbox set: nothing goes out (HELD, "Email is not set up").
 *   - From (Joe 10/11): the United Dairy person who pressed Send, from their own mailbox. An email no one pressed
 *     (automatic, scheduled) comes from the plant's mailbox set in Administration > Email Senders, else MAIL_FROM.
 *     Email Senders can switch every email to the plant mailbox instead.
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

const DOMAIN = '@uniteddairy.com';
const PLANT_NAME = 'United Dairy Plant Operations';
// Only a United Dairy mailbox can be sent from: Google lets the app send as United Dairy accounts only.
const ourAddress = (a) => { const x = addresses([a])[0] || ''; return x.endsWith(DOMAIN) ? x : ''; };

async function emailSettings(db) {
  const d = (await db.collection('private').doc('emailSettings').get()).data() || {};
  const senders = {};
  Object.keys(d.senders || {}).forEach(k => { const v = d.senders[k] || {}; senders[k] = { address: ourAddress(v.address), name: String(v.name || '').slice(0, 80), changedAt: v.changedAt || '', changedBy: v.changedBy || '' }; });
  return { sending: d.sending !== false, changedAt: d.changedAt || '', changedBy: d.changedBy || '', senders, fromWho: d.fromWho === 'PLANT' ? 'PLANT' : 'PERSON',
    // Joe 10/19 (Late Forecast): the forecast box goes in the report email to the groups only once it is switched to Everyone;
    // until then only a test sent to oneself carries it.
    forecastEveryone: d.forecastEveryone === true, forecastChangedAt: d.forecastChangedAt || '', forecastChangedBy: d.forecastChangedBy || '' };
}

// The person who pressed Send, as { email, name }, or null (no one pressed it, or not a United Dairy address).
async function personFor(db, email) {
  const a = ourAddress(email);
  if (!a) return null;
  let name = '';
  try { name = String(((await db.collection('users').doc(a).get()).data() || {}).name || ''); } catch (e) { /* the address alone */ }
  return { email: a, name };
}

/*
 * Who an email comes from. settings: emailSettings(); facilityId: the plant it is about; person: { email, name } when a
 * person pressed Send (their name from People & Roles). Returns { from, fromName, how }.
 */
function senderFor(settings, facilityId, env, fallbackName, person) {
  if (settings && settings.fromWho === 'PLANT') person = null;
  if (person && ourAddress(person.email)) return { from: ourAddress(person.email), fromName: String(person.name || ''), how: 'person' };
  const s = ((settings && settings.senders) || {})[facilityId || 'fac_uniontown'] || {};
  if (s.address) return { from: s.address, fromName: s.name || fallbackName || PLANT_NAME, how: 'plant' };
  return { from: String((env || {}).MAIL_FROM || '').trim(), fromName: s.name || fallbackName || PLANT_NAME, how: 'default' };
}

/*
 * msg: { kind, by, to: [..] or text, subject, text, html, fromName, facilityId }. Returns { status: SENT|BLOCKED|HELD|FAILED, sentTo, reason, logId }.
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
  const sender = senderFor(settings, msg.facilityId, env, msg.fromName || 'United Dairy Operations', await personFor(db, by));
  const from = sender.from;
  log.from = from;
  if (!settings.sending) Object.assign(log, { status: 'BLOCKED', reason: 'Outbound email is turned off.' });
  else if (!from) Object.assign(log, { status: 'HELD', reason: 'Email is not set up in Operations yet.' });
  else if (!to.length) Object.assign(log, { status: 'FAILED', reason: 'No email address to send to.' });
  else {
    try {
      const sent = await send({ from, fromName: sender.fromName, to, subject: msg.subject, text: msg.text, html: msg.html || '' });
      Object.assign(log, { status: 'SENT', sentTo: sent.to, reason: live ? '' : 'Test copy: sent only to ' + testTo + ' (the sandbox never emails anyone else).' });
    } catch (e) {
      Object.assign(log, { status: 'FAILED', reason: REASON[e.code] || ('The email did not go out: ' + (e.message || e)) });
    }
  }
  const ref = await db.collection('sentEmails').add(log);
  return { status: log.status, sentTo: log.sentTo, reason: log.reason, logId: ref.id, testCopy: log.testCopy };
}

module.exports = { appMail, emailSettings, senderFor, personFor, ourAddress, liveEmail, REASON, DOMAIN };

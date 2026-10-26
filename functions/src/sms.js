/*
 * Schedule Texts (Joe 10/15: "build it, have everything ready but not implemented just yet ... put something in
 * administration to keep it off"): when a new week is posted (Weekly Publish makes it the Live Current week, here or in
 * the current app), every driver on that week who has a mobile phone number gets one text saying his schedule is posted.
 *
 * - Off until an administrator turns it On in Administration > Schedule Texts. Turning it On never texts the week that is
 *   already posted; only the next one.
 * - The texting service is Twilio. The Account SID, Auth Token and From number are typed into that screen only; they are
 *   kept in private/sms, which no screen can read (firestore.rules), and never shown again.
 * - Mobile phone numbers are typed on the Driver Roster and kept in driverPhones/{driverId} (the Live sheet copy rewrites
 *   the driver records, so the number does not live on them). A number in Driver Master's own phone column is used when
 *   the roster has none.
 * - Replies (Joe 10/15, "so I could have a list of replies"): Twilio posts each text a driver sends to the number to
 *   smsReply (index.js); a reply signed with the saved Auth Token is kept in textLog (direction 'in') with the driver it
 *   came from, and Schedule Texts lists texts and replies together, newest first.
 * - Until LIVE_TEXTS=1 is set on the server, nothing is sent: each text is written to textLog as "Test copy: not sent".
 *   The test copy (sandbox) never sets it.
 */
'use strict';

const crypto = require('crypto');
const L = require('./logic');
const { COLLECTIONS: C, safeIdPart } = require('./model');

const ROLES = ['ADMINISTRATOR', 'ADMIN'];
const PRIVATE = (db) => db.collection('private').doc('sms');
const TWILIO = 'https://api.twilio.com/2010-04-01/Accounts/';

class SmsError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const liveTexts = (env) => String((env || process.env).LIVE_TEXTS || '') === '1';

// A US mobile number as Twilio wants it (+13305551234), or '' when it is not one.
function phoneE164(v) {
  const d = String(v || '').replace(/\D+/g, '');
  if (d.length === 10 && /^[2-9]/.test(d)) return '+1' + d;
  if (d.length === 11 && d[0] === '1' && /^[2-9]/.test(d[1])) return '+' + d;
  return '';
}
// As people write it: 330-555-1234.
function phoneText(v) { const e = phoneE164(v); return e ? e.slice(2, 5) + '-' + e.slice(5, 8) + '-' + e.slice(8) : ''; }

// 10-18-26, as every date in the app.
const dateText = (k) => { const [y, m, d] = String(k).split('-'); return Number(m) + '-' + Number(d) + '-' + String(y).slice(2); };
function messageFor(week) {
  return 'United Dairy: your schedule for the week of ' + dateText(week) + ' to ' + dateText(L.addDays(week, 6)) + ' is posted. Open UD Routes > My Schedule to see it.';
}

async function adminOnly(db, user) {
  const email = String(user && user.email || '').toLowerCase();
  // The one Users list (Uniontown's database), whichever plant this is for.
  const snap = await require('./plants').companyDb(db).collection(C.users).doc(safeIdPart(email)).get();
  const person = snap.exists ? snap.data() : null;
  if (!person || person.status !== 'ACTIVE' || !L.hasRole(person, ROLES)) throw new SmsError('NOT_ALLOWED', 'Only an administrator can change Schedule Texts');
  return email;
}

// Every active driver on the week (a run that runs with his id on it), with the number he would be texted at.
async function weekDrivers(db, week) {
  const [runs, drivers, phones] = await Promise.all([db.collection(C.runs).where('weekStart', '==', week).get(), db.collection(C.drivers).get(), db.collection('driverPhones').get()]);
  const on = new Set();
  L.weeklyRows(runs.docs.map(d => Object.assign({}, d.data(), { id: d.id })), week).forEach(r => L.DAYS.forEach(p => { if (r.days[p].runs && r.days[p].driverId) on.add(r.days[p].driverId); }));
  const typed = {};
  phones.docs.forEach(d => { typed[d.id] = d.data().phone || ''; });
  return drivers.docs.map(d => Object.assign({ id: d.id }, d.data())).filter(d => on.has(d.id) && L.driverActive(d))
    .map(d => ({ driverId: d.id, name: d.name || '', phone: phoneE164(typed[safeIdPart(d.id)] || d.phone || '') }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const status = (d, env, project) => ({ replyAddress: project ? replyAddress(project) : '', on: !!d.on, hasSid: !!d.accountSid, hasToken: !!d.authToken, from: d.fromNumber ? phoneText(d.fromNumber) : '', live: liveTexts(env),
  savedAt: d.savedAt || '', savedBy: d.savedBy || '', switchedAt: d.switchedAt || '', switchedBy: d.switchedBy || '', lastWeek: d.lastWeek || '', lastSend: d.lastSend || null });

/* input.op: status | save {accountSid, authToken, fromNumber} | clear | setOn {on} | preview */
async function smsCall(db, user, input, options) {
  input = input || {};
  const o = Object.assign({ now: () => new Date(), env: process.env, project: process.env.GCLOUD_PROJECT || JSON.parse(process.env.FIREBASE_CONFIG || '{}').projectId || '' }, options || {});
  const email = await adminOnly(db, user);
  const ref = PRIVATE(db), d = (await ref.get()).data() || {}, op = String(input.op || 'status');
  const stamp = o.now().toISOString();
  if (op === 'status') return status(d, o.env, o.project);
  if (op === 'save') {
    const next = Object.assign({}, d);
    const sid = String(input.accountSid || '').trim(), token = String(input.authToken || '').trim(), from = String(input.fromNumber || '').trim();
    if (sid && !/^AC[0-9a-fA-F]{32}$/.test(sid)) throw new SmsError('BAD_REQUEST', 'The Account SID starts with AC and has 34 letters and numbers. Copy it from the Twilio Console.');
    if (from && !phoneE164(from)) throw new SmsError('BAD_REQUEST', 'Type the Twilio phone number as 10 digits, like 330-555-1234.');
    if (sid) next.accountSid = sid;
    if (token) next.authToken = token.slice(0, 200);
    if (from) next.fromNumber = phoneE164(from);
    Object.assign(next, { savedAt: stamp, savedBy: email });
    await ref.set(next);
    return status(next, o.env, o.project);
  }
  if (op === 'clear') {
    const next = { on: false, lastWeek: d.lastWeek || '', savedAt: stamp, savedBy: email, switchedAt: stamp, switchedBy: email };
    await ref.set(next);
    return status(next, o.env, o.project);
  }
  if (op === 'setOn') {
    const on = input.on === true;
    if (on && !(d.accountSid && d.authToken && d.fromNumber)) throw new SmsError('NOT_ALLOWED', 'Save the Twilio Account SID, Auth Token and phone number first.');
    // Turning it On never texts the week already posted: that week counts as done.
    const live = ((await db.collection(C.config).doc('app').get()).data() || {}).liveWeeks || {};
    const next = Object.assign({}, d, { on, switchedAt: stamp, switchedBy: email }, on ? { lastWeek: live.current || d.lastWeek || '' } : {});
    await ref.set(next);
    return status(next, o.env, o.project);
  }
  if (op === 'preview') {
    const live = ((await db.collection(C.config).doc('app').get()).data() || {}).liveWeeks || {};
    const week = live.next || live.current || '';
    const list = week ? await weekDrivers(db, week) : [];
    return Object.assign(status(d, o.env, o.project), { week, message: week ? messageFor(week) : '', drivers: list.map(x => ({ name: x.name, phone: phoneText(x.phone) })) });
  }
  throw new SmsError('BAD_REQUEST', 'Unknown Schedule Texts step ' + op.slice(0, 30));
}

async function sendOne(d, to, body, fetchFn) {
  const res = await fetchFn(TWILIO + encodeURIComponent(d.accountSid) + '/Messages.json', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(d.accountSid + ':' + d.authToken).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: to, From: d.fromNumber, Body: body }).toString()
  });
  if (res.ok) return { ok: true };
  let why = '';
  try { const j = await res.json(); why = j && j.message || ''; } catch (e) { why = ''; }
  return { ok: false, reason: 'Twilio refused (' + res.status + ')' + (why ? ': ' + String(why).slice(0, 200) : '') };
}

/*
 * The minute job (index.js transferEveryMinute): when the Live Current week is a week not texted yet and the switch is On,
 * text it once. Returns what it did, or null when there was nothing to do.
 */
async function postedCheck(db, options) {
  const o = Object.assign({ now: () => new Date(), env: process.env, fetch: (...a) => fetch(...a) }, options || {});
  const ref = PRIVATE(db), d = (await ref.get()).data() || {};
  if (!d.on) return null;
  const week = (((await db.collection(C.config).doc('app').get()).data() || {}).liveWeeks || {}).current || '';
  if (!week || week <= String(d.lastWeek || '')) return null;
  // Claim the week first, so two minute runs never text the same week twice.
  const claimed = await db.runTransaction(async tx => {
    const s = (await tx.get(ref)).data() || {};
    if (!s.on || week <= String(s.lastWeek || '')) return false;
    tx.set(ref, { lastWeek: week }, { merge: true });
    return true;
  });
  if (!claimed) return null;
  const stamp = o.now().toISOString(), live = liveTexts(o.env), body = messageFor(week), list = await weekDrivers(db, week);
  let sent = 0, failed = 0, noPhone = 0;
  for (const x of list) {
    const log = { direction: 'out', week, driverId: x.driverId, name: x.name, to: x.phone, body, at: stamp };
    if (!x.phone) { noPhone++; Object.assign(log, { status: 'NO PHONE', reason: 'No mobile phone number on the Driver Roster.' }); }
    else if (!live) { Object.assign(log, { status: 'NOT SENT', reason: 'Test copy: not sent (the test copy never texts anyone).' }); }
    else {
      let r;
      try { r = await sendOne(d, x.phone, body, o.fetch); } catch (e) { r = { ok: false, reason: String(e && e.message || e).slice(0, 200) }; }
      if (r.ok) sent++; else failed++;
      Object.assign(log, r.ok ? { status: 'SENT', reason: '' } : { status: 'FAILED', reason: r.reason });
    }
    await db.collection('textLog').doc(week + '_' + safeIdPart(x.driverId)).set(log);
  }
  const lastSend = { week, at: stamp, drivers: list.length, sent, failed, noPhone, live };
  await ref.set({ lastSend }, { merge: true });
  return lastSend;
}

/*
 * A text a driver sent to the Twilio number (Twilio's "A message comes in" webhook, a form POST). Only a request signed with
 * the saved Auth Token is kept (Twilio's X-Twilio-Signature: HMAC-SHA1 of the address plus each field name and value in
 * name order). Returns [status, body]; the body is an empty TwiML answer, so Twilio sends nothing back to the driver.
 */
const TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
function twilioSignature(token, url, params) {
  const data = url + Object.keys(params || {}).sort().map(k => k + params[k]).join('');
  return crypto.createHmac('sha1', token).update(Buffer.from(data, 'utf8')).digest('base64');
}
const replyAddress = (project) => 'https://us-east4-' + project + '.cloudfunctions.net/smsReply';
async function handleReply(db, url, headers, params, options) {
  const o = Object.assign({ now: () => new Date() }, options || {});
  params = params || {};
  const d = (await PRIVATE(db).get()).data() || {};
  const given = String((headers || {})['x-twilio-signature'] || '');
  if (!d.authToken || !given) return [403, TWIML];
  const want = twilioSignature(d.authToken, url, params);
  if (given.length !== want.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(want))) return [403, TWIML];
  if (d.accountSid && params.AccountSid && params.AccountSid !== d.accountSid) return [403, TWIML];
  const from = phoneE164(params.From), sid = String(params.MessageSid || params.SmsSid || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 64);
  if (!sid) return [200, TWIML];
  // Who sent it: the Driver Roster's number, else Driver Master's own phone column.
  let driver = null;
  if (from) {
    const phones = await db.collection('driverPhones').where('phone', '==', from).limit(1).get();
    const id = phones.empty ? '' : phones.docs[0].data().driverId || phones.docs[0].id;
    const all = (await db.collection(C.drivers).get()).docs.map(x => Object.assign({ id: x.id }, x.data()));
    driver = (id && all.find(x => x.id === id)) || all.find(x => phoneE164(x.phone) === from) || null;
  }
  await db.collection('textLog').doc('in_' + sid).set({ direction: 'in', from, driverId: driver ? driver.id : '', name: driver ? driver.name || '' : '', body: String(params.Body || '').slice(0, 1600), at: o.now().toISOString(), status: 'RECEIVED' });
  return [200, TWIML];
}

module.exports = { smsCall, postedCheck, handleReply, twilioSignature, replyAddress, weekDrivers, phoneE164, phoneText, messageFor, SmsError, liveTexts };

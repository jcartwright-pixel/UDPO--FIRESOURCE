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
const B = require('./board-rules');
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
  if (!person || person.status !== 'ACTIVE' || !L.hasRole(person, ROLES)) throw new SmsError('NOT_ALLOWED', 'Only an administrator can change Texts');
  return email;
}

// Every active driver on the week (a run that runs with his id on it) with Schedule ticked under Texts on the Driver Roster
// (Joe 10/26: "the driver's roster ... will control who gets them"), with the number he would be texted at.
async function weekDrivers(db, week) {
  const [runs, drivers, phones] = await Promise.all([db.collection(C.runs).where('weekStart', '==', week).get(), db.collection(C.drivers).get(), db.collection('driverPhones').get()]);
  const on = new Set();
  L.weeklyRows(runs.docs.map(d => Object.assign({}, d.data(), { id: d.id })), week).forEach(r => L.DAYS.forEach(p => { if (r.days[p].runs && r.days[p].driverId) on.add(r.days[p].driverId); }));
  const typed = {};
  phones.docs.forEach(d => { typed[d.id] = d.data(); });
  return drivers.docs.map(d => Object.assign({ id: d.id }, d.data())).filter(d => on.has(d.id) && L.driverActive(d) && (typed[safeIdPart(d.id)] || {}).scheduleText === true)
    .map(d => ({ driverId: d.id, name: d.name || '', phone: phoneE164((typed[safeIdPart(d.id)] || {}).phone || d.phone || '') }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Every active driver on the Driver Roster, with the number he would be texted at and his Texts ticks (Schedule, Load).
async function activeDrivers(db) {
  const [drivers, phones] = await Promise.all([db.collection(C.drivers).get(), db.collection('driverPhones').get()]);
  const typed = {};
  phones.docs.forEach(d => { typed[d.id] = d.data(); });
  return drivers.docs.map(d => Object.assign({ id: d.id }, d.data())).filter(d => d.name && L.driverActive(d))
    .map(d => { const t = typed[safeIdPart(d.id)] || {};
      return { driverId: d.id, name: d.name || '', phone: phoneE164(t.phone || d.phone || ''), scheduleText: t.scheduleText === true, loadText: t.loadText === true, loadTextAt: t.loadTextAt || '', stoppedAt: t.stoppedAt || '' }; })
    .sort((a, b) => a.name.localeCompare(b.name));
}

const status = (d, env, project) => ({ replyAddress: project ? replyAddress(project) : '', on: !!d.on, hasSid: !!d.accountSid, hasToken: !!d.authToken, from: d.fromNumber ? phoneText(d.fromNumber) : '', live: liveTexts(env),
  savedAt: d.savedAt || '', savedBy: d.savedBy || '', switchedAt: d.switchedAt || '', switchedBy: d.switchedBy || '', lastWeek: d.lastWeek || '', lastSend: d.lastSend || null,
  doneOn: !!d.doneOn, doneAskedAt: d.doneAskedAt || '', ask: ASK, doneSwitchedAt: d.doneSwitchedAt || '', doneSwitchedBy: d.doneSwitchedBy || '' });

/* input.op: status | save {accountSid, authToken, fromNumber} | clear | setOn {on} | preview
 *           | doneList | setDoneOn {on} | test {phone} | doneAsk   (Load Done Texts, below; the drivers are ticked on the Driver Roster) */
async function smsCall(db, user, input, options) {
  input = input || {};
  const o = Object.assign({ now: () => new Date(), env: process.env, fetch: (...a) => fetch(...a), project: process.env.GCLOUD_PROJECT || JSON.parse(process.env.FIREBASE_CONFIG || '{}').projectId || '' }, options || {});
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
    const next = { on: false, lastWeek: d.lastWeek || '', doneOn: false, savedAt: stamp, savedBy: email, switchedAt: stamp, switchedBy: email };
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
    const list = (await activeDrivers(db)).filter(x => x.scheduleText);
    return Object.assign(status(d, o.env, o.project), { week, message: messageFor(week || L.weekStart(L.operatingDay(o.now()))), drivers: list.map(x => ({ name: x.name, phone: phoneText(x.phone) })) });
  }
  if (op === 'doneList') {
    const list = await activeDrivers(db);
    return Object.assign(status(d, o.env, o.project), { sample: sampleMessage(),
      drivers: list.filter(x => x.loadText).map(x => ({ driverId: x.driverId, name: x.name, phone: phoneText(x.phone) })) });
  }
  if (op === 'setDoneOn') {
    const on = input.on === true;
    if (on && !(d.accountSid && d.authToken && d.fromNumber)) throw new SmsError('NOT_ALLOWED', 'Save the Twilio account on Schedule Texts first.');
    // Turning it On never texts a load that was already done: only loads finished from now on.
    const next = Object.assign({}, d, { doneOn: on, doneSwitchedAt: stamp, doneSwitchedBy: email });
    await ref.set(next);
    return status(next, o.env, o.project);
  }
  // Joe 10/26 ("I want to do just sample"): a test text to one number typed on the screen, nobody else. Works with every
  // switch Off; the test copy only writes it to the log.
  if (op === 'test') {
    if (!(d.accountSid && d.authToken && d.fromNumber)) throw new SmsError('NOT_ALLOWED', 'Save the Twilio account on Schedule Texts first.');
    const to = phoneE164(input.phone);
    if (!to) throw new SmsError('BAD_REQUEST', 'Type the phone number as 10 digits, like 330-555-1234.');
    const body = TEST_TEXT, log = { direction: 'out', kind: 'TEST', name: 'Test text', driverId: '', to, body, at: stamp, by: email };
    if (!liveTexts(o.env)) Object.assign(log, { status: 'NOT SENT', reason: 'Test copy: not sent (the test copy never texts anyone).' });
    else {
      let r;
      try { r = await sendOne(d, to, body, o.fetch); } catch (e) { r = { ok: false, reason: String(e && e.message || e).slice(0, 200) }; }
      Object.assign(log, r.ok ? { status: 'SENT', reason: '' } : { status: r.stopped ? 'STOPPED' : 'FAILED', reason: r.reason });
    }
    await db.collection('textLog').doc('test_' + stamp.replace(/[^0-9]/g, '')).set(log);
    return Object.assign(status(d, o.env, o.project), { test: { to: phoneText(to), status: log.status, reason: log.reason } });
  }
  // Joe 10/26 ("send the text out to opt in or out. And then it tick marks"): ask each active driver with a mobile phone
  // who is not ticked for both yet; a YES reply ticks Schedule and Load on the Driver Roster, STOP unticks both (replyCheck).
  if (op === 'doneAsk') {
    if (!(d.accountSid && d.authToken && d.fromNumber)) throw new SmsError('NOT_ALLOWED', 'Save the Twilio account on Schedule Texts first.');
    const live = liveTexts(o.env), list = (await activeDrivers(db)).filter(x => x.phone && !(x.loadText && x.scheduleText) && !x.stoppedAt);
    let sent = 0, failed = 0;
    for (const x of list) {
      const log = { direction: 'out', kind: 'ASK', driverId: x.driverId, name: x.name, to: x.phone, body: ASK, at: stamp, by: email };
      if (!live) Object.assign(log, { status: 'NOT SENT', reason: 'Test copy: not sent (the test copy never texts anyone).' });
      else {
        let r;
        try { r = await sendOne(d, x.phone, ASK, o.fetch); } catch (e) { r = { ok: false, reason: String(e && e.message || e).slice(0, 200) }; }
        if (r.ok) sent++; else failed++;
        Object.assign(log, r.ok ? { status: 'SENT', reason: '' } : { status: r.stopped ? 'STOPPED' : 'FAILED', reason: r.reason });
        if (r.stopped) await db.collection('driverPhones').doc(safeIdPart(x.driverId)).set({ driverId: x.driverId, scheduleText: false, loadText: false, stoppedAt: stamp }, { merge: true });
      }
      await db.collection('driverPhones').doc(safeIdPart(x.driverId)).set({ driverId: x.driverId, askedAt: stamp }, { merge: true });
      await db.collection('textLog').doc('doneask_' + stamp.replace(/[^0-9]/g, '') + '_' + safeIdPart(x.driverId)).set(log);
    }
    const next = Object.assign({}, d, { doneAskedAt: stamp, doneRepliesAfter: d.doneRepliesAfter || stamp });
    await ref.set(next);
    return Object.assign(status(next, o.env, o.project), { asked: { drivers: list.length, sent, failed, live } });
  }
  throw new SmsError('BAD_REQUEST', 'Unknown Schedule Texts step ' + op.slice(0, 30));
}

const STOPPED = 21610;
async function sendOne(d, to, body, fetchFn) {
  const res = await fetchFn(TWILIO + encodeURIComponent(d.accountSid) + '/Messages.json', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(d.accountSid + ':' + d.authToken).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: to, From: d.fromNumber, Body: body }).toString()
  });
  if (res.ok) return { ok: true };
  let why = '', code = 0;
  try { const j = await res.json(); why = j && j.message || ''; code = Number(j && j.code) || 0; } catch (e) { why = ''; }
  // 21610: the person texted STOP to the number, so Twilio will not text them until they text START.
  if (code === STOPPED) return { ok: false, stopped: true, reason: 'Replied STOP: Twilio will not text this number until they text START.' };
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
      Object.assign(log, r.ok ? { status: 'SENT', reason: '' } : { status: r.stopped ? 'STOPPED' : 'FAILED', reason: r.reason });
      // A driver who replied STOP is unticked on the Driver Roster (Joe 10/26).
      if (r.stopped) await db.collection('driverPhones').doc(safeIdPart(x.driverId)).set({ driverId: x.driverId, scheduleText: false, loadText: false, stoppedAt: stamp }, { merge: true });
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

/*
 * Load Done Texts (Joe 10/26: "text temporarily a few people when the load is complete ... that their load is done, and if
 * they have any pickups"): the drivers with Load ticked under Texts on the Driver Roster (Joe 10/26: "can't we add a tick for
 * that driver") get one text when the plant finishes their load (the Loadout's Done / End time), with its open pickups. Its own On / Off switch, Off by default;
 * it uses the Twilio account saved on Schedule Texts, and the test copy only writes to the log, as Schedule Texts does.
 */
const nice = (n) => { const x = Number(n); return n === '' || n === null || n === undefined || !isFinite(x) ? '' : x.toLocaleString('en-US'); };
function doneMessage(r) {
  const what = ['Route ' + (r.route || ''), r.run || ''].filter(Boolean).join(' ').trim();
  const bits = [r.trailer ? 'trailer ' + r.trailer : '', nice(r.cases) ? nice(r.cases) + ' cases' : ''].filter(Boolean);
  return 'United Dairy: your load is done. ' + what + (bits.length ? ', ' + bits.join(', ') : '') + '. ' +
    (r.pickupText ? 'Pickups: ' + r.pickupText + '.' : 'No pickups.');
}
const TEST_TEXT = 'United Dairy: this is a test text from Operations. No need to reply.';
const ASK = 'United Dairy work texts: your schedule when it is posted and when your load is done, with any pickups. Reply YES to get them. Reply STOP to stop.';
const sampleMessage = () => doneMessage({ route: '801', run: 'UT DSD MILK', trailer: 'T-901', cases: 1200, pickupText: '2 crates chocolate milk' });
// Loads finished longer ago than this are never texted (a load marked done late, or the switch turned back On days later).
const DONE_WINDOW_MS = 12 * 3600 * 1000;

/* The minute job: each load the plant finished today for a ticked driver gets one text. Returns what it did, or null. */
async function loadDoneCheck(db, options) {
  const o = Object.assign({ now: () => new Date(), env: process.env, fetch: (...a) => fetch(...a) }, options || {});
  const d = (await PRIVATE(db).get()).data() || {};
  if (!d.doneOn || !(d.accountSid && d.authToken && d.fromNumber)) return null;
  const picked = {};
  (await activeDrivers(db)).forEach(x => { if (x.loadText) picked[safeIdPart(x.driverId)] = x; });
  if (!Object.keys(picked).length) return null;
  const now = o.now(), stamp = now.toISOString(), date = L.operatingDay(now), week = L.weekStart(date), live = liveTexts(o.env);
  // The loads the plant loads on this operating day and their open pickups, as the Driver Room board shows them.
  const runs = (await db.collection(C.runs).where('weekStart', 'in', [week, L.addDays(week, 7)]).get()).docs.map(x => Object.assign({}, x.data(), { id: x.id }));
  const pickups = (await db.collection('pickups').where('date', 'in', [date, L.addDays(date, 1), L.addDays(date, 2), L.addDays(date, 3)]).get()).docs.map(x => x.data());
  const byId = {};
  runs.forEach(r => { byId[r.id] = r; });
  const since = Date.parse(d.doneSwitchedAt || '') || 0;
  let sent = 0, failed = 0, logged = 0;
  for (const r of B.loadoutBoardRows(runs, pickups, date)) {
    if (r.state !== 'LOADED') continue;
    const day = ((byId[r.runDocId] || {}).days || {})[r.day] || {}, driverId = safeIdPart(day.driverId || '');
    if (!driverId || !picked[driverId]) continue;
    // Only a load finished after the switch went On and the driver was ticked, and not long ago.
    const ended = Date.parse(day.completeTime || '');
    if (isFinite(ended) && (ended < since || ended < (Date.parse(picked[driverId].loadTextAt) || 0) || now - ended > DONE_WINDOW_MS)) continue;
    const ref = db.collection('textLog').doc('done_' + date + '_' + safeIdPart(r.runDocId) + '_' + r.day);
    const phone = picked[driverId].phone;
    const body = doneMessage({ route: r.streamId || r.route, run: r.streamId ? '' : r.run, trailer: r.trailer, cases: r.cases, pickupText: r.pickupText });
    const log = { direction: 'out', kind: 'LOAD_DONE', date, runDocId: r.runDocId, day: r.day, driverId, name: r.driver || '', to: phone, body, at: stamp };
    // Claim the load first (create fails when it is there), so two minute runs never text the same load twice.
    try { await ref.create(Object.assign({}, log, { status: 'SENDING' })); } catch (e) { continue; }
    if (!phone) Object.assign(log, { status: 'NO PHONE', reason: 'No mobile phone number on the Driver Roster.' });
    else if (!live) Object.assign(log, { status: 'NOT SENT', reason: 'Test copy: not sent (the test copy never texts anyone).' });
    else {
      let res;
      try { res = await sendOne(d, phone, body, o.fetch); } catch (e) { res = { ok: false, reason: String(e && e.message || e).slice(0, 200) }; }
      if (res.ok) sent++; else failed++;
      Object.assign(log, res.ok ? { status: 'SENT', reason: '' } : { status: res.stopped ? 'STOPPED' : 'FAILED', reason: res.reason });
      // Joe 10/26 ("if they reply back opt-out, will it automatically untick"): a driver who replied STOP is unticked and
      // the Driver Roster says so; a text that goes through again clears it.
      if (res.stopped) await db.collection('driverPhones').doc(driverId).set({ scheduleText: false, loadText: false, stoppedAt: stamp }, { merge: true });
      else if (res.ok && picked[driverId].stoppedAt) await db.collection('driverPhones').doc(driverId).set({ stoppedAt: '' }, { merge: true });
    }
    logged++;
    await ref.set(log);
  }
  return logged ? { date, at: stamp, logged, sent, failed, live } : null;
}

/*
 * The minute job: the drivers' YES and STOP replies to the texting number. Replies are sent to the other United Dairy app
 * (UDMS keeps the number's reply address), so this reads them back from Twilio instead, without changing that address.
 * YES ticks Schedule and Load under Texts on the Driver Roster, STOP unticks both. Only after Ask drivers was pressed, and only on the live app.
 */
const YES = /^(yes|y|start|unstop|ok|okay)\b/i, NO = /^(stop|stopall|unsubscribe|cancel|end|quit|no)\b/i;
async function replyCheck(db, options) {
  const o = Object.assign({ now: () => new Date(), env: process.env, fetch: (...a) => fetch(...a) }, options || {});
  const ref = PRIVATE(db), d = (await ref.get()).data() || {};
  if (!d.doneRepliesAfter || !(d.accountSid && d.authToken && d.fromNumber) || !liveTexts(o.env)) return null;
  // Five minutes back from the last look, so a reply that came in during it is not missed (each reply is kept once).
  const after = d.doneRepliesAt ? new Date(Math.max(Date.parse(d.doneRepliesAfter), Date.parse(d.doneRepliesAt) - 300000)).toISOString() : d.doneRepliesAfter, stamp = o.now().toISOString();
  const url = TWILIO + encodeURIComponent(d.accountSid) + '/Messages.json?' + new URLSearchParams({ To: d.fromNumber, 'DateSent>': after.slice(0, 10), PageSize: '200' }).toString();
  const res = await o.fetch(url, { headers: { Authorization: 'Basic ' + Buffer.from(d.accountSid + ':' + d.authToken).toString('base64') } });
  if (!res.ok) throw new Error('Twilio refused the reply list (' + res.status + ')');
  const list = ((await res.json()) || {}).messages || [];
  const byPhone = {};
  (await activeDrivers(db)).forEach(x => { if (x.phone) byPhone[x.phone] = x; });
  let yes = 0, stop = 0;
  // Oldest first, so a driver's last word wins.
  const replies = list.filter(m => m && m.direction === 'inbound' && byPhone[phoneE164(m.from)] && Date.parse(m.date_created || m.date_sent || '') > Date.parse(after))
    .sort((a, b) => Date.parse(a.date_created || a.date_sent) - Date.parse(b.date_created || b.date_sent));
  for (const m of replies) {
    const x = byPhone[phoneE164(m.from)], body = String(m.body || '').trim(), sid = String(m.sid || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 64);
    const word = YES.test(body) ? 'YES' : NO.test(body) ? 'STOP' : '';
    if (!sid || !word) continue;
    try { await db.collection('textLog').doc('doneReply_' + sid).create({ direction: 'in', kind: 'SIGN_UP', from: phoneE164(m.from), driverId: x.driverId, name: x.name, body: body.slice(0, 1600), at: new Date(Date.parse(m.date_created || m.date_sent)).toISOString(), status: 'RECEIVED' }); }
    catch (e) { continue; }
    const at = new Date(Date.parse(m.date_created || m.date_sent)).toISOString();
    await db.collection('driverPhones').doc(safeIdPart(x.driverId)).set(word === 'YES' ? { driverId: x.driverId, scheduleText: true, loadText: true, loadTextAt: at, stoppedAt: '' } : { driverId: x.driverId, scheduleText: false, loadText: false, stoppedAt: at }, { merge: true });
    if (word === 'YES') yes++; else stop++;
  }
  await ref.set({ doneRepliesAt: stamp }, { merge: true });
  return { yes, stop };
}

module.exports = { TEST_TEXT, smsCall, postedCheck, loadDoneCheck, replyCheck, ASK, doneMessage, handleReply, twilioSignature, replyAddress, weekDrivers, phoneE164, phoneText, messageFor, SmsError, liveTexts };

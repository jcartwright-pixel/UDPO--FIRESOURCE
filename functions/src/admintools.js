/*
 * Administration, part 2 (Joe 10/10): the email, schedule and diagnostics items of the current app's Administration,
 * rebuilt for the new app. Called through admin.js (`admin` {op}), Administrators only.
 *
 *   Repair Email            repairEmail, saveRepairEmail, repairEmailSendNow    private/repairEmail (+ the sweep, every 5 minutes)
 *   Driver Check-In Email   checkinEmail, saveCheckinEmail, checkinEmailNow      private/checkinEmail (+ the mailbox check)
 *   Refresh Rates           refreshRates, saveRefreshRate, archiveNow            private/refreshRates
 *   Window Test Center      windowTests, windowTestLog                           windowTests
 *   Run Runtime Pre-Flight  preflight                                            (read only)
 *   Update Live Sheets      updateLive {apply}                                   the current and next Live weeks (sandbox copy)
 *   Refresh Home Summary    refreshHome                                          a copy from the sheets right now
 *   Start Plant Fresh       plantFresh, plantFreshSet                            config/app.plantStart
 *   Date Inventory          dateInventory                                        (read only)
 *   Date Dry Run / Convert  dateSheets, dateDryRun, dateConvert                  sandbox sheet copies only; private/dateColumns
 *
 * Nothing here can write a production sheet (assertSandboxTarget refuses every production ID) or send email to anyone but
 * the person who pressed the button until LIVE_EMAIL=1 is set at go-live (adminmail.js).
 */
'use strict';

const crypto = require('crypto');
const L = require('./logic');
const M = require('./model');
const MAINT = require('./maintenance');
const A = require('./admin');
const { appMail, emailSettings } = require('./adminmail');
const { addresses } = require('./mail');
const { queueMaster } = require('./masterwrite');
const { assertSandboxTarget, columnLetter } = require('./writeback');

const C = M.COLLECTIONS;
const fail = (code, message) => A.fail(code, message);
const text = (v, max) => A.text(v, max);
const priv = (db, id) => db.collection('private').doc(id);
const read = async (ref) => { const s = await ref.get(); return s.exists ? s.data() : null; };
const rid = (p) => p + '-' + crypto.randomBytes(8).toString('hex');
const nyParts = (d) => {
  const parts = {};
  new Intl.DateTimeFormat('en-US', { timeZone: L.TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'long', hourCycle: 'h23' })
    .formatToParts(d).forEach(p => { parts[p.type] = p.value; });
  return { date: parts.year + '-' + parts.month + '-' + parts.day, hour: Number(parts.hour), minute: Number(parts.minute), weekday: String(parts.weekday).toUpperCase(), mdy: Number(parts.month) + '/' + Number(parts.day) + '/' + parts.year };
};
const writeBackOn = async (db) => { const c = (await read(db.collection(C.config).doc('app'))) || {}; return !!(c.writeBack && c.writeBack.enabled === true); };
const DONE = ['COMPLETE', 'COMPLETED', 'CLOSED', 'RESOLVED', 'REPAIRED', 'REMOVED', 'CLEANED'];

/* ---------- Repair Email ---------- */

const ROUTES = ['IDEALEASE', 'PENSKE', 'OWNED'];
const ROUTE_LABEL = { IDEALEASE: 'Idealease', PENSKE: 'Penske', OWNED: 'Owned (our garage)' };
const MODES = ['SEND', 'IMMEDIATE', 'DAILY', 'NONE'];
const AUTO = (m) => m === 'IMMEDIATE' || m === 'DAILY';
const REPAIR_DEFAULTS = { IDEALEASE: 'SEND', PENSKE: 'SEND', OWNED: 'NONE' };
const IMMEDIATE_MAX = 20, DIGEST_MAX = 50;

async function repairSettings(db) {
  const d = (await read(priv(db, 'repairEmail'))) || {};
  const routes = {};
  ROUTES.forEach(k => { const r = (d.routes || {})[k] || {}; routes[k] = { emails: r.emails || [], mode: MODES.indexOf(r.mode) >= 0 ? r.mode : REPAIR_DEFAULTS[k], since: r.since || '' }; });
  return { routes, digestHour: Number.isInteger(d.digestHour) ? d.digestHour : 7, updatedAt: d.updatedAt || '', updatedBy: d.updatedBy || '' };
}

// Which company a unit's repair goes to: the Fleet List's Lease (kept in Equipment Master notes as "Lease: ..."), as 213_V7255.
function lessorOf(equipment, kind, unitText) {
  if (kind === 'FORK_TRUCK') return { route: 'OWNED', unit: unitText };
  const type = kind === 'TRAILER' ? 'TRAILER' : 'TRUCK', word = type === 'TRAILER' ? 'Trailer' : 'Truck';
  const units = (equipment || []).filter(e => (L.fleetKind(e.type) || String(e.type || '').toUpperCase()) === type);
  const u = L.unitLessor(units, unitText);
  if (!u.unit) return { held: /matches/.test(u.why) ? 'UNIT_AMBIGUOUS' : 'UNIT_NOT_IN_FLEET_LIST', why: String(u.why).replace(/^Truck/, word), unit: unitText };
  const lease = String(u.lessor || '').trim().toUpperCase();
  if (!lease || lease === 'OWN' || lease === 'OWNED') return { route: 'OWNED', unit: u.unit };
  if (lease.indexOf('IDEALEASE') >= 0) return { route: 'IDEALEASE', unit: u.unit };
  if (lease.indexOf('PENSKE') >= 0) return { route: 'PENSKE', unit: u.unit };
  return { held: 'LESSOR_NOT_SET_UP', why: word + ' ' + u.unit + ': the Fleet List Lease says "' + u.lessor + '", which has no repair email set up', unit: u.unit };
}

const unitOf = (r) => String(r.truck_number || r.trailer_number || r.unit_number || '').trim();
const kindWord = (k) => (k === 'TRAILER' ? 'Trailer' : k === 'FORK_TRUCK' ? 'Fork Truck / Pallet Jack' : 'Truck');
function repairLines(r) {
  return [kindWord(String(r.kind).toUpperCase()) + ' ' + unitOf(r), 'Issue: ' + String(r.issue_details || '').trim(), 'Reported: ' + String(r.opened_at || r.service_date || ''), 'Driver: ' + String(r.driver || '')];
}
function repairMessage(r, note) {
  const body = ['United Dairy Plant Operations', ''].concat(repairLines(r), ['', 'Please review this repair request.']).join('\n') + (note ? '\n\nManager note:\n' + note : '');
  return { subject: 'United Dairy ' + (String(r.kind).toUpperCase() === 'TRAILER' ? 'Trailer' : 'Truck') + ' Repair Request - ' + unitOf(r), text: body };
}

// Adds one line to a write-up's notes (and its row in the sandbox sheet copy, with the write-back on).
async function addNote(db, recordId, line, email, stamp) {
  const on = await writeBackOn(db);
  return db.runTransaction(async tx => {
    const ref = db.collection(C.maintenance).doc(MAINT.docId(recordId)), snap = await tx.get(ref);
    if (!snap.exists) return false;
    const r = snap.data(), notes = String(r.notes || '').trim(), change = { notes: (notes ? notes + '\n' : '') + line, updated_at: stamp, updated_by: email };
    tx.update(ref, Object.assign({}, change, { testEdited: true, editedAt: stamp, editedBy: email }));
    const list = MAINT.LISTS[String(r.kind || '').toUpperCase()];
    if (list) queueMaster(tx, db, { writeBack: on }, rid('note'), '', ref, r.record_id, r.createdInApp ? Object.assign({}, r, change) : change, !!r.createdInApp, stamp, email, list);
    return true;
  });
}

async function logHeld(db, at, by, r, route, code, why) {
  await db.collection('sentEmails').add({ at, kind: 'Repair email', label: kindWord(String(r.kind).toUpperCase()) + ' ' + unitOf(r), detail: (route ? ROUTE_LABEL[route] : 'No lessor') + ' · ' + by,
    by, meantFor: [], subject: '', sentTo: [], status: 'HELD', reason: (code + ': ' + why).slice(0, 120), testCopy: true });
}

/*
 * The automatic sweep (and Send now = force): open truck and trailer write-ups reported after a lessor was switched to
 * Immediately or Once a day go to that lessor; a unit the Fleet List cannot place is held with a note, never guessed.
 */
async function repairSweep(db, opts) {
  const o = opts || {}, now = o.now ? o.now() : new Date(), at = now.toISOString();
  const s = await repairSettings(db);
  const autos = ROUTES.filter(k => AUTO(s.routes[k].mode));
  if (!autos.length) return { status: 'NO_AUTOMATIC_ROUTES', message: 'No lessor is set to Immediately or Once a day.' };
  if (!(await emailSettings(db)).sending) return { status: 'EMAIL_OFF', message: 'Outbound email is turned off, so nothing was sent.' };
  const lockRef = priv(db, 'repairSweepLock');
  const got = await db.runTransaction(async tx => {
    const l = (await tx.get(lockRef)).data();
    if (l && l.until > at) return false;
    tx.set(lockRef, { until: new Date(now.getTime() + 4 * 60000).toISOString(), by: o.by || 'SCHEDULE' });
    return true;
  });
  if (!got) return { status: 'BUSY', message: 'Another email run is in progress. Try again in a minute.' };
  try {
    const by = o.by || 'SCHEDULE', testTo = o.by ? '' : s.updatedBy;
    const stateRef = priv(db, 'repairSweepState'), state = Object.assign({ lastDigest: {}, retryAfter: {} }, await read(stateRef));
    const [maint, equip] = await Promise.all([db.collection(C.maintenance).where('kind', 'in', ['TRUCK', 'TRAILER']).get(), db.collection(C.equipment).get()]);
    const equipment = equip.docs.map(d => d.data());
    const earliest = autos.map(k => s.routes[k].since).filter(Boolean).sort()[0] || at;
    const open = maint.docs.map(d => d.data()).filter(r => {
      const st = String(r.status || 'OPEN').toUpperCase(), notes = String(r.notes || '');
      return DONE.indexOf(st) < 0 && st !== 'NEEDS_REVIEW' && !L.noWriteUp(r.issue_details) && !/Repair email sent|Repair email held|Sent to garage/.test(notes) && String(r.opened_at || '') >= earliest;
    }).sort((a, b) => String(a.opened_at).localeCompare(String(b.opened_at)));
    const out = { sent: 0, digests: 0, held: 0, failed: 0 }, digest = {};
    let immediate = 0, stop = '';
    for (const r of open) {
      const dest = lessorOf(equipment, String(r.kind).toUpperCase(), unitOf(r));
      if (dest.held) {
        await addNote(db, r.record_id, 'Repair email held ' + at + ': ' + dest.held, by, at);
        await logHeld(db, at, by, r, '', dest.held, dest.why);
        out.held++;
        continue;
      }
      const route = s.routes[dest.route];
      if (!AUTO(route.mode) || String(r.opened_at || '') < route.since || !route.emails.length) continue;
      if (!o.force && state.retryAfter[dest.route] && state.retryAfter[dest.route] > at) continue;
      if (route.mode === 'DAILY') { (digest[dest.route] = digest[dest.route] || []).push(r); continue; }
      if (immediate >= IMMEDIATE_MAX || stop) continue;
      immediate++;
      const msg = repairMessage(r);
      const res = await appMail(db, { kind: 'Repair email', label: kindWord(String(r.kind).toUpperCase()) + ' ' + unitOf(r), detail: ROUTE_LABEL[dest.route] + ' · immediate · ' + by, by: o.by, testTo, to: route.emails, subject: msg.subject, text: msg.text, fromName: 'United Dairy Plant Operations' }, o.mailDeps);
      if (res.status === 'SENT') { out.sent++; await addNote(db, r.record_id, 'Repair email sent ' + at + ' to ' + route.emails.join('; ') + ' (automatic)' + (res.testCopy ? '; test copy to ' + res.sentTo.join('; ') : ''), by, at); }
      else if (res.status === 'FAILED') { out.failed++; state.retryAfter[dest.route] = new Date(now.getTime() + 3600000).toISOString(); }
      else stop = res.reason;
    }
    const ny = nyParts(now);
    for (const key of Object.keys(digest)) {
      if (stop) break;
      if (!o.force && (ny.hour < s.digestHour || state.lastDigest[key] === ny.date)) continue;
      const items = digest[key].slice(0, DIGEST_MAX), route = s.routes[key];
      const body = ['United Dairy Plant Operations', '', 'Repair requests for ' + ROUTE_LABEL[key] + ':', ''].concat(items.map((r, i) => (i + 1) + '. ' + kindWord(String(r.kind).toUpperCase()) + ' ' + unitOf(r) + ' \u2014 ' + String(r.issue_details || '').trim() + ' (reported ' + (r.opened_at || r.service_date || '') + ', driver ' + (r.driver || '') + ')'), ['', 'Please review these repair requests.']).join('\n');
      const res = await appMail(db, { kind: 'Repair email', label: 'Daily digest', detail: ROUTE_LABEL[key] + ' · daily · ' + by, by: o.by, testTo, to: route.emails, subject: 'United Dairy repair requests - ' + ROUTE_LABEL[key] + ' (' + items.length + ') - ' + ny.mdy, text: body, fromName: 'United Dairy Plant Operations' }, o.mailDeps);
      if (res.status === 'SENT') {
        out.digests++; out.sent += items.length; state.lastDigest[key] = ny.date;
        for (const r of items) await addNote(db, r.record_id, 'Repair email sent ' + at + ' to ' + route.emails.join('; ') + ' (daily digest)' + (res.testCopy ? '; test copy to ' + res.sentTo.join('; ') : ''), by, at);
      } else if (res.status === 'FAILED') { out.failed++; state.retryAfter[key] = new Date(now.getTime() + 3600000).toISOString(); }
      else stop = res.reason;
    }
    await stateRef.set(state);
    const message = stop && !out.sent ? 'Nothing was sent: ' + stop : 'Sent ' + out.sent + ' repair' + (out.sent === 1 ? '' : 's') + (out.digests ? ' in ' + out.digests + ' digest' + (out.digests === 1 ? '' : 's') : '') + (out.held ? '; held ' + out.held : '') + (out.failed ? '; ' + out.failed + ' failed' : '') + '.';
    return Object.assign({ status: 'DONE', message }, out);
  } finally {
    await lockRef.delete();
  }
}

async function repairEmail(db, deps) {
  const [s, sending, state, rates, maint, equip] = await Promise.all([repairSettings(db), emailSettings(db), read(priv(db, 'repairSweepState')), rateSettings(db),
    db.collection(C.maintenance).where('kind', 'in', ['TRUCK', 'TRAILER']).get(), db.collection(C.equipment).get()]);
  // Where each open write-up would go today, so the page shows what Send now would do.
  const equipment = equip.docs.map(d => d.data()), where = { IDEALEASE: 0, PENSKE: 0, OWNED: 0, HELD: 0 };
  maint.docs.map(d => d.data()).filter(r => DONE.indexOf(String(r.status || 'OPEN').toUpperCase()) < 0 && !L.noWriteUp(r.issue_details)).forEach(r => {
    const d = lessorOf(equipment, String(r.kind).toUpperCase(), unitOf(r)); where[d.held ? 'HELD' : d.route]++;
  });
  return { settings: s, labels: ROUTE_LABEL, modes: MODES, sending, lastDigest: (state && state.lastDigest) || {}, every: rates.jobs.repairEmail.minutes, openByLessor: where };
}

async function saveRepairEmail(db, email, input, stamp) {
  const before = await repairSettings(db), routes = {};
  ROUTES.forEach(k => {
    const r = (input.routes || {})[k] || {};
    const raw = Array.isArray(r.emails) ? r.emails.join(';') : String(r.emails || '');
    const parts = raw.split(/[\s,;]+/).map(x => x.trim().toLowerCase()).filter(Boolean), emails = [];
    parts.forEach(p => { if (p.length > 120 || !addresses([p]).length) fail('BAD_REQUEST', ROUTE_LABEL[k] + ': "' + p + '" is not an email address.'); if (emails.indexOf(p) < 0) emails.push(p); });
    if (emails.length > 5) fail('BAD_REQUEST', ROUTE_LABEL[k] + ' can have at most 5 addresses.');
    const mode = String(r.mode || before.routes[k].mode).toUpperCase();
    if (MODES.indexOf(mode) < 0) fail('BAD_REQUEST', 'Pick how often for ' + ROUTE_LABEL[k] + '.');
    if (AUTO(mode) && !emails.length) fail('BAD_REQUEST', ROUTE_LABEL[k] + ' needs an email address before it can be emailed automatically.');
    // "Immediately" and "Once a day" only send repairs reported after they are switched on, so old repairs are never swept up.
    routes[k] = { emails, mode, since: AUTO(mode) ? (AUTO(before.routes[k].mode) && before.routes[k].since ? before.routes[k].since : stamp) : '' };
  });
  const hour = input.digestHour === undefined ? before.digestHour : Number(input.digestHour);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) fail('BAD_REQUEST', 'Pick the digest hour.');
  await priv(db, 'repairEmail').set({ routes, digestHour: hour, updatedAt: stamp, updatedBy: email, configured: true });
  return Object.assign({ ok: true, message: 'Saved.' }, await repairEmail(db));
}

// A manager's Lessor button on a truck write-up (mode "Only when I press Send"): after the save, the email itself.
async function sendOneRepair(db, recordId, by, note, mailDeps) {
  const r = await read(db.collection(C.maintenance).doc(MAINT.docId(recordId)));
  if (!r) return { status: 'NOT_FOUND', message: 'That write-up is no longer on the list.' };
  const s = await repairSettings(db), equipment = (await db.collection(C.equipment).get()).docs.map(d => d.data());
  const dest = lessorOf(equipment, String(r.kind).toUpperCase(), unitOf(r)), at = new Date().toISOString();
  if (dest.held) { await logHeld(db, at, by, r, '', dest.held, dest.why); return { status: 'HELD', message: dest.why + '. It was not emailed.' }; }
  const route = s.routes[dest.route];
  if (dest.route === 'OWNED' && !route.emails.length) return { status: 'GARAGE', message: unitOf(r) + ' is ours, so this repair stays on the garage list. No email is sent.' };
  if (route.mode === 'NONE') return { status: 'OFF', message: 'Email is turned off for ' + ROUTE_LABEL[dest.route] + ' in Administration > Repair Email.' };
  if (!route.emails.length) return { status: 'NO_ADDRESS', message: ROUTE_LABEL[dest.route] + ' has no email address yet (Administration > Repair Email).' };
  const msg = repairMessage(r, note);
  const res = await appMail(db, { kind: 'Repair email', label: kindWord(String(r.kind).toUpperCase()) + ' ' + unitOf(r), detail: ROUTE_LABEL[dest.route] + ' · send · ' + by, by, to: route.emails, subject: msg.subject, text: msg.text, fromName: 'United Dairy Plant Operations' }, mailDeps);
  if (res.status === 'SENT') {
    await addNote(db, r.record_id, 'Repair email sent ' + at + ' to ' + route.emails.join('; ') + (res.testCopy ? '; test copy to ' + res.sentTo.join('; ') : ''), by, at);
    return { status: 'SENT', message: 'Emailed to ' + ROUTE_LABEL[dest.route] + (res.testCopy ? ' (test copy to ' + res.sentTo.join(', ') + ' only)' : '') + '.' };
  }
  return { status: res.status, message: 'Not emailed: ' + res.reason };
}

// index.js calls this after a save returns: the Lessor step's email goes out after the save, never inside it.
async function afterSave(db, user, input, result, mailDeps) {
  if (!result || !result.ok || result.repeated || !input || input.action !== 'updateIssue' || input.step !== 'lessor' || /Already/.test(result.message || '')) return result;
  const mail = await sendOneRepair(db, String(input.recordId || ''), String(user.email || '').toLowerCase(), '', mailDeps);
  return Object.assign({}, result, { message: mail.message, email: mail.status });
}

/* ---------- Driver Check-In Email ---------- */

const CHECKIN_STANDARD = { sender: 'callcenter@lauttamus.com', recipient: 'utdrivercheckin@uniteddairy.com', subject: 'UNIONTOWN DRIVER CHECK IN' };
const LOOKBACK_DAYS = 7, MAX_MESSAGES = 500;

async function checkinSettings(db) {
  const d = (await read(priv(db, 'checkinEmail'))) || {};
  return { enabled: d.enabled === true, sender: d.sender || CHECKIN_STANDARD.sender, recipient: d.recipient || CHECKIN_STANDARD.recipient, subject: d.subject || CHECKIN_STANDARD.subject,
    owner: d.owner || '', lastSuccessAt: d.lastSuccessAt || '', updatedAt: d.updatedAt || '', updatedBy: d.updatedBy || '' };
}

// One answering-service email to the check-in fields (054_InboundMaintenanceEmail.gs). Returns null for a digest or no driver / route.
function parseCheckinEmail(body) {
  const fields = {}, order = [];
  let last = null, names = 0;
  String(body || '').replace(/\r/g, '').split('\n').forEach(raw => {
    const m = /^\s*([A-Za-z][A-Za-z0-9 ()/#'?.&-]{0,70}?)\s*:\s*(.*)$/.exec(raw);
    if (m) {
      const k = m[1].toLowerCase().replace(/[^a-z0-9]/g, '');
      if (k === 'name' || k === 'nameut') names++;
      if (!(k in fields)) { fields[k] = m[2].trim(); order.push(k); }
      last = k;
    } else if (last && raw.trim()) fields[last] = (fields[last] + ' ' + raw.trim()).trim();
  });
  if (names > 1) return { digest: true };
  const pick = (keys) => { for (const k of keys) if (fields[k]) return fields[k]; const p = order.find(k => keys.some(x => k.indexOf(x) === 0) && fields[k]); return p ? fields[p] : ''; };
  const driver = pick(['nameut', 'name']), route = pick(['routenumber', 'route']).replace(/^route\s*#?\s*/i, '').trim();
  if (!driver || !route) return null;
  const num = (v) => { const m = /-?\d+/.exec(String(v || '').replace(/,/g, '')); return m ? Math.abs(Number(m[0])) : null; };
  const real = (v) => !L.noWriteUp(v) && !/^\s*(y|yes|n|no)\s*$/i.test(String(v || ''));
  const issues = { TRUCK: [], TRAILER: [], FORK_TRUCK: [] };
  let flagged = false;
  const palletIssues = pick(['palletjackissues', 'forktruckissues', 'forkliftissues']);
  if (real(palletIssues)) issues.FORK_TRUCK.push(palletIssues);
  ['writeupdefects', 'concernsissues', 'pretrip', 'posttrip'].forEach(k => {
    const v = pick([k]);
    if (!real(v)) return;
    const t = v.toLowerCase();
    if (/trailer|trlr|lift ?gate|load ?bars?/.test(t)) issues.TRAILER.push(v);
    else if (/forklift|fork lift|pallet ?jack/.test(t)) issues.FORK_TRUCK.push(v);
    else { if (!/truck|tractor|tract/.test(t)) flagged = true; issues.TRUCK.push(v); }
  });
  const wash = pick(['needcleaned', 'needscleaned', 'trailerneedscleaned', 'trailercondition']);
  const refused = pick(['refusedreturned', 'refused']);
  return {
    driver, route, truck: pick(['tractornumber', 'tractor', 'trucknumber', 'truck']), trailer: pick(['trailornumber', 'trailor', 'trailernumber', 'trailer']),
    palletJack: pick(['palletjackunit', 'palletjacknumber', 'palletjack', 'forkliftnumber']),
    casesDelivered: num(pick(['casesdelivered', 'howmanycases'])), driverCaseReturn: num(pick(['casesreturned', 'howmanyreturned'])),
    tractorIssues: issues.TRUCK.join('; '), trailerIssues: issues.TRAILER.join('; '), palletJackIssues: issues.FORK_TRUCK.join('; '),
    trailerNeedsCleaned: /^\s*(y|yes)\b/i.test(wash) || real(wash) && !/^\s*no?\b/i.test(wash),
    refusedReturned: real(refused) ? refused : '', refusedReturnedSource: pick(['refusedreturnedsource', 'whatstores']), flagged
  };
}

// The run a check-in is for: that route, on the message's operating day (or the day before), the driver's own run first.
async function findRun(db, route, driver, date) {
  const want = String(route).trim().replace(/^0+(?=\d)/, '').toUpperCase(), name = String(driver).trim().toUpperCase();
  for (const d of [date, L.addDays(date, -1)]) {
    const p = L.dayPrefix(d), snap = await db.collection(C.runs).where('weekStart', '==', L.weekStart(d)).get();
    const hits = snap.docs.filter(s => { const r = s.data(), day = r.days && r.days[p]; return day && day.runs && [r.route, r.streamId].some(x => String(x || '').trim().replace(/^0+(?=\d)/, '').toUpperCase() === want); });
    if (!hits.length) continue;
    const mine = hits.find(s => { const n = String(s.data().days[p].driver || '').toUpperCase(); return n && name && name.split(/[\s,]+/).filter(Boolean).every(w => n.indexOf(w) >= 0); }) || hits[0];
    return { snap: mine, day: p, date: d };
  }
  return null;
}

async function saveMailCheckin(db, msg, c, sender, stamp) {
  const date = L.operatingDay(new Date(Number(msg.internalDate) || Date.parse(stamp)));
  const hit = await findRun(db, c.route, c.driver, date);
  const by = 'EMAIL · ' + c.driver;
  return db.runTransaction(async tx => {
    const seenRef = db.collection('mailSeen').doc(M.safeIdPart(msg.id));
    if ((await tx.get(seenRef)).exists) return { duplicate: true, made: [], review: 0 };
    const mode = await (require('./actions').requireTestMode)(tx, db, 'checkIns');
    const runSnap = hit ? await tx.get(hit.snap.ref) : null;
    const run = runSnap && runSnap.exists ? runSnap.data() : { route: c.route, routeId: '', runId: '' }, d = runSnap && runSnap.exists ? run.days[hit.day] : {};
    const equipment = (await tx.get(db.collection(C.equipment))).docs.map(s => s.data());
    const fields = { truck: c.truck, trailer: c.trailer, palletJack: c.palletJack, tractorIssues: c.tractorIssues, trailerIssues: c.trailerIssues, palletJackIssues: c.palletJackIssues,
      trailerNeedsCleaned: c.trailerNeedsCleaned ? 'TRUE' : '', refusedReturned: c.refusedReturned, refusedReturnedSource: c.refusedReturnedSource };
    const records = MAINT.recordsFor(run, hit ? hit.snap.id : 'mail', hit ? hit.day : L.dayPrefix(date), hit ? hit.date : date, fields, { by: sender, driver: c.driver }, equipment, stamp).map(r => {
      const key = r.record_id.split('|').pop(), review = r.status === 'NEEDS_REVIEW' || !hit || (c.flagged && r.kind === 'TRUCK');
      return Object.assign(r, { record_id: 'MAIL|' + msg.id + '|' + key, source_type: 'GMAIL', source_id: msg.id, status: review ? 'NEEDS_REVIEW' : r.status,
        notes: 'Reported route: ' + c.route + '; driver: ' + c.driver + '; source: ' + msg.id + (review ? '; REVIEW: confirm equipment/classification or missing detail.' : '') },
        r.kind === 'WASH' ? { wash_status: review ? 'NEEDS_REVIEW' : 'REQUESTED' } : {});
    });
    const refs = records.map(r => db.collection(C.maintenance).doc(MAINT.docId(r.record_id)));
    const snaps = refs.length ? await tx.getAll(...refs) : [];
    const made = [];
    let review = 0;
    records.forEach((r, i) => {
      if (snaps[i].exists) return;
      tx.set(refs[i], Object.assign({ createdInApp: true }, r));
      if (mode.writeBack) queueMaster(tx, db, mode, rid('mail'), 'm' + r.kind, refs[i], r.record_id, r, true, stamp, by, MAINT.LISTS[r.kind]);
      made.push(r.record_id);
      if (r.status === 'NEEDS_REVIEW') review++;
    });
    // Cases delivered and returned onto the run (only where nothing is there yet: a check-in made in the app wins).
    if (runSnap && runSnap.exists) {
      const after = {};
      if (c.casesDelivered !== null && (d.casesDelivered === null || d.casesDelivered === undefined)) after.casesDelivered = c.casesDelivered;
      if (c.driverCaseReturn !== null && (d.driverCaseReturn === null || d.driverCaseReturn === undefined)) after.driverCaseReturn = c.driverCaseReturn;
      ['tractorIssues', 'trailerIssues', 'palletJackIssues', 'refusedReturned', 'refusedReturnedSource'].forEach(k => { if (fields[k] && !d[k]) after[k] = fields[k]; });
      if (!d.checkinCompletedAt) after.checkinCompletedAt = stamp;
      if (Object.keys(after).length) {
        const update = { rev: run.rev + 1, testEdited: true, editedAt: stamp };
        Object.keys(after).forEach(k => { update['days.' + hit.day + '.' + k] = after[k]; });
        update['days.' + hit.day + '.updatedAt'] = stamp; update['days.' + hit.day + '.updatedBy'] = by;
        tx.update(runSnap.ref, update);
        if (mode.writeBack) require('./actions').queueSheetCells(tx, db, rid('mailrun'), '', run, hit.snap.id, hit.day, after, stamp, by);
      }
    }
    tx.set(seenRef, { at: stamp, route: c.route, driver: c.driver, run: hit ? hit.snap.id + '|' + hit.day : '', made });
    return { made, review, run: !!hit };
  });
}

/*
 * Reads the check-in mailbox (read only) and adds what each check-in reports. deps.readMail({owner, query, max}) ->
 * [{id, internalDate, from, to, subject, body}] (mail.js readMail; a fake in the tests).
 */
async function checkinRun(db, opts) {
  const o = opts || {}, now = o.now ? o.now() : new Date(), stamp = now.toISOString();
  const s = await checkinSettings(db);
  if (!s.enabled) return { status: 'OFF', message: 'The check is off, so nothing was read.' };
  const status = { at: stamp, status: 'SUCCESS', read: 0, added: 0, review: 0, seen: 0, skipped: 0, error: '', by: o.by || 'SCHEDULE' };
  try {
    const from = Math.max(now.getTime() - LOOKBACK_DAYS * 86400000, s.lastSuccessAt ? Date.parse(s.lastSuccessAt) - 86400000 : 0);
    const query = 'from:' + s.sender + ' to:' + s.recipient + ' subject:"' + s.subject + '" after:' + Math.floor(from / 1000) + ' -in:spam -in:trash';
    const readMail = o.readMail || require('./mail').readMail;
    const msgs = (await readMail({ owner: s.owner, query, max: MAX_MESSAGES })).sort((a, b) => Number(a.internalDate) - Number(b.internalDate));
    const has = (h, a) => String(h || '').toLowerCase().indexOf(a) >= 0;
    for (const m of msgs) {
      if (!has(m.from, s.sender) || !has(m.to, s.recipient) || String(m.subject || '').trim().toUpperCase() !== s.subject.toUpperCase()) { status.skipped++; continue; }
      const c = parseCheckinEmail(m.body);
      if (!c || c.digest) { status.skipped++; continue; }
      status.read++;
      const r = await saveMailCheckin(db, m, c, String(m.from || s.sender).slice(0, 120), stamp);
      if (r.duplicate) { status.seen++; continue; }
      status.added += r.made.length; status.review += r.review;
    }
    if (status.review) status.status = 'NEEDS_REVIEW';
    await priv(db, 'checkinEmail').set({ lastSuccessAt: stamp }, { merge: true });
  } catch (e) {
    status.status = 'FAIL';
    status.error = e.code === 'NOT_DELEGATED'
      ? 'Google Workspace has not yet let the app read this mailbox. IT adds the scope https://www.googleapis.com/auth/gmail.readonly to the app\'s domain-wide delegation (same Client ID as email sending).'
      : String(e.message || e).slice(0, 300);
  }
  await priv(db, 'checkinEmailStatus').set(status);
  const message = status.status === 'FAIL' ? 'The check did not finish: ' + status.error : 'Checked: ' + status.read + ' check-in' + (status.read === 1 ? '' : 's') + ' read, ' + status.added + ' record' + (status.added === 1 ? '' : 's') + ' added, ' + status.review + ' need review' + (status.seen ? ', ' + status.seen + ' already seen' : '') + '.';
  return { status: status.status, message, run: status };
}

async function checkinEmail(db) {
  const [s, last, rates] = await Promise.all([checkinSettings(db), read(priv(db, 'checkinEmailStatus')), rateSettings(db)]);
  return { settings: s, standard: CHECKIN_STANDARD, last: last || null, every: rates.jobs.checkinMail.minutes };
}

async function saveCheckinEmail(db, email, input, stamp) {
  const before = await checkinSettings(db);
  const sender = text(input.sender, 120).toLowerCase(), recipient = text(input.recipient, 120).toLowerCase();
  if (!addresses([sender]).length || !addresses([recipient]).length) fail('BAD_REQUEST', 'Enter the sender and our mailbox as email addresses.');
  const subject = text(input.subject, 120).replace(/[\r\n"]+/g, ' ').trim();
  if (!subject) fail('BAD_REQUEST', 'Enter the subject line it looks for.');
  if (typeof input.enabled !== 'boolean') fail('BAD_REQUEST', 'Say whether to check the mailbox.');
  const changed = sender !== before.sender || recipient !== before.recipient || subject !== before.subject;
  // The mailbox is read as the administrator who turned the check on (a United Dairy account), as the current app did.
  const owner = input.enabled ? before.owner || email : before.owner;
  await priv(db, 'checkinEmail').set({ enabled: input.enabled, sender, recipient, subject, owner, updatedAt: stamp, updatedBy: email, lastSuccessAt: changed ? '' : before.lastSuccessAt });
  return Object.assign({ ok: true, message: 'Saved.' + (input.enabled ? ' The mailbox is checked every ' + (await rateSettings(db)).jobs.checkinMail.minutes + ' minutes.' : ' The mailbox is not being checked.') }, await checkinEmail(db));
}

/* ---------- Refresh Rates ---------- */

const MINUTES = [1, 5, 10, 15, 30, 60, 120, 240, 360, 480, 720, 1440];
const WEEKDAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
// The new app's background jobs. base = how often its schedule wakes (a rate can only be that or slower).
const JOBS = [
  { key: 'transfer', label: 'Copy from the sheets', what: 'Copies the Live weeks, master lists, plant and maintenance tabs into the app. Replaces the current app\'s Live events, Combined data, Current Live data and Live setup worker.', kind: 'interval', base: 1, def: 1 },
  { key: 'writeBack', label: 'Write-back to the sheets', what: 'Writes each save into the sandbox sheet copies straight after the save, and retries every minute.', kind: 'fixed', every: 'With each save, and every minute' },
  { key: 'mocreo', label: 'Temperature sensors', what: 'Reads the MOCREO cooler sensors.', kind: 'interval', base: 5, def: 5, warnOver: 30 },
  { key: 'repairEmail', label: 'Repair emails to lessors', what: 'Sends new repairs to Idealease / Penske when they are set to Immediately or Once a day (Repair Email).', kind: 'interval', base: 5, def: 5 },
  { key: 'checkinMail', label: 'Maintenance email intake', what: 'Reads the answering service\'s driver check-in emails (Driver Check-In Email).', kind: 'interval', base: 5, def: 15 },
  { key: 'archive', label: 'Archive completed work', what: 'Moves completed truck, trailer, fork truck and wash records to their HISTORY tabs, and plant activity older than the Live weeks to PLANT_OPERATIONS HISTORY.', kind: 'weekly', def: { day: 'SUNDAY', hour: 18 } },
  { key: 'fleetSync', label: 'Fleet master', what: 'Brings Equipment Master in step with the United Dairy fleet list (and the Sync fleet list button on Equipment).', kind: 'fixed', every: 'Every night at 2:00 AM' },
  { key: 'otr', label: 'Over-the-road run count', what: 'Counted as each Over the Road run is saved; no separate job is needed.', kind: 'fixed', every: 'With each save' },
  { key: 'homeOnce', label: 'Home summary rebuild (on demand)', what: 'Home reads the database directly, so its numbers are never older than the last copy. Refresh Home Summary Now copies the sheets at once.', kind: 'fixed', every: 'Not needed' },
  { key: 'fleetStartup', label: 'Fleet startup sync', what: 'Part of the nightly fleet sync.', kind: 'fixed', every: 'Not needed' },
  { key: 'install', label: 'Legacy installation worker', what: 'The new app has no installation step.', kind: 'fixed', every: 'Not needed' },
  { key: 'dailyShift', label: 'Retired Daily Shift Report import', what: 'Retired in the current app; kept here read only.', kind: 'retired' },
  { key: 'dailyReference', label: 'Retired Daily Reference worker', what: 'Retired in the current app; kept here read only.', kind: 'retired' }
];
const JOB = {}; JOBS.forEach(j => { JOB[j.key] = j; });

async function rateSettings(db) {
  const d = (await read(priv(db, 'refreshRates'))) || {};
  const jobs = {};
  JOBS.forEach(j => {
    const saved = (d.jobs || {})[j.key] || {};
    if (j.kind === 'interval') jobs[j.key] = { minutes: MINUTES.indexOf(saved.minutes) >= 0 && saved.minutes >= j.base ? saved.minutes : j.def, updatedAt: saved.updatedAt || '', updatedBy: saved.updatedBy || '' };
    else if (j.kind === 'weekly') jobs[j.key] = { day: WEEKDAYS.indexOf(saved.day) >= 0 ? saved.day : j.def.day, hour: Number.isInteger(saved.hour) ? saved.hour : j.def.hour, updatedAt: saved.updatedAt || '', updatedBy: saved.updatedBy || '' };
    else jobs[j.key] = {};
  });
  return { jobs, lastRun: d.lastRun || {}, raw: d };
}
const rateRevision = (entry) => crypto.createHash('sha256').update(JSON.stringify(entry || {})).digest('hex').slice(0, 12);

// The scheduled jobs ask this first: true when the chosen rate says it is time (and records the run).
async function jobDue(db, key, now) {
  const at = now || new Date(), j = JOB[key];
  const ref = priv(db, 'refreshRates');
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref), d = snap.exists ? snap.data() : {}, last = (d.lastRun || {})[key];
    const saved = (d.jobs || {})[key] || {};
    let due;
    if (j.kind === 'weekly') {
      const ny = nyParts(at), day = saved.day || j.def.day, hour = Number.isInteger(saved.hour) ? saved.hour : j.def.hour;
      due = ny.weekday === day && ny.hour === hour && !(last && at.getTime() - Date.parse(last) < 3 * 3600000);
    } else {
      const minutes = MINUTES.indexOf(saved.minutes) >= 0 && saved.minutes >= j.base ? saved.minutes : j.def;
      due = !last || at.getTime() - Date.parse(last) >= minutes * 60000 - 30000;
    }
    if (due) tx.set(ref, { lastRun: { [key]: at.toISOString() } }, { merge: true });
    return due;
  });
}

async function refreshRates(db) {
  const s = await rateSettings(db), latest = await db.collection(C.transfers).orderBy('at', 'desc').limit(1).get().catch(() => null);
  const last = Object.assign({}, s.lastRun);
  if (latest && !latest.empty) last.transfer = latest.docs[0].data().at;
  return { jobs: JOBS.map(j => Object.assign({}, j, s.jobs[j.key], { lastRun: last[j.key] || '', revision: rateRevision(s.jobs[j.key]) })), minutes: MINUTES, weekdays: WEEKDAYS, timeZone: L.TIME_ZONE };
}

async function saveRefreshRate(db, email, input, stamp) {
  const j = JOB[String(input.job || '')];
  if (!j) fail('BAD_REQUEST', 'Unknown job.');
  if (j.kind === 'retired') fail('NOT_ALLOWED', j.label + ' is retired and cannot be scheduled.');
  if (j.kind === 'fixed') fail('NOT_ALLOWED', j.label + ' runs ' + j.every.toLowerCase() + '; it has no rate to change.');
  const s = await rateSettings(db);
  if (String(input.revision || '') !== rateRevision(s.jobs[j.key])) fail('CHANGED', 'Someone changed this schedule. Reload before saving.');
  let entry;
  if (j.kind === 'interval') {
    const m = Number(input.minutes);
    if (MINUTES.indexOf(m) < 0 || m < j.base) fail('BAD_REQUEST', 'Pick how often (' + j.label + ' can run every ' + j.base + ' minute' + (j.base === 1 ? '' : 's') + ' at most).');
    entry = { minutes: m };
  } else {
    const day = String(input.day || '').toUpperCase(), hour = Number(input.hour);
    if (WEEKDAYS.indexOf(day) < 0 || !Number.isInteger(hour) || hour < 0 || hour > 23) fail('BAD_REQUEST', 'Pick the day and hour.');
    entry = { day, hour };
  }
  await priv(db, 'refreshRates').set({ jobs: { [j.key]: Object.assign(entry, { updatedAt: stamp, updatedBy: email }) } }, { merge: true });
  return Object.assign({ ok: true, message: 'Schedule saved and applied.' }, await refreshRates(db));
}

// Archive now: completed records out of the Live queues into their HISTORY tabs (sandbox copy), checked before anything is removed.
const ARCHIVE = [['TRUCK LIVE', 'TRUCK HISTORY'], ['TRAILER LIVE', 'TRAILER HISTORY'], ['FORK TRUCK LIVE', 'FORK TRUCK HISTORY'], ['WASH / CLEANING LIVE', 'WASH / CLEANING HISTORY']];
async function archiveCompleted(db, email, deps, now) {
  const d = deps || {};
  if (!d.sheets || !d.liveId) fail('NOT_ALLOWED', 'Archive needs the sandbox Live workbook copy; it is not set up here.');
  assertSandboxTarget(d.liveId);
  const lock = priv(db, 'archiveLock'), at = (now || new Date()).toISOString();
  const got = await db.runTransaction(async tx => { const l = (await tx.get(lock)).data(); if (l && l.until > at) return false; tx.set(lock, { until: new Date(Date.parse(at) + 5 * 60000).toISOString() }); return true; });
  if (!got) return { ok: false, message: 'Another archive or completion is running. Try again in a minute.' };
  try {
    const tabs = await d.sheets.tabs(d.liveId), idOf = {};
    tabs.forEach(t => { idOf[t.title] = t.sheetId; });
    const weeks = (await db.collection(C.weeks).get()).docs.map(x => x.id).sort();
    const keepFrom = weeks[0] || L.addDays(L.weekStart(nyParts(new Date(at)).date), -7);
    const jobs = ARCHIVE.map(([live, hist]) => ({ live, hist, id: 'record_id', done: (row, h) => DONE.indexOf(String(row[h.indexOf('status')] || '').trim().toUpperCase()) >= 0 }))
      .concat([{ live: 'PLANT_OPERATIONS', hist: 'PLANT_OPERATIONS HISTORY', id: 'record_id', done: (row, h) => { const k = L.dateKey(String(row[h.indexOf('business_date')] || '')); return !!k && k < keepFrom; } }]);
    let records = 0, plant = 0;
    const notDone = [];
    for (const job of jobs) {
      try {
        if (idOf[job.live] === undefined || idOf[job.hist] === undefined) { notDone.push(job.live); continue; }
        const [liveRows, histRows] = await d.sheets.batchGet(d.liveId, ["'" + job.live + "'", "'" + job.hist + "'"], 'UNFORMATTED_VALUE');
        const h = (liveRows[0] || []).map(M.normalizeHeader), hh = (histRows[0] || []).map(M.normalizeHeader);
        if (h.indexOf(job.id) < 0 || hh.indexOf(job.id) < 0) { notDone.push(job.live); continue; }
        const move = [];
        liveRows.slice(1).forEach((row, i) => { if (String(row[h.indexOf(job.id)] || '').trim() && job.done(row, h)) move.push({ row, sheetRow: i + 2 }); });
        if (!move.length) continue;
        const have = new Set(histRows.slice(1).map(r => String(r[hh.indexOf(job.id)] || '')));
        const add = move.filter(m => !have.has(String(m.row[h.indexOf(job.id)]))).map(m => hh.map(col => col === 'archived_at' ? at : col === 'archived_by' ? email : col === 'history_version' ? 1 : (h.indexOf(col) >= 0 && m.row[h.indexOf(col)] !== undefined ? m.row[h.indexOf(col)] : '')));
        if (add.length) await d.sheets.append(d.liveId, "'" + job.hist + "'!A1", add);
        // Checked: every row is in HISTORY before it leaves Live.
        const check = new Set((await d.sheets.batchGet(d.liveId, ["'" + job.hist + "'"], 'UNFORMATTED_VALUE'))[0].slice(1).map(r => String(r[hh.indexOf(job.id)] || '')));
        const safe = move.filter(m => check.has(String(m.row[h.indexOf(job.id)])));
        if (safe.length < move.length) notDone.push(job.live);
        const rows = safe.map(m => m.sheetRow).sort((a, b) => b - a);
        if (rows.length) await d.sheets.structure(d.liveId, rows.map(r => ({ deleteDimension: { range: { sheetId: idOf[job.live], dimension: 'ROWS', startIndex: r - 1, endIndex: r } } })));
        if (job.live === 'PLANT_OPERATIONS') plant += rows.length; else records += rows.length;
      } catch (e) { notDone.push(job.live); }
    }
    await priv(db, 'refreshRates').set({ lastRun: { archive: at } }, { merge: true });
    return { ok: true, records, plant, message: 'Archived ' + records + ' completed record' + (records === 1 ? '' : 's') + ' and ' + plant + ' old plant activity row' + (plant === 1 ? '' : 's') + '.' + (notDone.length ? ' Not finished: ' + notDone.join(', ') + ' (nothing removed there; the next run tries again).' : '') };
  } finally { await lock.delete(); }
}

/* ---------- Window Test Center ---------- */

async function windowTests(db) {
  const snap = await db.collection('windowTests').orderBy('at', 'desc').limit(30).get();
  return { tests: snap.docs.map(d => d.data()) };
}
async function windowTestLog(db, email, input, stamp) {
  const rows = (Array.isArray(input.results) ? input.results : []).slice(0, 80).map(r => ({ screen: text(r.screen, 80), page: text(r.page, 120), width: Number(r.width) || 0, ms: Math.round(Number(r.ms) || 0),
    status: ['PASS', 'FAIL'].indexOf(r.status) >= 0 ? r.status : 'FAIL', problems: (Array.isArray(r.problems) ? r.problems : []).slice(0, 6).map(p => text(p, 200)) }));
  if (!rows.length) fail('BAD_REQUEST', 'No test results.');
  await db.collection('windowTests').add({ at: stamp, by: email, results: rows, passed: rows.filter(r => r.status === 'PASS').length, failed: rows.filter(r => r.status === 'FAIL').length });
  return Object.assign({ ok: true, message: 'Diagnostic record saved.' }, await windowTests(db));
}

/* ---------- Run Runtime Pre-Flight (the health check) ---------- */

async function preflight(db, deps) {
  const d = deps || {}, now = d.now ? d.now() : new Date(), env = d.env || process.env, checks = [];
  const check = async (name, fn) => {
    const t = Date.now();
    try { const r = await fn(); checks.push({ name, status: r.status || 'PASS', detail: r.detail || '', ms: Date.now() - t }); }
    catch (e) { checks.push({ name, status: 'FAIL', detail: String(e.message || e).slice(0, 200), ms: Date.now() - t }); }
  };
  const minsAgo = (iso) => (iso ? Math.round((now.getTime() - Date.parse(iso)) / 60000) : null);
  const all = async (c) => (await db.collection(c).get()).docs.map(x => Object.assign({ id: x.id }, x.data()));
  const cfg = (await read(db.collection(C.config).doc('app'))) || {};
  const today = L.operatingDay(now), week = L.weekStart(today);
  let transfer = null, weeks = [], runs = [];
  await check('Copy from the sheets', async () => {
    const t = await db.collection(C.transfers).orderBy('at', 'desc').limit(1).get();
    if (t.empty) return { status: 'FAIL', detail: 'The sheets have never been copied.' };
    transfer = t.docs[0].data();
    const m = minsAgo(transfer.at);
    return { status: m <= 5 ? 'PASS' : 'FAIL', detail: 'Last copy ' + m + ' minute' + (m === 1 ? '' : 's') + ' ago' + (transfer.warningCount ? '; ' + transfer.warningCount + ' warning(s) from the sheets' : '') + '.' };
  });
  await check('Live Week Lifecycle', async () => {
    weeks = (await db.collection(C.weeks).get()).docs.map(x => x.id).sort();
    const want = [L.addDays(week, -7), week, L.addDays(week, 7)];
    const missing = want.filter(w => weeks.indexOf(w) < 0);
    return missing.length ? { status: 'FAIL', detail: 'Missing Live week(s): ' + missing.join(', ') + ' (copied: ' + weeks.join(', ') + ').' } : { detail: 'Previous, current and next weeks are copied (' + want.join(', ') + ').' };
  });
  await check('Daily Dispatch', async () => {
    runs = (await db.collection(C.runs).where('weekStart', '==', week).get()).docs.map(x => x.data());
    const p = L.dayPrefix(today), n = runs.filter(r => r.days && r.days[p] && r.days[p].runs).length;
    return n ? { detail: n + ' runs today.' } : { status: 'FAIL', detail: 'No runs today in the current Live week.' };
  });
  await check('Row Lookup Accuracy', async () => {
    const blank = runs.filter(r => !r.runId).length;
    return blank ? { status: 'WARN', detail: blank + ' Live row(s) this week have no run_id; they are matched by route and run.' } : { detail: 'Every Live row this week has a run_id.' };
  });
  for (const [name, coll, min] of [['Route Master', C.routes, 1], ['Driver Roster', C.drivers, 1], ['Equipment Master', C.equipment, 1]]) {
    await check(name, async () => { const n = (await db.collection(coll).count().get()).data().count; return n >= min ? { detail: n + ' rows copied.' } : { status: 'FAIL', detail: 'Nothing copied.' }; });
  }
  await check('Users and Administrators', async () => {
    const users = await all(C.users), admins = users.filter(u => u.status === 'ACTIVE' && L.isAdmin(u));
    const primary = users.find(u => L.PRIMARY_ADMINS.indexOf(u.id) >= 0);
    return !admins.length ? { status: 'FAIL', detail: 'No active Administrator.' } : !primary || primary.status !== 'ACTIVE' ? { status: 'WARN', detail: 'The primary administrator is not active.' } : { detail: users.filter(u => u.status === 'ACTIVE').length + ' active users, ' + admins.length + ' administrators.' };
  });
  await check('Write-back to the Live sheet', async () => {
    if (!(cfg.writeBack && cfg.writeBack.enabled === true)) return { status: 'WARN', detail: 'The write-back is off: saves stay in the app.' };
    const old = (await db.collection(C.outbox).where('status', '==', 'pending').get()).docs.map(x => x.data()).filter(x => minsAgo(x.at) > 10);
    return old.length ? { status: 'FAIL', detail: old.length + ' save(s) waiting more than 10 minutes to reach the sheet.' } : { detail: 'Nothing waiting.' };
  });
  await check('Write-back to the master lists', async () => {
    const old = (await db.collection(C.masterOutbox).where('status', '==', 'pending').get()).docs.map(x => x.data()).filter(x => minsAgo(x.at) > 10);
    return old.length ? { status: 'FAIL', detail: old.length + ' master-list change(s) waiting more than 10 minutes.' } : { detail: 'Nothing waiting.' };
  });
  await check('Sheet Conflicts', async () => {
    const n = (await db.collection(C.conflicts).get()).docs.filter(x => !x.data().clearedAt && x.data().status !== 'CLEARED').length;
    return n ? { status: 'WARN', detail: n + ' sheet cell(s) were not written because someone typed in the sheet; see Sheet Conflicts.' } : { detail: 'None.' };
  });
  await check('Maintenance Summary', async () => {
    const m = await all(C.maintenance), open = m.filter(r => DONE.indexOf(String(r.status || '').toUpperCase()) < 0), rev = open.filter(r => String(r.status).toUpperCase() === 'NEEDS_REVIEW');
    return { status: rev.length ? 'WARN' : 'PASS', detail: open.length + ' open write-ups' + (rev.length ? ', ' + rev.length + ' need review' : '') + '.' };
  });
  await check('Plant Summary', async () => {
    const n = (await db.collection(C.plantLoads).count().get()).data().count;
    return { detail: n + ' plant activity rows copied.' };
  });
  await check('MOCREO Temperature Sensors', async () => {
    const m = (await read(db.collection(C.config).doc('mocreo'))) || {};
    if (!m.lastSyncAt && !m.at && !m.ok) return { status: 'WARN', detail: 'No sensor reading yet (Administration > MOCREO & Sensors).' };
    const last = m.lastSyncAt || m.at, age = minsAgo(last);
    return age !== null && age > 30 ? { status: 'WARN', detail: 'Last sensor read ' + age + ' minutes ago.' } : { detail: 'Sensors read ' + (age === null ? 'recently' : age + ' minutes ago') + '.' };
  });
  await check('Email', async () => {
    const s = await emailSettings(db), from = String(env.MAIL_FROM || '');
    const last = await db.collection('sentEmails').orderBy('at', 'desc').limit(1).get();
    const l = last.empty ? null : last.docs[0].data();
    if (!s.sending) return { status: 'WARN', detail: 'Sending is OFF.' };
    if (!from) return { status: 'WARN', detail: 'No sender is set for this app.' };
    return l && l.status === 'FAILED' ? { status: 'WARN', detail: 'The last email failed: ' + l.reason } : { detail: 'Sending is ON as ' + from + (env.LIVE_EMAIL === '1' ? '.' : ' (sandbox: test copies to the sender only).') };
  });
  await check('Repair Email', async () => {
    const s = await repairSettings(db), bad = ROUTES.filter(k => AUTO(s.routes[k].mode) && !s.routes[k].emails.length);
    return bad.length ? { status: 'FAIL', detail: bad.map(k => ROUTE_LABEL[k]).join(', ') + ' is automatic with no address.' } : { detail: ROUTES.map(k => ROUTE_LABEL[k] + ': ' + s.routes[k].mode.toLowerCase()).join('; ') + '.' };
  });
  await check('Driver Check-In Email', async () => {
    const s = await checkinSettings(db), last = await read(priv(db, 'checkinEmailStatus'));
    if (!s.enabled) return { status: 'WARN', detail: 'The mailbox check is off.' };
    return last && last.status === 'FAIL' ? { status: 'FAIL', detail: last.error } : { detail: last ? 'Last check ' + minsAgo(last.at) + ' minutes ago.' : 'Not checked yet.' };
  });
  await check('Route Distribution code (phones)', async () => {
    const r = (await read(db.collection(C.config).doc('routePhone'))) || {};
    return !r.hash ? { status: 'WARN', detail: 'No code set: drivers\' phones cannot check in.' } : r.enabled === false ? { status: 'WARN', detail: 'The code is turned off.' } : { detail: 'Set and on.' };
  });
  await check('Plant Station release code', async () => {
    const r = (await read(priv(db, 'releaseCodes'))) || {};
    return r.fac_uniontown ? { detail: 'Uniontown has a manager release code.' } : { status: 'WARN', detail: 'No release code: any tablet user can change station.' };
  });
  await check('Fleet list sync', async () => {
    const f = (await read(db.collection(C.config).doc('fleetSync'))) || {}, last = f.at || f.lastAt || f.lastRunAt;
    return last ? { status: minsAgo(last) > 26 * 60 ? 'WARN' : 'PASS', detail: 'Last sync ' + new Date(last).toLocaleString('en-US', { timeZone: L.TIME_ZONE }) + '.' } : { status: 'WARN', detail: 'Not synced yet.' };
  });
  const passed = checks.filter(c => c.status === 'PASS').length, failed = checks.filter(c => c.status === 'FAIL').length;
  const summary = (failed ? 'FAIL' : 'PASS') + ' \u00b7 ' + checks.length + ' / ' + checks.length + ' checks \u00b7 ' + passed + ' passed \u00b7 ' + failed + ' failed' + (checks.length - passed - failed ? ' \u00b7 ' + (checks.length - passed - failed) + ' to look at' : '');
  await priv(db, 'preflight').set({ at: now.toISOString(), summary });
  return { summary, checks, at: now.toISOString() };
}

/* ---------- Update Live Sheets ---------- */

/*
 * Route Master and the drivers' standard runs into the current and next Live weeks (udpoV7267RouteMasterToLive_ /
 * DriverMasterToLive_): for each day loading today or later and not changed by hand (route_override), whether the run runs,
 * its depart time follows Route Master; a day with no driver, truck or trailer gets the standard one. A driver
 * who is off that day is not put on. Dry run first; Apply makes the same changes as saves (and writes the sheet copy).
 */
async function updateLive(db, email, input, stamp, deps) {
  const now = new Date(stamp), today = L.operatingDay(now), week = L.weekStart(today);
  const apply = input.apply === true;
  return db.runTransaction(async tx => {
    const mode = await (require('./actions').requireTestMode)(tx, db, 'weeklyDispatch');
    const runSnaps = (await tx.get(db.collection(C.runs).where('weekStart', 'in', [week, L.addDays(week, 7)]))).docs;
    const [routeSnap, driverSnap, exSnap, equipSnap] = await Promise.all([tx.get(db.collection(C.routes)), tx.get(db.collection(C.drivers)), tx.get(db.collection(C.exceptions).where('endDate', '>=', week)), tx.get(db.collection(C.equipment))]);
    const routes = {};
    routeSnap.docs.forEach(x => { const r = x.data(); if (r.id) routes[r.id] = r; });
    const equip = equipSnap.docs.map(x => x.data()), unit = (v, type) => {
      const k = String(v || '').trim().toUpperCase().replace(/^T\s*-?\s*(?=\d)/, '');
      const e = k && equip.find(u => (String(u.id).toUpperCase() === String(v).toUpperCase() || String(u.unit || '').toUpperCase().replace(/^T\s*-?\s*(?=\d)/, '') === k) && (!type || u.type === type));
      return e && !L.unitOff(e) ? { id: e.id, unit: e.unit } : null;
    };
    const slots = L.standardDrivers(driverSnap.docs.map(x => x.data())), exceptions = exSnap.docs.map(x => x.data());
    const changes = [], updates = [], rowsOf = {};
    runSnaps.forEach(x => { const k = x.data().weekStart + '|' + x.data().runId; rowsOf[k] = (rowsOf[k] || 0) + 1; });
    let part = 0;
    runSnaps.forEach(snap => {
      const run = snap.data(), route = routes[run.runId];
      const plan = L.resetWeekPlan(run, route, slots, exceptions);
      if (!plan) return;
      const update = {};
      L.DAYS.forEach((p, i) => {
        const was = (run.days && run.days[p]) || {}, date = L.addDays(run.weekStart, i), load = was.loadDate || L.addDays(date, Number((route.days[p] || {}).loadDayOffset) || 0);
        if (load < today || L.yes(was.routeOverride) || was.completeTime || was.loadedComplete === true) return;
        const rd = route.days[p] || {}, want = {};
        // A run on two Live rows (different days) keeps its running days: which row a day belongs on is not Route Master's to say.
        const split = rowsOf[run.weekStart + '|' + run.runId] > 1;
        if (!split && !!was.runs !== plan[p].runs) want.runs = plan[p].runs;
        if (split ? was.runs : plan[p].runs) {
          if (rd.dispatchTime !== null && rd.dispatchTime !== undefined && was.dispatchTime !== rd.dispatchTime) want.dispatchTime = rd.dispatchTime;
          if (!was.driverId && !was.driver && plan[p].driverId) Object.assign(want, { driverId: plan[p].driverId, driver: plan[p].driver });
          const t = !was.truck && unit(rd.tractor, 'TRUCK'), tr = !was.trailer && unit(rd.trailer, 'TRAILER');
          if (t) Object.assign(want, { truckId: t.id, truck: t.unit });
          if (tr) Object.assign(want, { trailerId: tr.id, trailer: tr.unit });
        }
        if (!Object.keys(want).length) return;
        const before = {}; Object.keys(want).forEach(k => { before[k] = was[k] === undefined ? null : was[k]; });
        changes.push({ runDocId: snap.id, week: run.weekStart, route: run.route, run: run.run, day: p, date, before, after: want });
        Object.keys(want).forEach(k => { update['days.' + p + '.' + k] = want[k]; });
        update['days.' + p + '.updatedAt'] = stamp; update['days.' + p + '.updatedBy'] = email;
        if (apply && mode.writeBack) updates.push(() => require('./actions').queueSheetCells(tx, db, rid('live'), 'u' + (part++), run, snap.id, p, want, stamp, email));
      });
      if (apply && Object.keys(update).length) updates.push(() => tx.update(snap.ref, Object.assign(update, { rev: run.rev + 1, testEdited: true, editedAt: stamp })));
    });
    // Runs in Route Master that are not on a Live week at all.
    const onLive = new Set(runSnaps.map(x => x.data().runId));
    const missing = Object.values(routes).filter(r => L.masterActive(r) && ['INACTIVE', 'DISABLED', 'TERMINATED'].indexOf(String(r.routeStatus || 'ACTIVE').toUpperCase()) < 0 && !onLive.has(r.id) && L.DAYS.some(p => r.days && r.days[p] && r.days[p].active))
      .map(r => ({ runId: r.id, route: r.route, run: r.run || r.routeName || '' }));
    if (apply) {
      updates.forEach(f => f());
      tx.set(db.collection(C.actions).doc(rid('adm')), { action: 'updateLiveSheets', by: email, at: stamp, mode: mode.mode, changes: changes.slice(0, 400), missing });
    }
    const cells = changes.reduce((n, c) => n + Object.keys(c.after).length, 0), drivers = changes.filter(c => c.after.driverId).length;
    const message = (apply ? 'Live sheets updated: ' : 'Dry run: ') + cells + ' route cell' + (cells === 1 ? '' : 's') + ' on ' + changes.length + ' day' + (changes.length === 1 ? '' : 's') + ', ' + drivers + ' driver cell' + (drivers === 1 ? '' : 's') + (apply ? '' : ' would change') + '.' +
      (missing.length ? ' WARNING: ' + missing.length + ' Route Master run' + (missing.length === 1 ? ' is' : 's are') + ' not on the Live weeks (listed below).' : '') + (apply && !mode.writeBack ? ' The write-back is off, so the sheet copy is not changed.' : '');
    return { ok: true, applied: apply, message, changes: changes.slice(0, 400), missing, weeks: [week, L.addDays(week, 7)], today };
  });
}

/* ---------- Refresh Home Summary Now, Start Plant Fresh ---------- */

async function refreshHome(db, deps) {
  if (!deps || !deps.runTransfer) fail('NOT_ALLOWED', 'No sheets are set up for this project yet.');
  const r = await deps.runTransfer();
  const s = r.summary || {}, weeks = Object.keys(s.weeks || {}).reduce((n, k) => n + (s.weeks[k].written || 0), 0);
  return { ok: true, at: r.at, message: 'Home summary refreshed: the sheets were copied just now (' + weeks + ' Live row' + (weeks === 1 ? '' : 's') + ' changed' + (r.warnings && r.warnings.length ? ', ' + r.warnings.length + ' warning(s)' : '') + '). Home and every screen show it at once.' };
}

async function plantFresh(db) {
  const c = (await read(db.collection(C.config).doc('app'))) || {};
  return { plantStart: c.plantStart || null };
}
async function plantFreshSet(db, email, input, stamp) {
  const date = nyParts(new Date(stamp)).date;
  await db.collection(C.config).doc('app').set({ plantStart: { date, by: email, at: stamp } }, { merge: true });
  return { ok: true, plantStart: { date, by: email, at: stamp }, message: 'Plant starts fresh from ' + date + '. Reload Plant screens.' };
}

/* ---------- Date Inventory, Date Column Dry Run / Convert ---------- */

const SERIAL_EPOCH = Date.UTC(1899, 11, 30);
const DATE_WORD = /(^|_)(date|day|at|time|dob|hire|seniority|start|end|opened|completed|updated|created|recorded|expires?|due|archived|week)($|_)/;
// The sheets the app reads: alias -> {spreadsheetId, tab, headerRow}.
function sheetCatalog(sources) {
  const s = sources || {}, out = {};
  if (s.live && s.live.spreadsheetId) {
    Object.keys(M.LIVE_TABS).forEach(k => { out[M.LIVE_TABS[k]] = { spreadsheetId: s.live.spreadsheetId, tab: M.LIVE_TABS[k], headerRow: M.LIVE_HEADER_ROW }; });
    Object.keys(MAINT.TABS).forEach(k => { out[MAINT.TABS[k]] = { spreadsheetId: s.live.spreadsheetId, tab: MAINT.TABS[k] }; });
  }
  Object.keys(s.masters || {}).forEach(k => { const m = s.masters[k]; out[m.tab] = { spreadsheetId: m.spreadsheetId, tab: m.tab }; });
  return out;
}
const snake = (v) => /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(String(v || '').trim()) || /^[a-z]+$/.test(String(v || '').trim());
function headerRowOf(rows, fixed) {
  if (fixed) return fixed - 1;
  let best = 0, score = -1;
  rows.slice(0, 8).forEach((r, i) => { const n = (r || []).filter(snake).length; if (n > score) { score = n; best = i; } });
  return best;
}
function cellKind(raw, shown) {
  if (raw === '' || raw === null || raw === undefined) return 'BLANK';
  if (typeof raw === 'boolean') return 'BOOLEAN';
  if (typeof raw === 'number') return /\d{1,4}[/-]\d{1,2}[/-]\d{1,4}|\d:\d\d/.test(String(shown || '')) ? 'DATE_VALUE' : 'NUMBER';
  const t = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{1,2}:\d{2}/.test(t) || /^\d{1,2}\/\d{1,2}\/\d{2,4}\s+\d{1,2}:\d{2}/.test(t)) return 'TEXT_TIMESTAMP';
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(t) || /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(t)) return 'TEXT_DATE';
  if (/^\d{1,2}:\d{2}(:\d{2})?\s*([AaPp][Mm])?$/.test(t)) return 'TEXT_TIME';
  return 'TEXT_OTHER';
}
async function readBoth(sheets, id, tab) {
  const [raw] = await sheets.batchGet(id, ["'" + tab + "'"], 'UNFORMATTED_VALUE');
  const [shown] = await sheets.batchGet(id, ["'" + tab + "'"]);
  return { raw: raw || [], shown: shown || [] };
}
function columnStats(raw, shown, h, col) {
  const counts = {}, samples = [];
  let filled = 0;
  for (let r = h + 1; r < raw.length && r <= h + 1500; r++) {
    const k = cellKind((raw[r] || [])[col], (shown[r] || [])[col]);
    counts[k] = (counts[k] || 0) + 1;
    if (k !== 'BLANK') { filled++; if (samples.length < 3) samples.push(String((shown[r] || [])[col])); }
  }
  const kinds = Object.keys(counts).filter(k => k !== 'BLANK');
  const status = !filled ? 'EMPTY' : kinds.length === 1 && kinds[0] === 'DATE_VALUE' ? 'SERIAL_OK' : kinds.length === 1 ? 'SINGLE_TEXT_KIND' : 'MIXED';
  const dominant = kinds.sort((a, b) => counts[b] - counts[a])[0] || '';
  return { filled, counts, samples, status, dominant };
}

async function dateInventory(db, deps) {
  const d = deps || {};
  if (!d.sheets) fail('NOT_ALLOWED', 'The sheets are not set up here.');
  const cat = sheetCatalog(d.sources), columns = [], errors = [];
  for (const alias of Object.keys(cat)) {
    try {
      const { raw, shown } = await readBoth(d.sheets, cat[alias].spreadsheetId, cat[alias].tab), h = headerRowOf(raw, cat[alias].headerRow);
      (raw[h] || []).forEach((name, col) => {
        const header = M.normalizeHeader(name);
        if (!header) return;
        const st = columnStats(raw, shown, h, col), dateLike = ['DATE_VALUE', 'TEXT_DATE', 'TEXT_TIME', 'TEXT_TIMESTAMP'].some(k => st.counts[k]);
        if (!DATE_WORD.test(header) && !dateLike) return;
        columns.push(Object.assign({ sheet: alias, headerRow: h + 1, column: columnLetter(col), header, named: DATE_WORD.test(header) }, st));
      });
    } catch (e) { errors.push(alias + ': ' + String(e.message || e).slice(0, 120)); }
  }
  const n = (s) => columns.filter(c => c.status === s).length;
  const summary = Object.keys(cat).length + ' sheets \u00b7 ' + columns.length + ' date/time columns \u00b7 ' + n('SERIAL_OK') + ' already serial \u00b7 ' + n('MIXED') + ' mixed \u00b7 ' + n('SINGLE_TEXT_KIND') + ' stored as text' + (errors.length ? ' \u00b7 ' + errors.length + ' errors' : '');
  return { summary, columns, errors };
}

async function dateSheets(db, deps) {
  const cat = sheetCatalog((deps || {}).sources);
  const done = (await read(priv(db, 'dateColumns'))) || {};
  return { sheets: Object.keys(cat).map(k => ({ alias: k, sandbox: !require('./writeback').PRODUCTION_IDS.includes(cat[k].spreadsheetId) })), converted: done.columns || {} };
}

// A text cell to a sheet serial (days since 12/30/1899, New York time for a timestamp), or null.
function toSerial(v, kind) {
  if (typeof v === 'number') return v;
  const t = String(v || '').trim();
  let m;
  const day = (y, mo, d) => (Date.UTC(y < 100 ? 2000 + y : y, mo - 1, d) - SERIAL_EPOCH) / 86400000;
  const tm = (s) => { const x = L.minutesOfDay(s); return x === null ? null : x / 1440; };
  if (kind === 'TIME') { const x = tm(t); return x; }
  let date = null, rest = '';
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](.*))?$/.exec(t))) { date = day(+m[1], +m[2], +m[3]); rest = m[4] || ''; }
  else if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(.*))?$/.exec(t))) { date = day(+m[3], +m[1], +m[2]); rest = m[4] || ''; }
  if (date === null || isNaN(date)) return null;
  if (kind === 'DATE') return rest ? null : date;
  if (!rest) return date;
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(rest)) {
    const ms = Date.parse(t);
    if (isNaN(ms)) return null;
    const p = {};
    new Intl.DateTimeFormat('en-US', { timeZone: L.TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).forEach(x => { p[x.type] = x.value; });
    return day(+p.year, +p.month, +p.day) + (Number(p.hour) * 3600 + Number(p.minute) * 60 + Number(p.second)) / 86400;
  }
  const x = tm(rest.replace(/\.\d+$/, '').replace(/:(\d{2}):\d{2}/, ':$1'));
  return x === null ? null : date + x;
}
const FORMATS = { DATE: 'M/d/yyyy', TIME: 'h:mm AM/PM', DATETIME: 'M/d/yyyy h:mm AM/PM' };

async function columnRead(db, deps, input) {
  const d = deps || {};
  if (!d.sheets) fail('NOT_ALLOWED', 'The sheets are not set up here.');
  const cat = sheetCatalog(d.sources), alias = text(input.sheet, 80), field = M.normalizeHeader(input.column), kind = String(input.kind || 'DATE').toUpperCase();
  if (!cat[alias]) fail('BAD_REQUEST', 'Pick a sheet from the list.');
  if (!FORMATS[kind]) fail('BAD_REQUEST', 'Kind must be DATE, TIME or DATETIME.');
  const src = cat[alias], { raw, shown } = await readBoth(d.sheets, src.spreadsheetId, src.tab), h = headerRowOf(raw, src.headerRow);
  const col = (raw[h] || []).map(M.normalizeHeader).indexOf(field);
  if (col < 0) fail('BAD_REQUEST', alias + ' has no column ' + field + '.');
  const cells = [];
  let bad = 0, example = '', filled = 0, serial = 0;
  for (let r = h + 1; r < raw.length; r++) {
    const v = (raw[r] || [])[col];
    if (v === '' || v === undefined || v === null) continue;
    filled++;
    const s = toSerial(v, kind);
    if (typeof v === 'number') serial++;
    if (s === null) { bad++; if (!example) example = 'row ' + (r + 1) + ': "' + String((shown[r] || [])[col]) + '"'; continue; }
    cells.push({ row: r + 1, from: v, to: s });
  }
  const done = ((await read(priv(db, 'dateColumns'))) || {}).columns || {}, key = alias + '|' + field;
  return { src, alias, field, kind, col, cells, bad, example, filled, rows: raw.length - h - 1, serial, already: !!done[key] || (filled > 0 && serial === filled), key };
}

async function dateDryRun(db, email, input, stamp, deps) {
  const c = await columnRead(db, deps, input);
  const ok = c.bad === 0 && c.filled > 0 && !c.already;
  return { ok: true, canConvert: ok, message: c.alias + ' \u00b7 ' + c.field + ': ' + c.filled + ' of ' + c.rows + ' cells hold values \u00b7 ' + c.bad + ' cannot be read as ' + c.kind + (c.example ? ' (e.g. ' + c.example + ')' : '') + (c.already ? ' \u00b7 already converted' : '') + ' \u00b7 display ' + FORMATS[c.kind] };
}

async function dateConvert(db, email, input, stamp, deps) {
  const c = await columnRead(db, deps, input);
  if (c.bad || !c.filled || c.already) fail('NOT_ALLOWED', 'Run a clean Dry Run first (every filled cell readable, not already converted).');
  // Only the sandbox copies can be changed, whatever is asked.
  assertSandboxTarget(c.src.spreadsheetId);
  const backup = await db.collection('dateBackups').add({ at: stamp, by: email, sheet: c.alias, field: c.field, kind: c.kind, cells: c.cells.map(x => ({ row: x.row, v: x.from })) });
  const letter = columnLetter(c.col), tab = "'" + c.src.tab + "'";
  const tabs = await deps.sheets.tabs(c.src.spreadsheetId), sheetId = (tabs.find(t => t.title === c.src.tab) || {}).sheetId;
  await deps.sheets.batchUpdate(c.src.spreadsheetId, c.cells.map(x => ({ range: tab + '!' + letter + x.row, values: [[x.to]] })));
  if (sheetId !== undefined) {
    await deps.sheets.structure(c.src.spreadsheetId, [{ repeatCell: { range: { sheetId, startRowIndex: c.cells[0].row - 1, endRowIndex: c.cells[c.cells.length - 1].row, startColumnIndex: c.col, endColumnIndex: c.col + 1 },
      cell: { userEnteredFormat: { numberFormat: { type: c.kind === 'TIME' ? 'TIME' : c.kind === 'DATE' ? 'DATE' : 'DATE_TIME', pattern: FORMATS[c.kind] } } }, fields: 'userEnteredFormat.numberFormat' } }]);
  }
  // Every cell read back; anything different puts the original values back.
  const [after] = await deps.sheets.batchGet(c.src.spreadsheetId, [tab], 'UNFORMATTED_VALUE');
  const wrong = c.cells.filter(x => Math.abs(Number((after[x.row - 1] || [])[c.col]) - x.to) > 1e-6);
  if (wrong.length) {
    await deps.sheets.batchUpdate(c.src.spreadsheetId, c.cells.map(x => ({ range: tab + '!' + letter + x.row, values: [[x.from]] })));
    fail('CHANGED', wrong.length + ' cell(s) did not read back as written, so the original values were put back. Nothing changed.');
  }
  await priv(db, 'dateColumns').set({ columns: { [c.key]: { kind: c.kind, format: FORMATS[c.kind], convertedAt: stamp, convertedBy: email, rows: c.cells.length, backupId: backup.id } } }, { merge: true });
  return { ok: true, message: 'Converted ' + c.cells.length + ' cells in ' + c.alias + ' \u00b7 ' + c.field + ' to ' + c.kind + ' values. Backup kept in the app (' + backup.id + ').' };
}

/* ---------- the ops ---------- */

const OPS = {
  repairEmail: (db, email, input, stamp, d) => repairEmail(db, d), saveRepairEmail,
  repairEmailSendNow: (db, email, input, stamp, d) => repairSweep(db, { force: true, by: email, mailDeps: d.mailDeps }),
  checkinEmail: (db) => checkinEmail(db), saveCheckinEmail,
  checkinEmailNow: async (db, email, input, stamp, d) => Object.assign(await checkinRun(db, { by: email, readMail: d.readMail }), await checkinEmail(db)),
  refreshRates: (db) => refreshRates(db), saveRefreshRate,
  archiveNow: (db, email, input, stamp, d) => archiveCompleted(db, email, { sheets: d.sheets && d.sheets(), liveId: d.liveId }),
  windowTests: (db) => windowTests(db), windowTestLog,
  preflight: (db, email, input, stamp, d) => preflight(db, d),
  updateLive,
  refreshHome: (db, email, input, stamp, d) => refreshHome(db, d),
  plantFresh: (db) => plantFresh(db), plantFreshSet,
  dateInventory: (db, email, input, stamp, d) => dateInventory(db, { sheets: d.sheets && d.sheets(), sources: d.sources }),
  dateSheets: (db, email, input, stamp, d) => dateSheets(db, { sources: d.sources }),
  dateDryRun: (db, email, input, stamp, d) => dateDryRun(db, email, input, stamp, { sheets: d.sheets && d.sheets(), sources: d.sources }),
  dateConvert: (db, email, input, stamp, d) => dateConvert(db, email, input, stamp, { sheets: d.sheets && d.sheets(), sources: d.sources })
};

module.exports = { OPS, repairSweep, sendOneRepair, afterSave, lessorOf, checkinRun, parseCheckinEmail, jobDue, archiveCompleted, preflight, updateLive, toSerial, cellKind, sheetCatalog, JOBS, CHECKIN_STANDARD };

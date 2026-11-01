/*
 * The morning route status email for the salespeople (Joe 10/31): 6:00 AM Monday through Saturday (never Sunday), one line per
 * load: Route (the number only), Run, Status.
 *
 * Which loads: every load of the shift that just ended at the 6 a.m. roll (the operating day before), the same loads Daily
 * Dispatch lists for that load date. Monday's email also carries Saturday's loads, since no email goes out Sunday. Loads marked
 * Ended Up Not Running are left off (Joe: "There's no sense to show it on the list").
 *
 * When a load left (Joe 10/31: "first, let's try the trailer. If not, the tractor associated with that route"; two loads can
 * share a truck): the trailer's GPS first, from its trip (gpsReefer/<trailer>: the trip starts once the load is marked loaded
 * and `out` is the first 5-minute read that saw it out of the yard). Only when the trailer has no GPS unit, the truck's first
 * yard leave (gpsDays yardOut) after the load was loaded.
 *
 * The status (Joe 10/31: "on time if it has left ... not departed if the truck has not departed, or the trailer has not departed,
 * past its dispatch time only ... not loaded if it's not loaded", and "let's put however much time behind it is"):
 *   On time, left 4:05 AM            left by its dispatch time (green)
 *   Left 5:42 AM, 1 hr 12 min late   left after its dispatch time (red)
 *   Not departed, 35 min behind      loaded, past its dispatch time, not left (red)
 *   Not loaded, 20 min behind        not loaded (or still loading), past its dispatch time (red)
 *   Loaded / Not loaded              before its dispatch time (blue / yellow)
 * The dispatch time is when the route leaves (plant-rules departWall: the route's Departure Day and the dispatch time), the same
 * time Loadout and the Late Forecast count from. The GPS is read every 5 minutes, so a leave within LATE_GRACE minutes counts on time.
 *
 * Settings: private/salesRouteEmail { on, to: [addresses] }. Nothing is sent until it is on with at least one address.
 */
'use strict';

const L = require('./logic');
const R = require('./plant-rules');
const { trailerKey } = require('./fleetgps');
const { safeIdPart } = require('./model');

const LATE_GRACE = 5;
const SETTINGS_DOC = 'salesRouteEmail';
const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const text = (v) => (v === null || v === undefined ? '' : String(v).trim());
const dayNum = (key) => { const p = String(key || '').split('-').map(Number); return p.length === 3 && p.every(isFinite) && p[0] ? Math.round(Date.UTC(p[0], p[1] - 1, p[2]) / 86400000) : null; };
const keyOf = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
// 10-8-26
const shortDate = (key) => { const p = String(key || '').split('-'); return p.length === 3 ? Number(p[1]) + '-' + Number(p[2]) + '-' + p[0].slice(2) : text(key); };
const weekdayOf = (key) => { const n = dayNum(key); return n === null ? '' : WEEKDAY[((n % 7) + 11) % 7]; };
// Wall minutes (New York, counted from 1/1/1970) as "4:05 AM".
function clock12(wall) {
  const m = ((wall % 1440) + 1440) % 1440, h = Math.floor(m / 60), mm = m % 60;
  return (h % 12 || 12) + ':' + (mm < 10 ? '0' : '') + mm + ' ' + (h < 12 ? 'AM' : 'PM');
}
// 35 min, 1 hr, 1 hr 12 min
function howLong(minutes) {
  const m = Math.max(0, Math.round(minutes)), h = Math.floor(m / 60), r = m % 60;
  return h ? h + ' hr' + (r ? ' ' + r + ' min' : '') : r + ' min';
}
// A dispatch time as minutes of the day (the runs keep minutes; the sheet can give "4:30" or "4:30 PM"), as plant-rules reads it.
function clockMinutes(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v >= 0 && v < 1 ? Math.round(v * 1440) : v;
  const m = String(v).trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AP]M)?$/i);
  if (!m) return null;
  let h = Number(m[1]);
  const ap = String(m[3] || '').toUpperCase();
  if (ap) { if (h === 12) h = 0; if (ap === 'PM') h += 12; }
  return h * 60 + Number(m[2]);
}
// Letters and digits only, the way the scorecard matches a truck to its GPS unit (sc-core scUnitKey_).
const unitKey = (v) => text(v).toUpperCase().replace(/[^A-Z0-9]/g, '');

function loaded(day) {
  const s = text(day.loadStatus).toUpperCase();
  return !!text(day.completeTime) || day.loadedComplete === true || ['COMPLETE', 'COMPLETED', 'LOADED', 'READY'].indexOf(s) >= 0;
}

// The loads of one load date: Daily Dispatch's (shown on Daily, running that day).
function loadsOn(runs, loadDate) {
  const out = [];
  (runs || []).forEach(run => {
    if (!L.liveFlagShown(run, 'displayDaily', 'daily')) return;
    L.loadBlocksFor(run, loadDate).forEach(b => {
      const day = run.days[b.prefix];
      out.push({ runDocId: run.id, day: b.prefix, route: L.routeNumber(run.route), run: L.runText(run), loadDate, deliveryDate: b.deliveryDate,
        departureDate: text(day.departureDate) || b.deliveryDate, leavesOn: text(run.masterShow && run.masterShow.leavesOn), dispatchTime: day.dispatchTime,
        driver: text(day.driver), truck: text(day.truck) || text(day.truckId), trailer: text(day.trailer) || text(day.trailerId), loaded: loaded(day), completedAt: text(day.completeTime) });
    });
  });
  return out;
}

/*
 * When a load left the yard, as wall minutes, or null. reefer: {trailer: gpsReefer doc}; gpsDays: [{tag, date, yardOut}].
 * Returns { at, by: 'TRAILER' | 'TRUCK' } or { at: null, trailerGps } (trailerGps: the trailer has a GPS unit, so the truck is not used).
 */
function leftAt(x, reefer, gpsDays) {
  const tk = x.trailer ? trailerKey(x.trailer) : '', trip = tk ? (reefer || {})[tk] : null;
  if (trip && text(trip.id) === x.runDocId + '|' + x.day) {
    if (text(trip.out)) return { at: R.wallClock(Date.parse(trip.out)), by: 'TRAILER' };
    if (text(trip.unitId)) return { at: null, trailerGps: true };
  }
  if (!x.loaded) return { at: null };
  const k = unitKey(x.truck);
  if (!k) return { at: null };
  const done = R.wallMinutes(x.completedAt), from = dayNum(x.loadDate);
  const outs = (gpsDays || []).filter(g => unitKey(g.tag) === k && text(g.yardOut) && dayNum(g.date) !== null && dayNum(g.date) >= from)
    .map(g => R.wallClock(Date.parse(g.yardOut))).filter(t => isFinite(t) && (done === null || t >= done)).sort((a, b) => a - b);
  return outs.length ? { at: outs[0], by: 'TRUCK' } : { at: null };
}

// One load's status line at wall minute `now`: { word, tone, late } (tone: ok | late | loaded | waiting).
function statusOf(x, left, now) {
  const leaves = R.departWall({ departureDate: x.departureDate, deliveryDate: x.deliveryDate, loadDate: x.loadDate, leavesOn: x.leavesOn, dispatchTime: clockMinutes(x.dispatchTime) });
  if (left && left.at !== null) {
    const late = leaves === null ? 0 : left.at - leaves;
    const when = clock12(left.at) + (Math.floor(left.at / 1440) !== Math.floor(now / 1440) ? ' ' + weekdayOf(keyOf(Math.floor(left.at / 1440))) : '');
    return late > LATE_GRACE ? { word: 'Left ' + when + ', ' + howLong(late) + ' late', tone: 'late', late } : { word: 'On time, left ' + when, tone: 'ok', late: 0 };
  }
  if (leaves !== null && now > leaves) return { word: (x.loaded ? 'Not departed, ' : 'Not loaded, ') + howLong(now - leaves) + ' behind', tone: 'late', late: now - leaves };
  return x.loaded ? { word: 'Loaded', tone: 'loaded', late: 0 } : { word: 'Not loaded', tone: 'waiting', late: 0 };
}

// The load dates an email at `nowMs` covers: the operating day that just ended; Monday's also covers Saturday's. [] on Sunday.
function coveredDates(nowMs) {
  const today = L.operatingDay(new Date(nowMs + 60000)), ended = L.addDays(today, -1), w = weekdayOf(today);
  if (w === 'Sunday') return [];
  return w === 'Monday' ? [L.addDays(today, -2), ended] : [ended];
}

const byRoute = (a, b) => a.route.localeCompare(b.route, undefined, { numeric: true }) || a.run.localeCompare(b.run, undefined, { numeric: true });

/** The email's rows. input: { runs, reefer, gpsDays }. Returns { today, groups: [{ loadDate, rows: [{route, run, status, tone}] }] }. */
function salesRows(input, nowMs) {
  const now = R.wallClock(nowMs), today = L.operatingDay(new Date(nowMs + 60000));
  const groups = coveredDates(nowMs).map(loadDate => ({
    loadDate,
    rows: loadsOn(input.runs, loadDate).map(x => {
      const s = statusOf(x, leftAt(x, input.reefer, input.gpsDays), now);
      return { route: x.route, run: x.run, status: s.word, tone: s.tone };
    }).sort(byRoute)
  }));
  return { today, groups };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const TONE = { ok: ['#1b7a3a', '#e6f4ea'], late: ['#b3261e', '#fde7e5'], loaded: ['#1d4f91', '#e5eefb'], waiting: ['#8a5a00', '#fff4d6'] };

/** The email itself: { subject, text, html }. */
function salesEmail(data) {
  const day = weekdayOf(data.today) + ' ' + shortDate(data.today);
  const subject = 'Route status for ' + shortDate(data.today) + ' (6:00 AM)';
  const intro = 'Good morning. Here is where every route stands as of 6:00 AM, ' + day + '.';
  const foot = 'The time a load left is when its trailer left the lot, from the trailer\'s GPS (or the truck\'s GPS if the trailer has none). Late and behind are counted from each route\'s dispatch time.';
  const many = data.groups.length > 1, none = !data.groups.some(g => g.rows.length);
  const head = (g) => (many ? 'Loaded ' + weekdayOf(g.loadDate) + ' ' + shortDate(g.loadDate) : '');
  const lines = [intro, ''];
  data.groups.forEach(g => {
    if (!g.rows.length) return;
    if (many) lines.push(head(g));
    g.rows.forEach(r => lines.push(r.route + '  ' + r.run + '  ' + r.status));
    lines.push('');
  });
  if (none) lines.push('No routes ran.', '');
  lines.push(foot);
  const th = (s, w) => '<th style="width:' + w + ';text-align:left;padding:8px 10px;background:#1f3b63;color:#ffffff;font-size:16px">' + s + '</th>';
  const td = (s, x) => '<td style="padding:8px 10px;border-bottom:1px solid #e3e3e3;font-size:16px;' + (x || '') + '">' + s + '</td>';
  const tag = (r) => { const c = TONE[r.tone] || TONE.waiting; return '<span style="display:inline-block;padding:3px 10px;border-radius:12px;background:' + c[1] + ';color:' + c[0] + ';font-weight:700">' + esc(r.status) + '</span>'; };
  let html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;color:#222;max-width:720px">' + '<p style="margin:0 0 12px">' + esc(intro) + '</p>';
  data.groups.forEach(g => {
    if (!g.rows.length) return;
    if (many) html += '<h3 style="margin:16px 0 8px;font-size:18px">' + esc(head(g)) + '</h3>';
    html += '<table style="border-collapse:collapse;width:100%;table-layout:fixed"><tr>' + th('Route', '18%') + th('Run', '37%') + th('Status', 'auto') + '</tr>' +
      g.rows.map(r => '<tr>' + td(esc(r.route), 'font-weight:700') + td(esc(r.run)) + td(tag(r)) + '</tr>').join('') + '</table>';
  });
  if (none) html += '<p>No routes ran.</p>';
  html += '<p style="color:#666;font-size:14px;margin-top:18px">' + esc(foot) + '</p></div>';
  return { subject, text: lines.join('\n'), html };
}

async function settings(db) {
  const d = (await db.collection('private').doc(SETTINGS_DOC).get()).data() || {};
  const { addresses } = require('./mail');
  return { on: d.on === true, to: addresses(d.to || []) };
}

/** Reads what the email needs for `nowMs` (the weeks of the loads, the trailers' trips, the trucks' GPS days). */
async function readInput(db, nowMs) {
  const dates = coveredDates(nowMs);
  if (!dates.length) return { runs: [], reefer: {}, gpsDays: [] };
  const weeks = [...new Set(dates.flatMap(d => [L.weekStart(d), L.weekStart(L.addDays(d, 6))]))];
  const runs = (await db.collection('runs').where('weekStart', 'in', weeks).get()).docs.map(x => Object.assign({ id: x.id }, x.data()));
  const trailers = [...new Set(dates.flatMap(d => loadsOn(runs, d)).map(x => x.trailer ? trailerKey(x.trailer) : '').filter(Boolean))];
  const reefer = {};
  if (trailers.length) (await db.getAll(...trailers.map(t => db.collection('gpsReefer').doc(safeIdPart(t))))).forEach((s, i) => { if (s.exists) reefer[trailers[i]] = s.data(); });
  const from = dates[0], to = L.operatingDay(new Date(nowMs + 60000));
  const gpsDays = (await db.collection('gpsDays').where('date', '>=', from).where('date', '<=', to).get()).docs.map(x => x.data());
  return { runs, reefer, gpsDays };
}

/** The 6:00 AM send. deps: { now, appMail, env } (fakes in the tests). Returns what happened. */
async function sendMorning(db, deps) {
  const d = deps || {}, nowMs = d.now ? d.now() : Date.now();
  if (!coveredDates(nowMs).length) return { status: 'SKIPPED', reason: 'No email on Sunday.' };
  const s = await settings(db);
  if (!s.on) return { status: 'SKIPPED', reason: 'The sales route email is off.' };
  if (!s.to.length) return { status: 'SKIPPED', reason: 'No one is on the sales route email list.' };
  const mail = salesEmail(salesRows(await readInput(db, nowMs), nowMs));
  const appMail = d.appMail || require('./adminmail').appMail;
  return appMail(db, { kind: 'Sales route status', label: shortDate(L.operatingDay(new Date(nowMs + 60000))), by: 'SCHEDULE', to: s.to, subject: mail.subject, text: mail.text, html: mail.html,
    fromName: 'United Dairy Operations' }, d.env ? { env: d.env } : undefined);
}

/* ---------- Administration > Sales Route Email (Joe 10/31: who gets it, On / Off; Off with no one on it to start) ---------- */

const EMAIL = /^[^\s@<>(),;:"\[\]\\]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
class SalesMailError extends Error { constructor(code, message) { super(message); this.code = code; } }

async function adminView(db) {
  const d = (await db.collection('private').doc(SETTINGS_DOC).get()).data() || {};
  const s = await settings(db), mail = await require('./adminmail').emailSettings(db);
  return { on: s.on, to: s.to, sending: mail.sending, changedAt: text(d.changedAt), changedBy: text(d.changedBy) };
}
// input: { on: true|false } or { to: 'a@x.com, b@x.com' }.
async function adminSave(db, email, input, stamp) {
  const { addresses } = require('./mail');
  const ref = db.collection('private').doc(SETTINGS_DOC), patch = { changedAt: stamp, changedBy: email };
  if (input.on !== undefined) patch.on = input.on === true;
  if (input.to !== undefined) {
    const raw = String(input.to || '').split(/[;,\s]+/).map(x => x.trim()).filter(Boolean), bad = raw.filter(a => !EMAIL.test(a));
    if (bad.length) throw new SalesMailError('BAD_REQUEST', 'Not an email address: ' + bad.slice(0, 3).join(', '));
    patch.to = addresses(raw);
  }
  await ref.set(patch, { merge: true });
  const view = await adminView(db);
  return Object.assign(view, { ok: true, message: patch.on === true && !view.to.length ? 'Turned on. Add at least one address so it has someone to go to.' : '' });
}
// Send a test to me: today's email as it would go out at 6:00 AM, only to the person who pressed it.
async function adminTest(db, email, input, stamp, deps) {
  const nowMs = Date.parse(stamp);
  let at = nowMs;
  // On a Sunday (no email) the test shows Monday's: the loads of the weekend.
  if (!coveredDates(at).length) at += 86400000;
  const mail = salesEmail(salesRows(await readInput(db, at), at));
  const appMail = (deps && deps.appMail) || require('./adminmail').appMail;
  const out = await appMail(db, { kind: 'Sales route status', label: 'Test', detail: 'Send a test to me', by: email, to: [email], subject: 'TEST: ' + mail.subject, text: mail.text, html: mail.html,
    fromName: 'United Dairy Operations' }, deps && deps.env ? { env: deps.env } : undefined);
  return { ok: out.status === 'SENT', message: out.status === 'SENT' ? 'Sent to ' + email + '.' : (out.reason || 'The test did not go out.') };
}

module.exports = { unitKey, shortDate, weekdayOf, adminView, adminSave, adminTest, SalesMailError, salesRows, salesEmail, sendMorning, coveredDates, loadsOn, leftAt, statusOf, howLong, clock12, LATE_GRACE, SETTINGS_DOC };

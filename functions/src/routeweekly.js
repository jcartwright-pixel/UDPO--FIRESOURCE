/*
 * Weekly Route Report (Joe 11-6-26: "it pulls in the dollar amount, but it also gave us cases ... Pull all that information
 * out, each customer ... I'm saying to store in there, that way we don't have to continue gathering more data anywhere").
 *
 * MIS (Vicki) emails the Crystal report ROUTE WEEKLY CASE DELIVERY REVIEW BY STORE every week ("Weekly Daily Avg Cases By
 * Route.xls", Gmail label Routes/Sale by Route): for each route, each store's cases on each day Sunday to Saturday, its number
 * of deliveries and its sales. It is read ONCE, here, and each week is kept in routeWeekly/<week ending yyyy-mm-dd> in the
 * company (Uniontown) database, with the fields Route Cost Analysis reads (its HUB-FIELDS.md):
 *   {week_ending, stops: [{route, chain, customer_no, customer, sun..sat, deliveries, net_sales}], routes, stop_count, cases,
 *    net_sales, source: 'EMAIL' | 'BY HAND', received, file, savedAt, savedBy}
 * The Customer List reads these weeks for each customer's LOW / MIDDLE / AVERAGE / HIGH / LAST 5 WEEKS cases, and Pallet
 * Builder holds pallet space from them. A newer file for the same week replaces the older one.
 *
 * The report's columns moved more than once (Joe's July export, the email copy, again on 9-30-26), so the cells of each row are
 * read in order, not by column: a store row is route, chain, customer number, NAME, then 10 numbers (Sun..Sat cases,
 * deliveries, sales, average); the title row carries the week-ending date.
 *
 * Two ways in, on the Hub's Weekly Route Report screen (Administrators), the same as Daily BOL (bol.js):
 *   - Add a file by hand (an older week, like Joe's July export).
 *   - From email: every morning (routeWeeklyMornings) the mailbox set on the screen is read, read only, for messages under the
 *     label with a file attached; each message is read once (routeWeeklyMail/<message id> remembers it). The first check
 *     reaches back 120 days, so the weeks already in the mailbox come in too.
 * Settings: config/routeWeeklyMail {enabled, mailbox, label, sender}. Last run: config/routeWeeklyMailLast.
 */
'use strict';

let XLSX = null;
const excel = () => { if (!XLSX) XLSX = require('@e965/xlsx'); return XLSX; };
const { dayOf, labelQuery } = require('./bol');

const MAX_BYTES = 15 * 1024 * 1024;
const EMAIL = /^[^\s@<>(),;:"[\]\\]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const DEFAULT_LABEL = 'Routes/Sale by Route';
const TITLE = 'ROUTE WEEKLY CASE DELIVERY REVIEW BY STORE';
const FILES = /\.(xlsx?|csv)$/i;
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const fail = (code, message) => require('./admin').fail(code, message);
const isNum = (v) => typeof v === 'number' && isFinite(v);
// Crystal leaves float dust (9e-16 cases) where a day had nothing.
const clean = (v) => Math.round(v * 1e6) / 1e6;

/** Rows (arrays of cell values) -> { week, stops }. A file that is not this report gives { week: '', stops: [] }. */
function reportRows(rows) {
  let week = '';
  const stops = [];
  for (const raw of rows || []) {
    const row = (raw || []).filter(x => x !== '' && x != null).map(x => typeof x === 'string' ? x.trim() : x).filter(x => x !== '');
    if (!row.length) continue;
    const strs = row.filter(x => typeof x === 'string');
    if (strs.some(s => s.toUpperCase().indexOf(TITLE) >= 0)) {
      const n = row.find(isNum), d = row.find(x => x instanceof Date) || row.map(x => dayOf(x)).find(Boolean);
      week = d instanceof Date ? dayOf(d) : (d || (n != null ? dayOf(String(n)) : '')) || week;
      continue;
    }
    if (row.length >= 14 && isNum(row[0]) && isNum(row[1]) && isNum(row[2]) && typeof row[3] === 'string') {
      const n = row.slice(4);
      if (n.length < 10 || !n.slice(0, 10).every(isNum)) continue;
      const s = { route: String(Math.round(row[0])), chain: String(Math.round(row[1])), customer_no: String(Math.round(row[2])), customer: row[3].replace(/\s+/g, ' ') };
      DAYS.forEach((d, i) => { s[d] = clean(n[i]); });
      s.deliveries = clean(n[7]);
      s.net_sales = Math.round(n[8] * 100) / 100;
      stops.push(s);
    }
  }
  return { week, stops };
}

/** Reads one weekly route report (.xls, .xlsx or .csv) -> one week, or none when it is not the report. */
function readReport(buffer, fileName) {
  if (!buffer || !buffer.length) fail('BAD_REQUEST', 'The file is empty');
  if (buffer.length > MAX_BYTES) fail('BAD_REQUEST', 'The file is too big (more than 15 MB)');
  const name = String(fileName || 'file');
  if (!FILES.test(name)) fail('BAD_REQUEST', 'Pick the weekly route report: the Excel file (Weekly Daily Avg Cases By Route.xls)');
  const X = excel();
  let wb;
  try { wb = X.read(buffer, { type: 'buffer', cellDates: true, raw: /\.csv$/i.test(name) }); } catch (e) { fail('BAD_REQUEST', 'Could not open ' + name); }
  let rows = [];
  wb.SheetNames.forEach(tab => { rows = rows.concat(X.utils.sheet_to_json(wb.Sheets[tab], { header: 1, raw: true, defval: '' })); });
  const r = reportRows(rows);
  if (!r.week || !r.stops.length) return { weeks: [] };
  const cases = r.stops.reduce((a, s) => a + DAYS.reduce((b, d) => b + Math.max(0, s[d]), 0), 0);
  return { weeks: [{ week_ending: r.week, stops: r.stops, routes: new Set(r.stops.map(s => s.route)).size, stop_count: r.stops.length,
    cases: Math.round(cases * 10) / 10, net_sales: Math.round(r.stops.reduce((a, s) => a + s.net_sales, 0) * 100) / 100 }] };
}

const dayLabel = (id) => require('./logic').dateText(id);

async function saveWeeks(db, read, how) {
  const saved = [];
  for (const w of read.weeks) {
    await db.collection('routeWeekly').doc(w.week_ending).set(Object.assign({}, w, {
      file: String(how.file || '').slice(0, 120), source: how.source, received: how.received || how.stamp, savedAt: how.stamp, savedBy: how.by
    }));
    saved.push({ week: w.week_ending, label: dayLabel(w.week_ending), routes: w.routes, stops: w.stop_count, cases: w.cases });
  }
  return saved;
}

const settingsRef = (db) => db.collection('config').doc('routeWeeklyMail');
const lastRef = (db) => db.collection('config').doc('routeWeeklyMailLast');
// One week for the screen: its routes with their stores and cases (no sales).
function brief(w) {
  const routes = {};
  (w.stops || []).forEach(s => {
    const r = routes[s.route] = routes[s.route] || { route: s.route, stores: 0, cases: 0, deliveries: 0 };
    r.stores++; r.cases += DAYS.reduce((a, d) => a + Math.max(0, s[d] || 0), 0); r.deliveries += s.deliveries || 0;
  });
  return { week: w.week_ending, stores: w.stop_count, cases: w.cases, file: w.file || '', source: w.source || '', received: w.received || '',
    routes: Object.values(routes).sort((a, b) => Number(a.route) - Number(b.route)).map(r => Object.assign(r, { cases: Math.round(r.cases), deliveries: Math.round(r.deliveries) })) };
}

async function status(db, input) {
  const [s, last, list] = await Promise.all([settingsRef(db).get(), lastRef(db).get(),
    db.collection('routeWeekly').orderBy('week_ending', 'desc').limit(60).get()]);
  const settings = Object.assign({ enabled: false, mailbox: '', label: DEFAULT_LABEL, sender: '' }, s.exists ? s.data() : {});
  const weeks = list.docs.map(d => d.data());
  const want = input && /^\d{4}-\d{2}-\d{2}$/.test(String(input.week || '')) ? input.week : (weeks[0] && weeks[0].week_ending);
  const open = weeks.find(w => w.week_ending === want) || null;
  return { settings: { enabled: !!settings.enabled, mailbox: settings.mailbox || '', label: settings.label || DEFAULT_LABEL, sender: settings.sender || '' },
    last: last.exists ? last.data() : null,
    weeks: weeks.map(w => ({ week: w.week_ending, routes: w.routes, stores: w.stop_count, cases: w.cases, file: w.file || '', source: w.source || '', received: w.received || '' })),
    open: open ? brief(open) : null };
}

async function saveSettings(db, email, input, stamp) {
  const mailbox = String(input.mailbox || '').trim().toLowerCase(), sender = String(input.sender || '').trim().toLowerCase();
  const label = String(input.label == null ? DEFAULT_LABEL : input.label).trim().replace(/\s+/g, ' ').slice(0, 100) || DEFAULT_LABEL;
  if (mailbox && !EMAIL.test(mailbox)) fail('BAD_REQUEST', 'The mailbox is not an email address');
  if (sender && !EMAIL.test(sender) && !/^@?[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(sender)) fail('BAD_REQUEST', 'The sender is not an email address');
  if (input.enabled && !mailbox) fail('BAD_REQUEST', 'Type the mailbox first');
  await settingsRef(db).set({ enabled: !!input.enabled, mailbox, label, sender, savedAt: stamp, savedBy: email });
  return status(db);
}

async function upload(db, email, input, stamp) {
  const name = String(input.fileName || '').slice(0, 120);
  const read = readReport(Buffer.from(String(input.base64 || ''), 'base64'), name);
  if (!read.weeks.length) fail('BAD_REQUEST', 'No stores were found in ' + name + '. Use the ' + TITLE + ' report (Weekly Daily Avg Cases By Route).');
  const saved = await saveWeeks(db, read, { file: name, source: 'BY HAND', stamp, by: email });
  return Object.assign({ saved, file: name }, await status(db, { week: saved[0].week }));
}

/* The email check. deps: readMail, readAttachment (src/mail.js), now. Each message under the label is read once. */
async function checkMail(db, by, deps) {
  const d = deps || {}, now = d.now ? d.now() : new Date(), stamp = now.toISOString();
  const s = (await status(db)).settings;
  const run = { at: stamp, by, status: 'OK', read: 0, saved: 0, skipped: 0, files: [] };
  if (!s.mailbox) { run.status = 'OFF'; run.message = 'No mailbox is set.'; await lastRef(db).set(run); return run; }
  const MAIL = require('./mail');
  const readMail = d.readMail || MAIL.readMail, readAttachment = d.readAttachment || MAIL.readAttachment;
  try {
    const query = labelQuery(s.label) + ' has:attachment newer_than:120d' + (s.sender ? ' from:' + s.sender.replace(/^@/, '') : '');
    const messages = await readMail({ owner: s.mailbox, query, max: 40 });
    // Oldest first, so a resent report for the same week is the one kept.
    for (const m of messages.sort((a, b) => a.internalDate - b.internalDate)) {
      const seen = db.collection('routeWeeklyMail').doc(String(m.id).replace(/[^A-Za-z0-9_-]/g, '_'));
      if ((await seen.get()).exists) { run.skipped++; continue; }
      const files = (m.files || []).filter(f => FILES.test(f.name) && f.size <= MAX_BYTES);
      const found = [];
      const received = new Date(m.internalDate || now).toISOString();
      for (const f of files) {
        run.read++;
        try {
          const buf = await readAttachment({ owner: s.mailbox, messageId: m.id, attachmentId: f.attachmentId });
          const read = readReport(buf, f.name);
          if (!read.weeks.length) { found.push({ name: f.name, weeks: 0 }); continue; }
          const saved = await saveWeeks(db, read, { file: f.name, source: 'EMAIL', received, stamp, by: 'email:' + s.mailbox });
          run.saved += saved.length;
          found.push({ name: f.name, weeks: saved.length, newest: saved[0].label, stores: saved[0].stops });
        } catch (e) { found.push({ name: f.name, error: String(e.message || e).slice(0, 200) }); }
      }
      run.files.push(...found.map(x => Object.assign({ received }, x)));
      if (found.some(x => x.error)) { run.status = 'FAIL'; continue; }
      await seen.set({ at: stamp, subject: String(m.subject || '').slice(0, 200), from: String(m.from || '').slice(0, 120), files: found });
    }
    const got = run.files.filter(f => f.newest);
    const bad = run.files.find(f => f.error);
    run.message = bad ? 'Could not read ' + bad.name + ': ' + bad.error
      : got.length ? 'Read ' + got.length + (got.length === 1 ? ' week' : ' weeks') + ', newest week ending ' + got[got.length - 1].newest + '.'
        : run.files.length ? 'No stores in the new file.' : 'No new weekly report.';
  } catch (e) {
    run.status = 'FAIL';
    run.message = e.code === 'NOT_DELEGATED'
      ? 'Google Workspace has not yet let the app read this mailbox. IT adds the scope https://www.googleapis.com/auth/gmail.readonly to the app\'s domain-wide delegation (same Client ID as email sending).'
      : String(e.message || e).slice(0, 300);
  }
  await lastRef(db).set(run);
  return run;
}

// The scheduled check: only when it is switched on.
async function morningCheck(db, deps) {
  const s = (await status(db)).settings;
  if (!s.enabled) return { skipped: 'off' };
  return checkMail(db, 'every morning', deps);
}

// Administration steps (src/admin.js): Administrators only, checked there. Company-wide (Uniontown's database).
const OPS = {
  routeWeeklyStatus: (db, email, input) => status(db, input),
  routeWeeklySaveSettings: (db, email, input, stamp) => saveSettings(db, email, input, stamp),
  routeWeeklyUpload: (db, email, input, stamp) => upload(db, email, input, stamp),
  routeWeeklyCheckNow: async (db, email, input, stamp, d) => Object.assign({ run: await checkMail(db, email, d) }, await status(db))
};

module.exports = { OPS, readReport, reportRows, status, checkMail, morningCheck, DEFAULT_LABEL, TITLE, DAYS };

/*
 * Weekly route report (Joe 11-6-26: "material for the route cost analysis"). Vicki's Wednesday email "Weekly Daily Avg
 * Cases by Route By Store" carries the Crystal report ROUTE WEEKLY CASE DELIVERY REVIEW BY STORE (.xls): each stop's cases
 * Sunday to Saturday, deliveries and sales for one week. The Hub reads it once, here, and keeps each week in
 * routeWeeks/<week ending yyyy-mm-dd> in the company (Uniontown) database. The Route Cost Analysis app reads the weeks from
 * there (read only), so nobody has to save the files and run a script by hand. Nothing else writes them.
 *
 * Two ways in, both on the Hub's Accounting Numbers screen (Administrators), next to the accounting zip:
 *   - Add a file by hand: one weekly report .xls, or one Daily Load By Route PDF (the BOL, src/dailyloads.js).
 *   - From email: once a day (routeReportMail, 5:00 PM) the mailbox set on the screen is read, read only (gmail.readonly,
 *     the same Google Workspace permission as the accounting zip), for messages with the Gmail label set there (Joe's is
 *     ROUTES/SALE BY ROUTE) and an .xls attached, and with the BOL label (ROUTES/BOL) and a PDF attached; each message is read once (routeReportMail/<message id> remembers it).
 * A report whose stops do not add up to its own route totals is not saved (the screen says which route).
 * Settings: config/routeReportMail {enabled, mailbox, label}. Last run: config/routeReportMailLast.
 * The reader follows the Route Cost Analysis repository's scripts/parse_route_report.py: cells are read in order, not by
 * column, because the report's columns have moved more than once.
 */
'use strict';

let XLSX = null;
const reader = () => { if (!XLSX) XLSX = require('@e965/xlsx'); return XLSX; };

const TITLE = 'ROUTE WEEKLY CASE DELIVERY REVIEW BY STORE';
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MAX_BYTES = 10 * 1024 * 1024;
const EMAIL = /^[^\s@<>(),;:"[\]\\]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const DEFAULT_LABEL = 'ROUTES/SALE BY ROUTE';
const DEFAULT_BOL_LABEL = 'ROUTES/BOL';
const LOADS = require('./dailyloads');

const fail = (code, message) => require('./admin').fail(code, message);
const isNum = (v) => typeof v === 'number' && isFinite(v);
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;

// An Excel date number as yyyy-mm-dd (the report's week-ending date).
function excelDay(n) {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 864e5);
  return d.toISOString().slice(0, 10);
}
const shortDay = (v) => require('./logic').dateText(v);

function rec(nums) {
  const r = {};
  DAYS.forEach((d, i) => { r[d] = nums[i]; });
  r.deliveries = nums[7]; r.net_sales = nums[8];
  return r;
}

/** Reads one report .xls / .xlsx: {week_ending, stops: [...], totals: [...]}; throws (BAD_REQUEST) in plain words. */
function readReport(buffer, fileName) {
  if (!buffer || !buffer.length) fail('BAD_REQUEST', 'The file is empty');
  if (buffer.length > MAX_BYTES) fail('BAD_REQUEST', 'The file is too big (more than 10 MB)');
  const name = String(fileName || 'file');
  if (!/\.xlsx?$/i.test(name)) fail('BAD_REQUEST', 'Pick the weekly route report (.xls)');
  let wb;
  try { wb = reader().read(buffer, { type: 'buffer', cellDates: false }); } catch (e) { fail('BAD_REQUEST', name + ' is not an Excel file'); }
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '', blankrows: true })
    .map(row => row.filter(x => x !== '' && x != null));
  const stops = [], totals = [];
  let week = null;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row.length) continue;
    const strs = row.filter(x => typeof x === 'string').map(x => x.trim());
    const nums = row.filter(isNum);
    if (strs.indexOf(TITLE) >= 0) {
      if (!nums.length) fail('BAD_REQUEST', name + ': no week-ending date on the title line');
      week = excelDay(nums[0]); continue;
    }
    if (strs.length && strs[0].indexOf('TOTALS FOR ROUTE') === 0) {
      const m = strs[0].match(/(\d+)/);
      let n = nums.slice();
      const route = m ? Number(m[1]) : n.shift();
      if (n.length < 10) { const next = rows.slice(i + 1).find(r => r.length); n = next ? next.filter(isNum) : []; }
      if (n.length !== 10) fail('BAD_REQUEST', name + ': the total line for route ' + route + ' does not have its 10 numbers');
      totals.push(Object.assign({ route }, rec(n))); continue;
    }
    // A stop line: route, chain, customer number, the name, then 10 numbers (Sun..Sat cases, deliveries, sales, average).
    if (row.length >= 14 && isNum(row[0]) && isNum(row[1]) && isNum(row[2]) && typeof row[3] === 'string') {
      const n = row.slice(4);
      if (n.length !== 10 || !n.every(isNum)) fail('BAD_REQUEST', name + ': a stop line for route ' + row[0] + ' does not have its 10 numbers');
      stops.push(Object.assign({ route: Math.round(row[0]), chain: Math.round(row[1]), customer_no: Math.round(row[2]), customer: row[3].trim() }, rec(n)));
    }
  }
  if (!week || !stops.length) fail('BAD_REQUEST', name + ' is not the weekly route report (' + TITLE + ')');
  return { week_ending: week, stops, totals };
}

/** The stops of each route must add up to the report's own total line for it. Returns the routes that do not. */
function checkTotals(read) {
  const bad = [];
  for (const t of read.totals) {
    const s = read.stops.filter(x => x.route === t.route);
    const cases = (rows) => rows.reduce((a, r) => a + DAYS.reduce((b, d) => b + r[d], 0), 0);
    const sum = (f) => s.reduce((a, r) => a + r[f], 0);
    if (Math.abs(cases(s) - cases([t])) > 0.01 || Math.abs(sum('deliveries') - t.deliveries) > 0.01 || Math.abs(sum('net_sales') - t.net_sales) > 0.05) bad.push(t.route);
  }
  return bad;
}

/** Saves one week. A week already saved is replaced only when the file's stops differ. */
async function saveWeek(db, read, how) {
  const bad = checkTotals(read);
  if (bad.length) fail('BAD_REQUEST', 'The report for the week ending ' + shortDay(read.week_ending) + ' does not add up for route ' + bad.slice(0, 5).join(', ') + ', so it was not saved');
  const stops = read.stops.map(s => {
    const o = { route: s.route, chain: s.chain, customer_no: s.customer_no, customer: s.customer };
    DAYS.forEach(d => { o[d] = r3(s[d]); });
    o.deliveries = r3(s.deliveries); o.net_sales = r2(s.net_sales);
    return o;
  });
  const ref = db.collection('routeWeeks').doc(read.week_ending);
  const old = await ref.get();
  const same = old.exists && JSON.stringify(old.data().stops) === JSON.stringify(stops);
  const cases = r3(stops.reduce((a, s) => a + DAYS.reduce((b, d) => b + s[d], 0), 0));
  const routes = new Set(stops.map(s => s.route)).size;
  if (!same) {
    await ref.set({ week_ending: read.week_ending, stops, routes, cases, net_sales: r2(stops.reduce((a, s) => a + s.net_sales, 0)),
      file: String(how.file || '').slice(0, 120), source: how.source, received: how.received || how.stamp, savedAt: how.stamp, savedBy: how.by });
  }
  return { week: read.week_ending, weekText: shortDay(read.week_ending), changed: !same, stops: stops.length, routes };
}

const settingsRef = (db) => db.collection('config').doc('routeReportMail');
const lastRef = (db) => db.collection('config').doc('routeReportMailLast');

async function status(db) {
  const [s, last, list] = await Promise.all([settingsRef(db).get(), lastRef(db).get(),
    db.collection('routeWeeks').select('week_ending', 'routes', 'cases', 'net_sales', 'file', 'source', 'savedAt').get()]);
  const st = Object.assign({ enabled: false, mailbox: '', label: DEFAULT_LABEL, bolLabel: DEFAULT_BOL_LABEL }, s.exists ? s.data() : {});
  return { settings: { enabled: !!st.enabled, mailbox: st.mailbox || '', label: st.label || DEFAULT_LABEL, bolLabel: st.bolLabel || DEFAULT_BOL_LABEL },
    last: last.exists ? last.data() : null,
    weeks: list.docs.map(d => d.data()).sort((a, b) => a.week_ending < b.week_ending ? 1 : -1).slice(0, 20),
    days: await LOADS.recentDays(db) };
}

async function saveSettings(db, email, input, stamp) {
  const mailbox = String(input.mailbox || '').trim().toLowerCase(), label = String(input.label || '').trim().slice(0, 100) || DEFAULT_LABEL;
  const bolLabel = String(input.bolLabel || '').trim().slice(0, 100) || DEFAULT_BOL_LABEL;
  if (mailbox && !EMAIL.test(mailbox)) fail('BAD_REQUEST', 'The mailbox is not an email address');
  if (input.enabled && !mailbox) fail('BAD_REQUEST', 'Type the mailbox first');
  await settingsRef(db).set({ enabled: !!input.enabled, mailbox, label, bolLabel, savedAt: stamp, savedBy: email });
  return status(db);
}

async function upload(db, email, input, stamp) {
  const name = String(input.fileName || '').slice(0, 120);
  const saved = await readAndSave(db, Buffer.from(String(input.base64 || ''), 'base64'), name, { file: name, source: 'BY HAND', stamp, by: email });
  return Object.assign({ saved, file: name }, await status(db));
}

// One file of either report: the weekly route report (.xls) or the daily load by route (BOL, .pdf).
async function readAndSave(db, buf, name, how) {
  if (/\.pdf$/i.test(name)) return Object.assign({ kind: 'bol' }, await LOADS.saveLoadDay(db, await LOADS.readLoadPdf(buf, name), how));
  if (!/\.xlsx?$/i.test(name)) fail('BAD_REQUEST', 'Pick the weekly route report (.xls) or the Daily Load By Route PDF');
  return Object.assign({ kind: 'week' }, await saveWeek(db, readReport(buf, name), how));
}

// Gmail's search words for a label: "ROUTES/SALE BY ROUTE" is label:routes-sale-by-route.
const labelQuery = (label) => 'label:' + String(label || DEFAULT_LABEL).trim().toLowerCase().replace(/[\s/]+/g, '-').replace(/[^a-z0-9&_.-]/g, '');

/*
 * The email check. deps: readMail, readAttachment (src/mail.js), now. Reads the last 60 days of labelled messages with a
 * file attached; a message already read is skipped, one that could not be read is tried again next time.
 */
async function checkMail(db, by, deps) {
  const d = deps || {}, now = d.now ? d.now() : new Date(), stamp = now.toISOString();
  const s = (await status(db)).settings;
  const run = { at: stamp, by, status: 'OK', read: 0, saved: 0, skipped: 0, files: [] };
  if (!s.mailbox) { run.status = 'OFF'; run.message = 'No mailbox is set.'; await lastRef(db).set(run); return run; }
  const MAIL = require('./mail');
  const readMail = d.readMail || MAIL.readMail, readAttachment = d.readAttachment || MAIL.readAttachment;
  try {
    const weekly = await readMail({ owner: s.mailbox, query: labelQuery(s.label) + ' has:attachment newer_than:60d', max: 30 });
    const bol = await readMail({ owner: s.mailbox, query: labelQuery(s.bolLabel) + ' has:attachment filename:pdf newer_than:14d', max: 20 });
    const byId = new Map();
    weekly.concat(bol).forEach(m => byId.set(m.id, m));
    for (const m of [...byId.values()].sort((a, b) => a.internalDate - b.internalDate)) {
      const seen = db.collection('routeReportMail').doc(String(m.id).replace(/[^A-Za-z0-9_-]/g, '_'));
      if ((await seen.get()).exists) { run.skipped++; continue; }
      const received = new Date(m.internalDate || now).toISOString();
      const found = [];
      for (const f of (m.files || []).filter(x => /\.(xlsx?|pdf)$/i.test(x.name) && x.size <= 15 * 1024 * 1024)) {
        run.read++;
        try {
          const buf = await readAttachment({ owner: s.mailbox, messageId: m.id, attachmentId: f.attachmentId });
          const saved = await readAndSave(db, buf, f.name, { file: f.name, source: 'EMAIL ' + shortDay(new Date(m.internalDate || now)), received, stamp, by: 'email:' + s.mailbox });
          if (saved.changed) run.saved++;
          found.push(saved.kind === 'bol' ? { name: f.name, day: saved.date, changed: saved.changed, lines: saved.lines } : { name: f.name, week: saved.week, changed: saved.changed, stops: saved.stops });
        } catch (e) { found.push({ name: f.name, error: String(e.message || e).slice(0, 200) }); }
      }
      run.files.push(...found.map(x => Object.assign({ received }, x)));
      if (found.some(x => x.error)) { run.status = 'FAIL'; continue; }
      await seen.set({ at: stamp, subject: String(m.subject || '').slice(0, 200), from: String(m.from || '').slice(0, 120), files: found });
    }
    const newest = run.files.filter(f => f.week).map(f => f.week).sort().pop();
    const newestDay = run.files.filter(f => f.day).map(f => f.day).sort().pop();
    const bad = run.files.find(f => f.error);
    run.message = bad ? 'Could not read ' + bad.name + ': ' + bad.error
      : run.files.length ? run.files.length + ' new report' + (run.files.length === 1 ? '' : 's') + ' read' + (newest ? '; newest week ending ' + shortDay(newest) : '') + (newestDay ? '; newest daily load ' + shortDay(newestDay) : '') + '.'
        : 'No new route report.';
  } catch (e) {
    run.status = 'FAIL';
    run.message = e.code === 'NOT_DELEGATED'
      ? 'Google Workspace has not yet let the app read this mailbox. IT adds the scope https://www.googleapis.com/auth/gmail.readonly to the app\'s domain-wide delegation (same Client ID as email sending).'
      : String(e.message || e).slice(0, 300);
  }
  await lastRef(db).set(run);
  return run;
}

async function dailyCheck(db, deps) {
  const s = (await status(db)).settings;
  if (!s.enabled) return { skipped: 'off' };
  return checkMail(db, 'every day', deps);
}

// Administration steps (src/admin.js): Administrators only, checked there. Company-wide (Uniontown's database).
const OPS = {
  routeReportStatus: (db) => status(db),
  routeReportSaveSettings: (db, email, input, stamp) => saveSettings(db, email, input, stamp),
  routeReportUpload: (db, email, input, stamp) => upload(db, email, input, stamp),
  routeReportCheckNow: async (db, email, input, stamp, d) => Object.assign({ run: await checkMail(db, email, d) }, await status(db))
};

module.exports = { OPS, readAndSave, readReport, checkTotals, saveWeek, status, checkMail, dailyCheck, labelQuery, DAYS, TITLE };

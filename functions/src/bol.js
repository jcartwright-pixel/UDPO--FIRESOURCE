/*
 * Daily BOL (Joe 11-6-26: "it needs to come through the centralized hub app ... I am getting BOL sent daily, and it'll be in
 * my folder under the label routes, and then sub folder is BOL").
 *
 * The office sends the "Daily Load By Route" every afternoon (a PDF from their order system, "Daily Load UT.pdf"): one line
 * per product on each customer's order, with LoadDate, RtNo, LoadSeq, CusChn, CusNo, CusName, ItemNo, Descrip and Qty.
 * It is read ONCE, here, and each load day is kept in bolDays/<yyyy-mm-dd> in the company (Uniontown) database:
 *   {date, file, source: 'EMAIL' | 'BY HAND', received, savedAt, savedBy, totals: {routes, stops, lines, qty},
 *    routes: [{route, stops: [{seq, chain, custNo, name, lines: [{item, desc, qty}], qty}], qty, lines}]}
 * A newer file for the same load day replaces the older one (more orders are keyed during the day).
 *
 * Two ways in, both on the Hub's Daily BOL screen (Administrators), the same as Accounting Numbers (accounting.js):
 *   - Add a file by hand: the PDF (or the same columns as an Excel or CSV file) is sent and read here.
 *   - From email: every hour (bolMailHourly) the mailbox set on the screen is read, read only (gmail.readonly), for
 *     messages under the Gmail label set there (ROUTES/BOL) with a file attached; each message is read once
 *     (bolMail/<message id> remembers it).
 * Settings: config/bolMail {enabled, mailbox, label, sender}. Last run: config/bolMailLast.
 */
'use strict';

const { pdfLines } = require('./bol-pdf');
let XLSX = null;
const excel = () => { if (!XLSX) XLSX = require('@e965/xlsx'); return XLSX; };

const MAX_BYTES = 15 * 1024 * 1024;
const EMAIL = /^[^\s@<>(),;:"[\]\\]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const DEFAULT_LABEL = 'ROUTES/BOL';
const FILES = /\.(pdf|xlsx?|csv)$/i;

const fail = (code, message) => require('./admin').fail(code, message);

// The report's columns, by the words in its header line (a few other spellings, for an Excel copy of the same report).
const COLUMNS = [
  ['date', /^(load ?date|date)$/],
  ['route', /^(rt ?no|route|rt|route ?no)$/],
  ['seq', /^(load ?seq|seq|load ?sequence)$/],
  ['chain', /^(cus ?chn|chain)$/],
  ['custNo', /^(cus ?no|customer ?no|cust ?no|customer ?#)$/],
  ['name', /^(cus ?name|customer|customer ?name|name)$/],
  ['item', /^(item ?no|item|item ?#|product)$/],
  ['desc', /^(descrip|description|desc)$/],
  ['qty', /^(qty|quantity|units)$/]
];
const keyOf = (word) => { const w = String(word || '').trim().toLowerCase().replace(/[._]/g, ' ').replace(/\s+/g, ' '); const c = COLUMNS.find(([, re]) => re.test(w)); return c ? c[0] : null; };

// 11/06/2026, 11/6/26, 2026-11-06 or an Excel date -> 2026-11-06.
function dayOf(v) {
  if (v instanceof Date && !isNaN(v)) return v.getFullYear() + '-' + String(v.getMonth() + 1).padStart(2, '0') + '-' + String(v.getDate()).padStart(2, '0');
  const s = String(v == null ? '' : v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
  if (m) return (m[3].length === 2 ? '20' + m[3] : m[3]) + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0');
  if (/^\d{5}(\.\d+)?$/.test(s)) { const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86400000); return d.toISOString().slice(0, 10); }
  return '';
}
const text = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
const num = (v) => { const n = Number(String(v == null ? '' : v).replace(/,/g, '').trim()); return isFinite(n) ? n : NaN; };

/*
 * Lines -> order lines. `lines` are [[{x, text}] or [text]]: the header line says which column is which; a PDF cell is put in
 * the column whose header it sits under (cells are lined up under, or a little left of, their header).
 */
function orderLines(lines) {
  let head = null;
  const out = [];
  for (const raw of lines) {
    const cells = raw.map(c => (c && typeof c === 'object' && !(c instanceof Date)) ? c : { text: c });
    const keys = cells.map(c => keyOf(c.text));
    if (keys.filter(Boolean).length >= 5 && keys.indexOf('route') >= 0 && keys.indexOf('item') >= 0 && keys.indexOf('qty') >= 0) {
      head = cells.map((c, i) => ({ key: keys[i], x: c.x }));
      continue;
    }
    if (!head) continue;
    const row = {};
    if (cells.length === head.length || head.some(h => h.x == null) || cells.some(c => c.x == null)) {
      cells.forEach((c, i) => { if (head[i] && head[i].key) row[head[i].key] = c.text; });
    } else {
      // Under the header whose middle-point to the next header is past the cell's left edge.
      cells.forEach(c => {
        let i = 0;
        while (i < head.length - 1 && c.x >= (head[i].x + head[i + 1].x) / 2) i++;
        const k = head[i].key;
        if (k) row[k] = row[k] != null ? row[k] + ' ' + c.text : c.text;
      });
    }
    const date = dayOf(row.date), route = text(row.route).replace(/\.0+$/, ''), qty = num(row.qty);
    if (!date || !route || !text(row.item) || isNaN(qty)) continue;
    out.push({ date, route, seq: isNaN(num(row.seq)) ? null : num(row.seq), chain: text(row.chain).replace(/\.0+$/, ''), custNo: text(row.custNo).replace(/\.0+$/, ''), name: text(row.name), item: text(row.item).replace(/\.0+$/, ''), desc: text(row.desc), qty });
  }
  return out;
}

// Order lines -> one day per load date, routes in number order, stops in the order the file lists them.
function groupDays(rows) {
  const days = {};
  rows.forEach(r => {
    const d = days[r.date] = days[r.date] || { date: r.date, routes: {} };
    const rt = d.routes[r.route] = d.routes[r.route] || { route: r.route, stops: [], byCust: {} };
    const key = r.custNo + '|' + r.name;
    let st = rt.byCust[key];
    if (!st) { st = rt.byCust[key] = { seq: r.seq, chain: r.chain, custNo: r.custNo, name: r.name, lines: [], qty: 0 }; rt.stops.push(st); }
    st.lines.push({ item: r.item, desc: r.desc, qty: r.qty });
    st.qty += r.qty;
  });
  const routeOrder = (a, b) => (Number(a.route) || 1e9) - (Number(b.route) || 1e9) || a.route.localeCompare(b.route);
  return Object.keys(days).sort().map(k => {
    const routes = Object.values(days[k].routes).sort(routeOrder).map(rt => ({
      route: rt.route, stops: rt.stops, qty: rt.stops.reduce((a, s) => a + s.qty, 0), lines: rt.stops.reduce((a, s) => a + s.lines.length, 0)
    }));
    return { date: k, routes, totals: {
      routes: routes.length, stops: routes.reduce((a, r) => a + r.stops.length, 0),
      lines: routes.reduce((a, r) => a + r.lines, 0), qty: routes.reduce((a, r) => a + r.qty, 0) } };
  });
}

/** Reads one BOL file (PDF, Excel or CSV) and returns {days: [...]}; a file with no BOL lines gives no days. */
function readBol(buffer, fileName) {
  if (!buffer || !buffer.length) fail('BAD_REQUEST', 'The file is empty');
  if (buffer.length > MAX_BYTES) fail('BAD_REQUEST', 'The file is too big (more than 15 MB)');
  const name = String(fileName || 'file');
  let lines = [];
  if (/\.pdf$/i.test(name) || buffer.toString('latin1', 0, 5) === '%PDF-') lines = pdfLines(buffer);
  else if (/\.(xlsx?|csv)$/i.test(name)) {
    const X = excel();
    let wb;
    try { wb = X.read(buffer, { type: 'buffer', cellDates: true, raw: /\.csv$/i.test(name) }); } catch (e) { fail('BAD_REQUEST', 'Could not open ' + name); }
    wb.SheetNames.forEach(tab => { lines = lines.concat(X.utils.sheet_to_json(wb.Sheets[tab], { header: 1, raw: true, defval: '' })); });
  } else fail('BAD_REQUEST', 'Pick the BOL: the PDF, or an Excel or CSV file');
  return { days: groupDays(orderLines(lines)) };
}

const dayLabel = (id) => require('./logic').dateText(id);

async function saveDays(db, read, how) {
  const saved = [];
  for (const day of read.days) {
    await db.collection('bolDays').doc(day.date).set(Object.assign({}, day, {
      file: String(how.file || '').slice(0, 120), source: how.source, received: how.received || how.stamp, savedAt: how.stamp, savedBy: how.by
    }));
    saved.push({ date: day.date, label: dayLabel(day.date), routes: day.totals.routes, stops: day.totals.stops });
  }
  return saved;
}

const settingsRef = (db) => db.collection('config').doc('bolMail');
const lastRef = (db) => db.collection('config').doc('bolMailLast');
const brief = (d) => ({ date: d.date, totals: d.totals, file: d.file || '', source: d.source || '', received: d.received || '', savedAt: d.savedAt || '',
  routes: (d.routes || []).map(r => ({ route: r.route, lines: r.lines, qty: r.qty,
    stops: (r.stops || []).map(st => ({ seq: st.seq, custNo: st.custNo, name: st.name, lines: st.lines.length, qty: st.qty })) })) });

async function status(db, input) {
  const [s, last, list] = await Promise.all([settingsRef(db).get(), lastRef(db).get(),
    db.collection('bolDays').orderBy('date', 'desc').limit(21).get()]);
  const settings = Object.assign({ enabled: false, mailbox: '', label: DEFAULT_LABEL, sender: '' }, s.exists ? s.data() : {});
  const days = list.docs.map(d => d.data());
  const want = input && /^\d{4}-\d{2}-\d{2}$/.test(String(input.date || '')) ? input.date : (days[0] && days[0].date);
  let open = days.find(d => d.date === want) || null;
  if (!open && want) { const one = await db.collection('bolDays').doc(want).get(); open = one.exists ? one.data() : null; }
  return { settings: { enabled: !!settings.enabled, mailbox: settings.mailbox || '', label: settings.label || DEFAULT_LABEL, sender: settings.sender || '' },
    last: last.exists ? last.data() : null,
    days: days.map(d => ({ date: d.date, totals: d.totals, file: d.file || '', source: d.source || '', received: d.received || '' })),
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
  const read = readBol(Buffer.from(String(input.base64 || ''), 'base64'), name);
  if (!read.days.length) fail('BAD_REQUEST', 'No BOL lines were found in ' + name + '. Use the Daily Load By Route file (LoadDate, RtNo, CusName, ItemNo, Qty).');
  const saved = await saveDays(db, read, { file: name, source: 'BY HAND', stamp, by: email });
  return Object.assign({ saved, file: name }, await status(db, { date: saved[saved.length - 1].date }));
}

// Gmail's search words for a label: "ROUTES/BOL" -> label:routes-bol.
const labelQuery = (label) => 'label:' + String(label || DEFAULT_LABEL).trim().toLowerCase().replace(/[\s/]+/g, '-').replace(/[^a-z0-9&_.-]/g, '');

/*
 * The email check. deps: readMail, readAttachment (src/mail.js), now. Reads the last 10 days of messages under the label with
 * a file attached (only from the sender, when one is set); a message already read is skipped.
 */
async function checkMail(db, by, deps) {
  const d = deps || {}, now = d.now ? d.now() : new Date(), stamp = now.toISOString();
  const s = (await status(db)).settings;
  const run = { at: stamp, by, status: 'OK', read: 0, saved: 0, skipped: 0, files: [] };
  if (!s.mailbox) { run.status = 'OFF'; run.message = 'No mailbox is set.'; await lastRef(db).set(run); return run; }
  const MAIL = require('./mail');
  const readMail = d.readMail || MAIL.readMail, readAttachment = d.readAttachment || MAIL.readAttachment;
  try {
    const query = labelQuery(s.label) + ' has:attachment newer_than:10d' + (s.sender ? ' from:' + s.sender.replace(/^@/, '') : '');
    const messages = await readMail({ owner: s.mailbox, query, max: 30 });
    // Oldest first, so the newest file for a load day is the one kept.
    for (const m of messages.sort((a, b) => a.internalDate - b.internalDate)) {
      const seen = db.collection('bolMail').doc(String(m.id).replace(/[^A-Za-z0-9_-]/g, '_'));
      if ((await seen.get()).exists) { run.skipped++; continue; }
      const files = (m.files || []).filter(f => FILES.test(f.name) && f.size <= MAX_BYTES);
      const found = [];
      const received = new Date(m.internalDate || now).toISOString();
      for (const f of files) {
        run.read++;
        try {
          const buf = await readAttachment({ owner: s.mailbox, messageId: m.id, attachmentId: f.attachmentId });
          const read = readBol(buf, f.name);
          if (!read.days.length) { found.push({ name: f.name, days: 0 }); continue; }
          const saved = await saveDays(db, read, { file: f.name, source: 'EMAIL', received, stamp, by: 'email:' + s.mailbox });
          run.saved += saved.length;
          found.push({ name: f.name, days: saved.length, newest: saved[saved.length - 1].label, routes: saved[saved.length - 1].routes });
        } catch (e) { found.push({ name: f.name, error: String(e.message || e).slice(0, 200) }); }
      }
      run.files.push(...found.map(x => Object.assign({ received }, x)));
      // A file Gmail or the reader could not finish is tried again next time.
      if (found.some(x => x.error)) { run.status = 'FAIL'; continue; }
      await seen.set({ at: stamp, subject: String(m.subject || '').slice(0, 200), from: String(m.from || '').slice(0, 120), files: found });
    }
    const newest = run.files.filter(f => f.newest).pop();
    const bad = run.files.find(f => f.error);
    run.message = bad ? 'Could not read ' + bad.name + ': ' + bad.error
      : newest ? 'Read ' + newest.name + ': load day ' + newest.newest + ', ' + newest.routes + ' routes.'
        : run.files.length ? 'No BOL lines in the new file.' : 'No new BOL.';
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
async function hourlyCheck(db, deps) {
  const s = (await status(db)).settings;
  if (!s.enabled) return { skipped: 'off' };
  return checkMail(db, 'every hour', deps);
}

// Administration steps (src/admin.js): Administrators only, checked there. Company-wide (Uniontown's database).
const OPS = {
  bolStatus: (db, email, input) => status(db, input),
  bolSaveSettings: (db, email, input, stamp) => saveSettings(db, email, input, stamp),
  bolUpload: (db, email, input, stamp) => upload(db, email, input, stamp),
  bolCheckNow: async (db, email, input, stamp, d) => Object.assign({ run: await checkMail(db, email, d) }, await status(db))
};

// Joe 11-7-26: the newest load days for the apps (Pallet Builder), read by the server for anyone signed in, so a screen gets them
// even when it cannot read the list itself. Only what the screens use: the date, when it came, and each route's customers.
async function recentDays(db, max) {
  const snap = await db.collection('bolDays').orderBy('date', 'desc').limit(Math.max(1, Math.min(21, Number(max) || 14))).get();
  const str = (v) => (v && typeof v.toDate === 'function') ? v.toDate().toISOString() : (v instanceof Date ? v.toISOString() : String(v || ''));
  return snap.docs.map(d => d.data()).filter(d => d && /^\d{4}-\d{2}-\d{2}$/.test(String(d.date || ''))).map(d => ({
    date: d.date, received: str(d.received), savedAt: str(d.savedAt),
    routes: (d.routes || []).map(r => ({ route: String(r.route), stops: (r.stops || []).map(st => ({ seq: st.seq == null ? null : st.seq, custNo: String(st.custNo || ''), name: String(st.name || ''),
      lines: (st.lines || []).map(l => ({ item: String(l.item || ''), qty: Number(l.qty) || 0 })) })) })) }));
}

/*
 * Joe 11-8-26 (live Pallet Builder said THE HUB HAS NO BOL DAYS YET while a Hub showed Friday 11-6-26): with the days, the
 * last email check on this app's Hub and whether a mailbox is set, so an empty list says plainly whether this app's Hub was
 * ever checked (a Hub on the practice copy keeps its own BOL days).
 */
async function hubCheck(db) {
  const [s, last] = await Promise.all([settingsRef(db).get(), lastRef(db).get()]);
  const st = s.exists ? s.data() : {}, l = last.exists ? last.data() : null;
  return { mailbox: !!st.mailbox, enabled: !!st.enabled, last: l ? { at: String(l.at || ''), status: String(l.status || ''), message: String(l.message || '').slice(0, 200) } : null };
}

module.exports = { OPS, recentDays, hubCheck, readBol, orderLines, groupDays, dayOf, labelQuery, status, checkMail, hourlyCheck, DEFAULT_LABEL };

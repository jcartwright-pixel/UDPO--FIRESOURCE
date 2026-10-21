/*
 * Joe 10/18 (screen speed: "the bigger the file, I don't want it to start getting slower"): the write-ups (maintenance) a
 * screen needs, instead of every write-up ever made. The open-issue screens (Fleet & Maintenance, Equipment Issues) show the
 * open write-ups, count repeats over 90 days before each one, and count repairs in the last 30 days (L.issueRows), so they
 * read: every write-up not marked done, every write-up opened (or dated) since 90 days before the oldest open one (and at
 * least the last 120 days), and every write-up completed in the last 32 days. The numbers are the same as reading them all.
 */
import { collection, query, where, onSnapshot } from './firebase.js';

const DONE = ['COMPLETE', 'COMPLETED', 'CLOSED', 'RESOLVED', 'REPAIRED', 'complete', 'completed', 'closed', 'resolved', 'repaired'];
const DAY = 86400000;
const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
const isoDay = (v) => { const ms = Date.parse(String(v || '')); return isFinite(ms) ? ms : null; };

// cb(records) with each record's id, as a whole-collection read gives them; onError(e) as onSnapshot's.
export function watchIssueRecords(db, cb, onError) {
  const col = collection(db, 'maintenance'), parts = { open: null, opened: null, dated: null, done: null };
  let since = '', stops = { opened: null, dated: null };
  const send = () => {
    if (Object.keys(parts).some(k => !parts[k])) return; // each part has answered once
    const byId = {};
    Object.keys(parts).forEach(k => parts[k].forEach(r => { byId[r.id] = r; }));
    cb(Object.values(byId));
  };
  const take = (k) => (s) => { parts[k] = s.docs.map(d => Object.assign({}, d.data(), { id: d.id })); if (k === 'open') widen(); send(); };
  // The recent part reaches 90 days (and a day more) before the oldest open write-up, so its repeat count is the same.
  function widen() {
    let oldest = Date.now() - 120 * DAY;
    (parts.open || []).forEach(r => { const ms = isoDay(r.opened_at || r.service_date); if (ms !== null && ms - 91 * DAY < oldest) oldest = ms - 91 * DAY; });
    const want = dayKey(oldest);
    if (since && want >= since) return;
    since = want;
    ['opened', 'dated'].forEach(k => {
      if (stops[k]) stops[k]();
      parts[k] = null; // wait for the wider read before showing counts
      const field = k === 'opened' ? 'opened_at' : 'service_date';
      stops[k] = onSnapshot(query(col, where(field, '>=', since)), take(k), onError);
    });
  }
  widen(); // the last 120 days start at once, beside the open ones, and widen if an open one is older
  const stopOpen = onSnapshot(query(col, where('status', 'not-in', DONE)), take('open'), onError);
  const stopDone = onSnapshot(query(col, where('completed_at', '>=', dayKey(Date.now() - 32 * DAY))), take('done'), onError);
  return () => { stopOpen(); stopDone(); Object.values(stops).forEach(s => s && s()); };
}

// The Fleet & Maintenance hub's work orders: every one not done, and the ones finished since fromKey (the week's Sunday, a
// day early so no time zone drops one). Blank status counts as NEW (open), as the hub reads it.
export function watchHubWorkOrders(db, fromKey, cb, onError) {
  const col = collection(db, 'workOrders'), parts = { open: null, done: null, blank: null };
  const send = () => {
    if (Object.keys(parts).some(k => !parts[k])) return;
    const byId = {};
    Object.keys(parts).forEach(k => parts[k].forEach(r => { byId[r.id] = r; }));
    cb(Object.values(byId));
  };
  const take = (k) => (s) => { parts[k] = s.docs.map(d => Object.assign({}, d.data(), { id: d.id })); send(); };
  const from = dayKey(Date.parse(fromKey + 'T12:00:00Z') - DAY);
  const stops = [onSnapshot(query(col, where('status', 'not-in', ['DONE', 'done', 'Done'])), take('open'), onError),
    onSnapshot(query(col, where('completed_at', '>=', from)), take('done'), onError),
    onSnapshot(query(col, where('status', '==', null)), take('blank'), onError)];
  return () => stops.forEach(s => s());
}

// The trailer-wash requests the plant screens need (the app's, maintenance kind WASH, or with list 'plantWash' the Live
// sheet's WASH / CLEANING LIVE copy): every one not marked done, and the ones completed from fromKey on (Truck Washing lists
// the week's finished washes). P.washItems and Truck Washing's done list come out the same as from every wash request ever
// made. Done is P's DONE_WASH, in the two spellings the records use.
const WASH_DONE = ['COMPLETE', 'COMPLETED', 'CLEANED', 'CLOSED', 'RESOLVED', 'WASHED', 'DONE', 'REMOVED', 'complete', 'done'];
export function watchWashRequests(db, fromKey, cb, onError, list) {
  const name = list || 'maintenance', col = collection(db, name), parts = { open: null, done: null };
  const send = () => {
    if (!parts.open || !parts.done) return;
    const byId = {};
    parts.open.concat(parts.done).forEach(r => { byId[r._id] = r; });
    cb(Object.values(byId));
  };
  const take = (k) => (s) => {
    parts[k] = s.docs.map(d => Object.assign({}, d.data(), { _list: name, _id: d.id })).filter(r => name !== 'maintenance' || String(r.kind || '').toUpperCase() === 'WASH');
    send();
  };
  const from = dayKey(Date.parse(fromKey + 'T12:00:00Z') - DAY);
  const stops = [onSnapshot(query(col, where('status', 'not-in', WASH_DONE)), take('open'), onError), onSnapshot(query(col, where('completed_at', '>=', from)), take('done'), onError)];
  return () => stops.forEach(s => s());
}

// Joe 10/19 (Plant Distribution and Yard Checks slow to open): the loads around today, from the one-record-per-run-and-day
// list (functions/src/rundays.js), instead of three weeks of whole runs. cb(runs) gets each run put back together as the runs
// list holds it ({id, route facts, days}), with only its days whose load, carry or delivery dates touch one of dates; every
// load, yard trailer, unload and return those screens show for today is one of those days.
export function watchLoads(db, dates, cb, onError) {
  return onSnapshot(query(collection(db, 'runDays'), where('dates', 'array-contains-any', dates)), s => {
    const byRun = {};
    s.docs.forEach(d => {
      const x = d.data(), id = x.runDocId;
      if (!id) return;
      if (!byRun[id]) {
        const run = Object.assign({ id }, x, { days: {} });
        delete run.runDocId; delete run.day; delete run.dates;
        byRun[id] = run;
      }
      Object.assign(byRun[id].days, x.days || {});
    });
    cb(Object.values(byRun), s);
  }, onError);
}

// Plant Maintenance (Joe 10/12: like the garage work orders, but for the plant's machinery): what Maintenance Center, Machinery,
// Work Orders and PM Schedule read. The rules are pmaint-rules.js (shared with the server).
import { collection, doc, query, where, onSnapshot } from './firebase.js';

const R = () => window.UDPlantMaint, L = () => window.UDLogic, U = () => window.UDPlant;
const HISTORY_DAYS = 365;

// The day on the plant's clock (yyyy-mm-dd, New York), for what is due and late.
export const todayKey = (ms) => new Date(ms || Date.now()).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

// cb(data) each time something changes: {machines (in service), all (retired too), workOrders, tasks, breakdowns, requests, read}.
// Joe 10/12: breakdowns are recorded on Shift Notes (fixed on the spot), requests are Shift Notes' Maintenance Requests; both are
// read from the plant's shift log for the last year (needs plant-rules.js). A machine is DOWN while a breakdown on it is still down
// or an open work order says its line is down.
// Joe 10/18: opts.openOrders (Maintenance Center, PM Schedule) reads only the open work orders and, for each request still
// waiting, its own work order (plantmaint.js woIdFor: SN_ and the entry), not every work order ever made; what those screens
// show is the same. Machinery and Work Orders show the history, so they read them all.
export function watchMaint(db, facilityId, cb, fail, opts) {
  const data = { setup: [], saved: [], workOrders: [], tasks: [], journal: [], read: { setup: false, machines: false, workOrders: false, tasks: false, journal: false } };
  const openOnly = !!(opts && opts.openOrders), openWos = [], reqWos = {}, reqStops = {};
  const woOf = (d) => Object.assign({}, d.data(), { id: d.id });
  const normal = (w) => Object.assign(w, { status: String(w.status || 'NEW').toUpperCase() });
  const mine = (d) => (String(d.facilityId || '').trim() || 'fac_uniontown') === facilityId;
  const mergeWos = () => {
    const byId = {};
    openWos.concat(Object.values(reqWos).filter(Boolean)).forEach(w => { byId[w.id] = w; });
    data.workOrders = Object.values(byId);
  };
  // The work orders of the requests still waiting (a resolved request is not listed as waiting, so its work order is not needed).
  const watchRequests = (log) => {
    const want = {};
    log.forEach(r => { if (String(r.type || '').toUpperCase() === 'MAINTENANCE REQUEST' && r.status !== 'RESOLVED' && /^[A-Za-z0-9_-]+$/.test(r.entryId || '')) want[r.entryId] = true; });
    Object.keys(reqStops).forEach(id => { if (!want[id]) { reqStops[id](); delete reqStops[id]; if (reqWos[id]) { delete reqWos[id]; mergeWos(); } } });
    Object.keys(want).forEach(id => {
      if (reqStops[id]) return;
      reqStops[id] = onSnapshot(doc(db, 'plantWorkOrders', ('SN_' + id).slice(0, 200)), d => {
        // As the whole list gives it: this plant's (facilityId the same), status NEW when blank.
        const w = d.exists() ? woOf(d) : null;
        reqWos[id] = w && w.facilityId === facilityId && mine(w) ? normal(w) : null;
        mergeWos(); send();
      }, fail);
    });
  };
  const send = () => {
    const all = R().machines(data.setup, data.saved, facilityId, true);
    const today = todayKey();
    const now = Date.now();
    const log = U() ? U().shiftLog(data.journal, now, 24 * HISTORY_DAYS) : [];
    if (openOnly) watchRequests(log);
    const open = data.workOrders.filter(w => R().isOpen(w));
    const kind = (r) => String(r.type || '').toUpperCase();
    const tie = (r) => { const m = R().findMachine(all, r.equipment); return Object.assign({}, r, { machineId: m ? m.id : '', machine: m ? m.name : r.equipment, down: U().downMinutes(r, now), today: U().downToday(r, now), recordedToday: U().opDayAt(Date.parse(r.recordedAt) || now) === U().opDayAt(now) }); };
    const breakdowns = log.filter(r => kind(r) === 'BREAKDOWN').map(tie).map(r => Object.assign(r, { stillDown: !!r.readingTime && !r.upAt && r.status !== 'RESOLVED' }));
    const requests = log.filter(r => kind(r) === 'MAINTENANCE REQUEST').map(tie).map(r => Object.assign(r, { workOrder: data.workOrders.find(w => w.sourceEntryId === r.entryId) || null }));
    const tasks = data.tasks.filter(t => t.status !== 'REMOVED').map(t => {
      const m = all.find(x => x.id === t.machineId), sent = data.workOrders.find(w => w.id === t.sentWorkOrderId);
      return Object.assign({}, t, { machine: m ? m.name : t.machine, area: m ? m.area : '', due: t.nextDue || '', state: R().pmState(t.nextDue, today) || 'NEW', late: R().daysLate(t.nextDue, today),
        sent: sent && R().isOpen(sent) ? sent : null });
    }).sort((a, b) => String(a.due || '9999').localeCompare(String(b.due || '9999')) || String(a.machine).localeCompare(String(b.machine)));
    all.forEach(m => {
      const mine = open.filter(w => w.machineId === m.id);
      m.open = mine.length;
      m.down = mine.some(w => w.lineDown === 'YES') || breakdowns.some(b => b.machineId === m.id && b.stillDown);
      m.parts = mine.some(w => String(w.status).toUpperCase() === 'PARTS');
      const next = tasks.filter(t => t.machineId === m.id && t.due)[0];
      m.nextPm = next || null;
    });
    cb(Object.assign({}, data, { all, machines: all.filter(m => m.status !== 'RETIRED'), tasks, today, breakdowns, requests }));
  };
  const subs = [
    onSnapshot(query(collection(db, 'plantSetup'), where('type', '==', 'PRODUCTION_AREA')), s => { data.setup = s.docs.map(d => d.data()); data.read.setup = true; send(); }, fail),
    onSnapshot(query(collection(db, 'plantMachines'), where('facilityId', '==', facilityId)), s => { data.saved = s.docs.map(d => Object.assign({ id: d.id }, d.data())); data.read.machines = true; send(); }, fail),
    // Open: every writer sets status (NEW, WORKING, PARTS, DONE), so status in the open list is every open one. All plants'
    // open ones are few, so the plant is picked here, as the facilityId read does.
    openOnly ? onSnapshot(query(collection(db, 'plantWorkOrders'), where('status', 'in', R().OPEN)), s => {
      openWos.length = 0;
      s.docs.map(woOf).filter(w => w.facilityId === facilityId && mine(w)).forEach(w => openWos.push(normal(w)));
      mergeWos(); data.read.workOrders = true; send();
    }, fail) : onSnapshot(query(collection(db, 'plantWorkOrders'), where('facilityId', '==', facilityId)), s => {
      data.workOrders = s.docs.map(woOf).filter(mine).map(normal);
      data.read.workOrders = true; send();
    }, fail),
    onSnapshot(query(collection(db, 'plantPmTasks'), where('facilityId', '==', facilityId)), s => { data.tasks = s.docs.map(d => Object.assign({}, d.data(), { id: d.id })); data.read.tasks = true; send(); }, fail)
  ];
  // The shift log (Shift Notes is Uniontown's for now). A year back, so a machine's history keeps its breakdowns.
  if (U() && !(opts && opts.noJournal)) subs.push(onSnapshot(query(collection(db, 'plantJournal'), where('type', '==', U().SHIFT_TYPE), where('date', '>=', R().addDays(todayKey(), -HISTORY_DAYS))), s => {
    data.journal = s.docs.map(d => d.data()).filter(mine); data.read.journal = true; send();
  }, fail));
  const tick = setInterval(send, 60000);
  return () => { clearInterval(tick); subs.forEach(u => u()); Object.values(reqStops).forEach(u => u()); };
}

// The plants this person may see (Administration > People), else Uniontown.
export function plantsOf(person) {
  const all = L().PLANTS && L().PLANTS.length ? L().PLANTS : [{ id: 'fac_uniontown', name: 'Uniontown' }];
  const ids = person ? L().plantsFor(person) : [];
  const list = all.filter(p => ids.indexOf(p.id) >= 0);
  return list.length ? list : all.slice(0, 1);
}

/*
 * The plant these pages work on (Joe 10/12: "whatever plant I went to is where it should go"): the ?plant= of a deep link,
 * else the plant home he came in through (sessionStorage udPlant), else his first plant. Only ever one of his own plants.
 */
export function plantFor(person, urlPlant) {
  const ps = plantsOf(person);
  let came = '';
  try { came = sessionStorage.getItem('udPlant') || ''; } catch (e) { /* no storage */ }
  const pl = ps.find(p => p.id === urlPlant) || ps.find(p => p.id === came) || ps[0];
  try { sessionStorage.setItem('udPlant', pl.id); } catch (e) { /* no storage */ }
  return pl;
}

// Plant Maintenance (Joe 10/12: like the garage work orders, but for the plant's machinery): what Maintenance Center, Machinery,
// Work Orders and PM Schedule read. The rules are pmaint-rules.js (shared with the server).
import { collection, query, where, onSnapshot } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';

const R = () => window.UDPlantMaint, L = () => window.UDLogic;

// The day on the plant's clock (yyyy-mm-dd, New York), for what is due and late.
export const todayKey = (ms) => new Date(ms || Date.now()).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

// cb(data) each time something changes: {machines (in service), all (retired too), workOrders, tasks, read}.
// A machine is DOWN while it has an open work order that says the line is down.
export function watchMaint(db, facilityId, cb, fail) {
  const data = { setup: [], saved: [], workOrders: [], tasks: [], read: { setup: false, machines: false, workOrders: false, tasks: false } };
  const send = () => {
    const all = R().machines(data.setup, data.saved, facilityId, true);
    const today = todayKey();
    const open = data.workOrders.filter(w => R().isOpen(w));
    const tasks = data.tasks.filter(t => t.status !== 'REMOVED').map(t => {
      const m = all.find(x => x.id === t.machineId), sent = data.workOrders.find(w => w.id === t.sentWorkOrderId);
      return Object.assign({}, t, { machine: m ? m.name : t.machine, area: m ? m.area : '', due: t.nextDue || '', state: R().pmState(t.nextDue, today) || 'NEW', late: R().daysLate(t.nextDue, today),
        sent: sent && R().isOpen(sent) ? sent : null });
    }).sort((a, b) => String(a.due || '9999').localeCompare(String(b.due || '9999')) || String(a.machine).localeCompare(String(b.machine)));
    all.forEach(m => {
      const mine = open.filter(w => w.machineId === m.id);
      m.open = mine.length;
      m.down = mine.some(w => w.lineDown === 'YES');
      m.parts = mine.some(w => String(w.status).toUpperCase() === 'PARTS');
      const next = tasks.filter(t => t.machineId === m.id && t.due)[0];
      m.nextPm = next || null;
    });
    cb(Object.assign({}, data, { all, machines: all.filter(m => m.status !== 'RETIRED'), tasks, today }));
  };
  const mine = (d) => (String(d.facilityId || '').trim() || 'fac_uniontown') === facilityId;
  const subs = [
    onSnapshot(query(collection(db, 'plantSetup'), where('type', '==', 'PRODUCTION_AREA')), s => { data.setup = s.docs.map(d => d.data()); data.read.setup = true; send(); }, fail),
    onSnapshot(query(collection(db, 'plantMachines'), where('facilityId', '==', facilityId)), s => { data.saved = s.docs.map(d => Object.assign({ id: d.id }, d.data())); data.read.machines = true; send(); }, fail),
    onSnapshot(query(collection(db, 'plantWorkOrders'), where('facilityId', '==', facilityId)), s => {
      data.workOrders = s.docs.map(d => Object.assign({}, d.data(), { id: d.id })).filter(mine).map(w => Object.assign(w, { status: String(w.status || 'NEW').toUpperCase() }));
      data.read.workOrders = true; send();
    }, fail),
    onSnapshot(query(collection(db, 'plantPmTasks'), where('facilityId', '==', facilityId)), s => { data.tasks = s.docs.map(d => Object.assign({}, d.data(), { id: d.id })); data.read.tasks = true; send(); }, fail)
  ];
  const tick = setInterval(send, 60000);
  return () => { clearInterval(tick); subs.forEach(u => u()); };
}

// The plants this person may see (Administration > People), else Uniontown.
export function plantsOf(person) {
  const all = L().PLANTS && L().PLANTS.length ? L().PLANTS : [{ id: 'fac_uniontown', name: 'Uniontown' }];
  const ids = person ? L().plantsFor(person) : [];
  const list = all.filter(p => ids.indexOf(p.id) >= 0);
  return list.length ? list : all.slice(0, 1);
}

/*
 * United Dairy Distribution app: editing on the Daily and Weekly screens.
 *
 * A cell shows the change the moment it is picked (no reload, no waiting); the save goes to the server in the
 * background as one call. If the server refuses it (someone else changed that run, a unit is inactive, no
 * permission), the cell goes back to what the database holds and the reason shows as an error.
 */
import { start, save, showError, escapeHtml } from './app.js';
import { collection, doc, onSnapshot } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';

const L = window.UDLogic;
export const lists = { drivers: [], trucks: [], trailers: [], allDrivers: [], allTrucks: [], allTrailers: [], exceptions: [], person: null };

// Drivers, units and the signed-in person's roles, kept current.
export async function watchLists(user, onChange) {
  const { db } = await start();
  onSnapshot(collection(db, 'drivers'), snap => {
    lists.allDrivers = snap.docs.map(d => d.data()).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    lists.drivers = lists.allDrivers.filter(d => d.status === 'ACTIVE');
    onChange();
  });
  onSnapshot(collection(db, 'equipment'), snap => {
    const all = snap.docs.map(d => d.data());
    const byUnit = (a, b) => String(a.unit).localeCompare(String(b.unit), undefined, { numeric: true });
    lists.allTrucks = all.filter(e => e.type === 'TRUCK').sort(byUnit);
    lists.allTrailers = all.filter(e => e.type === 'TRAILER').sort(byUnit);
    // Down, inactive or out-of-service units are left out of the choices unless OVR is ticked.
    lists.trucks = lists.allTrucks.filter(e => !L.unitOff(e));
    lists.trailers = lists.allTrailers.filter(e => !L.unitOff(e));
    onChange();
  });
  // Days off (Driver Call-Off, Weekly availability, Vacation Schedule): those drivers are left out unless OVR is ticked.
  onSnapshot(collection(db, 'exceptions'), snap => { lists.exceptions = snap.docs.map(d => d.data()); onChange(); });
  onSnapshot(doc(db, 'users', String(user.email).toLowerCase()), snap => { lists.person = snap.exists() ? snap.data() : null; onChange(); });
}

export function canSave() { return L.hasRole(lists.person, L.SAVE_ROLES); }
export function canReorder() { return L.hasRole(lists.person, L.REORDER_ROLES); }

// Checked when the list opens, so a unit put down a moment ago on this screen is already left out.
const units = (all, opts) => (opts && opts.override) ? all : all.filter(e => !L.unitOff(e));

// opts = {override, date}: with OVR every driver and unit is offered, marked with why it is normally left out.
const KINDS = {
  driver: { action: 'assignDriver', field: 'driverId', idKey: 'driverId', textKey: 'driver', list: (opts) => {
    opts = opts || {};
    const pool = opts.override ? lists.allDrivers : lists.drivers;
    return pool.map(d => {
      const off = opts.date ? L.exceptionOn(lists.exceptions, d.id, opts.date) : null;
      if (off && !opts.override) return null;
      const why = d.status !== 'ACTIVE' ? d.status : off ? L.exceptionLabel(off) : '';
      return { id: d.id, text: d.name + (why && opts.override ? '  [' + why + ']' : '') };
    }).filter(Boolean);
  } },
  truck: { action: 'assignTruck', field: 'equipmentId', idKey: 'truckId', textKey: 'truck', list: (opts) => units(lists.allTrucks, opts).map(e => ({ id: e.id, text: e.unit + (L.unitOff(e) ? '  [' + e.status + ']' : '') })) },
  trailer: { action: 'assignTrailer', field: 'equipmentId', idKey: 'trailerId', textKey: 'trailer', list: (opts) => units(lists.allTrailers, opts).map(e => ({ id: e.id, text: e.unit + (L.unitOff(e) ? '  [' + e.status + ']' : '') })) }
};

export function optionsHtml(kind, current, busy, opts) {
  return '<option value="">(none)</option>' + KINDS[kind].list(opts).map(o =>
    '<option value="' + escapeHtml(o.id) + '"' + (o.id === current ? ' selected' : '') + '>' + escapeHtml(o.text + (busy && busy[o.id] && o.id !== current ? '  (' + busy[o.id] + ')' : '')) + '</option>').join('');
}

export function pickText(kind, id) {
  const pool = kind === 'driver' ? lists.allDrivers : kind === 'truck' ? lists.allTrucks : lists.allTrailers;
  const item = pool.find(o => o.id === id);
  return item ? (kind === 'driver' ? item.name : item.unit) : '';
}

// A drop-down in place of the cell. busy = {id: "on 802"} marks drivers or units already used that day.
export function openPicker(td, kind, current, busy, onPick, opts) {
  const select = document.createElement('select');
  select.className = 'picker';
  select.innerHTML = optionsHtml(kind, current, busy, opts);
  td.textContent = '';
  td.appendChild(select);
  select.focus();
  let done = false;
  const finish = (pick) => { if (done) return; done = true; onPick(pick); };
  select.addEventListener('change', () => finish({ id: select.value, text: pickText(kind, select.value) }));
  select.addEventListener('blur', () => finish(null));
  select.addEventListener('keydown', e => { if (e.key === 'Escape') finish(null); });
}

export function openNote(td, current, onPick) {
  const input = document.createElement('input');
  input.className = 'picker';
  input.maxLength = 500;
  input.value = current || '';
  td.textContent = '';
  td.appendChild(input);
  input.focus();
  let done = false;
  const finish = (value) => { if (done) return; done = true; onPick(value); };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') finish(input.value.trim()); if (e.key === 'Escape') finish(null); });
  input.addEventListener('blur', () => finish(input.value.trim() === (current || '') ? null : input.value.trim()));
}

/*
 * Applies a pick to the run on screen at once (optimistic), then saves it. getRuns() returns the screen's current
 * run list (the live database update replaces it with the saved values a moment later).
 * Saves to the same run wait for each other, so a quick driver-then-truck pick sends the right revision.
 */
const queues = {};
export function saveRunChange(getRuns, runDocId, day, action, fields, apply, render) {
  const shown = getRuns().find(r => r.id === runDocId);
  if (!shown) return Promise.resolve();
  const before = Object.assign({}, shown.days[day]);
  apply(shown.days[day]);
  render();
  const send = async () => {
    const run = getRuns().find(r => r.id === runDocId) || shown;
    try {
      const out = await save(action, Object.assign({ runDocId, day, expectedRev: run.rev }, fields));
      out.runs.forEach(r => { const target = getRuns().find(x => x.id === r.runDocId); if (target && target.rev < r.rev) target.rev = r.rev; });
      return out;
    } catch (e) {
      // Put back what the database holds (if a live update has not already replaced this run).
      if (getRuns().indexOf(shown) >= 0) { shown.days[day] = before; render(); }
      showError(e.message || String(e));
      throw e;
    }
  };
  const next = (queues[runDocId] || Promise.resolve()).then(send);
  queues[runDocId] = next.catch(() => {});
  return next.catch(() => null);
}

export function saveAssignment(getRuns, runDocId, day, kind, pick, render, override) {
  const spec = kind === 'note' ? null : KINDS[kind];
  const fields = spec ? { [spec.field]: pick.id } : { note: pick };
  if (override) fields.override = true;
  return saveRunChange(getRuns, runDocId, day, spec ? spec.action : 'setDriverNote', fields,
    (d) => { if (spec) { d[spec.idKey] = pick.id; d[spec.textKey] = pick.id ? pick.text : ''; } else d.driverNotes = pick; }, render);
}

// New load order for one load date: the rows in their new order. Shown at once, saved as one call.
export async function saveOrder(getRuns, loadDate, orderedRows, render) {
  const previous = orderedRows.map(r => ({ run: getRuns().find(x => x.id === r.runDocId), day: r.day }));
  const before = previous.map(p => p.run && p.run.days[p.day].loadSequenceOverride);
  const slots = orderedRows.map(r => r.loadSequence).filter(v => v !== null && v !== undefined).sort((a, b) => a - b);
  const unique = slots.filter((v, i) => slots.indexOf(v) === i);
  const numbers = unique.length === orderedRows.length ? unique : orderedRows.map((_, i) => (i + 1) * 5);
  previous.forEach((p, i) => { if (p.run) p.run.days[p.day].loadSequenceOverride = numbers[i]; });
  render();
  try {
    await save('reorderLoads', { loadDate, order: orderedRows.map(r => ({ runDocId: r.runDocId, day: r.day })) });
  } catch (e) {
    previous.forEach((p, i) => { if (p.run) p.run.days[p.day].loadSequenceOverride = before[i]; });
    render();
    showError(e.message || String(e));
  }
}

// Any other one-call save: apply() shows it at once, undo() puts it back if the server refuses it.
export async function saveOptimistic(action, fields, apply, undo, render) {
  apply();
  render();
  try {
    return await save(action, fields);
  } catch (e) {
    undo();
    render();
    showError(e.message || String(e));
    return null;
  }
}

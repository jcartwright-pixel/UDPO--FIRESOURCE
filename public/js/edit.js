/*
 * United Dairy Distribution app: editing on the Daily and Weekly screens.
 *
 * A cell shows the change the moment it is picked (no reload, no waiting); the save goes to the server in the
 * background as one call. If the server refuses it (someone else changed that run, a unit is inactive, no
 * permission), the cell goes back to what the database holds and the reason shows as an error.
 */
import { start, save as sendSave, savePill, showError, friendlyError, escapeHtml, goLiveNote, watchPerson, maySave } from './app.js';
import { collection, doc, query, where, onSnapshot } from './firebase.js';

const L = window.UDLogic;

/*
 * "Saving... / Saved" beside the screen's title, like the current app's Daily (7.0.2xx): every save on Daily and Weekly goes
 * through here. A refused save shows "Not saved" (the reason is in the error line). Leaving the page while a save is still
 * going asks first.
 */
let pending = 0, failed = false;
window.UD_EDIT_PILL = true;   // this module shows the sign itself, around a whole save
// Joe 10/16: Daily and Weekly Dispatch (window.UD_QUIET_SAVES) show no "Saving... / Saved" sign at all; only a save that failed says
// "Not saved", and the next save that works takes it away.
function pill(state) {
  if (window.UD_QUIET_SAVES && state !== 'failed') { const p = document.getElementById('save-pill'); if (p) p.hidden = true; return; }
  savePill(state);
}
async function save(action, fields) {
  if (!pending) failed = false;
  pending++;
  pill('saving');
  try {
    const out = await sendSave(action, fields);
    pending--;
    if (!pending) pill(failed ? 'failed' : 'saved');
    // A save that worked clears an old error from an earlier one.
    if (!pending && !failed) showError('');
    return out;
  } catch (e) {
    pending--;
    failed = true;
    pill(pending ? 'saving' : 'failed');
    throw e;
  }
}
export function savesPending() { return pending; }
window.addEventListener('beforeunload', e => { if (pending) { e.preventDefault(); e.returnValue = 'A change is still saving. Leave anyway?'; } });
export const lists = { drivers: [], trucks: [], trailers: [], allDrivers: [], allTrucks: [], allTrailers: [], fleetTrucks: [], fleetTrailers: [], equipmentAll: [], exceptions: [], backups: [], ops: L.opsAssignments([]), person: null, app: {} };

// The screen's key in the per-screen switch (L.SCREENS); each page sets it once.
let screenKey = 'dailyDispatch';
const HOME_FACILITY = 'fac_uniontown';
export function forScreen(key) { screenKey = key; }

// Drivers, units and the signed-in person's roles, kept current.
export async function watchLists(user, onChange) {
  const { db } = await start();
  onSnapshot(collection(db, 'drivers'), snap => {
    lists.allDrivers = snap.docs.map(d => d.data()).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    lists.drivers = lists.allDrivers.filter(d => L.driverActive(d));
    onChange();
  });
  onSnapshot(collection(db, 'equipment'), snap => {
    // Only Uniontown's units (Equipment Master facility_id), like the current app's pickers; Charleston and Martins Ferry units are left out.
    // Every plant's units too (Trucks Today's All Fleet Units says which are ours and where each belongs, Joe 10/20).
    lists.equipmentAll = snap.docs.map(d => d.data());
    const all = lists.equipmentAll.filter(e => !e.facilityId || e.facilityId === HOME_FACILITY);
    const byUnit = (a, b) => String(a.unit).localeCompare(String(b.unit), undefined, { numeric: true });
    lists.fleetTrucks = all.filter(e => e.type === 'TRUCK').sort(byUnit);
    lists.fleetTrailers = all.filter(e => e.type === 'TRAILER').sort(byUnit);
    // Joe, 10/9: "This should only show the Uniontown fleet." The Equipment screen, its counts and the pickers show only units
    // whose Equipment Master location is Uniontown; units kept at the branches (Marietta, Beckley, Fairmont...) are left out.
    const home = (e) => !e.location || /UNIONTOWN/i.test(e.location);
    lists.allTrucks = lists.fleetTrucks.filter(home);
    lists.allTrailers = lists.fleetTrailers.filter(home);
    // Down, inactive or out-of-service units are left out of the choices unless OVR is ticked.
    lists.trucks = lists.allTrucks.filter(e => !L.unitOff(e));
    lists.trailers = lists.allTrailers.filter(e => !L.unitOff(e));
    onChange();
  });
  // Days off (Driver Call-Off, Weekly availability, Vacation Schedule): those drivers are left out unless OVR is ticked.
  // Review item 73 (Joe 10/13): only days off ending in the previous Live week or later (Daily and Weekly show the Live weeks),
  // not every one ever entered.
  onSnapshot(query(collection(db, 'exceptions'), where('endDate', '>=', L.addDays(L.weekStart(L.operatingDay(new Date())), -7))), snap => { lists.exceptions = snap.docs.map(d => d.data()); onChange(); });
  // Joe 10/16: drivers marked Backup for a day (Weekly board).
  onSnapshot(query(collection(db, 'driverBackups'), where('date', '>=', L.addDays(L.weekStart(L.operatingDay(new Date())), -7))), snap => { lists.backups = snap.docs.map(d => d.data()); onChange(); });
  // Operational Assignments: Carrier, Fairmont... offered under Other CVG / Carriers in the driver lists.
  onSnapshot(collection(db, 'opsAssignments'), snap => { lists.ops = L.opsAssignments(snap.docs.map(d => d.data())); onChange(); });
  // Which app runs each screen: a screen still run from the current app is view only here once any screen has moved.
  onSnapshot(doc(db, 'config', 'app'), snap => { lists.app = snap.data() || {}; onChange(); });
  watchPerson(db, user, p => { lists.person = p; onChange(); });
}

export function screenOpen() { return L.screenState(lists.app, screenKey).open; }
export function canSave() { return maySave(lists.person, L.SAVE_ROLES, lists.app, screenKey); }
export function canReorder() { return maySave(lists.person, L.REORDER_ROLES, lists.app, screenKey); }
export function canManage() { return maySave(lists.person, L.DRIVER_ROLES, lists.app, screenKey); }

// The badge at the top right: the test copy's own words, or whether this screen is switched on once one has been.
// Joe 10/12: no "new app" / "current app" words; a screen not switched on says where to switch it.
export function modeLabel(testText) {
  const s = L.screenState(lists.app, screenKey);
  goLiveNote(s.live && s.owner === 'old');
  if (!s.live || s.owner === 'app') return testText;
  if (s.owner === 'new') return s.open ? 'LIVE: SAVES GO TO THE SHEET' : 'VIEW ONLY: WRITE-BACK TO THE SHEET IS OFF';
  return 'VIEW ONLY UNTIL SWITCHED ON IN GO-LIVE SWITCHES';
}

// Checked when the list opens, so a unit put down a moment ago on this screen is already left out.
const units = (all, opts) => (opts && opts.override) ? all : all.filter(e => !L.unitOff(e) && !(opts && opts.conflicts && opts.conflicts[e.id]));
// Why a unit is normally left out: down / out first, then on the road on another run (opts.conflicts, L.unitConflicts).
const unitWhy = (e, opts) => L.unitOff(e) ? L.unitOffWhy(e) : (opts && opts.conflicts && opts.conflicts[e.id]) || '';

// opts = {override, date, conflicts}: with OVR every driver and unit is offered, marked with why it is normally left out.
const KINDS = {
  driver: { action: 'assignDriver', field: 'driverId', idKey: 'driverId', textKey: 'driver', list: (opts) => {
    opts = opts || {};
    const pool = opts.override ? lists.allDrivers : lists.drivers;
    return pool.map(d => {
      const off = opts.date ? L.exceptionOn(lists.exceptions, d.id, opts.date) : null;
      if (off && !opts.override) return null;
      const why = !L.driverActive(d) ? d.status : off ? L.exceptionLabel(off) : '';
      const dayNote = !why && opts.date && L.dayNoteOn(lists.backups, d.id, opts.date);
      const backup = dayNote ? '  [' + dayNote.toUpperCase() + ']' : !why && opts.date && L.backupOn(lists.backups, d.id, opts.date) ? '  [BACKUP]' : '';
      return { id: d.id, text: d.name + (why && opts.override ? '  [' + why + ']' : '') + backup };
    }).filter(Boolean);
  } },
  truck: { action: 'assignTruck', field: 'equipmentId', idKey: 'truckId', textKey: 'truck', list: (opts) => units(lists.allTrucks, opts).map(e => ({ id: e.id, text: e.unit + (unitWhy(e, opts) ? '  [' + unitWhy(e, opts) + ']' : ''), why: !!unitWhy(e, opts) })) },
  trailer: { action: 'assignTrailer', field: 'equipmentId', idKey: 'trailerId', textKey: 'trailer', list: (opts) => units(lists.allTrailers, opts).map(e => ({ id: e.id, text: e.unit + (unitWhy(e, opts) ? '  [' + unitWhy(e, opts) + ']' : ''), why: !!unitWhy(e, opts) })) }
};

// The unit already on the run, when the list leaves it out. Joe 10/12 ("why does it show available"): a down unit is never
// offered as if free: the type-to-pick list leaves it out unless OVR is ticked (then marked with why); the Edit box's
// drop-down still shows what is on the run, marked [DOWN].
function keepCurrent(kind, current, list, opts, editBox) {
  if (!current || kind === 'driver' || list.some(o => o.id === current) || !pickText(kind, current)) return;
  const e = (kind === 'truck' ? lists.fleetTrucks : lists.fleetTrailers).find(x => x.id === current);
  if (e && L.unitOff(e)) {
    if (editBox || (opts && opts.override)) list.unshift({ id: current, text: e.unit + '  [' + L.unitOffWhy(e) + ']', why: true });
    return;
  }
  list.unshift({ id: current, text: pickText(kind, current) });
}

export function optionsHtml(kind, current, busy, opts) {
  const list = KINDS[kind].list(opts);
  // A unit already on the run stays shown even when it is kept at another branch (marked when it is down: Joe 10/12).
  keepCurrent(kind, current, list, opts, true);
  const opt = (o) => '<option value="' + escapeHtml(o.id) + '"' + (o.id === current ? ' selected' : '') + '>' + escapeHtml(o.text + (busy && busy[o.id] && o.id !== current && !o.why ? '  (' + busy[o.id] + ')' : '')) + '</option>';
  const cvg = kind === 'driver' ? cvgOptions() : [];
  return '<option value="">(none)</option>' + list.map(opt).join('') + (cvg.length ? '<optgroup label="Other CVG / Carriers">' + cvg.map(opt).join('') + '</optgroup>' : '');
}

// The same choices as optionsHtml, as a list for Daily's type-to-pick box: key is the name or unit the typing is matched against.
export function pickChoices(kind, current, busy, opts) {
  if (kind === 'driver') return driverChoices(current, busy, opts);
  const list = KINDS[kind].list(opts);
  keepCurrent(kind, current, list, opts, false);
  const item = (group) => (o) => ({ value: o.id, label: o.text + (busy && busy[o.id] && o.id !== current && !o.why ? '  (' + busy[o.id] + ')' : ''), key: pickText(kind, o.id) || o.text, group });
  // Joe 10/12 ("891 now won't show whole number"): a unit left out (taken on another load, down, inactive) is still listed,
  // greyed with why, so typing its short number finds it instead of saving the short number as typed; OVR makes it pickable.
  const left = (opts && opts.override) ? [] : (kind === 'truck' ? lists.allTrucks : lists.allTrailers)
    .filter(e => e.id !== current && !list.some(o => o.id === e.id))
    .map(e => ({ value: e.id, label: e.unit, key: e.unit, group: 'blocked', head: 'UNAVAILABLE', reason: unitWhy(e, opts) || 'not usable', blocked: true }));
  return [{ value: '', label: '(none)', key: '', group: 'none' }].concat(list.map(item('list')), kind === 'driver' ? cvgOptions().map(item('cvg')) : [], left);
}

export const NEEDS_DRIVER = '\u2014 NEEDS DRIVER \u2014';

/*
 * Daily's driver list (Joe 10/12): Regular drivers in seniority order, then a separate Relief drivers section, names only
 * (no seniority dates or Relief tags); then Other CVG / Carriers; then Unavailable with the reason (off, called off,
 * vacation, on another route that day) last, which can be picked only with OVR ticked.
 */
export function driverChoices(current, busy, opts) {
  opts = opts || {};
  const relief = [], regular = [], blocked = [];
  L.driverRosterRows(lists.allDrivers, opts.date).forEach(r => {
    const d = lists.allDrivers.find(x => x.id === r.id) || {};
    const off = opts.date ? L.exceptionOn(lists.exceptions, r.id, opts.date) : null;
    const why = !L.driverActive(d) ? (d.status || 'INACTIVE') : off ? L.exceptionLabel(off) : busy && busy[r.id] ? busy[r.id].replace(/^on /, 'On ') : '';
    const c = { value: r.id, label: r.name, key: r.name };
    if (why && r.id !== current) blocked.push(Object.assign(c, { group: 'blocked', head: 'UNAVAILABLE', reason: why, blocked: !opts.override }));
    else if (r.reliefDriver) relief.push(Object.assign(c, { group: 'relief', head: 'RELIEF DRIVERS' }));
    else regular.push(Object.assign(c, { group: 'regular', head: 'REGULAR DRIVERS' }));
  });
  const cvg = cvgOptions().map(o => ({ value: o.id, label: o.text, key: o.text, group: 'cvg', head: 'OTHER CVG / CARRIERS' }));
  // Joe 10/19 ("it should pop up needed driver"): the empty choice reads NEEDS DRIVER, as on Weekly and the old app.
  const out = [{ value: '', label: NEEDS_DRIVER, key: 'NEEDS DRIVER', group: 'none', find: true }].concat(regular, relief, cvg, blocked);
  const counts = {};
  out.forEach(c => { if (c.head) counts[c.head] = (counts[c.head] || 0) + 1; });
  out.forEach(c => { if (c.head) c.head += ' \u00b7 ' + counts[c.head]; });
  return out;
}

// The same groups as a drop-down (Daily's Edit box): one section per group; Unavailable can be picked only with OVR.
export function driverOptionsHtml(current, busy, opts) {
  const groups = [];
  driverChoices(current, busy, opts).forEach(c => {
    if (c.group === 'none') return;
    const head = String(c.head || '').split(' \u00b7 ')[0];
    let g = groups.find(x => x.head === head);
    if (!g) groups.push(g = { head, items: [] });
    g.items.push(c);
  });
  const label = { 'REGULAR DRIVERS': 'Regular Drivers \u2014 Seniority Order', 'RELIEF DRIVERS': 'Relief Drivers', 'OTHER CVG / CARRIERS': 'Other CVG / Carriers', UNAVAILABLE: 'Unavailable' };
  const opt = (c) => '<option value="' + escapeHtml(c.value) + '"' + (c.value === current ? ' selected' : '') + (c.blocked ? ' disabled' : '') + '>' + escapeHtml(c.label + (c.reason ? '  [' + c.reason + ']' : '')) + '</option>';
  return '<option value="">' + escapeHtml(NEEDS_DRIVER) + '</option>' + groups.map(g => '<optgroup label="' + escapeHtml(label[g.head] || g.head) + '">' + g.items.map(opt).join('') + '</optgroup>').join('');
}

// Operational Assignments that are active, as driver choices (the current app's "Other CVG / Carriers").
export function cvgOptions() { return lists.ops.filter(o => o.active !== false).map(o => ({ id: '__CVG__:' + o.assignment, text: o.assignment })); }

export function pickText(kind, id) {
  if (kind === 'driver' && /^__CVG__:/.test(String(id || ''))) return String(id).slice(8);
  const pool = kind === 'driver' ? lists.allDrivers : kind === 'truck' ? lists.fleetTrucks : lists.fleetTrailers;
  const item = pool.find(o => o.id === id);
  return item ? (kind === 'driver' ? item.name : item.unit) : '';
}

export function openNote(td, current, onPick) {
  const input = document.createElement('input');
  input.className = 'picker';
  input.setAttribute('aria-label', td.dataset.edit === 'time' ? 'Depart time' : td.dataset.edit === 'jack' ? 'Jack number' : 'Driver notes');
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
/*
 * Picks still saving (sent, or waiting in line behind an earlier save to the same run). A live update that does not carry them
 * yet would put the old value back on screen: a driver picked while the trailer's save was going showed the old driver again
 * when the trailer's update came in, and the driver list then had the old driver "On 801". The screen passes each live
 * update's runs through withUnsaved, which puts these picks back on until an update holds the saved revision.
 */
const unsaved = [], fromDatabase = new WeakMap();
const settled = (u) => { const i = unsaved.indexOf(u); if (i >= 0) unsaved.splice(i, 1); };
export function withUnsaved(runs) {
  unsaved.slice().forEach(u => {
    const run = runs.find(r => r.id === u.runDocId);
    if (!run || !run.days || !run.days[u.day] || (u.rev && run.rev >= u.rev)) { settled(u); return; }
    const raw = fromDatabase.get(run) || {};
    if (!raw[u.day]) { raw[u.day] = Object.assign({}, run.days[u.day]); fromDatabase.set(run, raw); }
    u.apply(run.days[u.day]);
  });
  return runs;
}
export function saveRunChange(getRuns, runDocId, day, action, fields, apply, render) {
  const shown = getRuns().find(r => r.id === runDocId);
  if (!shown) return Promise.resolve();
  const before = Object.assign({}, shown.days[day]);
  apply(shown.days[day]);
  render();
  const mine = { runDocId, day, apply, rev: 0 };
  unsaved.push(mine);
  const send = async () => {
    const run = getRuns().find(r => r.id === runDocId) || shown;
    try {
      const out = await save(action, Object.assign({ runDocId, day, expectedRev: run.rev }, fields));
      out.runs.forEach(r => { const target = getRuns().find(x => x.id === r.runDocId); if (target && target.rev < r.rev) target.rev = r.rev; });
      // Kept on screen until a live update holds this revision (or dropped now when the answer names none).
      const saved = out.runs.find(r => r.runDocId === runDocId);
      if (saved && saved.rev) mine.rev = saved.rev; else settled(mine);
      return out;
    } catch (e) {
      settled(mine);
      // Put back what the database holds: on this run, or on the live update that replaced it (with the other picks still saving).
      const now = getRuns().find(r => r.id === runDocId), raw = now && fromDatabase.get(now);
      if (now === shown) { shown.days[day] = before; render(); }
      else if (raw && raw[day]) { now.days[day] = Object.assign({}, raw[day]); unsaved.forEach(u => { if (u.runDocId === runDocId && u.day === day) u.apply(now.days[day]); }); render(); }
      showError(friendlyError(e));
      throw e;
    }
  };
  const next = (queues[runDocId] || Promise.resolve()).then(send);
  queues[runDocId] = next.catch(() => {});
  return next.catch(() => null);
}

// Resolves once every run save already sent or waiting in line has finished (Weekly's Publish waits for them).
export function savesDone() { return Promise.all(Object.values(queues)); }

export function saveAssignment(getRuns, runDocId, day, kind, pick, render, override) {
  const spec = kind === 'note' ? null : KINDS[kind];
  const fields = spec ? { [spec.field]: pick.unit ? '' : pick.id } : { note: pick };
  if (spec && pick.unit) fields.unit = pick.unit; // a typed unit that is not on Equipment Master (Daily)
  // Joe 10/12 ("a small delay when unit not on list when writing in"): a typed unit shows in the cell at once, like a picked one,
  // instead of the cell going blank until the server answers.
  if (override) fields.override = true;
  return saveRunChange(getRuns, runDocId, day, spec ? spec.action : 'setDriverNote', fields,
    (d) => { if (spec) { d[spec.idKey] = /^__CVG__:/.test(pick.id) || pick.unit ? '' : pick.id; d[spec.textKey] = pick.id || pick.unit ? pick.text : ''; } else d.driverNotes = pick; }, render);
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
    showError(friendlyError(e));
  }
}

// Weekly Dispatch order (Joe 10/12): the routes in their new order; shown at once, put back if the server refuses it.
export async function saveWeekOrder(getRuns, weekStart, orderedRows, render) {
  const runs = getRuns(), before = runs.map(r => r.weekOrder);
  orderedRows.forEach((row, i) => runs.filter(r => r.runId === row.runId).forEach(r => { r.weekOrder = (i + 1) * 10; }));
  render();
  try {
    await save('reorderWeek', { weekStart, runIds: orderedRows.map(r => r.runId) });
  } catch (e) {
    runs.forEach((r, i) => { r.weekOrder = before[i]; });
    render();
    showError(friendlyError(e));
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
    showError(friendlyError(e));
    return null;
  }
}

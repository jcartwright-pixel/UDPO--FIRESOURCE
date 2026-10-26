/*
 * Plant Vacations & Schedule and Maintenance Schedule (Joe 10/25, mock-ups 1 and 3): crew.html (the plant's crew: loadout and
 * production on one schedule) and maint-crew.html (maintenance's mechanics). One page, three views from the menu:
 *   Schedule Board  one row per person, their job each day Sunday to Saturday, by shift; a line of the jobs still short of
 *                   people above each area. Click a day to pick another job or Off for that week; Usual puts it back.
 *   Vacations       time off, as on the driver Vacation Schedule; the limit counts the same area and shift.
 *   Setup           areas and their own shift times, jobs and how many each needs, people, and the vacation limits. Every
 *                   box saves when it is left. Administration > Plant Schedule Setup opens this same view.
 * The rules are crew-rules.js (shared with the server, crew.js). Real people are loaded later; the test copy can start from a
 * made-up list.
 */
import { start, requireSignIn, save, escapeHtml, shortDate, showError, optionTag, maySave, watchPerson, buttonsToTop } from './app.js';
import { collection, doc, query, where, onSnapshot } from './firebase.js';
import { plantFor, todayKey } from './pmaint.js';

const L = window.UDLogic, R = window.UDCrew;
const team = document.body.dataset.team === 'maint' ? 'maint' : 'plant';
const params = new URLSearchParams(location.search);
const VIEWS = { board: 'Schedule Board', vacations: 'Vacations', setup: 'Setup' };
let view = VIEWS[params.get('view')] ? params.get('view') : 'board';
let tab = ['areas', 'jobs', 'people', 'limits'].indexOf(params.get('tab')) >= 0 ? params.get('tab') : 'areas';
let plant = params.get('plant') || '', person = null, app = {}, db = null, stops = [];
let week = R.weekStart(todayKey()), shift = 1, area = '', vacShow = 'UPCOMING', editing = null, editCell = '';
const data = { areas: [], jobs: [], people: [], weeks: {}, vacations: [], rules: null, read: {} };
let busy = Promise.resolve();
const esc = escapeHtml, opt = (v, cur, label) => optionTag(v, cur, label);
const day = (k) => (R.isDay(k) ? shortDate(k) : '');
const canEdit = () => maySave(person, L.SAVE_ROLES, app, 'plant');
const canSetup = () => maySave(person, L.REORDER_ROLES, app, 'plant');
const testCopy = /sandbox|^localhost$|^127\.0\.0\.1$/.test(location.hostname);
const areas = () => data.areas.filter(R.active).sort(R.byOrder);
const jobsOf = (areaId) => data.jobs.filter(j => R.active(j) && (!areaId || j.areaId === areaId)).sort(R.byOrder);
const jobName = (id) => { const j = data.jobs.find(x => x.id === id); return j ? j.name : ''; };
const areaName = (id) => { const a = data.areas.find(x => x.id === id); return a ? a.name : ''; };
const people = () => data.people.filter(R.active).sort((a, b) => String(a.name).localeCompare(String(b.name)));
const rules = () => Object.assign({}, R.RULES, data.rules || {});

function send(action, fields, what) {
  const run = busy.then(() => save(action, Object.assign({ facilityId: plant, team }, fields)));
  busy = run.catch(() => {});
  return run.then(out => { showError(''); return out; }, err => { showError((what || 'That change') + ' was not saved (' + (err.message || err) + ').'); render(true); throw err; });
}

/* ---------- top line ---------- */
function drawTop() {
  const pl = plantFor(person, plant);
  document.getElementById('plant-name').textContent = pl.name;
  document.getElementById('page-title').textContent = view === 'setup' ? 'Setup' : view === 'vacations' ? (team === 'maint' ? 'Maintenance Vacations' : 'Plant Vacations') : 'Schedule Board';
  const r = rules();
  document.getElementById('page-sub').textContent = view === 'vacations' ? 'At most ' + r.maxOff + ' off per area and shift a day, ' + r.holidayMaxOff + ' in a holiday week' :
    view === 'board' ? 'Week of ' + day(week) + ' to ' + day(R.addDays(week, 6)) : 'Areas, shift times, jobs, people and vacation limits';
  const areaPick = '<select id="area" class="crew-pick" aria-label="Area">' + opt('', area, 'All areas') + areas().map(a => opt(a.id, area, a.name)).join('') + '</select>';
  let html = '';
  if (view === 'board') {
    html = '<button type="button" id="print">Print</button>' +
      '<div class="stepper"><button type="button" id="prev" aria-label="Previous week">&#9664;</button><input type="date" id="week" value="' + week + '" aria-label="Week"><button type="button" id="next" aria-label="Next week">&#9654;</button></div>' +
      '<div class="tabs" role="tablist" aria-label="Shift">' + R.SHIFTS.map(s => '<button type="button" role="tab" data-shift="' + s + '" aria-selected="' + (s === shift) + '">' + R.SHIFT_NAMES[s] + '</button>').join('') + '</div>' + areaPick;
  } else if (view === 'vacations') {
    html = '<button type="button" class="primary" id="add-vac"' + (canEdit() ? '' : ' disabled') + '>+ Add Time Off</button>' + areaPick +
      '<select id="vac-show" class="crew-pick" aria-label="Which time off">' + opt('UPCOMING', vacShow, 'Upcoming') + opt('ALL', vacShow, 'All') + opt('PAST', vacShow, 'Past') + '</select>';
  } else {
    html = '<div class="tabs" role="tablist" aria-label="Setup">' + [['areas', 'Areas & Shifts'], ['jobs', 'Jobs'], ['people', 'People'], ['limits', 'Vacation Limits']]
      .map(([k, l]) => '<button type="button" role="tab" data-tab="' + k + '" aria-selected="' + (k === tab) + '">' + l + '</button>').join('') + '</div>' +
      (tab === 'areas' || tab === 'jobs' || tab === 'people' ? '<button type="button" class="primary" id="add-row"' + (canSetup() ? '' : ' disabled') + '>+ Add ' + (tab === 'areas' ? 'Area' : tab === 'jobs' ? 'Job' : 'Person') + '</button>' : '');
  }
  document.getElementById('top').innerHTML = html;
}

/* ---------- Schedule Board ---------- */
const CELL = { OFF: ['c-off', 'OFF'], NONE: ['c-none', ''] };
function boardHtml() {
  const days = R.weekDays(week), today = todayKey();
  const list = areas().filter(a => !area || a.id === area);
  let rows = '';
  list.forEach(a => {
    const crew = people().filter(p => p.areaId === a.id && Number(p.shift) === shift);
    const hours = R.shiftText(a, shift);
    rows += '<tr class="group"><td colspan="8">' + esc(a.name) + (hours ? ' · ' + esc(hours) : ' · no ' + R.SHIFT_NAMES[shift] + ' shift') + '</td></tr>';
    const open = days.map(d => R.openJobs(data.jobs, data.people, data.weeks, data.vacations, a.id, shift, d, a));
    if (open.some(o => o.length)) {
      rows += '<tr class="open-row"><td class="left">Open jobs</td>' + open.map(o => '<td>' + o.map(x => esc(x.job.name) + (x.short > 1 ? ' &times;' + x.short : '')).join('<br>') + '</td>').join('') + '</tr>';
    }
    crew.forEach(p => {
      rows += '<tr><td class="left"><b>' + esc(p.name) + '</b><small>' + esc(jobName(p.jobId)) + '</small></td>' + days.map(d => {
        const c = R.cellFor(p, d, data.weeks[R.weekId(p.id, week)], data.vacations), key = p.id + '|' + d;
        if (editCell === key && c.kind !== 'VAC') {
          return '<td class="c-edit"><select data-cell="' + esc(key) + '" aria-label="' + esc(p.name + ' on ' + day(d)) + '">' +
            opt('', '', 'Usual (' + (p.jobId ? jobName(p.jobId) : 'none') + ')') + opt(R.OFF, c.kind === 'OFF' && c.changed ? R.OFF : '', 'Off') +
            areas().map(ar => '<optgroup label="' + esc(ar.name) + '">' + jobsOf(ar.id).map(j => opt(j.id, c.changed ? c.jobId : '', j.name)).join('') + '</optgroup>').join('') + '</select></td>';
        }
        if (c.kind === 'VAC') return '<td class="c-vac" title="Time off: change it on Vacations">' + esc(R.VAC_TYPE_NAMES[c.vacation.type] || 'Vacation Day').replace(' Day', '').toUpperCase() + '</td>';
        const look = c.kind === 'JOB' ? [(data.jobs.find(j => j.id === c.jobId) || {}).relief ? 'c-relief' : '', esc(jobName(c.jobId))] : CELL[c.kind];
        return '<td class="' + look[0] + (c.changed ? ' changed' : '') + (canEdit() ? ' pick' : '') + '" data-key="' + esc(key) + '">' + look[1] + '</td>';
      }).join('') + '</tr>';
    });
    if (!crew.length) rows += '<tr><td colspan="8" class="empty">No one on ' + R.SHIFT_NAMES[shift] + ' shift in ' + esc(a.name) + '.</td></tr>';
  });
  const head = '<tr><th class="left">Employee</th>' + days.map(d => '<th class="' + (d === today ? 'today' : '') + '">' + R.DAY_NAMES[R.dow(d)].toUpperCase() + '<br>' + day(d) + '</th>').join('') + '</tr>';
  const legend = '<div class="crew-legend"><span class="c-relief">Relief</span><span class="c-off">Off</span><span class="c-vac">Vacation</span><span class="open-key">Open job</span><span class="changed-key">Changed this week</span></div>';
  return legend + '<div class="sheet scroll-list crew-board"><table><colgroup><col class="who">' + days.map(() => '<col>').join('') + '</colgroup><thead>' + head + '</thead><tbody>' + rows + '</tbody></table></div>' +
    '<div class="foot">' + (canEdit() ? 'Click a day to give that person another job or Off for this week; Usual puts it back. ' : 'View only. ') + 'Vacation days come from Vacations.</div>';
}

/* ---------- Vacations ---------- */
function vacForm() {
  const v = editing === 'new' ? { status: 'APPROVED', type: 'VACATION' } : data.vacations.find(x => x.id === editing);
  if (!v) return '';
  return '<form class="crew-form" id="vac-form">' +
    '<label>Employee<select name="personId" required>' + opt('', v.personId || '', '') + people().map(p => opt(p.id, v.personId, p.name + ' · ' + areaName(p.areaId) + ' ' + R.SHIFT_NAMES[p.shift])).join('') + '</select></label>' +
    '<label>First day<input type="date" name="startDate" value="' + esc(v.startDate || '') + '" required></label>' +
    '<label>Last day<input type="date" name="endDate" value="' + esc(v.endDate || '') + '"></label>' +
    '<label>Type<select name="type">' + R.VAC_TYPES.map(t => opt(t, v.type, R.VAC_TYPE_NAMES[t])).join('') + '</select></label>' +
    '<label>Status<select name="status">' + R.VAC_STATUSES.map(s => opt(s, v.status, s.charAt(0) + s.slice(1).toLowerCase())).join('') + '</select></label>' +
    '<label class="wide">Notes<input name="notes" maxlength="300" value="' + esc(v.notes || '') + '" autocomplete="off"></label>' +
    '<div class="form-buttons"><button type="submit" class="primary">Save Time Off</button><button type="button" id="vac-cancel">Cancel</button></div></form>';
}
function vacationsHtml() {
  const today = todayKey(), who = {};
  data.people.forEach(p => { who[p.id] = p; });
  const list = data.vacations.filter(v => who[v.personId] && (!area || who[v.personId].areaId === area))
    .filter(v => vacShow === 'ALL' || (vacShow === 'PAST' ? (v.endDate || v.startDate) < today : (v.endDate || v.startDate) >= today))
    .sort((a, b) => vacShow === 'PAST' ? String(b.startDate).localeCompare(a.startDate) : String(a.startDate).localeCompare(b.startDate));
  const st = (s) => '<span class="crew-pill ' + String(s).toLowerCase() + '">' + esc(String(s).charAt(0) + String(s).slice(1).toLowerCase()) + '</span>';
  return vacForm() + '<div class="sheet scroll-list"><table><thead><tr><th class="left">Employee</th><th>Area</th><th>Shift</th><th>First day</th><th>Last day</th><th>Days</th><th>Status</th><th class="left">Notes</th><th></th></tr></thead><tbody>' +
    (list.map(v => { const p = who[v.personId]; return '<tr><td class="left"><b>' + esc(p.name) + '</b> <span class="crew-type">' + esc(R.VAC_TYPE_NAMES[v.type] || '') + '</span></td><td>' + esc(areaName(p.areaId)) + '</td><td>' + R.SHIFT_NAMES[p.shift] + '</td>' +
      '<td>' + day(v.startDate) + '</td><td>' + day(v.endDate || v.startDate) + '</td><td>' + R.vacationDays(v) + '</td><td>' + st(v.status) + '</td><td class="left">' + esc(v.notes || '') + '</td>' +
      '<td>' + (canEdit() ? '<button type="button" class="link" data-vac="' + esc(v.id) + '">Edit</button>' : '') + '</td></tr>'; }).join('') ||
      '<tr><td colspan="9" class="empty">' + (data.read.vacations ? 'No time off ' + (vacShow === 'PAST' ? 'in the past.' : vacShow === 'ALL' ? 'yet.' : 'coming up.') : 'Reading the vacations…') + '</td></tr>') +
    '</tbody></table></div><div class="foot">Same rules as the driver Vacation Schedule: the same kinds of days and holiday weeks. An approved day shows on the Schedule Board.</div>';
}

/* ---------- Setup ---------- */
const dis = () => (canSetup() ? '' : ' disabled');
const daysBoxes = (list, key) => '<span class="crew-days">' + R.DAY_NAMES.map((n, i) => '<label><input type="checkbox" data-day="' + i + '" data-k="' + key + '"' + ((list || []).indexOf(i) >= 0 ? ' checked' : '') + dis() + '>' + n + '</label>').join('') + '</span>';
const inUse = (x) => '<select data-status="1" aria-label="In use"' + dis() + '>' + opt('ACTIVE', x.status || 'ACTIVE', 'In use') + opt('RETIRED', x.status, 'Taken off') + '</select>';
function setupHtml() {
  let html = '';
  const empty = (n) => '<tr><td colspan="' + n + '" class="empty">' + (data.read.people ? 'Nothing yet. + Add puts the first one on the list.' : 'Reading…') + '</td></tr>';
  const blank = editing === 'new-' + tab;
  if (tab === 'areas') {
    const rows = (blank ? [{ id: '', name: '', shifts: {}, days: [1, 2, 3, 4, 5] }] : []).concat(data.areas.slice().sort(R.byOrder));
    html = '<table><thead><tr><th class="left">Area</th>' + R.SHIFTS.map(s => '<th>' + R.SHIFT_NAMES[s] + ' shift</th>').join('') + '<th>Days it runs</th><th>In use</th></tr></thead><tbody>' +
      (rows.map(a => '<tr data-op="area" data-id="' + esc(a.id) + '"><td class="left"><input data-k="name" maxlength="40" value="' + esc(a.name) + '" placeholder="Area name"' + dis() + '></td>' +
        R.SHIFTS.map(s => { const t = (a.shifts || {})[s] || {}; return '<td class="nowrap"><input type="time" data-shift="' + s + '" data-end="start" value="' + esc(t.start || '') + '"' + dis() + '> - <input type="time" data-shift="' + s + '" data-end="end" value="' + esc(t.end || '') + '"' + dis() + '></td>'; }).join('') +
        '<td>' + daysBoxes(a.days, 'days') + '</td><td>' + (a.id ? inUse(a) : '') + '</td></tr>').join('') || empty(6)) + '</tbody></table>';
  } else if (tab === 'jobs') {
    const rows = (blank ? [{ id: '', name: '', areaId: area || (areas()[0] || {}).id || '', need: { 1: 1, 2: 0, 3: 0 } }] : []).concat(data.jobs.filter(j => !area || j.areaId === area).sort((a, b) => areaName(a.areaId).localeCompare(areaName(b.areaId)) || R.byOrder(a, b)));
    html = '<table><thead><tr><th class="left">Job</th><th>Area</th>' + R.SHIFTS.map(s => '<th>People ' + R.SHIFT_NAMES[s] + '</th>').join('') + '<th>Relief job</th><th>In use</th></tr></thead><tbody>' +
      (rows.map(j => '<tr data-op="job" data-id="' + esc(j.id) + '"><td class="left"><input data-k="name" maxlength="50" value="' + esc(j.name) + '" placeholder="Job name"' + dis() + '></td>' +
        '<td><select data-k="areaId"' + dis() + '>' + areas().map(a => opt(a.id, j.areaId, a.name)).join('') + '</select></td>' +
        R.SHIFTS.map(s => '<td><input type="number" min="0" max="50" class="num" data-need="' + s + '" value="' + esc((j.need || {})[s] || 0) + '"' + dis() + '></td>').join('') +
        '<td><input type="checkbox" data-k="relief"' + (j.relief ? ' checked' : '') + dis() + '></td><td>' + (j.id ? inUse(j) : '') + '</td></tr>').join('') || empty(7)) + '</tbody></table>';
  } else if (tab === 'people') {
    const rows = (blank ? [{ id: '', name: '', areaId: area || '', shift: shift, daysOff: [0, 6] }] : []).concat(data.people.filter(p => !area || p.areaId === area).sort((a, b) => String(a.name).localeCompare(b.name)));
    html = '<table><thead><tr><th class="left">Name</th><th>Employee ID</th><th>Phone</th><th>Area</th><th>Shift</th><th>Usual job</th><th>Days off</th><th>Hire date</th><th>In use</th></tr></thead><tbody>' +
      (rows.map(p => '<tr data-op="person" data-id="' + esc(p.id) + '"><td class="left"><input data-k="name" maxlength="60" value="' + esc(p.name) + '" placeholder="LAST, FIRST"' + dis() + '></td>' +
        '<td><input data-k="employeeId" maxlength="20" class="short" value="' + esc(p.employeeId || '') + '"' + dis() + '></td><td><input data-k="phone" maxlength="20" class="short" value="' + esc(p.phone || '') + '"' + dis() + '></td>' +
        '<td><select data-k="areaId"' + dis() + '>' + opt('', p.areaId || '', '') + areas().map(a => opt(a.id, p.areaId, a.name)).join('') + '</select></td>' +
        '<td><select data-k="shift"' + dis() + '>' + R.SHIFTS.map(s => opt(String(s), String(p.shift || 1), R.SHIFT_NAMES[s])).join('') + '</select></td>' +
        '<td><select data-k="jobId"' + dis() + '>' + opt('', p.jobId || '', '') + jobsOf(p.areaId).map(j => opt(j.id, p.jobId, j.name)).join('') + '</select></td>' +
        '<td>' + daysBoxes(p.daysOff, 'daysOff') + '</td><td><input type="date" data-k="hireDate" value="' + esc(p.hireDate || '') + '"' + dis() + '></td><td>' + (p.id ? inUse(p) : '') + '</td></tr>').join('') || empty(9)) + '</tbody></table>';
  } else {
    const r = rules();
    html = '<div class="crew-limits"><label>Most people off a day, per area and shift<input type="number" min="0" max="50" data-rule="maxOff" value="' + esc(r.maxOff) + '"' + dis() + '></label>' +
      '<label>In a holiday week (New Year\'s, Memorial Day, 4th of July, Labor Day, Thanksgiving, Deer Season, Christmas)<input type="number" min="0" max="50" data-rule="holidayMaxOff" value="' + esc(r.holidayMaxOff) + '"' + dis() + '></label></div>';
  }
  const starter = testCopy && canSetup() && data.read.people && !data.people.length ? '<div class="crew-starter">Test copy: <button type="button" id="starter">Fill in a made-up starting list</button> (made-up people, so the screens can be tried before the real list is loaded)</div>' : '';
  return starter + '<div class="sheet scroll-list crew-setup">' + html + '</div><div class="foot">' + (canSetup() ? 'Every box saves when you leave it. ' : 'View only: a manager or administrator changes the setup. ') +
    'Only name, employee ID, phone, area, shift, usual job, days off and hire date are kept.</div>';
}

function render(force) {
  if (!person) return;
  const body = document.getElementById('body');
  if (force !== true && body.contains(document.activeElement) && document.activeElement.matches('input:not([type=checkbox]), select, textarea')) return;
  drawTop();
  if (!data.read.people && !data.read.areas) body.innerHTML = '<p class="empty">Reading…</p>';
  else body.innerHTML = view === 'board' ? (people().length ? boardHtml() : setupHint()) : view === 'vacations' ? vacationsHtml() : setupHtml();
  const sel = body.querySelector('select[data-cell]');
  if (sel) sel.focus();
}
const setupHint = () => '<p class="empty">No one is on the ' + (team === 'maint' ? 'maintenance' : 'plant') + ' schedule yet. Add the areas, jobs and people on <a href="?view=setup">Setup</a>.</p>';
const setUrl = () => { const u = new URL(location.href); u.searchParams.set('plant', plant); if (view !== 'board') u.searchParams.set('view', view); else u.searchParams.delete('view'); if (view === 'setup') u.searchParams.set('tab', tab); else u.searchParams.delete('tab'); history.replaceState(null, '', u); };

/* ---------- clicks and boxes ---------- */
const top = document.getElementById('top'), body = document.getElementById('body');
top.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.shift) { shift = Number(b.dataset.shift); editCell = ''; render(true); }
  else if (b.dataset.tab) { tab = b.dataset.tab; editing = null; setUrl(); render(true); }
  else if (b.id === 'prev' || b.id === 'next') { week = R.addDays(week, b.id === 'prev' ? -7 : 7); editCell = ''; follow(); }
  else if (b.id === 'add-vac') { editing = 'new'; render(true); }
  else if (b.id === 'add-row') { editing = 'new-' + tab; render(true); const n = body.querySelector('tr[data-id=""] [data-k="name"]'); if (n) n.focus(); }
  else if (b.id === 'print') window.print();
});
top.addEventListener('change', e => {
  if (e.target.id === 'area') { area = e.target.value; render(true); }
  else if (e.target.id === 'vac-show') { vacShow = e.target.value; render(true); }
  else if (e.target.id === 'week' && R.isDay(e.target.value)) { week = R.weekStart(e.target.value); follow(); }
});
body.addEventListener('click', e => {
  const t = e.target;
  if (t.id === 'starter') { t.disabled = true; send('saveCrewSetup', { op: 'starter' }, 'The starting list').catch(() => {}); return; }
  if (t.id === 'vac-cancel') { editing = null; render(true); return; }
  if (t.dataset.vac) { editing = t.dataset.vac; render(true); return; }
  const cell = t.closest('td.pick[data-key]');
  if (cell && canEdit()) { editCell = cell.dataset.key; render(true); }
});
body.addEventListener('submit', e => {
  e.preventDefault();
  const f = new FormData(e.target), fields = {};
  f.forEach((v, k) => { fields[k] = String(v).trim(); });
  if (editing && editing !== 'new') fields.vacationId = editing;
  send('saveCrewVacation', fields, 'The time off').then(() => { editing = null; render(true); }, () => {});
});
// A day picked on the board saves at once; leaving the box without a pick closes it.
body.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.cell) {
    const [personId, d] = t.dataset.cell.split('|');
    editCell = '';
    send('saveCrewDay', { personId, day: d, value: t.value }, 'The day').catch(() => {});
    render(true);
    return;
  }
  if (t.dataset.rule) return send('saveCrewSetup', { op: 'rules', fields: { [t.dataset.rule]: Number(t.value) } }, 'The limit').catch(() => {});
  const row = t.closest('tr[data-op]');
  if (!row || !canSetup()) return;
  const op = row.dataset.op, id = row.dataset.id, fields = {};
  if (t.dataset.status) return send('saveCrewSetup', { op, id, status: t.value }, 'That line').catch(() => {});
  if (t.dataset.day !== undefined) fields[t.dataset.k] = [...row.querySelectorAll('input[data-k="' + t.dataset.k + '"]:checked')].map(x => Number(x.dataset.day));
  else if (t.dataset.end) {
    const s = t.dataset.shift, start = row.querySelector('[data-shift="' + s + '"][data-end="start"]').value, end = row.querySelector('[data-shift="' + s + '"][data-end="end"]').value;
    if ((start && !end) || (!start && end)) return;
    const shifts = {};
    R.SHIFTS.forEach(n => { const a = row.querySelector('[data-shift="' + n + '"][data-end="start"]').value, b = row.querySelector('[data-shift="' + n + '"][data-end="end"]').value; if (a && b) shifts[n] = { start: a, end: b }; });
    fields.shifts = shifts;
  } else if (t.dataset.need) {
    const need = {};
    R.SHIFTS.forEach(n => { need[n] = Number(row.querySelector('[data-need="' + n + '"]').value) || 0; });
    fields.need = need;
  } else if (t.dataset.k === 'relief') fields.relief = t.checked;
  else if (t.dataset.k === 'shift') fields.shift = Number(t.value);
  else if (t.dataset.k) fields[t.dataset.k] = t.value.trim();
  if (!id) {
    // A new line is made once it has a name; what was filled in before that goes with it.
    const name = row.querySelector('[data-k="name"]').value.trim();
    if (!name) return;
    Object.assign(fields, { name });
    row.querySelectorAll('select[data-k]').forEach(s => { if (s.value) fields[s.dataset.k] = s.dataset.k === 'shift' ? Number(s.value) : s.value; });
  }
  send('saveCrewSetup', { op, id, fields }, 'That line').then(() => { if (!id) editing = null; render(true); }, () => {});
});
body.addEventListener('focusout', e => { if (e.target.dataset && e.target.dataset.cell) setTimeout(() => { if (editCell && !body.contains(document.activeElement)) { editCell = ''; render(true); } }, 150); });
body.addEventListener('keydown', e => {
  if (e.key === 'Escape' && editCell) { editCell = ''; render(true); }
  if (e.key === 'Enter' && e.target.matches('tr[data-op] input')) e.target.blur();
});
window.udBack = () => { if (editing || editCell) { editing = null; editCell = ''; render(true); return true; } return false; };

/* ---------- reading ---------- */
function follow() {
  stops.forEach(s => s());
  stops = [];
  if (!db || !plant) return;
  const fail = (what) => (e) => showError('Could not read the ' + what + ' (' + e.message + '). Check the network and reload the page.');
  const mine = (name, key) => onSnapshot(query(collection(db, name), where('facilityId', '==', plant)), s => {
    data[key] = s.docs.map(d => Object.assign({}, d.data(), { id: d.id })).filter(d => d.team === team);
    data.read[key] = true;
    render();
  }, fail(name));
  stops.push(mine('crewAreas', 'areas'), mine('crewJobs', 'jobs'), mine('crewPeople', 'people'), mine('crewVacations', 'vacations'));
  stops.push(onSnapshot(query(collection(db, 'crewWeeks'), where('weekStart', '==', week)), s => {
    data.weeks = {};
    s.docs.forEach(d => { const w = d.data(); if (w.facilityId === plant && w.team === team) data.weeks[R.weekId(w.personId, w.weekStart)] = w; });
    render();
  }, fail('week')));
  stops.push(onSnapshot(doc(db, 'crewRules', plant + '_' + team), s => { data.rules = s.exists() ? s.data() : null; render(); }, fail('limits')));
  render(true);
}

requireSignIn(async (user) => {
  ({ db } = await start());
  watchPerson(db, user, p => { const first = !person; person = p; plant = plantFor(person, plant).id; if (first) { setUrl(); follow(); } else render(true); }, { withEmail: true });
  onSnapshot(doc(db, 'config', 'app'), s => { app = s.data() || {}; render(true); });
  buttonsToTop();
});

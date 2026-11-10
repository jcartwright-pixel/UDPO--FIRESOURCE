/*
 * The plant pop-up on the Hub's Plant Operations and Route Distribution cards (Joe 11-10-26: "when I click on plant, it should
 * be able to direct me to like a pop-up to ask me which one, but right beside it, maybe a recap of all the plants"; he picked
 * "Pop-up with a recap per plant"). The card asks which plant, shows each plant's day beside it, and opens that plant
 * (?plant=, which Operations already takes).
 *
 * Read only. Each plant's numbers come from that plant's own Operations database (runs, maintenance), worked out the same way
 * as Operations' all-plants overview (public/company.html: plant-core.js loadoutRows and counts): today's loads (the day rolls
 * at 6 AM) plus last night's loads still open, done / loading / waiting; and the trucks and trailers with an open problem.
 * The plants and who may see which are Operations' (functions/src/logic.js PLANTS and plantsFor); a test keeps them the same.
 */
'use strict';

// Operations' plants (functions/src/logic.js PLANTS). A plant not running in the app yet is PLANNED.
const PLANTS = Object.freeze([
  { id: 'fac_uniontown', name: 'Uniontown', status: 'ACTIVE', db: '(default)' },
  { id: 'fac_charleston', name: 'Charleston', status: 'PLANNED', db: 'charleston' },
  { id: 'fac_martins_ferry', name: 'Martins Ferry', status: 'PLANNED', db: 'martins-ferry' }
]);
const HOME_PLANT = 'fac_uniontown';
const ADMIN_ROLES = ['ADMINISTRATOR', 'ADMIN'];
const roleKey = (r) => String(r || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
const isAdmin = (p) => (p && p.roles || []).some(r => ADMIN_ROLES.indexOf(roleKey(r)) >= 0);

/** The plants a person works in, as Operations decides (logic.js plantsFor): '*' or an administrator with none = every plant. */
function plantsFor(person) {
  if (!person || String(person.status || '').trim().toUpperCase() !== 'ACTIVE') return [];
  const list = (person.facilities || []).map(String);
  if (list.indexOf('*') >= 0 || (!list.length && isAdmin(person))) return PLANTS.map(p => p.id);
  const known = PLANTS.map(p => p.id).filter(id => list.indexOf(id) >= 0);
  return known.length ? known : [HOME_PLANT];
}

// The plant's clock (timing-rules.js): New York time, the day rolls over at 6 AM.
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
function operatingDay(nowMs) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(nowMs)).reduce((o, p) => (o[p.type] = p.value, o), {});
  const key = parts.year + '-' + parts.month + '-' + parts.day;
  return Number(parts.hour) < 6 ? addDays(key, -1) : key;
}
const noon = (key) => Date.parse(key + 'T12:00:00Z');
function addDays(key, n) { return new Date(noon(key) + n * 86400000).toISOString().slice(0, 10); }
const dayIndex = (key) => new Date(noon(key)).getUTCDay();
const weekStart = (key) => addDays(key, -dayIndex(key));

// logic.js loadBlocksFor: the days of a run that load on loadDate (a day's load day is its delivery day plus loadDayOffset,
// -1 when not set), inside the Live week the run belongs to.
function loadOffset(v) {
  if (v === null || v === undefined || v === '') return -1;
  const n = Number(v);
  return isFinite(n) ? Math.max(-6, Math.min(0, Math.round(n))) : -1;
}
function loadDaysOf(run, loadDate) {
  return DAYS.filter(prefix => {
    const day = run.days && run.days[prefix];
    if (!day || !day.runs) return false;
    const delivery = addDays(loadDate, -loadOffset(day.loadDayOffset));
    return DAYS[dayIndex(delivery)] === prefix && weekStart(delivery) === run.weekStart;
  });
}
// plant-core.js areaOf / runArea: a load is the plant's when its day's (or the run's) load type is a loadout area.
function areaOf(t) {
  t = String(t || '').trim().toUpperCase();
  if (t === 'CASE LOADOUT' || t === 'CASE') return 'CASE';
  if (t === 'TOTE' || t === 'TOTES' || t === 'TOTE LOADOUT') return 'TOTES';
  if (t === 'BOXING' || t === 'BOX' || t === 'BOXES' || t === 'BOX LOADOUT') return 'BOXING';
  if (t === 'TANKER' || t === 'TANKER LOADOUT') return 'TANKER';
  return '';
}
function plantLoad(run, prefix) {
  const day = run.days[prefix], own = String(day && day.loadType || '').trim().toUpperCase();
  if (own === 'NONE') return false;
  return !!(areaOf(own) || areaOf(run.loadType || (run.masterShow && run.masterShow.loadType) || ''));
}
// plant-core.js loadState (logic.js isLoaded): DONE, LOADING (not paused) or waiting.
const LOADED = ['COMPLETE', 'COMPLETED', 'LOADED', 'READY'], YES = ['TRUE', 'YES', 'Y', '1', 'LOADED', 'COMPLETE'];
function stateOf(day) {
  const s = String(day.loadStatus || '').trim().toUpperCase();
  if (String(day.completeTime || '').trim() || day.loadedComplete === true || YES.indexOf(String(day.loadedComplete == null ? '' : day.loadedComplete).trim().toUpperCase()) >= 0 || LOADED.indexOf(s) >= 0) return 'DONE';
  if (s === 'PAUSED') return 'PAUSED';
  return s === 'LOADING' || String(day.plantStartedAt || '').trim() ? 'LOADING' : 'WAITING';
}
const activeRun = (run) => String(run.routeStatus || 'ACTIVE').trim().toUpperCase() === 'ACTIVE' && run.active !== false;

/** Today's loads at one plant from its runs: today's, and last night's still open (as the Loadout Center carries them). */
function loadCounts(runs, today) {
  const c = { total: 0, done: 0, loading: 0, waiting: 0 }, yesterday = addDays(today, -1);
  const add = (state) => { c.total++; c[state === 'DONE' ? 'done' : state === 'LOADING' ? 'loading' : 'waiting']++; };
  (runs || []).filter(activeRun).forEach(run => {
    loadDaysOf(run, today).forEach(p => { if (plantLoad(run, p)) add(stateOf(run.days[p])); });
    loadDaysOf(run, yesterday).forEach(p => { const s = plantLoad(run, p) && stateOf(run.days[p]); if (s && s !== 'DONE') add(s); });
  });
  return c;
}

// Operations' overview reads the same: maintenance not finished, for trucks, trailers and fork trucks; one per unit.
const CLOSED = ['COMPLETE', 'COMPLETED', 'CLOSED', 'RESOLVED', 'REPAIRED', 'REMOVED'];
function unitsWithProblems(records) {
  const units = new Set();
  (records || []).forEach(r => {
    if (['TRUCK', 'TRAILER', 'FORK_TRUCK'].indexOf(String(r.kind || '').toUpperCase()) < 0) return;
    if (CLOSED.indexOf(String(r.status || 'OPEN').trim().toUpperCase()) >= 0 || !r.record_id) return;
    const unit = String(r.truck_number || r.trailer_number || r.unit_number || '').trim().toUpperCase().replace(/^[A-Z]+-?/, '').replace(/^0+/, '');
    units.add(String(r.kind).toUpperCase() + '|' + (unit || r.record_id));
  });
  return units.size;
}

/**
 * One row per plant this person works in: name, whether it is running in the app yet, today's loads and trucks with a problem.
 * dbFor(name) opens a plant's database ('(default)' is Uniontown's). A plant whose database cannot be read says so.
 */
async function plantRecap(dbFor, person, nowMs) {
  const today = operatingDay(nowMs === undefined ? Date.now() : nowMs);
  const weeks = [...new Set([0, 1, 2, 3, 4, 5, 6, 7].map(n => weekStart(addDays(today, n - 1))))];
  const mine = plantsFor(person);
  return {
    today,
    plants: await Promise.all(PLANTS.filter(p => mine.indexOf(p.id) >= 0).map(async (p) => {
      const row = { id: p.id, name: p.name, live: p.status === 'ACTIVE' };
      try {
        const db = dbFor(p.db);
        const [runs, maint] = await Promise.all([
          db.collection('runs').where('weekStart', 'in', weeks).get(),
          db.collection('maintenance').where('status', 'not-in', CLOSED).get()
        ]);
        row.loads = loadCounts(runs.docs.map(d => d.data()), today);
        row.units = unitsWithProblems(maint.docs.map(d => d.data()));
      } catch (err) {
        // A plant that is not set up yet has no database: nothing to show, but it can still be opened.
        row.unread = true;
      }
      return row;
    }))
  };
}

module.exports = { PLANTS, HOME_PLANT, plantsFor, operatingDay, loadCounts, unitsWithProblems, plantRecap };

/*
 * Plant Maintenance's rules (Joe 10/12: like the garage work orders, but for the plant's machinery), shared by the screens and
 * the server (one file, copied unchanged to public/js/pmaint-rules.js; a unit test checks the two match).
 *
 *   - a plant's machinery is its production lines (the active PRODUCTION_AREA rows of Plant Operations, the same lines as
 *     Plant Production and Products) plus every machine added on Machinery (plantMachines). A line comes in by itself; its
 *     make, model, serial and the rest are kept on a plantMachines record with the line's own id;
 *   - a retired machine stays on file (its history is kept) but leaves the list;
 *   - a breakdown on Shift Notes becomes a work order with Send to Maintenance; the machine is the one whose name matches the
 *     entry's Equipment / area box, else the words typed there;
 *   - work orders are numbered M-1001, M-1002, ... per plant; NEW, WORKING and PARTS are open, DONE is closed;
 *   - a PM task repeats every so many days, weeks or months from the day it was last done; it is LATE after its due day,
 *     WEEK when due this week (Sunday to Saturday), SOON within 30 days, else LATER.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.UDPlantMaint = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var KINDS = ['Production line', 'Machine', 'Utility', 'Building', 'Other'];
  var FIELDS = ['name', 'area', 'kind', 'make', 'model', 'serial', 'location', 'installed', 'notes'];
  var WO_STATUS = { NEW: 'New', WORKING: 'Being worked', PARTS: 'Waiting on parts', DONE: 'Done' };
  var OPEN = ['NEW', 'WORKING', 'PARTS'];
  var UNITS = ['DAYS', 'WEEKS', 'MONTHS'];
  var UNIT_WORD = { DAYS: ['day', 'days'], WEEKS: ['week', 'weeks'], MONTHS: ['month', 'months'] };
  var FIRST_WO = 1001;

  function text(v) { return v === null || v === undefined ? '' : String(v).trim(); }
  function upper(v) { return text(v).toUpperCase(); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function isDay(v) { return /^\d{4}-\d\d-\d\d$/.test(text(v)); }
  function dayOf(key) { var p = text(key).split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
  function keyOf(d) { return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function addDays(key, n) { var d = dayOf(key); d.setUTCDate(d.getUTCDate() + n); return keyOf(d); }
  function daysBetween(a, b) { return Math.round((dayOf(b) - dayOf(a)) / 86400000); }

  // The plant's production lines (plantSetup docs) as machines.
  function lineMachines(setup, facilityId) {
    return (setup || []).filter(function (d) {
      return upper(d.type) === 'PRODUCTION_AREA' && upper(d.status) === 'ACTIVE' && (text(d.facilityId) || 'fac_uniontown') === facilityId;
    }).map(function (d) {
      return { id: text(d.operationId), name: text(d.name) || text(d.area) || text(d.operationId), area: '', kind: 'Production line', line: true, order: Number(d.viewSequence) || 0 };
    });
  }
  // Every machine of the plant: its lines, with what was saved about them, then the machines added on Machinery. Retired ones
  // only when asked for (withRetired).
  function machines(setup, saved, facilityId, withRetired) {
    var mine = (saved || []).filter(function (m) { return text(m.facilityId) === facilityId; });
    var byId = {};
    mine.forEach(function (m) { byId[text(m.id || m.machineId)] = m; });
    var out = lineMachines(setup, facilityId).map(function (l) {
      var s = byId[l.id] || {};
      delete byId[l.id];
      var m = { id: l.id, line: true, order: l.order, facilityId: facilityId, status: upper(s.status) || 'ACTIVE' };
      FIELDS.forEach(function (f) { m[f] = text(s[f]); });
      m.name = l.name;
      m.kind = m.kind || l.kind;
      return m;
    });
    Object.keys(byId).forEach(function (id) {
      var s = byId[id], m = { id: id, line: false, order: 0, facilityId: facilityId, status: upper(s.status) || 'ACTIVE' };
      FIELDS.forEach(function (f) { m[f] = text(s[f]); });
      if (m.name) out.push(m);
    });
    return out.filter(function (m) { return withRetired || m.status !== 'RETIRED'; }).sort(function (a, b) {
      return (a.area || 'ZZZ').localeCompare(b.area || 'ZZZ') || (b.line - a.line) || (a.order - b.order) || a.name.localeCompare(b.name);
    });
  }
  // The machine an entry's Equipment / area box names (same name, any case), or null.
  function findMachine(list, words) {
    var k = upper(words).replace(/\s+/g, ' ');
    if (!k) return null;
    return (list || []).filter(function (m) { return upper(m.name).replace(/\s+/g, ' ') === k; })[0] || null;
  }

  function woNumber(n) { return 'M-' + n; }
  function isOpen(wo) { return OPEN.indexOf(upper(wo && wo.status) || 'NEW') >= 0; }
  function statusWord(s) { return WO_STATUS[upper(s) || 'NEW'] || text(s); }

  // PM tasks: the next due day from the day last done.
  function nextDue(lastDone, every, unit) {
    var n = Number(every), u = upper(unit);
    if (!isDay(lastDone) || !Number.isInteger(n) || n < 1 || UNITS.indexOf(u) < 0) return '';
    if (u === 'DAYS') return addDays(lastDone, n);
    if (u === 'WEEKS') return addDays(lastDone, 7 * n);
    var d = dayOf(lastDone), day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + n);
    var last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
    return keyOf(d);
  }
  function everyText(every, unit) {
    var n = Number(every), w = UNIT_WORD[upper(unit)];
    if (!w || !n) return '';
    return 'Every ' + (n === 1 ? w[0] : n + ' ' + w[1]);
  }
  // The week (Sunday to Saturday) a day is in.
  function weekOf(today) { var dow = dayOf(today).getUTCDay(); return { start: addDays(today, -dow), end: addDays(today, 6 - dow) }; }
  // LATE, WEEK, SOON or LATER for a task due on due (yyyy-mm-dd), seen on today.
  function pmState(due, today) {
    if (!isDay(due) || !isDay(today)) return '';
    if (due < today) return 'LATE';
    if (due <= weekOf(today).end) return 'WEEK';
    return daysBetween(today, due) <= 30 ? 'SOON' : 'LATER';
  }
  function daysLate(due, today) { return isDay(due) && isDay(today) && due < today ? daysBetween(due, today) : 0; }

  return { KINDS: KINDS, FIELDS: FIELDS, WO_STATUS: WO_STATUS, OPEN: OPEN, UNITS: UNITS, FIRST_WO: FIRST_WO, lineMachines: lineMachines, machines: machines, findMachine: findMachine,
    woNumber: woNumber, isOpen: isOpen, statusWord: statusWord, nextDue: nextDue, everyText: everyText, weekOf: weekOf, pmState: pmState, daysLate: daysLate, addDays: addDays };
});

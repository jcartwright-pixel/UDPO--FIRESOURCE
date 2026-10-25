/*
 * Plant Schedule & Vacations (Joe 10/25, mock-ups 1 and 3): who works which job each shift, their time off, and the setup
 * (areas, each area's own shift times, jobs, people, vacation limits). Shared by the screens and the server (one file, copied
 * unchanged to public/js/crew-rules.js; a unit test checks the two match).
 *
 *   - a team is the plant's hourly crew (plant: fillers, processing, loadout, sanitation, relief) or Plant Maintenance's
 *     mechanics (maint); each keeps its own areas, jobs, people and vacations;
 *   - an area has its own shift times (Joe: filler shifts are not loadout shifts); a job sits in one area and says how many
 *     people it needs on each shift; a relief job covers the others;
 *   - a person has an area, a shift, a usual job and usual days off; the Schedule Board shows that every week unless a day was
 *     changed for that week, or an approved vacation day takes them off;
 *   - vacations follow the driver Vacation Schedule (same day types and holiday weeks); the daily limit counts the people of
 *     the same area and shift, at most rules.maxOff, or rules.holidayMaxOff in a holiday week;
 *   - only name, employee ID, phone, area, shift, usual job, days off and hire date are kept about a person.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.UDCrew = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var TEAMS = { plant: 'Plant Schedule & Vacations', maint: 'Maintenance Schedule' };
  var SHIFTS = [1, 2, 3];
  var SHIFT_NAMES = { 1: '1st', 2: '2nd', 3: '3rd' };
  var DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var OFF = 'OFF';
  var VAC_TYPES = ['VACATION', 'PERSONAL', 'SICK', 'BEREAVEMENT', 'UNPAID'];
  var VAC_TYPE_NAMES = { VACATION: 'Vacation Day', PERSONAL: 'Personal Day', SICK: 'Sick Day', BEREAVEMENT: 'Bereavement Day', UNPAID: 'Unpaid Day' };
  var VAC_STATUSES = ['APPROVED', 'PENDING', 'DENIED', 'CANCELLED'];
  var RULES = { maxOff: 2, holidayMaxOff: 1 };
  var PERSON_FIELDS = ['name', 'employeeId', 'phone', 'areaId', 'shift', 'jobId', 'daysOff', 'hireDate'];

  function text(v) { return v === null || v === undefined ? '' : String(v).trim(); }
  function isDay(v) { return /^\d{4}-\d\d-\d\d$/.test(text(v)); }
  function isTime(v) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(text(v)); }
  function addDays(key, n) { var d = new Date(key + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function dow(key) { return new Date(key + 'T12:00:00Z').getUTCDay(); }
  // Weeks run Sunday to Saturday.
  function weekStart(key) { return addDays(key, -dow(key)); }
  function weekDays(start) { var out = []; for (var i = 0; i < 7; i++) out.push(addDays(start, i)); return out; }
  function slug(v) { return text(v).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40); }
  // 06:00 -> 6:00 AM
  function timeText(t) {
    if (!isTime(t)) return '';
    var h = Number(t.slice(0, 2)), m = t.slice(3);
    return (h % 12 || 12) + ':' + m + (h < 12 ? ' AM' : ' PM');
  }
  function shiftText(area, n) {
    var s = area && area.shifts && area.shifts[n];
    return s && isTime(s.start) && isTime(s.end) ? timeText(s.start) + ' - ' + timeText(s.end) : '';
  }
  function active(x) { return x && x.status !== 'RETIRED'; }
  function byOrder(a, b) { return (Number(a.order) || 0) - (Number(b.order) || 0) || text(a.name).localeCompare(text(b.name)); }
  function weekId(personId, start) { return text(personId) + '__' + start; }

  // An approved vacation on that day for that person (cancelled, denied and pending ones do not take anyone off).
  function vacationOn(vacations, personId, day) {
    var hit = null;
    (vacations || []).forEach(function (v) { if (!hit && v.personId === personId && v.status === 'APPROVED' && v.startDate <= day && (v.endDate || v.startDate) >= day) hit = v; });
    return hit;
  }

  // What a person does that day: {kind: 'JOB'|'OFF'|'VAC'|'NONE', jobId, changed, vacation}.
  function cellFor(person, day, week, vacations) {
    var vac = vacationOn(vacations, person.id, day);
    if (vac) return { kind: 'VAC', vacation: vac };
    var set = week && week.days && Object.prototype.hasOwnProperty.call(week.days, day) ? week.days[day] : null;
    if (set === OFF) return { kind: 'OFF', changed: true };
    if (set) return { kind: 'JOB', jobId: set, changed: true };
    if ((person.daysOff || []).indexOf(dow(day)) >= 0) return { kind: 'OFF' };
    return person.jobId ? { kind: 'JOB', jobId: person.jobId } : { kind: 'NONE' };
  }

  // The jobs of an area still short of people on a shift that day: [{job, short}]. None on a day the area does not run.
  function openJobs(jobs, people, weeks, vacations, areaId, shift, day, area) {
    if (area && Array.isArray(area.days) && area.days.indexOf(dow(day)) < 0) return [];
    var have = {};
    (people || []).filter(function (p) { return active(p) && Number(p.shift) === Number(shift); }).forEach(function (p) {
      var c = cellFor(p, day, weeks[weekId(p.id, weekStart(day))], vacations);
      if (c.kind === 'JOB') have[c.jobId] = (have[c.jobId] || 0) + 1;
    });
    return (jobs || []).filter(function (j) { return active(j) && j.areaId === areaId; }).sort(byOrder).map(function (j) {
      var need = Number(j.need && j.need[shift]) || 0;
      return { job: j, short: Math.max(0, need - (have[j.id] || 0)) };
    }).filter(function (x) { return x.short > 0; });
  }

  // How many may be off that day in an area and shift (holidayLabel: the holiday week's name, from logic.js dayLimit).
  function offLimit(rules, holidayLabel) {
    var r = rules || RULES;
    var n = holidayLabel ? r.holidayMaxOff : r.maxOff;
    return n === undefined || n === null || n === '' ? (holidayLabel ? RULES.holidayMaxOff : RULES.maxOff) : Number(n);
  }
  // The other people of the same area and shift already off that day (approved vacations only).
  function offCount(vacations, people, person, day) {
    var mates = {};
    (people || []).forEach(function (p) { if (p.id !== person.id && active(p) && p.areaId === person.areaId && Number(p.shift) === Number(person.shift)) mates[p.id] = true; });
    var seen = {};
    (vacations || []).forEach(function (v) { if (mates[v.personId] && v.status === 'APPROVED' && v.startDate <= day && (v.endDate || v.startDate) >= day) seen[v.personId] = true; });
    return Object.keys(seen).length;
  }
  function vacationDays(v) {
    if (!isDay(v.startDate)) return 0;
    var end = isDay(v.endDate) ? v.endDate : v.startDate, n = 0;
    for (var d = v.startDate; d <= end && n < 400; d = addDays(d, 1)) n++;
    return n;
  }

  // A made-up starting list for the test copy only (Joe 10/25: real people are uploaded later). Areas with their own shift
  // times, jobs and how many each needs per shift.
  var STARTER = {
    plant: [
      ['Fillers', ['06:00', '14:30'], ['14:30', '23:00'], ['22:30', '07:00'], [1, 2, 3, 4, 5],
        [['Gallon Filler Operator', [2, 2, 1]], ['Half Gallon Filler Operator', [2, 1, 1]], ['Pint / Quart Filler Operator', [1, 1, 0]], ['Filler Relief', [1, 1, 0], true]]],
      ['Processing', ['05:00', '13:30'], ['13:30', '22:00'], null, [1, 2, 3, 4, 5],
        [['HTST Operator', [1, 1, 0]], ['Receiving / Silo', [1, 1, 0]], ['Blow Mold Operator', [2, 2, 0]], ['Boxing', [1, 1, 0]], ['Totes', [1, 1, 0]]]],
      ['Loadout', ['04:00', '12:30'], ['12:00', '20:30'], ['20:00', '04:30'], [0, 1, 2, 3, 4, 5, 6],
        [['Loader', [5, 4, 3]], ['Checker', [1, 1, 1]], ['Forklift', [2, 2, 2]], ['Cooler Puller', [2, 2, 1]], ['Palletizer', [1, 1, 1]], ['Shipping Clerk', [1, 1, 0]], ['Loadout Relief', [1, 1, 1], true]]],
      ['Sanitation & Lab', ['07:00', '15:30'], ['15:00', '23:30'], ['23:00', '07:30'], [1, 2, 3, 4, 5],
        [['Sanitation', [3, 2, 2]], ['Case Washer', [1, 1, 0]], ['Lab / Quality', [1, 1, 1]]]]
    ],
    maint: [
      ['Mechanics', ['06:00', '14:30'], ['14:00', '22:30'], ['22:00', '06:30'], [0, 1, 2, 3, 4, 5, 6],
        [['Plant Mechanic', [2, 1, 1]], ['Refrigeration / Utilities', [1, 0, 0]], ['Maintenance Lead', [1, 0, 0]]]]
    ]
  };
  var FIRST = ['Aaron', 'Beth', 'Carl', 'Dana', 'Eli', 'Faye', 'Gus', 'Hope', 'Ivan', 'Jill', 'Kirk', 'Lena', 'Moe', 'Nina', 'Owen', 'Pam', 'Quinn', 'Rita', 'Sam', 'Tara', 'Uri', 'Vic', 'Wes', 'Xena', 'Yale', 'Zoe'];
  var LAST = ['Abbott', 'Baker', 'Carver', 'Dalton', 'Ellis', 'Foster', 'Grant', 'Hayes', 'Irwin', 'Jensen', 'Keller', 'Lowe', 'Mercer', 'Noble', 'Ortiz', 'Porter', 'Quade', 'Reyes', 'Stone', 'Tucker'];
  // {areas, jobs, people} with ids made from facilityId and team; one person per needed spot, every 7th has two set days off.
  function starter(facilityId, team) {
    var out = { areas: [], jobs: [], people: [] }, n = 0;
    (STARTER[team] || []).forEach(function (a, ai) {
      var areaId = facilityId + '_' + team + '_area_' + slug(a[0]), shifts = {};
      [a[1], a[2], a[3]].forEach(function (s, i) { if (s) shifts[i + 1] = { start: s[0], end: s[1] }; });
      out.areas.push({ id: areaId, name: a[0], order: ai + 1, shifts: shifts, days: a[4] });
      a[5].forEach(function (j, ji) {
        var jobId = facilityId + '_' + team + '_job_' + slug(a[0] + '_' + j[0]);
        out.jobs.push({ id: jobId, areaId: areaId, name: j[0], order: ji + 1, need: { 1: j[1][0], 2: j[1][1], 3: j[1][2] }, relief: !!j[2] });
        SHIFTS.forEach(function (s) {
          for (var k = 0; k < j[1][s - 1]; k++) {
            var name = (LAST[(n * 7 + 3) % LAST.length] + ', ' + FIRST[n % FIRST.length]).toUpperCase();
            // Off on the days the area does not run; on a 7-day area, two days in a row, staggered.
            var off = a[4].length >= 7 ? [n % 7, (n + 1) % 7].sort() : [0, 1, 2, 3, 4, 5, 6].filter(function (d) { return a[4].indexOf(d) < 0; });
            out.people.push({ id: facilityId + '_' + team + '_p' + (1001 + n), name: name, employeeId: String(9001 + n), phone: '', areaId: areaId, shift: s, jobId: jobId, daysOff: off, hireDate: (2008 + (n % 17)) + '-0' + (1 + (n % 9)) + '-15' });
            n++;
          }
        });
      });
    });
    return out;
  }

  return { TEAMS: TEAMS, SHIFTS: SHIFTS, SHIFT_NAMES: SHIFT_NAMES, DAY_NAMES: DAY_NAMES, OFF: OFF, VAC_TYPES: VAC_TYPES, VAC_TYPE_NAMES: VAC_TYPE_NAMES, VAC_STATUSES: VAC_STATUSES,
    RULES: RULES, PERSON_FIELDS: PERSON_FIELDS, text: text, isDay: isDay, isTime: isTime, addDays: addDays, dow: dow, weekStart: weekStart, weekDays: weekDays, slug: slug,
    timeText: timeText, shiftText: shiftText, active: active, byOrder: byOrder, weekId: weekId, vacationOn: vacationOn, cellFor: cellFor, openJobs: openJobs,
    offLimit: offLimit, offCount: offCount, vacationDays: vacationDays, starter: starter };
});

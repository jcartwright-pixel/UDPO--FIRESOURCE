/*
 * Safety Walkthrough's rules (Joe 10/12: a quick walk where every item is Good or Not good, fire extinguisher checks and a
 * review of earlier problems), shared by the screens and the server (one file, copied unchanged to public/js/safety-rules.js;
 * a unit test checks the two match). The checklist and how often each item is checked come from
 * /mnt/project-files/safety-walkthrough/research.md (OSHA 1910, NFPA 10 and 101, ANSI Z358.1, IIAR 6):
 *
 *   - the plant is walked once a week (safetyWalks/{facilityId}__{date}); each item is Good, Not good or Not checked;
 *   - monthly items (extinguishers, emergency lights, first aid, AED, SCBA) are on the month's first walk only;
 *   - every Not good becomes an open issue (safetyIssues) that the next walk reviews (Still open or Fixed) until it is fixed;
 *     the same item Not good on a later walk is added to that open issue (a REPEAT), not a second issue;
 *   - an issue can be sent to Plant Maintenance (sendToMaint); that module picks it up once it is built;
 *   - each plant's fire extinguishers (extinguishers/{facilityId}__{tag}) get a monthly check of five items; a Not good there
 *     is an open issue too. Annual service, 6-year and hydrostatic test dates show DUE SOON 30 days out and PAST DUE after;
 *   - each plant may change its own checklist (safetySetup/{facilityId}); with none saved it uses the list below.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.UDSafety = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var STATUSES = ['GOOD', 'NOT_GOOD'];
  var FREQS = ['WEEKLY', 'MONTHLY'];
  // [id, what to look at, how often]. Ids never change once used: walks and issues refer to them.
  var DEFAULT_AREAS = [
    { key: 'fire', name: 'Fire & Exits', items: [
      ['exit_routes', 'Exit routes and exit doors clear, open from the inside', 'WEEKLY'],
      ['exit_signs', 'Exit signs lit', 'WEEKLY'],
      ['ext_monthly', 'Fire extinguishers: this month\'s check done for every one', 'MONTHLY'],
      ['emerg_lights', 'Emergency lights: press test, lights come on', 'MONTHLY'],
      ['alarm_valves', 'Fire alarm pull stations and sprinkler valves clear', 'WEEKLY'],
      ['sprinkler_clear', 'Nothing stored within 18 inches of sprinkler heads', 'WEEKLY']] },
    { key: 'eyewash', name: 'Eyewash & First Aid', items: [
      ['eyewash_run', 'Eyewash stations and showers flushed this week, water clear, caps on', 'WEEKLY'],
      ['eyewash_path', 'Eyewash reached in 10 seconds, nothing in the way', 'WEEKLY'],
      ['first_aid', 'First aid kits stocked, nothing out of date', 'MONTHLY'],
      ['aed', 'AED ready light on, pads in date', 'MONTHLY']] },
    { key: 'ammonia', name: 'Ammonia Room', items: [
      ['nh3_doors', 'Machinery room doors closed, warning signs on the doors', 'WEEKLY'],
      ['nh3_alarm', 'Ammonia detector and alarm light and horn working (no fault light)', 'WEEKLY'],
      ['nh3_switches', 'Emergency shut-off and vent fan switches outside the door, clear and labeled', 'WEEKLY'],
      ['nh3_leaks', 'No ammonia smell, no new frost or oil on pipes and valves', 'WEEKLY'],
      ['nh3_labels', 'Pipe labels and valve tags readable', 'WEEKLY'],
      ['nh3_scba', 'Emergency respirators and SCBA in place and sealed', 'MONTHLY']] },
    { key: 'forklift', name: 'Forklifts & Docks', items: [
      ['fork_precheck', 'Pre-shift checklist done today for every forklift and pallet jack', 'WEEKLY'],
      ['fork_condition', 'Horn, lights, brakes and seat belts work; no leaks; forks not damaged', 'WEEKLY'],
      ['charging', 'Battery charging area: eyewash close, no smoking sign, nothing in the way', 'WEEKLY'],
      ['dock_chocks', 'Trailers chocked or dock-locked before loading', 'WEEKLY'],
      ['dock_plates', 'Dock plates in good shape, dock edges marked', 'WEEKLY'],
      ['yard_lanes', 'Yard lit, traffic lanes and walkways clear', 'WEEKLY']] },
    { key: 'loto', name: 'Lockout & Guarding', items: [
      ['loto_station', 'Lockout stations stocked (locks, tags, hasps)', 'WEEKLY'],
      ['loto_steps', 'Lockout steps posted at fillers, homogenizer, separator and palletizer', 'WEEKLY'],
      ['guards', 'Guards on and closed on conveyors, chains and drives', 'WEEKLY'],
      ['estops', 'Emergency stops work and are not blocked', 'WEEKLY']] },
    { key: 'chem', name: 'Chemicals & Cylinders', items: [
      ['chem_apart', 'Acids kept apart from caustic and chlorine, containment not full', 'WEEKLY'],
      ['chem_labels', 'Every container labeled, safety data sheets can be reached', 'WEEKLY'],
      ['chem_ppe', 'Face shield, apron and gloves at the chemical room', 'WEEKLY'],
      ['cylinders', 'Gas cylinders chained upright, caps on', 'WEEKLY']] },
    { key: 'elec', name: 'Electrical', items: [
      ['panel_clear', '36 inches clear in front of every panel, doors closed', 'WEEKLY'],
      ['panel_labels', 'Breakers labeled, no open holes in panels', 'WEEKLY'],
      ['cords', 'No damaged cords, no extension cords used as permanent wiring', 'WEEKLY']] },
    { key: 'house', name: 'Housekeeping & Floors', items: [
      ['floors', 'Floors free of standing water, milk and oil; drains open', 'WEEKLY'],
      ['hoses', 'Hoses coiled and hung up, hot water and steam stations shut off', 'WEEKLY'],
      ['stairs', 'Stairs, railings, ladders and platforms sound', 'WEEKLY'],
      ['trips', 'Aisles clear, no trip hazards', 'WEEKLY']] },
    { key: 'ppe', name: 'PPE', items: [
      ['ppe_worn', 'People wearing the PPE posted for the area', 'WEEKLY'],
      ['ppe_stock', 'Spare earplugs, glasses, gloves and hard hats on hand', 'WEEKLY']] },
    { key: 'cooler', name: 'Coolers & Yard', items: [
      ['cooler_release', 'Cooler and freezer doors open from the inside', 'WEEKLY'],
      ['cooler_floor', 'Cooler floors not iced or wet', 'WEEKLY'],
      ['cooler_alarm', 'Lights and alarm inside the coolers work', 'WEEKLY'],
      ['outside', 'Outside walkways, steps and lot lighting OK', 'WEEKLY']] }
  ];
  // The monthly check of each fire extinguisher (OSHA 1910.157(e)(2), NFPA 10 7.2).
  var EXT_ITEMS = [
    ['in_place', 'In its place, sign visible, nothing in front of it'],
    ['gauge', 'Gauge needle in the green'],
    ['seal', 'Pin and tamper seal in place'],
    ['body', 'No dents, rust or leaks; hose and nozzle clear'],
    ['tag', 'Tag shows the annual service is current']
  ];
  var EXT_TYPES = ['ABC', 'BC', 'CO2', 'K (kitchen)', 'Water', 'D (metal)'];
  var LONG_OPEN_DAYS = 30, DUE_SOON_DAYS = 30;

  function text(v) { return v === null || v === undefined ? '' : String(v).trim(); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function noon(key) { var p = String(key).split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2], 12); }
  function isKey(v) { return /^\d{4}-\d\d-\d\d$/.test(text(v)) && isFinite(noon(v)); }

  // The checklist the plant walks: its own saved one (Checklist Setup), else the list above. Items turned off are left out
  // unless all is true (Checklist Setup shows them).
  function checklist(setup, all) {
    var areas = setup && Array.isArray(setup.areas) && setup.areas.length ? setup.areas : DEFAULT_AREAS.map(function (a) {
      return { key: a.key, name: a.name, items: a.items.map(function (i) { return { id: i[0], text: i[1], freq: i[2] }; }) };
    });
    return areas.map(function (a) {
      return { key: text(a.key), name: text(a.name), items: (a.items || []).map(function (i) { return { id: text(i.id), text: text(i.text), freq: FREQS.indexOf(i.freq) >= 0 ? i.freq : 'WEEKLY', off: i.off === true }; })
        .filter(function (i) { return i.id && i.text && (all || !i.off); }) };
    }).filter(function (a) { return a.key && a.name && (all || a.items.length); });
  }
  // The areas and items on one walk: monthly items only on the month's first walk.
  function walkList(setup, monthly) {
    return checklist(setup).map(function (a) { return { key: a.key, name: a.name, items: a.items.filter(function (i) { return monthly || i.freq !== 'MONTHLY'; }) }; })
      .filter(function (a) { return a.items.length; });
  }
  function findItem(setup, id) {
    var out = null;
    checklist(setup, true).forEach(function (a) { a.items.forEach(function (i) { if (i.id === id) out = { area: a.name, areaKey: a.key, id: i.id, text: i.text, freq: i.freq, off: i.off }; }); });
    return out;
  }
  function walkId(facilityId, date) { return text(facilityId) + '__' + text(date); }
  function monthOf(date) { return text(date).slice(0, 7); }
  // Good, Not good and Not checked on a walk (only the items on that walk count).
  function walkCounts(walk, list) {
    var items = (walk && walk.items) || {}, out = { good: 0, notGood: 0, notChecked: 0, total: 0 };
    list.forEach(function (a) { a.items.forEach(function (i) {
      var s = items[i.id] && items[i.id].status;
      out.total++;
      if (s === 'GOOD') out.good++; else if (s === 'NOT_GOOD') out.notGood++; else out.notChecked++;
    }); });
    return out;
  }
  // Days an issue has been open (found day to today, or to the day it was fixed).
  function daysOpen(issue, today) {
    var from = text(issue && issue.foundOn), to = issue && issue.status === 'FIXED' && isKey(text(issue.fixedOn)) ? text(issue.fixedOn) : text(today);
    if (!isKey(from) || !isKey(to)) return 0;
    return Math.max(0, Math.round((noon(to) - noon(from)) / 86400000));
  }
  function isRepeat(issue) { return !!(issue && Array.isArray(issue.walks) && issue.walks.length > 1); }

  // An extinguisher's check for the month: GOOD (all five Good), NOT_GOOD (any Not good) or DUE (not finished).
  function extMonth(ext, month) {
    var c = ext && ext.checks && ext.checks[month], items = (c && c.items) || {};
    var bad = EXT_ITEMS.filter(function (i) { return items[i[0]] === 'NOT_GOOD'; }).map(function (i) { return i[1]; });
    var good = EXT_ITEMS.every(function (i) { return items[i[0]] === 'GOOD'; });
    return { state: bad.length ? 'NOT_GOOD' : good ? 'GOOD' : 'DUE', bad: bad, by: text(c && c.by), byName: text(c && c.byName), at: text(c && c.at), note: text(c && c.note), items: items };
  }
  // A service date: '' (none), OK, SOON (within 30 days) or PAST.
  function dueState(key, today) {
    if (!isKey(key) || !isKey(today)) return '';
    var d = Math.round((noon(key) - noon(today)) / 86400000);
    return d < 0 ? 'PAST' : d <= DUE_SOON_DAYS ? 'SOON' : 'OK';
  }
  function extId(facilityId, tag) { return text(facilityId) + '__' + text(tag).replace(/[^A-Za-z0-9-]+/g, '_'); }

  return { STATUSES: STATUSES, FREQS: FREQS, DEFAULT_AREAS: DEFAULT_AREAS, EXT_ITEMS: EXT_ITEMS, EXT_TYPES: EXT_TYPES, LONG_OPEN_DAYS: LONG_OPEN_DAYS, DUE_SOON_DAYS: DUE_SOON_DAYS,
    checklist: checklist, walkList: walkList, findItem: findItem, walkId: walkId, monthOf: monthOf, walkCounts: walkCounts, daysOpen: daysOpen, isRepeat: isRepeat,
    extMonth: extMonth, dueState: dueState, extId: extId, isKey: isKey, pad: pad };
});

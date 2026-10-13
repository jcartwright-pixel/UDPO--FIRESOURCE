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
 *   - Joe 10/13: each plant's Fire Alarm, Fire Suppression and Escape Plan (fireSystems/{facilityId}__{system}) get one
 *     monthly check of the whole system plus their vendor inspection or fire drill dates; a Not good is an open issue too;
 *   - each plant may change its own checklist (safetySetup/{facilityId}); with none saved it uses the list below. Joe 10/12
 *     (mock-up A): the checklist is Plant, Garage and Office (each area's place), each with its sub-areas in walking order.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.UDSafety = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var STATUSES = ['GOOD', 'NOT_GOOD'];
  var FREQS = ['WEEKLY', 'MONTHLY'];
  // Joe 10/12 (mock-up A): Plant, Garage and Office, each with its sub-areas in walking order. The researched items keep their
  // ids. [id, what to look at, how often]. Ids never change once used: walks and issues refer to them.
  var DEFAULT_AREAS = [
    { place: 'Plant', key: 'receiving', name: 'Receiving & Docks', items: [
      ['dock_chocks', 'Trailers chocked or dock-locked before loading', 'WEEKLY'],
      ['dock_plates', 'Dock plates in good shape, dock edges marked', 'WEEKLY'],
      ['yard_lanes', 'Yard lit, traffic lanes and walkways clear', 'WEEKLY']] },
    { place: 'Plant', key: 'processing', name: 'Processing & Filler Rooms', items: [
      ['guards', 'Guards on and closed on conveyors, chains and drives', 'WEEKLY'],
      ['estops', 'Emergency stops work and are not blocked', 'WEEKLY'],
      ['loto_station', 'Lockout stations stocked (locks, tags, hasps)', 'WEEKLY'],
      ['loto_steps', 'Lockout steps posted at fillers, homogenizer, separator and palletizer', 'WEEKLY'],
      ['floors', 'Floors free of standing water, milk and oil; drains open', 'WEEKLY'],
      ['hoses', 'Hoses coiled and hung up, hot water and steam stations shut off', 'WEEKLY'],
      ['eyewash_run', 'Eyewash stations and showers flushed this week, water clear, caps on', 'WEEKLY'],
      ['eyewash_path', 'Eyewash reached in 10 seconds, nothing in the way', 'WEEKLY']] },
    { place: 'Plant', key: 'ammonia', name: 'Ammonia Room', items: [
      ['nh3_doors', 'Machinery room doors closed, warning signs on the doors', 'WEEKLY'],
      ['nh3_alarm', 'Ammonia detector and alarm light and horn working (no fault light)', 'WEEKLY'],
      ['nh3_switches', 'Emergency shut-off and vent fan switches outside the door, clear and labeled', 'WEEKLY'],
      ['nh3_leaks', 'No ammonia smell, no new frost or oil on pipes and valves', 'WEEKLY'],
      ['nh3_labels', 'Pipe labels and valve tags readable', 'WEEKLY'],
      ['nh3_scba', 'Emergency respirators and SCBA in place and sealed', 'MONTHLY']] },
    { place: 'Plant', key: 'chem', name: 'Chemical Room', items: [
      ['chem_apart', 'Acids kept apart from caustic and chlorine, containment not full', 'WEEKLY'],
      ['chem_labels', 'Every container labeled, safety data sheets can be reached', 'WEEKLY'],
      ['chem_ppe', 'Face shield, apron and gloves at the chemical room', 'WEEKLY'],
      ['cylinders', 'Gas cylinders chained upright, caps on', 'WEEKLY']] },
    { place: 'Plant', key: 'cooler', name: 'Coolers', items: [
      ['cooler_release', 'Cooler and freezer doors open from the inside', 'WEEKLY'],
      ['cooler_floor', 'Cooler floors not iced or wet', 'WEEKLY'],
      ['cooler_alarm', 'Lights and alarm inside the coolers work', 'WEEKLY']] },
    { place: 'Plant', key: 'forklift', name: 'Forklifts & Charging', items: [
      ['fork_precheck', 'Pre-shift checklist done today for every forklift and pallet jack', 'WEEKLY'],
      ['fork_condition', 'Horn, lights, brakes and seat belts work; no leaks; forks not damaged', 'WEEKLY'],
      ['charging', 'Battery charging area: eyewash close, no smoking sign, nothing in the way', 'WEEKLY']] },
    { place: 'Plant', key: 'elec', name: 'Electrical Rooms', items: [
      ['panel_clear', '36 inches clear in front of every panel, doors closed', 'WEEKLY'],
      ['panel_labels', 'Breakers labeled, no open holes in panels', 'WEEKLY'],
      ['cords', 'No damaged cords, no extension cords used as permanent wiring', 'WEEKLY']] },
    { place: 'Plant', key: 'aisles', name: 'Stairs, Aisles & PPE', items: [
      ['stairs', 'Stairs, railings, ladders and platforms sound', 'WEEKLY'],
      ['trips', 'Aisles clear, no trip hazards', 'WEEKLY'],
      ['ppe_worn', 'People wearing the PPE posted for the area', 'WEEKLY'],
      ['ppe_stock', 'Spare earplugs, glasses, gloves and hard hats on hand', 'WEEKLY'],
      ['first_aid', 'First aid kits stocked, nothing out of date', 'MONTHLY'],
      ['aed', 'AED ready light on, pads in date', 'MONTHLY']] },
    { place: 'Plant', key: 'fire', name: 'Exits & Fire', items: [
      ['exit_routes', 'Exit routes and exit doors clear, open from the inside', 'WEEKLY'],
      ['exit_signs', 'Exit signs lit', 'WEEKLY'],
      ['ext_monthly', 'Fire extinguishers: this month\'s check done for every one', 'MONTHLY'],
      ['emerg_lights', 'Emergency lights: press test, lights come on', 'MONTHLY'],
      ['alarm_valves', 'Fire alarm pull stations and sprinkler valves clear', 'WEEKLY'],
      ['sprinkler_clear', 'Nothing stored within 18 inches of sprinkler heads', 'WEEKLY']] },
    { place: 'Garage', key: 'g_bays', name: 'Repair Bays', items: [
      ['g_lifts', 'Lifts inspected, locks working', 'WEEKLY'],
      ['g_stands', 'Jack stands under raised trucks', 'WEEKLY'],
      ['g_air', 'Air hoses coiled, no leaks', 'WEEKLY'],
      ['g_floor', 'Floor clean of oil', 'WEEKLY']] },
    { place: 'Garage', key: 'g_fuel', name: 'Fuel Island', items: [
      ['g_nosmoke', 'No smoking signs up', 'WEEKLY'],
      ['g_fuel_off', 'Emergency fuel shut-off clear and labeled', 'WEEKLY'],
      ['g_spill', 'Spill kit stocked', 'WEEKLY']] },
    { place: 'Garage', key: 'g_wash', name: 'Wash Bay', items: [
      ['g_drain', 'Floor drain clear', 'WEEKLY'],
      ['g_gfci', 'GFCI outlets working', 'WEEKLY'],
      ['g_wash_chem', 'Chemicals labeled, lids on', 'WEEKLY']] },
    { place: 'Garage', key: 'g_parts', name: 'Parts & Tires', items: [
      ['g_shelves', 'Shelves secure, heavy parts low', 'WEEKLY'],
      ['g_rags', 'Oily rags in a closed can', 'WEEKLY'],
      ['g_tire_cage', 'Tire cage used for airing up', 'WEEKLY']] },
    { place: 'Garage', key: 'g_exits', name: 'Garage Exits & Eyewash', items: [
      ['g_exits', 'Exit doors clear, open from the inside', 'WEEKLY'],
      ['g_eyewash', 'Eyewash flushed this week, water runs clear', 'WEEKLY']] },
    { place: 'Office', key: 'o_front', name: 'Front Office', items: [
      ['o_exit_signs', 'Exit signs lit', 'WEEKLY'],
      ['o_cords', 'No cords across walkways', 'WEEKLY'],
      ['o_first_aid', 'First aid kit stocked', 'MONTHLY']] },
    { place: 'Office', key: 'o_break', name: 'Break Room', items: [
      ['o_k_ext', 'Kitchen (K) extinguisher in place', 'WEEKLY'],
      ['o_clean', 'Microwave and fridge area clean', 'WEEKLY']] },
    { place: 'Office', key: 'o_lockers', name: 'Locker Rooms', items: [
      ['o_floors', 'Floors dry', 'WEEKLY'],
      ['o_lockers', 'Lockers not blocking the exit', 'WEEKLY'],
      ['o_emerg_light', 'Emergency light works', 'MONTHLY']] },
    { place: 'Office', key: 'o_stairs', name: 'Stairs & Exits', items: [
      ['o_rails', 'Handrails tight', 'WEEKLY'],
      ['o_stairs', 'Stairs clear and lit', 'WEEKLY'],
      ['o_exit_doors', 'Exit doors open from the inside', 'WEEKLY'],
      ['o_evac_map', 'Evacuation map posted', 'MONTHLY']] },
    { place: 'Yard', key: 'outside', name: 'Parking Lot & Walkways', items: [
      ['outside', 'Outside walkways, steps and lot lighting OK', 'WEEKLY']] }
  ];
  // Joe 10/12: each plant's Location Areas (Administration > Plant Setup): the areas (Plant, Garage, Office, Yard) and their
  // sub-areas, one list the Safety Walkthrough walks in order and other screens can use later. With none saved a plant starts
  // from the sub-areas above, plus the yard's own. Keys never change once used.
  var EXTRA_SUBS = { Yard: [['yard_truck', 'Truck Yard'], ['yard_storage', 'Outside Storage']] };
  var PLACE_KEYS = { Plant: 'plant', Garage: 'garage', Office: 'office', Yard: 'yard' };

  // The monthly check of each fire extinguisher (OSHA 1910.157(e)(2), NFPA 10 7.2).
  var EXT_ITEMS = [
    ['in_place', 'In its place, sign visible, nothing in front of it'],
    ['gauge', 'Gauge needle in the green'],
    ['seal', 'Pin and tamper seal in place'],
    ['body', 'No dents, rust or leaks; hose and nozzle clear'],
    ['tag', 'Tag shows the annual service is current']
  ];
  // Joe 10/13 (mock-up B): Fire Alarm, Fire Suppression and Escape Plan each get one monthly check of the whole system
  // (fireSystems/{facilityId}__{system}), every item Good or Not good, and their vendor or drill dates. A Not good is an open
  // issue, like an extinguisher's. Item ids never change once used.
  var FIRE_SYSTEMS = [
    { key: 'alarm', name: 'Fire Alarm', what: 'Monthly check of the fire alarm system', items: [
      ['panel', 'Panel shows NORMAL: no trouble or alarm lights'],
      ['panel_area', 'Panel area clear, panel door closed, battery date in the last 4 years'],
      ['pulls', 'Every pull station visible, not blocked, cover on'],
      ['horns', 'Horns and strobes not damaged or covered'],
      ['detectors', 'Smoke and heat detectors not covered, painted or damaged'],
      ['monitoring', 'Monitoring company got the last test signal (date in the log)']],
      dates: [['vendorDue', 'Vendor inspection due', 'DUE']] },
    { key: 'suppression', name: 'Fire Suppression', what: 'Monthly check of the sprinklers and the kitchen hood system', items: [
      ['valves', 'Sprinkler control valves open, locked or sealed'],
      ['gauges', 'System gauges show normal water or air pressure'],
      ['fdc', 'Fire department connection caps on, nothing in front of it'],
      ['heads', 'Sprinkler heads not painted, damaged or blocked; spare heads and wrench in the cabinet'],
      ['clearance', 'Nothing stored within 18 inches of sprinkler heads'],
      ['riser', 'Riser room heated, no leaks, door clear'],
      ['hood', 'Kitchen hood system: gauge in the green, pull handle clear (where there is one)']],
      dates: [['vendorDue', 'Vendor inspection due', 'DUE']] },
    { key: 'escape', name: 'Escape Plan', what: 'Monthly check of the evacuation maps, exit routes and meeting point', items: [
      ['maps', 'Evacuation maps posted at every exit and in each room, "You are here" correct'],
      ['routes', 'Exit routes clear the whole way out, doors open outward and are not locked'],
      ['signs', 'Exit signs lit and seen from the aisles'],
      ['cooler', 'Cooler and freezer doors open from the inside'],
      ['meeting', 'Meeting point sign up, area clear, everyone knows it'],
      ['headcount', 'Headcount list kept at the meeting point and up to date']],
      dates: [['lastDrill', 'Last fire drill', 'PAST'], ['nextDrill', 'Next fire drill', 'DUE'], ['mapsUpdated', 'Maps updated', 'PAST']] }
  ];
  var EXT_TYPES = ['ABC', 'BC', 'CO2', 'K (kitchen)', 'Water', 'D (metal)'];
  var LONG_OPEN_DAYS = 30, DUE_SOON_DAYS = 30;

  function text(v) { return v === null || v === undefined ? '' : String(v).trim(); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function noon(key) { var p = String(key).split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2], 12); }
  function isKey(v) { return /^\d{4}-\d\d-\d\d$/.test(text(v)) && isFinite(noon(v)); }

  // Joe 10/13 (Location Areas, A): each location has its own areas. Uniontown starts from the list below; every other
  // location starts empty until its own areas are added.
  var STARTER_PLANT = 'fac_uniontown';
  function startsEmpty(plant) { return !!text(plant) && text(plant) !== STARTER_PLANT; }
  // A plant's Location Areas: [{ key, name, off, subs: [{ key, name, off }] }], its saved list or the starting one.
  function locations(doc, plant) {
    var saved = doc && Array.isArray(doc.areas) && doc.areas.length ? doc.areas : null;
    if (!saved && startsEmpty(plant)) saved = [];
    if (!saved) {
      saved = [];
      DEFAULT_AREAS.forEach(function (a) {
        var p = saved.filter(function (x) { return x.name === a.place; })[0];
        if (!p) { p = { key: PLACE_KEYS[a.place] || a.place.toLowerCase(), name: a.place, subs: [] }; saved.push(p); }
        p.subs.push({ key: a.key, name: a.name });
      });
      saved.forEach(function (p) { (EXTRA_SUBS[p.name] || []).forEach(function (x) { p.subs.push({ key: x[0], name: x[1] }); }); });
    }
    return saved.map(function (a) {
      return { key: text(a.key), name: text(a.name), off: a.off === true, subs: (a.subs || []).map(function (x) { return { key: text(x.key), name: text(x.name), off: x.off === true }; })
        .filter(function (x) { return x.key && x.name; }) };
    }).filter(function (a) { return a.key && a.name; });
  }
  // The checklist the plant walks, in its Location Areas' order: each sub-area with the items Checklist Setup put there (its
  // own saved list, else the list above). Areas, sub-areas and items turned off are left out unless all is true (the setup
  // screens show them, sub-areas with no items too). A sub-area saved before Location Areas keeps its own place and name.
  // setup.plant (the screens and the server set it) picks the starting list: Uniontown's, or none for another location.
  function checklist(setup, all) {
    var plant = setup && setup.plant;
    var saved = setup && Array.isArray(setup.areas) && setup.areas.length ? setup.areas : startsEmpty(plant) ? [] : DEFAULT_AREAS.map(function (a) {
      return { place: a.place, key: a.key, name: a.name, items: a.items.map(function (i) { return { id: i[0], text: i[1], freq: i[2] }; }) };
    });
    var byKey = {}, used = {};
    saved.forEach(function (a) { if (text(a.key)) byKey[text(a.key)] = a; });
    var out = [];
    locations(setup && setup.locations, plant).forEach(function (p) { p.subs.forEach(function (x) {
      used[x.key] = true;
      out.push({ place: p.name, placeKey: p.key, key: x.key, name: x.name, off: p.off || x.off, items: (byKey[x.key] || {}).items || [] });
    }); });
    saved.forEach(function (a) { var k = text(a.key); if (k && !used[k]) out.push({ place: text(a.place) || 'Plant', placeKey: '', key: k, name: text(a.name) || k, off: false, items: a.items || [] }); });
    return out.map(function (a) {
      return { place: a.place, placeKey: a.placeKey, key: a.key, name: a.name, off: a.off, items: a.items.map(function (i) { return { id: text(i.id), text: text(i.text), freq: FREQS.indexOf(i.freq) >= 0 ? i.freq : 'WEEKLY', off: i.off === true }; })
        .filter(function (i) { return i.id && i.text && (all || !i.off); }) };
    }).filter(function (a) { return all || (!a.off && a.items.length); });
  }
  // The areas and items on one walk: monthly items only on the month's first walk.
  function walkList(setup, monthly) {
    return checklist(setup).map(function (a) { return { place: a.place, key: a.key, name: a.name, items: a.items.filter(function (i) { return monthly || i.freq !== 'MONTHLY'; }) }; })
      .filter(function (a) { return a.items.length; });
  }
  // Plant, Garage and Office (the places, in the order they first come) with their sub-areas in walking order.
  function places(list) {
    var out = [];
    list.forEach(function (a) {
      var p = out.filter(function (x) { return x.name === a.place; })[0];
      if (!p) { p = { name: a.place, areas: [] }; out.push(p); }
      p.areas.push(a);
    });
    return out;
  }
  // "Plant › Filler Room": where an item is, as Open Issues and the reports show it.
  function areaName(a) { return a.place ? a.place + ' \u203a ' + a.name : a.name; }
  function findItem(setup, id) {
    var out = null;
    checklist(setup, true).forEach(function (a) { a.items.forEach(function (i) { if (i.id === id) out = { area: areaName(a), areaKey: a.key, place: a.place, id: i.id, text: i.text, freq: i.freq, off: i.off || a.off === true }; }); });
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
  function fireSystem(key) { return FIRE_SYSTEMS.filter(function (x) { return x.key === key; })[0] || null; }
  function fireId(facilityId, key) { return text(facilityId) + '__' + text(key); }
  // A system's check for the month: GOOD (every item Good), NOT_GOOD (any Not good) or DUE (not finished).
  function fireMonth(key, doc, month) {
    var sys = fireSystem(key), list = sys ? sys.items : [], c = doc && doc.checks && doc.checks[month], items = (c && c.items) || {};
    var bad = list.filter(function (i) { return items[i[0]] === 'NOT_GOOD'; }).map(function (i) { return i[1]; });
    var good = list.length > 0 && list.every(function (i) { return items[i[0]] === 'GOOD'; });
    var done = list.filter(function (i) { return items[i[0]]; }).length;
    return { state: bad.length ? 'NOT_GOOD' : good ? 'GOOD' : 'DUE', bad: bad, done: done, total: list.length, by: text(c && c.by), byName: text(c && c.byName), at: text(c && c.at), note: text(c && c.note), items: items };
  }
  function extId(facilityId, tag) { return text(facilityId) + '__' + text(tag).replace(/[^A-Za-z0-9-]+/g, '_'); }

  return { STATUSES: STATUSES, FREQS: FREQS, DEFAULT_AREAS: DEFAULT_AREAS, EXT_ITEMS: EXT_ITEMS, EXT_TYPES: EXT_TYPES, LONG_OPEN_DAYS: LONG_OPEN_DAYS, DUE_SOON_DAYS: DUE_SOON_DAYS,
    locations: locations, startsEmpty: startsEmpty, checklist: checklist, walkList: walkList, places: places, areaName: areaName, findItem: findItem, walkId: walkId, monthOf: monthOf, walkCounts: walkCounts, daysOpen: daysOpen, isRepeat: isRepeat,
    extMonth: extMonth, dueState: dueState, extId: extId, isKey: isKey, pad: pad,
    FIRE_SYSTEMS: FIRE_SYSTEMS, fireSystem: fireSystem, fireId: fireId, fireMonth: fireMonth };
});

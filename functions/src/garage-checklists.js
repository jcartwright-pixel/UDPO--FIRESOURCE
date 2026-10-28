/*
 * Joe 10/28: a service that is due comes onto the Garage Station with the list he used to check off. Taken from his old
 * paper forms (United Dairy Preventive Maintenance Checklist B for trucks, the Trailer checklist for a reefer service, and
 * Checklist Schedule A for the Annual Inspection), "not necessarily exactly how it has to be", in plain words.
 * Each item is answered OK, Needs work or N/A, as on the paper (check, X, N/A).
 *
 * The list a work order uses: its service (PM, REEFER, DOT) and whether the unit is a truck or a trailer (listFor).
 */
'use strict';

const RESULTS = Object.freeze(['OK', 'FIX', 'NA']);

// [section, [[id, text], ...]]
const LISTS = {
  PM_TRUCK: [
    ['Cab', [
      ['gauges', 'Gauges, dash lights and engine warning lights work'],
      ['lights', 'Headlights, tail lights, brake lights, flashers and clearance lights'],
      ['cargolights', 'Fog lights, warning lights and cargo lights'],
      ['cabitems', 'Horn, wipers, washer, heater, defroster, seats and seat belts'],
      ['airbuild', 'Air builds up in time, governor and low air warning work'],
      ['pto', 'Throttle and PTO work'],
      ['twospeed', 'Two-speed rear axle works'],
      ['steerplay', 'Steering wheel has no extra play'],
      ['glass', 'Glass and mirrors'],
      ['clutch', 'Clutch free travel and adjustment']]],
    ['Engine', [
      ['oil', 'Change engine oil and filter, grease the chassis'],
      ['pressure', 'Pressure test cooling system and radiator cap'],
      ['coolant', 'Coolant level, radiator and heater hoses, no leaks'],
      ['antifreeze', 'Test antifreeze to -40 and coolant additive level'],
      ['belts', 'Drive belts: condition and tightness'],
      ['batcables', 'Clean battery cables'],
      ['batbox', 'Battery box, mount and hold-downs'],
      ['fuelfilter', 'Change fuel filters'],
      ['fuellines', 'Fuel tank, lines and connections: no rubbing or leaks'],
      ['aircleaner', 'Air filter gauge; replace the filter if it is high'],
      ['runs', 'Engine runs right'],
      ['exhaust', 'Exhaust, engine mounts and radiator mounts'],
      ['gearoil', 'Transmission, rear end and gearbox oil, clean breather, no leaks'],
      ['turbo', 'Turbo: no noise, shaking or leaks'],
      ['driveshaft', 'Drive shaft, U-joints, center bearing and yokes']]],
    ['Steering and springs', [
      ['steerbox', 'Steering box, spindle and retainer bolts tight'],
      ['pwrsteer', 'Power steering oil level, no leaks'],
      ['bearings', 'Front wheel bearings: no play, no leaks'],
      ['kingpins', 'Kingpins, tie rod ends and shocks'],
      ['springs', 'Springs, U-bolts, hangers and shackles: tight, no cracks']]],
    ['Brakes', [
      ['airlines', 'Air lines and hoses: no leaks or rubbing'],
      ['chambers', 'Brake chambers: no leaks or damage'],
      ['linings', 'Brake linings: no cracks, not worn'],
      ['dryer', 'Air dryer works, drain the air tanks'],
      ['adjust', 'Brake adjustment, parking brake and slack adjusters']]],
    ['Tires and wheels', [
      ['wheels', 'Wheels: no cracks'],
      ['tires', 'Tire condition and air pressure'],
      ['tread', 'Tread depth on every tire'],
      ['lugnuts', 'Lug nuts and axle nuts tight']]],
    ['Body', [
      ['body', 'Body damage; grease locks, latches, hinges, rollers and track'],
      ['fifth', 'Fifth wheel adjustment and bolts']]]
  ],
  REEFER_TRAILER: [
    ['Reefer', [
      ['freon', 'Freon level'],
      ['compoil', 'Compressor oil level'],
      ['leaks', 'No oil or freon leaks'],
      ['valve', '3-way valve works'],
      ['defrost', 'Defrost cycle works'],
      ['flap', 'Defrost flap closes'],
      ['oil', 'Change reefer engine oil and filter'],
      ['pressure', 'Pressure test cooling system and radiator cap'],
      ['coolant', 'Coolant level and hoses, no leaks'],
      ['belts', 'Drive belts: condition and tightness'],
      ['batcables', 'Clean battery cables'],
      ['batbox', 'Battery box, mount and hold-downs'],
      ['fuelfilter', 'Change fuel filters'],
      ['fuellines', 'Fuel tank, lines and connections: no rubbing or leaks'],
      ['aircleaner', 'Air filter gauge; replace the filter if it is high'],
      ['runs', 'Reefer engine runs right'],
      ['exhaust', 'Exhaust and engine mounts']]],
    ['Springs and brakes', [
      ['springs', 'Springs, U-bolts, hangers and shackles: tight, no cracks'],
      ['airlines', 'Air lines and hoses: no leaks or rubbing'],
      ['chambers', 'Brake chambers: no leaks or damage'],
      ['linings', 'Brake linings: no cracks, not worn'],
      ['drain', 'Drain the air tanks'],
      ['adjust', 'Brake adjustment and slack adjusters']]],
    ['Tires and wheels', [
      ['wheels', 'Wheels: no cracks'],
      ['tires', 'Tire condition and air pressure'],
      ['tread', 'Tread depth on every tire'],
      ['lugnuts', 'Lug nuts and axle nuts tight']]],
    ['Body', [
      ['lights', 'All trailer lights work'],
      ['body', 'Body damage; grease locks, latches, hinges, rollers and track']]]
  ],
  DOT_TRUCK: [
    ['Cab', [
      ['gauges', 'Gauges, dash lights and engine warning lights work'],
      ['lights', 'Headlights, tail lights, brake lights, flashers and clearance lights'],
      ['cargolights', 'Fog lights, warning lights and cargo lights'],
      ['cabitems', 'Horn, wipers, washer, heater, defroster, seats and seat belts'],
      ['steerplay', 'Steering wheel has no extra play'],
      ['glass', 'Glass and mirrors'],
      ['clutch', 'Clutch free travel and adjustment']]],
    ['Engine', [
      ['coolant', 'Coolant level, radiator and heater hoses, no leaks'],
      ['fuellines', 'Fuel tank, lines and connections: no rubbing or leaks'],
      ['aircleaner', 'Air filter gauge; replace the filter if it is high'],
      ['exhaust', 'Exhaust: no leaks'],
      ['gearoil', 'Transmission, rear end and gearbox oil, no leaks'],
      ['driveshaft', 'Drive shaft, U-joints, center bearing and yokes']]],
    ['Steering and springs', [
      ['pwrsteer', 'Power steering oil level, no leaks'],
      ['springs', 'Springs, U-bolts, hangers and shackles: tight, no cracks']]],
    ['Brakes', [
      ['airlines', 'Air lines and hoses: no leaks or rubbing'],
      ['chambers', 'Brake chambers: no leaks or damage'],
      ['linings', 'Brake linings: no cracks, not worn'],
      ['adjust', 'Brake adjustment, parking brake and slack adjusters']]],
    ['Tires and wheels', [
      ['wheels', 'Wheels: no cracks'],
      ['tires', 'Tire condition and air pressure'],
      ['tread', 'Tread depth on every tire'],
      ['lugnuts', 'Lug nuts and axle nuts tight']]],
    ['Body', [
      ['body', 'Body: no damage; locks, latches and hinges work'],
      ['fifth', 'Fifth wheel and bolts']]]
  ],
  DOT_TRAILER: [
    ['Brakes', [
      ['airlines', 'Air lines, hoses and glad hands: no leaks or rubbing'],
      ['chambers', 'Brake chambers: no leaks or damage'],
      ['linings', 'Brake linings: no cracks, not worn'],
      ['adjust', 'Brake adjustment and slack adjusters'],
      ['drain', 'Drain the air tanks']]],
    ['Springs and frame', [
      ['springs', 'Springs, U-bolts, hangers and shackles: tight, no cracks'],
      ['kingpin', 'Kingpin and upper plate'],
      ['landing', 'Landing gear works'],
      ['frame', 'Frame and cross members: no cracks']]],
    ['Tires and wheels', [
      ['wheels', 'Wheels: no cracks'],
      ['tires', 'Tire condition and air pressure'],
      ['tread', 'Tread depth on every tire'],
      ['lugnuts', 'Lug nuts and axle nuts tight']]],
    ['Lights and body', [
      ['lights', 'All trailer lights work'],
      ['tape', 'Reflective tape and mud flaps'],
      ['body', 'Body and doors: no damage; locks, latches and hinges work']]]
  ]
};

// The list for a work order's service: PM (trucks), REEFER (trailers), DOT (both). '' when it has none.
function listFor(serviceKey, unitType) {
  const trailer = String(unitType || '').toUpperCase() === 'TRAILER', key = String(serviceKey || '').toUpperCase();
  if (key === 'PM') return trailer ? 'REEFER_TRAILER' : 'PM_TRUCK';
  if (key === 'REEFER') return 'REEFER_TRAILER';
  if (key === 'DOT') return trailer ? 'DOT_TRAILER' : 'DOT_TRUCK';
  return '';
}
// Every item of a list, in order: [{id, text, section}].
function items(name) {
  const out = [];
  (LISTS[name] || []).forEach(([section, list]) => list.forEach(([id, text]) => out.push({ id, text, section })));
  return out;
}
// The tablet's copy: {name: [{section, items: [{id, text}]}]}.
function forTablet() {
  const out = {};
  Object.keys(LISTS).forEach(n => { out[n] = LISTS[n].map(([section, list]) => ({ section, items: list.map(([id, text]) => ({ id, text })) })); });
  return out;
}
/*
 * What the mechanic answered, checked against the list: every item once, each OK, FIX or NA. Returns {rows, fix} (rows as saved
 * on the work order, fix = the items marked Needs work) or {error}.
 */
function checkAnswers(name, answers) {
  const list = items(name);
  if (!list.length) return { rows: [], fix: [] };
  const given = {};
  (Array.isArray(answers) ? answers : []).forEach(a => { if (a && typeof a === 'object' && typeof a.id === 'string') given[a.id] = String(a.r || '').toUpperCase(); });
  const missing = list.filter(i => RESULTS.indexOf(given[i.id]) < 0);
  if (missing.length) return { error: 'Answer every line of the checklist (' + missing.length + ' left).' };
  const rows = list.map(i => ({ id: i.id, section: i.section, item: i.text, result: given[i.id] }));
  return { rows, fix: rows.filter(r => r.result === 'FIX').map(r => r.item) };
}

module.exports = { RESULTS, LISTS, listFor, items, forTablet, checkAnswers };

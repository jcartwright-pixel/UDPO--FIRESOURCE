/*
 * Joe 11/1: "Unit number, trip start/end times and GPS locations to identify departure and return, trip mileage, fuel
 * consumed or total-fuel counter readings, trip MPG, if available. Can we test to see if we can get this from our API?"
 *
 * GPS Setup's Trip check: one truck, one New York day, read only. It asks Verizon Connect Fleet (fleetgps.js login) for:
 *   1. the fields Fleet offers (the same lists Ask Verizon reads), keeping the GPS point readings about fuel, odometer,
 *      fuel economy, ignition and trips, and naming any other table that sounds like trips (Trip, DrivingPeriod, Stop);
 *   2. that truck's GPS points for the day with those readings (asked with the truck's unit number; if Fleet refuses a
 *      unit list, as it did 10/21, every unit's points by time a few hours at a time, keeping this truck's);
 *   3. trips worked out here: leaving the Uniontown yard to coming back (the Fleet places named Uniontown ... and the
 *      Loading Dock, as the rest of the app uses), miles, the fuel counter at both ends, fuel used and MPG.
 * Nothing is saved in the app and nothing is written to the sheets; in Fleet it only saves its own UDPO_Trip* reports
 * (Intent = Retrieve, like every other report the app saves there). tools/gps-trip-check.cjs runs the same check on the
 * practice copy from GitHub.
 */
'use strict';

const F = require('./fleetgps');
const { key, execute, saveProbeTemplate, utcIso, nyDate, nyMidnight, addDays, num, yes, milesApart, fleetTime, withDefaults, short, YARD_MILES } = F.internals;

const WORDS = /fuel|odometer|economy|mpg|ignition|trip|distance|idle/i;
// The ones Joe's list needs, asked first when Fleet offers them.
const WANT = ['TotalFuelUsed', 'TripFuelUsed', 'Odometer', 'DerivedOdometer', 'AverageFuelEconomy', 'TripDistance', 'FuelLevel', 'FuelRemaining', 'Ignition', 'IgnitionOn', 'IdleTime', 'TotalIdleFuelUsed'];
const MAX_COLS = 30, TABLE_WORDS = /trip|drivingperiod|driving period|stop|journey|visit/i, BUDGET_MS = 105000;
const outName = (n) => 'F_' + String(n).replace(/[^A-Za-z0-9]/g, '_');

/** A Fleet value in our units: gallons, miles, miles per gallon. unitName is the unit Fleet keeps the field in. */
function toOurs(v, unitName, typeName) {
  const n = num(v), u = String(unitName || '').toLowerCase(), t = String(typeName || '').toLowerCase();
  if (n === null) return { value: null, unit: '' };
  const r = (x, p) => Math.round(x * p) / p;
  if (/kilomet(er|re)s? per lit|km\/l/.test(u)) return { value: r(n * 2.35215, 100), unit: 'mpg' };
  if (/lit(er|re)s? per 100|l\/100/.test(u)) return { value: n > 0 ? r(235.215 / n, 100) : null, unit: 'mpg' };
  if (/miles? per gallon|mpg/.test(u)) return { value: r(n, 100), unit: 'mpg' };
  if (/lit(er|re)|^l$/.test(u)) return { value: r(n * 0.264172, 100), unit: 'gal' };
  if (/gallon/.test(u)) return { value: r(n, 100), unit: 'gal' };
  if (/kilomet(er|re)|^km$/.test(u)) return { value: r(n * 0.621371, 10), unit: 'mi' };
  if (/^met(er|re)s?$|^m$/.test(u) && /distance/.test(t)) return { value: r(n / 1609.344, 10), unit: 'mi' };
  if (/mile/.test(u)) return { value: r(n, 10), unit: 'mi' };
  return { value: n, unit: unitName || '' };
}

/** The trips in one truck's day. points: [{at, lat, lon, address, miles, v: {field: value in our units}}] sorted by time. */
function tripsOf(points, yards, cols) {
  const out = [];
  if (!points.length) return out;
  const yardAt = (p) => yards.length && p.lat !== null && p.lon !== null ? yards.some(y => milesApart(y, p) <= YARD_MILES) : null;
  const flags = points.map(yardAt), haveYard = flags.some(f => f !== null);
  const fuelCol = pick(cols, [/^TotalFuelUsed$/i, /total.*fuel.*used/i, /fuel.*total/i], 'gal');
  const tripFuelCol = pick(cols, [/^TripFuelUsed$/i, /trip.*fuel/i], 'gal');
  const odoCol = pick(cols, [/^Odometer$/i, /^DerivedOdometer$/i, /odometer/i], 'mi');
  const mpgCol = pick(cols, [/^AverageFuelEconomy$/i, /economy/i], 'mpg');
  const spans = [];
  if (haveYard) {
    let start = flags[0] === false ? 0 : -1;
    for (let i = 1; i < points.length; i++) {
      if (flags[i - 1] === true && flags[i] === false) start = i - 1;
      if (start >= 0 && flags[i - 1] === false && flags[i] === true) { spans.push([start, i]); start = -1; }
    }
    if (start >= 0) spans.push([start, points.length - 1, 'open']);
  } else {
    const moved = points.map((p, i) => p.miles >= 0.05 ? i : -1).filter(i => i >= 0);
    if (moved.length) spans.push([Math.max(0, moved[0] - 1), moved[moved.length - 1], 'no yard']);
  }
  spans.forEach(([a, b, why]) => {
    const part = points.slice(a, b + 1);
    const miles = Math.round(part.slice(1).reduce((m, p) => m + (p.miles > 0 && p.miles < 200 ? p.miles : 0), 0) * 10) / 10;
    if (miles < 1) return;
    const first = (c, list) => { for (const p of list) if (p.v[c] != null) return p.v[c]; return null; };
    const nearStart = points.slice(0, a + 1).reverse().concat(part), nearEnd = points.slice(b).concat(part.slice().reverse());
    const odo0 = odoCol ? first(odoCol, nearStart) : null, odo1 = odoCol ? first(odoCol, nearEnd) : null;
    const fuel0 = fuelCol ? first(fuelCol, nearStart) : null, fuel1 = fuelCol ? first(fuelCol, nearEnd) : null;
    const tripFuel = tripFuelCol ? Math.round(part.slice(1).reduce((m, p) => m + (p.v[tripFuelCol] > 0 ? p.v[tripFuelCol] : 0), 0) * 100) / 100 : null;
    const counterFuel = fuel0 !== null && fuel1 !== null && fuel1 >= fuel0 ? Math.round((fuel1 - fuel0) * 100) / 100 : null;
    const fuel = counterFuel !== null && counterFuel > 0 ? counterFuel : tripFuel !== null && tripFuel > 0 ? tripFuel : null;
    const odoMiles = odo0 !== null && odo1 !== null && odo1 >= odo0 ? Math.round((odo1 - odo0) * 10) / 10 : null;
    const s = part[0], e = part[part.length - 1];
    out.push({
      left: s.at, leftLat: s.lat, leftLon: s.lon, leftAddress: s.address, back: why === 'open' ? '' : e.at, backLat: e.lat, backLon: e.lon, backAddress: e.address,
      lastSeen: e.at, note: why === 'open' ? 'Not back in the yard by the end of the day' : why === 'no yard' ? 'No yard place known: first to last movement' : a === 0 && flags[0] === false ? 'Already out at the start of the day' : '',
      miles, odometerStart: odo0, odometerEnd: odo1, odometerMiles: odoMiles,
      fuelCounterStart: fuel0, fuelCounterEnd: fuel1, fuelUsedCounter: counterFuel, fuelUsedTrip: tripFuel, fuelUsed: fuel,
      mpg: fuel ? Math.round(((odoMiles || miles) / fuel) * 10) / 10 : null, lifetimeMpg: mpgCol ? first(mpgCol, nearEnd) : null
    });
  });
  return out;
}
function pick(cols, tests, unit) {
  for (const t of tests) { const c = cols.find(x => t.test(x.name) && (!unit || x.unit === unit || !x.unit)); if (c) return c.name; }
  return '';
}

/** input: {tag, date (yyyy-mm-dd, New York day; blank = yesterday)}. Read only. */
async function tripCheck(db, input, options) {
  const o = withDefaults(options), began = o.now().getTime(), at = o.now().toISOString(), budget = o.budgetMs || BUDGET_MS;
  const ref = db.collection('private').doc('gpsFleet'), d = (await ref.get()).data() || {};
  if (!d.fleet || !d.user || !d.password) throw new F.FleetError('LOGIN', 'Save the Fleet login first.');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(input.date || '')) ? input.date : addDays(nyDate(at), -1);
  if (date > nyDate(at)) throw new F.FleetError('BAD_REQUEST', 'Pick today or an earlier day.');
  const trucks = (await db.collection('gpsTrucks').get()).docs.map(x => x.data());
  const bare = (x) => String(x || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  let tag = String(input.tag || '').trim().slice(0, 40), unit = null;
  if (!tag) {
    // No truck typed (the GitHub run): the truck (not a T- trailer) with the most miles that day.
    const days = (await db.collection('gpsDays').where('date', '==', date).get()).docs.map(x => x.data())
      .filter(x => !/^T-/i.test(String(x.tag || '')) && num(x.miles) > 0).sort((a, b) => num(b.miles) - num(a.miles));
    unit = days.map(x => trucks.find(t => bare(t.tag) === bare(x.tag) && t.unitId)).find(Boolean) || null;
    if (!unit) throw new F.FleetError('BAD_REQUEST', 'No truck had miles on ' + date + '. Type a truck number.');
  } else unit = trucks.find(t => bare(t.tag) === bare(tag)) || null;
  if (!unit || !unit.unitId) throw new F.FleetError('BAD_REQUEST', 'Fleet\'s last read has no unit ' + tag + '. Type the number as Fleet shows it.');
  tag = unit.tag;
  const yards = trucks.filter(t => F.atYardPlace(t) && t.lat != null && t.lon != null).map(t => ({ lat: t.lat, lon: t.lon }));
  const token = await key(ref, d, o, false);
  const run = (name, params, points) => execute(d, o, token, name, params, { points, maxPolls: 25 });
  const notes = [];

  // 1. The fields Fleet offers (the same lists and report names as Ask Verizon).
  const tables = {}, types = {}, units = {};
  const list = async (name, table, out, fill) => { try { await saveProbeTemplate(d, o, token, name, table, [], [], out); (await run(name, {})).forEach(fill); } catch (e) { if (!(e instanceof F.FleetError)) throw e; } };
  await list('UDPO_ProbeTables', 'Table-1.0', ['Id = Input.Id', 'Name = Input.Name'], r => { tables[r.Id] = r.Name; });
  await list('UDPO_ProbeTypes', 'DataType-1.0', ['Id = Input.Id', 'Name = Input.Name', 'IsMeasurement = Input.IsMeasurement', 'UnitId = Input.ReferenceMeasurementUnitId'], r => { types[r.Id] = r; });
  await list('UDPO_ProbeUnits', 'MeasurementUnit-1.0', ['Id = Input.Id', 'Name = Input.Name', 'Abbreviation = Input.Abbreviation'], r => { units[r.Id] = r; });
  await saveProbeTemplate(d, o, token, 'UDPO_ProbeColumns', 'Column-1.0', [], [], ['TableId = Input.TableId', 'Name = Input.Name', 'Description = Input.Description', 'DataType = Input.DataTypeId', 'IsDiagnostic = Input.IsDiagnostic', 'IsReadable = Input.IsReadable']);
  const all = (await run('UDPO_ProbeColumns', {})).map(r => {
    const t = types[r.DataType] || {}, u = units[t.UnitId] || {};
    return { tableId: r.TableId, table: String(tables[r.TableId] || r.TableId), name: r.Name || '', description: r.Description || '', type: t.Name || r.DataType || '',
      unitName: /^true$/i.test(t.IsMeasurement || '') ? (u.Name || u.Abbreviation || '') : '', diagnostic: yes(r.IsDiagnostic), readable: !/^false$/i.test(r.IsReadable || '') };
  });
  const pointId = Object.keys(tables).find(id => /^point-2/i.test(tables[id])) || (() => { const n = {}; all.filter(f => f.diagnostic).forEach(f => { n[f.tableId] = (n[f.tableId] || 0) + 1; }); return Object.keys(n).sort((x, y) => n[y] - n[x])[0]; })();
  const offered = all.filter(f => f.tableId === pointId && f.diagnostic && f.readable && WORDS.test(f.name));
  const rank = (f) => { const i = WANT.findIndex(w => w.toLowerCase() === f.name.toLowerCase()); return i < 0 ? 99 : i; };
  const cols = offered.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)).slice(0, MAX_COLS)
    .map(f => Object.assign({}, f, { unit: toOurs(1, f.unitName, f.type).unit }));
  if (offered.length > MAX_COLS) notes.push(offered.length + ' fuel, odometer and trip readings offered; the first ' + MAX_COLS + ' were asked for.');
  const otherTables = Object.keys(tables).filter(id => id !== pointId && TABLE_WORDS.test(tables[id]))
    .map(id => ({ table: tables[id], columns: all.filter(f => f.tableId === id).map(f => f.name) }));

  // 2. The truck's GPS points for the day.
  const from = new Date(nyMidnight(new Date(date + 'T16:00:00Z'))), next = new Date(nyMidnight(new Date(addDays(date, 1) + 'T16:00:00Z')));
  const to = next < o.now() ? next : o.now();
  const output = ['UnitId = Input.UnitId', 'Time(yyyy-MM-dd HH:mm:ss, UTC) = Input.Time', 'Lat = Input.Lat', 'Lon = Input.Lon', 'Address = Input.Address', 'MilesDelta(mile) = Input.OdometerDelta']
    .concat(cols.map(c => outName(c.name) + ' = Input.' + c.name));
  let rows = [], how = 'asked for this truck only';
  try {
    await saveProbeTemplate(d, o, token, 'UDPO_TripDay', 'Point-2.0', ['Since(Timestamp,UTC) = "Since"', 'Until(Timestamp,UTC) = "Until"', 'Ids(Set<Text>) = "Ids"'],
      ['Time = Between(Since, Until)', 'UnitId = In(Ids)'], output);
    rows = await run('UDPO_TripDay', { Since: fleetTime(from), Until: fleetTime(to), Ids: String(unit.unitId) }, true);
  } catch (e) {
    if (!(e instanceof F.FleetError)) throw e;
    notes.push('Asking for this truck only failed (' + short(e.message) + '); asked for every unit a few hours at a time instead.');
    how = 'every unit asked, this truck kept';
    await saveProbeTemplate(d, o, token, 'UDPO_TripDayAll', 'Point-2.0', ['Since(Timestamp,UTC) = "Since"', 'Until(Timestamp,UTC) = "Until"'], ['Time = Between(Since, Until)'], output);
    for (let t = from.getTime(); t < to.getTime(); t += 3 * 3600000) {
      if (o.now().getTime() - began > budget) { notes.push('Ran out of time at ' + new Date(t).toISOString() + '; the rest of the day was not read.'); break; }
      const end = new Date(Math.min(to.getTime(), t + 3 * 3600000));
      (await run('UDPO_TripDayAll', { Since: fleetTime(new Date(t)), Until: fleetTime(end) }, true)).forEach(r => { if (String(r.UnitId) === String(unit.unitId)) rows.push(r); });
    }
  }
  const points = rows.filter(r => String(r.UnitId) === String(unit.unitId)).map(r => {
    const v = {};
    cols.forEach(c => { const x = toOurs(r[outName(c.name)], c.unitName, c.type); if (x.value !== null) v[c.name] = x.value; });
    return { at: utcIso(r.Time), lat: num(r.Lat), lon: num(r.Lon), address: r.Address || '', miles: num(r.MilesDelta) || 0, v };
  }).filter(p => p.at).sort((a, b) => a.at < b.at ? -1 : a.at > b.at ? 1 : 0);
  const fields = cols.map(c => {
    const have = points.filter(p => p.v[c.name] != null);
    return { name: c.name, description: c.description, unit: c.unit || c.unitName, points: have.length, first: have.length ? have[0].v[c.name] : null, last: have.length ? have[have.length - 1].v[c.name] : null };
  });
  if (!yards.length) notes.push('No unit was at a Uniontown place in the last read, so trips run from first to last movement.');
  return { at, date, tag, unitId: String(unit.unitId), how, points: points.length, fields, otherTables, trips: tripsOf(points, yards, cols), notes,
    sample: points.filter((p, i) => i % Math.max(1, Math.floor(points.length / 40)) === 0).slice(0, 40) };
}

module.exports = { tripCheck, tripsOf, toOurs };

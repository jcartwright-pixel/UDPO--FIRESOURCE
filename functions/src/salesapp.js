/*
 * The Sales app (Joe 10/31): a phone app for the salespeople. Each route of their division, who is driving it, its status and
 * where it is now, with a map on top that moves to the route they tap. Read only: nothing here writes anything.
 *
 * Who may use it (Joe 10/31: "as long as they have a United Dairy account, they can use it. No other access information is
 * needed."): any signed-in United Dairy Google account. They are not checked against the Users list.
 *
 * Divisions: the plants (Uniontown, Charleston, Martins Ferry) that are running; each keeps its own loads in its own database.
 *
 * Which loads: the operating day that is running now (the 6 a.m. roll) and the one before it, whose trucks may still be out.
 * The status is the 6:00 AM sales email's (salesmail.js): the trailer's GPS first for when it left, else the truck's; On time /
 * Left late / Not departed / Not loaded, with how far behind, counted from dispatch. Ended Up Not Running is left off.
 *
 * Where it is: the trailer's GPS unit (Verizon Connect Fleet, gpsTrucks) first, else the truck's: its last report, as words
 * (At the plant, At a place, Stopped: an address, On the road: an address) and as a point for the map.
 */
'use strict';

const L = require('./logic');
const S = require('./salesmail');
const { trailerKey, trailerUnits, runTrucks, inYard, yardSpots } = require('./fleetgps');
const { safeIdPart } = require('./model');

const MOVING_MPH = 3;
const UNITS_KEEP_MS = 60 * 1000; // the 520 GPS units are read at most once a minute per server (the GPS itself is read every 5)
const text = (v) => (v === null || v === undefined ? '' : String(v).trim());

// Joe 11/1 (two-line mock-up 3): the GPS sometimes gives an address as "US|21795|Mary Rd [MD-63]". Shown as
// "Mary Rd (MD-63), 21795": no country, the road first, the zip code last, round brackets.
function cleanAddress(raw) {
  const s = text(raw);
  if (!s.includes('|') && !s.includes('[')) return s;
  let parts = s.split('|').map(p => p.trim()).filter(Boolean);
  if (parts.length > 1 && /^[A-Z]{2,3}$/.test(parts[0])) parts = parts.slice(1);
  const zip = parts.filter(p => /^\d{5}(-\d{4})?$/.test(p));
  const rest = parts.filter(p => !zip.includes(p));
  return rest.concat(zip).join(', ').replace(/\[\s*([^\]]*?)\s*\]/g, '($1)').replace(/\s{2,}/g, ' ');
}

// Where a GPS unit is, in plain words.
function whereOf(unit, spots, left) {
  if (!unit) return 'No GPS';
  if (inYard(unit, spots)) return left ? 'Back at the plant' : 'At the plant';
  const place = text(unit.place), address = cleanAddress(unit.address);
  // Joe 10/31: a place marked in Fleet (a Walmart, a customer's store) shows by its name, never the street address.
  if (place) return 'At ' + place;
  // Joe 11/1 (mock-up 3): short, so it fits on the route's second line ("Stopped: Mary Rd (MD-63), 21795").
  if (unit.speedMph !== null && unit.speedMph !== undefined && unit.speedMph > MOVING_MPH) return address ? 'On the road: ' + address : 'On the road';
  return address ? 'Stopped: ' + address : 'Stopped';
}

// Joe 11/1 (mock-up 3): the status on one line: "Left 10:12 AM, 2h 12m late" (the 6 AM email keeps "2 hr 12 min").
function shortStatus(word) {
  return text(word).replace(/(\d+) hr (\d+) min/g, '$1h $2m').replace(/(\d+) hr\b/g, '$1h').replace(/(\d+) min\b/g, '$1m');
}

// When the GPS last heard from the unit: "10:42 AM", with the date (10-30-26) when it was not today.
function gpsWhen(ms, now) {
  if (!ms || !isFinite(ms)) return '';
  const R = require('./plant-rules'), wall = R.wallClock(ms), day = Math.floor(wall / 1440);
  return S.clock12(wall) + (day !== Math.floor(now / 1440) ? ' ' + S.shortDate(new Date(day * 86400000).toISOString().slice(0, 10)) : '');
}

/**
 * The screen's rows. input: { runs, reefer, gpsDays, units: {key: gpsTrucks doc} }. Returns
 * { today, groups: [{ loadDate, label, rows: [{ id, route, driver, status, tone, where, gpsAt, by, lat, lon }] }] }.
 */
function salesScreen(input, nowMs) {
  const R = require('./plant-rules');
  const now = R.wallClock(nowMs), today = L.operatingDay(new Date(nowMs));
  const units = input.units || {}, spots = yardSpots(units);
  const byTruck = {};
  Object.keys(units).forEach(k => { const u = units[k], key = S.unitKey(u.tag); if (key && (!byTruck[key] || String(u.lastReport || '') > String(byTruck[key].lastReport || ''))) byTruck[key] = u; });
  const dates = [L.addDays(today, -1), today];
  const all = dates.map(d => S.loadsOn(input.runs, d));
  const trailerGps = trailerUnits(units, [].concat(...all).map(x => x.trailer).filter(Boolean), runTrucks(input.runs));
  const groups = dates.map((loadDate, i) => {
    const rows = all[i].map(x => {
      const left = S.leftAt(x, input.reefer, input.gpsDays), s = S.statusOf(x, left, now);
      const tu = x.trailer ? trailerGps[trailerKey(x.trailer)] : null, unit = tu || byTruck[S.unitKey(x.truck)] || null;
      const hasPoint = unit && typeof unit.lat === 'number' && typeof unit.lon === 'number';
      const seen = unit && Date.parse(unit.lastReport || '');
      return {
        id: x.runDocId + '|' + x.day, route: x.route, driver: x.driver, status: shortStatus(s.word), tone: s.tone,
        where: whereOf(unit, spots, !!(left && left.at !== null)), by: unit ? (tu ? 'TRAILER' : 'TRUCK') : '',
        gpsAt: gpsWhen(seen, now),
        lat: hasPoint ? unit.lat : null, lon: hasPoint ? unit.lon : null
      };
    }).sort((a, b) => a.route.localeCompare(b.route, undefined, { numeric: true }) || a.driver.localeCompare(b.driver));
    const label = (loadDate === today ? 'Today, ' : 'Loaded ') + S.weekdayOf(loadDate) + ' ' + S.shortDate(loadDate);
    return { loadDate, label, rows };
  }).filter(g => g.rows.length).reverse();
  return { today, todayText: S.weekdayOf(today) + ' ' + S.shortDate(today), groups };
}

const unitsCache = new WeakMap();
async function readUnits(db, nowMs) {
  const kept = unitsCache.get(db);
  if (kept && nowMs - kept.at < UNITS_KEEP_MS) return kept.units;
  const units = {};
  (await db.collection('gpsTrucks').get()).docs.forEach(x => { units[x.id] = x.data(); });
  unitsCache.set(db, { at: nowMs, units });
  return units;
}

/** Reads what the screen needs at `nowMs` from one plant's database. */
async function readInput(db, nowMs) {
  const today = L.operatingDay(new Date(nowMs)), dates = [L.addDays(today, -1), today];
  const weeks = [...new Set(dates.flatMap(d => [L.weekStart(d), L.weekStart(L.addDays(d, 6))]))];
  const runs = (await db.collection('runs').where('weekStart', 'in', weeks).get()).docs.map(x => Object.assign({ id: x.id }, x.data()));
  const trailers = [...new Set(dates.flatMap(d => S.loadsOn(runs, d)).map(x => x.trailer ? trailerKey(x.trailer) : '').filter(Boolean))];
  const reefer = {};
  if (trailers.length) (await db.getAll(...trailers.map(t => db.collection('gpsReefer').doc(safeIdPart(t))))).forEach((s, i) => { if (s.exists) reefer[trailers[i]] = s.data(); });
  const gpsDays = (await db.collection('gpsDays').where('date', '>=', dates[0]).where('date', '<=', L.addDays(today, 1)).get()).docs.map(x => x.data());
  return { runs, reefer, gpsDays, units: await readUnits(db, nowMs) };
}

/**
 * The one call. divisions: [{ id, name }] the plants that are running; dbFor(id) their databases. input: { division }.
 * Returns { divisions, division, refreshed, todayText, groups }; with input.what 'customers', { divisions, division, today, customers }.
 */
async function salesCall(divisions, dbFor, input, deps) {
  const nowMs = deps && deps.now ? deps.now() : Date.now();
  const want = text(input && input.division), pick = divisions.find(d => d.id === want) || divisions[0];
  if (!pick) return { divisions: [], division: '', groups: [], todayText: '', refreshed: '', customers: { rows: [], savedAt: '' } };
  const R = require('./plant-rules');
  // Joe 11/1: the Customers card reads the division's customer list (salescustomers.js), kept in the main database.
  if (text(input && input.what) === 'customers') {
    const customers = await require('./salescustomers').forSales((deps && deps.rootDb) || dbFor(pick.id), pick.id);
    return { divisions, division: pick.id, today: L.operatingDay(new Date(nowMs)), customers };
  }
  const screen = salesScreen(await readInput(dbFor(pick.id), nowMs), nowMs);
  return Object.assign({ divisions, division: pick.id, refreshed: S.clock12(R.wallClock(nowMs)) }, screen);
}

module.exports = { salesCall, salesScreen, whereOf, cleanAddress, shortStatus, readInput };

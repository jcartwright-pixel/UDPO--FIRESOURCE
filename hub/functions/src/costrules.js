/*
 * The shared cost rules through the Hub (Joe 11-12-26: "I am sharing information between route cost and route trip. Like the
 * rule set and exactly where I'm getting the dollar amounts ... should this go in the hub? That way they share the
 * information"). One record that Route Cost Analysis and the Route & Trip Estimator both read, so a route and a trip are
 * costed from the same numbers:
 *
 *   hubCostRules/current   the rule set, every rate, the diesel price and miles a gallon, and beside each dollar amount where
 *                          it came from (the P&L months behind it, the fuel month, the trucks' GPS month)
 *   hubCostRuleSet/current Joe's rule set once it is saved through the Hub (op saveCostRules, administrators). Until then the
 *                          rule set is copied from Route Cost's routeCostRules/current, as saved on its Rule sets tab.
 *
 * Where each part comes from (read only; the Hub never writes another app's records):
 *   routeCostRates/current  Route Cost's rates (12 newest real P&L months, its own math; Joe 11-2-26: do not redo the apps'
 *                           code, so the Hub does not work the rates out again, it carries them with their months)
 *   routeCostRules/current  Route Cost's Rule sets tab (until a rule set is saved through the Hub)
 *   fuelQuotes              the Fuel app's delivered diesel quotes (B2), averaged by month
 *   gpsTripFuel             Operations' truck trips: miles ÷ gallons by month (readings of 2 to 25 miles a gallon only)
 *
 * Joe's rules carried in the record (MASTER.md section 3, DECISIONS.md 11-12-26):
 *   - diesel and miles a gallon come from the month before, until the month is over (Joe: "if I'm in October, it should use
 *     our September's costing for fuel"); each falls back one more month; 6.2 and $4.87 stand in when there is nothing
 *   - a mileage run pays 1 hour plus 1 hour a stop (Joe: "only one hour, and then each stop is 1 hour")
 *   - a run shorter than a day: a setting (shortRun) until Joe picks one rule for both apps. Today Route Cost pays half a day
 *     for 6 hours or less, and Route & Trip pays its hours ÷ the hours a day.
 *
 * Rebuilt when any of those records change, and every hour (the truck trips change all day).
 */
'use strict';

const OUT = 'hubCostRules';
const SAVED = 'hubCostRuleSet';
const RATES = 'routeCostRates';
const RULES = 'routeCostRules';
const QUOTES = 'fuelQuotes';
const TRIPS = 'gpsTripFuel';

// Route Cost's starting values (its config.mjs RULES), used only when no rule set is saved anywhere.
const START = { driverDaysWeek: 5, dayCabDaysWeek: 5, sleeperRunsWeek: 3, sleeperDayRunsWeek: 0, sleeperDriverDays: 2,
  hoursDay: 12, milesDay: 200, sleeperMiles: 900, sleeperNights: 1, extras: [] };
const LIMITS = [['driverDaysWeek', 1, 7], ['dayCabDaysWeek', 1, 7], ['sleeperRunsWeek', 0, 7], ['sleeperDayRunsWeek', 0, 7],
  ['sleeperDriverDays', 1, 7], ['hoursDay', 1, 24], ['milesDay', 0, 3000], ['sleeperMiles', 0, 5000], ['sleeperNights', 0, 7]];
// Joe 11-12-26: a mileage run pays 1 hour plus 1 hour a stop.
const MILE_RUN = { firstHours: 1, perStopHours: 1 };
// The two short-run rules on the table until Joe picks one (MASTER.md section 5). Today's behavior is the starting value.
const SHORT_RUN = { hours: 'its hours ÷ the hours a day of a driver day and a truck day (a full day at most)',
  halfDay: 'half a driver day and half a truck day for 6 hours or less, a full day above that' };
const SHORT_START = { routeCost: 'halfDay', routeTrip: 'hours' };
const FUEL_START = { mpg: 6.2, price: 4.87, minMpg: 2, maxMpg: 25 };
// Every dollar amount Route Cost publishes, with where it comes from in plain words.
const RATE_FROM = {
  driverBaseWeek: ['Driver base, a week a driver', 'pnl'], truckBaseWeek: ['Truck base, a week a truck', 'pnl'],
  sleeperTruckBaseWeek: ['Sleeper truck base, a week', 'pnl'],
  driverHour: ['Driver pay an hour', 'rule'], driverMile: ['Driver pay a mile (mileage run)', 'rule'],
  perDiemNight: ['Per diem a night', 'rule'], overtimeHour: ['Overtime and pay above the rule, an hour', 'pnl'],
  tiresMile: ['Tires a mile', 'pnl'], garageMile: ['Garage, parts and repairs a mile (all three)', 'pnl'],
  garageShopMile: ['Garage a mile (the GAR column)', 'pnl'], garageDeprMile: ['Garage depreciation a mile', 'pnl'],
  partsMile: ['Truck parts and repairs a mile', 'pnl'], tollMile: ['Tolls a mile', 'pnl'], leaseMile: ['Lease a mile', 'rule'],
  fuelMile: ['Diesel a mile (price ÷ miles a gallon)', 'fuel'], fuelTiresMile: ['Diesel and tires a mile', 'fuel']
};

const r2 = (x) => Math.round(x * 100) / 100;
const r3 = (x) => Math.round(x * 1000) / 1000;
const text = (v) => (v === undefined || v === null ? '' : String(v).trim());

/** A rule set with every number checked (the same limits as Route Cost's Rule sets tab); anything unreadable keeps the start. */
function cleanRules(v) {
  const o = Object.assign({}, START);
  LIMITS.forEach(([k, lo, hi]) => { const y = Number(v && v[k]); if (v && v[k] !== '' && v[k] !== null && Number.isFinite(y) && y >= lo && y <= hi) o[k] = y; });
  if (o.sleeperRunsWeek + o.sleeperDayRunsWeek <= 0) o.sleeperRunsWeek = START.sleeperRunsWeek;
  const per = ['week', 'day', 'mile'];
  o.extras = (Array.isArray(v && v.extras) ? v.extras : []).slice(0, 30)
    .map(e => ({ name: text(e && e.name).slice(0, 60), amount: Number(e && e.amount) || 0, per: per.indexOf(e && e.per) >= 0 ? e.per : 'week' }))
    .filter(e => e.name && e.amount);
  const sr = Object.assign({}, SHORT_START);
  if (v && v.shortRun && typeof v.shortRun === 'object') ['routeCost', 'routeTrip'].forEach(k => { if (SHORT_RUN[v.shortRun[k]]) sr[k] = v.shortRun[k]; });
  o.shortRun = sr;
  return o;
}

const prevMonth = (m) => { const [y, mo] = m.split('-').map(Number); return mo === 1 ? (y - 1) + '-12' : y + '-' + String(mo - 1).padStart(2, '0'); };

/** { 'yyyy-mm': { price, quotes, mpg, miles, gallons } } from the fuel quotes and the truck trips (Route Cost's same filters). */
function fuelMonths(quotes, trips) {
  const out = {}, at = (m) => (out[m] = out[m] || { p: 0, n: 0, miles: 0, gal: 0, trips: 0 });
  (quotes || []).forEach(v => {
    const m = text(v && v.date).slice(0, 7), b2 = Number(v && v.b2);
    if (/^\d{4}-\d{2}$/.test(m) && b2 > 1 && b2 < 15) { at(m).p += b2; at(m).n++; }
  });
  (trips || []).forEach(v => {
    const m = text(v && v.day).slice(0, 7), mi = Number(v && v.miles), g = Number(v && v.fuelUsed);
    if (/^\d{4}-\d{2}$/.test(m) && mi > 0 && g > 0 && mi / g >= FUEL_START.minMpg && mi / g <= FUEL_START.maxMpg) { const o = at(m); o.miles += mi; o.gal += g; o.trips++; }
  });
  const months = {};
  Object.keys(out).sort().forEach(m => { const o = out[m];
    months[m] = { price: o.n ? r3(o.p / o.n) : 0, quotes: o.n, mpg: o.gal ? r2(o.miles / o.gal) : 0, miles: Math.round(o.miles), gallons: Math.round(o.gal), trips: o.trips }; });
  return months;
}

/** The diesel price and miles a gallon for `month`: its own once it is over, else the month before, else the one before that. */
function fuelFor(months, month, today) {
  const tries = (month < today ? [month] : []).concat([prevMonth(month), prevMonth(prevMonth(month))]), out = {};
  for (const m of tries) {
    const f = months[m] || {};
    if (!out.price && f.price > 0) Object.assign(out, { price: f.price, priceMonth: m, quotes: f.quotes });
    if (!out.mpg && f.mpg > 0) Object.assign(out, { mpg: f.mpg, mpgMonth: m, trips: f.trips });
  }
  return out;
}

const monthName = (m) => { if (!/^\d{4}-\d{2}$/.test(text(m))) return ''; const [y, mo] = m.split('-').map(Number); return mo + '-' + String(y).slice(2); };

/**
 * The shared record. src: { rates: routeCostRates/current, routeRules: routeCostRules/current, saved: hubCostRuleSet/current,
 * quotes: [fuelQuotes], trips: [gpsTripFuel] }; today: 'yyyy-mm' (New York).
 */
function build(src, today) {
  const rates = (src && src.rates) || null;
  const saved = src && src.saved;
  const ruleSource = saved ? 'hub' : src && src.routeRules ? 'routeCost' : 'start';
  const rawRules = saved || (src && src.routeRules) || {};
  const rules = Object.assign(cleanRules(rawRules), { savedAt: text(rawRules.savedAt), savedBy: text(rawRules.savedBy) });
  const months = fuelMonths(src && src.quotes, src && src.trips);
  const fuel = fuelFor(months, today, today);
  const price = fuel.price > 0 ? fuel.price : FUEL_START.price, mpg = fuel.mpg > 0 ? fuel.mpg : FUEL_START.mpg;
  const pnl = rates && rates.basisFrom ? 'the P&L, average of ' + (rates.basisMonths || '') + ' months ' + monthName(rates.basisFrom) + ' to ' + monthName(rates.basisTo) + ' (Route Cost\'s math)' : 'Route Cost\'s rates';
  const amounts = {};
  Object.keys(RATE_FROM).forEach(k => {
    if (!rates || !Number.isFinite(Number(rates[k]))) return;
    const [name, kind] = RATE_FROM[k];
    amounts[k] = { name, value: r2(Number(rates[k])), from: kind === 'pnl' ? pnl : kind === 'fuel' ? 'the Hub\'s diesel price ÷ miles a gallon (below)' : 'Joe\'s rule, set in Route Cost' };
  });
  // Diesel is the Hub's own, from the fuel quotes and the truck trips, the same for both apps.
  amounts.fuelPrice = { name: 'Diesel a gallon', value: price, from: fuel.price > 0 ? 'Fuel app, average delivered quote (B2), ' + monthName(fuel.priceMonth) + ', ' + fuel.quotes + ' quotes' : 'stand-in $4.87 (no fuel quotes for the month before)' };
  amounts.mpg = { name: 'Miles a gallon', value: mpg, from: fuel.mpg > 0 ? 'the trucks\' GPS trips, ' + monthName(fuel.mpgMonth) + ', ' + fuel.trips + ' trips' : 'stand-in 6.2 (no truck trips for the month before)' };
  amounts.fuelMile = { name: RATE_FROM.fuelMile[0], value: r3(price / mpg), from: 'diesel a gallon ÷ miles a gallon' };
  if (amounts.tiresMile) amounts.fuelTiresMile = { name: RATE_FROM.fuelTiresMile[0], value: r3(price / mpg + amounts.tiresMile.value), from: 'diesel a mile + tires a mile' };
  // The day and run costs both apps use, from the rule set (the math on Route Cost's Rule sets tab).
  const val = (k) => (amounts[k] ? amounts[k].value : null);
  const each = {};
  if (val('driverBaseWeek') !== null) each.driverDay = { name: 'Driver base, a day', value: r2(val('driverBaseWeek') / rules.driverDaysWeek), from: 'driver base a week ÷ ' + rules.driverDaysWeek + ' days a driver works' };
  if (val('truckBaseWeek') !== null) {
    each.dayCabDay = { name: 'Day cab, a day', value: r2(val('truckBaseWeek') / rules.dayCabDaysWeek), from: 'truck base a week ÷ ' + rules.dayCabDaysWeek + ' days a day cab runs' };
    const uses = rules.sleeperRunsWeek + rules.sleeperDayRunsWeek;
    each.sleeperRun = { name: 'Sleeper truck, a run', value: r2(val('truckBaseWeek') / uses), from: 'truck base a week ÷ ' + uses + ' uses (sleeper runs and day runs)' };
  }
  return {
    today, builtFrom: { rates: rates ? text(rates.savedAt) || text(rates.month) : '', rules: ruleSource },
    rules, ruleSource, mileRun: Object.assign({}, MILE_RUN, { rule: '1 hour plus 1 hour a stop (Joe 11-12-26)' }),
    shortRun: { routeCost: rules.shortRun.routeCost, routeTrip: rules.shortRun.routeTrip, choices: SHORT_RUN, decided: rules.shortRun.routeCost === rules.shortRun.routeTrip },
    fuelRule: 'the month before, until the month is over (Joe 11-12-26)',
    amounts, each, fuelMonths: months,
    rateMonth: rates ? text(rates.month) : '', hasRates: !!rates
  };
}

const nyMonth = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit' }).format(d || new Date()).slice(0, 7);

/** Reads every source and writes hubCostRules/current. */
async function rebuild(db, stamp) {
  const data = async (col, id) => { try { const s = await db.collection(col).doc(id).get(); return s.exists ? s.data() : null; } catch (e) { console.warn(col + ' not readable', e && e.message); return null; } };
  const list = async (q, col) => { try { return (await q.get()).docs.map(d => d.data()); } catch (e) { console.warn(col + ' not readable', e && e.message); return []; } };
  const [rates, routeRules, saved, quotes, trips] = await Promise.all([
    data(RATES, 'current'), data(RULES, 'current'), data(SAVED, 'current'),
    list(db.collection(QUOTES), QUOTES), list(db.collection(TRIPS).select('day', 'miles', 'fuelUsed'), TRIPS)
  ]);
  const rec = Object.assign(build({ rates, routeRules, saved, quotes, trips }, nyMonth()), { builtAt: stamp || new Date().toISOString() });
  await db.collection(OUT).doc('current').set(rec);
  return { amounts: Object.keys(rec.amounts).length, ruleSource: rec.ruleSource, today: rec.today };
}

class CostError extends Error { constructor(code, message) { super(message); this.code = code; } }

/** Administrators: save the rule set through the Hub (both apps' Rule sets screens call this), then rebuild at once. */
async function saveRules(db, email, input, stamp) {
  const v = input && input.rules;
  if (!v || typeof v !== 'object') throw new CostError('BAD_REQUEST', 'The rule set could not be read. Reload the page and try again.');
  const rules = Object.assign(cleanRules(v), { savedAt: stamp, savedBy: email, from: text(input.from).slice(0, 40) || 'hub' });
  await db.collection(SAVED).doc('current').set(rules);
  await db.collection('actions').doc('hub-' + require('crypto').randomBytes(8).toString('hex')).set({ action: 'saveCostRules', by: email, at: stamp, after: rules });
  await rebuild(db, stamp);
  return { ok: true, rules };
}

/** Anyone active: the shared record (rebuilt first when none is saved yet). */
async function read(db) {
  const s = await db.collection(OUT).doc('current').get();
  if (s.exists) return s.data();
  await rebuild(db);
  return (await db.collection(OUT).doc('current').get()).data();
}

module.exports = { build, cleanRules, fuelMonths, fuelFor, rebuild, saveRules, read, CostError, OUT, SAVED, RATES, RULES, QUOTES, START, MILE_RUN, SHORT_RUN };

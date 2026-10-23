// Where a Fleet unit is now (Trucks Today, Joe 10/9), shared by Trucks Today and the Route Distribution home's Manager card.
// Joe's Fleet places for the Uniontown yard (10/13: "Uniontown Branch" and "Uniontown Plant"). Only these exact place names
// count as In yard; a street address in the town of Uniontown does not. 10/14: trucks park at the Fleet place "Loading Dock"
// too, so driving from the dock into Uniontown Branch on the way out was read as a yard return (Praster "back 11:40 PM").
// 10/22: the Uniontown Garage (King St) is ours too: 524995 parked there showed "still out" all evening.
export const YARD_PLACES = ['UNIONTOWN BRANCH', 'UNIONTOWN PLANT', 'LOADING DOCK', 'UNIONTOWN GARAGE'], NO_SIGNAL_MINUTES = 30, DEAD_HOURS = 24;
export const unitKey = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const digits = (s) => String(s || '').replace(/\D/g, '');
// Fleet names a truck "223876" and a trailer "T-635"; ours are the same numbers (trailers stored as T- plus number).
export function gpsIndex(gps) {
  const byKey = {}, byDigits = {};
  gps.forEach(t => { const k = unitKey(t.tag); if (!k) return; byKey[k] = t; if (/^\d+$/.test(k)) byDigits[k] = t; });
  return (unit) => { const k = unitKey(unit); return k ? byKey[k] || (/^\d+$/.test(digits(unit)) && byDigits[digits(unit)]) || null : null; };
}
// A parked truck with the engine off reports rarely, so an old report is "No signal" only when the engine was on (or the
// unit has been silent a whole day, like a unit taken out of service).
export function truckState(t, truck) {
  if (!t) return String(truck || '').trim() ? ['nogps', 'Not in Fleet'] : ['notruck', 'No truck'];
  const mins = t.lastReport ? (Date.now() - Date.parse(t.lastReport)) / 60000 : Infinity;
  if (!(mins < DEAD_HOURS * 60) || (t.ignitionOn && mins > NO_SIGNAL_MINUTES)) return ['nosignal', 'No signal'];
  if (YARD_PLACES.indexOf(String(t.place || '').trim().toUpperCase()) >= 0 && !(t.speedMph > 3)) return ['yard', 'In yard'];
  return t.speedMph > 3 ? ['road', 'Driving'] : t.ignitionOn ? ['stopped', 'Stopped'] : ['stopped', 'Parked'];
}
// Joe 10/14: who worked a truck today. Daily Dispatch lists the loads loaded today, which mostly leave tomorrow (a 4:00 AM
// run loaded tonight), so a driver was showing, and was charged with his truck's alerts, a day early. A line counts here
// only when its run leaves today (the Live departure date, else its delivery date) and its driver is one of ours: never
// CARRIER, OPEN, a blank, or a route an owner or outside carrier covers.
export const NOT_OURS = /^(|open|carrier|tba|tbd|none|n\/a|na|.*needs driver.*|vacation.*|off)$/i;
// Joe 10/14: a sleeper route (Route Master "Sleeper", e.g. Jersey) leaves one day and comes back the next, so with
// opts.sleeper(row, run) it also keeps the sleeper runs that left yesterday. Each line carries leaves (its departure day).
export function workingToday(L, runs, today, opts = {}) {
  const byId = {}, out = [], seen = {}, yesterday = L.addDays(today, -1);
  (runs || []).forEach(r => { byId[r.id] = r; });
  [-3, -2, -1, 0, 1].forEach(n => L.dailyRows(runs, L.addDays(today, n)).forEach(r => {
    if (seen[r.id]) return;
    const run = byId[r.runDocId] || {}, day = (run.days || {})[r.day] || {}, leaves = L.dateKey(day.departureDate) || r.deliveryDate;
    if (leaves !== today && !(leaves === yesterday && opts.sleeper && opts.sleeper(r, run, day))) return;
    if (NOT_OURS.test(String(r.driver || '').trim()) || L.coveredRoute(r)) return;
    seen[r.id] = true; out.push(Object.assign({}, r, { leaves }));
  }));
  return out.sort((a, b) => (a.leaves === b.leaves ? 0 : a.leaves < b.leaves ? -1 : 1) || (a.dispatchTime == null ? 1e9 : a.dispatchTime) - (b.dispatchTime == null ? 1e9 : b.dispatchTime));
}

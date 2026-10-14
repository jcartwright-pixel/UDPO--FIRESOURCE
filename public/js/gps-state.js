// Where a Fleet unit is now (Trucks Today, Joe 10/9), shared by Trucks Today and the Route Distribution home's Manager card.
// Joe's Fleet places for the Uniontown yard (10/13: "Uniontown Branch" and "Uniontown Plant"). Only these exact place names
// count as In yard; a street address in the town of Uniontown does not.
export const YARD_PLACES = ['UNIONTOWN BRANCH', 'UNIONTOWN PLANT'], NO_SIGNAL_MINUTES = 30, DEAD_HOURS = 24;
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

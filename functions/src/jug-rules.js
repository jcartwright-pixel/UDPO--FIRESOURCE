/*
 * Plant Material Trailers rules shared by the server (jugtrailers.js) and the screen (public/js/jug-trailers-page.js).
 * Copied to public/js by npm run sync-logic.
 *
 * Joe 11/1 (mock-up 2): each trailer has a Trailer Company and a Unit number. United Dairy's unit numbers come from the fleet
 * list and United Dairy can never be deleted; every other company, its unit numbers, the "What is on it" items and the
 * Locations are lists people add to and delete from (a plant's jugTrailerLists record). Trailers saved before 11/1 have only a
 * number ("METRO 4579") and items that may end in "IN DOCK"; parts() reads them as company Metro, unit 4579, location In Dock.
 * Joe 11/3 (mock-up 2): the company is called the Supplier; every United Dairy dry box trailer is always on the list (NOT HERE
 * when it is not in the lot); the locations are UPPER LOT, LOWER LOT, DEBAG and HOLD; what is on it comes from Receiving's
 * Suppliers & Products with how many in what the product is counted in (a line's unit, e.g. Bundles).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./logic'));
  else root.UDJug = factory(root.UDLogic);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (L) {
  'use strict';
  const UD = 'United Dairy';
  // What the lists hold before anyone changes them: what was on the screen on 11/1.
  const SEED = Object.freeze({
    companies: ['BW', 'CKS', 'Compass', 'Duval', 'JD', 'Metro'],
    items: ['Clear 1/2', 'Clear Qt', 'Ferry White 1/2', 'White 1/2', 'White Qt'],
    locations: ['UPPER LOT', 'LOWER LOT', 'DEBAG', 'HOLD']
  });
  // Joe 11/3: the places a trailer can be, always on the list in this order; NOT HERE is a United Dairy trailer not in the lot.
  const LOCATIONS = SEED.locations;
  const NOT_HERE = 'NOT HERE';
  const text = (v) => (v === null || v === undefined ? '' : String(v).trim().replace(/\s+/g, ' '));
  const same = (a, b) => text(a).toUpperCase() === text(b).toUpperCase();
  const has = (list, v) => list.some(x => same(x, v));
  const byText = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true, sensitivity: 'base' });
  // A company name written the way people say it: short ones in capitals (CKS, JD), longer ones with a capital first (Metro).
  const companyName = (v) => { const t = text(v); return t.length <= 3 ? t.toUpperCase() : t.replace(/\S+/g, w => /[a-z]/.test(w) ? w : w.charAt(0) + w.slice(1).toLowerCase()); };
  const IN_DOCK = /\s+IN\s+DOCK\s*$/i;
  // A United Dairy unit number the one way (logic.js trailerNumber, rules audit line 12): 822, T822 and T-0822 are all T-822.
  const udUnit = (v) => L.trailerNumber(v);
  // Joe 11/3 ("trim down that list"): the trailers that carry plant material are the dry boxes, not refrigerated trailers or tankers.
  const dryBox = (u) => !/refrigerat|reefer|tank/i.test(text(u && u.notes));

  // One trailer's company, unit, items and location, also for trailers saved before 11/1.
  function parts(t, companies) {
    t = t || {};
    const number = text(t.number);
    let company = text(t.company), unit = text(t.unit);
    if (!company) {
      const m = number.match(/^(.*\S)\s+(\S+)$/);
      if (t.unitedDairy || !m) { company = UD; unit = number; }
      else { company = (companies || []).find(c => same(c, m[1])) || companyName(m[1]); unit = m[2]; }
    }
    if (same(company, UD)) unit = udUnit(unit);
    let location = text(t.location);
    const items = (Array.isArray(t.items) ? t.items : []).map(x => {
      let item = text(x && x.item);
      if (IN_DOCK.test(item)) { item = item.replace(IN_DOCK, ''); if (!t.location) location = 'In Dock'; }
      const line = { item, pallets: text(x && x.pallets) }, u = text(x && x.unit);
      if (u) line.unit = u;
      return line;
    });
    return { company, unit, items, location, unitedDairy: same(company, UD) };
  }

  // The lists people pick from: the saved lists (or the starting lists), plus anything a trailer in the lot still has, so a
  // trailer in the lot never shows a company, unit, item or location that is not on its list.
  function lists(saved, trailers) {
    const s = saved && typeof saved === 'object' ? saved : null;
    const companies = (s && Array.isArray(s.companies) ? s.companies : SEED.companies.map(name => ({ name, units: [] })))
      .map(c => ({ name: text(c && c.name), units: (Array.isArray(c && c.units) ? c.units : []).map(text).filter(Boolean) }))
      .filter(c => c.name && !same(c.name, UD));
    const items = (s && Array.isArray(s.items) ? s.items : SEED.items.slice()).map(text).filter(Boolean);
    const locations = LOCATIONS.concat((s && Array.isArray(s.locations) ? s.locations : []).map(text).filter(v => v && !has(LOCATIONS, v) && !same(v, NOT_HERE)));
    const names = companies.map(c => c.name);
    (trailers || []).filter(t => t && t.inLot !== false).forEach(t => {
      const p = parts(t, names);
      if (!p.unitedDairy) {
        let c = companies.find(x => same(x.name, p.company));
        if (!c) { c = { name: p.company, units: [] }; companies.push(c); names.push(c.name); }
        if (p.unit && !has(c.units, p.unit)) c.units.push(p.unit);
      }
      p.items.forEach(x => { if (x.item && !has(items, x.item)) items.push(x.item); });
      if (p.location && !has(locations, p.location) && !same(p.location, NOT_HERE)) locations.push(p.location);
    });
    companies.sort((a, b) => byText(a.name, b.name)).forEach(c => c.units.sort(byText));
    return { companies, items: items.sort(byText), locations: LOCATIONS.concat(locations.slice(LOCATIONS.length).sort(byText)) };
  }

  // Why something cannot be deleted from a list ('' when it can): United Dairy never; anything a trailer in the lot is using
  // waits until that trailer has left the lot.
  function deleteBlock(list, value, company, trailers, companies) {
    const inLot = (trailers || []).filter(t => t && t.inLot !== false).map(t => parts(t, companies));
    if (list === 'company') {
      if (same(value, UD)) return 'United Dairy is protected; it cannot be deleted.';
      const n = inLot.filter(p => same(p.company, value)).length;
      return n ? value + ' has ' + n + ' trailer' + (n === 1 ? '' : 's') + ' in the lot. It can be deleted after ' + (n === 1 ? 'it leaves' : 'they leave') + ' the lot.' : '';
    }
    if (list === 'unit') {
      if (same(company, UD)) return 'United Dairy is protected; its unit numbers come from the fleet list.';
      return inLot.some(p => same(p.company, company) && same(p.unit, value)) ? company + ' ' + value + ' is in the lot. It can be deleted after it leaves the lot.' : '';
    }
    if (list === 'item') return inLot.some(p => p.items.some(x => same(x.item, value))) ? value + ' is on a trailer in the lot. It can be deleted after it is off every trailer.' : '';
    if (list === 'location' && has(LOCATIONS, value)) return value + ' is one of the plant\'s places; it stays on the list.';
    if (list === 'location') return inLot.some(p => same(p.location, value)) ? 'A trailer in the lot is at ' + value + '. It can be deleted after no trailer is there.' : '';
    return 'Pick a list.';
  }

  // The trailer's saved number: United Dairy's unit alone (T-846), any other company's name and unit (METRO 4579), as before.
  const number = (company, unit) => (same(company, UD) ? text(unit) : text(company) + ' ' + text(unit)).toUpperCase().slice(0, 40);
  // The list order: United Dairy first, then by company, then by unit number.
  const order = (a, b) => (a.unitedDairy ? 0 : 1) - (b.unitedDairy ? 0 : 1) || byText(a.company, b.company) || byText(a.unit, b.unit);

  return { UD, SEED, LOCATIONS, NOT_HERE, udUnit, dryBox, parts, lists, deleteBlock, number, order, same, text, companyName };
});

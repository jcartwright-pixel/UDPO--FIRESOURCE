/*
 * Plant Material Trailers rules shared by the server (jugtrailers.js) and the screen (public/js/jug-trailers-page.js).
 * Copied to public/js by npm run sync-logic.
 *
 * Joe 11/1 (mock-up 2): each trailer has a Trailer Company and a Unit number. United Dairy's unit numbers come from the fleet
 * list and United Dairy can never be deleted; every other company, its unit numbers, the "What is on it" items and the
 * Locations are lists people add to and delete from (a plant's jugTrailerLists record). Trailers saved before 11/1 have only a
 * number ("METRO 4579") and items that may end in "IN DOCK"; parts() reads them as company Metro, unit 4579, location In Dock.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.UDJug = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const UD = 'United Dairy';
  // What the lists hold before anyone changes them: what was on the screen on 11/1.
  const SEED = Object.freeze({
    companies: ['BW', 'CKS', 'Compass', 'Duval', 'JD', 'Metro'],
    items: ['Clear 1/2', 'Clear Qt', 'Ferry White 1/2', 'White 1/2', 'White Qt'],
    locations: ['In Dock', 'In the Lot']
  });
  const text = (v) => (v === null || v === undefined ? '' : String(v).trim().replace(/\s+/g, ' '));
  const same = (a, b) => text(a).toUpperCase() === text(b).toUpperCase();
  const has = (list, v) => list.some(x => same(x, v));
  const byText = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true, sensitivity: 'base' });
  // A company name written the way people say it: short ones in capitals (CKS, JD), longer ones with a capital first (Metro).
  const companyName = (v) => { const t = text(v); return t.length <= 3 ? t.toUpperCase() : t.replace(/\S+/g, w => /[a-z]/.test(w) ? w : w.charAt(0) + w.slice(1).toLowerCase()); };
  const IN_DOCK = /\s+IN\s+DOCK\s*$/i;

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
    let location = text(t.location);
    const items = (Array.isArray(t.items) ? t.items : []).map(x => {
      let item = text(x && x.item);
      if (IN_DOCK.test(item)) { item = item.replace(IN_DOCK, ''); if (!t.location) location = 'In Dock'; }
      return { item, pallets: text(x && x.pallets) };
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
    const locations = (s && Array.isArray(s.locations) ? s.locations : SEED.locations.slice()).map(text).filter(Boolean);
    const names = companies.map(c => c.name);
    (trailers || []).filter(t => t && t.inLot !== false).forEach(t => {
      const p = parts(t, names);
      if (!p.unitedDairy) {
        let c = companies.find(x => same(x.name, p.company));
        if (!c) { c = { name: p.company, units: [] }; companies.push(c); names.push(c.name); }
        if (p.unit && !has(c.units, p.unit)) c.units.push(p.unit);
      }
      p.items.forEach(x => { if (x.item && !has(items, x.item)) items.push(x.item); });
      if (p.location && !has(locations, p.location)) locations.push(p.location);
    });
    companies.sort((a, b) => byText(a.name, b.name)).forEach(c => c.units.sort(byText));
    return { companies, items: items.sort(byText), locations: locations.sort(byText) };
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
    if (list === 'location') return inLot.some(p => same(p.location, value)) ? 'A trailer in the lot is at ' + value + '. It can be deleted after no trailer is there.' : '';
    return 'Pick a list.';
  }

  // The trailer's saved number: United Dairy's unit alone (T-846), any other company's name and unit (METRO 4579), as before.
  const number = (company, unit) => (same(company, UD) ? text(unit) : text(company) + ' ' + text(unit)).toUpperCase().slice(0, 40);
  // The list order: United Dairy first, then by company, then by unit number.
  const order = (a, b) => (a.unitedDairy ? 0 : 1) - (b.unitedDairy ? 0 : 1) || byText(a.company, b.company) || byText(a.unit, b.unit);

  return { UD, SEED, parts, lists, deleteBlock, number, order, same, text, companyName };
});

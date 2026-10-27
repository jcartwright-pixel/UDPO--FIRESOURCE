/*
 * United Dairy Distribution app: which sheets the transfer reads (Uniontown).
 *
 * The same spreadsheet IDs as the current app (005_V7000_CanonicalStorage.gs). They are only ever read.
 * A test or the sandbox project can point at copies with the SOURCES_JSON setting.
 */
'use strict';

const UNIONTOWN = Object.freeze({
  live: { spreadsheetId: '11beWtlO848OyZI_Bom9y2WCZn2vnw4mLm24pf-rO1Cg', maintenanceQueues: true, plant: true, weekHistory: true }, // queues: TRUCK / TRAILER / FORK TRUCK LIVE tabs; weekHistory: DISPATCH WEEK HISTORY
  masters: {
    routes: { spreadsheetId: '19neEpXEPFbon6-8DeZSG5BCTj2s2PfrCVRibWhUuFKc', tab: 'ROUTES_MASTER' },
    drivers: { spreadsheetId: '1rDZpcOABjGtSqobkIQPPNWyWmanfjyHeidGmTK67PvU', tab: 'DRIVERS_MASTER' },
    equipment: { spreadsheetId: '1eqZxqZNQs5gwuaRmQgPRbNvSmy7gOnwwwyoqFS3Djb4', tab: 'EQUIPMENT_MASTER' },
    users: { spreadsheetId: '1hmzHhGAX6NkF2qVDsYFhC_k7V3Ubfbi1WZjkvWKQA20', tab: 'USERS_MASTER' },
    exceptions: { spreadsheetId: '1Iczex1skLAFBX9atk0kRvEQimBTnhCRauKWH6SL4KoM', tab: 'DRIVER_EXCEPTIONS' },
    vacations: { spreadsheetId: '14gP6bChKZABMglED78OZLmy0LcJF91-tQWVo5bXtGW4', tab: 'DRIVER_VACATIONS' },
    // The Plant Operations Scheduler's journal, in the Live workbook (Weekly's PLANT LOAD marks).
    plantLoads: { spreadsheetId: '11beWtlO848OyZI_Bom9y2WCZn2vnw4mLm24pf-rO1Cg', tab: 'PLANT_OPERATIONS' },
    // The same journal's daily inspections (DVIR): each truck's newest odometer, for Fleet Service's PM due miles.
    odometers: { spreadsheetId: '11beWtlO848OyZI_Bom9y2WCZn2vnw4mLm24pf-rO1Cg', tab: 'PLANT_OPERATIONS' },
    // And its route check-ins and inspections, for the Driver Scorecard.
    plantEvents: { spreadsheetId: '11beWtlO848OyZI_Bom9y2WCZn2vnw4mLm24pf-rO1Cg', tab: 'PLANT_OPERATIONS' }
  },
  // The plant side (plant.js). Pickups live in the Plant Operations workbook (UDPO_V7000_STORAGE.MASTER.PLANT_OPERATIONS).
  plant: { pickups: { spreadsheetId: '1to7JVLHCqkIiU4uuIKP1ogjPBi_52eSS-b7TBKMBed0', tab: 'LIVE PLANT OPERATIONS' } }
});

// SOURCES_JSON replaces only what it names: {"live":{"spreadsheetId":"..."}} points the copy at a Live workbook
// copy and keeps the real masters (read only).
function transferSources(env) {
  const raw = env && env.SOURCES_JSON;
  if (!raw) return UNIONTOWN;
  const given = JSON.parse(raw);
  const masters = {};
  const named = given.masters || {};
  // The odometers and plant events come from the plant journal, so a copy named for plantLoads is read for them too.
  Object.keys(UNIONTOWN.masters).forEach(k => { masters[k] = Object.assign({}, UNIONTOWN.masters[k], (k === 'odometers' || k === 'plantEvents') && !named[k] ? named.plantLoads : named[k]); });
  // The plant's own workbook is read only when a copy is named ("plant": {"pickups": {...}}); never the real one by default.
  return { live: Object.assign({}, UNIONTOWN.live, given.live), masters, plant: given.plant || {} };
}

// Joe 10/26 (fk): Charleston and Martins Ferry keep typing in their own dispatch sheets, like Uniontown. Each plant's sheets are
// copied (read only) into that plant's own database, so one plant's copy can never touch another's. Their Live workbooks are
// known (the current app's, never written: writeback.js PRODUCTION_IDS); their master lists are added here as each plant sends
// them. The Users list is never copied from a plant's sheets: it stays the company's one list.
const OTHER_PLANTS = Object.freeze({
  fac_charleston: { live: { spreadsheetId: '1UrAzrPIe4x6jcNBCjCJUIE8mjvJAniZMoONRGK8GJmw' }, masters: {}, plant: {} },
  fac_martins_ferry: { live: { spreadsheetId: '1ac78al6_HhYA3_89kwYU93KbIzOv0vqExYhFsG1i4Rk' }, masters: {}, plant: {} }
});
// Every Uniontown sheet: another plant's copy may never read one of them (it would put Uniontown's things in that plant).
const uniontownIds = () => new Set([UNIONTOWN.live.spreadsheetId, UNIONTOWN.plant.pickups.spreadsheetId].concat(Object.keys(UNIONTOWN.masters).map(k => UNIONTOWN.masters[k].spreadsheetId)));

// The sheets another plant's copy reads: OTHER_PLANTS, or (test copy) PLANT_SOURCES_JSON {"fac_charleston": {"live":
// {"spreadsheetId"}, "masters": {"routes": {"spreadsheetId", "tab"}, ...}, "plant": {...}}}. null when the plant has none.
function plantSources(env, plant) {
  let given = null;
  if (env && env.PLANT_SOURCES_JSON) given = (JSON.parse(env.PLANT_SOURCES_JSON) || {})[plant] || null;
  // A test copy reads only the copies it names, never a plant's real sheets.
  const base = env && env.PLANT_SOURCES_JSON ? given : OTHER_PLANTS[plant];
  if (!base || !base.live || !base.live.spreadsheetId) return null;
  const masters = Object.assign({}, base.masters || {});
  delete masters.users;
  const out = { live: Object.assign({}, base.live), masters, plant: Object.assign({}, base.plant || {}) };
  const ut = uniontownIds(), named = [out.live.spreadsheetId].concat(Object.keys(masters).map(k => masters[k].spreadsheetId), Object.keys(out.plant).map(k => out.plant[k].spreadsheetId));
  const bad = named.find(id => ut.has(String(id)));
  if (bad) throw new Error('Another plant may not copy a Uniontown sheet (' + bad + ')');
  return out;
}

module.exports = { UNIONTOWN, OTHER_PLANTS, transferSources, plantSources };

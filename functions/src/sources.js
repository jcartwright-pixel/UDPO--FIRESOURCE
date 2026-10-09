/*
 * United Dairy Distribution app: which sheets the transfer reads (Uniontown).
 *
 * The same spreadsheet IDs as the current app (005_V7000_CanonicalStorage.gs). They are only ever read.
 * A test or the sandbox project can point at copies with the SOURCES_JSON setting.
 */
'use strict';

const UNIONTOWN = Object.freeze({
  live: { spreadsheetId: '11beWtlO848OyZI_Bom9y2WCZn2vnw4mLm24pf-rO1Cg' },
  masters: {
    routes: { spreadsheetId: '19neEpXEPFbon6-8DeZSG5BCTj2s2PfrCVRibWhUuFKc', tab: 'ROUTES_MASTER' },
    drivers: { spreadsheetId: '1rDZpcOABjGtSqobkIQPPNWyWmanfjyHeidGmTK67PvU', tab: 'DRIVERS_MASTER' },
    equipment: { spreadsheetId: '1eqZxqZNQs5gwuaRmQgPRbNvSmy7gOnwwwyoqFS3Djb4', tab: 'EQUIPMENT_MASTER' },
    users: { spreadsheetId: '1hmzHhGAX6NkF2qVDsYFhC_k7V3Ubfbi1WZjkvWKQA20', tab: 'USERS_MASTER' },
    exceptions: { spreadsheetId: '1Iczex1skLAFBX9atk0kRvEQimBTnhCRauKWH6SL4KoM', tab: 'DRIVER_EXCEPTIONS' },
    vacations: { spreadsheetId: '14gP6bChKZABMglED78OZLmy0LcJF91-tQWVo5bXtGW4', tab: 'DRIVER_VACATIONS' },
    // The Plant Operations Scheduler's journal, in the Live workbook (Weekly's PLANT LOAD marks).
    plantLoads: { spreadsheetId: '11beWtlO848OyZI_Bom9y2WCZn2vnw4mLm24pf-rO1Cg', tab: 'PLANT_OPERATIONS' }
  }
});

// SOURCES_JSON replaces only what it names: {"live":{"spreadsheetId":"..."}} points the copy at a Live workbook
// copy and keeps the real masters (read only).
function transferSources(env) {
  const raw = env && env.SOURCES_JSON;
  if (!raw) return UNIONTOWN;
  const given = JSON.parse(raw);
  const masters = {};
  Object.keys(UNIONTOWN.masters).forEach(k => { masters[k] = Object.assign({}, UNIONTOWN.masters[k], (given.masters || {})[k]); });
  return { live: Object.assign({}, UNIONTOWN.live, given.live), masters };
}

module.exports = { UNIONTOWN, transferSources };

'use strict';
// The made-up garage: four Uniontown technicians (one with no login ID yet), a leased truck and open write-ups (garage.js tests and pictures).
const F = require('./fake-sheets');

const MAINT = ['record_id', 'facility_id', 'service_date', 'source_type', 'source_id', 'status', 'priority', 'opened_at', 'opened_by', 'updated_at', 'updated_by',
  'driver', 'issue_type', 'issue_details', 'route_id', 'run_id', 'notes'];
const TECH_HEADERS = ['tech_id', 'facility_id', 'name', 'pin_hash', 'active', 'created_at', 'created_by', 'updated_at', 'updated_by', 'login_id'];
const equipment = F.EQUIPMENT.concat([{ equipment_id: 'veh_truck_223876', equipment_type: 'TRUCK', unit_id: '223876', status: 'ACTIVE', notes: 'External Fleet: Year 2022 | Lease: PENSKE' }]);
function sheets(extra) {
  return F.fakeSheets(Object.assign({
    "'EQUIPMENT_MASTER'": F.table(['equipment_id', 'equipment_type', 'unit_id', 'facility_id', 'location', 'status', 'assignment_class', 'source_present', 'last_source_sync_at', 'notes'], equipment),
    "'GARAGE TECHNICIANS'": F.table(TECH_HEADERS, [
      { tech_id: 'TECH-JT', facility_id: 'fac_uniontown', name: 'JELLICK Tom', active: 'YES', login_id: '48213' },
      { tech_id: 'TECH-JM', facility_id: 'fac_uniontown', name: 'MYERS John', active: 'YES', login_id: '551902' },
      { tech_id: 'TECH-JN', facility_id: 'fac_uniontown', name: 'NARD Jaxon', active: 'YES', login_id: '70001' },
      { tech_id: 'TECH-SM', facility_id: 'fac_uniontown', name: 'MARTIN Sean', active: 'YES', login_id: '' },
      { tech_id: 'TECH-OLD', facility_id: 'fac_uniontown', name: 'GONE Pat', active: 'NO', login_id: '11111' }]),
    "'TRUCK LIVE'": F.table(MAINT.concat(['truck_number', 'truck_id']), [
      { record_id: 'TRK-1', status: 'OPEN', opened_at: '2026-10-05T10:00:00Z', driver: 'ADAMS, PAT', issue_details: 'Air leak at the left brake chamber', truck_number: '900001' },
      { record_id: 'TRK-2', status: 'OPEN', opened_at: '2026-10-05T11:00:00Z', issue_details: 'Mirror cracked', truck_number: '223876' },
      { record_id: 'TRK-3', status: 'OPEN', opened_at: '2026-10-05T12:00:00Z', issue_details: 'no issues', truck_number: '900002' }]),
    "'TRAILER LIVE'": F.table(MAINT.concat(['trailer_number', 'trailer_id']), [
      { record_id: 'TRL-1', status: 'OPEN', opened_at: '2026-10-04T09:00:00Z', issue_details: 'Reefer down, OOS', trailer_number: 'T-901' }])
  }, extra || {}));
}
const SOURCES = Object.assign({}, F.SOURCES, { live: { spreadsheetId: 'fake-live', maintenanceQueues: true } });
module.exports = { sheets, SOURCES };

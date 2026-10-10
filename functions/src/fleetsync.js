/*
 * United Dairy Distribution app: keeping Equipment Master in step with the United Dairy fleet list.
 *
 * Joe 10/10: "This list changes every now and then. And this is our master list. So you will have to sync it at least
 * once a week." The same rule as the current app's weekly sync (023_V728_ExternalReadOnlySources.gs), run every night
 * and from Equipment's "Sync fleet list" button:
 *   - the fleet list is only ever READ (tab "Complete 2025 List of Units": UD UNIT, ASSET TYPE, LOCATION, ...);
 *   - Tractor / Straight Truck = TRUCK, Trailer = TRAILER; anything else, and every yard truck, is left out;
 *   - only Uniontown, Charleston and Martins Ferry units; a unit is found by its unit number, never by row;
 *   - a unit marked OOS / out of service / remove is OUT_OF_SERVICE, others ACTIVE, but a DOWN unit stays DOWN with its reason;
 *   - a unit no longer on the list is set INACTIVE (its row, down history and reasons stay in the sheet).
 * Only changed cells are written, and only to a sandbox copy (writeback.js refuses every production sheet).
 */
'use strict';

const { assertSandboxTarget, columnLetter } = require('./writeback');

// Joe's master fleet list (Google Sheet "United Dairy fleet list"). Read only.
const FLEET_LIST = Object.freeze({ spreadsheetId: '1fASsuj4EYl38yJJb-XlLi0D5nxcmGwE6MBWtRTTP3xc', tab: 'Complete 2025 List of Units' });
const BY = 'fleet list sync';

const up = (v) => String(v === null || v === undefined ? '' : v).trim().toUpperCase();
const typeOf = (asset) => { const a = up(asset); return a === 'TRACTOR' || a === 'STRAIGHT TRUCK' ? 'TRUCK' : a === 'TRAILER' ? 'TRAILER' : ''; };
const facilityOf = (loc) => { const s = up(loc); return s.indexOf('UNIONTOWN') >= 0 ? 'fac_uniontown' : s.indexOf('CHARLESTON') >= 0 ? 'fac_charleston' : s.indexOf('MARTINS FERRY') >= 0 ? 'fac_martins_ferry' : ''; };

// The fleet list's units: [{unit, type, facilityId, location, outOfService, notes}], plus the yard trucks left out.
function fleetUnits(values) {
  const hi = values.slice(0, 60).findIndex(r => { const h = (r || []).map(up); return h.indexOf('UD UNIT') >= 0 && h.indexOf('ASSET TYPE') >= 0; });
  if (hi < 0) throw new Error('The fleet list has no header row with UD UNIT and ASSET TYPE');
  const col = {};
  values[hi].forEach((c, i) => { if (up(c) && !(up(c) in col)) col[up(c)] = i; });
  const units = [], yard = [];
  values.slice(hi + 1).forEach(r => {
    const g = (k) => (k in col ? String(r[col[k]] === undefined ? '' : r[col[k]]).trim() : '');
    const unit = g('UD UNIT');
    if (!unit) return;
    if (['BODY TYPE', 'ASSET TYPE', 'MODEL', 'USE'].some(k => up(g(k)).indexOf('YARD') >= 0)) { yard.push(unit); return; }
    const type = typeOf(g('ASSET TYPE')), facilityId = facilityOf(g('LOCATION'));
    if (!type || !facilityId) return;
    const about = [g('YEAR'), g('MAKE'), g('MODEL'), g('VIN'), g('PLATE'), g('STATE')].filter(Boolean).join(' | ');
    units.push({ unit, type, facilityId, location: g('LOCATION'), outOfService: /OOS|OUT OF SERVICE|REMOVE/i.test(g('LOCATION') + ' ' + g('IN SERVICE')), notes: about ? 'External Fleet: ' + about : '' });
  });
  return { units, yard };
}

/*
 * What to change in Equipment Master (values with its header in row 1). Returns the cells to write, as
 * {row, column, value} with 0-based sheet rows, and what changed in plain words.
 */
function planFleetSync(fleetValues, masterValues, at) {
  const { units, yard } = fleetUnits(fleetValues);
  const header = (masterValues[0] || []).map(h => String(h).trim());
  const col = (k) => header.indexOf(k);
  ['equipment_id', 'equipment_type', 'unit_id', 'facility_id', 'location', 'status', 'source_present'].forEach(k => {
    if (col(k) < 0) throw new Error('Equipment Master has no ' + k + ' column');
  });
  const rows = masterValues.slice(1).map(r => header.map((_, i) => String(r[i] === undefined || r[i] === null ? '' : r[i])));
  const cells = [], summary = { added: [], inactive: [], back: [], changed: [], yard, units: units.length };
  const byUnit = {};
  rows.forEach((r, i) => { const u = up(r[col('unit_id')]); if (u && !(u in byUnit)) byUnit[u] = i; });
  const touched = new Set();
  const put = (i, k, v) => {
    if (col(k) < 0) return false;
    v = String(v);
    if (rows[i][col(k)] === v) return false;
    rows[i][col(k)] = v; cells.push({ row: i + 1, column: col(k), value: v }); touched.add(i);
    return true;
  };
  const seen = {};
  units.forEach(it => {
    const key = up(it.unit);
    if (seen[key]) return;
    seen[key] = true;
    let i = byUnit[key], fresh = false;
    if (i === undefined) {
      i = rows.length; rows.push(header.map(() => '')); byUnit[key] = i; fresh = true;
      put(i, 'equipment_id', 'eq_' + it.type.toLowerCase() + '_' + it.unit.replace(/[^A-Za-z0-9]+/g, '_'));
      put(i, 'unit_id', it.unit); put(i, 'version', '1'); put(i, 'created_at', at); put(i, 'created_by', BY);
      summary.added.push(it.unit);
    }
    const before = up(rows[i][col('status')]);
    const isDown = !fresh && before === 'DOWN';
    let changed = put(i, 'equipment_type', it.type) | put(i, 'facility_id', it.facilityId) | put(i, 'location', it.location) | put(i, 'source_present', 'TRUE');
    if (!isDown) {
      changed |= put(i, 'status', it.outOfService ? 'OUT_OF_SERVICE' : 'ACTIVE');
      if (it.notes) changed |= put(i, 'notes', it.notes);
    }
    if (!fresh && changed) (before === 'INACTIVE' && up(rows[i][col('status')]) !== 'INACTIVE' ? summary.back : summary.changed).push(it.unit);
  });
  rows.forEach((r, i) => {
    const u = up(r[col('unit_id')]), status = up(r[col('status')]);
    if (!u || seen[u] || status === 'INACTIVE' || status === 'DOWN') return;
    put(i, 'status', 'INACTIVE'); put(i, 'source_present', 'FALSE');
    summary.inactive.push(r[col('unit_id')]);
  });
  touched.forEach(i => { put(i, 'last_source_sync_at', at); put(i, 'updated_at', at); put(i, 'updated_by', BY); });
  return { cells, summary };
}

/*
 * One sync. reader reads the fleet list; sheets ({batchGet, batchUpdate}) reads and writes the sandbox Equipment Master
 * copy (target = {spreadsheetId, tab}). The result (or the error) is kept in config/fleetSync for the Equipment screen.
 */
async function runFleetSync({ db, reader, sheets, target, fleet, by, now }) {
  const at = (now ? now() : new Date()).toISOString();
  const source = fleet || FLEET_LIST;
  const record = db.collection('config').doc('fleetSync');
  try {
    assertSandboxTarget(target && target.spreadsheetId);
    if (target.spreadsheetId === source.spreadsheetId) throw new Error('Fleet sync stopped: the fleet list is read only');
    const [fleetValues] = await reader.batchGet(source.spreadsheetId, ["'" + source.tab + "'"]);
    const range = "'" + target.tab + "'";
    const [masterValues] = await sheets.batchGet(target.spreadsheetId, [range]);
    const { cells, summary } = planFleetSync(fleetValues, masterValues, at);
    if (cells.length) await sheets.batchUpdate(target.spreadsheetId, cells.map(c => ({ range: range + '!' + columnLetter(c.column) + (c.row + 1), values: [[c.value]] })));
    const result = { ok: true, at, by: by || 'nightly', cells: cells.length, units: summary.units, added: summary.added, inactive: summary.inactive, back: summary.back, changed: summary.changed, yard: summary.yard, error: '' };
    await record.set(result);
    return result;
  } catch (error) {
    const message = String(error && error.message || error);
    const result = { ok: false, at, by: by || 'nightly', error: /403|permission|caller does not have/i.test(message) ? 'The fleet list is not shared with the app yet' : message };
    await record.set(result, { merge: true });
    return result;
  }
}

module.exports = { FLEET_LIST, fleetUnits, planFleetSync, runFleetSync };

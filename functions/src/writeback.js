/*
 * United Dairy Distribution app: writing saves back to the Live sheet.
 *
 * Database to sheet only. Each save queued its changed cells in `outbox`; this writes them into the Live week tab,
 * oldest first. The row is found by run_id (and the days it runs, for a run on two rows), never by row number,
 * so sorting the tab is safe.
 *
 * The conflict rule: a cell is written only if the sheet still holds what the new app last knew for it (or
 * already holds the new value). If someone typed something else into that cell in the meantime, the cell is NOT
 * written; it goes on the `conflicts` list with both values, so nothing is lost without anyone knowing.
 *
 * Phase 2: only a sandbox copy of the Live workbook may be written. The production workbook is refused here,
 * whatever the settings say; writing to it needs the per-screen switch and Joe's go.
 */
'use strict';

const L = require('./logic');
const M = require('./model');
const { UNIONTOWN } = require('./sources');

const C = M.COLLECTIONS;
const BATCH = 50;

// Every production spreadsheet the current app uses. The write-back never writes to any of them.
const PRODUCTION_IDS = Object.freeze([UNIONTOWN.live.spreadsheetId].concat(Object.keys(UNIONTOWN.masters).map(k => UNIONTOWN.masters[k].spreadsheetId)).concat([
  '1UrAzrPIe4x6jcNBCjCJUIE8mjvJAniZMoONRGK8GJmw', '1ac78al6_HhYA3_89kwYU93KbIzOv0vqExYhFsG1i4Rk', // Charleston, Martins Ferry Live
  '16_uzQQ22XhYwOacPqPYV0rIFePRHC34AZDlEt_VFz5k', '1eJGQWiddOb_-y46dFMZtePIUc9cAhQXFnDH5MN9IBTg', '17slbLYbNeCLQUgYDN8uWv5mLOmNV0JJqhhUZ1qplllo', // pallet jacks, vacation periods, facilities
  '1fASsuj4EYl38yJJb-XlLi0D5nxcmGwE6MBWtRTTP3xc', '1srmlHGCRkfObi2q_M5BDV6Qmz7AKMaMnOuMJ88LLnPo' // the United Dairy fleet list (read only)
]));

function assertSandboxTarget(spreadsheetId) {
  if (!spreadsheetId) throw new Error('Write-back stopped: no sandbox Live workbook is set');
  if (PRODUCTION_IDS.indexOf(spreadsheetId) >= 0) throw new Error('Write-back stopped: ' + spreadsheetId + ' is a production sheet; only a sandbox copy may be written in this phase');
}

function columnLetter(index) {
  let n = index + 1, s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function text(v) { return v === null || v === undefined ? '' : String(v).trim(); }

// The sheet row for one queued save: same week, same run_id, and (for a run on two rows) the same running days.
function findRow(values, item) {
  const header = (values[M.LIVE_HEADER_ROW - 1] || []).map(M.normalizeHeader);
  const col = (name) => header.indexOf(name);
  const runIdCol = col('run_id'), weekCol = col('week_start_date'), routeCol = col('route'), runCol = col('run');
  const matches = [];
  for (let r = M.LIVE_HEADER_ROW; r < values.length; r++) {
    const row = values[r] || [];
    if (weekCol >= 0 && text(row[weekCol]) && L.weekStart(L.dateKey(text(row[weekCol])) || item.weekStart) !== item.weekStart) continue;
    const same = item.match.runId ? text(row[runIdCol]) === item.match.runId
      : text(row[routeCol]) === item.match.route && text(row[runCol]) === item.match.run;
    if (same) matches.push(r);
  }
  if (matches.length > 1) {
    const days = item.match.days.join('-');
    const byDays = matches.filter(r => L.DAYS.filter(p => col(p + '_runs') >= 0 && L.yes(values[r][col(p + '_runs')])).join('-') === days);
    return { header, rows: byDays };
  }
  return { header, rows: matches };
}

/*
 * One pass: writes up to BATCH queued saves. sheets = { batchGet(id, ranges), batchUpdate(id, [{range, values}]) }.
 * target = { spreadsheetId } of the sandbox Live workbook. Returns counts.
 */
async function runWriteBack({ db, sheets, target, now }) {
  assertSandboxTarget(target && target.spreadsheetId);
  const stamp = (now ? now() : new Date()).toISOString();
  const pending = await db.collection(C.outbox).where('status', '==', 'pending').orderBy('at').orderBy('requestId').limit(BATCH).get();
  const items = pending.docs.map(d => Object.assign({ id: d.id, ref: d.ref }, d.data()));
  if (!items.length) return { written: 0, conflicts: 0, items: 0 };

  // One read per tab touched.
  const tabs = [...new Set(items.map(i => i.tab))];
  const tabValues = await sheets.batchGet(target.spreadsheetId, tabs.map(t => "'" + t + "'"));
  const sheet = {};
  tabs.forEach((t, i) => { sheet[t] = tabValues[i]; });

  // What the new app last knew for each cell: the run's copy of the sheet row, updated as cells are written.
  const runIds = [...new Set(items.map(i => i.runDocId))];
  const runSnaps = await db.getAll(...runIds.map(id => db.collection(C.runs).doc(id)));
  const known = {};
  runSnaps.forEach((snap, i) => { known[runIds[i]] = snap.exists ? Object.assign({}, snap.data().cells || {}) : {}; });

  const updates = {}; // tab -> [{range, values}]
  const ops = [];
  let written = 0, conflicts = 0;
  items.forEach(item => {
    const values = sheet[item.tab] || [];
    const found = findRow(values, item);
    if (found.rows.length !== 1) {
      conflicts++;
      ops.push({ ref: db.collection(C.conflicts).doc(item.id + '-row'), data: { open: true, at: stamp, requestId: item.requestId, by: item.by, tab: item.tab, runDocId: item.runDocId, route: item.match.route || '', run: item.match.run || '',
        problem: found.rows.length ? 'the run is on more than one row; nothing was written' : 'the run is no longer on the sheet; nothing was written', cells: item.cells } });
      ops.push({ ref: item.ref, update: { status: 'conflict', doneAt: stamp } });
      return;
    }
    const r = found.rows[0], row = values[r];
    let itemConflicts = 0;
    Object.keys(item.cells).forEach(column => {
      const c = found.header.indexOf(column);
      const want = item.cells[column];
      if (c < 0) {
        itemConflicts++;
        ops.push({ ref: db.collection(C.conflicts).doc(item.id + '-' + column), data: { open: true, at: stamp, requestId: item.requestId, by: item.by, tab: item.tab, runDocId: item.runDocId, route: item.match.route || '', run: item.match.run || '', column, newValue: want, problem: 'the sheet has no column ' + column } });
        return;
      }
      const inSheet = text(row[c]);
      const expected = text(known[item.runDocId][column]);
      // updated_at / updated_by always follow the save; every other cell must be unchanged since the app last saw it.
      const stampColumn = /_(updated_at|updated_by)$/.test(column);
      if (!stampColumn && inSheet !== expected && inSheet !== text(want)) {
        itemConflicts++;
        ops.push({ ref: db.collection(C.conflicts).doc(item.id + '-' + column), data: { open: true, at: stamp, requestId: item.requestId, by: item.by, tab: item.tab, runDocId: item.runDocId, route: item.match.route || '', run: item.match.run || '', column,
          sheetValue: inSheet, appExpected: expected, newValue: want, problem: 'changed in the sheet since the app last saw it; the sheet value was kept' } });
        return;
      }
      if (inSheet !== text(want)) {
        (updates[item.tab] = updates[item.tab] || []).push({ range: "'" + item.tab + "'!" + columnLetter(c) + (r + 1), values: [[want]] });
        row[c] = want; // later queued saves to the same cell compare against this
      }
      known[item.runDocId][column] = text(want);
      written++;
    });
    conflicts += itemConflicts;
    ops.push({ ref: item.ref, update: { status: itemConflicts ? 'conflict' : 'done', doneAt: stamp, sheetRow: r + 1 } });
  });

  // Sheet first, then mark the queue: if the sheet write fails nothing is marked and the next pass retries.
  for (const tab of Object.keys(updates)) await sheets.batchUpdate(target.spreadsheetId, updates[tab]);
  const batch = db.batch();
  ops.forEach(op => (op.update ? batch.update(op.ref, op.update) : batch.set(op.ref, op.data)));
  runIds.forEach(id => { if (runSnaps[runIds.indexOf(id)].exists) batch.update(db.collection(C.runs).doc(id), { cells: known[id] }); });
  await batch.commit();
  return { written, conflicts, items: items.length };
}

module.exports = { runWriteBack, assertSandboxTarget, findRow, columnLetter, PRODUCTION_IDS };

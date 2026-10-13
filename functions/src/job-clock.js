/*
 * Review item 74 (Joe 10/13): the mechanics' job clocks, shared by the Garage Station (garage.js, the fleet's work orders) and
 * the Maintenance Station (plantmaint.js, the plant's machinery). Each mechanic has one clock (one job at a time); Start,
 * Add another mechanic and Parts are here start it, starting on another job stops it there (that job stays open), Stop stops
 * the mechanic's own, and Need Parts or a safe Complete stops every clock on the job. Each work order keeps its labour: one
 * entry per mechanic per clock (start, end, minutes); an open one has no end yet. The two stations keep their own field names
 * and collections; this file only does the clock arithmetic and the reads and writes it needs inside the step's transaction.
 */

// A work order's labour, cleaned up.
const laborOf = (o) => (Array.isArray(o.labor) ? o.labor : []).filter(s => s && s.tech_id).map(s => ({ tech_id: String(s.tech_id), name: String(s.name || ''), start: String(s.start || ''), end: String(s.end || ''), minutes: Number(s.minutes) || 0 }));
const joinNames = (list) => list.filter((n, i) => n && list.indexOf(n) === i).join(', ');
const STARTING = ['START', 'HELPER', 'RESUME'];

/*
 * The clock moves for one step, read and worked out inside the transaction (every read before any write):
 *   o.clocks / o.orders   the clock and work order collections; o.docId(id) the station's document name for an id
 *   o.op, o.finishing     the step, and whether it is a safe Complete; o.nowMs / o.stamp the step's time
 *   o.people              the signed-in mechanics ({ id, name })
 *   o.labor               this job's labour (laborOf), changed in place
 *   o.thisId              this job's work order id
 *   o.keys                the station's field names: { onNow, laborMinutes }
 *   o.clockDoc(p)         a mechanic's clock as the station keeps it
 *   o.touched             the fields another job gets when a mechanic's clock stops there
 *   o.otherName(data, id) how another job is named in "Stopped your clock on ..."
 * Returns { writes: [[kind, ref, data]], stoppedOn, laborFields(list), minutesFrom(iso) }; the writes go in after the job's own.
 */
async function moveClocks(tx, db, o) {
  const { nowMs, stamp, people, labor, thisId, keys, docId } = o;
  const clockIds = people.map(p => p.id).concat(labor.filter(s => !s.end).map(s => s.tech_id)).filter((v, i, a) => a.indexOf(v) === i);
  const clockRefs = clockIds.map(id => db.collection(o.clocks).doc(docId(id)));
  const clockSnaps = clockRefs.length ? await tx.getAll(...clockRefs) : [];
  const clocks = {}; clockSnaps.forEach((s, i) => { clocks[clockIds[i]] = { ref: clockRefs[i], data: s.exists ? s.data() : null }; });
  const starting = STARTING.indexOf(o.op) >= 0;
  const elsewhere = starting ? people.map(p => clocks[p.id].data).filter(c => c && c.workOrderId && c.workOrderId !== thisId) : [];
  const otherIds = elsewhere.map(c => c.workOrderId).filter((v, i, a) => a.indexOf(v) === i);
  const otherRefs = otherIds.map(id => db.collection(o.orders).doc(docId(id)));
  const otherSnaps = otherRefs.length ? await tx.getAll(...otherRefs) : [];

  const minutesFrom = (iso) => Math.max(0, Math.round((nowMs - Date.parse(iso)) / 60000)) || 0;
  const closeClock = (list, techId) => list.forEach(s => { if (s.tech_id === techId && !s.end) { s.end = stamp; s.minutes = minutesFrom(s.start); } });
  const laborFields = (list) => ({ labor: list, [keys.onNow]: joinNames(list.filter(s => !s.end).map(s => s.name)), [keys.laborMinutes]: list.reduce((n, s) => n + (s.end ? s.minutes : 0), 0) });
  const writes = [];
  let stoppedOn;
  if (starting) {
    people.forEach(p => {
      if (labor.some(s => s.tech_id === p.id && !s.end)) return;
      labor.push({ tech_id: p.id, name: p.name, start: stamp, end: '', minutes: 0 });
      writes.push(['set', clocks[p.id].ref, o.clockDoc(p)]);
    });
    // One mechanic, one job: their clock on another job stops; that job stays open.
    otherSnaps.forEach((s, i) => {
      if (!s.exists) return;
      const list = laborOf(s.data()), moving = people.filter(p => clocks[p.id].data && clocks[p.id].data.workOrderId === otherIds[i]);
      moving.forEach(p => closeClock(list, p.id));
      writes.push(['update', otherRefs[i], Object.assign(laborFields(list), o.touched)]);
      stoppedOn = (stoppedOn || []).concat(o.otherName(s.data(), otherIds[i]));
    });
  } else if (o.op === 'STOP' || o.op === 'PARTS' || o.finishing) {
    const who = o.op === 'STOP' ? people.map(p => p.id) : labor.filter(s => !s.end).map(s => s.tech_id);
    who.forEach(id => {
      closeClock(labor, id);
      const c = clocks[id] && clocks[id].data;
      if (c && c.workOrderId === thisId) writes.push(['delete', clocks[id].ref]);
    });
  }
  return { writes, stoppedOn, laborFields, minutesFrom };
}

// The job's status after a clock step (Complete is the station's own): Stop on a new job makes it started, Start and Add
// another mechanic leave a job waiting on parts as it is, Need Parts and Parts are here move it.
function stepStatus(op, was, partsAt, stamp) {
  if (op === 'STOP' && was === 'NEW') return { status: 'WORKING' };
  if (op === 'START' || op === 'HELPER') return { status: was === 'PARTS' ? 'PARTS' : 'WORKING' };
  if (op === 'PARTS') return { status: 'PARTS', [partsAt]: stamp };
  if (op === 'RESUME') return { status: 'WORKING' };
  return {};
}

// The writes, in the order they were worked out.
function applyWrites(tx, writes) {
  writes.forEach(([kind, r, d]) => { if (kind === 'delete') tx.delete(r); else if (kind === 'set') tx.set(r, d); else tx.update(r, d); });
}

module.exports = { laborOf, joinNames, moveClocks, stepStatus, applyWrites };

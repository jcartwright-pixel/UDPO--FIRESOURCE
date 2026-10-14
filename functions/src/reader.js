/*
 * Plant Production: a line's label reader (Joe 10/11: the Gallon Filler reads each jug's UPC, so it counts and knows the
 * product, and checks the code date). docs/plant-production/How-The-Reader-Connects.md tells it in plain words.
 *
 *   applyReads     a batch of jugs the reader saw: counts them on the line's shift (productionRuns, the same run the line tablet
 *                  and the TV read), finds the product by its UPC on the plant's Products list, starts a new product run when
 *                  the UPC changes, checks each code date against the shift's day + the product's shelf life, and ends a stop
 *                  (jugs are moving again). run.reader keeps the shift's tallies for the tablet's code date bar.
 *   handleReads    the one door for every reading device (index.js deviceReads): {device, reads: [{upc, date}]} with the
 *                  device's key as a Bearer token. Joe 10/11: room to grow, a Receiving side with a handheld scanner comes later.
 *                  Each device is registered in private/readDevices, kept by its id with only its key's hash and its tags:
 *                  facilityId, area (PRODUCTION now; RECEIVING later), kind (LINE_READER, CAMERA, HANDHELD), reads (UPC,
 *                  UPC_DATE, COUNT) and target (the line, or later the receiving station). AREAS says what each area does with
 *                  the reads, so Receiving plugs in as one more entry. A line reader's id is its line's id.
 *   readerCall     Line Targets, administrators only: make or replace a line's key; start or stop the test feed (sandbox only).
 *   readerMinute   every minute: the test feed's pretend jugs, and a stop when a reader or controller line has gone quiet for 3 minutes.
 *   controllerReads  the line PC reading a machine's own controller (Joe 10/14, the Blow Mold), READ-ONLY: the jug count, speed and
 *                  temperature it read ({device, controller: {count, speed, temp, errors}}), the answer to a Test read ({test}), and
 *                  back the line's setup from Line Targets (productionLines/{id}.controller) and any Test read asked for.
 * Reads count only on a line whose Counted by (Line Targets) is Label reader; a controller's jug count only on a Machine controller
 * line (its speed and temperature are kept whatever counts the line).
 */
'use strict';

const crypto = require('crypto');
const P = require('./production-rules');
const L = require('./logic');
const { safeIdPart } = require('./model');

class ReaderError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const text = (v) => (v === null || v === undefined ? '' : String(v).trim());
const docId = (id) => String(id).replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 200);
const BY = 'label reader';
const MAX_READS = 2000, COUNT_LIMIT = 400, RUN_LIMIT = 100, STOP_LIMIT = 300;
const QUIET_MINUTES = 3;
const ZONE = 'America/New_York';

// The plant's clock (Eastern) at ms: how far its wall clock is ahead of UTC.
function zoneOffset(ms) {
  const p = {};
  new Intl.DateTimeFormat('en-US', { timeZone: ZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(ms)).forEach(x => { p[x.type] = x.value; });
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second)) - Math.floor(ms / 1000) * 1000;
}
// The shift running at ms on the plant's clock, the same one the line tablet works out (production-rules shiftNow uses the
// browser's own clock, which is the plant's; the server's may be UTC).
function plantShift(saved, ms) {
  const plant = zoneOffset(ms), here = -new Date(ms).getTimezoneOffset() * 60000, move = plant - here;
  const s = P.shiftNow(saved, ms + move);
  return Object.assign({}, s, { start: new Date(Date.parse(s.start) - move).toISOString(), end: new Date(Date.parse(s.end) - move).toISOString() });
}

const hash = (key) => crypto.createHash('sha256').update(String(key)).digest('hex');
const upcOf = (v) => text(v).replace(/\D/g, '').slice(0, 14);
// '10/25', 'OCT 25', 'Oct 25 2026' -> 'OCT 25' (how codeDate writes it), so a reader's own format still compares.
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
function dateOf(v) {
  const t = text(v).toUpperCase();
  let m = /^([A-Z]{3})\s*(\d{1,2})\b/.exec(t);
  if (m && MONTHS.indexOf(m[1]) >= 0) return m[1] + ' ' + String(Number(m[2])).padStart(2, '0');
  m = /^(\d{1,2})[/-](\d{1,2})\b/.exec(t);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) return MONTHS[Number(m[1]) - 1] + ' ' + String(Number(m[2])).padStart(2, '0');
  return t.slice(0, 20);
}

async function lineOf(get, db, operationId) {
  const s = await get(db.collection('plantSetup').doc(docId(operationId))), d = s.exists ? s.data() : null;
  if (!d || d.type !== 'PRODUCTION_AREA' || d.status !== 'ACTIVE') throw new ReaderError('NOT_FOUND', 'That line is not set up for this plant.');
  return { name: text(d.name) || text(d.area) || operationId, facilityId: text(d.facilityId) || 'fac_uniontown' };
}

// reads: [{upc, date, name?}] (name only from the test feed, for a product whose UPC is not on the list yet).
async function applyReads(db, operationId, reads, opts) {
  const o = Object.assign({ now: () => new Date(), test: false }, opts || {});
  const id = text(operationId);
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(id)) throw new ReaderError('BAD_REQUEST', 'Name the line.');
  if (!Array.isArray(reads) || !reads.length) return { ok: true, operationId: id, counted: 0 };
  if (reads.length > MAX_READS) throw new ReaderError('BAD_REQUEST', 'Send up to ' + MAX_READS + ' jugs at a time.');
  return db.runTransaction(async (tx) => {
    const get = (ref) => tx.get(ref);
    const line = await lineOf(get, db, id);
    const counterSnap = await tx.get(db.collection('productionLines').doc(docId(id)));
    if (!counterSnap.exists || counterSnap.data().counter !== 'READER') throw new ReaderError('NOT_ALLOWED', line.name + ' is not counted by a label reader. Set Counted by to Label reader on Line Targets.');
    const now = o.now(), stamp = now.toISOString();
    const shifts = await tx.get(db.collection('plantShifts').doc(docId(line.facilityId)));
    const shift = plantShift(shifts.exists ? shifts.data().shifts : null, now.getTime());
    const productsSnap = await tx.get(db.collection('plantProducts').doc(docId(id)));
    const targets = P.targetsFor(productsSnap.exists ? productsSnap.data().products : []);
    const byUpc = {}, byName = {};
    targets.forEach(t => { if (upcOf(t.upc)) byUpc[upcOf(t.upc)] = t; byName[t.name.toUpperCase()] = t; });
    const ref = db.collection('productionRuns').doc(docId(P.runId(id, shift.key))), had = await tx.get(ref);
    const run = had.exists ? had.data() : { operationId: id, line: line.name, facilityId: line.facilityId, shiftKey: shift.key, shiftName: shift.name,
      date: shift.date, shiftStart: shift.start, shiftEnd: shift.end, product: '', sku: '', count: 0, counts: [], runs: [], stops: [], createdAt: stamp, createdBy: BY };
    ['counts', 'runs', 'stops'].forEach(k => { if (!Array.isArray(run[k])) run[k] = []; });
    const rd = Object.assign({ read: 0, unreadable: 0, unknown: 0, missing: 0, wrong: 0 }, run.reader || {});
    let current = byName[text(run.product).toUpperCase()] || null;
    reads.forEach(r0 => {
      const r = r0 && typeof r0 === 'object' ? r0 : { upc: r0 };
      const upc = upcOf(r.upc), named = o.test ? byName[text(r.name).toUpperCase()] || (text(r.name) ? { name: text(r.name).slice(0, 120), sku: '', shelfLifeDays: Number(r.shelfLifeDays) > 0 ? Number(r.shelfLifeDays) : null } : null) : null;
      const t = (upc && byUpc[upc]) || named;
      run.count = (Number(run.count) || 0) + 1;
      if (!upc && !named) { rd.unreadable++; return; }
      rd.read++;
      rd.lastUpc = upc;
      if (!t) { rd.unknown++; rd.lastUnknownUpc = upc; return; }
      // A new product on the line: a new run from now, as when the operator picks it on the tablet.
      if (!current || current.name !== t.name) {
        if (run.runs.length < RUN_LIMIT) run.runs.push({ product: t.name, sku: text(t.sku), from: stamp, by: BY });
        run.product = t.name; run.sku = text(t.sku); current = t;
      }
      const date = dateOf(r.date), want = P.codeDate(run.date, t.shelfLifeDays);
      if (!date) { rd.missing++; rd.lastMissingAt = stamp; rd.dateOk = false; rd.lastDate = ''; return; }
      rd.lastDate = date;
      if (want && date !== want) { rd.wrong++; rd.lastWrongAt = stamp; rd.dateOk = false; return; }
      rd.dateOk = true;
    });
    rd.lastReadAt = stamp;
    run.reader = rd;
    run.countAt = stamp; run.countBy = BY;
    run.counts.push({ at: stamp, count: run.count });
    if (run.counts.length > COUNT_LIMIT) run.counts = run.counts.slice(-COUNT_LIMIT);
    // Jugs moving: an open stop has ended (the operator still picks why on the tablet).
    const open = run.stops.filter(s => !s.end)[0];
    if (open) { open.end = stamp; open.endBy = BY; }
    run.updatedAt = stamp; run.updatedBy = BY;
    tx.set(ref, run);
    return { ok: true, operationId: id, shiftKey: shift.key, counted: reads.length, count: run.count, product: run.product };
  });
}

// What each area does with a device's reads. RECEIVING (raw milk and outside products, by handheld scanner) is being built:
// its entry takes the reads the same way when its screens exist.
const AREAS = {
  PRODUCTION: (db, dev, reads, opts) => applyReads(db, dev.target, reads, opts),
  RECEIVING: null
};
const KINDS = ['LINE_READER', 'CAMERA', 'HANDHELD', 'CONTROLLER'], READS = ['UPC', 'UPC_DATE', 'COUNT'];

// ---------- A machine's own controller (Joe 10/14) ----------
const BY_MACHINE = 'machine controller';
const READ_KEYS = ['count', 'speed', 'temp'];
const LOG_LIMIT = 720, BIG_JUMP = 50000;
const numOrNull = (v) => (v === null || v === undefined || text(v) === '' || !isFinite(Number(v)) ? null : Number(v));
const when = (v) => { const t = Date.parse(v || ''); return isFinite(t) ? t : 0; };
// What the line PC needs from Line Targets: where the controller is and which tag or register holds each reading.
function configOut(cfg) {
  const c = cfg || {}, readings = {};
  READ_KEYS.forEach(k => { if (text(c[k + 'Tag'])) readings[k] = { tag: text(c[k + 'Tag']), size: numOrNull(c[k + 'Size']) || (k === 'count' ? 32 : 16) }; });
  if (!text(c.brand) || !text(c.ip)) return null;
  return { brand: text(c.brand), ip: text(c.ip), port: numOrNull(c.port), slot: numOrNull(c.slot), rack: numOrNull(c.rack), unit: numOrNull(c.unit), wordOrder: text(c.wordOrder) || 'HIGH_FIRST', readings };
}
function machineRun(id, line, shift, stamp) {
  return { operationId: id, line: line.name, facilityId: line.facilityId, shiftKey: shift.key, shiftName: shift.name, date: shift.date, shiftStart: shift.start, shiftEnd: shift.end,
    product: '', sku: '', count: 0, counts: [], runs: [], stops: [], createdAt: stamp, createdBy: BY_MACHINE };
}
// One reading from the line PC: the jugs made since the last one count on the shift (the machine's counter only goes up; a
// smaller number means it was reset), speed and temperature are kept with their range flags, one minute's reading logged.
async function applyMachine(db, id, r, opts) {
  const o = Object.assign({ now: () => new Date() }, opts || {});
  return db.runTransaction(async (tx) => {
    const line = await lineOf((ref) => tx.get(ref), db, id);
    const lineRef = db.collection('productionLines').doc(docId(id)), ld = (await tx.get(lineRef)).data() || {}, cfg = ld.controller || {};
    const now = o.now(), stamp = now.toISOString(), ms = now.getTime();
    const shifts = await tx.get(db.collection('plantShifts').doc(docId(line.facilityId)));
    const shift = plantShift(shifts.exists ? shifts.data().shifts : null, ms);
    const ref = db.collection('productionRuns').doc(docId(P.runId(id, shift.key))), had = await tx.get(ref);
    const productsSnap = had.exists ? null : await tx.get(db.collection('plantProducts').doc(docId(id)));
    const scale = (v, d) => (v === null ? null : Math.round(v / (numOrNull(d) > 0 ? numOrNull(d) : 1) * 10) / 10);
    const value = numOrNull(r.count), speed = scale(numOrNull(r.speed), cfg.speedDivide), temp = scale(numOrNull(r.temp), cfg.tempDivide);
    const last = ld.machineLast && numOrNull(ld.machineLast.value) !== null ? numOrNull(ld.machineLast.value) : null;
    let delta = 0;
    if (ld.counter === 'CONTROLLER' && value !== null && value >= 0 && last !== null) {
      delta = value >= last ? value - last : value;
      // A jump that big is a new counter or a wrong tag, not jugs made in seconds: count from here.
      if (delta > BIG_JUMP) delta = 0;
    }
    const errors = r.errors && typeof r.errors === 'object' ? READ_KEYS.filter(k => text(r.errors[k])).map(k => k + ': ' + text(r.errors[k]).slice(0, 200)).join(' · ') : '';
    const lineUpd = {};
    if (value !== null && last !== value) lineUpd.machineLast = { value, at: stamp };
    if (!when(ld.machineHeardAt) || ms - when(ld.machineHeardAt) >= 60000 || errors !== text(ld.machineError)) { lineUpd.machineHeardAt = stamp; lineUpd.machineError = errors; }
    let count = had.exists ? numOrNull(had.data().count) : null;
    if (had.exists || delta > 0 || speed !== null || temp !== null) {
      const run = had.exists ? had.data() : machineRun(id, line, shift, stamp);
      ['counts', 'runs', 'stops'].forEach(k => { if (!Array.isArray(run[k])) run[k] = []; });
      // Joe 10/14: the Blow Mold makes only gallon jugs, so a new shift starts on its one product.
      const only = productsSnap ? P.targetsFor(productsSnap.exists ? productsSnap.data().products : []) : [];
      if (!had.exists && only.length === 1 && P.lineKind(line.name) === 'BLOWMOLD') { run.product = only[0].name; run.sku = text(only[0].sku); run.runs.push({ product: run.product, sku: run.sku, from: stamp, by: 'only product' }); }
      const m = Object.assign({}, run.machine || {}), log = Array.isArray(run.machineLog) ? run.machineLog : [];
      const sf = P.machineFlag(speed, cfg.speedLow, cfg.speedHigh), tf = P.machineFlag(temp, cfg.tempLow, cfg.tempHigh);
      const lastLog = log[log.length - 1], logDue = !lastLog || ms - when(lastLog.at) >= 60000;
      const write = !had.exists || delta > 0 || logDue || sf !== (m.speedFlag || '') || tf !== (m.tempFlag || '') || ms - when(m.at) >= 15000;
      if (write) {
        Object.assign(m, { at: stamp, counter: value, speed, temp, speedFlag: sf, tempFlag: tf,
          speedOutSince: sf ? (m.speedFlag === sf && m.speedOutSince ? m.speedOutSince : stamp) : '', tempOutSince: tf ? (m.tempFlag === tf && m.tempOutSince ? m.tempOutSince : stamp) : '' });
        if (delta > 0) {
          run.count = (Number(run.count) || 0) + delta;
          run.counts.push({ at: stamp, count: run.count });
          if (run.counts.length > COUNT_LIMIT) run.counts = run.counts.slice(-COUNT_LIMIT);
          run.countAt = stamp; run.countBy = BY_MACHINE;
          m.lastMoveAt = stamp;
          // Jugs moving: an open stop has ended (the operator still picks why on the tablet).
          const open = run.stops.filter(s => !s.end)[0];
          if (open) { open.end = stamp; open.endBy = BY_MACHINE; }
        }
        if (logDue && (speed !== null || temp !== null || value !== null)) { log.push({ at: stamp, speed, temp, count: Number(run.count) || 0 }); }
        run.machine = m; run.machineLog = log.length > LOG_LIMIT ? log.slice(-LOG_LIMIT) : log;
        run.updatedAt = stamp; run.updatedBy = BY_MACHINE;
        tx.set(ref, run);
      }
      count = Number(run.count) || 0;
    }
    if (Object.keys(lineUpd).length) tx.set(lineRef, lineUpd, { merge: true });
    return { count, counted: delta };
  });
}
// The line PC's call for a machine controller line. Returns its setup and any Test read asked for, so the PC needs only its key.
async function controllerReads(db, id, b, opts) {
  const o = Object.assign({ now: () => new Date() }, opts || {});
  const lineRef = db.collection('productionLines').doc(docId(id));
  await lineOf((ref) => ref.get(), db, id);
  if (b.test && typeof b.test === 'object' && text(b.test.askAt)) {
    const value = numOrNull(b.test.value), reading = READ_KEYS.indexOf(text(b.test.reading)) >= 0 ? text(b.test.reading) : 'count';
    await lineRef.set({ controller: { testResult: { askAt: text(b.test.askAt).slice(0, 40), reading, value, error: value === null ? text(b.test.error).slice(0, 300) || 'No number came back.' : '', at: o.now().toISOString() } } }, { merge: true });
  }
  let out = {};
  if (b.controller && typeof b.controller === 'object') out = await applyMachine(db, id, b.controller, o);
  const cfg = ((await lineRef.get()).data() || {}).controller || {};
  const ask = cfg.testAsk && text(cfg.testAsk.at) ? { at: text(cfg.testAsk.at), reading: text(cfg.testAsk.reading) || 'count' } : null;
  return Object.assign({ ok: true, operationId: id, config: configOut(cfg), testAsk: ask }, out);
}

// A device's call (the line PC, later a receiving station). Returns [status, body]. {line} is the same as {device}.
async function handleReads(db, headers, body, opts) {
  const auth = text(headers && (headers.authorization || headers.Authorization));
  const m = /^Bearer\s+(\S+)$/i.exec(auth);
  if (!m) return [401, { ok: false, error: 'Send the device key as Authorization: Bearer <key>.' }];
  const b = body && typeof body === 'object' ? body : {};
  const id = text(b.device || b.line);
  const devices = (await db.collection('private').doc('readDevices').get()).data() || {};
  const dev = devices[docId(id)];
  if (!id || !dev || !dev.hash || dev.hash !== hash(m[1])) return [403, { ok: false, error: 'That key is not this device\'s key. Make a new one on Line Targets.' }];
  if (dev.area === 'PRODUCTION' && (b.controller || b.test || b.op === 'config')) {
    try { return [200, Object.assign({ device: id, area: dev.area }, await controllerReads(db, dev.target, b, opts))]; } catch (e) {
      if (e instanceof ReaderError) return [e.code === 'NOT_FOUND' ? 404 : 400, { ok: false, error: e.message }];
      throw e;
    }
  }
  const area = AREAS[dev.area];
  if (!area) return [501, { ok: false, error: (text(dev.area) || 'That area') + ' is being built: its reads are not taken yet.' }];
  try {
    return [200, Object.assign({ device: id, area: dev.area }, await area(db, dev, b.reads, opts))];
  } catch (e) {
    if (e instanceof ReaderError) return [e.code === 'NOT_FOUND' ? 404 : e.code === 'NOT_ALLOWED' ? 409 : 400, { ok: false, error: e.message }];
    throw e;
  }
}

function sandboxOnly(project) { return project !== 'ud-distribution'; }

async function mustBeAdmin(db, email) {
  const person = (await db.collection('users').doc(safeIdPart(email)).get()).data();
  if (!person || person.status !== 'ACTIVE' || !L.isAdmin(person)) throw new ReaderError('NOT_ALLOWED', 'Only an administrator can set up a line\'s label reader.');
}

// Line Targets, administrators only.
async function readerCall(db, user, input, opts) {
  const o = Object.assign({ now: () => new Date(), project: '', key: () => crypto.randomBytes(24).toString('base64url') }, opts || {});
  const i = input || {}, email = text(user && user.email).toLowerCase();
  await mustBeAdmin(db, email);
  const id = text(i.operationId), op = text(i.op);
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(id)) throw new ReaderError('BAD_REQUEST', 'Pick a line.');
  const line = await lineOf((ref) => ref.get(), db, id), at = o.now().toISOString();
  const keysRef = db.collection('private').doc('readDevices'), lineRef = db.collection('productionLines').doc(docId(id));
  if (op === 'makeKey') {
    const key = o.key();
    // A line's reader: Production, at this line. kind and reads say what is plugged in (a camera also reads the code date).
    const kind = KINDS.indexOf(text(i.kind).toUpperCase()) >= 0 ? text(i.kind).toUpperCase() : 'LINE_READER';
    const reads = kind === 'CONTROLLER' ? 'COUNT' : READS.indexOf(text(i.reads).toUpperCase()) >= 0 ? text(i.reads).toUpperCase() : 'UPC_DATE';
    await keysRef.set({ [docId(id)]: { hash: hash(key), at, by: email, facilityId: line.facilityId, area: 'PRODUCTION', kind, reads, target: id, name: line.name } }, { merge: true });
    await lineRef.set({ operationId: id, line: line.name, facilityId: line.facilityId, readerKeyAt: at, readerKeyBy: email }, { merge: true });
    return { ok: true, key, message: 'New key for ' + line.name + '. Copy it into the line PC now: it is not shown again, and the old key stops working.' };
  }
  // The machine controller's setup (Line Targets), one box at a time, and a Test read the line PC answers.
  if (op === 'saveController') {
    const field = text(i.field), cur = ((await lineRef.get()).data() || {}).controller || {};
    const brand = field === 'brand' ? text(i.value) : text(cur.brand);
    const r = P.controllerField(field, i.value, brand);
    if (r.error) throw new ReaderError('BAD_REQUEST', r.error);
    await lineRef.set({ operationId: id, line: line.name, facilityId: line.facilityId, controller: { [field]: r.value, updatedAt: at, updatedBy: email } }, { merge: true });
    return { ok: true, message: '' };
  }
  if (op === 'testRead') {
    const reading = READ_KEYS.indexOf(text(i.reading)) >= 0 ? text(i.reading) : 'count';
    const cfg = ((await lineRef.get()).data() || {}).controller || {};
    const label = (P.READINGS.find(x => x[0] === reading) || [, 'reading'])[1].toLowerCase();
    if (!text(cfg.brand) || !text(cfg.ip)) throw new ReaderError('BAD_REQUEST', 'Pick the brand and type the IP address first.');
    if (!text(cfg[reading + 'Tag'])) throw new ReaderError('BAD_REQUEST', 'Type where the ' + label + ' is first.');
    await lineRef.set({ controller: { testAsk: { at, by: email, reading } } }, { merge: true });
    return { ok: true, message: 'Asked the line PC to read the ' + label + '. The number shows here in a few seconds.' };
  }
  if (op === 'startTest' || op === 'stopTest') {
    if (!sandboxOnly(o.project)) throw new ReaderError('NOT_ALLOWED', 'The test feed runs on the sandbox only, so the real counts stay real.');
    if (op === 'stopTest') return stopFeed(lineRef, line, at, email);
    return startFeed(lineRef, id, line, i, at, email, o);
  }
  throw new ReaderError('BAD_REQUEST', 'Unknown label reader request.');
}

// The pretend jugs are the line's own products at their own full speed (Joe 10/11: a test setup for every machine), so the
// Boxing line sends about 8 a minute and the half gallon fillers about 100. A line counted another way switches to Label
// reader for the test and goes back when it stops.
function feedProducts(list) {
  return (Array.isArray(list) ? list : []).slice(0, 3).map(p => {
    const rate = Math.round(Number(p && p.ratePerMin)), shelf = Math.round(Number(p && p.shelfLifeDays));
    return { name: text(p && p.name).slice(0, 120), upc: upcOf(p && p.upc), ratePerMin: rate > 0 ? Math.min(300, rate) : null, shelfLifeDays: shelf > 0 ? Math.min(365, shelf) : null };
  }).filter(p => p.name);
}
async function startFeed(lineRef, id, line, i, at, email, o) {
  const minutes = Math.min(240, Math.max(5, Math.round(Number(i.minutes) || 60)));
  const products = feedProducts(i.products);
  if (!products.length) throw new ReaderError('BAD_REQUEST', line.name + ' has no products to pretend with.');
  const c = (await lineRef.get()).data() || {};
  const was = c.testFeed && c.testFeed.counterBefore ? c.testFeed.counterBefore : c.counter !== 'READER' ? (c.counter || 'TABLET') : null;
  const perMinute = products[0].ratePerMin || 74;
  await lineRef.set({ operationId: id, line: line.name, facilityId: line.facilityId, counter: 'READER',
    testFeed: { until: new Date(o.now().getTime() + minutes * 60000).toISOString(), startedAt: at, by: email, products, perMinute, counterBefore: was } }, { merge: true });
  return { ok: true, operationId: id, message: 'Test feed on ' + line.name + ' for ' + minutes + ' minutes: about ' + perMinute + ' pretend ' + (perMinute === 1 ? 'piece' : 'pieces') + ' a minute.' };
}
async function stopFeed(lineRef, line, at, email) {
  const c = (await lineRef.get()).data() || {};
  const back = c.testFeed && c.testFeed.counterBefore;
  await lineRef.set(Object.assign({ testFeed: null }, back ? { counter: back, updatedAt: at, updatedBy: email } : {}), { merge: true });
  return { ok: true, message: 'Test feed stopped on ' + line.name + '.' + (back ? ' It is counted ' + (back === 'SENSOR' ? 'by a sensor' : back === 'CONTROLLER' ? 'by its machine controller' : 'by typing') + ' again.' : '') };
}

// Line Targets' Test Feed on Every Line / Stop Every Test Feed (sandbox, administrators): lines = [{operationId, products}].
async function readerAll(db, user, input, opts) {
  const o = Object.assign({ now: () => new Date(), project: '' }, opts || {});
  const i = input || {}, op = text(i.op);
  if (op !== 'startAll' && op !== 'stopAll') return readerCall(db, user, input, opts);
  await mustBeAdmin(db, text(user && user.email).toLowerCase());
  if (!sandboxOnly(o.project)) throw new ReaderError('NOT_ALLOWED', 'The test feed runs on the sandbox only, so the real counts stay real.');
  const lines = (Array.isArray(i.lines) ? i.lines : []).slice(0, 40);
  if (!lines.length) throw new ReaderError('BAD_REQUEST', 'Pick a plant with production lines.');
  const done = [], skipped = [];
  for (const l of lines) {
    const id = text(l && l.operationId);
    if (op === 'stopAll') {
      if (!/^[A-Za-z0-9_-]{1,120}$/.test(id)) continue;
      const c = (await db.collection('productionLines').doc(docId(id)).get()).data();
      if (!c || !c.testFeed) continue;
    }
    try {
      await readerCall(db, user, Object.assign({ op: op === 'startAll' ? 'startTest' : 'stopTest', operationId: id, minutes: i.minutes, products: l && l.products }), o);
      done.push(id);
    } catch (e) {
      if (!(e instanceof ReaderError) || e.code === 'NOT_ALLOWED' && /administrator/.test(e.message)) throw e;
      skipped.push(e.message);
    }
  }
  const message = op === 'startAll' ? 'Test feed on ' + done.length + ' line' + (done.length === 1 ? '' : 's') + ' for an hour.' : 'Test feed stopped on ' + done.length + ' line' + (done.length === 1 ? '' : 's') + '.';
  return { ok: true, lines: done, message: message + (skipped.length ? ' ' + skipped.join(' ') : '') };
}

// One minute of the test feed's pretend jugs (minute = minutes since it started): a pause every half hour so the line stops
// on its own, a product change every 20 minutes, a missing date about every 40 jugs and a wrong one now and then.
function testReads(feed, minute, expected) {
  const m = ((minute % 30) + 30) % 30;
  if (m >= 26) return [];
  const products = feed.products || [];
  const p = products[Math.floor(minute / 20) % products.length];
  const base = (p && p.ratePerMin) || feed.perMinute || 74, wobble = Math.max(1, Math.round(base / 10));
  const n = Math.max(0, Math.round(base + (minute % 7 === 3 ? wobble : minute % 5 === 1 ? -wobble : 0)));
  const out = [];
  for (let j = 0; j < n; j++) {
    const k = minute * 1000 + j, date = k % 41 === 7 ? '' : k % 157 === 11 && expected ? 'JAN 01' : expected || '';
    out.push(k % 97 === 5 ? { upc: '' } : { upc: p.upc, name: p.name, shelfLifeDays: p.shelfLifeDays || null, date });
  }
  return out;
}

// Every minute: the test feeds, then a stop on a reader line that has gone quiet.
async function readerMinute(db, opts) {
  const o = Object.assign({ now: () => new Date(), project: '' }, opts || {});
  const now = o.now(), ms = now.getTime(), done = [];
  const lines = await db.collection('productionLines').where('counter', 'in', ['READER', 'CONTROLLER']).get();
  for (const d of lines.docs) {
    const c = d.data(), id = c.operationId || d.id;
    const feed = c.counter === 'READER' && c.testFeed && sandboxOnly(o.project) && Date.parse(c.testFeed.until) > ms ? c.testFeed : null;
    if (feed) {
      const minute = Math.floor((ms - Date.parse(feed.startedAt)) / 60000);
      const pSnap = await db.collection('plantProducts').doc(docId(id)).get();
      const targets = P.targetsFor(pSnap.exists ? pSnap.data().products : []);
      const p = (feed.products || [])[Math.floor(minute / 20) % Math.max(1, (feed.products || []).length)] || {};
      const t = targets.find(x => x.name.toUpperCase() === text(p.name).toUpperCase());
      const shelf = t && t.shelfLifeDays ? t.shelfLifeDays : p.shelfLifeDays;
      const reads = testReads(feed, minute, shelf ? P.codeDate(plantShift(null, ms).date, shelf) : '');
      if (reads.length) { await applyReads(db, id, reads, { now: o.now, test: true }); done.push(id + ': ' + reads.length + ' test jugs'); continue; }
    }
    // Quiet for 3 minutes on this shift: the line stopped (from its last jug).
    const plant = await db.collection('plantSetup').doc(docId(id)).get();
    const fac = plant.exists ? text(plant.data().facilityId) || 'fac_uniontown' : 'fac_uniontown';
    const shifts = await db.collection('plantShifts').doc(docId(fac)).get();
    const shift = plantShift(shifts.exists ? shifts.data().shifts : null, ms);
    const ref = db.collection('productionRuns').doc(docId(P.runId(id, shift.key)));
    await db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      if (!s.exists) return;
      const run = s.data(), last = Date.parse((c.counter === 'CONTROLLER' ? run.machine && run.machine.lastMoveAt : run.reader && run.reader.lastReadAt) || '');
      const stops = Array.isArray(run.stops) ? run.stops : [];
      if (!last || ms - last < QUIET_MINUTES * 60000 || stops.some(x => !x.end) || stops.length >= STOP_LIMIT) return;
      if (stops.some(x => Date.parse(x.start) >= last)) return;
      stops.push({ start: new Date(last).toISOString(), end: null, reason: '', by: c.counter === 'CONTROLLER' ? BY_MACHINE : BY });
      tx.set(ref, Object.assign(run, { stops, updatedAt: now.toISOString(), updatedBy: BY }));
      done.push(id + ': stopped (no jugs for ' + QUIET_MINUTES + ' minutes)');
    });
  }
  return done;
}

module.exports = { ReaderError, AREAS, applyReads, applyMachine, controllerReads, configOut, handleReads, readerCall, readerAll, readerMinute, testReads, plantShift, zoneOffset, dateOf, hash, QUIET_MINUTES };

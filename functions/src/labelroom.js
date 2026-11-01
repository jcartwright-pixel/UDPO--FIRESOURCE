/*
 * Labeling Room (Joe 10/31, mock-up 3: "United Dairy End Zone", our own RedZone). The bottles come out of their bags in Debag,
 * get their labels in the Labeling Room and ride the belt to a filler. Kept on the filler's productionLines record:
 *
 * saveLabelRoom  op 'labeling' : the label the Labeling Room puts on now (the "Labeling now" drop-down, or "I switched to ...
 *                                labels"); the filler's tablet counts down to the first bottle with it (the belt minutes).
 *                op 'hold'     : the filler tells the Labeling Room to hold labels (the filler is down).
 *                op 'resume'   : the filler is running again; the hold comes off.
 * The belt minutes, the bottles the belt holds and which fillers are in the Labeling Room are Line Targets' (saveLineSetup).
 * What the filler runs, how many are left and what is next stay the line tablet's (saveLineEntry).
 */
'use strict';

const P = require('./production-rules');

const text = (v) => (v === null || v === undefined ? '' : String(v).trim());
const docId = (id) => String(id).replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 200);
const OPS = ['labeling', 'hold', 'resume'];

function validateLabelRoom(input, SaveError) {
  const op = text(input.op).toLowerCase();
  if (OPS.indexOf(op) < 0) throw new SaveError('BAD_REQUEST', 'Pick a label, hold labels, or say the filler is running again.');
  const operationId = text(input.operationId).slice(0, 120);
  if (!/^[A-Za-z0-9_-]+$/.test(operationId)) throw new SaveError('BAD_REQUEST', 'Pick a filler.');
  const out = { op, operationId };
  if (op === 'labeling') {
    out.product = text(input.product).slice(0, 120);
    if (!out.product) throw new SaveError('BAD_REQUEST', 'Pick the label going on now.');
  }
  return out;
}

async function saveLabelRoom(tx, db, req, email, stamp, logRef, mode, SaveError) {
  const setup = await tx.get(db.collection('plantSetup').doc(docId(req.operationId))), sd = setup.exists ? setup.data() : null;
  if (!sd || sd.type !== 'PRODUCTION_AREA' || sd.status !== 'ACTIVE') throw new SaveError('NOT_FOUND', 'That filler is not set up for this plant.');
  const name = text(sd.name) || text(sd.area) || req.operationId, facilityId = text(sd.facilityId) || 'fac_uniontown';
  if (P.lineKind(name) !== 'FILLER' || P.isBagFiller(name)) throw new SaveError('BAD_REQUEST', name + ' does not get its bottles from the Labeling Room.');
  if (req.op === 'labeling') {
    // Only one of the filler's own products (the plant's Products list for this line).
    const prods = await tx.get(db.collection('plantProducts').doc(docId(req.operationId)));
    const targets = P.targetsFor(prods.exists ? prods.data().products : []);
    const hit = targets.find(t => P.sameItem(t.name, req.product));
    if (!hit) throw new SaveError('BAD_REQUEST', req.product + ' is not one of ' + name + '\'s products.');
    req.product = hit.name;
  }
  const ref = db.collection('productionLines').doc(docId(req.operationId)), had = await tx.get(ref), before = had.exists ? had.data() : {};
  const set = { operationId: req.operationId, line: name, facilityId, updatedAt: stamp, updatedBy: email };
  let message;
  if (req.op === 'labeling') { set.labeling = { product: req.product, at: stamp, by: email }; message = name + ': labeling ' + req.product + '.'; }
  else if (req.op === 'hold') { set.labelHold = { at: stamp, by: email }; message = name + ': hold labels.'; }
  else { set.labelHold = null; message = name + ': running again.'; }
  tx.set(ref, set, { merge: true });
  const result = { ok: true, requestId: req.requestId, operationId: req.operationId, op: req.op, message };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, operationId: req.operationId, op: req.op,
    before: { labeling: before.labeling || null, labelHold: before.labelHold || null }, after: { labeling: set.labeling || before.labeling || null, labelHold: 'labelHold' in set ? set.labelHold : before.labelHold || null }, result });
  return result;
}

module.exports = { validateLabelRoom, saveLabelRoom, OPS };

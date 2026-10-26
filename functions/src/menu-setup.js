/*
 * Menu Setup (Joe 10/25, mock-up 7): each plant puts its plant sides' menus in its own order (menuSetup/<plant>). The sections
 * and what a save may hold are logic.js MENU_SIDES, menuArrange and menuProblem, shared with the menu itself (app.js).
 * reset: true puts the plant back on the app's own menu.
 */
'use strict';

const L = require('./logic');

function validateMenu(input, SaveError) {
  const facilityId = String(input.facilityId || '').trim();
  if (!(L.PLANTS || []).some(p => p.id === facilityId)) throw new SaveError('BAD_REQUEST', 'Pick a plant.');
  if (input.reset === true) return { facilityId, reset: true };
  const problem = L.menuProblem(input.sides);
  if (problem) throw new SaveError('BAD_REQUEST', problem);
  return { facilityId, reset: false, sides: input.sides };
}

async function saveMenu(tx, db, req, email, stamp, logRef, mode) {
  const ref = db.collection('menuSetup').doc(req.facilityId), had = await tx.get(ref);
  const before = had.exists ? had.data().sides || null : null;
  const after = req.reset ? null : L.menuArrange(req.sides);
  if (req.reset) tx.delete(ref);
  else tx.set(ref, { facilityId: req.facilityId, sides: after, updatedAt: stamp, updatedBy: email });
  const result = { ok: true, requestId: req.requestId, facilityId: req.facilityId, sides: after || L.menuArrange(null), message: req.reset ? 'Back to the standard menu.' : 'Menu saved.' };
  tx.set(logRef, { action: req.action, by: email, at: stamp, mode: mode.mode, facilityId: req.facilityId, before, after, result });
  return result;
}

module.exports = { validateMenu, saveMenu };

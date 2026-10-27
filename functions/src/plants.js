/*
 * Joe 10/26: "All three locations have completely separate... technically, no shared information in between plants. This
 * home screen just reads the live data from the three locations." Each plant keeps everything in its own database
 * (logic.js PLANTS[].db): Uniontown in the first one, as always, Charleston and Martins Ferry each in their own.
 *
 *   dbFor(plant)        the plant's database
 *   callPlant(...)      which plant a call from a screen is for, refused unless the caller may work at that plant
 *   mirrorPerson(...)   the Users list stays one list (USERS_MASTER and People & Roles write it in Uniontown's database); each
 *                       other plant's database gets a copy of only the people given that plant, so its database rules let
 *                       no one else in. plantAccess/{email} in every plant's database says which plants a person has.
 *   mirrorAll(db)       the same for everyone, once after a deploy and whenever the plant list changes
 */
'use strict';

const crypto = require('crypto');
const { getFirestore } = require('firebase-admin/firestore');
const L = require('./logic');
const { safeIdPart } = require('./model');

class PlantError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const cache = new Map();
// The company's database (Uniontown's, the first one), where the one Users list and People & Roles are kept.
const isHome = (db) => !db || !db.databaseId || db.databaseId === '(default)';
const companyDb = (db) => (isHome(db) ? db : getFirestore());
// The plant's database. Uniontown's is the first database (the one every job used before), so nothing moves for Uniontown.
function dbFor(plant, home) {
  const id = L.plantDb(plant || L.HOME_PLANT);
  if (!id) throw new PlantError('BAD_REQUEST', 'Pick a plant: Uniontown, Charleston or Martins Ferry.');
  if (id === '(default)') return home || getFirestore();
  if (!cache.has(id)) cache.set(id, getFirestore(id));
  return cache.get(id);
}
// The plant a call names (udPlant, which every screen sends), else the plant its facilityId names, else Uniontown.
const plantOf = (input) => String(input && input.udPlant || (input && L.plantDb(input.facilityId) ? input.facilityId : '') || L.HOME_PLANT);
const plantName = (id) => (L.PLANTS.find(p => p.id === id) || {}).name || id;

// The plant a screen's call is for (the screen sends the plant it is open at as udPlant; none = Uniontown), after checking the caller
// may work there: a person by their Users list entry (Uniontown's database), a code-signed station by the plant on its code.
async function callPlant(home, input, who) {
  const plant = plantOf(input);
  if (!L.plantDb(plant)) throw new PlantError('BAD_REQUEST', 'Pick a plant: Uniontown, Charleston or Martins Ferry.');
  // A save names its plant in facilityId too; the two must agree, so nothing is saved into another plant's database.
  if (input && input.facilityId && L.plantDb(input.facilityId) && input.facilityId !== plant) {
    throw new PlantError('NOT_ALLOWED', 'This is ' + plantName(plant) + '. Open ' + plantName(input.facilityId) + ' to change its things.');
  }
  if (who && who.station) {
    if ((who.station.facilityId || L.HOME_PLANT) !== plant) throw new PlantError('NOT_ALLOWED', 'This tablet is signed in for ' + plantName(who.station.facilityId) + ' only.');
    return plant;
  }
  if (who && who.email && plant !== L.HOME_PLANT) {
    const person = (await home.collection('users').doc(safeIdPart(who.email)).get()).data();
    if (L.plantsFor(person).indexOf(plant) < 0) throw new PlantError('NOT_ALLOWED', 'You are not set up for ' + plantName(plant) + '. An administrator can add it in People & Roles.');
  }
  return plant;
}

// What a plant's database keeps of a person: their Users list entry, only when they may work at that plant. dbs = the
// plants' databases that exist ({plantId: database}); a plant whose database is not made yet is skipped.
const accessOf = (person) => ({ plants: L.plantsFor(person) });
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const dbList = (home, dbs) => L.PLANTS.filter(p => !dbs || dbs[p.id]).map(p => [p.id, dbs ? dbs[p.id] : dbFor(p.id, home)]);
async function mirrorPerson(home, email, person, dbs) {
  const id = safeIdPart(email), access = accessOf(person);
  for (const [plant, pdb] of dbList(home, dbs)) {
    const accessRef = pdb.collection('plantAccess').doc(id), had = await accessRef.get();
    if (person) { if (!had.exists || !sameJson(had.data(), access)) await accessRef.set(access); } else if (had.exists) await accessRef.delete();
    if (isHome(pdb)) continue;
    const userRef = pdb.collection('users').doc(id), copy = await userRef.get(), mine = access.plants.indexOf(plant) >= 0;
    if (person && mine) { if (!copy.exists || !sameJson(copy.data(), person)) await userRef.set(person); } else if (copy.exists) await userRef.delete();
  }
}

// Everyone at once: after a deploy (dataLoadsOnce). Writes only what differs, and remembers what it last copied, so a quiet
// run reads the Users list and one marker only.
async function mirrorAll(home, dbs) {
  const snap = await home.collection('users').get();
  const people = snap.docs.map(d => [d.id, d.data()]).sort((a, b) => a[0].localeCompare(b[0]));
  const list = dbList(home, dbs);
  const stamp = crypto.createHash('sha256').update(JSON.stringify([L.PLANTS, list.map(x => x[0]), people])).digest('hex');
  const markRef = home.collection('private').doc('plantMirror');
  if (((await markRef.get()).data() || {}).stamp === stamp) return { changed: false, people: people.length };
  for (const [email, person] of people) await mirrorPerson(home, email, person, dbs);
  // Anyone taken off the Users list loses their copies too.
  const keep = new Set(people.map(p => p[0]));
  for (const [, pdb] of list) {
    for (const d of (await pdb.collection('plantAccess').get()).docs) if (!keep.has(d.id)) await mirrorPerson(home, d.id, null, dbs);
  }
  await markRef.set({ stamp, at: new Date().toISOString() });
  return { changed: true, people: people.length };
}

// The plants whose jobs run (an ACTIVE plant; a plant being built has nothing to copy or send yet).
const activePlants = () => L.PLANTS.filter(p => p.status === 'ACTIVE');

module.exports = { PlantError, isHome, companyDb, dbFor, callPlant, plantOf, plantName, mirrorPerson, mirrorAll, activePlants };

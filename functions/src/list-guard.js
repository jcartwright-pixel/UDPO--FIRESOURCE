/*
 * The server's half of the one database router (Joe 10/30): every read and save the server makes names its list through
 * Firestore's collection / doc / collectionGroup, and this checks each name against the one index (src/lists.js).
 *
 * In the tests (the emulators, or UD_STRICT_LISTS=1) a name that is not in the index stops the call, so a stray name is
 * caught before it is released. On the live server it is written to the log once and the call goes on, so a name missed
 * from the index never stops work.
 */
'use strict';

const { Firestore, DocumentReference, CollectionReference } = require('@google-cloud/firestore');
const LISTS = require('./lists');

const strict = () => process.env.FUNCTIONS_EMULATOR === 'true' || process.env.UD_STRICT_LISTS === '1';
const noted = new Set();

function check(path, fromList) {
  const bad = LISTS.unlisted(path, fromList);
  if (!bad.length) return;
  const text = 'Not in the list index (functions/src/lists.js): ' + bad.join(', ') + ' (' + path + ')';
  if (strict()) throw new Error(text);
  if (!noted.has(text)) { noted.add(text); console.error(text); }
}

// Another app's database (UDMS, read by src/employees.js) has its own lists; outsideDb marks it so its names are not checked.
const outside = (x) => !!(x && (x.__udOutside || (x.firestore && x.firestore.__udOutside)));
function outsideDb(db) { if (!db.__udOutside) Object.defineProperty(db, '__udOutside', { value: true }); return db; }

function install() {
  if (Firestore.prototype.__udListGuard) return;
  const wrap = (proto, name, fromList) => {
    const original = proto[name];
    proto[name] = function (path) { if (typeof path === 'string' && !outside(this)) check(path, fromList); return original.apply(this, arguments); };
  };
  wrap(Firestore.prototype, 'collection', false);
  wrap(Firestore.prototype, 'doc', false);
  wrap(DocumentReference.prototype, 'collection', false);
  // collection('x').doc('id/sub/...') starts at a list, so its list names are the 2nd, 4th ... parts.
  wrap(CollectionReference.prototype, 'doc', true);
  const group = Firestore.prototype.collectionGroup;
  Firestore.prototype.collectionGroup = function (id) { if (typeof id === 'string' && !LISTS.known(id)) check(id, false); return group.apply(this, arguments); };
  Firestore.prototype.__udListGuard = true;
}

install();

module.exports = { install, check, outsideDb };

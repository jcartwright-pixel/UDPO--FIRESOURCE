/*
 * Google's Firebase web code (sign-in, database, server calls), loaded from www.gstatic.com. Review item 82 (Joe 10/13):
 * the version is written in this one file. Every screen and script imports Firebase from here, never from gstatic itself.
 * To move to another version, change the four lines below and FIREBASE_VERSION together, and functions/package.json's
 * "firebase" (the copy the browser checks serve in gstatic's place); functions/test/unit/firebase-version.test.js fails if
 * any of them differ or a file outside this one names a version.
 */
export * from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
export * from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
export * from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';
export * from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-functions.js';

export const FIREBASE_VERSION = '12.18.0';

// The four files' addresses, for the screens kept on the device with no signal (js/offline-saves.js, js/phone-queue.js, sw.js).
export const FIREBASE_FILES = ['app', 'auth', 'firestore', 'functions']
  .map(n => 'https://www.gstatic.com/firebasejs/' + FIREBASE_VERSION + '/firebase-' + n + '.js');

// Joe 10/21 ("the older screens are loading and then it's refreshing on the new ones"): every read a screen starts is
// counted until its first answer arrives, so app.js shows the screen once, when its first data is drawn, instead of the
// empty boxes and dashes first and the numbers after. The reads themselves are Firebase's own, unchanged.
import { httpsCallable as fnCallable } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-functions.js';
import { onSnapshot as fsOnSnapshot, getDoc as fsGetDoc, getDocs as fsGetDocs, collection as fsCollection, doc as fsDoc, collectionGroup as fsCollectionGroup } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';
// Joe 10/30 ("everything goes to the same place at all times"): this file is the one door to the database, and every list a
// screen reads is checked against the one index (js/lists.js, the server's src/lists.js). A name not in it is refused here,
// with its name, instead of reading somewhere by accident.
import './lists.js';
function checked(parent, parts, fromList) {
  const path = parts.filter(p => typeof p === 'string').join('/');
  const bad = window.UDLists.unlisted(path, fromList);
  if (bad.length) throw new Error('Not in the list index (js/lists.js): ' + bad.join(', '));
}
const startsAtList = (parent) => !!(parent && parent.type === 'collection');
export function collection(parent, ...parts) { checked(parent, parts, startsAtList(parent)); return fsCollection(parent, ...parts); }
export function doc(parent, ...parts) { checked(parent, parts, startsAtList(parent)); return fsDoc(parent, ...parts); }
export function collectionGroup(db, id) { if (!window.UDLists.known(id)) throw new Error('Not in the list index (js/lists.js): ' + id); return fsCollectionGroup(db, id); }
const reads = window.UDReads = window.UDReads || { waiting: 0, started: 0, last: 0, listeners: new Set(), log: [] };
// What was read and how long its first answer took (the first 100 reads of a screen), for the timing checks.
const nameOf = (ref) => { try { return ref.path || (ref._query && ref._query.path && ref._query.path.segments.join('/')) || ref.type || '?'; } catch (e) { return '?'; } };
// Joe 10/31 ("All I need to know is the last time it refreshed"): the moment the screen last heard from the server (not
// its own kept copy) is sent to the header, which shows it on the phone and tablet apps as "Last refreshed 10-31-26 9:26 AM".
export function markRefreshed() { reads.freshAt = Date.now(); try { window.dispatchEvent(new CustomEvent('ud-refreshed')); } catch (e) { /* keep going */ } }
const fromServer = (s) => { if (!s || !s.metadata || !s.metadata.fromCache) markRefreshed(); return s; };
window.UDMarkRefreshed = markRefreshed;
function changed() { reads.last = performance.now(); reads.listeners.forEach(f => { try { f(); } catch (e) { /* keep going */ } }); }
function begin(ref) {
  reads.waiting++; reads.started++; changed();
  const note = reads.log.length < 100 ? { what: nameOf(ref), at: Math.round(performance.now()), ms: null } : null;
  if (note) reads.log.push(note);
  let done = false;
  return () => { if (done) return; done = true; reads.waiting--; if (note) note.ms = Math.round(performance.now()) - note.at; changed(); };
}
export function onSnapshot(ref, ...rest) {
  const end = begin(ref);
  // onSnapshot(ref, [options,] next | observer, [error], [complete])
  const at = rest.findIndex(a => typeof a === 'function' || (a && (typeof a.next === 'function' || typeof a.error === 'function')));
  if (at < 0) { end(); return fsOnSnapshot(ref, ...rest); }
  const given = rest[at];
  if (typeof given === 'function') {
    const next = given, error = typeof rest[at + 1] === 'function' ? rest[at + 1] : null;
    rest[at] = (s) => { try { fromServer(s); next(s); } finally { end(); } };
    rest[at + 1] = (e) => { try { if (error) error(e); else console.error('Uncaught Error in snapshot listener:', e); } finally { end(); } };
  } else {
    const obs = given;
    rest[at] = Object.assign({}, obs, {
      next: (s) => { try { fromServer(s); if (obs.next) obs.next(s); } finally { end(); } },
      error: (e) => { try { if (obs.error) obs.error(e); else console.error('Uncaught Error in snapshot listener:', e); } finally { end(); } }
    });
  }
  const stop = fsOnSnapshot(ref, ...rest);
  return () => { end(); stop(); };
}
export function getDoc(ref) { const end = begin(ref); return fsGetDoc(ref).then(fromServer).finally(end); }
export function getDocs(q) { const end = begin(q); return fsGetDocs(q).then(fromServer).finally(end); }
// A server call that answers counts as a refresh too (the driver phone, Garage and Maintenance Stations read this way).
export function httpsCallable(...args) { const fn = fnCallable(...args); return (...a) => fn(...a).then(r => { markRefreshed(); return r; }); }
// A read that fills in a part later (the Late Forecast's earlier nights) without holding the rest of the screen back.
export function getDocsLater(q) { return fsGetDocs(q); }

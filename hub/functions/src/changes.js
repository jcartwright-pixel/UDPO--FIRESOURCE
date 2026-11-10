/*
 * The one door for changes to the route customer list (Joe 11-9-26: "The hub is the only thing allowed to save to the customer
 * list"; "they have a temporary storage on what they're working on, until it's allowed to write to the customer list. But it
 * must be approved before that's finalized. Until then, they keep their changes"). Master repository:
 * requests/customer-list-through-hub.md.
 *
 *   hubCustomerChanges/<id>  { plant, from, kind, route, day, input, summary, sentBy, sentAt,
 *                              status: 'sent' -> 'approved' (approvedBy, approvedAt) -> 'applied' or 'rejected' (Customers),
 *                                      'sent' -> 'turnedDown' (Hub: turnedDownBy, turnedDownAt, why),
 *                                      'sent' -> 'withdrawn' (the sender, before it is approved) }
 *
 * Every app sends its change with the hub call (op sendChange); nothing is saved to the customer list then. The app keeps its
 * own working copy until the change is approved. An administrator approves or turns it down on the Hub's Customer Changes
 * screen. The Customer List's own code then saves an approved change with the same step it runs today (input is the same input
 * its customerList call takes) and sets applied or rejected; the Hub never writes the Customer List's records.
 */
'use strict';

const COLLECTION = 'hubCustomerChanges';
// Who sends: every app that works on the route customer list (Joe 11-9-26: Customers & Routes' own saves too).
const FROM = { customers: 'Customers & Routes', 'pallet-builder': 'Pallet Builder', operations: 'Plant & Distribution', 'route-cost': 'Route Cost Analysis', routes: 'Route & Trip Costs' };
// What kind of change: the Customer List's steps (customerList op) each kind may carry.
const KINDS = {
  routeDay: { name: 'Route day order, load sequences and truck map', ops: ['saveRouteDay', 'placeStop'] },
  customer: { name: 'A customer added or changed', ops: ['saveCustomer', 'changeAccount', 'setGroup'] },
  status: { name: 'Customers made active or inactive', ops: ['setStatus'] },
  palletUses: { name: 'Pallet uses for a customer', ops: ['setPalletUses'] },
  palletRules: { name: 'Pallet rules', ops: ['savePalletRules'] }
};
// Waiting: for an administrator. Everything else (approved, waiting for the customer list to save it, and finished) is Done.
const OPEN = ['sent'];
const DONE = ['approved', 'applied', 'rejected', 'turnedDown', 'withdrawn'];
const MAX_INPUT = 200000;

class ChangeError extends Error { constructor(code, message) { super(message); this.code = code; } }
const fail = (code, message) => { throw new ChangeError(code, message); };
const text = (v, n) => String(v === undefined || v === null ? '' : v).trim().slice(0, n || 200);

/** A change as an app sends it, checked; throws a plain-words error when something is missing. */
function cleanSend(input, email, stamp) {
  const plant = text(input.plant, 60), from = text(input.from, 40), kind = text(input.kind, 40);
  if (!plant) fail('BAD_REQUEST', 'Pick the plant the change is for.');
  if (!FROM[from]) fail('BAD_REQUEST', 'The Hub does not know the app sending this change.');
  if (!KINDS[kind]) fail('BAD_REQUEST', 'The Hub does not know that kind of change.');
  const step = input.input && typeof input.input === 'object' ? input.input : null;
  if (!step || KINDS[kind].ops.indexOf(String(step.op || '')) < 0) fail('BAD_REQUEST', 'The change does not say what to save. Send it again from the app.');
  if (Buffer.byteLength(JSON.stringify(step)) > MAX_INPUT) fail('BAD_REQUEST', 'The change is too big to send at once. Send it in smaller parts.');
  const summary = text(input.summary, 500);
  if (!summary) fail('BAD_REQUEST', 'Say in a few words what the change is.');
  return { plant, from, fromName: FROM[from], kind, kindName: KINDS[kind].name, route: text(input.route, 20), day: text(input.day, 3).toUpperCase(),
    input: JSON.parse(JSON.stringify(Object.assign({}, step, { plant }))), summary, sentBy: email, sentAt: stamp, status: 'sent' };
}

/** Any active person, from any app: the change waits in the Hub. Returns its id. */
async function sendChange(db, email, input, stamp) {
  const rec = cleanSend(input || {}, email, stamp);
  const ref = db.collection(COLLECTION).doc();
  await ref.set(rec);
  return { ok: true, id: ref.id, status: 'sent', message: 'Sent to the Hub. It waits there until it is approved; keep your working copy until then.' };
}

/** The changes for the screen: every open one and the newest finished ones, newest first, optionally one plant. */
async function listChanges(db, input) {
  const plant = text((input || {}).plant, 60);
  const [open, done] = await Promise.all([
    db.collection(COLLECTION).where('status', 'in', OPEN).get(),
    db.collection(COLLECTION).where('status', 'in', DONE).get()
  ]);
  const rows = (snap) => snap.docs.map(d => Object.assign({ id: d.id }, d.data())).filter(c => !plant || c.plant === plant)
    .sort((a, b) => String(b.sentAt || '').localeCompare(String(a.sentAt || '')));
  const strip = (c) => { const r = Object.assign({}, c); delete r.input; r.op = c.input && c.input.op || ''; return r; };
  return { open: rows(open).map(strip), done: rows(done).slice(0, 50).map(strip), kinds: KINDS, from: FROM };
}

/** status 'sent' only: approve (to the Customer List to save) or turn down (with why). */
async function decide(db, email, input, approve, stamp) {
  const id = text((input || {}).id, 100), why = text((input || {}).why, 500);
  if (!id) fail('BAD_REQUEST', 'Pick a change.');
  if (!approve && !why) fail('BAD_REQUEST', 'Say why it is turned down, so the person who sent it knows.');
  const ref = db.collection(COLLECTION).doc(id);
  return db.runTransaction(async tx => {
    const s = await tx.get(ref);
    if (!s.exists) fail('NOT_FOUND', 'That change is not there any more. Reload the page.');
    const c = s.data();
    if (c.status !== 'sent') fail('BAD_REQUEST', 'That change is ' + (c.status === 'turnedDown' ? 'turned down' : c.status) + ' already. Reload the page.');
    const set = approve ? { status: 'approved', approvedBy: email, approvedAt: stamp } : { status: 'turnedDown', turnedDownBy: email, turnedDownAt: stamp, why };
    tx.update(ref, set);
    tx.set(db.collection('actions').doc('hub-' + require('crypto').randomBytes(8).toString('hex')),
      { action: approve ? 'approveCustomerChange' : 'turnDownCustomerChange', by: email, at: stamp, change: id, plant: c.plant, from: c.from, kind: c.kind, why: why || null });
    return Object.assign({ ok: true, id }, set);
  });
}

/** The sender takes back a change that is not approved yet. */
async function withdraw(db, email, input, isAdmin, stamp) {
  const id = text((input || {}).id, 100);
  if (!id) fail('BAD_REQUEST', 'Pick a change.');
  const ref = db.collection(COLLECTION).doc(id);
  return db.runTransaction(async tx => {
    const s = await tx.get(ref);
    if (!s.exists) fail('NOT_FOUND', 'That change is not there any more.');
    const c = s.data();
    if (c.sentBy !== email && !isAdmin) fail('NOT_ALLOWED', 'Only the person who sent a change can take it back.');
    if (c.status !== 'sent') fail('BAD_REQUEST', 'That change is ' + c.status + ' already, so it cannot be taken back.');
    tx.update(ref, { status: 'withdrawn', withdrawnBy: email, withdrawnAt: stamp });
    return { ok: true, id, status: 'withdrawn' };
  });
}

/** One change, for the app that sent it (to show where it stands). */
async function changeStatus(db, input) {
  const id = text((input || {}).id, 100);
  if (!id) fail('BAD_REQUEST', 'Pick a change.');
  const s = await db.collection(COLLECTION).doc(id).get();
  if (!s.exists) fail('NOT_FOUND', 'That change is not there.');
  const c = s.data();
  return { id, status: c.status, summary: c.summary, sentAt: c.sentAt, why: c.why || '', approvedAt: c.approvedAt || '', appliedAt: c.appliedAt || '' };
}

module.exports = { sendChange, listChanges, decide, withdraw, changeStatus, cleanSend, ChangeError, COLLECTION, FROM, KINDS };

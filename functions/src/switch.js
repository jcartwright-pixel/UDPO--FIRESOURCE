/*
 * United Dairy Distribution app: the per-screen switch.
 *
 * Each screen is run from one app at a time: "old" (the current Apps Script app; the new app shows a copy)
 * or "new" (the new app saves, and each save is written to the sheet so the current app sees it).
 *
 *   - While every screen is "old", the new app is a test copy and any of its screens may save.
 *   - Once a screen is "new", only "new" screens save in the new app; the others are view only there.
 *   - A screen can be "new" only while the write-back is on, and the write-back cannot be turned off while
 *     any screen is "new", so a save is never kept in the new app alone.
 *
 * Only an administrator flips the switch. Every flip is recorded in `actions`.
 */
'use strict';

const M = require('./model');
const L = require('./logic');

const C = M.COLLECTIONS;
const SWITCH_ROLES = ['ADMINISTRATOR'];

const SCREENS = L.SCREENS;

class SwitchError extends Error {
  constructor(code, message) { super(message); this.code = code; this.details = null; }
}

const ownersOf = L.screenOwners;
const anyNew = (config) => { const o = ownersOf(config); return Object.keys(o).some(k => o[k] === 'new'); };
const writeBackOn = (config) => !!(config && config.writeBack && config.writeBack.enabled === true);

/*
 * Whether a save from `screen` may go ahead, given config/app. Returns {mode, owner, writeBack}; throws a
 * SaveError-like {code: 'NOT_ALLOWED'} through makeError when it may not.
 */
function screenMode(config, screen, makeError) {
  const state = L.screenState(config, screen);
  if (!state.open) throw makeError('NOT_ALLOWED', state.why);
  return { mode: state.live ? 'live' : 'test', owner: state.owner, writeBack: writeBackOn(config) };
}

/*
 * input: {requestId, screen, owner: 'old'|'new'} or {requestId, writeBack: true|false}.
 * ready: whether the server has a sandbox write-back target (WRITEBACK_JSON); the write-back cannot go on without one.
 */
async function setSwitch(db, user, input, ready, now) {
  input = input || {};
  const requestId = String(input.requestId || '');
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(requestId)) throw new SwitchError('BAD_REQUEST', 'requestId is missing');
  const flipScreen = Object.prototype.hasOwnProperty.call(input, 'screen');
  if (flipScreen) {
    if (!SCREENS[input.screen]) throw new SwitchError('BAD_REQUEST', 'Unknown screen ' + String(input.screen).slice(0, 40));
    if (input.owner !== 'old' && input.owner !== 'new') throw new SwitchError('BAD_REQUEST', 'owner must be old or new');
  } else if (typeof input.writeBack !== 'boolean') {
    throw new SwitchError('BAD_REQUEST', 'Say which screen to switch, or whether the write-back is on');
  }
  const stamp = (now ? now() : new Date()).toISOString();
  const email = String(user && user.email || '').toLowerCase();
  return db.runTransaction(async (tx) => {
    const logRef = db.collection(C.actions).doc(requestId);
    const configRef = db.collection(C.config).doc('app');
    const [logSnap, personSnap, configSnap] = await Promise.all([
      tx.get(logRef), tx.get(db.collection(C.users).doc(M.safeIdPart(email))), tx.get(configRef)]);
    if (logSnap.exists) return Object.assign({}, logSnap.data().result, { repeated: true });
    const person = personSnap.exists ? personSnap.data() : null;
    if (!person || person.status !== 'ACTIVE' || !L.hasRole(person, SWITCH_ROLES)) throw new SwitchError('NOT_ALLOWED', 'Only an administrator can switch screens between the apps');
    const config = configSnap.exists ? configSnap.data() : {};
    const owners = ownersOf(config);
    const before = { screenOwners: owners, writeBack: writeBackOn(config) };
    const after = { screenOwners: Object.assign({}, owners), writeBack: before.writeBack };
    if (flipScreen) {
      if (input.owner === 'new' && !before.writeBack) throw new SwitchError('NOT_ALLOWED', 'Turn the write-back on first, so the current app sees what the new app saves');
      after.screenOwners[input.screen] = input.owner;
    } else {
      if (input.writeBack && !ready) throw new SwitchError('NOT_ALLOWED', 'The server has no sandbox sheet to write to yet (WRITEBACK_JSON)');
      if (!input.writeBack && anyNew(config)) throw new SwitchError('NOT_ALLOWED', 'Move every screen back to the current app before turning the write-back off');
      after.writeBack = input.writeBack;
    }
    const result = { ok: true, requestId, screenOwners: after.screenOwners, writeBack: after.writeBack };
    tx.set(configRef, { mode: Object.keys(after.screenOwners).some(k => after.screenOwners[k] === 'new') ? 'live' : 'test', screenOwners: after.screenOwners, writeBack: Object.assign({}, config.writeBack || {}, { enabled: after.writeBack, changedAt: stamp, changedBy: email }) }, { merge: true });
    tx.set(logRef, { action: flipScreen ? 'switchScreen' : 'switchWriteBack', by: email, at: stamp, screen: flipScreen ? input.screen : '', before, after, result });
    return result;
  });
}

module.exports = { SCREENS, SWITCH_ROLES, SwitchError, screenMode, setSwitch, ownersOf, anyNew, writeBackOn };

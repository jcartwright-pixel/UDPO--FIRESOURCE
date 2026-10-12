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
 * Administration > Go-Live Switches (Joe 10/12) is the only place to flip it: one screen at a time, "Fully live" (the screen's
 * tag comes off the cards), or "Turn on everything that is ready". A screen moves to the new app only when logic.js GO_LIVE
 * says it is ready (its sheet writing is built and Joe OK'd it).
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
 * input: {requestId, screen, owner: 'old'|'new'}, {requestId, screen, fullyLive: true|false}, {requestId, allReady: true}
 * or {requestId, writeBack: true|false}.
 * ready: whether the server has a sandbox write-back target (WRITEBACK_JSON); the write-back cannot go on without one.
 */
async function setSwitch(db, user, input, ready, now) {
  input = input || {};
  const requestId = String(input.requestId || '');
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(requestId)) throw new SwitchError('BAD_REQUEST', 'requestId is missing');
  const has = (k) => Object.prototype.hasOwnProperty.call(input, k);
  // Go-Live Switches (Joe 10/12): move one screen, mark it fully live (its tag comes off the cards), or turn on everything
  // that is ready (the write-back and every ready screen) in one press.
  const kind = input.allReady === true ? 'allReady' : has('fullyLive') ? 'fullyLive' : has('screen') ? 'screen' : 'writeBack';
  if (kind === 'screen' || kind === 'fullyLive') {
    if (!SCREENS[input.screen]) throw new SwitchError('BAD_REQUEST', 'Unknown screen ' + String(input.screen).slice(0, 40));
    if (kind === 'screen' && input.owner !== 'old' && input.owner !== 'new') throw new SwitchError('BAD_REQUEST', 'owner must be old or new');
    if (kind === 'fullyLive' && typeof input.fullyLive !== 'boolean') throw new SwitchError('BAD_REQUEST', 'fullyLive must be true or false');
  } else if (kind === 'writeBack' && typeof input.writeBack !== 'boolean') {
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
    const fully = Object.assign({}, config.fullyLive || {});
    const before = { screenOwners: owners, writeBack: writeBackOn(config), fullyLive: Object.assign({}, fully) };
    const after = { screenOwners: Object.assign({}, owners), writeBack: before.writeBack, fullyLive: fully };
    const notReady = (screen) => { const g = L.GO_LIVE[screen]; return g && !g.ready ? SCREENS[screen] + ' is not ready for the new app: ' + g.why : ''; };
    if (kind === 'screen') {
      if (input.owner === 'new' && notReady(input.screen)) throw new SwitchError('NOT_ALLOWED', notReady(input.screen));
      if (input.owner === 'new' && !before.writeBack) throw new SwitchError('NOT_ALLOWED', 'Turn the write-back on first, so the current app sees what the new app saves');
      after.screenOwners[input.screen] = input.owner;
      if (input.owner === 'old') delete after.fullyLive[input.screen];
    } else if (kind === 'fullyLive') {
      if (input.fullyLive && owners[input.screen] !== 'new') throw new SwitchError('NOT_ALLOWED', 'Move ' + SCREENS[input.screen] + ' to the new app before marking it fully live');
      if (input.fullyLive) after.fullyLive[input.screen] = true; else delete after.fullyLive[input.screen];
    } else if (kind === 'allReady') {
      if (!before.writeBack && !ready) throw new SwitchError('NOT_ALLOWED', 'The server has no sandbox sheet to write to yet (WRITEBACK_JSON)');
      after.writeBack = true;
      Object.keys(SCREENS).forEach(k => { if (L.GO_LIVE[k] && L.GO_LIVE[k].ready) after.screenOwners[k] = 'new'; });
    } else {
      if (input.writeBack && !ready) throw new SwitchError('NOT_ALLOWED', 'The server has no sandbox sheet to write to yet (WRITEBACK_JSON)');
      if (!input.writeBack && anyNew(config)) throw new SwitchError('NOT_ALLOWED', 'Switch every screen off before turning the write-back off');
      after.writeBack = input.writeBack;
    }
    const result = { ok: true, requestId, screenOwners: after.screenOwners, writeBack: after.writeBack, fullyLive: after.fullyLive };
    tx.set(configRef, { mode: Object.keys(after.screenOwners).some(k => after.screenOwners[k] === 'new') ? 'live' : 'test', screenOwners: after.screenOwners, fullyLive: after.fullyLive, writeBack: { enabled: after.writeBack, changedAt: stamp, changedBy: email } },
      // fullyLive is written whole, so a screen moved back or unmarked loses its mark; the rest of writeBack is kept.
      { mergeFields: ['mode', 'screenOwners', 'fullyLive', 'writeBack.enabled', 'writeBack.changedAt', 'writeBack.changedBy'] });
    tx.set(logRef, { action: { screen: 'switchScreen', fullyLive: 'markFullyLive', allReady: 'turnOnAllReady', writeBack: 'switchWriteBack' }[kind], by: email, at: stamp, screen: input.screen && SCREENS[input.screen] ? input.screen : '', before, after, result });
    return result;
  });
}

module.exports = { SCREENS, SWITCH_ROLES, SwitchError, screenMode, setSwitch, ownersOf, anyNew, writeBackOn };

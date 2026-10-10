// Joe 10/10: no Record or Save buttons on the plant side. Each box saves as it is left, with the time and who entered it, and
// the boxes start empty again after the next Send Current Report, so no leftover reading goes out as if it were new.
import { collection, query, orderBy, limit, onSnapshot } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';

// The round: everything entered since the last report was sent. cb gets the time of that report ('' = none sent yet).
export function watchRound(db, cb) {
  return onSnapshot(query(collection(db, 'plantReports'), orderBy('at', 'desc'), limit(1)), s => cb(s.docs.length ? String(s.docs[0].data().at || '') : ''), () => cb(''));
}

// One record filled in box by box: the first save makes it, later saves fill in the same record (checkId). Saves go one at a
// time, in the order the boxes were left.
export function fillIn(action, save, id) {
  let chain = Promise.resolve(), checkId = id || '';
  return {
    get id() { return checkId; },
    send(fields) {
      const run = chain.then(async () => {
        const done = await save(action, Object.assign({}, fields, checkId ? { checkId } : {}));
        if (done && done.checkId) checkId = done.checkId;
        return done;
      });
      chain = run.catch(() => {});
      return run;
    }
  };
}

const at = (v) => { const t = typeof v === 'number' ? v : Date.parse(v || ''); return isFinite(t) && t ? new Date(t).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) : ''; };
export const clockOf = at;
export const savedText = () => 'Saved ' + at(Date.now());
// True when a record belongs to the round that started at roundStart.
export const inRound = (recordedAt, roundStart) => { const t = Date.parse(recordedAt || ''), r = Date.parse(roundStart || ''); return isFinite(t) && (!isFinite(r) || t > r); };

// Joe 10/10: no Record or Save buttons on the plant side. Each box saves as it is left, with the time and who entered it, and
// the boxes start empty again after the next Send Current Report, so no leftover reading goes out as if it were new.
import { collection, query, orderBy, limit, onSnapshot } from './firebase.js';
import { shortTime } from './app.js';

// The round: everything entered since the last report was sent. cb gets the time of that report ('' = none sent yet) and the report.
// Joe 10/19: a Send Test to Me report (testOnly) does not start a new round; the last report sent to the group does.
export function watchRound(db, cb) {
  return onSnapshot(query(collection(db, 'plantReports'), orderBy('at', 'desc'), limit(20)), s => {
    const d = s.docs.map(x => x.data()).find(x => !x.testOnly);
    cb(d ? String(d.at || '') : '', d || null);
  }, () => cb('', null));
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

const at = (v) => { const t = typeof v === 'number' ? v : Date.parse(v || ''); return isFinite(t) && t ? shortTime(t) : ''; };
export const clockOf = at;
export const savedText = () => 'Saved ' + at(Date.now());
// True when a record belongs to the round that started at roundStart.
export const inRound = (recordedAt, roundStart) => { const t = Date.parse(recordedAt || ''), r = Date.parse(roundStart || ''); return isFinite(t) && (!isFinite(r) || t > r); };

// Review item 77 (Joe 10/13): the one offline save queue. The drivers' phones (js/phone-queue.js) and the iPads and station
// tablets (js/offline-saves.js) used to carry two near copies of it; each now only says what is its own (where its saves are
// kept, how one is sent, what the line under the header says, and what happens to one the server will not take).
//
// A save made with no connection is kept on the device (IndexedDB, so closing the page or the device loses nothing) and sent,
// oldest first, as soon as the connection is back. Saves made while others are still waiting go behind them, so they reach the
// server in the order they were made. Each one keeps its own requestId, so one sent twice is saved only once (the server
// checks it). Review item 63: with signal, a server error ('internal') looks the same as a dropped connection; after HOLD_AFTER
// tries with signal the save is set aside (each kind says how) so the saves behind it still go.
export const HOLD_AFTER = 3;
export const serverCode = (e) => String(e && e.code || '').replace(/^functions\//, '');
export const isServerError = (e) => navigator.onLine && serverCode(e) === 'internal';
/*
 * makeQueue(kind) -> { waiting, onChange, changed, keep, flush, start }
 * kind: db / store   where the saves are kept on this device
 *       send(e)      sends one kept save (a promise)
 *       noSignal(e)  the error means no connection (as opposed to the server refusing the save)
 *       aside(e)     the save is set aside: it waits but never holds back the saves behind it
 *       skip(e, ctx) the save is not sent this time (ctx is what prepare() gave)
 *       prepare()    read once before each send round (e.g. who is signed in)
 *       order(list)  the order a send round goes in (default oldest first)
 *       tooMany(e, err, tries)  after HOLD_AFTER server errors: the fields the save is kept with (set aside)
 *       refused(e, err)         the server refused it: returns the fields to keep it with, or null to let it go
 *       roundDone(list)         after each send round
 *       draw(list, state)  the line under the header (state.sentAt: when the last round sent something)
 *       stamp(entry) fills in a new save before it is kept (e.g. who made it)
 */
export function makeQueue(kind) {
  const listeners = [];
  let flushing = false, turn = Promise.resolve();
  const state = { sentAt: 0 };

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(kind.db, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(kind.store, { keyPath: 'key', autoIncrement: true });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function run(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(kind.store, mode), store = tx.objectStore(kind.store);
      let out;
      Promise.resolve(fn(store)).then(v => { out = v; });
      tx.oncomplete = () => { db.close(); resolve(out); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }
  const all = () => run('readonly', store => new Promise(res => { const r = store.getAll(); r.onsuccess = () => res(r.result || []); }));
  const put = (entry) => run('readwrite', store => { store.put(entry); });
  const remove = (key) => run('readwrite', store => { store.delete(key); });

  // The saves still on this device, oldest first (set-aside ones too: they are never thrown away unseen).
  async function waiting() {
    const list = await all().catch(() => []);
    return list.sort((a, b) => a.key - b.key);
  }
  function onChange(fn) { listeners.push(fn); }
  async function changed() {
    const list = await waiting();
    kind.draw(list, state);
    listeners.forEach(fn => { try { fn(list); } catch (e) { /* a screen's own problem */ } });
  }

  // Send now when there is a connection and nothing waits; otherwise (or when the connection drops on the way) keep it here.
  // Each save starts in the order it was made (the check of what waits is taken in turn; the sends themselves run side by side).
  async function keep(entry, sendNow) {
    const decided = turn.then(async () => {
      if (kind.stamp) await kind.stamp(entry);
      return { sending: navigator.onLine && !(await waiting()).filter(e => !kind.aside(e)).length ? sendNow() : null };
    });
    turn = decided.catch(() => {});
    const { sending } = await decided;
    if (sending) { try { return await sending; } catch (e) { if (!kind.noSignal(e)) throw e; } }
    await put(entry);
    await changed();
    return { ok: true, queued: true };
  }

  // Send what is waiting, in order; stop at the first one that still has no connection.
  async function flush() {
    if (flushing || !navigator.onLine) return changed();
    flushing = true;
    let sent = 0;
    try {
      const ctx = kind.prepare ? await kind.prepare() : null;
      const list = await waiting();
      for (const e of kind.order ? kind.order(list) : list) {
        if (kind.skip(e, ctx)) continue;
        try { await kind.send(e); }
        catch (err) {
          if (isServerError(err)) {
            const tries = (e.tries || 0) + 1;
            if (tries < HOLD_AFTER && !e.held) { await put(Object.assign({}, e, { tries })); break; }
            await put(Object.assign({}, e, { tries }, kind.tooMany(e, err, tries)));
            continue;
          }
          if (kind.noSignal(err)) break;
          const keepAs = kind.refused(e, err);
          if (keepAs) { await put(Object.assign({}, e, keepAs)); continue; }
          await remove(e.key);
          await changed();
          continue;
        }
        sent++;
        await remove(e.key);
        await changed();
      }
      if (kind.roundDone) kind.roundDone(list);
    } finally { flushing = false; }
    if (sent) { state.sentAt = Date.now(); setTimeout(changed, 8500); }
    await changed();
  }

  // Send what waits when the connection comes back, every 20 seconds, and once just after the screen opens.
  function start(onOnline) {
    window.addEventListener('online', () => { if (onOnline) onOnline(); flush(); });
    window.addEventListener('offline', () => changed());
    setInterval(() => { if (navigator.onLine) flush(); }, 20000);
    setTimeout(flush, 1500);
    changed();
  }

  return { waiting, onChange, changed, keep, flush, start, state, forget: remove };
}

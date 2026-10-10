// Plant Distribution Departments, option A (Joe picked 10/10): the same reads and counts as before, plus what the bottom half of
// each card shows (loads by depart hour, trailers to unload first, washes waiting longest, returns by reason).
import { start, requireSignIn, showError, shortDate, escapeHtml } from './app.js';
import { collection, doc, query, where, onSnapshot } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';
import * as P from './plant-core.js';
const L = window.UDLogic;
const params = new URLSearchParams(location.search);
const date = L.isDateKey(params.get('date')) ? params.get('date') : L.operatingDay(new Date());
let NOW = new Date();
const data = { runs: [], journal: [], wash: [], appWash: [], pickups: [] };
const esc = escapeHtml;
const link = (href, label, side, alert, cls) => '<a class="dc-link' + (cls ? ' ' + cls : '') + '" href="' + href + '"><span>' + escapeHtml(label) + '</span>' + (side !== undefined ? '<b class="dc-side' + (alert ? ' alert' : '') + '">' + escapeHtml(side) + '</b>' : '') + '<i class="dc-arrow">&rarr;</i></a>';
const hm = (m) => m == null ? '-' : (m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0'));
const since = (stamp) => { const t = Date.parse(stamp || ''); return isFinite(t) ? Math.max(0, Math.round((NOW.getTime() - t) / 60000)) : null; };
const avg = (a) => a.length ? Math.round(a.reduce((t, x) => t + x, 0) / a.length) : null;
function reason(text) {
  const t = String(text || '').toLowerCase();
  if (/refus/.test(t)) return 'Refused at store';
  if (/damag|leak|crush|broke/.test(t)) return 'Damaged / leaking';
  if (/date|expir|code|old/.test(t)) return 'Out of date';
  if (/short|over|wrong|mis/.test(t)) return 'Wrong / over-ordered';
  return 'Cases back';
}

function model() {
  NOW = new Date();
  const rows = P.loadoutRows(data.runs, date), all = P.counts(rows), today = rows.filter(r => !r.prior), c = P.counts(today);
  const pu = today.flatMap(r => P.pickupsFor(r, data.pickups).map(p => Object.assign({ route: r.route }, p))), puOpen = pu.filter(P.pickupOpen);
  const load = { total: c.total + pu.length, waiting: c.waiting + puOpen.length, loading: c.loading, done: c.done + pu.length - puOpen.length };
  const returns = P.returnsFor(data.runs, date, data.journal), urows = P.unloadRows(data.runs, date, data.journal, returns, rows), uc = P.unloadCounts(urows);
  const unload = { total: uc.total, waiting: uc.waiting, unloading: uc.unloading, done: uc.complete };
  const openWash = P.washItems(date, data.wash, data.appWash, data.journal);
  const washed = data.journal.filter(d => String(d.type).toUpperCase() === 'WASHING').length;
  const pend = returns.filter(x => x.pending);
  // --- analytics ---
  const behind = rows.filter(r => P.isBehind(r, date, NOW));
  const mins = rows.filter(r => r.state === 'DONE').map(r => P.minutesTaken(r, NOW)).filter(m => m != null);
  const loadingNow = rows.filter(r => r.state === 'LOADING').map(r => ({ r, m: P.minutesTaken(r, NOW) }));
  // loads by depart hour, the loading shift's order (evening first, overnight departures, then the day)
  const hours = {};
  today.forEach(r => { if (r.dispatchTime == null) return; const h = Math.floor(r.dispatchTime / 60); (hours[h] = hours[h] || { h, done: 0, loading: 0, waiting: 0, behind: 0, pickups: 0 }); hours[h][r.state === 'DONE' ? 'done' : r.state === 'LOADING' ? 'loading' : 'waiting']++; if (P.isBehind(r, date, NOW)) hours[h].behind++; hours[h].pickups += P.pickupsFor(r, data.pickups).filter(P.pickupOpen).length; });
  const byHour = Object.values(hours).sort((a, b) => ((a.h - 18 + 24) % 24) - ((b.h - 18 + 24) % 24));
  const hourText = (h) => (h % 12 || 12) + (h < 12 ? ' AM' : ' PM');
  // today vs yesterday (same time of day)
  const yday = L.addDays(date, -1), yrows = P.loadoutRows(data.runs, yday).filter(r => !r.prior);
  const cut = NOW.getTime() - 86400000;
  const yDoneByNow = yrows.filter(r => r.completedAt && Date.parse(r.completedAt) <= cut).length;
  const yMins = yrows.map(r => P.minutesTaken(r, NOW)).filter(m => m != null && m < 600);
  const tDoneByNow = today.filter(r => r.state === 'DONE').length;
  // per area
  const areas = P.AREAS.map(a => { const ar = today.filter(r => r.area === a), ac = P.counts(ar); return { a, title: P.AREA[a].tile, color: P.AREA[a].color, total: ac.total, done: ac.done, loading: ac.loading, waiting: ac.waiting, behind: ar.filter(r => P.isBehind(r, date, NOW)).length, avg: avg(ar.filter(r => r.state === 'DONE').map(r => P.minutesTaken(r, NOW)).filter(m => m != null)) }; });
  // unloading: trailers back the longest, and which ones the next loads need
  const waitingTrailers = urows.filter(r => r.status !== 'COMPLETE').map(r => ({ r, back: r.checkedIn ? since(data.runs.find(x => x.id === r.runDocId).days[r.day].checkinCompletedAt) : null }))
    .sort((a, b) => (b.back == null ? -1 : b.back) - (a.back == null ? -1 : a.back) || a.r.nextRank - b.r.nextRank);
  const backWaiting = waitingTrailers.filter(x => x.back != null && x.r.status === 'WAITING');
  const neededNext = urows.filter(r => r.status !== 'COMPLETE' && r.nextLoad).sort((a, b) => a.nextRank - b.nextRank);
  // wash ages, returns by reason
  const washAges = openWash.map(w => ({ w, age: since(w.reported), dateOnly: /^\d{4}-\d{2}-\d{2}$/.test(String(w.reported || '')) })).sort((a, b) => (Number(b.dateOnly) - Number(a.dateOnly)) || (b.age || 0) - (a.age || 0));
  const reasons = {}; returns.forEach(x => { const k = reason(x.detail); reasons[k] = reasons[k] || { k, n: 0, cases: 0, pending: 0 }; reasons[k].n++; reasons[k].cases += Number(x.cases) || 0; if (x.pending) reasons[k].pending++; });
  const casesBack = returns.reduce((t, x) => t + (Number(x.cases) || 0), 0);
  return {
    date, rows, today, all, c, pu, puOpen, load, returns, urows, uc, unload, openWash, washed, pend,
    behind, avgLoad: avg(mins), loadingNow, byHour, hourText, yrows, yDoneByNow, tDoneByNow, yAvg: avg(yMins), areas,
    waitingTrailers, backWaiting, neededNext, washAges, reasons: Object.values(reasons).sort((a, b) => b.n - a.n), casesBack,
    oldestBack: backWaiting.length ? backWaiting[0].back : null,
    loadLinks: P.AREAS.map(a => { const ac = P.counts(today.filter(r => r.area === a)); return link('loadout.html?date=' + date + '&area=' + a, P.AREA[a].title.replace('Daily ', ''), ac.done + ' / ' + ac.total); }),
    unloadLinks: P.AREAS.map(a => { const ac = P.unloadCounts(urows.filter(r => r.area === a)); return link('unloading.html?date=' + date + '&area=' + a, ({ CASE: 'Case', TOTES: 'Tote', BOXING: 'Box', TANKER: 'Tanker' })[a] + ' Unloading', ac.complete + ' / ' + ac.total); }),
    washLinks: openWash.slice(0, 3).map(w => link('washing.html?date=' + date, (w.trailer || 'Trailer') + ' · ' + w.need)), washMain: link('washing.html?date=' + date, 'Truck Washing', openWash.length + ' open', openWash.length > 0),
    retLinks: pend.slice(0, 3).map(x => link('returns.html?date=' + date, x.route + ' · ' + x.detail, 'Pending', true)), retMain: link('returns.html?date=' + date, 'Product Returns', pend.length + ' pending', pend.length > 0),
    loadNote: c.done + ' of ' + c.total + ' loads complete' + (all.prior ? '  ·  + ' + all.prior + ' from yesterday' : ''),
    unloadNote: unload.done + ' of ' + unload.total + ' trailers unloaded',
    loadPct: c.total ? Math.round(c.done * 100 / c.total) : 0, unloadPct: unload.total ? Math.round(unload.done * 100 / unload.total) : 0
  };
}

export function run(render) {
  const go = () => { try { render(model()); } catch (e) { console.error(e); } };
  // Drawn at once with empty counts, so the page has its cards before the data arrives.
  go();
  requireSignIn(async () => {
    const { db } = await start();
    document.getElementById('today').textContent = L.dayName(date) + ' ' + shortDate(date);
    const fail = (what) => (e) => showError('Could not read ' + what + ': ' + e.message);
    const weeks = [...new Set(L.weeksForLoadDate(date).concat(L.weeksForLoadDate(L.addDays(date, -1)), L.weeksForLoadDate(L.addDays(date, -2)), [L.weekStart(date)]))];
    onSnapshot(query(collection(db, 'runs'), where('weekStart', 'in', weeks)), s => { data.runs = s.docs.map(d => Object.assign({ id: d.id }, d.data())); go(); }, fail('the loads'));
    onSnapshot(query(collection(db, 'pickups'), where('date', 'in', [L.addDays(date, -1), date, L.addDays(date, 1)])), s => { data.pickups = s.docs.map(d => d.data()); go(); }, fail('the pickups'));
    onSnapshot(query(collection(db, 'plantJournal'), where('date', '==', date)), s => { data.journal = s.docs.map(d => d.data()); go(); }, fail('the plant journal'));
    onSnapshot(collection(db, 'plantWash'), s => { data.wash = s.docs.map(d => Object.assign({}, d.data(), { _list: 'plantWash', _id: d.id })); go(); }, fail('the wash list'));
    onSnapshot(query(collection(db, 'maintenance'), where('kind', '==', 'WASH')), s => { data.appWash = s.docs.map(d => Object.assign({}, d.data(), { _list: 'maintenance', _id: d.id })); go(); }, fail('the wash requests'));
    onSnapshot(doc(db, 'config', 'app'), snap => {
      const c = snap.data() || {}, at = c.lastTransfer && c.lastTransfer.at ? new Date(c.lastTransfer.at) : null;
      document.getElementById('copied').textContent = at ? 'Last Sync: ' + at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'Waiting for the first copy';
    });
    go();
    // Behind, waiting times and the hour bars move with the clock.
    setInterval(go, 60000);
  });
}

/* ---------- option A ---------- */
const ICON = {
  load: '<svg viewBox="0 0 24 24"><path d="M2 6h11v10H2zM13 9h5l3 4v3h-8z"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/><path d="M5 9h5M5 12h5"/></svg>',
  unload: '<svg viewBox="0 0 24 24"><path d="M2 6h11v10H2zM13 9h5l3 4v3h-8z"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/><path d="M10 11H4M6 9l-2 2 2 2"/></svg>',
  wash: '<svg viewBox="0 0 24 24"><path d="M12 3s-6 7-6 11a6 6 0 0012 0c0-4-6-11-6-11z"/><path d="M9.5 15a2.5 2.5 0 002.5 2.5"/></svg>',
  ret: '<svg viewBox="0 0 24 24"><path d="M4 7h11a5 5 0 010 10H9"/><path d="M8 3L4 7l4 4"/></svg>'
};
const D = {
  load: { accent: '#1976d2', small: 'Loadout Center', title: 'Loading', href: 'loadout.html', open: 'Open Loadout Center' },
  unload: { accent: '#526d82', small: 'Trailers back from the routes', title: 'Unloading', href: 'unloading.html', open: 'Open Unloading & Washing' },
  wash: { accent: '#0093b5', small: 'Trailer washing', title: 'Washing', href: 'washing.html', open: 'Open Truck Washing' },
  ret: { accent: '#b42332', small: 'Product returns (RTA)', title: 'Returns', href: 'returns.html', open: 'Open Product Returns' }
};
// The whole card opens its screen's default view (data-card, app.js); a line inside opens that particular screen.
function card(k, inner, cls) {
  const d = D[k];
  return '<div class="card dc ' + (cls || '') + '" data-card="' + d.href + '" data-dept="' + k + '" style="--accent:' + d.accent + '"><span class="open-hint">' + d.open + ' &rarr;</span>' + inner + '</div>';
}
const head = (k) => '<div class="dc-head"><span class="dc-icon">' + ICON[k] + '</span><span class="dc-text"><small>' + D[k].small + '</small><strong>' + D[k].title + '</strong></span></div>';
const met = (em, b, small, red, n) => '<span class="dc-metric"><em>' + em + '</em><b' + (n ? ' data-n="' + n + '"' : '') + (red ? ' class="red"' : '') + '>' + b + '</b><small>' + small + '</small></span>';
function metrics(m, k) {
  if (k === 'load') return '<div class="dc-metrics n4">' + met('Today', m.load.total, 'Loads Today', false, 'load.total') + met('Waiting', m.load.waiting, 'Waiting', false, 'load.waiting') + met('Loading', m.load.loading, 'Loading', false, 'load.loading') + met('Done', m.load.done, 'Complete', false, 'load.done') + '</div>';
  if (k === 'unload') return '<div class="dc-metrics n4">' + met('Total', m.unload.total, 'Trailers', false, 'unload.total') + met('Waiting', m.unload.waiting, 'Waiting', false, 'unload.waiting') + met('Unloading', m.unload.unloading, 'Unloading', false, 'unload.unloading') + met('Done', m.unload.done, 'Complete', false, 'unload.done') + '</div>';
  if (k === 'wash') return met('Open', m.openWash.length, 'To wash', m.openWash.length > 0, 'wash.open') + met('Washed', m.washed, 'Today', false, 'wash.done');
  return met('Returns', m.returns.length, 'Today', false, 'ret.total') + met('Pending', m.pend.length, 'Not returned', m.pend.length > 0, 'ret.pending');
}
const chip = (em, b, small, bad) => '<div class="chip' + (bad ? ' bad' : '') + '"><em>' + em + '</em><b>' + b + '</b><small>' + small + '</small></div>';
const delta = (t, y, lowerBetter) => { if (y == null || t == null) return ''; const d = t - y; if (!d) return 'same as yesterday'; const good = lowerBetter ? d < 0 : d > 0; return '<span class="' + (good ? 'up' : 'down') + '">' + (d > 0 ? '▲ ' : '▼ ') + Math.abs(d) + '</span> vs yesterday'; };

function hourBars(m, tall) {
  const max = Math.max(1, ...m.byHour.map(h => h.done + h.loading + h.waiting)), H = tall || 110;
  return '<div class="hours">' + m.byHour.map(h => {
    const px = (n) => Math.round(n * H / max);
    const notBehindWaiting = h.waiting - Math.min(h.waiting, h.behind);
    const behindW = Math.min(h.waiting, h.behind);
    return '<div class="hour">' + (h.pickups ? '<span class="pu">P/U ' + h.pickups + '</span>' : '') + '<b>' + h.done + '/' + (h.done + h.loading + h.waiting) + '</b><div class="stack">' +
      '<i class="s-done" style="height:' + px(h.done) + 'px"></i><i class="s-loading" style="height:' + px(h.loading) + 'px"></i><i class="s-behind" style="height:' + px(behindW) + 'px"></i><i class="s-waiting" style="height:' + px(notBehindWaiting) + 'px"></i></div><small>' + m.hourText(h.h) + '</small></div>';
  }).join('') + '</div>';
}
const legend = '<div class="legend"><span><i class="s-done"></i>Done</span><span><i class="s-loading"></i>Loading</span><span><i class="s-behind"></i>Behind</span><span><i class="s-waiting"></i>Waiting</span><span><i style="background:var(--pickup)"></i>Pickup open</span></div>';
function trailerList(m, n) {
  const rows = m.waitingTrailers.slice(0, n);
  return '<div class="lst">' + rows.map(x => '<div class="li' + (x.back != null && x.back > 120 ? ' bad' : '') + '" data-open="unloading.html?date=' + m.date + '&area=' + x.r.area + '"><span>' + esc((x.r.trailer || x.r.truck || 'No trailer') + ' · ' + x.r.route) + (x.r.nextLoad ? ' <small style="color:var(--muted)">needed for ' + esc(x.r.nextLoad.route + ' ' + x.r.nextLoad.time) + '</small>' : '') + '</span><span class="tag">' + (x.r.status === 'UNLOADING' ? 'Unloading' : x.back != null ? 'Back ' + hm(x.back) : 'On the road') + '</span></div>').join('') + '</div>';
}
const washAge = (x) => x.dateOnly ? 'open since this morning' : x.age != null ? 'waiting ' + hm(x.age) : 'open';
function washList(m, n) {
  return '<div class="lst">' + m.washAges.slice(0, n).map(x => '<a class="li' + (x.dateOnly ? ' bad' : '') + '" href="washing.html?date=' + m.date + '"><span>' + esc((x.w.trailer || 'Trailer') + ' · ' + x.w.need) + '</span><span class="tag">' + washAge(x) + ' &rarr;</span></a>').join('') + '</div>';
}
function reasonBars(m) {
  const max = Math.max(1, ...m.reasons.map(r => r.n));
  return m.reasons.map(r => '<div class="hb"><span>' + esc(r.k) + '</span><div class="track"><i style="width:' + Math.round(r.n * 100 / max) + '%;background:#b42332"></i></div><b>' + r.n + (r.cases ? ' · ' + r.cases + 'c' : '') + '</b></div>').join('');
}
/* ---------------- A: same four cards, the empty middle filled ---------------- */
function A(m) {
  return card('load', head('load') + '<div class="dc-links two">' + m.loadLinks.join('') + '</div>' +
    '<div class="mid">' +
      '<div class="panel" style="display:flex;flex-direction:column"><div class="sec-t"><span>Loads by depart time</span><span>done / scheduled</span></div><div style="flex:1;min-height:0">' + hourBars(m, 62) + '</div>' + legend + '</div>' +
      '<div class="chips" style="grid-template-rows:repeat(3,1fr)">' + chip('Behind schedule', m.behind.length, 'not done 30 min after depart', m.behind.length > 0) + chip('Pickups open', m.puOpen.length, m.puOpen.map(p => p.route).join(', ') || 'none', m.puOpen.length > 0) + chip('Avg time per load', hm(m.avgLoad), delta(m.avgLoad, m.yAvg, true) || 'start to end') + '</div>' +
    '</div>' + metrics(m, 'load') + '<div class="dc-bar"><i style="width:' + m.loadPct + '%"></i></div><div class="dc-note">' + m.loadNote + '  ·  ' + m.tDoneByNow + ' done by now, yesterday ' + m.yDoneByNow + ' at this time</div>', 'home4') +
  card('unload', head('unload') + '<div class="dc-links two">' + m.unloadLinks.join('') + '</div>' +
    '<div class="mid">' +
      '<div class="panel"><div class="sec-t"><span>Unload first</span><span>back longest · next load needs it</span></div>' + trailerList(m, 3) + '</div>' +
      '<div class="chips" style="grid-template-rows:repeat(3,1fr)">' + chip('Back, not started', m.backWaiting.length, 'checked in, waiting', m.backWaiting.length > 0) + chip('Longest wait', hm(m.oldestBack), 'since check-in', m.oldestBack > 120) + chip('Avg time to unload', hm(m.uc.avg), 'start to end') + '</div>' +
    '</div>' + metrics(m, 'unload') + '<div class="dc-bar"><i style="width:' + m.unloadPct + '%"></i></div><div class="dc-note">' + m.unloadNote + '</div>', 'home4') +
  card('wash', head('wash') + '<div class="dc-links two">' + m.washLinks.concat([m.washMain]).join('') + '</div>' +
    '<div class="mid">' +
      '<div class="panel"><div class="sec-t"><span>Waiting longest to be washed</span><span>oldest first</span></div>' + washList(m, 4) + '</div>' +
      '<div class="chips" style="grid-template-rows:repeat(2,1fr)">' + chip('Oldest open', m.washAges.length ? esc(m.washAges[0].w.trailer) : 'none', m.washAges.length ? washAge(m.washAges[0]) : '', m.washAges.length && m.washAges[0].dateOnly) + chip('After unloading', m.openWash.filter(w => w.kind === 'UNLOAD').length, 'trailers back, need a wash') + '</div>' +
    '</div><div class="dc-metrics n4">' + metrics(m, 'wash') + met('Requests', m.openWash.filter(w => w.kind === 'REQUEST').length, 'Asked for') + met('Unloads', m.openWash.filter(w => w.kind === 'UNLOAD').length, 'Need a wash') + '</div>', 'home4') +
  card('ret', head('ret') + '<div class="dc-links two">' + m.retLinks.concat([m.retMain]).join('') + '</div>' +
    '<div class="mid">' +
      '<div class="panel"><div class="sec-t"><span>Returns by reason</span><span>count · cases</span></div>' + reasonBars(m) + '</div>' +
      '<div class="chips" style="grid-template-rows:repeat(2,1fr)">' + chip('Cases back', m.casesBack, 'all returns today') + chip('Not in the cooler yet', m.pend.length, 'pending RTA', m.pend.length > 0) + '</div>' +
    '</div><div class="dc-metrics n4">' + metrics(m, 'ret') + met('Cases', m.casesBack, 'Back today') + met('Routes', new Set(m.returns.map(x => x.route)).size, 'With returns') + '</div>', 'home4');
}


export function draw(el) { run(m => { el.innerHTML = A(m); }); }

// One machine's page on Plant Production (Joe 10/26: "one screen ... the same for all the machines ... what the machine is doing at
// this time and the history from the time it's running"). Mock-ups 1, 2 and 3 (production.html?line=...&look=1|2|3) share the
// pieces worked out here: what is running now, and the machine's history since it started running, which reaches back into the
// shift before when the machine ran on through the shift change.
import { escapeHtml, shortDate } from './app.js';
import { fmt } from './production.js';

const R = () => window.UDProduction;
const when = (x) => { const n = Date.parse(x || ''); return isFinite(n) ? n : 0; };
const clockOf = (ms) => ms ? new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
const hourOf = (ms) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric' });
const who = (email) => String(email || '').split('@')[0];
const longFor = (min) => { min = Math.max(0, Math.round(min)); const h = Math.floor(min / 60), m = min % 60; return h ? h + ' h ' + m + ' min' : m + ' min'; };
const sg = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n));
const GAP = 30 * 60000;
const dayOf = (ms) => { const d = new Date(ms); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

// The machine since it started running: the product runs (one line for each product, carried across the shift change), every
// stop, changeover, CIP wash and fill weight check, and the minute-by-minute pieces for the timeline.
export function machineHistory(v, nowMs) {
  const byName = {};
  (v.targets || []).forEach(t => { byName[String(t.name).toUpperCase()] = t; });
  const docs = [v.prevRun, v.run].filter(d => d && (d.runs || []).length).sort((a, b) => when(a.shiftStart) - when(b.shiftStart));
  let pieces = [];
  docs.forEach(d => {
    const runs = (d.runs || []).slice().sort((a, b) => when(a.from) - when(b.from)), end = Math.min(nowMs, when(d.shiftEnd) || nowMs);
    runs.forEach((x, i) => {
      const a = when(x.from), b = i + 1 < runs.length ? when(runs[i + 1].from) : end, t = byName[String(x.product || '').toUpperCase()];
      if (!(b > a)) return;
      const stops = (d.stops || []).filter(s => !/break|lunch/i.test(s.reason || ''));
      const stopMin = stops.reduce((n, s) => n + Math.max(0, Math.min(s.end ? when(s.end) : nowMs, b) - Math.max(when(s.start), a)), 0) / 60000;
      pieces.push({ product: String(x.product || ''), from: a, to: b, made: Math.max(0, R().countAt(d.counts, b) - R().countAt(d.counts, a)), target: t ? t.perHour * (b - a) / 3600000 : 0, stopMin, doc: d });
    });
  });
  // The shift before only counts when the machine ran on into this shift (its last run ends close to this shift's first).
  const cur = pieces.filter(p => p.doc === v.run), before = pieces.filter(p => p.doc !== v.run);
  if (cur.length && before.length && cur[0].from - before[before.length - 1].to > GAP) pieces = cur;
  // One line for each product: the same product on both sides of the shift change is one run.
  const merged = [];
  pieces.forEach(p => {
    const last = merged[merged.length - 1];
    if (last && last.product.toUpperCase() === p.product.toUpperCase() && p.from - last.to <= GAP) Object.assign(last, { to: p.to, made: last.made + p.made, target: last.target + p.target, stopMin: last.stopMin + p.stopMin, docs: last.docs.concat(p.doc) });
    else merged.push(Object.assign({}, p, { docs: [p.doc] }));
  });
  merged.forEach(p => { p.target = Math.round(p.target); p.stopMin = Math.round(p.stopMin); p.pct = p.target ? Math.round(p.made / p.target * 100) : null; });
  const used = docs.filter(d => merged.some(p => p.docs.indexOf(d) >= 0)), start = merged.length ? merged[0].from : 0;
  const events = [], stops = [], changeovers = [], cips = [], fills = [], waste = {};
  used.forEach(d => {
    (d.stops || []).forEach(s => { const a = when(s.start), b = s.end ? when(s.end) : nowMs; if (b < start) return; const o = { at: a, end: s.end ? b : 0, min: Math.round((b - a) / 60000), reason: s.reason || '', by: s.reasonBy || s.by || '', brk: /break|lunch/i.test(s.reason || '') }; stops.push(o); events.push(Object.assign({ kind: o.brk ? 'brk' : 'stop' }, o)); });
    (d.changeovers || []).forEach(c => { const a = when(c.start), b = c.end ? when(c.end) : nowMs; if (b < start) return; const o = { at: a, end: c.end ? b : 0, min: Math.round((b - a) / 60000), from: c.from || '', to: c.to || '' }; changeovers.push(o); events.push(Object.assign({ kind: 'co' }, o)); });
    (d.cips || []).forEach(c => { const a = when(c.start), b = c.end ? when(c.end) : nowMs; if (b < start) return; const o = { at: a, end: c.end ? b : 0, min: Math.round((b - a) / 60000), result: c.result || '' }; cips.push(o); events.push(Object.assign({ kind: 'cip' }, o)); });
    (d.fills || []).forEach(f => { const x = R().fillOf(f), a = when(x.at); if (a < start) return; fills.push(x); events.push({ kind: 'fill', at: a, f: x }); });
    Object.keys(d.waste || {}).forEach(k => { waste[k] = (waste[k] || 0) + (Number(d.waste[k]) || 0); });
  });
  merged.forEach((p, i) => events.push({ kind: 'start', at: p.from, product: p.product, first: i === 0 }));
  events.sort((a, b) => b.at - a.at);
  // The timeline: each shift's pieces from the history's start, with the time between shifts left out.
  const segs = [];
  used.forEach(d => R().timeline(d, nowMs).forEach(x => {
    const a = when(x.from), b = a + x.minutes * 60000;
    if (b <= start) return;
    const from = Math.max(a, start), kind = x.kind === 'idle' ? 'off' : x.kind;
    if (kind === 'left' && d !== v.run) return;
    segs.push({ kind, from, minutes: (b - from) / 60000 });
  }));
  // Made and target added up from the start, every 10 minutes, for the chart.
  const pts = [], endAt = Math.min(nowMs, used.length ? when(used[used.length - 1].shiftEnd) || nowMs : nowMs);
  if (start) for (let x = start; ; x = Math.min(endAt, x + 600000)) {
    let made = 0, target = 0;
    used.forEach(d => { const a = Math.max(start, when(d.shiftStart)); if (x > a) made += Math.max(0, R().countAt(d.counts, Math.min(x, when(d.shiftEnd))) - R().countAt(d.counts, a)); });
    merged.forEach(p => { const b = Math.min(p.to, x); if (b > p.from) target += p.target * (b - p.from) / Math.max(1, p.to - p.from); });
    pts.push({ at: x, made, target: Math.round(target) });
    if (x >= endAt) break;
  }
  const total = merged.reduce((o, p) => ({ made: o.made + p.made, target: o.target + p.target, stopMin: o.stopMin + p.stopMin }), { made: 0, target: 0, stopMin: 0 });
  total.pct = total.target ? Math.round(total.made / total.target * 100) : null;
  return { start, end: endAt, runs: merged, now: merged.length ? merged[merged.length - 1] : null, events, stops, changeovers, cips, fills, waste, segs, pts, total,
    lastNight: used.length > 1 || (used[0] && used[0] !== v.run), prevName: v.prevShift ? v.prevShift.name : '' };
}

// The word for when: "9:38 AM", or "11:10 PM last night" for a time before today.
function whenWords(ms, nowMs) {
  const d = new Date(ms), n = new Date(nowMs);
  return clockOf(ms) + (d.toDateString() === n.toDateString() ? '' : d.getHours() >= 12 ? ' last night' : ' ' + shortDate(dayOf(ms)));
}
const STATE = (v) => v.state === 'IDLE' ? ['Not started', 'x'] : v.state === 'STOPPED' ? ['Stopped ' + v.stoppedMin + ' min', 'r'] : v.state === 'CHANGEOVER' ? ['Changeover ' + v.changeover.minutes + ' min', 'b'] : v.state === 'CIP' ? ['CIP wash ' + v.cip.minutes + ' min', 'b'] : v.kind === 'HTST' && v.diverting ? ['In divert', 'r'] : ['Running', 'g'];
const NAMES = { run: 'Running', stop: 'Stopped', co: 'Changeover', cip: 'CIP wash', brk: 'Break', off: 'Not running', left: 'Still to come' };
const pctClass = (p) => p === null ? '' : p >= 100 ? 'g' : p >= 90 ? 'a' : 'r';

// The timeline since it started running, with the hours under it.
function timelineHtml(h, nowMs) {
  if (!h.segs.length) return '<p class="pd-none">Nothing has run on this machine yet.</p>';
  const total = h.segs.reduce((n, x) => n + x.minutes, 0) || 1, first = h.segs[0].from, span = total * 60000;
  // The hours along the bottom: every hour, or every 2 hours on a long history.
  const step = span > 12 * 3600000 ? 7200000 : 3600000, ticks = [];
  let off = 0;
  h.segs.forEach(x => { const a = x.from, b = x.from + x.minutes * 60000; for (let t = Math.ceil(a / step) * step; t < b; t += step) ticks.push('<span style="left:' + ((off + (t - a) / 60000) / total * 100) + '%">' + hourOf(t) + '</span>'); off += x.minutes; });
  return '<div class="pd-tl pm-tl">' + h.segs.map(x => '<i class="' + x.kind + '" style="width:' + (x.minutes / total * 100) + '%" title="' + NAMES[x.kind] + ' ' + clockOf(x.from) + '"></i>').join('') + '</div>' +
    '<div class="pd-ticks">' + ticks.join('') + '</div>' +
    '<div class="pd-key">' + ['run', 'stop', 'co', 'cip', 'brk'].map(k => '<span><i class="' + k + '"></i>' + NAMES[k] + '</span>').join('') + '</div>';
}
// Made against target added up since it started running (a line chart).
function chartHtml(h) {
  if (h.pts.length < 2) return '<p class="pd-none">The chart starts after the first counts.</p>';
  const a = h.pts[0].at, b = h.pts[h.pts.length - 1].at, top = Math.max(1, ...h.pts.map(p => Math.max(p.made, p.target))) * 1.08;
  const X = (t) => ((t - a) / Math.max(1, b - a) * 1000).toFixed(1), Y = (n) => (300 - n / top * 300).toFixed(1);
  const line = (k) => h.pts.map((p, i) => (i ? 'L' : 'M') + X(p.at) + ' ' + Y(p[k])).join(' ');
  const step = b - a > 12 * 3600000 ? 7200000 : 3600000, ticks = [];
  for (let t = Math.ceil(a / step) * step; t <= b; t += step) ticks.push('<span style="left:' + ((t - a) / (b - a) * 100) + '%">' + hourOf(t) + '</span>');
  const grid = [0.25, 0.5, 0.75, 1].map(f => Math.round(top * f / 1000) * 1000).filter((n, i, l) => n && l.indexOf(n) === i);
  // Where each product started, marked on the chart.
  const marks = h.runs.slice(1).map(p => '<line x1="' + X(p.from) + '" x2="' + X(p.from) + '" y1="0" y2="300" class="pm-ch-mark"/>').join('');
  return '<div class="pm-chart"><div class="pm-ch-y">' + grid.map(n => '<span style="bottom:' + (n / top * 100) + '%">' + fmt(n) + '</span>').join('') + '</div>' +
    '<div class="pm-ch-plot"><svg viewBox="0 0 1000 300" preserveAspectRatio="none" aria-label="Made against target">' +
    grid.map(n => '<line x1="0" x2="1000" y1="' + Y(n) + '" y2="' + Y(n) + '" class="pm-ch-grid"/>').join('') + marks +
    '<path d="' + line('target') + '" class="pm-ch-target"/><path d="' + line('made') + '" class="pm-ch-made"/></svg>' +
    '<div class="pd-ticks">' + ticks.join('') + '</div></div></div>' +
    '<div class="pd-key"><span><i class="pm-k-made"></i>Made</span><span><i class="pm-k-target"></i>Target</span><span><i class="pm-k-mark"></i>Product change</span></div>';
}
// Made each hour since it started running (bars), the hour's product under each bar.
function barsHtml(h, nowMs) {
  if (!h.start) return '<p class="pd-none">Nothing has run on this machine yet.</p>';
  const hours = [];
  for (let a = Math.floor(h.start / 3600000) * 3600000; a < h.end; a += 3600000) {
    const b = Math.min(a + 3600000, h.end);
    let made = 0, target = 0, stop = 0;
    const p = h.pts.filter(x => x.at >= a && x.at <= b);
    if (p.length) { const before = h.pts.filter(x => x.at <= a).pop() || h.pts[0]; made = p[p.length - 1].made - before.made; target = p[p.length - 1].target - before.target; }
    h.stops.filter(s => !s.brk).forEach(s => { stop += Math.max(0, Math.min(s.end || nowMs, b) - Math.max(s.at, a)) / 60000; });
    const prod = h.runs.filter(r => r.from < b && r.to > a).map(r => r.product);
    hours.push({ a, made, target, stop: Math.round(stop), prod, now: b === h.end && b < a + 3600000 });
  }
  const top = Math.max(1, ...hours.map(x => Math.max(x.made, x.target)));
  const prods = h.runs.map(r => r.product).filter((p, i, l) => l.indexOf(p) === i);
  return '<div class="pm-bars">' + hours.map(x => {
    const pct = x.target ? Math.round(x.made / x.target * 100) : null, cls = x.now ? 'now' : pctClass(pct);
    return '<div class="pm-bar"><b>' + fmt(x.made) + '</b><div class="pm-bar-in"><i class="' + cls + '" style="height:' + (x.made / top * 100) + '%"></i>' +
      (x.target ? '<s style="bottom:' + (x.target / top * 100) + '%"></s>' : '') + '</div><span>' + hourOf(x.a) + '</span>' +
      '<small class="p' + prods.indexOf(x.prod[x.prod.length - 1]) % 3 + '">' + (x.prod.length > 1 ? 'Change' : '') + '</small>' + (x.stop ? '<em>' + x.stop + ' min stopped</em>' : '<em></em>') + '</div>';
  }).join('') + '</div><div class="pd-key"><span><i class="pm-k-made"></i>Made in the hour (green at or over target, yellow up to 10% under, red more)</span><span><i class="pm-k-target"></i>Target</span></div>';
}
// The product runs since it started running: one line for each product.
function runsTable(h, nowMs) {
  if (!h.runs.length) return '<p class="pd-none">Nothing has run on this machine yet.</p>';
  return '<table class="pd-t pm-t"><thead><tr><th class="w">Product</th><th>Started</th><th>Ended</th><th class="n">Ran</th><th class="n">Made</th><th class="n">Target</th><th class="n">%</th><th class="n">Stopped</th></tr></thead><tbody>' +
    h.runs.slice().reverse().map(p => { const on = p === h.now && p.to >= nowMs - 60000; return '<tr' + (on ? ' class="pm-on"' : '') + '><td class="w no-fit"><b>' + escapeHtml(p.product) + '</b></td><td>' + whenWords(p.from, nowMs) + '</td><td>' + (on ? '<b>Running now</b>' : clockOf(p.to)) + '</td><td class="n">' + longFor((p.to - p.from) / 60000) + '</td>' +
      '<td class="n"><b>' + fmt(p.made) + '</b></td><td class="n">' + fmt(p.target) + '</td><td class="n"><b class="pm-' + pctClass(p.pct) + '">' + (p.pct === null ? '–' : p.pct + '%') + '</b></td><td class="n">' + p.stopMin + ' min</td></tr>'; }).join('') +
    (h.runs.length > 1 ? '<tr class="pm-sum"><td class="w no-fit"><b>Since it started running</b></td><td>' + whenWords(h.start, nowMs) + '</td><td></td><td class="n">' + longFor((h.end - h.start) / 60000) + '</td><td class="n"><b>' + fmt(h.total.made) + '</b></td><td class="n">' + fmt(h.total.target) + '</td><td class="n"><b class="pm-' + pctClass(h.total.pct) + '">' + (h.total.pct === null ? '–' : h.total.pct + '%') + '</b></td><td class="n">' + h.total.stopMin + ' min</td></tr>' : '') +
    '</tbody></table>';
}
// What happened since it started running, newest first.
function feedHtml(h, nowMs, fw) {
  const line = (e) => {
    if (e.kind === 'start') return ['g', e.first ? 'Started running <b>' + escapeHtml(e.product) + '</b>' : 'Now running <b>' + escapeHtml(e.product) + '</b>'];
    if (e.kind === 'stop') return ['r', 'Stopped <b>' + (e.end ? e.min + ' min' : e.min + ' min so far') + '</b> · ' + (e.reason ? escapeHtml(e.reason) : '<b class="pm-r">No reason yet</b>')];
    if (e.kind === 'brk') return ['x', escapeHtml(e.reason || 'Break') + ' ' + e.min + ' min'];
    if (e.kind === 'co') return ['b', 'Changeover <b>' + e.min + ' min</b> · ' + escapeHtml(e.from || '—') + ' to ' + escapeHtml(e.to || '—')];
    if (e.kind === 'cip') return ['p', 'CIP wash <b>' + e.min + ' min</b>' + (e.result === 'FAIL' ? ' · <b class="pm-r">Failed</b>' : e.result ? ' · Passed' : '')];
    const f = e.f;
    return [f.flag ? 'r' : 'g', 'Fill weight check · ' + (f.avgNet === null ? 'not finished' : f.diff === null ? fmt(f.avgNet) + ' g average' : '<b' + (f.flag ? ' class="pm-r"' : '') + '>' + sg(f.diff) + ' g ' + (f.diff >= 0 ? 'over' : 'under') + '</b> target' + (f.flag ? ' · ' + (f.light ? f.light + ' LIGHT' : f.heavy + ' HEAVY') : '')) + ' · ' + escapeHtml(who(f.by))];
  };
  return h.events.length ? '<ol class="pm-feed">' + h.events.map(e => { const [c, words] = line(e); return '<li><time>' + whenWords(e.at, nowMs) + '</time><i class="' + c + '"></i><span>' + words + '</span></li>'; }).join('') + '</ol>' : '<p class="pd-none">Nothing yet.</p>';
}
// The fill weight checks, wide enough to read: one line for each check.
function fillTable(v, h) {
  const fl = v.fill;
  if (!fl) return '';
  const fw = fl.words || { One: 'Jug', many: 'jugs' };
  const rows = h.fills.slice().reverse().map(c => '<tr><td>' + clockOf(when(c.at)) + '</td><td class="w no-fit">' + escapeHtml(c.product || '—') + '</td><td class="n">' + c.filled + ' of ' + R().FILL_JUGS + '</td><td class="n">' + (c.avgNet === null ? '—' : fmt(c.avgNet) + ' g') + '</td>' +
    '<td class="n">' + (c.diff === null ? 'Set target' : '<b class="' + (c.flag ? 'pm-r' : 'pm-g') + '">' + sg(c.diff) + ' g' + (c.flag ? ' ' + c.flag : '') + '</b>') + '</td><td>' + escapeHtml(who(c.by)) + '</td></tr>');
  const tot = fl.totals;
  return '<section class="pd-box pm-box"><h3>Fill weight checks</h3>' + (rows.length ? '<table class="pd-t pm-t"><thead><tr><th>Time</th><th class="w">Product</th><th class="n">' + fw.One + 's</th><th class="n">Average product</th><th class="n">Against target</th><th>Who</th></tr></thead><tbody>' + rows.join('') + '</tbody></table>' : '<p class="pd-none">No fill weight checks yet.</p>') +
    (tot.checks && tot.avgDiff !== null ? '<p class="pm-line">This shift: average <b>' + sg(tot.avgDiff) + ' g</b> ' + (tot.avgDiff >= 0 ? 'over' : 'under') + ' target · giveaway <b>' + fmt(tot.giveawayLb) + ' lb</b> on ' + fmt(v.made) + ' ' + fw.many + '</p>' : '') +
    '<p class="pd-none">' + escapeHtml(dueWords(fl.due, fw.many)) + '</p></section>';
}
function dueWords(d, many) {
  if (!d || d.why === 'product') return 'The fill weight check starts when a product is running.';
  if (d.due) return 'A fill weight check is due now.';
  return d.nextAt ? 'Next fill weight check due ' + clockOf(when(d.nextAt)) + '.' : d.jugsLeft !== null ? 'Next fill weight check in ' + fmt(d.jugsLeft) + ' ' + many + '.' : 'Next fill weight check at the next product change.';
}
// The sensors in one line (Joe 10/24: every machine will have them): what each reads, or Waiting for sensor.
function sensorsHtml(v) {
  const m = v.machine, auto = v.counter && v.counter !== 'TABLET', wait = '<b class="pm-wait">Waiting for sensor</b>';
  const items = [['Count', auto ? '<b>' + fmt(v.made) + '</b>' : wait + ' <small>typed on the tablet</small>'], ['Speed', m && m.speed !== null ? '<b>' + fmt(m.speed) + '</b>' : wait + (v.speed !== null ? ' <small>worked out from the counts</small>' : '')],
    [v.kind === 'BLOWMOLD' ? 'Annealer temp' : 'Temperature', m && m.temp !== null ? '<b>' + fmt(m.temp) + '°F</b>' : wait], ['Running or stopped', m && m.running !== null ? (m.running ? '<b class="pm-g">Running</b>' : '<b class="pm-r">Stopped</b>') : wait]];
  if (v.kind === 'FILLER') items.push(['Label reader', v.reader ? (v.reader.dateOk === false ? '<b class="pm-r">Wrong date</b>' : '<b class="pm-g">Reading</b>') : wait]);
  return '<div class="pm-sensors"><span class="pm-sh">Sensors</span>' + items.map(x => '<span><small>' + x[0] + '</small> ' + x[1] + '</span>').join('') + '</div>';
}
function buttons(v) {
  return '<a class="lt-top" href="line.html?line=' + encodeURIComponent(v.line.operationId) + '">Line Tablet</a><a class="lt-top" href="linetargets.html?line=' + encodeURIComponent(v.line.operationId) + '">Targets and Sensors</a>';
}
// The rest of the machine's page, kept from the shift page: stops, waste, changeovers, CIP, quality checks, crew and notes, and
// the efficiency for managers. Each since it started running.
function restParts(v, h, nowMs, more) {
  const box = (title, inner, cls) => '<section class="pd-box pm-box' + (cls ? ' ' + cls : '') + '"><h3>' + title + '</h3>' + inner + '</section>';
  const tbl = (heads, rows, empty) => rows.length ? '<table class="pd-t pm-t"><thead><tr>' + heads.map(x => '<th' + (x[1] ? ' class="' + x[1] + '"' : '') + '>' + x[0] + '</th>').join('') + '</tr></thead><tbody>' + rows.map(r => '<tr>' + r.map((c, i) => '<td' + (heads[i][1] ? ' class="' + heads[i][1] + (heads[i][1] === 'w' ? ' no-fit' : '') + '"' : '') + '>' + c + '</td>').join('') + '</tr>').join('') + '</tbody></table>' : '<p class="pd-none">' + empty + '</p>';
  const stops = box('Stops and why', tbl([['From'], ['Min', 'n'], ['Why', 'w'], ['Who']], h.stops.slice().reverse().map(s => [whenWords(s.at, nowMs), s.end ? s.min : s.min + ' so far', s.reason ? escapeHtml(s.reason) : '<b class="pm-r">No reason yet</b>', escapeHtml(who(s.by))]), 'No stops.'));
  const wk = Object.keys(h.waste);
  const waste = box('Waste and rejects', tbl([['Why', 'w'], ['How many', 'n']], wk.map(k => [escapeHtml(k), fmt(h.waste[k])]), 'No waste entered.'));
  const cos = box('Changeovers', tbl([['From and to', 'w'], ['Started'], ['Min', 'n'], ['Standard', 'n']], h.changeovers.slice().reverse().map(c => [escapeHtml(c.from || '—') + '<br>to ' + escapeHtml(c.to || '—'), clockOf(c.at), c.end ? c.min : c.min + ' so far', v.changeoverStd === null ? '–' : v.changeoverStd]), 'No changeovers.'));
  const cip = box('CIP washes', tbl([['Started'], ['Done'], ['Min', 'n'], ['Result']], h.cips.map(c => [clockOf(c.at), c.end ? clockOf(c.end) : 'washing', c.min, c.result === 'FAIL' ? '<b class="pm-r">Failed</b>' : c.result ? 'Passed' : '']),
    v.lastCipAt ? 'Last one that passed: ' + shortDate(dayOf(when(v.lastCipAt))) + ' ' + clockOf(when(v.lastCipAt)) + (v.cipHours && v.sinceCipHours !== null ? ' (' + v.sinceCipHours + ' of ' + v.cipHours + ' hours)' : '') + '.' : 'None yet.'));
  const crew = v.crew.length ? v.crew.map(c => escapeHtml(c.name) + (c.on ? '' : ' (off)')).join(', ') : 'No one signed on.';
  const notes = box('Crew and notes', '<p><b>Crew:</b> ' + crew + '</p>' + (v.prevNote ? '<p><b>From last shift' + (v.prevNoteBy ? ' (' + escapeHtml(who(v.prevNoteBy)) + ')' : '') + ':</b> ' + escapeHtml(v.prevNote) + '</p>' : '') +
    '<p><b>For the next shift:</b> ' + (v.note ? escapeHtml(v.note) : 'no note yet') + '</p>' + (v.next ? '<p><b>Up next:</b> ' + escapeHtml(v.next.product) + (v.next.qty ? ' · ' + fmt(v.next.qty) : '') + '</p>' : ''));
  const eff = v.efficiency, effBox = more.manager ? box('How the shift is going', eff ? '<p class="pm-line">Running <b>' + (eff.running === null ? '—' : eff.running + '%') + '</b> of the time · at speed <b>' + (eff.speed === null ? '—' : eff.speed + '%') + '</b> · good <b>' + (eff.good === null ? '—' : eff.good + '%') + '</b></p><p class="pd-oee">Line efficiency ' + (eff.oee === null ? '—' : eff.oee + '%') + '</p>' : '<p class="pd-none">Starts with the shift\'s first product.</p>') : '';
  return { fill: fillTable(v, h), stops, waste, cos, cip, notes, effBox, quality: more.quality };
}
function restHtml(v, h, nowMs, more) {
  const r = restParts(v, h, nowMs, more);
  return r.fill + '<div class="pm-two"><div class="pd-col">' + r.stops + r.waste + '</div><div class="pd-col">' + r.effBox + r.cos + r.cip + r.notes + '</div></div>' + r.quality;
}

// The numbers for what is running now: made on this product, its target, %, speed and the last fill weight check.
function nowNumbers(v, h) {
  const p = h.now, tg = v.target, range = tg && (tg.minSpeed !== null || tg.maxSpeed !== null) ? (tg.minSpeed !== null ? tg.minSpeed : 0) + (tg.maxSpeed !== null ? ' to ' + tg.maxSpeed : '+') : '';
  const off = v.speedFlag === 'OVER' || v.speedFlag === 'UNDER', last = h.fills.length ? h.fills[h.fills.length - 1] : null;
  return {
    made: p ? p.made : 0, target: p ? p.target : 0, pct: p ? p.pct : null, range, off,
    speed: v.state === 'RUNNING' && v.speed !== null ? v.speed : null,
    fill: last && last.diff !== null ? { words: sg(last.diff) + ' g', cls: last.flag ? 'r' : 'g', at: clockOf(when(last.at)), flag: last.flag } : null
  };
}
function headline(v, h, nowMs) {
  const [word, c] = STATE(v), p = h.now;
  return { word, c, product: v.product || (p ? p.product : '') || (v.state === 'IDLE' ? 'Nothing running' : 'No product picked'),
    since: p ? 'On this product since ' + whenWords(p.from, nowMs) + ' · ' + longFor((nowMs - p.from) / 60000) : 'Nothing entered yet',
    started: h.start ? 'Running since ' + whenWords(h.start, nowMs) + (h.lastNight && h.prevName ? ' (' + escapeHtml(h.prevName) + ')' : '') : '' };
}

// Mock-up 1: what is running now across the top in big numbers, then the history since it started running as a chart, the
// timeline and one line for each product run.
function look1(v, h, nowMs, more) {
  const hd = headline(v, h, nowMs), n = nowNumbers(v, h);
  const tile = (label, value, note, cls) => '<div class="pm-tile' + (cls ? ' ' + cls : '') + '"><span>' + label + '</span><b>' + value + '</b>' + (note ? '<small>' + note + '</small>' : '') + '</div>';
  return '<section class="pm-now pm-c-' + hd.c + '"><div class="pm-now-h"><span class="pm-pill ' + hd.c + '">' + escapeHtml(hd.word) + '</span><div class="pm-prod">' + escapeHtml(hd.product) + '</div><div class="pm-btns">' + buttons(v) + '</div></div>' +
    '<div class="pm-since">' + hd.since + '</div>' +
    '<div class="pm-tiles">' + tile('Made on this product', fmt(n.made)) + tile('Target so far', fmt(n.target)) + tile('Against target', n.pct === null ? '–' : n.pct + '%', '', 'pm-' + pctClass(n.pct)) +
    tile('Speed a minute', n.speed === null ? '–' : fmt(n.speed), n.range ? 'Range ' + n.range : '', n.off ? 'pm-r pm-flash' : '') + (v.fill ? tile('Last fill weight', n.fill ? n.fill.words : '–', n.fill ? 'at ' + n.fill.at + (n.fill.flag ? ' · ' + n.fill.flag : '') : 'No check yet', n.fill ? 'pm-' + n.fill.cls : '') : '') + '</div>' + sensorsHtml(v) + '</section>' +
    '<section class="pd-box pm-box"><div class="pm-box-h"><h3>Since it started running</h3><span>' + hd.started + ' · made <b>' + fmt(h.total.made) + '</b> of <b>' + fmt(h.total.target) + '</b> target' + (h.total.pct === null ? '' : ' (<b class="pm-' + pctClass(h.total.pct) + '">' + h.total.pct + '%</b>)') + ' · stopped <b>' + h.total.stopMin + ' min</b></span></div>' +
    chartHtml(h) + '<h4>Running, stopped and changeovers</h4>' + timelineHtml(h, nowMs) + '<h4>Each product</h4>' + runsTable(h, nowMs) + '</section>' + restHtml(v, h, nowMs, more);
}
// Mock-up 2: what is running now in a big panel on the left; what happened since it started running, newest first, on the right.
function look2(v, h, nowMs, more) {
  const hd = headline(v, h, nowMs), n = nowNumbers(v, h), w = n.target ? Math.min(100, n.made / n.target * 100) : 0;
  const row = (label, value, cls) => '<div class="pm-row"><span>' + label + '</span><b class="' + (cls || '') + '">' + value + '</b></div>';
  const left = '<section class="pm-now pm-panel pm-c-' + hd.c + '"><span class="pm-pill ' + hd.c + '">' + escapeHtml(hd.word) + '</span><div class="pm-prod">' + escapeHtml(hd.product) + '</div><div class="pm-since">' + hd.since + '</div>' +
    '<div class="pm-big"><b>' + fmt(n.made) + '</b><span>made of ' + fmt(n.target) + ' target</span></div><div class="lb-bar"><i class="c-' + (pctClass(n.pct) || 'g') + '" style="width:' + w + '%"></i></div>' +
    row('Against target', n.pct === null ? '–' : n.pct + '%', 'pm-' + pctClass(n.pct)) + row('Speed a minute', (n.speed === null ? '–' : fmt(n.speed)) + (n.range ? ' <small>(' + n.range + ')</small>' : ''), n.off ? 'pm-r' : '') +
    (v.fill ? row('Last fill weight', n.fill ? n.fill.words + ' <small>at ' + n.fill.at + '</small>' : 'No check yet', n.fill ? 'pm-' + n.fill.cls : '') + row('Next fill weight check', escapeHtml(dueWords(v.fill.due, (v.fill.words || {}).many || 'jugs').replace(/^Next fill weight check (due )?/, '').replace(/\.$/, ''))) : '') +
    row('Stopped today', h.total.stopMin + ' min') + (v.next ? row('Up next', escapeHtml(v.next.product)) : '') + row('Crew', v.crewOn.length ? escapeHtml(v.crewOn.join(', ')) : 'No one signed on') +
    '<div class="pm-btns">' + buttons(v) + '</div>' + sensorsHtml(v) + '</section>';
  const right = '<section class="pd-box pm-box pm-panel"><div class="pm-box-h"><h3>Since it started running</h3><span>' + hd.started + '</span></div>' +
    '<div class="pm-mini"><div><span>Made</span><b>' + fmt(h.total.made) + '</b></div><div><span>Target</span><b>' + fmt(h.total.target) + '</b></div><div><span>Against target</span><b class="pm-' + pctClass(h.total.pct) + '">' + (h.total.pct === null ? '–' : h.total.pct + '%') + '</b></div><div><span>Stopped</span><b>' + h.total.stopMin + ' min</b></div></div>' +
    '<h4>What happened, newest first</h4>' + feedHtml(h, nowMs) + '</section>';
  return '<div class="pm-split2">' + left + right + '</div><section class="pd-box pm-box"><h3>Running, stopped and changeovers since it started</h3>' + timelineHtml(h, nowMs) + '<h4>Each product</h4>' + runsTable(h, nowMs) + '</section>' + restHtml(v, h, nowMs, more);
}
// Mock-up 3: one big colored band like the TV (green running, red stopped, blue changeover or CIP), then made each hour since it
// started running as bars, and one line for each product run.
function look3(v, h, nowMs, more) {
  const hd = headline(v, h, nowMs), n = nowNumbers(v, h);
  const num = (label, value, note) => '<div><b>' + value + '</b><span>' + label + '</span>' + (note ? '<small>' + note + '</small>' : '') + '</div>';
  return '<section class="pm-band pm-band-' + hd.c + '"><div class="pm-band-top"><div><div class="pm-band-word">' + escapeHtml(hd.word.toUpperCase()) + '</div><div class="pm-prod">' + escapeHtml(hd.product) + '</div><div class="pm-since">' + hd.since + '</div></div><div class="pm-btns">' + buttons(v) + '</div></div>' +
    '<div class="pm-band-nums">' + num('made on this product', fmt(n.made)) + num('target so far', fmt(n.target)) + num('against target', n.pct === null ? '–' : n.pct + '%') + num('a minute', n.speed === null ? '–' : fmt(n.speed), n.range ? 'range ' + n.range : '') +
    (v.fill ? num('last fill weight', n.fill ? n.fill.words : '–', n.fill ? 'at ' + n.fill.at : '') : '') + '</div></section>' + sensorsHtml(v) +
    '<section class="pd-box pm-box"><div class="pm-box-h"><h3>Made each hour since it started running</h3><span>' + hd.started + ' · made <b>' + fmt(h.total.made) + '</b> of <b>' + fmt(h.total.target) + '</b> · stopped <b>' + h.total.stopMin + ' min</b></span></div>' + barsHtml(h, nowMs) +
    '<h4>Running, stopped and changeovers</h4>' + timelineHtml(h, nowMs) + '<h4>Each product</h4>' + runsTable(h, nowMs) + '</section>' + restHtml(v, h, nowMs, more);
}

// Joe 10/26 (picked 1): mock-up 1 with each area on its own tab, so the page fits on the screen without scrolling. What is
// running now stays on top; the tab picked is kept while the page redraws (production.html keeps it in the address too).
export const TABS = [['made', 'Made vs target'], ['products', 'Each product'], ['fill', 'Fill weight'], ['stops', 'Stops & waste'], ['changeovers', 'Changeovers'], ['quality', 'Quality'], ['crew', 'Crew & notes'], ['efficiency', 'Efficiency']];
function look1Tabs(v, h, nowMs, more) {
  const hd = headline(v, h, nowMs), n = nowNumbers(v, h), r = restParts(v, h, nowMs, more);
  const tile = (label, value, note, cls) => '<div class="pm-tile' + (cls ? ' ' + cls : '') + '"><span>' + label + '</span><b>' + value + '</b>' + (note ? '<small>' + note + '</small>' : '') + '</div>';
  const since = h.now ? 'Since ' + whenWords(h.now.from, nowMs) + ' · ' + longFor((nowMs - h.now.from) / 60000) : hd.since;
  const top = '<section class="pm-now pm-compact pm-c-' + hd.c + '"><div class="pm-now-h"><span class="pm-pill ' + hd.c + '">' + escapeHtml(hd.word) + '</span><div class="pm-prod">' + escapeHtml(hd.product) + '</div><div class="pm-since">' + since + '</div><div class="pm-btns">' + buttons(v) + '</div></div>' +
    '<div class="pm-tiles">' + tile('Made', fmt(n.made), 'on this product') + tile('Target so far', fmt(n.target)) + tile('Against target', n.pct === null ? '–' : n.pct + '%', '', 'pm-' + pctClass(n.pct)) +
    tile('Speed a minute', n.speed === null ? '–' : fmt(n.speed), n.range ? 'Range ' + n.range : '', n.off ? 'pm-r pm-flash' : '') + (v.fill ? tile('Last fill weight', n.fill ? n.fill.words : '–', n.fill ? 'at ' + n.fill.at + (n.fill.flag ? ' · ' + n.fill.flag : '') : 'No check yet', n.fill ? 'pm-' + n.fill.cls : '') : '') + '</div>' + sensorsHtml(v) + '</section>';
  // A number on a tab: how many there are; red when one needs someone (a stop with no reason, a light or heavy fill weight).
  const noReason = h.stops.filter(x => !x.brk && !x.reason).length, badFill = h.fills.filter(f => f.flag).length;
  const badge = { products: h.runs.length, fill: h.fills.length, stops: h.stops.filter(x => !x.brk).length, changeovers: h.changeovers.length + h.cips.length };
  const red = { stops: noReason > 0, fill: badFill > 0 };
  const tabs = TABS.filter(t => (t[0] !== 'fill' || v.fill) && (t[0] !== 'efficiency' || more.manager));
  const pick = tabs.some(t => t[0] === more.tab) ? more.tab : tabs[0][0];
  const sum = '<div class="pm-box-h"><span>' + hd.started + ' · made <b>' + fmt(h.total.made) + '</b> of <b>' + fmt(h.total.target) + '</b> target' + (h.total.pct === null ? '' : ' (<b class="pm-' + pctClass(h.total.pct) + '">' + h.total.pct + '%</b>)') + ' · stopped <b>' + h.total.stopMin + ' min</b></span></div>';
  const strip = (html) => html.replace(/^<section class="pd-box[^"]*"><h3>[^<]*<\/h3>/, '').replace(/<\/section>$/, '');
  const body = {
    made: sum + chartHtml(h),
    products: sum + timelineHtml(h, nowMs) + runsTable(h, nowMs),
    fill: strip(r.fill),
    stops: '<div class="pm-two"><div><h4>Stops and why</h4>' + strip(r.stops) + '</div><div><h4>Waste and rejects</h4>' + strip(r.waste) + '</div></div>',
    changeovers: '<div class="pm-two"><div><h4>Changeovers</h4>' + strip(r.cos) + '</div><div><h4>CIP washes</h4>' + strip(r.cip) + '</div></div>',
    quality: strip(r.quality),
    crew: strip(r.notes),
    efficiency: strip(r.effBox)
  }[pick];
  return top + '<div class="pm-tabs" role="tablist">' + tabs.map(t => '<button type="button" role="tab" data-pmtab="' + t[0] + '"' + (t[0] === pick ? ' class="on" aria-selected="true"' : '') + '>' + t[1] +
    (badge[t[0]] ? '<b' + (red[t[0]] ? ' class="pm-badge-r"' : '') + '>' + badge[t[0]] + '</b>' : '') + '</button>').join('') + '</div>' +
    '<section class="pd-box pm-box pm-tabbody" role="tabpanel" data-tab="' + pick + '">' + body + '</section>';
}

// The machine's page into #detail. more = { manager, quality (the quality checks box), tab (the tab picked) }.
export function drawMachine(v, nowMs, look, more) {
  const h = machineHistory(v, nowMs);
  return look === '2' ? look2(v, h, nowMs, more) : look === '3' ? look3(v, h, nowMs, more) : look === '1' ? look1(v, h, nowMs, more) : look1Tabs(v, h, nowMs, more);
}

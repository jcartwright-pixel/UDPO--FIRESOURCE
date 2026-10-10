// The driver's copy of the vacation year, the same page as the current app's Print Year (VacationSchedule.html, 7.0.271):
// one landscape page per driver with the name, weeks allowed, days booked, twelve months shaded by how many others are
// already off against the limit, holiday weeks marked with their limit, the driver's own days, and the memo to list
// missing days, sign and turn the sheet in.
const L = window.UDLogic;
const TYPE_CLASS = { PERSONAL: 'pdd', SICK: 'skd', BEREAVEMENT: 'bvd', UNPAID: 'und' };
const YEAR_LIMIT = 3;
const esc = (v) => String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const live = (v) => v.status !== 'CANCELLED' && v.status !== 'DENIED';
const us = (key) => { const [y, m, d] = key.split('-'); return Number(m) + '/' + Number(d) + '/' + y; };

// Day by day for the year: how many approved off (and of which type) and how many pending.
function yearMarks(year, vacations, match) {
  const out = {}, y0 = year + '-01-01', y1 = year + '-12-31';
  vacations.forEach(v => {
    const end = v.endDate || v.startDate;
    if (!live(v) || !v.startDate || end < y0 || v.startDate > y1 || (match && !match(v))) return;
    for (let k = v.startDate < y0 ? y0 : v.startDate; k <= (end > y1 ? y1 : end); k = L.addDays(k, 1)) {
      const m = out[k] || (out[k] = { approved: 0, pending: 0, types: {} });
      if (v.status === 'APPROVED') { m.approved++; const t = v.vacationType || 'VACATION'; m.types[t] = (m.types[t] || 0) + 1; } else m.pending++;
    }
  });
  return out;
}
// A printed day takes a type's color only when every approved entry that day is that type; otherwise it is a vacation day.
function printType(m) { for (const t in TYPE_CLASS) if (m.types[t] >= m.approved) return t; return ''; }
function dayRule(weeks, key) { return weeks.find(w => key >= w.start && key <= w.end) || null; }

function yearPage(year, title, weeksAllowed, all, own, today) {
  const weeks = L.holidayWeeks(year), other = { PERSONAL: 0, SICK: 0, BEREAVEMENT: 0, UNPAID: 0 };
  let booked = 0, pend = 0;
  Object.keys(own).forEach(k => { const o = own[k], t = o.approved ? printType(o) : ''; if (t) other[t]++; else if (o.approved) booked++; else if (o.pending) pend++; });
  let months = '';
  for (let m = 0; m < 12; m++) {
    const count = new Date(Date.UTC(year, m + 1, 0)).getUTCDate(), lead = new Date(Date.UTC(year, m, 1)).getUTCDay(), named = [];
    let cells = '<i></i>'.repeat(lead);
    for (let d = 1; d <= count; d++) {
      const k = year + '-' + pad(m + 1) + '-' + pad(d), rule = dayRule(weeks, k), max = rule ? rule.maxOff : YEAR_LIMIT, mine = own[k];
      const n = Math.max(0, (all[k] ? all[k].approved : 0) - (mine ? mine.approved : 0)), cls = n >= max ? 'full' : n > 0 ? 'some' : '';
      if (rule && named.indexOf(rule.label + ' · max ' + rule.maxOff + ' off') < 0) named.push(rule.label + ' · max ' + rule.maxOff + ' off');
      const t = mine && mine.approved ? printType(mine) : '';
      cells += '<i class="' + cls + (rule ? ' h' : '') + (mine && mine.approved ? ' ' + (t ? TYPE_CLASS[t] : 'a') : mine && mine.pending ? ' p' : '') + '">' + d + (n ? '<sub>' + n + '</sub>' : '') + '</i>';
    }
    const monthName = new Date(Date.UTC(year, m, 15)).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
    months += '<div class="mo"><h3>' + monthName + '</h3><div class="g"><b>S</b><b>M</b><b>T</b><b>W</b><b>T</b><b>F</b><b>S</b>' + cells + '</div><p class="hn">' + esc(named.join(' · ')) + '</p></div>';
  }
  const extra = Object.keys(other).map(t => { const c = other[t]; return c ? ' + ' + c + ' ' + L.VACATION_TYPE_NAMES[t].toLowerCase().replace(/ day$/, '') + ' day' + (c === 1 ? '' : 's') : ''; }).join('') + (pend ? ' + ' + pend + ' pending' : '');
  return '<section class="pg"><header><div><small>UNITED DAIRY · VACATION CALENDAR</small><h1>' + esc(title) + '</h1></div>' +
    '<div class="wa"><span>Weeks allowed</span><b>' + (weeksAllowed === null || weeksAllowed === undefined || weeksAllowed === '' ? '&nbsp;' : esc(weeksAllowed)) + '</b></div>' +
    '<div class="wa"><span>Vacation days booked</span><b>' + booked + '<small>' + esc(extra) + '</small></b></div><div class="yr">' + year + '</div></header>' +
    '<div class="sum"><span><i class="k some"></i> Others already off (number in the corner)</span><span><i class="k full"></i> Full: no more off</span><span><i class="k h"></i> Holiday week (limit under the month)</span>' +
    '<span><i class="k a"></i> ' + esc(title) + ' vacation day</span><span><i class="k pdd"></i> Personal day</span><span><i class="k skd"></i> Sick day</span><span><i class="k bvd"></i> Bereavement day</span><span><i class="k und"></i> Unpaid day</span><span><i class="k p"></i> Pending</span>' +
    '<span class="asof">Limit ' + YEAR_LIMIT + ' off a day · as of ' + esc(us(today)) + '</span></div><div class="yg">' + months + '</div>' +
    '<footer><p>Missing days? Circle them on this calendar or list them here, sign, and turn this sheet in to the office.</p><div class="ln"><span>Missing days</span></div><div class="ln two"><span>Driver signature</span><span>Date</span></div></footer></section>';
}

const STYLE = '@page{size:letter landscape;margin:.3in}*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}body{margin:0;font-family:Arial,sans-serif;color:#0a3561}.pg{width:10.4in;height:7.85in;display:flex;flex-direction:column;page-break-after:always;break-after:page;overflow:hidden}.pg:last-child{page-break-after:auto;break-after:auto}header{display:flex;justify-content:space-between;align-items:flex-end;gap:18px;border-bottom:4px solid #e7a31a;padding-bottom:4px}header>div:first-child{flex:1}header small{font-size:10px;font-weight:900;letter-spacing:.14em;color:#587087}header h1{margin:0;font-size:26px}.wa{display:flex;flex-direction:column;align-items:flex-end}.wa span{font-size:9px;font-weight:900;letter-spacing:.1em;text-transform:uppercase;color:#587087}.wa b{font-size:22px;min-width:.9in;text-align:right;border-bottom:1px solid #0a3561}.wa b small{font-size:11px;letter-spacing:0;text-transform:none;color:#0a3561}.yr{font-size:34px;font-weight:900;color:#245990}.sum{display:flex;flex-wrap:wrap;gap:4px 14px;align-items:center;margin:4px 0 5px;font-size:10.5px;font-weight:700}.k{display:inline-block;width:12px;height:12px;vertical-align:-2px;border:1px solid #9fb3c6;border-radius:2px}.k.some{background:#d5e5f3}.k.full{background:#f2b8b3;border-color:#b3261e}.k.h{border:0;border-bottom:3px solid #e7a31a;background:#fff4d9}.k.a{background:#0a3561;border-color:#0a3561}.k.p{border:2px solid #d89a00}.k.pdd{background:#7a4fb3;border-color:#7a4fb3}.k.skd{background:#d9822b;border-color:#d9822b}.k.bvd{background:#5b6675;border-color:#5b6675}.k.und{background:#2f8a6e;border-color:#2f8a6e}.sum .asof{margin-left:auto;color:#587087}.yg{flex:1;display:grid;grid-template-columns:repeat(4,1fr);grid-template-rows:repeat(3,1fr);gap:2px 12px;min-height:0}.mo h3{margin:0 0 1px;font-size:12.5px;text-transform:uppercase;letter-spacing:.06em;color:#245990}.hn{margin:1px 0 0;min-height:10px;font-size:8.5px;font-weight:900;color:#9a6700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.g{display:grid;grid-template-columns:repeat(7,1fr);gap:1px}.g b{font-size:8.5px;text-align:center;color:#587087}.g i{position:relative;font-style:normal;font-size:10.5px;font-weight:700;text-align:center;line-height:18px;height:18px;border:1px solid #d4dfe8;border-radius:2px;background:#fff}.g i:empty{border:0;background:transparent}.g i.h{background:#fff4d9;border-bottom:3px solid #e7a31a}.g i.some{background:#d5e5f3}.g i.full{background:#f2b8b3;border-color:#b3261e;color:#7a1610}.g i.a{background:#0a3561;border-color:#0a3561;color:#fff}.g i.p{box-shadow:inset 0 0 0 2px #d89a00}.g i.pdd{background:#7a4fb3;border-color:#7a4fb3;color:#fff}.g i.skd{background:#d9822b;border-color:#d9822b;color:#fff}.g i.bvd{background:#5b6675;border-color:#5b6675;color:#fff}.g i.und{background:#2f8a6e;border-color:#2f8a6e;color:#fff}.g sub{position:absolute;right:1px;bottom:0;font-size:7px;line-height:8px;font-weight:900}footer{margin-top:4px;border-top:2px solid #0a3561;padding-top:3px}footer p{margin:0 0 4px;font-size:11.5px;font-weight:700}.ln{display:flex;gap:24px;margin-top:8px}.ln span{flex:1;border-bottom:1px solid #0a3561;font-size:10px;font-weight:900;color:#587087;padding-top:10px}.ln.two span:last-child{flex:0 0 2in}';

// drivers: [{ id, name, vacationWeeks }] — one page each.
export function vacationYearHtml(year, drivers, vacations, today) {
  const all = yearMarks(year, vacations);
  const pages = drivers.map(d => yearPage(year, d.name, d.vacationWeeks, all, yearMarks(year, vacations, v => v.driverId === d.id), today));
  return '<!doctype html><html><head><meta charset="utf-8"><title>Vacation Calendar ' + year + '</title><style>' + STYLE + '</style></head><body>' + pages.join('') + '</body></html>';
}

// Printed from a hidden frame so the screen itself is left alone.
export function printVacationYear(html) {
  const old = document.getElementById('vacation-print-frame');
  if (old) old.remove();
  const frame = document.createElement('iframe');
  frame.id = 'vacation-print-frame';
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(frame);
  const doc = frame.contentWindow.document;
  doc.open(); doc.write(html); doc.close();
  setTimeout(() => { frame.contentWindow.focus(); frame.contentWindow.print(); }, 150);
}

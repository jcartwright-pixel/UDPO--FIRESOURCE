// Printing a sheet the way Print Layouts shows it (Joe 10/10): the sheet is laid out at the paper's width, cut into pages
// between rows (a table carried onto the next page repeats its heading row), and exactly those pages and copies are sent.
// Print Layouts uses it for its preview; a screen's own Print button can use it with that sheet's saved setup (printSaved).

export const PAPER = { letter: [8.5, 11], legal: [8.5, 14] }, MARGIN = { narrow: 0.25, normal: 0.4, wide: 0.75 }, DPI = 96;
export const BASE = { orient: 'landscape', size: 'letter', margin: 'normal', fit: true, onePage: false, copies: 1 };
// The current app printed the Daily Dispatch Sheet on ONE landscape page, 3 copies (DailyDispatch.html 7.0.226).
// The current app's Fleet Service & Compliance Report was one portrait letter page.
export const SHEET_DEFAULTS = { daily: { onePage: true, copies: 3 }, weekly: { onePage: true }, vacation: { margin: 'narrow' }, scheduler: { margin: 'narrow' }, fleet: { orient: 'portrait' } };
export const PAGE_CSS = '.pl-paper{box-sizing:border-box;background:#fff;overflow:hidden;position:relative}.pl-slice{overflow:hidden;position:relative}' +
  '.pl-wrap{margin:18px auto 6px}.pl-wrap .pl-paper{box-shadow:0 2px 10px rgba(10,40,70,.25)}.pl-no{text-align:center;font:600 13px system-ui,Arial,sans-serif;color:#40576c;margin:6px 0 0}' +
  '.pl-wrap.skip .pl-paper{opacity:.35}.pl-wrap.skip .pl-no b{color:#9b1c1c}';

/* ---------- Saved setup (this computer) ---------- */
function savedAll() { try { return JSON.parse(localStorage.getItem('udPrintSetup') || '{}') || {}; } catch (e) { return {}; } }
export function hasSaved(key) { return !!savedAll()[key]; }
export function setupFor(key) { return Object.assign({}, BASE, SHEET_DEFAULTS[key] || {}, savedAll()[key] || {}); }
export function saveSetup(key, s) {
  const all = savedAll();
  all[key] = { orient: s.orient, size: s.size, margin: s.margin, fit: !!s.fit, onePage: !!s.onePage, copies: s.copies };
  try { localStorage.setItem('udPrintSetup', JSON.stringify(all)); } catch (e) { /* no storage */ }
}

const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// The page's styles as the printer sees them: print rules always on, screen-only rules off, page size left to this code.
export function styles(doc) {
  const out = [];
  const walk = (rules, into) => [...rules].forEach(r => {
    if (r.type === CSSRule.MEDIA_RULE) {
      const m = r.media.mediaText;
      if (/\bprint\b/.test(m) && !/not\s+print/.test(m)) walk(r.cssRules, into);
      else if (/\bscreen\b/.test(m) && !/\bprint\b/.test(m)) return;
      else { const inner = []; walk(r.cssRules, inner); into.push('@media ' + m + '{' + inner.join('\n') + '}'); }
    } else if (r.type === CSSRule.PAGE_RULE) { /* set by printPages */ }
    else if (r.selectorText && /:not\(#print\)/.test(r.selectorText)) { /* the rule that hides the screen while printing */ }
    else into.push(r.cssText);
  });
  [...doc.styleSheets].forEach(s => { try { walk(s.cssRules, out); } catch (e) { /* another site's sheet */ } });
  return out.join('\n');
}
export function pageBox(st) {
  const [a, b] = PAPER[st.size] || PAPER.letter, [pw, ph] = st.orient === 'landscape' ? [b, a] : [a, b], m = MARGIN[st.margin] || MARGIN.normal;
  return { pw, ph, m, W: Math.round((pw - 2 * m) * DPI), H: Math.round((ph - 2 * m) * DPI) };
}
export function frameDoc(css, extra) {
  return '<!doctype html><html><head><meta charset="utf-8"><base href="' + esc(location.href) + '"><style>' + css + '</style><style>' + extra + '</style></head><body>';
}

// Writes the sheet into document d (Print Layouts' preview frame, or a hidden one) and returns { box, pages }.
export function layout(d, result, st) {
  const box = pageBox(st);
  d.open();
  d.write(frameDoc(result.css, 'html,body{height:auto!important;min-height:0!important;overflow:auto!important;background:#dfe6ee!important;margin:0!important}' +
    '#pl-measure{position:absolute;left:0;top:0;visibility:hidden;width:' + box.W + 'px}' + PAGE_CSS) + '<div id="pl-measure">' + result.html + '</div><div id="pl-pages"></div></body></html>');
  d.close();
  const host = d.getElementById('pl-measure'), root = host.firstElementChild;
  root.style.zoom = '';
  if (st.fit && host.scrollWidth > box.W + 1) root.style.zoom = String(box.W / host.scrollWidth);
  // Fit on one page: shrink until the whole sheet fits the page's height too, still using the page's full width.
  if (st.onePage) {
    for (let i = 0; i < 6; i++) {
      const h = host.getBoundingClientRect().height;
      if (h <= box.H) break;
      const z = Math.max(0.2, (Number(root.style.zoom) || 1) * (box.H / h) * 0.98);
      root.style.width = (box.W / z) + 'px';
      root.style.zoom = String(z);
    }
  }
  const base = host.getBoundingClientRect().top, rect = (e) => { const r = e.getBoundingClientRect(); return { t: r.top - base, b: r.bottom - base }; };
  const total = host.getBoundingClientRect().height;
  const atoms = [...host.querySelectorAll('tr, li, p, h1, h2, h3, h4, img, section, header, footer, .pg, .mo, .top')].map(rect).filter(r => r.b - r.t > 0);
  const forced = [...host.querySelectorAll('*')].filter(e => { const s = d.defaultView.getComputedStyle(e); return /page|always/.test(s.breakAfter) || /always/.test(s.pageBreakAfter); }).map(e => rect(e).b);
  const tables = [...host.querySelectorAll('table')].filter(t => t.tHead).map(t => ({ r: rect(t), h: rect(t.tHead) }));
  const cuts = [...new Set(atoms.flatMap(r => [r.t, r.b]))].sort((x, y) => y - x);
  const pages = [];
  let start = 0, head = null;
  while (start < total - 2 && pages.length < 300) {
    const room = box.H - (head ? head.b - head.t : 0), limit = start + room;
    const f = forced.find(y => y > start + 2 && y <= limit + 1);
    let cut = f || (limit >= total ? total : 0);
    if (!cut) {
      cut = cuts.find(y => y <= limit && y > start + room * 0.25 && !atoms.some(r => r.b - r.t < room && r.t < y - 1 && r.b > y + 1)) || limit;
    }
    pages.push({ head, start, end: cut });
    const t = tables.find(x => x.r.t < cut - 1 && x.r.b > cut + 1);
    head = t && t.h.b < cut ? t.h : null;
    start = cut;
  }
  if (!pages.length) pages.push({ head: null, start: 0, end: Math.max(total, 1) });
  // Only the parts of the sheet a page shows are copied onto it (a year of driver pages stays light).
  const kids = [...root.children].map(e => ({ e, r: rect(e), mt: parseFloat(d.defaultView.getComputedStyle(e).marginTop) || 0 }));
  const sliceHtml = (y0, y1) => {
    const use = kids.filter(k => k.r.b > y0 && k.r.t < y1);
    let inner = root.outerHTML;
    if (kids.length > 1 && use.length && use.length < kids.length) {
      const first = use[0], open = root.outerHTML.slice(0, root.outerHTML.indexOf('>') + 1), tag = root.tagName.toLowerCase();
      inner = open + '<div style="height:' + Math.max(0, first.r.t - first.mt) + 'px"></div>' + use.map(k => k.e.outerHTML).join('') + '</' + tag + '>';
    }
    return '<div class="pl-slice" style="height:' + (y1 - y0) + 'px"><div style="width:' + box.W + 'px;margin-top:' + (-y0) + 'px">' + inner + '</div></div>';
  };
  const html = pages.map(p => (p.head ? sliceHtml(p.head.t, p.head.b) : '') + sliceHtml(p.start, p.end));
  host.remove();
  return { box, pages: html };
}

// Sends the chosen pages, copies times, to the browser's print window from a hidden frame.
export function printPages(result, lay, st, sel) {
  const { box, pages } = lay, which = sel || pages.map((p, i) => i), copies = Math.max(1, Math.min(50, Number(st.copies) || 1));
  const list = []; for (let c = 0; c < copies; c++) which.forEach(i => list.push(pages[i]));
  const old = document.getElementById('pl-print-frame'); if (old) old.remove();
  const f = document.createElement('iframe');
  f.id = 'pl-print-frame'; f.setAttribute('aria-hidden', 'true'); f.tabIndex = -1; f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(f);
  const d = f.contentWindow.document;
  d.open();
  d.write(frameDoc(result.css, '@page{size:' + box.pw + 'in ' + box.ph + 'in;margin:0}html,body{height:auto!important;overflow:visible!important;background:#fff!important;margin:0!important}' +
    '*{-webkit-print-color-adjust:exact;print-color-adjust:exact}' + PAGE_CSS + '.pl-paper{break-after:page;page-break-after:always}.pl-paper:last-child{break-after:auto;page-break-after:auto}') +
    list.map(p => '<div class="pl-paper" style="width:' + box.pw + 'in;height:' + box.ph + 'in;padding:' + box.m + 'in">' + p + '</div>').join('') + '</body></html>');
  d.close();
  setTimeout(() => { f.contentWindow.focus(); f.contentWindow.print(); }, 250);
}

// A screen's own Print: what it put in its #print box goes out with that sheet's saved setup from Print Layouts. When Print
// Layouts itself has the screen open behind it, it takes the sheet instead (udPrintCatch).
export function printSaved(key) {
  if (typeof window.udPrintCatch === 'function') { window.udPrintCatch(); return; }
  const box = document.getElementById('print');
  const result = { html: '<div id="print">' + (box ? box.innerHTML : '') + '</div>', css: styles(document) }, st = setupFor(key);
  const f = document.createElement('iframe');
  f.setAttribute('aria-hidden', 'true'); f.tabIndex = -1; f.style.cssText = 'position:fixed;left:-40000px;top:0;width:1200px;height:900px;border:0;visibility:hidden';
  document.body.appendChild(f);
  const lay = layout(f.contentDocument, result, st);
  f.remove();
  printPages(result, lay, st);
}

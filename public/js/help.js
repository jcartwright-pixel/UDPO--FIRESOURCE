/*
 * The Help guide (Joe 10/26: "a little question mark in the top ... a complete help file ... anytime we make changes, we
 * update the help"). Every word of it is in one file, help.md, so it is easy to keep up to date (the rule is in CLAUDE.md and
 * functions/test/unit/help.test.js fails when a screen has no help). This file reads help.md, finds the part for a screen,
 * and turns it into the page. The "?" in every screen's header opens help.html on that screen's part, in the same window
 * (no pop-up over the screen); Back comes straight back to the screen.
 */

// help.md -> { chapters: [{ title, sections }], sections: [{ id, title, chapter, screens, body }] }
export function parseHelp(src) {
  const chapters = [], sections = [];
  let chapter = null, sec = null, meta = false;
  const text = String(src || '').replace(/<!--[\s\S]*?-->/g, '');
  for (const line of text.split(/\r?\n/)) {
    let m;
    if ((m = /^# (.+)$/.exec(line))) { chapter = { title: m[1].trim(), sections: [] }; chapters.push(chapter); sec = null; continue; }
    if ((m = /^## (.+)$/.exec(line))) {
      if (!chapter) { chapter = { title: 'Help', sections: [] }; chapters.push(chapter); }
      sec = { id: '', title: m[1].trim(), chapter: chapter.title, screens: [], body: [] };
      chapter.sections.push(sec); sections.push(sec); meta = true; continue;
    }
    if (!sec) continue;
    // The lines right under a section's title say where it belongs (id:, screens:).
    if (meta && (m = /^(id|screens):\s*(.*)$/i.exec(line))) {
      if (m[1].toLowerCase() === 'id') sec.id = m[2].trim();
      else sec.screens = m[2].split(',').map(s => s.trim()).filter(Boolean);
      continue;
    }
    if (meta && !line.trim()) continue;
    meta = false;
    sec.body.push(line);
  }
  sections.forEach(s => {
    if (!s.id) s.id = s.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    s.body = s.body.join('\n').trim();
  });
  return { chapters, sections };
}

// The part for a screen: "loadout.html?area=CASE" first looks for a part listing exactly that, then one listing
// "loadout.html". Only the settings a part names have to match, so "issues.html?kind=TRUCK&testEmail=x" still finds it.
export function sectionForPage(help, page, search) {
  const qs = new URLSearchParams(search || '');
  const fits = (entry) => {
    const [p, q] = entry.split('?');
    if (p !== page) return -1;
    const want = [...new URLSearchParams(q || '')];
    return want.every(([k, v]) => qs.get(k) === v) ? want.length : -1;
  };
  let best = null, bestScore = -1;
  help.sections.forEach(s => s.screens.forEach(e => { const sc = fits(e); if (sc > bestScore) { best = s; bestScore = sc; } }));
  return best;
}

const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// A little Markdown: ### headings, - bullets, 1. steps, > tips, !> warnings ("do not"), **bold**, `button names`
// and [links](#section-id) to other parts.
function inline(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/`([^`]+)`/g, '<span class="help-key">$1</span>')
    .replace(/\[([^\]]+)\]\(#([a-z0-9-]+)\)/g, '<a href="#$2" data-help-link="$2">$1</a>');
}
export function renderBody(body) {
  const out = [];
  let listTag = '', para = [];
  const flushPara = () => { if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; } };
  const closeList = () => { if (listTag) { out.push('</' + listTag + '>'); listTag = ''; } };
  for (const raw of String(body || '').split('\n')) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) { flushPara(); closeList(); continue; }
    if ((m = /^###\s+(.+)$/.exec(line))) { flushPara(); closeList(); out.push('<h3>' + inline(m[1]) + '</h3>'); continue; }
    if ((m = /^!>\s?(.*)$/.exec(line))) { flushPara(); closeList(); out.push('<p class="help-dont">' + inline(m[1]) + '</p>'); continue; }
    if ((m = /^>\s?(.*)$/.exec(line))) { flushPara(); closeList(); out.push('<p class="help-tip">' + inline(m[1]) + '</p>'); continue; }
    if ((m = /^\s*[-*]\s+(.+)$/.exec(line)) || (m = /^\s*\d+[.)]\s+(.+)$/.exec(line))) {
      flushPara();
      const tag = /^\s*\d/.test(line) ? 'ol' : 'ul';
      if (listTag !== tag) { closeList(); out.push('<' + tag + '>'); listTag = tag; }
      out.push('<li>' + inline(m[1]) + '</li>');
      continue;
    }
    // A line under a bullet that is indented carries on that bullet.
    if (listTag && /^\s{2,}\S/.test(raw)) { out[out.length - 1] = out[out.length - 1].replace(/<\/li>$/, ' ' + inline(line.trim()) + '</li>'); continue; }
    closeList();
    para.push(line.trim());
  }
  flushPara(); closeList();
  return out.join('');
}

let loaded = null;
export function loadHelp() {
  if (!loaded) {
    loaded = fetch('help.md', { cache: 'no-cache' })
      .then(r => { if (!r.ok) throw new Error('The help guide could not be read (' + r.status + ').'); return r.text(); })
      .then(parseHelp)
      .catch(e => { loaded = null; throw e; });
  }
  return loaded;
}

// Where the "?" goes: the Help page, on this screen's part (the screen's own settings ride along so Case Loading opens
// the Case Loading part, not the Tote one).
// A screen whose open part is not in its address (Administration's open item) says which part with window.udHelpFor.
export function helpHref(loc) {
  const l = loc || location;
  const own = typeof window !== 'undefined' && typeof window.udHelpFor === 'function' ? window.udHelpFor() : '';
  const page = own ? own.split('?')[0] : l.pathname.split('/').pop() || 'index.html';
  const qs = new URLSearchParams(own ? own.split('?')[1] || '' : l.search);
  if (own && new URLSearchParams(l.search).get('testEmail')) qs.set('testEmail', new URLSearchParams(l.search).get('testEmail'));
  const test = qs.get('testEmail');
  qs.delete('testEmail');
  const q = qs.toString();
  return 'help.html?for=' + encodeURIComponent(page + (q ? '?' + q : '')) + (test ? '&testEmail=' + encodeURIComponent(test) : '');
}

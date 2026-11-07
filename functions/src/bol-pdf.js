/*
 * Reads the text lines out of a plain report PDF (the daily "Daily Load By Route" BOL from the office's Crystal Reports),
 * with no outside library: each page's drawing steps are unpacked (zlib), the text and where it is drawn are followed, and
 * the words are put back into lines (same height on the page) and cells (left to right).
 *
 * Only what that kind of report uses is read: Tm / Td / TD / T* / ' / " / Tj / TJ, literal and hex strings, one byte per
 * letter. A scanned picture or an unusual PDF gives no lines; the caller then says the file could not be read.
 */
'use strict';

const zlib = require('zlib');

// The drawing streams of the file, in file order (pages are written front to back by the report writer).
function streams(buf) {
  const out = [];
  const text = buf.toString('latin1');
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(text))) {
    const start = m.index + m[0].length;
    const head = text.slice(Math.max(0, m.index - 400), m.index);
    const dict = head.slice(head.lastIndexOf('<<'));
    const end = text.indexOf('endstream', start);
    if (end < 0) break;
    re.lastIndex = end;
    let data = buf.subarray(start, end);
    const len = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
    if (len && Number(len[1]) <= data.length) data = data.subarray(0, Number(len[1]));
    if (/\/Subtype\s*\/(Image|Type1C|CIDFontType0C|OpenType)|\/Length1|\/Type\s*\/(XRef|ObjStm)/.test(dict)) continue;
    if (/FlateDecode/.test(dict)) {
      try { data = zlib.inflateSync(data); } catch (e) { try { data = zlib.inflateRawSync(data.subarray(2)); } catch (e2) { continue; } }
    } else if (/\/Filter/.test(dict)) continue;
    const s = data.toString('latin1');
    if (/\bBT\b/.test(s)) out.push(s);
  }
  return out;
}

// One literal string "(...)" starting at i: returns [text, next index].
function literal(s, i) {
  let depth = 1, out = '';
  i++;
  while (i < s.length && depth) {
    const c = s[i];
    if (c === '\\') {
      const n = s[i + 1];
      const map = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' };
      if (map[n] != null) { out += map[n]; i += 2; continue; }
      if (/[0-7]/.test(n)) { const o = /^[0-7]{1,3}/.exec(s.slice(i + 1, i + 4))[0]; out += String.fromCharCode(parseInt(o, 8)); i += 1 + o.length; continue; }
      if (n === '\r' || n === '\n') { i += 2; if (n === '\r' && s[i] === '\n') i++; continue; }
      i += 2; continue;
    }
    if (c === '(') depth++;
    if (c === ')') { depth--; if (!depth) { i++; break; } }
    out += c; i++;
  }
  return [out, i];
}

function hex(s, i) {
  const end = s.indexOf('>', i);
  let h = s.slice(i + 1, end).replace(/\s+/g, '');
  if (h.length % 2) h += '0';
  let out = '';
  for (let k = 0; k < h.length; k += 2) out += String.fromCharCode(parseInt(h.slice(k, k + 2), 16));
  return [out, end + 1];
}

// The words drawn on one page: [{x, y, text}] where a run of text shown with no move in between is one word.
function pageWords(s) {
  const words = [];
  let tm = [1, 0, 0, 1, 0, 0], line = [0, 0], lead = 0, cur = null;
  const stack = [];
  const moveTo = (x, y) => { line = [x, y]; tm = [tm[0], tm[1], tm[2], tm[3], x, y]; cur = null; };
  const show = (t) => {
    if (!cur) { cur = { x: tm[4], y: tm[5], text: '' }; words.push(cur); }
    cur.text += t;
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '(') { const [t, n] = literal(s, i); stack.push({ str: t }); i = n; continue; }
    if (c === '<' && s[i + 1] !== '<') { const [t, n] = hex(s, i); stack.push({ str: t }); i = n; continue; }
    if (c === '[') { stack.push({ open: true }); i++; continue; }
    if (c === ']') {
      const parts = [];
      while (stack.length && !stack[stack.length - 1].open) parts.unshift(stack.pop());
      stack.pop();
      // A big gap inside TJ (more than about two letters) is a space between words.
      stack.push({ arr: parts.map(p => p.str != null ? p.str : (p.num < -400 ? ' ' : '')).join('') });
      i++; continue;
    }
    if (c === '%') { const e = s.indexOf('\n', i); i = e < 0 ? s.length : e; continue; }
    if (/\s/.test(c)) { i++; continue; }
    const m = /^(-?\d*\.?\d+)|^\/[^\s/<>()[\]{}%]+|^[A-Za-z'"*]+[A-Za-z*0-9]*/.exec(s.slice(i, i + 64));
    if (!m) { i++; continue; }
    const tok = m[0];
    i += tok.length;
    if (m[1] != null) { stack.push({ num: Number(tok) }); continue; }
    if (tok[0] === '/') { stack.push({ name: tok }); continue; }
    const nums = () => stack.filter(x => x.num != null).map(x => x.num);
    const lastStr = () => { for (let k = stack.length - 1; k >= 0; k--) if (stack[k].str != null) return stack[k].str; return ''; };
    switch (tok) {
      case 'BT': tm = [1, 0, 0, 1, 0, 0]; line = [0, 0]; cur = null; break;
      case 'Tm': { const n = nums().slice(-6); if (n.length === 6) { tm = n; line = [n[4], n[5]]; cur = null; } break; }
      case 'Td': { const n = nums().slice(-2); moveTo(line[0] + n[0] * tm[0], line[1] + n[1] * tm[3]); break; }
      case 'TD': { const n = nums().slice(-2); lead = -n[1]; moveTo(line[0] + n[0] * tm[0], line[1] + n[1] * tm[3]); break; }
      case 'TL': { const n = nums(); lead = n[n.length - 1] || 0; break; }
      case 'T*': moveTo(line[0], line[1] - lead); break;
      case 'Tj': show(lastStr()); break;
      case "'": moveTo(line[0], line[1] - lead); show(lastStr()); break;
      case '"': moveTo(line[0], line[1] - lead); show(lastStr()); break;
      case 'TJ': { const a = stack.filter(x => x.arr != null).pop(); show(a ? a.arr : ''); break; }
      case 'ET': cur = null; break;
      default: break;
    }
    stack.length = 0;
  }
  return words.filter(w => w.text.trim() !== '');
}

/** The text lines of the PDF: [[cell, cell, ...], ...], top to bottom, page after page; cells left to right. */
function pdfLines(buf) {
  if (!buf || buf.length < 8 || buf.toString('latin1', 0, 5) !== '%PDF-') return [];
  const lines = [];
  for (const s of streams(buf)) {
    const words = pageWords(s).sort((a, b) => b.y - a.y || a.x - b.x);
    // Words within 3 points up or down are on the same line (the report draws the date a little lower than the rest).
    const rows = [];
    words.forEach(w => {
      const row = rows.find(r => Math.abs(r.y - w.y) <= 3);
      if (row) row.words.push(w); else rows.push({ y: w.y, words: [w] });
    });
    rows.sort((a, b) => b.y - a.y).forEach(r => lines.push(r.words.sort((a, b) => a.x - b.x).map(w => ({ x: Math.round(w.x * 10) / 10, text: w.text.replace(/\s+/g, ' ').trim() }))));
  }
  return lines;
}

module.exports = { pdfLines };

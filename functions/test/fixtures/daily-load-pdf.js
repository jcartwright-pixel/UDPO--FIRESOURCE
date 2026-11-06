'use strict';
// A made-up Daily Load By Route PDF (the BOL, route report tests), laid out like the Crystal report in Vicki's 4:00 PM
// email: a heading line on each page, then one line per item for each stop, each field its own piece of text. Every name
// and number is made up. Built by hand (no PDF library): one Helvetica page per list of lines.

const HEAD = [['LoadDate', 18], ['RtNo', 65], ['LoadSeq', 104], ['CusChn', 150], ['CusNo', 200], ['CusName', 273], ['ItemNo', 374], ['Descrip', 451], ['Qty', 561]];
const X = [12, 70, 121, 165, 204, 240, 379, 420, 577];
const esc = (s) => String(s).replace(/[\\()]/g, (c) => '\\' + c);

function pageStream(lines) {
  const out = ['BT', '/F1 8 Tf'];
  const put = (s, x, y) => out.push('1 0 0 1 ' + x + ' ' + y + ' Tm (' + esc(s) + ') Tj');
  HEAD.forEach(([s, x]) => put(s, x, 755));
  lines.forEach((l, i) => {
    const y = 743 - i * 11;
    l.forEach((v, c) => { if (v !== '' && v != null) put(v, X[c], y); });
  });
  out.push('ET');
  return out.join('\n');
}

/** pages: [[ [date, route, seq, chain, custNo, name, itemNo, descrip, qty], ... ], ...] (blank '' for an empty field). */
function dailyLoadPdf(pages) {
  const objs = [];
  const add = (body) => { objs.push(body); return objs.length; };
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pagesId = objs.length + 1 + pages.length * 2;
  const kids = [];
  pages.forEach(lines => {
    const s = pageStream(lines);
    const content = add('<< /Length ' + Buffer.byteLength(s) + ' >>\nstream\n' + s + '\nendstream');
    kids.push(add('<< /Type /Page /Parent ' + pagesId + ' 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ' + font + ' 0 R >> >> /Contents ' + content + ' 0 R >>'));
  });
  add('<< /Type /Pages /Kids [' + kids.map(k => k + ' 0 R').join(' ') + '] /Count ' + kids.length + ' >>');
  const catalog = add('<< /Type /Catalog /Pages ' + pagesId + ' 0 R >>');
  let pdf = '%PDF-1.4\n';
  const offsets = objs.map((body, i) => { const at = Buffer.byteLength(pdf); pdf += (i + 1) + ' 0 obj\n' + body + '\nendobj\n'; return at; });
  const xref = Buffer.byteLength(pdf);
  pdf += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  pdf += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root ' + catalog + ' 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  return Buffer.from(pdf, 'latin1');
}

/** The made-up 11-6-26 load: two routes over two pages, a line whose left columns are blank, a description that runs into its quantity. */
function sampleLoad(date) {
  const d = date || '11/06/2026';
  return dailyLoadPdf([
    [[d, 805, 0, 0, 1001, 'SAMPLE MARKET #1', 305, 'UD 2% GAL', 20], [d, 805, 0, 0, 1001, 'SAMPLE MARKET #1', 707, 'UD SKIM GAL', 8],
      ['', '', '', '', '', '', 2526, 'UD SM CD COTT CHS 16 OZ', 6], [d, 805, 0, 12, 1002, 'MADE-UP DELI', 1112, 'UD WHL CHOC PLS PT', 4]],
    [[d, 880, 0, 0, 3001, 'EXAMPLE FOODS', 401903, 'SAMPLE .5% BMLK LB TOTE 37059', ''], [d, 880, 0, 0, 3001, 'EXAMPLE FOODS', 7, 'JUG CLEAR GAL/CAP', 48]]
  ]);
}

module.exports = { dailyLoadPdf, sampleLoad };

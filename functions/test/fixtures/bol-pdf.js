/*
 * A made-up Daily Load By Route PDF, drawn the way the office's report writer draws it (one text run per cell, moved with Td,
 * some cells split in two runs, the load date a little lower than the rest of its line, a long name in its own clipped
 * block). Made-up customers only.
 */
'use strict';
const zlib = require('zlib');

const HEAD = [['LoadDate', 17.9], ['RtNo', 65.4], ['LoadSeq', 103.8], ['CusChn', 150], ['CusNo', 200.2], ['CusName', 272.7], ['ItemNo', 373.6], ['Descrip', 450.9], ['Qty', 560.9]];
const X = { date: 11.5, route: 68, seq: 118.9, chain: 162.7, custNo: 201.5, name: 239.5, item: 365.5, desc: 419.5, qty: 574.9 };
const esc = (t) => String(t).replace(/([()\\])/g, '\\$1');

function page(rows) {
  let s = '1 0 0 1 0 792 cm 0 0 0 rg\nBT\n1 0 0 1 ' + HEAD[1][1] + ' -36.7 Tm\n/9 8 Tf\n';
  let x = HEAD[1][1];
  HEAD.slice(1).concat([HEAD[0]]).forEach(([t, hx], i) => { if (i) { s += (hx - x).toFixed(2) + ' 0 Td\n'; x = hx; } s += '(' + t + ') Tj\n'; });
  s += 'ET\n';
  rows.forEach((r, n) => {
    const y = -48.7 - n * 11;
    // Route, sequence, chain, number, item, description, quantity, then the name, then the date a little lower.
    s += 'BT\n1 0 0 1 ' + X.route + ' ' + y + ' Tm\n( ' + esc(r[1]) + ') Tj\n';
    let cx = X.route;
    const at = (nx) => { const d = (nx - cx).toFixed(2); cx = nx; return d + ' 0 Td\n'; };
    s += at(X.seq) + '( ' + r[2] + ') Tj\n' + at(X.chain) + '( ' + r[3] + ') Tj\n' + at(X.custNo) + '( ' + r[4] + ') Tj\n';
    s += at(X.item) + '(     ' + r[6] + ') Tj\n';
    const half = Math.ceil(r[7].length / 2);
    s += at(X.desc) + '(' + esc(r[7].slice(0, half)) + ') Tj\n[(' + esc(r[7].slice(half, half + 1)) + ')19(' + esc(r[7].slice(half + 1)) + ')] TJ\n';
    s += at(X.qty) + '( ' + r[8] + ') Tj\nET\n';
    s += 'q\n239.5 ' + (y + 7) + ' 121 -9 re\nW\nn\nBT\n1 0 0 1 ' + X.name + ' ' + y + ' Tm\n(' + esc(r[5]) + ') Tj\nET\nQ\n';
    s += 'BT\n1 0 0 1 ' + X.date + ' ' + (y - 0.75) + ' Tm\n[(' + r[0].slice(0, 1) + ')75(' + r[0].slice(1) + ')] TJ\nET\n';
  });
  return s;
}

/** rows: [[loadDate, route, seq, chain, custNo, name, item, desc, qty]]; perPage rows to a page. Returns a Buffer. */
function bolPdf(rows, perPage) {
  const pages = [];
  for (let i = 0; i < rows.length; i += perPage || 60) pages.push(rows.slice(i, i + (perPage || 60)));
  const parts = ['%PDF-1.7 \n%\xe2\xe3\xcf\xd3 \n1 0 obj \n<< \n/Type /Catalog \n/Pages 2 0 R \n>> \nendobj \n'];
  const bufs = [Buffer.from(parts[0], 'latin1')];
  pages.forEach((p, i) => {
    const data = zlib.deflateSync(Buffer.from(page(p), 'latin1'));
    bufs.push(Buffer.from((5 + i) + ' 0 obj \n<< \n/Length ' + data.length + ' \n/Filter [ /FlateDecode ] \n>> \nstream\n', 'latin1'), data, Buffer.from('\nendstream \nendobj \n', 'latin1'));
  });
  bufs.push(Buffer.from('trailer\n<< /Root 1 0 R >>\n%%EOF\n', 'latin1'));
  return Buffer.concat(bufs);
}

// A short made-up BOL: two routes, three customers, over two pages.
const SAMPLE = [
  ['11/09/2026', '805', '0', '0', '1001', 'MADEUP GOLF CENTER', '908', 'UD 3.25 BMILK PLS HGL', '6'],
  ['11/09/2026', '805', '0', '0', '1001', 'MADEUP GOLF CENTER', '5105', 'UD RF 6% VAN GAL', '40'],
  ['11/09/2026', '805', '2', '0', '1002', 'SAMPLE FOOD MART (CO-OP)', '305', 'UD 2% GAL', '20'],
  ['11/09/2026', '6301', '0', '990', '9001', 'PRETEND MARKET #9001 TOWNVILLE', '260205', 'GV HVD GAL', '432'],
  ['11/09/2026', '6301', '0', '990', '9001', 'PRETEND MARKET #9001 TOWNVILLE', '260308', 'GV 2% PLS HGL', '108']
];
const samplePdf = () => bolPdf(SAMPLE, 3);

module.exports = { bolPdf, samplePdf, SAMPLE };

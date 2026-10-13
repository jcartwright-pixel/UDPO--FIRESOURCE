/*
 * Receiving's barcode rules (Joe 10/13: scan in what Receiving brings in, with the Wasp scanner or the Galaxy tablet's camera),
 * shared by the screens and the server (one file, copied unchanged to public/js/scan-rules.js; a unit test checks the two match).
 *
 *   - a scan is whatever the scanner typed (a keyboard-type scanner such as the Wasp types the code and Enter) or what the
 *     camera read; both come here as the same text;
 *   - a plain UPC (12 digits), EAN (13 or 8) or case code (GTIN-14, the 14 digits on the box) says only WHAT the item is;
 *   - a supplier's GS1-128 label (the long barcode with numbers in brackets under it) also carries, in one scan: (01) the item,
 *     (10) the lot, (11) made, (13) packed, (15) best by, (17) use by, (37) the count, (00) the pallet ID, (400) the PO;
 *   - a keyboard-type scanner may drop the invisible separator after a lot; the Wasp can be set to type it as | or ~, and
 *     either is read as the separator. Without one, a lot runs to the end of the scan (labels nearly always put it last);
 *   - every item code is kept as 14 digits (gtinKey), so a UPC and the same item's 14-digit code match.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.UDScan = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var GS = String.fromCharCode(29);
  var SEPARATORS = [GS, '|', '~'];
  // GS1 Application Identifiers Receiving uses: [AI, fixed length (0 = up to max), max, field name].
  var AIS = [
    ['00', 18, 18, 'sscc'], ['01', 14, 14, 'gtin'], ['02', 14, 14, 'contentGtin'], ['10', 0, 20, 'lot'], ['11', 6, 6, 'made'],
    ['13', 6, 6, 'packed'], ['15', 6, 6, 'bestBy'], ['16', 6, 6, 'sellBy'], ['17', 6, 6, 'useBy'], ['21', 0, 20, 'serial'],
    ['30', 0, 8, 'count'], ['37', 0, 8, 'count'], ['240', 0, 30, 'extra'], ['400', 0, 30, 'po']
  ];
  var DATES = ['made', 'packed', 'bestBy', 'sellBy', 'useBy'];

  function text(v) { return v === null || v === undefined ? '' : String(v).trim(); }
  function digits(v) { return /^\d+$/.test(v); }

  // The last digit of every UPC / EAN / GTIN / SSCC checks the others.
  function checkDigitOk(code) {
    if (!digits(code) || code.length < 8) return false;
    var sum = 0, n = code.length;
    for (var i = n - 2, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += Number(code[i]) * w;
    return (10 - sum % 10) % 10 === Number(code[n - 1]);
  }
  // Any UPC-A (12), EAN-13, EAN-8 or GTIN-14 as 14 digits; '' when it is not a good item code.
  function gtinKey(v) {
    var c = text(v).replace(/[\s-]/g, '');
    if (!digits(c) || [8, 12, 13, 14].indexOf(c.length) < 0 || !checkDigitOk(c)) return '';
    return ('00000000000000' + c).slice(-14);
  }
  // A case code (GTIN-14) is its unit's code with a packing digit in front and a new check digit; this is the shared middle,
  // so a case scan can say which unit UPC it holds.
  function itemCore(v) { var k = gtinKey(v); return k ? k.slice(1, 13) : ''; }

  // YYMMDD to 2026-10-08. Day 00 means the end of that month (GS1). A two-digit year more than 50 years ahead is last century.
  function gs1Date(v, now) {
    if (!/^\d{6}$/.test(v)) return '';
    var yy = Number(v.slice(0, 2)), mm = Number(v.slice(2, 4)), dd = Number(v.slice(4, 6));
    if (mm < 1 || mm > 12) return '';
    var thisYear = (now || new Date()).getFullYear(), century = Math.floor(thisYear / 100) * 100, year = century + yy;
    if (year - thisYear > 50) year -= 100; else if (thisYear - year >= 50) year += 100;
    var last = new Date(Date.UTC(year, mm, 0)).getUTCDate();
    if (dd === 0) dd = last;
    if (dd > last) return '';
    return year + '-' + ('0' + mm).slice(-2) + '-' + ('0' + dd).slice(-2);
  }
  // 2026-10-08 to 10-8-26 (Joe's dates everywhere).
  function shortDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text(iso));
    return m ? Number(m[2]) + '-' + Number(m[3]) + '-' + m[1].slice(2) : '';
  }

  function aiAt(s, i) {
    for (var k = 0; k < AIS.length; k++) if (s.substr(i, AIS[k][0].length) === AIS[k][0]) return AIS[k];
    // Net weight: 310n kilograms, 320n pounds, n decimals.
    var w = /^3([12])0(\d)/.exec(s.substr(i, 4));
    if (w) return [s.substr(i, 4), 6, 6, w[1] === '1' ? 'netKg' : 'netLb', Number(w[2])];
    return null;
  }
  function put(out, ai, raw, now) {
    var f = ai[3];
    if (DATES.indexOf(f) >= 0) { out[f] = gs1Date(raw, now); return !!out[f]; }
    if (f === 'count') { out.count = digits(raw) ? Number(raw) : null; return out.count !== null; }
    if (f === 'netKg' || f === 'netLb') { out[f] = digits(raw) ? Number(raw) / Math.pow(10, ai[4]) : null; return out[f] !== null; }
    if (f === 'gtin' || f === 'contentGtin') { out[f] = gtinKey(raw); return !!out[f]; }
    if (f === 'sscc') { out.sscc = checkDigitOk(raw) ? raw : ''; return !!out.sscc; }
    out[f] = raw;
    return true;
  }
  // "(01)10614141000415(10)C2610A(17)270401" as printed under the barcode, or typed by hand.
  function parseBrackets(s, out, now) {
    var re = /\((\d{2,4})\)([^(]*)/g, m, any = false;
    while ((m = re.exec(s))) {
      var ai = aiAt(m[1], 0);
      if (!ai || ai[0] !== m[1]) return false;
      var v = m[2].trim();
      if ((ai[1] && v.length !== ai[1]) || v.length > ai[2] || !put(out, ai, v, now)) return false;
      any = true;
    }
    return any;
  }
  // The element string a scanner types: AIs back to back, a variable one ending at a separator or the end.
  function parseElements(s, out, now) {
    var i = 0;
    while (i < s.length) {
      if (SEPARATORS.indexOf(s[i]) >= 0) { i++; continue; }
      var ai = aiAt(s, i);
      if (!ai) return false;
      i += ai[0].length;
      var v;
      if (ai[1]) { v = s.substr(i, ai[1]); if (v.length !== ai[1]) return false; i += ai[1]; }
      else {
        var end = i;
        while (end < s.length && end - i < ai[2] && SEPARATORS.indexOf(s[end]) < 0) end++;
        v = s.slice(i, end); i = end;
        if (!v) return false;
      }
      if (!put(out, ai, v, now)) return false;
    }
    return true;
  }

  // One scan to { kind: 'GS1' | 'ITEM' | 'OTHER', gtin, lot, made, packed, bestBy, useBy, count, sscc, po, ... , raw }.
  function parseScan(raw, now) {
    var s = String(raw === null || raw === undefined ? '' : raw).replace(/[\r\n\t]+$/g, '').replace(/^[\r\n\t ]+|[ ]+$/g, '');
    var out = { kind: 'OTHER', raw: s.replace(new RegExp(GS, 'g'), '|') };
    if (!s) return out;
    // A scanner set to send the barcode type first: ]C1 = GS1-128, ]d2 = GS1 DataMatrix, ]Q3 = GS1 QR, ]E0 = UPC / EAN.
    var sym = /^\][A-Za-z]\d/.exec(s);
    if (sym) s = s.slice(3);
    if (s[0] === GS) s = s.slice(1);
    var plain = s.replace(/[\s-]/g, '');
    if (gtinKey(plain)) {
      out.kind = 'ITEM'; out.gtin = gtinKey(plain); return out;
    }
    var g = {};
    if ((s.indexOf('(') >= 0 ? parseBrackets(s, g, now) : parseElements(s, g, now)) && (g.gtin || g.sscc)) {
      for (var k in g) out[k] = g[k];
      out.kind = 'GS1';
      return out;
    }
    return out;
  }

  // What one scan adds: a pallet label's count, else one case.
  function scanQuantity(p) { return p && p.count > 0 ? p.count : 1; }

  return { GS: GS, AIS: AIS, checkDigitOk: checkDigitOk, gtinKey: gtinKey, itemCore: itemCore, gs1Date: gs1Date, shortDate: shortDate,
    parseScan: parseScan, scanQuantity: scanQuantity };
});

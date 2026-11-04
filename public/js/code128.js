/*
 * Code 128 (set B) barcodes for Inventory's Zebra labels (Joe 11-4-26, mock-up F). Every scanner reads Code 128, the Wasp
 * included. encode(text) gives the bar and space widths; svg(text) draws them, black on white, with the quiet zones.
 * Shared by the browser (window.UDCode128) and the unit check (module.exports).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.UDCode128 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  // Widths of bar, space, bar, space, bar, space for symbol values 0 to 106 (106 = stop, with its last bar).
  var P = ['212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
    '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
    '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
    '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
    '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
    '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
    '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
    '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
    '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
    '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
    '114131', '311141', '411131', '211412', '211214', '211232', '2331112'];
  var START_B = 104, STOP = 106;

  // The symbol values: start B, each character, the check value, stop. Only printable ASCII (space to ~).
  function values(text) {
    var s = String(text === null || text === undefined ? '' : text), out = [START_B], sum = START_B;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 32 || c > 126) throw new Error('A label code can only use plain letters, digits and signs.');
      out.push(c - 32);
      sum += (c - 32) * (i + 1);
    }
    out.push(sum % 103);
    out.push(STOP);
    return out;
  }
  // The widths in modules, bar first, alternating bar and space.
  function encode(text) {
    var w = [];
    values(text).forEach(function (v) { P[v].split('').forEach(function (d) { w.push(Number(d)); }); });
    return w;
  }
  function svg(text, opts) {
    var o = opts || {}, h = o.height || 100, quiet = 10, w = encode(text), x = quiet, rects = '';
    w.forEach(function (n, i) { if (i % 2 === 0) rects += '<rect x="' + x + '" y="0" width="' + n + '" height="' + h + '"/>'; x += n; });
    var total = x + quiet;
    return '<svg xmlns="http://www.w3.org/2000/svg" class="code128" viewBox="0 0 ' + total + ' ' + h + '" preserveAspectRatio="none" role="img" aria-label="Barcode ' +
      String(text).replace(/[<>&"]/g, '') + '"><rect width="' + total + '" height="' + h + '" fill="#fff"/><g fill="#000">' + rects + '</g></svg>';
  }
  return { PATTERNS: P, values: values, encode: encode, svg: svg };
});

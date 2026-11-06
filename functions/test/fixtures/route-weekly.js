// A made-up ROUTE WEEKLY CASE DELIVERY REVIEW BY STORE (MIS's weekly report) as an .xls, for the tests. Made-up stores only.
'use strict';
const X = require('@e965/xlsx');
const TITLE = 'ROUTE WEEKLY CASE DELIVERY REVIEW BY STORE';

// layout 'july' puts one more empty column before each store row, as Joe's July export did.
function sampleXls(week, layout) {
  const pad = layout === 'july' ? ['', ''] : [''];
  const rows = [
    ['', TITLE, '', 'WK ENDING', new Date(week + 'T12:00:00')],
    ['UNIONTOWN'],
    pad.concat([805, 0, 1001, 'MADEUP GOLF CENTER', 0, 0, 12.5, 0, 9, 0, 14, 3, 410.2, 11.8]),
    pad.concat([805, 411, 1002, 'SAMPLE FOOD MART', 0, 0, 0, 0, 6, 0, 0, 1, 99.5, 6]),
    ['TOTALS FOR ROUTE 805', 0, 0, 12.5, 0, 15, 0, 14, 4, 509.7, 10.4],
    pad.concat([6301, 990, 9001, 'PRETEND MART #9001', 0, 120, 0, 130, 0, 9e-16, 0, 2, 5000, 125])
  ];
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(rows, { cellDates: true }), 'Sheet1');
  return X.write(wb, { type: 'buffer', bookType: 'xls' });
}
module.exports = { sampleXls, TITLE };

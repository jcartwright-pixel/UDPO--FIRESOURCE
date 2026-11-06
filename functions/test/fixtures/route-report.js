'use strict';
// A made-up weekly route report (Weekly route report tests), laid out like the Crystal report ROUTE WEEKLY CASE DELIVERY
// REVIEW BY STORE that comes in Vicki's Wednesday email: a title line with the week-ending date, then for each route its
// stop lines (route, chain, customer number, name, Sun..Sat cases, deliveries, sales, average) and a total line. Every
// name and number is made up.
const XLSX = require('@e965/xlsx');

const serial = (iso) => (Date.parse(iso + 'T00:00:00Z') - Date.UTC(1899, 11, 30)) / 864e5;

/**
 * opts: weekEnding (yyyy-mm-dd), weeks (several week endings in one file), breakRoute (a route whose total is off by 5 cases),
 * invoices (the total lines count 1 more delivery than the stops, as the real report's invoice count does), bookType ('biff8' = .xls).
 */
function routeReport(opts) {
  const o = Object.assign({ weekEnding: '2026-10-31', bookType: 'biff8' }, opts || {});
  const routes = {
    801: [[0, 1001, 'SAMPLE MARKET #1', [0, 20, 0, 18, 0, 22, 0], 3, 1200.5], [12, 1002, 'MADE-UP DELI', [0, 5, 0, 0, 0, 6, 0], 2, 310.25]],
    805: [[0, 2001, 'EXAMPLE GROCERY', [0, 0, 40, 0, 0, 0, 35], 2, 2400], [0, 2002, 'TEST SCHOOL', [0, 0, 0, 0, 0, 0, 0], 0, -15]]
  };
  const rows = [];
  for (const weekEnding of o.weeks || [o.weekEnding]) {
  rows.push(['', '', 'UNITED DAIRY'], ['ROUTE WEEKLY CASE DELIVERY REVIEW BY STORE', '', 'Week Ending', serial(weekEnding)], ['UNIONTOWN'],
    ['Route', 'Chain', 'Cust', 'Name', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', '# Delv', 'Sales', 'Avg']);
  Object.keys(routes).forEach((r, k) => {
    const t = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    routes[r].forEach(([chain, no, name, days, delv, sales]) => {
      const cases = days.reduce((a, b) => a + b, 0);
      rows.push([Number(r), chain, no, name, '', ...days, delv, sales, delv ? cases / delv : 0]);
      days.forEach((v, i) => { t[i] += v; }); t[7] += delv; t[8] += sales;
    });
    if (Number(r) === o.breakRoute) t[1] += 5;
    if (o.invoices) t[7] += 1;
    const cases = t.slice(0, 7).reduce((a, b) => a + b, 0), avg = t[7] ? cases / t[7] : 0;
    // The first route's total is on one line; the second's numbers drop to the next line, as the email's layout does.
    if (k === 0) rows.push(['TOTALS FOR ROUTE ' + r, ...t, avg]);
    else rows.push(['TOTALS FOR ROUTE ' + r], ['', ...t, avg]);
    rows.push([]);
  });
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Report');
  return XLSX.write(wb, { type: 'buffer', bookType: o.bookType });
}

module.exports = { routeReport };

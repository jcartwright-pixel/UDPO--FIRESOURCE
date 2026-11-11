'use strict';
// A made-up monthly accounting package (Accounting Numbers tests): one P&L Expenses by Dept month tab and one Gallon
// Comparison tab, laid out as accounting's files are, zipped like the real package. Every number is made up.
const XLSX = require('@e965/xlsx');
const JSZip = require('jszip');

// garage: the GAR column of a line (the rest of DELIVERY is DM). A label ending in ':' is a heading, as on the real tab.
function expensesBook(tab, title, lines, garage) {
  const g = garage || {};
  const rows = [[title], ['', 'GAR', 'DM', 'DIC', 'DELIVERY'], ['Operating Expenses:']];
  Object.keys(lines).forEach(l => rows.push([l, g[l] || 0, lines[l] - (g[l] || 0), 0, lines[l]]));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), tab);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
function gallonsBook(year, monthly) {
  const rows = [['Gallon Comparison'], ['', year, '', '', year - 1, '', ''], ['', 'Sales', 'Transfers', 'Total', 'Sales', 'Transfers', 'Total']];
  // Sales are 70% of the total, transfers the rest.
  ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'].forEach((m, i) => {
    const t = monthly[i] || 0;
    rows.push([m, Math.round(t * 0.7), t - Math.round(t * 0.7), t, 0, 0, 0]);
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), year + '-' + (year - 1));
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// P&L Comparison vs. last month: last month and this month under a row of dates; Net Sales and Cost of Material in dollars.
function comparisonBook(tab, last, now) {
  const rows = [['UNITED/UNIONTOWN', '', '2026 VS LAST MONTH'], ['P & L COMPARISON'], ['', '', last.date, now.date, 'Variance +(-)'], [],
    ['TOTAL GALLONS SOLD', '', 1, 1, 0], [], ['Net Sales', '', last.sales, now.sales], ['Cost of Material', '', last.material, now.material]];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), tab);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/** {buffer, months}: the September 2026 made-up package. */
async function septemberZip(opts) {
  const o = opts || {};
  const lines = { 'Salaries': 100000, 'Hourly Wages': 150000, 'O.T. Wages': 20000, 'Pension': 5000, 'Workmans Comp. Ins.': 8000, 'Group Insurance': 30000, 'Payroll Taxes': 12000, 'Gasoline': o.gas || 90000, 'Tires': 6000 };
  const zip = new JSZip();
  lines['Truck Rental'] = 80000;
  if (!o.noRepairs) lines['Repairs & Maint.  '] = 15000; // accounting's names can end in spaces
  lines['Totals'] = o.total || 600000;
  const garage = { 'Hourly Wages': 14000, 'Repairs & Maint.  ': o.noRepairs ? 0 : 2000, 'Totals': o.noRepairs ? 14000 : 16000 };
  zip.file('X P & L Expenses by Dept - 2026.xlsx', expensesBook('SEPT 2026', 'SEPTEMBER  26', lines, garage));
  zip.file('x P & L Comparison vs.last month 25 vs 26.xlsx', comparisonBook('September 2026',
    { date: new Date(2026, 7, 1), sales: 6400000.25, material: 4500000 }, { date: new Date(2026, 8, 1), sales: o.sales || 6200000.5, material: 4100000 }));
  zip.file('x Gallon Comparison 2025-2026.xlsx', gallonsBook(2026, [0, 0, 0, 0, 0, 0, 0, 2000000, 2100000]));
  zip.file('__MACOSX/._junk.xlsx', 'not a workbook');
  return zip.generateAsync({ type: 'nodebuffer' });
}

module.exports = { septemberZip };

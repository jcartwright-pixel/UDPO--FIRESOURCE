'use strict';
// A made-up monthly accounting package (Accounting Numbers tests): one P&L Expenses by Dept month tab and one Gallon
// Comparison tab, laid out as accounting's files are, zipped like the real package. Every number is made up.
const XLSX = require('@e965/xlsx');
const JSZip = require('jszip');

function expensesBook(tab, title, lines) {
  const rows = [[title], ['', 'GAR', 'DM', 'DIC', 'DELIVERY']];
  Object.keys(lines).forEach(l => rows.push([l, 0, 0, 0, lines[l]]));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), tab);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
function gallonsBook(year, monthly) {
  const rows = [['Gallon Comparison'], ['', year, '', '', year - 1, '', ''], ['', 'Sales', 'Transfers', 'Total', 'Sales', 'Transfers', 'Total']];
  ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'].forEach((m, i) => rows.push([m, 0, 0, monthly[i] || 0, 0, 0, 0]));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), year + '-' + (year - 1));
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/** {buffer, months}: the September 2026 made-up package. */
async function septemberZip(opts) {
  const o = opts || {};
  const lines = { 'Salaries': 100000, 'Hourly Wages': 150000, 'O.T. Wages': 20000, 'Pension': 5000, 'Workmans Comp. Ins.': 8000, 'Group Insurance': 30000, 'Payroll Taxes': 12000, 'Gasoline': o.gas || 90000, 'Tires': 6000, 'Totals': o.total || 600000 };
  const zip = new JSZip();
  zip.file('X P & L Expenses by Dept - 2026.xlsx', expensesBook('SEPT 2026', 'SEPTEMBER  26', lines));
  zip.file('x Gallon Comparison 2025-2026.xlsx', gallonsBook(2026, [0, 0, 0, 0, 0, 0, 0, 2000000, 2100000]));
  zip.file('__MACOSX/._junk.xlsx', 'not a workbook');
  return zip.generateAsync({ type: 'nodebuffer' });
}

module.exports = { septemberZip };

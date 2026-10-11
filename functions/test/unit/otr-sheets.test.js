'use strict';
// The Month Recap and Cost Per Gallon tabs of Joe's OTR Trips 2026 workbook, worked out the workbook's way.
const test = require('node:test');
const assert = require('node:assert/strict');
const O = require('../../src/otr-core');

// Jan-Jun 2026 and 2025 from his Recap tab (gallons sold, delivery cost, fuel cost).
const RECAP = {
  2026: [[2493121, 732424, 118292], [2152019, 632497, 98909], [2536047, 775613, 172745], [2495280, 799103, 214343], [2494910, 749949, 161702], [2568879, 767760, 167715]],
  2025: [[2556329, 731704, 118292], [2313590, 688500, 122736], [2565580, 728332, 128557], [2488691, 728602, 140393], [2561853, 768821, 150380], [2572721, 667096, 135545]]
};
const figures = [];
Object.keys(RECAP).forEach(y => RECAP[y].forEach((r, i) => figures.push({ year: Number(y), month: i + 1, gallons_sold: r[0], distribution_cost: r[1], fuel_cost: r[2] })));

test('Cost Per Gallon: the same numbers and signs as the workbook tab', () => {
  const c = O.otrCostSheet_(2026, figures), jan = c.months[0], feb = c.months[1];
  assert.equal(jan.galDiff, -63208);
  assert.equal(jan.costDiff, -720, 'Dist. Cost Difference = last year - this year: ($720)');
  assert.equal(jan.cpg[0].toFixed(5), '0.29378');
  assert.equal(jan.vari.toFixed(5), '-0.00755');
  assert.equal(Math.round(jan.costDiffMoney), -19289);
  assert.equal(Math.round(feb.costDiffMoney), 8516);
  assert.equal(c.months[6].gal[0], null, 'July has no figures yet');
  assert.deepEqual(c.ytd.gal, [14740256, 15058764]);
  assert.equal(c.ytd.galDiff, -318508);
  assert.equal(c.ytd.costDiff, -144291);
  assert.equal(c.ytd.cpg[0].toFixed(5), '0.30220', 'year to date = the average of the months, as the tab shows');
  assert.equal(c.ytd.cpg[1].toFixed(5), '0.28665');
  assert.equal(Math.round(c.ytd.costDiffMoney), -238540);
  assert.equal(jan.fuel[0].toFixed(3), '0.047');
  assert.equal(c.fuel.avg[0].toFixed(3), '0.063');
  assert.equal(c.fuel.avg[1].toFixed(3), '0.053');
  assert.equal(c.fuel.total[0].toFixed(3), '0.378');
  assert.equal(c.fuel.total[1].toFixed(3), '0.317');
});

test('Month Recap: last December first, this year beside last year, months not reached yet stay empty', () => {
  const daily = {
    '2024-12-03': { SAL: 2 }, '2025-12-02': { SAL: 1, Jersey: 1 }, '2025-01-05': { SAL: 3 }, '2026-01-04': { SAL: 2 },
    '2026-02-10': { Peck: 1 }, '2025-11-11': { Peck: 4 }, '2026-01-20': { 'UT WALMART': 1 }
  };
  const r = O.otrMonthRecap_(2026, '2026-02-15', daily, [], [{ year: 2026, month: 1, miles: 5000, fuel_fills: 12 }, { year: 2025, month: 1, miles: 4000 }]);
  assert.deepEqual(r.months.slice(0, 2).map(m => [m.label, m.y, m.py]), [['Dec', 2025, 2024], ['Jan', 2026, 2025]]);
  const sal = r.rows.find(x => x.name === 'SAL');
  assert.deepEqual(sal.cells[0], [1, 2], 'Dec 2025 vs Dec 2024');
  assert.deepEqual(sal.cells[1], [2, 3], 'Jan 2026 vs Jan 2025');
  assert.deepEqual(sal.cells[3], [null, 0], 'March is not reached yet');
  assert.equal(r.rows.length, O.OTR_CORE.DESTINATIONS.length + 1, 'all 21 workbook columns, plus a name that has runs');
  assert.ok(r.rows.find(x => x.name === 'UT WALMART'));
  assert.deepEqual(r.totals[0], [2, 2]);
  assert.deepEqual(r.totals[1], [3, 3]);
  assert.deepEqual(r.diff.slice(0, 4), [0, 0, 1, null]);
  assert.deepEqual(r.extra.find(x => x.name === 'Miles Driven').cells[1], [5000, 4000]);
  assert.deepEqual(r.extra.find(x => x.name === 'Tank fills').cells[1], [12, null]);
  assert.deepEqual(r.ytd, { current: 4, prior: 3, through: 2 });
  assert.deepEqual(r.latest, { label: 'Feb 2026', current: 1, prior: 0 });
  assert.deepEqual(r.busiest, ['SAL', 'Peck', 'UT WALMART']);
  const later = O.otrMonthRecap_(2026, '2026-03-20', daily, [], []);
  assert.deepEqual(later.rows.find(x => x.name === 'SAL').cells[3], [0, 0], 'March is reached, nothing counted yet');
  assert.deepEqual([later.ytd.through, later.latest.label], [2, 'Feb 2026'], 'a reached month with no runs yet does not count in year to date');
});

test('Import: the By Date Comment column comes in with its day, and saves in its own batch', () => {
  const values = [['Date', 'SAL', 'Jersey', 'Reinhart', 'Comment'], [new Date(2021, 4, 25), 2, '', 1, 'Lost 5 Walmart Rts'], [new Date(2021, 4, 26), 1, 1, '', '']];
  const p = O.otrParseImport_(values, 2021, 'By Date');
  assert.equal(p.kind, 'BY_DATE');
  assert.deepEqual(p.comments, [{ date: '2021-05-25', text: 'Lost 5 Walmart Rts' }]);
  const merged = O.otrMergeImport_([p]);
  assert.equal(merged.comments.length, 1);
  assert.ok(O.otrImportSummary_(merged, []).some(l => l.what === 'Comments (By Date)'));
  const batches = O.otrImportBatches_(merged);
  assert.deepEqual(batches.map(b => [b.figures.length, b.daily.length, b.comments.length]), [[0, 4, 0], [0, 0, 1]]);
});

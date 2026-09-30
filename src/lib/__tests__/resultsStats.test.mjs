// The Results tab must rank and average on the score it shows, not on the
// count of picked items underneath it.
//
//   npm run test:results-stats

import { scoreFraction, compareByScore, resultStatistics } from '../resultsStats.js';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

// Three real MATH 117 RETAKE rows: 9 picked items worth 1 each, 58 worked marks.
const full9low = { score: 9, total_items: 9, points_earned: 9, points_total: 9, work_marks: 11, work_total: 58 };  // 20/67
const eight = { score: 8, total_items: 9, points_earned: 8, points_total: 9, work_marks: 40, work_total: 58 };     // 48/67
const top = { score: 9, total_items: 9, points_earned: 9, points_total: 9, work_marks: 51, work_total: 58 };       // 60/67

console.log('=== the fraction is the shown score ===');
check('9/9 picked + 11/58 worked is 20/67, not 100%',
  Math.abs(scoreFraction(full9low) - 20 / 67) < 1e-9, String(scoreFraction(full9low)));
check('a paper with no worked items is unchanged',
  scoreFraction({ score: 18, total_items: 20 }) === 0.9);
check('a paper waiting on worked marks has no fraction',
  scoreFraction({ score: 9, total_items: 9, points_earned: 9, points_total: 9, work_marks: null, work_total: 58 }) === null);
check('a paper worth nothing has no fraction', scoreFraction({ score: 0, total_items: 0 }) === null);

console.log('\n=== sorting ===');
{
  const pending = { score: 9, total_items: 9, work_marks: null, work_total: 58 };
  const desc = [full9low, pending, top, eight].sort((a, b) => compareByScore(a, b, 'desc'));
  check('highest first is 60, 48, 20 — the count would put both 9/9 rows on top',
    desc[0] === top && desc[1] === eight && desc[2] === full9low, JSON.stringify(desc.map(scoreFraction)));
  check('a paper still to mark goes last', desc[3] === pending);
  const asc = [top, pending, full9low, eight].sort((a, b) => compareByScore(a, b, 'asc'));
  check('lowest first is 20, 48, 60 with the unmarked paper still last',
    asc[0] === full9low && asc[1] === eight && asc[2] === top && asc[3] === pending);
}

console.log('\n=== statistics ===');
{
  const s = resultStatistics([full9low, eight, top]);
  check('highest is 60/67, not 100%', Math.abs(s.highest - (60 / 67) * 100) < 1e-9, String(s.highest));
  check('mean is of the shown scores', Math.abs(s.mean - ((20 + 48 + 60) / 3 / 67) * 100) < 1e-9, String(s.mean));
  check('pass rate: only 60/67 (89.6%) passes', Math.abs(s.passRate - 100 / 3) < 1e-9, String(s.passRate));
  check('every row lands in a bracket', s.distribution.reduce((a, b) => a + b.count, 0) === 3);
}
{
  // 33/67 = 49.25% sat in the gap between 0–49 and 50–59 and fell off the chart.
  const between = { score: 0, total_items: 0, points_earned: 0, points_total: 9, work_marks: 33, work_total: 58 };
  const edge = { score: 0, total_items: 0, points_earned: 0, points_total: 9, work_marks: 50, work_total: 58 };  // 74.6%
  const s = resultStatistics([between, edge, { score: 10, total_items: 10 }]);
  const count = (label) => s.distribution.find(b => b.label === label).count;
  check('49.25% counts in 0–49', count('0–49%') === 1);
  check('74.6% counts in 70–74, not passing', count('70–74%') === 1 && Math.abs(s.passRate - 100 / 3) < 1e-9);
  check('100% counts in 90–100', count('90–100%') === 1);
}
{
  const s = resultStatistics([top, { score: 5, total_items: 9, work_marks: null, work_total: 58 }]);
  check('a paper waiting on marks is left out and counted as pending', s.n === 1 && s.pending === 1);
  check('nothing scored is no statistics', resultStatistics([{ score: 1, total_items: 9, work_total: 58 }]) === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

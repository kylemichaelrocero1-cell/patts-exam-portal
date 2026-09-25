// A paper with worked items is marked in two halves — the picked items by
// Postgres at submit, the worked ones by an instructor later — so for a while
// it is genuinely half-marked. These pin how that is shown, because the
// tempting shortcuts are both wrong: scoring out of the marked total makes a
// mark look as though it was taken away when the rest arrives, and treating an
// unmarked item as zero tells a student they failed something nobody has read.
//
//   npm run test:worked-shape

import {
  isWorkedSolution, linesOf, hasWork, combinedScore, workMarksAvailable,
} from '../workedShape.js';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('=== shapes ===');
check('the worked type is recognised', isWorkedSolution({ question_type: 'worked_solution' }));
check('and nothing else is',
  !isWorkedSolution({ question_type: 'essay' }) && !isWorkedSolution({}) && !isWorkedSolution(null));
check('lines read from either shape',
  eq(linesOf({ lines: ['a', 'b'] }), ['a', 'b']) && eq(linesOf(['a']), ['a']));
check('a bare string is one line', eq(linesOf('y=5x'), ['y=5x']));
check('nothing is no lines', eq(linesOf(null), []) && eq(linesOf({}), []));
check('whitespace is not work', !hasWork({ lines: ['', '   '] }) && hasWork({ lines: ['x'] }));

console.log('\n=== a paper with no worked items behaves exactly as before ===');
{
  const r = combinedScore({ score: 18, total_items: 20 });
  check('the score is untouched', r.score === 18 && r.total === 20, JSON.stringify(r));
  check('the percentage is untouched', r.pct === 90);
  check('nothing is pending', r.pending === 0 && r.marked);
}
check('a paper scored out of nothing has no percentage rather than a crash',
  combinedScore({ score: 0, total_items: 0 }).pct === null);
check('an empty row does not throw',
  combinedScore(null).score === 0 && combinedScore(undefined).total === 0);

console.log('\n=== an item may be worth more than one point (sql/025) ===');
{
  const r = combinedScore({ score: 2, total_items: 4, points_earned: 7, points_total: 11 });
  check('the weighted sum wins over the count when it is there',
    r.score === 7 && r.total === 11, JSON.stringify(r));
  check('and the percentage is of the points', r.pct === 64, String(r.pct));
}
{
  const r = combinedScore({ score: 40, total_items: 50 });
  check('a row written before 025 falls back to its count, unrestated',
    r.score === 40 && r.total === 50 && r.pct === 80, JSON.stringify(r));
}
check('points_total of 0 is a real paper with no picked items, not a missing value',
  (() => { const r = combinedScore({ score: 0, total_items: 0, points_earned: 0, points_total: 0 });
           return r.score === 0 && r.total === 0 && r.pct === null; })());
check('earning no points is not the same as having none recorded',
  (() => { const r = combinedScore({ score: 0, total_items: 4, points_earned: 0, points_total: 11 });
           return r.score === 0 && r.total === 11 && r.pct === 0; })());
check('weighted picked items and pending working add up',
  (() => { const r = combinedScore({ score: 2, total_items: 4, points_earned: 7, points_total: 11, work_total: 3 });
           return r.score === 7 && r.total === 14 && r.pending === 3 && r.pct === null; })(),
  JSON.stringify(combinedScore({ score: 2, total_items: 4, points_earned: 7, points_total: 11, work_total: 3 })));
check('and once the working is marked, everything is one number',
  (() => { const r = combinedScore({ score: 2, total_items: 4, points_earned: 7, points_total: 11, work_marks: 3, work_total: 3 });
           return r.score === 10 && r.total === 14 && r.pending === 0; })());

console.log('\n=== marked worked items are added in ===');
{
  const r = combinedScore({ score: 12, total_items: 15, work_marks: 4, work_total: 5 });
  check('the two halves are summed', r.score === 16 && r.total === 20, JSON.stringify(r));
  check('and the percentage is of the whole', r.pct === 80);
  check('nothing is pending once marked', r.pending === 0 && r.marked);
}
check('earning nothing on the working is still MARKED, not pending',
  (() => {
    const r = combinedScore({ score: 12, total_items: 15, work_marks: 0, work_total: 5 });
    return r.score === 12 && r.total === 20 && r.pending === 0 && r.marked && r.pct === 60;
  })());

console.log('\n=== unmarked worked items are pending, not zero ===');
{
  const r = combinedScore({ score: 12, total_items: 15, work_marks: null, work_total: 5 });
  check('the total already includes them, so the mark can only go up',
    r.score === 12 && r.total === 20, JSON.stringify(r));
  check('5 marks are flagged as pending', r.pending === 5 && !r.marked);
  check('and there is NO percentage for a half-marked paper — it would mislead',
    r.pct === null);
}
check('undefined work_marks is pending too, not treated as a zero',
  combinedScore({ score: 1, total_items: 2, work_total: 3 }).pending === 3);

console.log('\n=== marks available on a paper ===');
check('worked items are summed, others ignored',
  workMarksAvailable([
    { question_type: 'worked_solution', marks: 3 },
    { question_type: 'worked_solution', marks: 2 },
    { question_type: 'multiple_choice', marks: 1 },
    { question_type: 'essay' },
  ]) === 5);
check('a worked item with no marks stated counts as one',
  workMarksAvailable([{ question_type: 'worked_solution' }]) === 1);
check('a paper with no worked items has none',
  workMarksAvailable([{ question_type: 'multiple_choice', marks: 1 }]) === 0
  && workMarksAvailable([]) === 0 && workMarksAvailable(null) === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

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
  finalLineOf, workedKeyOf, workedItemStats,
  gradeBaseOf, gradeBaseFor, gradeOf, gradeVerdict, withGradeBases,
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

console.log('\n=== the item analysis for a worked item ===');
{
  check('the marked line is the last one with anything on it',
    finalLineOf({ lines: ['2x+2', '  ', ''] }) === '2x+2'
    && finalLineOf({ lines: [' 6 '] }) === '6' && finalLineOf(null) === '');

  const q = {
    id: 'q6', marks: 2,
    work_rubric: { steps: [{ latex: 'f(x)=x^2' }, { latex: '6' }], accept: ['6', ' 6.0 ', ''] },
  };
  check('the key is the last step, and the accept list without it or blanks',
    eq(workedKeyOf(q), { model: '6', accepted: ['6.0'] }));
  check('an item with no rubric has an empty key, not a crash',
    eq(workedKeyOf({}), { model: '', accepted: [] }));

  const w = (line, marks, extra = {}) => ({ q6: { type: 'worked', lines: [line], marks, of: 2, ...extra } });
  const s = workedItemStats(q, [
    w('6', 2), w('6', 2), w('6', 2),
    w('0/0', 0), w('0/0', 0),
    w('3', 1),                                          // part marks
    { q6: { type: 'worked', lines: ['9'], marks: 2, total: 2 } }, // an instructor override
    w('x+3', null),                                     // not marked yet
    { q6: { type: 'worked', lines: ['', ' '] } },       // left blank
    {},                                                 // never touched it
  ]);
  check('everyone who sat the paper is counted', s.sat === 10);
  check('full marks, from the marks — an override with no correct flag counts',
    s.full === 4, JSON.stringify(s));
  check('part marks are neither right nor wrong', s.partial === 1);
  check('no marks', s.zero === 2);
  check('an unmarked answer is pending, not wrong', s.pending === 1);
  check('a blank line and a missing item are both blank', s.blank === 2);
  check('answers are grouped by what was written, most common first',
    eq(s.groups.map(g => [g.latex, g.count]), [['6', 3], ['0/0', 2], ['3', 1], ['9', 1], ['x+3', 1]]));
  check('each group knows how it was marked',
    s.groups[0].full === 3 && s.groups[1].zero === 2 && s.groups[4].pending === 1);
  check('nobody sat it: all zero, no groups',
    eq(workedItemStats(q, []), { sat: 0, blank: 0, pending: 0, full: 0, partial: 0, zero: 0, groups: [] }));
}

console.log('\n=== grade base (sql/138) ===');
{
  check('a paper with no base is on 0-base', gradeBaseOf({}) === 0 && gradeBaseOf(null) === 0);
  check('only 50 means 50-base', gradeBaseOf({ grade_base: 50 }) === 50 && gradeBaseOf({ grade_base: 25 }) === 0);

  const zero = gradeOf(30, 60, 0), fifty = gradeOf(30, 60, 50);
  check('half marks on 0-base is 50%, failed', zero.pct === 50 && zero.passed === false, JSON.stringify(zero));
  check('half marks on 50-base is 75%, passed', fifty.pct === 75 && fifty.passed === true, JSON.stringify(fifty));
  check('nothing right on 50-base is 50%', gradeOf(0, 60, 50).pct === 50 && gradeOf(0, 60, 50).passed === false);
  check('full marks is 100% on both', gradeOf(60, 60, 0).pct === 100 && gradeOf(60, 60, 50).pct === 100);
  check('a paper worth nothing has no grade', gradeOf(0, 0, 50).pct === null && gradeOf(0, 0, 50).passed === null);

  // Just under the mark must never read as the mark.
  const justUnder = gradeOf(50, 67, 0);
  check('50/67 is 74.6: shown as 74, failed', justUnder.pct === 74 && justUnder.passed === false, JSON.stringify(justUnder));
  const justUnder50 = gradeOf(49, 100, 50);
  check('49/100 on 50-base is 74.5: shown as 74, failed', justUnder50.pct === 74 && justUnder50.passed === false, JSON.stringify(justUnder50));
  check('exactly 75 passes', gradeOf(75, 100, 0).passed === true && gradeOf(50, 100, 50).passed === true);
  check('other rounding is untouched', gradeOf(2, 3, 0).pct === 67 && gradeOf(1, 3, 0).pct === 33);

  const m = combinedScore({ score: 30, total_items: 60, grade_base: 50 });
  check('the marks stay raw on 50-base', m.score === 30 && m.total === 60 && m.pct === 75 && m.passed === true, JSON.stringify(m));
  const worked = combinedScore({ points_earned: 10, points_total: 20, work_marks: 5, work_total: 10, grade_base: 50 });
  check('worked marks fold in before the base', worked.score === 15 && worked.total === 30 && worked.pct === 75, JSON.stringify(worked));
  const pending = combinedScore({ points_earned: 10, points_total: 20, work_total: 10, grade_base: 50 });
  check('nothing is shown or decided while marks are pending', pending.pct === null && pending.passed === null, JSON.stringify(pending));
  check('a paper with no base reads as it always did', combinedScore({ score: 40, total_items: 50 }).pct === 80);

  check('verdict: passed on 0-base', gradeVerdict({ passed: true, base: 0 }) === 'Passed');
  check('verdict: names 50-base', gradeVerdict({ passed: false, base: 50 }) === 'Failed · 50-base');
  check('verdict: none while pending', gradeVerdict({ passed: null, base: 50 }) === '');
  check('verdict: can always name the base', gradeVerdict({ passed: true, base: 0 }, { showBase: true }) === 'Passed · 0-base'
    && gradeVerdict({ passed: true, base: 50 }, { showBase: true }) === 'Passed · 50-base');

  {
    const exam = { title: 'Look-alike Midterm Examination', grade_base: 50, grade_base_ae: 0 };
    const flipped = { title: 'Look-alike Quiz 1', grade_base: 0, grade_base_ae: 50 };
    for (const c of ['BSAE', "PRE-ENG'G"]) {
      check(`${c} reads the paper's BSAE setting`, gradeBaseFor(exam, c) === 0 && gradeBaseFor(flipped, c) === 50);
    }
    check('another course reads the other setting', gradeBaseFor(exam, 'BSAMT') === 50 && gradeBaseFor(flipped, 'BSTM') === 0);
    check('no course yet counts as other courses', gradeBaseFor(exam, null) === 50 && gradeBaseFor(flipped, undefined) === 0);
    check('a paper from before the second setting has one base for all', gradeBaseFor({ grade_base: 50 }, 'BSAE') === 50);
    check('no paper at all is 0-base', gradeBaseFor(undefined, 'BSAE') === 0 && gradeBaseFor(undefined, 'BSAMT') === 0);
    const same = withGradeBases(
      [{ exam_id: 'x', student_id: 'ae', score: 30, total_items: 60 }, { exam_id: 'x', student_id: 'amt', score: 30, total_items: 60 }],
      [{ id: 'x', ...exam }], id => ({ ae: 'BSAE', amt: 'BSAMT' })[id]);
    check('same paper, same marks, same section: each sees their own percentage',
      combinedScore(same[0]).pct === 50 && combinedScore(same[1]).pct === 75, JSON.stringify(same));
  }

  const rows = withGradeBases(
    [{ exam_id: 'a', score: 1 }, { assessment_id: 'b', score: 2 }, { exam_id: 'gone', score: 3 }],
    [{ id: 'a', grade_base: 50 }, { id: 'b', grade_base: 0 }]);
  check('a result takes its paper\'s base', rows[0].grade_base === 50);
  check('a practice attempt too', rows[1].grade_base === 0);
  check('a paper not in view falls back to 0-base', rows[2].grade_base === 0);
  check('no rows is no rows', withGradeBases(undefined, []).length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

// The Results tab's paper picker: a course first, only papers with results,
// newest first, archived papers only on request.
//
//   npm run test:paper-filter

import { courseOf, paperOptions, resultInView } from '../paperFilter.js';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

console.log('=== the course in a title ===');
for (const [t, c] of [
  ['MATH 117 Quiz 2 — Derivatives', 'MATH 117'], ['Prelim AENG 427', 'AENG 427'], ['ESCI316 Midterm', 'ESCI 316'],
  ['AENG 223L Quiz', 'AENG 223L'], ['Practice Exam', 'Other'], ['Maths Practice', 'Other'], ['', 'Other'], [null, 'Other'],
  ['MATH 1170 Quiz', 'Other'], ['math 117 quiz', 'Other'], ['BSME-301 Lab', 'BSME 301'],
]) check(`${JSON.stringify(t)} → ${c}`, courseOf(t) === c, courseOf(t));

const titles = {
  p1: 'MATH 117 Prelim Examination', p2: 'MATH 117 Quiz 2 — Exponentials', p3: 'MATH 117 Assignment 2',
  p4: 'ESCI 316 Midterm Examination', p5: 'Practice Exam', p6: 'MATH 115 Quiz 3', shared: 'AENG 427 Quiz 2',
};
const meta = {
  p1: { created_at: '2026-09-01', archived_at: '2026-10-01' }, p2: { created_at: '2026-10-21' },
  p3: { created_at: '2026-10-13' }, p4: { created_at: '2026-10-22' }, p5: { created_at: '2026-08-01' },
  p6: { created_at: '2026-10-22' },
};
const counts = { p1: 40, p2: 9, p3: 0, p4: 30, p5: 2, p6: 12, shared: 5 };

console.log('\n=== what is offered ===');
{
  const o = paperOptions({ titles, meta, counts });
  const ids = o.groups.flatMap(g => g.papers.map(p => p.id));
  check('a paper with no results here is not offered (an assignment)', !ids.includes('p3'));
  check('an archived paper is left out, and counted', !ids.includes('p1') && o.hiddenArchived === 1);
  check('grouped by course, Other last', JSON.stringify(o.groups.map(g => g.course)) === JSON.stringify(['AENG 427', 'ESCI 316', 'MATH 115', 'MATH 117', 'Other']),
    JSON.stringify(o.groups.map(g => g.course)));
  check('the courses offered are those with papers shown', JSON.stringify(o.courses) === JSON.stringify(['AENG 427', 'ESCI 316', 'MATH 115', 'MATH 117', 'Other']));
  check('each paper carries its count', o.groups.find(g => g.course === 'MATH 117').papers[0].count === 9);
}
{
  const o = paperOptions({ titles, meta, counts, showArchived: true });
  const m117 = o.groups.find(g => g.course === 'MATH 117').papers.map(p => p.id);
  check('with archived: the prelim is back, after the newer quiz', JSON.stringify(m117) === JSON.stringify(['p2', 'p1']), JSON.stringify(m117));
  check('…marked archived, and nothing hidden', o.groups.flatMap(g => g.papers).find(p => p.id === 'p1').archived && o.hiddenArchived === 0);
}
{
  const o = paperOptions({ titles, meta, counts, course: 'MATH 117' });
  check('one course: only its papers', o.groups.length === 1 && o.groups[0].papers.every(p => p.id === 'p2'));
}
{
  const o = paperOptions({ titles, meta, counts, course: 'MATH 117', keep: 'p1' });
  check('the selected paper stays listed even when archived', o.groups[0].papers.some(p => p.id === 'p1'));
  const o2 = paperOptions({ titles, meta, counts, course: 'ESCI 316', keep: 'p3' });
  check('…or with no results, or in another course', o2.groups.flatMap(g => g.papers).some(p => p.id === 'p3'));
}
{
  const o = paperOptions({ titles, meta: {}, counts: { shared: 1, p2: 1 } });
  check('papers with no date still listed', o.groups.flatMap(g => g.papers).length === 2);
  check('nothing at all is an empty list', paperOptions().groups.length === 0 && paperOptions().hiddenArchived === 0);
}

console.log('\n=== result rows follow the same filters ===');
check('an archived paper\'s rows are out by default', !resultInView('p1', { titles, meta }));
check('…in with archived on', resultInView('p1', { titles, meta, showArchived: true }));
check('course filter', resultInView('p2', { titles, meta, course: 'MATH 117' }) && !resultInView('p4', { titles, meta, course: 'MATH 117' }));
check('a paper with no meta (shared) is in', resultInView('shared', { titles, meta }));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

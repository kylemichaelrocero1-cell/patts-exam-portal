// The Results tab's paper picker: a course first, only papers with results,
// newest first, archived papers only on request.
//
//   npm run test:paper-filter

import { courseOf, managedCounts, managedPapers, paperOptions, resultInView } from '../paperFilter.js';

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

console.log('\n=== the Manage Exams list ===');
{
  const exams = [
    { id: 'a', title: 'MATH 117 Quiz 1', target_section: 'BSAE 1A', is_open: true },
    { id: 'b', title: 'MATH 117 Quiz 2', target_section: 'BSAE 1B', is_open: false },
    { id: 'c', title: 'ESCI 316 Midterm', target_section: 'BSME 3A', is_open: false, archived_at: '2026-10-01' },
    { id: 'd', title: 'Old Prelim', target_section: 'BSAE 1A', is_open: true, archived_at: '2026-10-01' },
    { id: 'e', title: null, target_section: null, is_open: false },
  ];
  const ids = (o) => managedPapers(exams, o).map(e => e.id).join('');
  check('archived papers stay out by default', ids() === 'abe', ids());
  check('and come in when asked for', ids({ showArchived: true }) === 'abcde');
  check('open is open papers', ids({ status: 'open' }) === 'a');
  check('closed is closed papers', ids({ status: 'closed' }) === 'be');
  check('an archived paper left open is not "open"', ids({ status: 'open', showArchived: true }) === 'a');
  check('and counts as closed', ids({ status: 'closed', showArchived: true }) === 'bcde');
  check('search finds a title, any case', ids({ query: 'quiz 2' }) === 'b');
  check('search finds a section', ids({ query: 'bsae 1a' }) === 'a');
  check('spaces around a search do not matter', ids({ query: '  quiz ' }) === 'ab');
  check('search and status together', ids({ query: 'math', status: 'closed' }) === 'b');
  check('nothing matches, nothing listed', ids({ query: 'zzz' }) === '');
  const c = managedCounts(exams);
  check('the filter labels add up', c.all === 3 && c.open === 1 && c.closed === 2, JSON.stringify(c));
  check('no papers at all is safe', managedPapers(undefined).length === 0 && managedCounts(undefined).all === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

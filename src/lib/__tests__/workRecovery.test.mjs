// Working refused at submit (a stale session token) is still in the live
// session; these pin how it is found and what is written back.
//
//   npm run test:work-recovery

import { rowsMissingWork, workPatchFrom } from '../workRecovery.js';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('=== finding the sittings ===');
{
  // MATH 117 RETAKE, 2026-09-30: one of 51 sittings with no worked half.
  const pelaez = { student_id: 'p', exam_id: 'retake', score: 3, total_items: 9, points_total: 9, work_marks: null, work_total: null };
  const others = [
    { student_id: 'a', exam_id: 'retake', score: 9, total_items: 9, work_marks: 11, work_total: 58 },
    { student_id: 'b', exam_id: 'retake', score: 8, total_items: 9, work_marks: null, work_total: 58 },
  ];
  const plain = [
    { student_id: 'a', exam_id: 'mcq', score: 40, total_items: 50, work_total: null },
    { student_id: 'c', exam_id: 'mcq', score: 20, total_items: 50 },
  ];
  const found = rowsMissingWork([pelaez, ...others, ...plain]);
  check('the sitting with no worked half is found', found.length === 1 && found[0] === pelaez, JSON.stringify(found));
  check('a sitting merely waiting to be marked is not', !found.includes(others[1]));
  check('a multiple-choice paper is never flagged', !found.some(r => r.exam_id === 'mcq'));
  check('nothing to find in nothing', rowsMissingWork([]).length === 0);
}

console.log('\n=== what is written back ===');
{
  // His live session, verbatim.
  const live = {
    '0438706d': { lines: ['x=0^{\\placeholder{}}'] },
    '05a0d385': { lines: ['x=0'] },
    '06da5fa5': { lines: [''] },
    '0d060b72': { lines: ['x=2'] },
    '4a15d0f4': { lines: ['x=\\infty'] },
    'not-this-paper': { lines: ['x=9'] },
    'a-picked-item': { lines: ['2'] },
  };
  const questions = [
    ...['0438706d', '05a0d385', '06da5fa5', '0d060b72', '4a15d0f4'].map(id => ({ id, question_type: 'worked_solution' })),
    { id: 'a-picked-item', question_type: 'multiple_choice' },
  ];
  const patch = workPatchFrom(live, questions);
  check('each written item comes back in the shape save_worked_answers() stores',
    eq(patch['05a0d385'], { type: 'worked', lines: ['x=0'], marks: null }), JSON.stringify(patch['05a0d385']));
  check('an item left blank is left out', !('06da5fa5' in patch));
  check('only this paper\'s worked items', !('not-this-paper' in patch) && !('a-picked-item' in patch));
  check('four items recovered', Object.keys(patch).length === 4, Object.keys(patch).join(','));
  check('what was typed is kept as typed', patch['0438706d'].lines[0] === 'x=0^{\\placeholder{}}');
  check('a session with no working gives an empty patch', eq(workPatchFrom(null, questions), {}));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

// What order a student actually sees a paper in, and — the part that would be
// silent if it broke — that shuffling can never change which answer is right.
//
//   npm run test:exam-order

import { prepareQuestions, seedFor } from '../examOrder.js';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// A ten-question paper, in question_number order as fetched.
const PAPER = Array.from({ length: 10 }, (_, i) => ({
  id: `q${i + 1}`,
  question_number: i + 1,
  choices: ['alpha', 'bravo', 'charlie', 'delta'],
  correct_answer: i % 4,
}));
const nums = (list) => list.map(q => q.question_number);
const ON = {}, QOFF = { shuffle_questions: false }, COFF = { shuffle_choices: false };
const BOTHOFF = { shuffle_questions: false, shuffle_choices: false };

console.log('=== both switches default to on ===');
{
  // A paper loaded before the columns existed has undefined, not false.
  const a = prepareQuestions(PAPER, {}, 'student-one');
  const b = prepareQuestions(PAPER, undefined, 'student-one');
  check('an assessment with no switches at all still shuffles',
    !eq(nums(a), nums(PAPER.map(q => q))) && eq(nums(a), nums(b)), nums(a).join(','));
  check('and undefined is treated the same as on', eq(nums(a), nums(b)));
}

console.log('\n=== shuffle_questions ===');
{
  const on = prepareQuestions(PAPER, ON, 'student-one');
  check('on: the order changes', !eq(nums(on), [1,2,3,4,5,6,7,8,9,10]), nums(on).join(','));
  const off = prepareQuestions(PAPER, QOFF, 'student-one');
  check('off: questions come back in question_number order',
    eq(nums(off), [1,2,3,4,5,6,7,8,9,10]), nums(off).join(','));
  check('off: every question is still there, none duplicated',
    off.length === 10 && new Set(off.map(q => q.id)).size === 10);
}

console.log('\n=== shuffle_choices ===');
{
  const on = prepareQuestions(PAPER, ON, 'student-one');
  check('on: at least one question has its choices reordered',
    on.some(q => !eq(q.choice_order, [0, 1, 2, 3])),
    JSON.stringify(on[0].choice_order));
  const off = prepareQuestions(PAPER, COFF, 'student-one');
  check('off: every question keeps the stored choice order',
    off.every(q => eq(q.choice_order, [0, 1, 2, 3])));
  check('off: the questions are still shuffled — the switches are independent',
    !eq(nums(off), [1,2,3,4,5,6,7,8,9,10]), nums(off).join(','));
}

console.log('\n=== the two are independent ===');
{
  const qOnly = prepareQuestions(PAPER, COFF, 'student-one');      // questions yes, choices no
  const cOnly = prepareQuestions(PAPER, QOFF, 'student-one');      // questions no, choices yes
  check('questions shuffled, choices not',
    !eq(nums(qOnly), [1,2,3,4,5,6,7,8,9,10]) && qOnly.every(q => eq(q.choice_order, [0,1,2,3])));
  check('choices shuffled, questions not',
    eq(nums(cOnly), [1,2,3,4,5,6,7,8,9,10]) && cOnly.some(q => !eq(q.choice_order, [0,1,2,3])));
  const neither = prepareQuestions(PAPER, BOTHOFF, 'student-one');
  check('both off: the paper is exactly as written',
    eq(nums(neither), [1,2,3,4,5,6,7,8,9,10]) &&
    neither.every(q => eq(q.choice_order, [0, 1, 2, 3])));
}

console.log('\n=== the order is stable per student ===');
{
  const a = prepareQuestions(PAPER, ON, 'student-one');
  const b = prepareQuestions(PAPER, ON, 'student-one');
  check('the same student reloading gets the same paper back',
    eq(nums(a), nums(b)) && eq(a.map(q => q.choice_order), b.map(q => q.choice_order)));
  const other = prepareQuestions(PAPER, ON, 'student-two');
  check('a different student gets a different order',
    !eq(nums(a), nums(other)), `${nums(a)} vs ${nums(other)}`);
  check('seedFor is stable and differs per student',
    seedFor('student-one') === seedFor('student-one') &&
    seedFor('student-one') !== seedFor('student-two'));
  check('no student id still produces a paper rather than throwing',
    prepareQuestions(PAPER, ON, undefined).length === 10);
}

console.log('\n=== shuffling can never change which answer is right ===');
{
  // The whole safety argument: correct_answer is an index into the STORED
  // choices, and choice_order only says what position to draw each at.
  for (const [name, exam] of [['both on', ON], ['questions off', QOFF],
                              ['choices off', COFF], ['both off', BOTHOFF]]) {
    const out = prepareQuestions(PAPER, exam, 'student-one');
    const wrong = out.filter(q => q.choice_list[q.correct_answer] !== 'alpha' &&
                                  q.choice_list[q.correct_answer] !==
                                  PAPER.find(p => p.id === q.id).choices[q.correct_answer]);
    check(`${name}: every key still points at its own answer text`, wrong.length === 0,
      wrong.map(q => q.id).join(','));
    const bad = out.filter(q => {
      const o = q.choice_order;
      return o.length !== 4 || new Set(o).size !== 4 || o.some(i => i < 0 || i > 3);
    });
    check(`${name}: choice_order is a complete permutation of the indices`, bad.length === 0,
      bad.map(q => q.id).join(','));
  }
}

console.log('\n=== awkward papers ===');
{
  check('an empty paper is an empty paper', prepareQuestions([], ON, 's').length === 0);
  check('null questions do not throw', prepareQuestions(null, ON, 's').length === 0);
  const essay = [{ id: 'e1', question_number: 1, question_type: 'essay', choices: [] }];
  const out = prepareQuestions(essay, ON, 's');
  check('an essay has no choices and no order', eq(out[0].choice_list, []) && eq(out[0].choice_order, []));
  const five = [{ id: 'f', question_number: 1, choices: ['a','b','c','d','e'], correct_answer: 4 }];
  const o5 = prepareQuestions(five, ON, 's');
  check('a five-choice item permutes all five',
    o5[0].choice_order.length === 5 && new Set(o5[0].choice_order).size === 5);
  const seven = [{ id: 'g', question_number: 1, choices: ['a','b','c','d','e','f','g'], correct_answer: 6 }];
  const o7 = prepareQuestions(seven, ON, 's');
  check('a seven-choice item permutes all seven',
    o7[0].choice_order.length === 7 && new Set(o7[0].choice_order).size === 7);
  const legacy = [{ id: 'h', question_number: 1, choice_a: 'w', choice_b: 'x', choice_c: 'y', choice_d: 'z' }];
  check('a row written before the choices array still renders',
    eq(prepareQuestions(legacy, BOTHOFF, 's')[0].choice_list, ['w', 'x', 'y', 'z']));
}

console.log(`\n${fail ? 'FAILED' : 'OK'} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

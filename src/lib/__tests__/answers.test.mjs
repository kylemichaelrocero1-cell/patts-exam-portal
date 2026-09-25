// A question may have several right answers (sql/018), and such an item is
// marked ALL OR NOTHING. These pin that rule and the two shapes it has to
// read — one index, or a set of them — including the awkward cases: a key
// that arrives out of order, one that arrives as a jsonb string, an item with
// every box unticked, and the difference between "blank" and "wrong".
//
//   npm run test:answers

import {
  isMultiSelect, indexSet, correctSetOf, sameSet, isAnswerCorrect,
  toggleIndex, isSelected, hasAnswer, answeredCount, keySetIsValid,
  answerPayload, answersPayload, QUESTION_TYPES,
} from '../answers.js';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('=== which items tick rather than pick ===');
check('multi_select ticks', isMultiSelect({ question_type: 'multi_select' }));
check('multiple_choice picks', !isMultiSelect({ question_type: 'multiple_choice' }));
check('an item with no type stated is a single-answer one, as it always was',
  !isMultiSelect({}) && !isMultiSelect(null));
check('every type the editor offers is one the database allows (sql/018 + sql/024)',
  eq(QUESTION_TYPES.map(t => t.value),
     ['multiple_choice', 'multi_select', 'essay', 'worked_solution']));

console.log('\n=== reading a key or an answer as a set ===');
check('one index becomes a one-element set', eq(indexSet(2), [2]));
check('an array is sorted and de-duplicated', eq(indexSet([3, 0, 3, 1]), [0, 1, 3]));
check('a jsonb string is parsed', eq(indexSet('[2,0]'), [0, 2]));
check('numeric strings inside an array count', eq(indexSet(['1', 0]), [0, 1]));
check('zero is an index, not an absence', eq(indexSet(0), [0]));
check('an empty array is nothing, not an answer', indexSet([]) === null);
check('null, undefined and empty string are all nothing',
  indexSet(null) === null && indexSet(undefined) === null && indexSet('') === null);
check('a negative or fractional index is dropped', indexSet([-1, 1.5, 2]) === null
  ? false : eq(indexSet([-1, 1.5, 2]), [2]));
check('malformed json is nothing rather than a throw', indexSet('[oops') === null);

console.log('\n=== the key comes from whichever column the type uses ===');
check('a single-answer item keys on correct_answer',
  eq(correctSetOf({ question_type: 'multiple_choice', correct_answer: 3 }), [3]));
check('a multi-answer item keys on correct_answers',
  eq(correctSetOf({ question_type: 'multi_select', correct_answers: [2, 0] }), [0, 2]));
check('a multi-answer item ignores a stray correct_answer',
  eq(correctSetOf({ question_type: 'multi_select', correct_answers: [1], correct_answer: 3 }), [1]));
check('an essay has no key', correctSetOf({ question_type: 'essay' }) === null);

console.log('\n=== all or nothing ===');
const MULTI = { question_type: 'multi_select', correct_answers: [0, 2, 3] };
check('every right answer and nothing else earns the point',
  isAnswerCorrect(MULTI, [3, 0, 2]) === true);
check('the order they were ticked in does not matter',
  isAnswerCorrect(MULTI, [2, 3, 0]) === true);
check('MISSING ONE earns nothing — the whole point of the type',
  isAnswerCorrect(MULTI, [0, 2]) === false);
check('one extra tick earns nothing either',
  isAnswerCorrect(MULTI, [0, 1, 2, 3]) === false);
check('the same right answers ticked twice still count once',
  isAnswerCorrect(MULTI, [0, 2, 3, 3]) === true);
check('every box unticked is BLANK, not wrong',
  isAnswerCorrect(MULTI, []) === null);
check('a single-answer item is unaffected',
  isAnswerCorrect({ question_type: 'multiple_choice', correct_answer: 1 }, 1) === true
  && isAnswerCorrect({ question_type: 'multiple_choice', correct_answer: 1 }, 2) === false);
check('an unkeyed item marks nobody right rather than everybody',
  isAnswerCorrect({ question_type: 'multi_select' }, [0]) === false);

console.log('\n=== set comparison ===');
check('equal sets', sameSet([0, 1], [0, 1]));
check('different lengths are not equal', !sameSet([0, 1], [0, 1, 2]));
check('a null side is never equal', !sameSet(null, [0]) && !sameSet([0], null));

console.log('\n=== ticking boxes ===');
check('a first tick opens a set', eq(toggleIndex(undefined, 2), [2]));
check('a second tick adds and keeps it sorted', eq(toggleIndex([2], 0), [0, 2]));
check('clicking the same choice again unticks it', eq(toggleIndex([0, 2], 2), [0]));
check('unticking the last one leaves an empty set, which reads as blank',
  eq(toggleIndex([2], 2), []) && !hasAnswer(toggleIndex([2], 2)));
check('isSelected reads the set', isSelected([0, 2], 2) && !isSelected([0, 2], 1));

console.log('\n=== how many questions are answered ===');
check('an empty tick list does NOT count as answered',
  answeredCount({ a: 1, b: [], c: [0, 1] }) === 2);
check('choice zero counts as answered', answeredCount({ a: 0 }) === 1);
check('nothing answered is nothing', answeredCount({}) === 0 && answeredCount(null) === 0);

console.log('\n=== validating a key against the choices ===');
check('a key inside the list is usable', keySetIsValid([0, 2], 3));
check('a key past the end is not', !keySetIsValid([0, 3], 3));
check('an empty key is not', !keySetIsValid([], 3));
check('a non-array is not', !keySetIsValid(null, 3) && !keySetIsValid(2, 3));

console.log('\n=== what goes to submit_assessment() ===');
check('a single-answer item sends a plain index, exactly as before',
  answerPayload(2) === 2);
check('choice zero is sent, not dropped as falsy', answerPayload(0) === 0);
check('a multi-answer item sends a sorted array', eq(answerPayload([2, 0]), [0, 2]));
check('a blank sends nothing at all', answerPayload([]) === undefined
  && answerPayload(null) === undefined && answerPayload(undefined) === undefined);
check('the payload keeps both shapes and drops the blanks',
  eq(answersPayload({ q1: 1, q2: [2, 0], q3: [], q4: null, q5: 0 }),
     { q1: 1, q2: [0, 2], q5: 0 }));
check('a payload rebuilt from saved progress keeps its arrays',
  eq(answersPayload(JSON.parse(JSON.stringify({ q1: 3, q2: [1, 0] }))),
     { q1: 3, q2: [0, 1] }));

console.log(`\n${fail ? 'FAILED' : 'OK'} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

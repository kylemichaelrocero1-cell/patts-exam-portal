// An item may carry any number of choices (sql/016). These pin the reading
// rules — including the fallback that keeps rows written before the migration,
// and the legacy `exams` table, rendering correctly.
//
//   npm run test:choices

import { choicesOf, letterFor, indexForLetter, choicesPatch, keyIsValid } from '../choices.js';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('=== reading the array ===');
check('an array of seven comes back whole',
  eq(choicesOf({ choices: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }),
     ['a', 'b', 'c', 'd', 'e', 'f', 'g']));
check('blank and null entries are dropped',
  eq(choicesOf({ choices: ['a', '', null, '  ', 'b'] }), ['a', 'b']));
check('a jsonb string is parsed',
  eq(choicesOf({ choices: '["x","y","z"]' }), ['x', 'y', 'z']));
check('malformed json falls back rather than throwing',
  eq(choicesOf({ choices: '[oops', choice_a: 'w', choice_b: 'x' }), ['w', 'x']));
check('numbers are stringified, not dropped',
  eq(choicesOf({ choices: [1, 2, 3] }), ['1', '2', '3']));

console.log('\n=== falling back to the columns ===');
check('a pre-016 four-choice row still reads',
  eq(choicesOf({ choice_a: 'w', choice_b: 'x', choice_c: 'y', choice_d: 'z' }),
     ['w', 'x', 'y', 'z']));
check('a five-choice row reads all five',
  eq(choicesOf({ choice_a: 'v', choice_b: 'w', choice_c: 'x', choice_d: 'y', choice_e: 'z' }),
     ['v', 'w', 'x', 'y', 'z']));
check('an empty choice_e is not an empty fifth button',
  eq(choicesOf({ choice_a: 'w', choice_b: 'x', choice_c: 'y', choice_d: 'z', choice_e: '' }),
     ['w', 'x', 'y', 'z']));
check('an essay row has no choices',
  eq(choicesOf({ choice_a: null, choice_b: null }), []));
check('null and undefined do not throw',
  eq(choicesOf(null), []) && eq(choicesOf(undefined), []) && eq(choicesOf({}), []));
check('the array wins over the columns when both are present',
  eq(choicesOf({ choices: ['new1', 'new2', 'new3'], choice_a: 'old', choice_b: 'older' }),
     ['new1', 'new2', 'new3']));

console.log('\n=== labels never run out ===');
check('0..4 are A..E', eq([0, 1, 2, 3, 4].map(letterFor), ['A', 'B', 'C', 'D', 'E']));
check('6 choices reach F', letterFor(5) === 'F');
check('7 choices reach G', letterFor(6) === 'G');
check('25 is Z and 26 is AA', letterFor(25) === 'Z' && letterFor(26) === 'AA');
check('27 is AB, 51 is AZ, 52 is BA',
  letterFor(27) === 'AB' && letterFor(51) === 'AZ' && letterFor(52) === 'BA');
check('a bad index is empty, not a crash',
  letterFor(-1) === '' && letterFor(null) === '' && letterFor(1.5) === '');

console.log('\n=== labels round-trip ===');
{
  const bad = [];
  for (let i = 0; i < 200; i++) if (indexForLetter(letterFor(i)) !== i) bad.push(i);
  check('every index 0..199 survives letterFor -> indexForLetter', bad.length === 0, bad.join(','));
  check('lower case is accepted', indexForLetter('c') === 2);
  check('non-letters are rejected',
    indexForLetter('1') === null && indexForLetter('') === null && indexForLetter(null) === null);
}

console.log('\n=== what gets written ===');
check('only `choices` is sent — the columns are the trigger\'s job',
  eq(Object.keys(choicesPatch(['a', 'b'])), ['choices']));
check('blank rows in the editor are not saved as empty buttons',
  eq(choicesPatch(['a', '', '  ', 'b', null]).choices, ['a', 'b']));
check('seven choices are written as seven',
  choicesPatch(['a', 'b', 'c', 'd', 'e', 'f', 'g']).choices.length === 7);
check('an empty list is an empty array, not null',
  eq(choicesPatch([]).choices, []) && eq(choicesPatch(null).choices, []));

console.log('\n=== the key has to point at something ===');
check('0 is valid against 4 choices', keyIsValid(0, 4));
check('3 is valid against 4, 4 is not', keyIsValid(3, 4) && !keyIsValid(4, 4));
check('6 is valid against 7 choices', keyIsValid(6, 7));
check('negative, null and non-integers are invalid',
  !keyIsValid(-1, 4) && !keyIsValid(null, 4) && !keyIsValid(1.5, 4) && !keyIsValid('2', 4));
check('nothing is valid against zero choices', !keyIsValid(0, 0));

console.log('\n=== the round trip a seven-choice item actually takes ===');
{
  const written = choicesPatch(['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf']);
  const read = choicesOf({ choices: written.choices });
  check('seven go in and seven come out, in order',
    eq(read, ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf']));
  check('and the seventh is labelled G, keyed as index 6',
    letterFor(6) === 'G' && read[6] === 'golf' && keyIsValid(6, read.length));
}

console.log(`\n${fail ? 'FAILED' : 'OK'} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

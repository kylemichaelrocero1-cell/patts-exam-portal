// Papers in sets (sql/116): labels, which items a set has, and reading a
// filed paper's set from its answers.
//   npm run test:paper-sets
import { normaliseSetLabel, inSet, questionsForSet, setsOf, setOfAnswers } from '../paperSets.js';
let pass = 0, fail = 0;
const ck = (n, ok, d = '') => { ok ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`)); };
const J = JSON.stringify;

console.log('=== LABELS ===');
ck('a letter, any case, with or without "Set"', ['a', 'A', ' set b ', 'Set C'].map(normaliseSetLabel).join('') === 'AABC');
ck('blank, *, All: every set (null)', [null, '', '  ', '*', 'all', 'ALL'].every(v => normaliseSetLabel(v) === null));
ck('anything else is not a set (undefined)', ['AB', '1', 'A1', 'Set', '-'].every(v => normaliseSetLabel(v) === undefined), J(['AB', '1', 'A1', 'Set', '-'].map(normaliseSetLabel)));

const Q = [
  { id: 'c1' }, { id: 'c2', set_label: null },
  { id: 'a1', set_label: 'A' }, { id: 'a2', set_label: 'A' },
  { id: 'b1', set_label: 'B' }, { id: 'b2', set_label: 'B' },
];
console.log('\n=== WHICH ITEMS A SET HAS ===');
ck('an unlabelled item is in every set', inSet(Q[0], 'A') && inSet(Q[1], 'H'));
ck('a labelled item only in its own', inSet(Q[2], 'A') && !inSet(Q[2], 'B'));
ck('Set B: the shared items and B\'s', J(questionsForSet(Q, 'B').map(q => q.id)) === J(['c1', 'c2', 'b1', 'b2']));
ck('a paper without sets: everything, whatever set is asked', questionsForSet([{ id: 'x' }, { id: 'y' }], 'A').length === 2 && questionsForSet([{ id: 'x' }], null).length === 1);
ck('the sets, sorted, no blanks', J(setsOf([...Q].reverse())) === J(['A', 'B']));

console.log('\n=== A FILED PAPER\'S SET ===');
ck('read from its answers', setOfAnswers(Q, { c1: {}, b1: {}, b2: {} }) === 'B');
ck('the set with the most of its items wins', setOfAnswers(Q, { a1: {}, b1: {}, b2: {} }) === 'B');
ck('only shared items answered: unknown', setOfAnswers(Q, { c1: {} }) === null);
ck('no answers, or no sets: null', setOfAnswers(Q, null) === null && setOfAnswers([{ id: 'x' }], { x: {} }) === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

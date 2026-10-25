// The wording around removing students: the prompt must say that a student
// shared with a colleague is not deleted, and the summary must report each
// outcome the database returns (sql/094) and nothing it did not.
//
//   npm run test:remove-students-ui

import { removalPrompt, removalSummary } from '../removeStudents.js';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

console.log('=== the prompt ===');
const one = removalPrompt(1, 'Dela Cruz, Juan');
check('names the one student', one.includes('"Dela Cruz, Juan"'), one);
check('counts several', removalPrompt(12).startsWith('Remove 12 students'));
check('says a shared student keeps their account', /keeps their account/.test(one));
check('says what cannot be undone', /cannot be undone/.test(one));
check('a missing name still reads', removalPrompt(1, '').includes('"this student"'));

console.log('\n=== the summary ===');
const rows = [
  { student: 'a', outcome: 'section_removed' }, { student: 'b', outcome: 'section_removed' },
  { student: 'c', outcome: 'kept' }, { student: 'd', outcome: 'deleted' },
  { student: 'e', outcome: 'not_yours' },
];
const sum = removalSummary(rows);
check('counts each outcome', /^2 students removed/m.test(sum) && /^1 student removed .*account kept/m.test(sum)
  && /^1 student deleted\./m.test(sum) && /^1 student not in any/m.test(sum), sum);
check('says nothing about outcomes that did not happen',
  !/deleted/.test(removalSummary([{ outcome: 'section_removed' }])));
check('an empty or missing reply is "Nothing changed."',
  removalSummary([]) === 'Nothing changed.' && removalSummary(null) === 'Nothing changed.');
check('an unknown outcome is ignored, not counted', removalSummary([{ outcome: 'weird' }]) === 'Nothing changed.');

console.log(`\n${fail ? 'FAILED' : 'OK'} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

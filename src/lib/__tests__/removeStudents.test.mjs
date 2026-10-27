// The wording around removing students: the prompt must say they go to the
// Trash and that a student shared with a colleague keeps their account, and
// the summary must report each outcome the database returns (sql/104) and
// nothing it did not.
//
//   npm run test:remove-students-ui

import { removalPrompt, removalSummary, purgeLabel } from '../removeStudents.js';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

console.log('=== the prompt ===');
const one = removalPrompt(1, 'Dela Cruz, Juan');
check('names the one student', one.includes('"Dela Cruz, Juan"'), one);
check('counts several', removalPrompt(12).startsWith('Move 12 students to the Trash'));
check('says a shared student keeps their account', /keeps their account/.test(one));
check('says it can be restored for 30 days', /restore them from the Trash for 30 days/.test(one));
check('a missing name still reads', removalPrompt(1, '').includes('"this student"'));

console.log('\n=== the summary ===');
const sum = removalSummary([
  { student: 'a', outcome: 'trashed' }, { student: 'b', outcome: 'trashed' },
  { student: 'e', outcome: 'not_yours' },
]);
check('counts each outcome', /^2 students moved to the Trash/m.test(sum) && /^1 student not in any/m.test(sum), sum);
check('says nothing about outcomes that did not happen', !/not in any/.test(removalSummary([{ outcome: 'trashed' }])));
check('an empty or missing reply is "Nothing changed."',
  removalSummary([]) === 'Nothing changed.' && removalSummary(null) === 'Nothing changed.');
check('an unknown outcome is ignored, not counted', removalSummary([{ outcome: 'deleted' }]) === 'Nothing changed.');

console.log('\n=== the Trash clock ===');
const now = new Date('2026-10-27T12:00:00Z');
const at = (d) => new Date(now.getTime() + d * 86400000).toISOString();
check('whole days left', purgeLabel(at(30), now) === 'Deleted for good in 30 days');
check('a part day counts as a day', purgeLabel(at(11.2), now) === 'Deleted for good in 12 days');
check('the last day says tomorrow', purgeLabel(at(0.5), now) === 'Deleted for good tomorrow');
check('past due says so', /next time/.test(purgeLabel(at(-1), now)));
check('nonsense in, nothing out', purgeLabel('not a date', now) === '');

console.log(`\n${fail ? 'FAILED' : 'OK'} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

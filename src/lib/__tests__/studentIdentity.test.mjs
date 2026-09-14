// The Student ID stopped being unique (sql/014). These assert the one thing
// that must not go wrong as a result: a roster import never merges a CSV row
// into the wrong student because two people share an ID.
//
//   npm run test:student-identity

import { makeRosterIndex, resolveStudent } from '../studentIdentity.js';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

// Ana and Ben are the two real students who share 2021-1-1234.
const ROSTER = [
  { id: 'u-ana',  full_name: 'Ana',  student_email: 'ana@patts.edu.ph',  student_code: '2021-1-1234' },
  { id: 'u-ben',  full_name: 'Ben',  student_email: 'ben@patts.edu.ph',  student_code: '2021-1-1234' },
  { id: 'u-cruz', full_name: 'Cruz', student_email: 'cruz@patts.edu.ph', student_code: '2021-1-9999' },
  { id: 'u-dee',  full_name: 'Dee',  student_email: 'dee@patts.edu.ph',  student_code: null },
];
const IDX = makeRosterIndex(ROSTER);

console.log('=== indexing a shared Student ID ===');
check('both sharers are kept, not just the last one',
  IDX.holdersOf('2021-1-1234').length === 2,
  `${IDX.holdersOf('2021-1-1234').length}`);
check('a shared ID has no sole holder', IDX.soleHolderOf('2021-1-1234') === null);
check('an ID held by one student does have one',
  IDX.soleHolderOf('2021-1-9999')?.id === 'u-cruz');
check('an unknown ID has none', IDX.soleHolderOf('nope') === null);
check('a student with no ID at all does not break indexing',
  IDX.byEmail.get('dee@patts.edu.ph')?.id === 'u-dee');

console.log('\n=== email is believed first ===');
check('Ana is matched by her own email, despite the shared ID',
  resolveStudent({ student_email: 'ana@patts.edu.ph', student_code: '2021-1-1234' }, IDX).match?.id === 'u-ana');
check('Ben is matched by his own email, despite the same ID',
  resolveStudent({ student_email: 'ben@patts.edu.ph', student_code: '2021-1-1234' }, IDX).match?.id === 'u-ben');
check('and neither is ever mistaken for the other',
  resolveStudent({ student_email: 'ana@patts.edu.ph', student_code: '2021-1-1234' }, IDX).match?.id !== 'u-ben');

console.log('\n=== a shared ID identifies nobody ===');
{
  // The dangerous case: an email the system has not seen, carrying an ID that
  // two students already share. The old code returned one of them and merged
  // the row into that person's record.
  const r = resolveStudent({ student_email: 'new.person@patts.edu.ph', student_code: '2021-1-1234' }, IDX);
  check('an unknown email with a shared ID matches NOBODY', r.match === null);
  check('and is not reported as a conflict either — it is simply a new student',
    r.conflict === false);
}

console.log('\n=== an ID held by one student still identifies ===');
{
  const r = resolveStudent({ student_email: 'typo@patts.edu.ph', student_code: '2021-1-9999' }, IDX);
  check('an unknown email with a uniquely-held ID still finds Cruz',
    r.match?.id === 'u-cruz' && r.conflict === false);
}

console.log('\n=== genuine conflicts are still caught ===');
{
  const r = resolveStudent({ student_email: 'ana@patts.edu.ph', student_code: '2021-1-9999' }, IDX);
  check('email says Ana, uniquely-held ID says Cruz: conflict',
    r.conflict === true && r.match === null);
  // But a shared ID must not manufacture a conflict out of nothing.
  const r2 = resolveStudent({ student_email: 'cruz@patts.edu.ph', student_code: '2021-1-1234' }, IDX);
  check('email says Cruz and the ID is shared: no conflict, Cruz wins',
    r2.conflict === false && r2.match?.id === 'u-cruz');
}

console.log('\n=== nothing matches on nothing ===');
{
  check('a row with neither email nor ID matches nobody',
    resolveStudent({}, IDX).match === null);
  check('an empty roster matches nobody',
    resolveStudent({ student_email: 'a@b.c', student_code: 'x' }, makeRosterIndex([])).match === null);
  check('a null roster does not throw',
    makeRosterIndex(null).holdersOf('x').length === 0);
}

console.log('\n=== no row can ever resolve to a student it does not name ===');
{
  // Exhaustive over the roster: whatever comes back must be the one whose
  // email matches, or the sole holder of the ID. Never anyone else.
  const emails = [...ROSTER.map(r => r.student_email), 'unknown@patts.edu.ph', undefined];
  const codes = ['2021-1-1234', '2021-1-9999', 'unknown-id', undefined];
  const wrong = [];
  for (const student_email of emails) for (const student_code of codes) {
    const { match, conflict } = resolveStudent({ student_email, student_code }, IDX);
    if (!match || conflict) continue;
    const okByEmail = match.student_email === student_email;
    const okByCode = IDX.soleHolderOf(student_code)?.id === match.id;
    if (!okByEmail && !okByCode) wrong.push(`${student_email} / ${student_code} -> ${match.id}`);
  }
  check('every match is justified by the email or by a uniquely-held ID',
    wrong.length === 0, wrong.join(' | '));
}

console.log(`\n${fail ? 'FAILED' : 'OK'} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

// Verifies that an instructor sees and edits only their own slice of a
// student's sections, and — the part that carries real risk — that saving that
// slice never drops the sections the student holds under another instructor.
//
//   npm run test:sections-scope

import {
  splitSections, mySectionsOf, otherSectionsOf, mergeSections,
} from '../sectionScope.js';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Kyle holds these; AENG 223L and Aeng 427 -3B belong to colleagues.
const KYLE = new Set(['Esci 316 -2', 'Math 115 -5B', 'Math 117 -2A']);

console.log('=== splitting ===');
check('trims, drops blanks and empty slots',
  eq(splitSections(' Esci 316 -2 ,, Math 115 -5B ,'), ['Esci 316 -2', 'Math 115 -5B']));
check('null and undefined are empty, not a crash',
  eq(splitSections(null), []) && eq(splitSections(undefined), []) && eq(splitSections(''), []));

console.log('\n=== the two slices ===');
{
  const row = 'Esci 316 -2, AENG 223L, Math 115 -5B';
  check('mine keeps only the held sections',
    eq(mySectionsOf(row, KYLE), ['Esci 316 -2', 'Math 115 -5B']));
  check("theirs is exactly the colleague's section",
    eq(otherSectionsOf(row, KYLE), ['AENG 223L']));
  check('the two slices partition the row with nothing lost or invented',
    eq([...mySectionsOf(row, KYLE), ...otherSectionsOf(row, KYLE)].sort(),
       splitSections(row).sort()));
  check('a student only in a colleague section shows nothing here',
    eq(mySectionsOf('AENG 223L, Aeng 427 -3B', KYLE), []));
  check('accepts a plain array of held sections, not just a Set',
    eq(mySectionsOf(row, ['Esci 316 -2']), ['Esci 316 -2']));
}

console.log('\n=== saving: the colleague must survive ===');
{
  const row = 'Esci 316 -2, AENG 223L';
  check('editing my slice leaves the colleague section in place',
    mergeSections('Esci 316 -2, Math 115 -5B', row, KYLE)
      === 'Esci 316 -2, Math 115 -5B, AENG 223L');
  check('REMOVING the student from all my sections still keeps the colleague',
    mergeSections('', row, KYLE) === 'AENG 223L');
  check('a student with no colleague sections round-trips unchanged',
    mergeSections('Esci 316 -2', 'Esci 316 -2', KYLE) === 'Esci 316 -2');
  check('no change at all is a no-op',
    mergeSections('Esci 316 -2', row, KYLE) === 'Esci 316 -2, AENG 223L');
}

console.log('\n=== saving: a newly created section must survive ===');
{
  const row = 'Esci 316 -2, AENG 223L';
  // SectionPicker offers "Create new section". A brand-new name is not in the
  // held set yet — claimSections only records it after this write — so
  // discarding unheld names here would make creating a section silently no-op.
  check('a section typed for the first time is written, not dropped',
    mergeSections('Esci 316 -2, Esci 316 -4', row, KYLE)
      === 'Esci 316 -2, Esci 316 -4, AENG 223L');
  check('creating a section on a student with no colleague sections works too',
    mergeSections('Math 118 -1', 'Math 117 -2A', KYLE) === 'Math 118 -1');
  check('naming the colleague section does not duplicate it',
    mergeSections('Esci 316 -2, AENG 223L', row, KYLE) === 'Esci 316 -2, AENG 223L');
  check('repeating one of my own sections collapses to one',
    mergeSections('Esci 316 -2, Esci 316 -2', row, KYLE) === 'Esci 316 -2, AENG 223L');
  check('whitespace round the edited value is tolerated',
    mergeSections('  Esci 316 -2 ,  Math 117 -2A  ', row, KYLE)
      === 'Esci 316 -2, Math 117 -2A, AENG 223L');
}

console.log('\n=== batch assignment ===');
{
  // "Assign Math 115 -5B to these students" sets MY slice and keeps theirs,
  // and the keep-list differs per student, so it cannot be one bulk update.
  const roster = [
    { id: 'a', section: 'Esci 316 -2, AENG 223L' },
    { id: 'b', section: 'Math 117 -2A' },
    { id: 'c', section: 'Esci 316 -2, Aeng 427 -3B, AENG 223L' },
  ];
  const out = roster.map(s => mergeSections('Math 115 -5B', s.section, KYLE));
  check('each student keeps their own colleague sections',
    eq(out, ['Math 115 -5B, AENG 223L',
             'Math 115 -5B',
             'Math 115 -5B, Aeng 427 -3B, AENG 223L']));
  check('every colleague section in the roster survives the batch',
    out.join(' | ').includes('AENG 223L') && out.join(' | ').includes('Aeng 427 -3B'));
}

console.log('\n=== an instructor holding nothing yet ===');
{
  check('sees no sections rather than everyone else\'s',
    eq(mySectionsOf('Esci 316 -2, AENG 223L', new Set()), []));
  check('and a save by them would still not destroy the row',
    mergeSections('Esci 316 -2', 'Esci 316 -2, AENG 223L', new Set())
      === 'Esci 316 -2, AENG 223L');
}

console.log('\n=== the one-directional guarantee ===');
{
  // Stated plainly, because it is the whole point of the module: for any edit,
  // every section the instructor does NOT hold survives untouched.
  const rows = ['Esci 316 -2, AENG 223L', 'AENG 223L', 'Math 115 -5B',
                'Esci 316 -2, Aeng 427 -3B, AENG 223L', '', null];
  const edits = ['', 'Esci 316 -2', 'Math 115 -5B, Math 117 -2A', 'Brand New -1'];
  let lost = [];
  for (const row of rows) for (const e of edits) {
    const out = splitSections(mergeSections(e, row, KYLE));
    for (const foreign of otherSectionsOf(row, KYLE)) {
      if (!out.includes(foreign)) lost.push(`${JSON.stringify(row)} + "${e}" lost ${foreign}`);
    }
  }
  check('no edit of any shape can drop a section the instructor does not hold',
    lost.length === 0, lost.join(' | '));
}

console.log(`\n${fail ? 'FAILED' : 'OK'} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

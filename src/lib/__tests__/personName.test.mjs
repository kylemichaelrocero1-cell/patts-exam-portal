// How names are drawn (src/lib/personName.js). Made-up names only.
//
//   npm run test:person-name
import { formatName, givenName, nameInitials, instructorName } from '../personName.js';

let pass = 0, fail = 0;
const check = (name, ok) => { ok ? (pass++, console.log(`  PASS  ${name}`)) : (fail++, console.log(`  FAIL  ${name}`)); };

check('the space before a roster comma goes', formatName('Santos , Maria Clara Luna') === 'Santos, Maria Clara Luna');
check('runs of spaces collapse', formatName('  Santos,   Maria   Clara ') === 'Santos, Maria Clara');
check('a name with no comma is only tidied', formatName('Dela Cruz  Pedro Lim') === 'Dela Cruz Pedro Lim');
check('a stray trailing comma is dropped', formatName('Santos ,') === 'Santos' && formatName(', Maria') === 'Maria');
check('nothing in, nothing out', formatName(null) === '' && formatName('') === '');

check('greeting uses the given name when the surname comes first', givenName('Santos , Maria Clara') === 'Maria');
check('greeting falls back to the first word', givenName('Pedro Lim Dela Cruz') === 'Pedro');
check('greeting of nothing is empty', givenName(undefined) === '');

check('initials ignore the comma', nameInitials('Santos , Maria Clara') === 'MS');
check('initials of a comma-less name use first and last words', nameInitials('Pedro Lim Cruz') === 'PC');
check('a one-word name gives one letter', nameInitials('instructor@patts.example') === 'I');
check('punctuation-only words are skipped', nameInitials('Ñora , - Ana') === 'AÑ');
check('no name gives a question mark', nameInitials('') === '?' && nameInitials(' , ') === '?');

check('an instructor with only an email gets a name from it', instructorName('juan.dela-cruz@school.example') === 'Juan Dela Cruz');
check('an instructor with a name keeps it', instructorName('Maria  Santos') === 'Maria Santos');
check('an email with no letters before the @ stays as it is', instructorName('123@school.example') === '123@school.example');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

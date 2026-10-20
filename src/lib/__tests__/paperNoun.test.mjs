// What a paper is called on the student's screens (src/lib/paperNoun.js).
//
//   npm run test:paper-noun
import { paperNoun } from '../paperNoun.js';

let pass = 0, fail = 0;
const check = (name, ok) => { ok ? (pass++, console.log(`  PASS  ${name}`)) : (fail++, console.log(`  FAIL  ${name}`)); };

check('an assignment is an Assignment', paperNoun({ kind: 'exam', title: 'MATH 117 Assignment 3 — Derivatives' }) === 'Assignment');
check('a quiz is a Quiz', paperNoun({ kind: 'exam', title: 'ESCI 316 Midterm Quiz 1' }) === 'Quiz');
check('seatwork is Seatwork, whatever its title', paperNoun({ kind: 'seatwork', title: 'Seatwork 2 quiz' }) === 'Seatwork');
check('anything else is an Exam', paperNoun({ kind: 'exam', title: 'Prelim AENG 427' }) === 'Exam'
  && paperNoun({ title: 'Practice Exam' }) === 'Exam' && paperNoun(null) === 'Exam');
check('only a whole word counts', paperNoun({ title: 'Reassignments of load' }) === 'Exam' && paperNoun({ title: 'Quizzical' }) === 'Exam');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

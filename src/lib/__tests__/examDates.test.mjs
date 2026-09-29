// The date and time a paper was handed in, for the attendance columns of
// the results downloads. Run under a foreign timezone on purpose (see the
// npm script): the answer must be Philippine time whatever the computer
// downloading it is set to.
//
//   npm run test:exam-dates
import { submittedDateTime } from '../examDates.js';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};
const is = (ts, date, time) => {
  const r = submittedDateTime(ts);
  return [r.date === date && r.time === time, JSON.stringify(r)];
};

console.log(`(this process runs in ${Intl.DateTimeFormat().resolvedOptions().timeZone})`);
check('a late-morning exam is 11:42 AM, not the stored 03:42', ...is('2026-09-28T03:42:00Z', '2026-09-28', '11:42 AM'));
check('an exam before 8 AM keeps its own date, not the day before', ...is('2026-09-27T23:30:00Z', '2026-09-28', '7:30 AM'));
check('noon and midnight read as people say them',
  submittedDateTime('2026-09-28T04:00:00Z').time === '12:00 PM' && submittedDateTime('2026-09-28T16:00:00Z').time === '12:00 AM');
check('after 4 PM UTC it is already tomorrow in Manila', ...is('2026-09-28T16:05:00Z', '2026-09-29', '12:05 AM'));
check('the database\'s own format reads the same', ...is('2026-09-28T03:42:07.123456+00:00', '2026-09-28', '11:42 AM'));
check('a date is year-month-day, zero-padded', submittedDateTime('2026-01-05T02:00:00Z').date === '2026-01-05');
check('a time has a plain space before AM/PM, nothing a spreadsheet would choke on',
  /^\d{1,2}:\d{2} (AM|PM)$/.test(submittedDateTime('2026-09-28T03:42:00Z').time));
check('no timestamp: blanks', JSON.stringify(submittedDateTime(null)) === '{"date":"","time":""}'
  && JSON.stringify(submittedDateTime('')) === '{"date":"","time":""}');
check('an unreadable one: blanks, not "Invalid Date"', JSON.stringify(submittedDateTime('not a date')) === '{"date":"","time":""}');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

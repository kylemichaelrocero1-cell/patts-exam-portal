// One line of the Results CSV. The score must be the one the Results table
// shows (combinedScore), and the date and time must be Philippine time.
//
//   npm run test:results-export
import { resultsCsvRow, RESULTS_CSV_HEADERS } from '../resultsExport.js';
import { combinedScore } from '../workedShape.js';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};
const STU = { name: 'Ana Cruz', section: 'MATH 117-1C' };
const cell = (cells, header) => cells[RESULTS_CSV_HEADERS.indexOf(header)];

check('one cell per header', resultsCsvRow({ score: 1, total_items: 2 }, STU, 'X').length === RESULTS_CSV_HEADERS.length);

// A MATH 117 paper: 9 one-point picked items, and typed items worth 58, marked.
const math117 = { score: 9, total_items: 9, points_earned: 9, points_total: 9, work_marks: 51, work_total: 58,
  submitted_at: '2026-09-28T03:42:00+00:00', time_taken_seconds: 3120, tab_switches: 1 };
{
  const c = resultsCsvRow(math117, STU, 'MATH 117 RETAKE');
  check('a paper with typed items: 60/67, not the 9/9 the file used to say',
    cell(c, 'Score') === 60 && cell(c, 'Total') === 67, JSON.stringify(c));
  check('and the percentage is of the whole paper', cell(c, 'Percentage') === '90%', cell(c, 'Percentage'));
  const t = combinedScore(math117);
  check('exactly what the Results table shows', cell(c, 'Score') === t.score && cell(c, 'Total') === t.total);
  check('handed in 28 Sep at 11:42 AM Philippine time',
    cell(c, 'Date Taken') === '2026-09-28' && cell(c, 'Time Submitted') === '11:42 AM', JSON.stringify(c));
  check('time taken and violations carried as before', cell(c, 'Time Taken (s)') === 3120 && cell(c, 'Violations') === 1);
}
{
  const c = resultsCsvRow({ ...math117, work_marks: null }, STU, 'MATH 117 RETAKE');
  check('typed items not marked yet: out of the full 67, and no percentage to act on',
    cell(c, 'Score') === 9 && cell(c, 'Total') === 67 && cell(c, 'Percentage') === 'awaiting marking', JSON.stringify(c));
}
{
  const c = resultsCsvRow({ score: 30, total_items: 50, points_earned: 60, points_total: 100 }, STU, 'Prelim');
  check('items worth 2 points: 60/100, not the 30/50 item count', cell(c, 'Score') === 60 && cell(c, 'Total') === 100
    && cell(c, 'Percentage') === '60%', JSON.stringify(c));
}
{
  const c = resultsCsvRow({ score: 40, total_items: 50, submitted_at: '2026-08-10T00:15:00Z' }, STU, 'Old paper');
  check('a paper from before points existed reads as it always did: 40/50, 80%',
    cell(c, 'Score') === 40 && cell(c, 'Total') === 50 && cell(c, 'Percentage') === '80%');
  check('sat at 8:15 AM, dated that day — not the day before, as UTC has it',
    cell(c, 'Date Taken') === '2026-08-10' && cell(c, 'Time Submitted') === '8:15 AM', JSON.stringify(c));
}
{
  const c = resultsCsvRow({ score: 0, total_items: 0 }, STU, 'Empty');
  check('no submission time: blank cells, not "Invalid Date"', cell(c, 'Date Taken') === '' && cell(c, 'Time Submitted') === '');
  check('no violations recorded: 0', cell(c, 'Violations') === 0);
}
check('names are quoted, so a comma in one cannot shift the columns',
  resultsCsvRow({ score: 1, total_items: 1 }, { name: 'Cruz, Ana', section: 'S' }, 'X')[0] === '"Cruz, Ana"');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

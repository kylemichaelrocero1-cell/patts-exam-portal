// One line of the Results tab's CSV download.
//
// Kept out of AdminDashboard so it can be tested: the download used to write
// the raw multiple-choice count as the score, which leaves out every typed
// maths item and every item worth more than one point — 9/9 in the file for
// a student the Results table showed at 60/67. It now uses combinedScore(),
// the same function the table does, so the two cannot disagree.
import { combinedScore } from './workedShape.js';
import { submittedDateTime } from './examDates.js';

export const RESULTS_CSV_HEADERS = ['Name', 'Section', 'Exam', 'Score', 'Total', 'Percentage',
  'Date Taken', 'Time Submitted', 'Time Taken (s)', 'Violations'];

/** The cells for one result row, in RESULTS_CSV_HEADERS order, ready to join. */
export function resultsCsvRow(row, student, examTitle) {
  const m = combinedScore(row);
  // As the table: the combined percentage once everything is marked, and
  // "awaiting marking" rather than a figure that will move on its own.
  const pct = m.pct !== null
    ? m.pct
    : (row.total_items > 0 ? Math.round((row.score / row.total_items) * 100) : 0);
  // Philippine time, for the attendance record.
  const when = submittedDateTime(row.submitted_at);
  return [
    `"${student.name}"`,
    `"${student.section}"`,
    `"${examTitle}"`,
    m.score,
    m.total,
    m.pending > 0 ? 'awaiting marking' : `${pct}%`,
    when.date,
    when.time,
    row.time_taken_seconds ?? '',
    row.tab_switches ?? 0,
  ];
}

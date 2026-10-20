// What to call a paper on the student's screens. Every paper is an
// "assessment", but a student handing in Assignment 3 was asked to "Submit
// Final Exam" — wrong, and alarming on a practice paper they can retake.
// Seatwork is its own kind; an assignment or a quiz says so in its title;
// anything else is an exam.

/** "Seatwork", "Assignment", "Quiz" or "Exam". */
export function paperNoun(exam) {
  if (exam?.kind === 'seatwork') return 'Seatwork';
  const title = String(exam?.title || '');
  if (/\bassignment\b/i.test(title)) return 'Assignment';
  if (/\bquiz\b/i.test(title)) return 'Quiz';
  return 'Exam';
}

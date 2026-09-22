// The two client-side gate flags, in one place.
//
// Both live in sessionStorage, which belongs to the TAB rather than to the
// login, so both are scoped to the student as well: a lab machine hands the
// same tab to the next student, and what one of them has cleared must not
// clear it for the next.
//
// They are a convenience, never an authority. The password flag only says
// "do not ask this student again in this tab"; the server decides whether the
// paper is actually handed over, and get_exam_questions() (sql/020) wants an
// exam_unlocks row, not a sessionStorage key. The two can disagree — changing
// a paper's password tears up every unlock server-side while the flag in the
// tab survives — so whoever trusts the flag has to cope with being turned
// away anyway. See ExamBoard's loadQuestions.
export const PASSWORD_PREFIX  = 'exam_pass_ok_';
export const READINESS_PREFIX = 'exam_ready_ok_';

export const passwordKey  = (studentId, examId) => `${PASSWORD_PREFIX}${studentId}_${examId}`;
export const readinessKey = (studentId, examId) => `${READINESS_PREFIX}${studentId}_${examId}`;

/** Forget a student is through a paper's password gate, so they are asked again. */
export function clearPasswordGate(studentId, examId) {
  try { sessionStorage.removeItem(passwordKey(studentId, examId)); } catch { /* private mode */ }
}

/** Every gate flag in this tab, for logout — see App.jsx. */
export function clearAllGates() {
  try {
    Object.keys(sessionStorage)
      .filter(k => k.startsWith(PASSWORD_PREFIX) || k.startsWith(READINESS_PREFIX))
      .forEach(k => sessionStorage.removeItem(k));
  } catch { /* private mode */ }
}

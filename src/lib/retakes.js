// When a student is allowed to sit a paper again.
//
// `allow_retakes` can be switched on AFTER a class has already sat the paper —
// that is the normal way it gets used: mark the exam, then re-open it for
// revision. Everything that decides "this student is finished with this paper"
// therefore has to read the switch as it is NOW, not as it was when the row in
// `results` was written. Anything that only looks for a results row locks out
// exactly the students the instructor just tried to let back in.
//
// submit_assessment() already does the right thing server-side: with retakes on
// it files the sitting in review_attempts and never touches the graded row. So
// nothing here is about protecting a grade — it is only about which screen the
// student is shown.

/**
 * Is this paper closed for this student for good?
 *
 * @param assessment      the paper, for its allow_retakes switch
 * @param hasGradedResult whether a row exists in `results` for this student
 */
export function isPaperFinished(assessment, hasGradedResult) {
  return !!hasGradedResult && !assessment?.allow_retakes;
}

/**
 * What ExamBoard should do with the live_sessions row it just found.
 *
 * A row is left behind by every sitting — the student's own submit, an
 * instructor force-submit, and an instructor dismiss all set it to 'finished'.
 * Telling those apart is what decides whether the clock starts again:
 *
 *   'blocked'  already submitted, no retakes — show the done screen
 *   'restart'  a previous sitting completed and retakes are on — NEW sitting,
 *              so created_at, answers and violations all start from zero
 *   'reopen'   finished with nothing submitted — the instructor dismissed a
 *              sitting that is still running, so put it back as it was
 *   'continue' still active or locked — the ordinary resume path
 *
 * The distinction 'restart' vs 'reopen' matters more than it looks: reusing a
 * finished row's created_at would hand the retake whatever was left of the
 * first sitting's clock, and the live monitor would read it as timed out and
 * force-submit it within seconds of the student starting.
 */
export function sittingDecision({
  sessionStatus,
  allowRetakes = false,
  hasGradedResult = false,
  hasPriorAttempt = false,
} = {}) {
  if (sessionStatus !== 'finished') return 'continue';
  if (hasGradedResult && !allowRetakes) return 'blocked';
  // A completed sitting on file — graded or practice — means this mount is the
  // student coming back for another go.
  if (hasGradedResult || hasPriorAttempt) return 'restart';
  return 'reopen';
}

/** The fields that make a live_sessions row a fresh sitting again. */
export function restartPatch(now = new Date()) {
  return {
    status: 'active',
    created_at: now.toISOString(),
    updated_at: now,
    answers_json: {},
    essay_answers_json: {},
    answers_count: 0,
    violation_count: 0,
    violation_log: [],
  };
}

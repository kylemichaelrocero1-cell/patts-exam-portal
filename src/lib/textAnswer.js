// An answer typed as a word, not as maths — the JS twin of text_answer_key()
// and text_answer_verdict() (sql/046). The dashboard re-marks with this, and
// saving there overwrites the database's mark, so the two must agree;
// sql/test/text_answers.test.mjs runs both over the same strings.
//
// A rubric in this mode is { mode: 'text', steps: [{ latex, marks }],
// accept?: [...] } — the shape of a one-line maths item, so the key and the
// accept list sit where they always have.

/** Is this rubric (or a work_mode string) a text answer? */
export function isTextAnswer(rubricOrMode) {
  return (typeof rubricOrMode === 'string' ? rubricOrMode : rubricOrMode?.mode) === 'text';
}

// The ends a word may carry without changing it: a full stop, a comma,
// quotes, brackets. The same class as the SQL, character for character.
const ENDS = /^[.,;:!?"'()[\]“”‘’]+|[.,;:!?"'()[\]“”‘’]+$/g;

/** What a typed word is compared as: lower case, no spaces, bare ends. */
export function textAnswerKey(answer) {
  return String(answer ?? '').toLowerCase().replace(/\s+/g, '').replace(ENDS, '');
}

/** null when the answer is accepted, otherwise the reason. Never quotes the key. */
export function textAnswerVerdict(answer, accepted) {
  const mine = textAnswerKey(answer);
  if (mine === '') return 'Nothing was written.';
  return (accepted || []).some(a => textAnswerKey(a) !== '' && textAnswerKey(a) === mine)
    ? null : 'Not the right answer.';
}

/** The forms a text rubric accepts: the key first, then the accept list. */
export function textAccepted(rubric) {
  const steps = Array.isArray(rubric?.steps) ? rubric.steps : [];
  return [steps[steps.length - 1]?.latex, ...(Array.isArray(rubric?.accept) ? rubric.accept : [])]
    .map(v => String(v ?? '').trim()).filter(Boolean);
}

/** Mark a text item as markAnswer() reports: all or nothing, on the last line. */
export function markTextAnswer(lines, rubric) {
  const stated = Number(rubric?.marks);
  const total = Number.isFinite(stated) && stated > 0 ? stated
    : (Number(rubric?.steps?.[rubric.steps.length - 1]?.marks) || 1);
  const work = (lines || []).map(l => String(l ?? '')).filter(l => l.trim() !== '');
  const answer = work[work.length - 1] || '';
  if (!answer) {
    return { marks: 0, total, correct: false, blank: true, answer: '', reason: 'Nothing was written.' };
  }
  const verdict = textAnswerVerdict(answer, textAccepted(rubric));
  return {
    marks: verdict === null ? total : 0, total, correct: verdict === null, blank: false, answer,
    reason: verdict === null ? 'Correct answer.' : verdict,
  };
}

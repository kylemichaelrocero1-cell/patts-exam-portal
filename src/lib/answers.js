// A question's answer, whether one choice or several.
//
// Two markable question types (sql/018):
//   multiple_choice — one right answer, picked with a radio
//   multi_select    — several right answers, ticked with checkboxes
//
// A multi_select item is marked ALL OR NOTHING. The set a student ticks must
// equal the key exactly: miss one of three right answers and the item scores
// nothing, exactly as ticking a wrong fourth would. There is no partial
// credit, and it is not a setting — it is what the type means.
//
// The real marking happens in Postgres, in score_answers(), because the key
// is withheld from the browser (sql/003). Everything here is the same rule
// spelt again for the screens that have the key legitimately — the
// instructor's dashboard, and the answer review a student is shown after
// submitting — plus the shape handling the exam board needs while a paper is
// being sat.
//
// SHAPES. The key is `correct_answer` (an int) or `correct_answers` (an array
// of ints), never both. A student's answer follows suit: an int for a
// single-answer item, an array of ints for a multi-answer one. Both sides are
// read through indexSet() so a comparison never depends on which of the two
// it was handed, nor on the order the indices arrived in.

/** Is this item ticked rather than picked? */
export function isMultiSelect(q) {
  return (q?.question_type || 'multiple_choice') === 'multi_select';
}

/**
 * Any key or answer as a sorted, duplicate-free array of choice indices.
 * Null means there is nothing there — no answer, or no key — which is
 * deliberately distinct from an empty array so "left blank" and "answered"
 * never collapse into each other.
 */
export function indexSet(value) {
  let list;
  if (Array.isArray(value)) list = value;
  // Some drivers hand back jsonb as a string; so does a hand-edited row.
  else if (typeof value === 'string' && value.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(value);
      list = Array.isArray(parsed) ? parsed : [];
    } catch { list = []; }
  }
  else if (value === null || value === undefined || value === '') list = [];
  else list = [value];

  const nums = list.map(Number).filter(n => Number.isInteger(n) && n >= 0);
  if (nums.length === 0) return null;
  return [...new Set(nums)].sort((a, b) => a - b);
}

/** The item's key, as a set. Null when it has none — an essay, or an unkeyed item. */
export function correctSetOf(q) {
  if (isMultiSelect(q)) return indexSet(q?.correct_answers);
  return indexSet(q?.correct_answer);
}

/** Exact set equality. Both sides come from indexSet(), so both are sorted. */
export function sameSet(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

/**
 * Mark one answer. Null — not false — when the item was left blank, so a
 * blank is never counted as a wrong answer that was actually given.
 */
export function isAnswerCorrect(q, value) {
  const chosen = indexSet(value);
  if (chosen === null) return null;
  return sameSet(chosen, correctSetOf(q));
}

/** Ticking a box on, or off again. Always an array, so the shape says "multi". */
export function toggleIndex(value, index) {
  const set = indexSet(value) || [];
  return set.includes(index)
    ? set.filter(i => i !== index)
    : [...set, index].sort((a, b) => a - b);
}

/** Is this choice part of the answer held for the item? */
export function isSelected(value, index) {
  return (indexSet(value) || []).includes(index);
}

/** Has the item been answered at all? Every box unticked has not. */
export function hasAnswer(value) {
  return indexSet(value) !== null;
}

/** How many of these answers count as answered. */
export function answeredCount(answers) {
  return Object.values(answers || {}).filter(hasAnswer).length;
}

/** Is a multi-answer key usable against this many choices? */
export function keySetIsValid(set, count) {
  return Array.isArray(set) && set.length > 0
    && set.every(i => Number.isInteger(i) && i >= 0 && i < count);
}

/**
 * One answer as submit_assessment() wants it: an array for a multi-answer
 * item, a plain index for a single-answer one, and undefined for a blank,
 * which is then left out of the payload entirely rather than sent as null.
 *
 * The shape is taken from the value, not from the question, so this works on
 * a payload rebuilt from localStorage or from live_sessions.answers_json
 * without the paper in hand.
 */
export function answerPayload(value) {
  const set = indexSet(value);
  if (set === null) return undefined;
  return Array.isArray(value) ? set : set[0];
}

/** Every answer as the payload, blanks dropped. */
export function answersPayload(answers) {
  const out = {};
  Object.entries(answers || {}).forEach(([qId, value]) => {
    const v = answerPayload(value);
    if (v !== undefined) out[String(qId)] = v;
  });
  return out;
}

export const QUESTION_TYPES = [
  { value: 'multiple_choice', label: 'Multiple Choice' },
  { value: 'multi_select', label: 'Multiple Answers' },
  { value: 'essay', label: 'Essay / Open-ended' },
  // sql/024. Marked out of `marks` rather than counted as one item, and marked
  // in the instructor's browser rather than in Postgres, so it is handled
  // apart from the three above everywhere it appears.
  { value: 'worked_solution', label: 'Worked Solution (maths)' },
];

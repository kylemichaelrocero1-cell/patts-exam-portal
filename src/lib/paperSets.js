// Papers in sets (sql/116).
//
// A question may belong to one set — set_label 'A'…'Z' — or to every set
// (no label). A paper with labelled questions offers one Start button per
// set and each student sits one set; the server records which and marks,
// counts and reviews only that set and the items in every set. These are
// the same rules for the dashboard, which reads filed papers.

/** A set label as stored: one capital letter, or null for "every set". */
export function normaliseSetLabel(raw) {
  const whole = String(raw ?? '').trim().toUpperCase();
  if (!whole || whole === '*' || whole === 'ALL') return null;
  const t = whole.replace(/^SET\s*/, '');
  return /^[A-Z]$/.test(t) ? t : undefined;   // undefined: not a set label
}

/** Is this item on a paper sitting `set`? Items with no label are in every set. */
export function inSet(q, set) {
  return !q?.set_label || q.set_label === set;
}

/** The items a student sitting `set` had. With no set (a paper without sets), all of them. */
export function questionsForSet(questions, set) {
  const list = questions || [];
  if (!list.some(q => q?.set_label)) return list;
  return list.filter(q => inSet(q, set));
}

/** The distinct set labels on these questions, sorted. */
export function setsOf(questions) {
  return [...new Set((questions || []).map(q => q?.set_label).filter(Boolean))].sort();
}

/**
 * The set a filed paper was sat in, read from its answers: every typed item
 * of the student's set is filed even when left blank (sql/083, 116), and a
 * picked item only when answered — so the set with the most of its items in
 * the answers is theirs. Null on a paper without sets, or with no answers.
 */
export function setOfAnswers(questions, answers) {
  const sets = setsOf(questions);
  if (sets.length === 0 || !answers) return null;
  let best = null, bestN = 0;
  for (const set of sets) {
    const n = (questions || []).filter(q => q.set_label === set && answers[q.id] !== undefined).length;
    if (n > bestN) { best = set; bestN = n; }
  }
  return best;
}

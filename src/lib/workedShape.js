// The shape of a worked answer, with no maths in it.
//
// Split out from workedSolution.js on purpose. That file imports the checker,
// which imports Compute Engine — three megabytes of computer algebra that must
// only ever be fetched when a student actually opens a maths item. The exam
// board needs to know which items are worked and whether they have been
// answered on EVERY render, so if those two helpers lived beside the marking
// code the whole algebra system would be dragged into the main bundle and
// downloaded by every student sitting a paper of plain multiple choice.

/** Is this item worked rather than picked? */
export function isWorkedSolution(q) {
  return (q?.question_type || 'multiple_choice') === 'worked_solution';
}

/**
 * The lines a student has stored for an item, as a plain array.
 * Work is held as { lines: [...] } so the shape has room to grow — a scratch
 * pad, a chosen method — without another migration.
 */
export function linesOf(value) {
  if (Array.isArray(value)) return value.map(String);
  if (Array.isArray(value?.lines)) return value.lines.map(String);
  if (typeof value === 'string' && value.trim()) return [value];
  return [];
}

/** Has the student written anything at all? */
export function hasWork(value) {
  return linesOf(value).some(l => l.trim() !== '');
}

/**
 * What a paper scored, with worked items folded in.
 *
 * A result row carries two scores that mean different things. `score` out of
 * `total_items` is a COUNT of picked items, marked in Postgres the instant the
 * paper was submitted. `work_marks` out of `work_total` is a sum of MARKS on
 * worked items, and it cannot exist until an instructor has opened the script
 * — deciding that 5(1)x^{1-1} is 5 needs a computer algebra system, and the
 * database has none (see sql/024).
 *
 * So there is a real window in which a paper is half-marked, and this is the
 * one place that decides how to show it:
 *
 *   no worked items          — exactly what it always showed
 *   marked                   — the two added together
 *   worked items, not marked — the count so far, out of the FULL total, and
 *                              `pending` set so the screen can say why the
 *                              number will go up
 *
 * The total includes the unmarked marks on purpose. Showing 12/12 and then
 * 14/20 an hour later reads as a mark being taken away; showing 12/20 with
 * "8 marks awaiting marking" is the same fact told honestly.
 *
 * `pct` is deliberately null while anything is pending, because a percentage
 * of a partly-marked paper is a number nobody should act on.
 */
export function combinedScore(row) {
  const mcScore = Number(row?.score) || 0;
  const mcTotal = Number(row?.total_items) || 0;
  const workTotal = Number(row?.work_total) || 0;
  // null and undefined mean "not marked"; 0 means "marked, earned nothing".
  const rawMarks = row?.work_marks;
  const marked = rawMarks !== null && rawMarks !== undefined && rawMarks !== '';
  const workMarks = marked ? Number(rawMarks) || 0 : 0;

  if (workTotal <= 0) {
    return {
      score: mcScore, total: mcTotal, pending: 0, marked: true,
      pct: mcTotal > 0 ? Math.round((mcScore / mcTotal) * 100) : null,
    };
  }

  const total = mcTotal + workTotal;
  const score = mcScore + workMarks;
  return {
    score, total,
    pending: marked ? 0 : workTotal,
    marked,
    pct: marked && total > 0 ? Math.round((score / total) * 100) : null,
  };
}

/** The marks available on the worked items of a paper. 0 when it has none. */
export function workMarksAvailable(questions) {
  return (questions || [])
    .filter(isWorkedSolution)
    .reduce((t, q) => t + (Number(q.marks) || 1), 0);
}

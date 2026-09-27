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
  // An item may be worth more than one point (sql/025), so the picked-item
  // half of the score has two possible sources and they mean different things:
  //
  //   points_earned / points_total — the WEIGHTED sum, written from 025 on
  //   score / total_items          — a COUNT of items, on every row ever
  //
  // Points win when they are there. They are absent on every row written
  // before 025, and falling back to the count is exactly right for those:
  // every item was worth one then, so the two numbers were the same, and a
  // paper from last term keeps reading as the 40/50 it always was instead of
  // being silently restated. NOT the same as points_total being zero, which is
  // a real paper with no picked items on it at all.
  const weighted = row?.points_total !== null && row?.points_total !== undefined
    && row?.points_total !== '';
  const mcScore = Number(weighted ? row.points_earned : row?.score) || 0;
  const mcTotal = Number(weighted ? row.points_total : row?.total_items) || 0;
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

/**
 * The answer a worked item is marked on: the last line with anything on it.
 * The same line score_answers() picks in Postgres (sql/027), so the item
 * analysis groups students by exactly what was marked.
 */
export function finalLineOf(value) {
  const lines = linesOf(value).map(l => l.trim()).filter(Boolean);
  return lines.length ? lines[lines.length - 1] : '';
}

/**
 * The model answer and every other answer the paper accepts, as LaTeX. The
 * model answer is the rubric's last step — what the question list shows.
 */
export function workedKeyOf(q) {
  const steps = Array.isArray(q?.work_rubric?.steps) ? q.work_rubric.steps : [];
  const model = String(steps[steps.length - 1]?.latex ?? '').trim();
  const accepted = (Array.isArray(q?.work_rubric?.accept) ? q.work_rubric.accept : [])
    .map(a => String(a ?? '').trim())
    .filter(a => a && a !== model);
  return { model, accepted };
}

/**
 * How a class did on one worked item, for the item analysis.
 *
 * A worked item has no choices to count, so what the class needs to see is
 * how many got it right and — the useful part — what the rest actually
 * wrote. Answers are grouped by the line that was marked, most common first,
 * so a misconception the whole class shares sits at the top.
 *
 * Right means FULL marks, read from the marks on file rather than the
 * checker's `correct` flag: an instructor's override (record_work_marks,
 * sql/024) replaces the item without that flag, and the mark it sets is the
 * one that counts. Marks of null are an item submitted but not yet marked.
 *
 * @param q        the question, for its id and what it is worth
 * @param answered one results.answers_json per student who sat the paper
 */
export function workedItemStats(q, answered) {
  const worth = Number(q?.marks) || 1;
  const stats = { sat: 0, blank: 0, pending: 0, full: 0, partial: 0, zero: 0, groups: [] };
  const byAnswer = new Map();

  (answered || []).forEach(aj => {
    stats.sat++;
    const item = aj?.[q?.id];
    const line = finalLineOf(item);
    if (!line) { stats.blank++; return; }

    const raw = item?.marks;
    const pending = raw === null || raw === undefined || raw === '';
    const earned = pending ? 0 : Number(raw) || 0;
    const outOf = Number(item?.of ?? item?.total) || worth;
    const verdict = pending ? 'pending' : earned >= outOf ? 'full' : earned > 0 ? 'partial' : 'zero';
    stats[verdict]++;

    const g = byAnswer.get(line) || { latex: line, count: 0, full: 0, partial: 0, zero: 0, pending: 0 };
    g.count++;
    g[verdict]++;
    byAnswer.set(line, g);
  });

  stats.groups = [...byAnswer.values()].sort((a, b) => b.count - a.count);
  return stats;
}

// Marks for a worked solution.
//
// The item carries a total — 3 marks, say — and the instructor's own working,
// typed line by line in the same editor the student uses. Each of those lines
// is a MILESTONE worth some of the total:
//
//   y' = 5(1)x^{1-1}    1 mark    power rule applied
//   y' = 5              2 marks   final answer
//
// A student earns a milestone by writing ANY line equivalent to it. Equivalent,
// not identical: 5·1·x^0 earns the first milestone as surely as 5(1)x^{1-1}
// does, because src/lib/mathCheck.js compares meaning rather than typing.
//
// THE FULL-MARKS RULE. A student who reaches the last milestone with every
// step sound gets the whole total, even if they never wrote a line matching
// the middle ones. This is deliberate. Milestones are the instructor's route,
// not the only route, and a shorter correct derivation is not worth fewer
// marks. Milestones exist to award PARTIAL credit to work that stops early or
// ends wrong — which is exactly the "incomplete solution loses marks" case.
//
// PENALTIES. A line that provably does not follow from the one above costs
// `penaltyPerBrokenStep`. Only 'broken' counts, never 'unsure': when the
// engine cannot decide, the student keeps the benefit of the doubt. A mark
// can never fall below zero or rise above the item's total.
//
// WHERE THIS RUNS. Twice, and the difference matters.
//   * In the STUDENT's browser while they work, with no rubric — they get
//     step ticks only (checkWork), never a mark and never a milestone.
//   * In the INSTRUCTOR's browser when they open the paper, with the rubric,
//     to produce the mark of record. The instructor already holds the answer
//     key there legitimately, so no key leaves the server for a student, and
//     no student's browser ever computes the mark it is graded on.
// That split is why the rubric column is revoked from anon in sql/024.

import { checkWork, latexEquivalent, isFinalForm } from './mathCheck.js';

// Re-exported so a caller that already holds the marking code need not know
// the shape helpers live in their own module; a caller that wants ONLY the
// shape imports workedShape.js directly and pays nothing for the algebra.
export { isWorkedSolution, linesOf, hasWork } from './workedShape.js';

/** A rubric's milestones, normalised. Blank lines and junk marks dropped. */
export function milestonesOf(rubric) {
  const steps = Array.isArray(rubric?.steps) ? rubric.steps : [];
  return steps
    .map(s => ({
      latex: String(s?.latex ?? '').trim(),
      // null, '' and undefined all mean "no marks stated", which is not the
      // same as zero — Number() would turn every one of them into 0 and keep
      // a half-filled editor row as a real milestone worth nothing.
      marks: s?.marks === null || s?.marks === undefined || s?.marks === ''
        ? NaN : Number(s.marks),
      label: String(s?.label ?? '').trim(),
    }))
    .filter(s => s.latex && Number.isFinite(s.marks) && s.marks >= 0);
}

/** The item's total. The instructor's number wins; otherwise the steps sum. */
export function totalMarks(rubric) {
  const stated = Number(rubric?.marks);
  if (Number.isFinite(stated) && stated > 0) return stated;
  const sum = milestonesOf(rubric).reduce((t, s) => t + s.marks, 0);
  return sum > 0 ? sum : 1;
}

/**
 * Mark one student's working against a rubric.
 *
 * Returns the mark, the per-line verdicts (so the instructor sees the same
 * ticks and crosses the student saw), which milestones were reached, and a
 * short reason for the number — a mark nobody can explain is not a mark.
 */
export function markWork(lines, rubric, opts = {}) {
  const variable = rubric?.variable || opts.variable || 'x';
  const total = totalMarks(rubric);
  const milestones = milestonesOf(rubric);
  const work = (lines || []).map(l => String(l ?? '').trim()).filter(Boolean);

  if (work.length === 0) {
    return { marks: 0, total, steps: [], milestones: [], reason: 'Nothing was written.', blank: true };
  }

  const steps = checkWork(work, { variable });
  const broken = steps.filter(s => s.status === 'broken').length;
  const invalid = steps.filter(s => s.status === 'invalid').length;

  // Which milestones did any line reach?
  //
  // The last milestone is the answer, and it is held to a higher standard:
  // equivalent AND written out, so working that stops at 5(1)x^{1-1} earns
  // the power-rule mark but not the mark for finishing. Every milestone
  // before it asks only for equivalence, because how a student writes an
  // intermediate step is their business.
  const lastIndex = milestones.length - 1;
  const hit = milestones.map((m, i) => ({
    ...m,
    reached: i === lastIndex
      ? work.some(line => isFinalForm(line, m.latex))
      : work.some(line => latexEquivalent(line, m.latex) === 'equal'),
  }));
  const finalHit = hit.length > 0 && hit[hit.length - 1].reached;

  const penalty = Number.isFinite(Number(rubric?.penaltyPerBrokenStep))
    ? Number(rubric.penaltyPerBrokenStep) : 1;
  const deduction = (broken + invalid) * penalty;

  let marks, reason;
  if (finalHit && broken === 0 && invalid === 0) {
    marks = total;
    reason = 'Correct answer reached and every step follows.';
  } else {
    const earned = hit.filter(m => m.reached).reduce((t, m) => t + m.marks, 0);
    marks = Math.max(0, Math.min(total, earned - deduction));
    const bits = [];
    bits.push(finalHit ? 'Correct answer reached' : 'Did not reach the final answer');
    const got = hit.filter(m => m.reached).length;
    if (milestones.length) bits.push(`${got} of ${milestones.length} expected steps shown`);
    if (deduction > 0) bits.push(`−${deduction} for ${broken + invalid} step${broken + invalid === 1 ? '' : 's'} that do not follow`);
    reason = bits.join('; ') + '.';
  }

  return { marks: round2(marks), total, steps, milestones: hit, reason, blank: false };
}

// Half marks are common; thirds are not. Two places is enough to keep a sum
// of awarded marks from drifting on display.
function round2(n) {
  return Math.round(n * 100) / 100;
}

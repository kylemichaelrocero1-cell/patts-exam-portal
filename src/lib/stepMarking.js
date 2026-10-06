// A full solution marked line by line — the JS twin of mark_working()
// (sql/042). The dashboard re-marks with this, and saving there overwrites
// the database's mark, so the two must agree; sql/test/
// working_line_by_line.test.mjs runs both over the same cases.
//
// A rubric in this mode is { mode: 'lines', steps: [...] }, each step
// { latex, accept?, marks, alone? }. The student writes the solution over
// several lines without numbering them, and the item earns the BEST of:
//   * any step before the last, found on any line — that step's marks;
//   * the last step, on the LAST line, with every earlier step found on
//     earlier lines in order — its marks, the item's full marks;
//   * the last step on the last line without that working — `alone`.
// Nothing is ever taken away.
import { mathAnswersMatch } from './mathNormalize.js';
import { labelProblem } from './mathLabel.js';

/** Is a rubric marked line by line? */
export function isLineByLine(rubric) {
  return rubric?.mode === 'lines';
}

/** The forms a step accepts: its own latex first, then its accept list. */
export function stepAccepted(step) {
  return [step?.latex, ...(Array.isArray(step?.accept) ? step.accept : [])]
    .map(v => String(v ?? '').trim()).filter(Boolean);
}

/**
 * worked_answer_verdict() (sql/032) in JS: null when the line is one of the
 * accepted answers with an acceptable label, otherwise the reason.
 */
export function answerVerdict(line, accepted) {
  const s = String(line ?? '');
  if (!s.trim()) return 'Not an accepted answer.';
  if (!(accepted || []).some(acc => mathAnswersMatch(s, acc))) return 'Not an accepted answer.';
  return labelProblem(s, accepted);
}

/**
 * Mark a solution. `lines` are what the student wrote, in order; blanks are
 * dropped here as the database drops them on save. Returns
 * { marks, of, correct, reason, lineSteps } where lineSteps[i] is the 1-based
 * step line i matched, or null. The reason never quotes the key.
 */
export function markWorking(lines, rubric) {
  const steps = Array.isArray(rubric?.steps) ? rubric.steps : [];
  const work = (lines || []).map(l => String(l ?? '')).filter(l => l.trim() !== '');
  const n = steps.length;
  if (n === 0) {
    return { marks: 0, of: 0, correct: false, reason: 'This question has no answer key.', lineSteps: [] };
  }
  const full = Number(steps[n - 1]?.marks) || 0;
  const alone = Number(steps[n - 1]?.alone) || 0;
  if (work.length === 0) {
    return { marks: 0, of: full, correct: false, reason: 'Nothing was written.', lineSteps: [] };
  }

  // Which step each line is: the latest step it matches, so a line written
  // for step 3 is never read as step 2.
  const accepted = steps.map(stepAccepted);
  const lineSteps = work.map(line => {
    for (let i = n; i >= 1; i--) if (answerVerdict(line, accepted[i - 1]) === null) return i;
    return null;
  });
  const first = steps.map((_, i) => lineSteps.indexOf(i + 1) + 1); // 1-based, 0 = none

  let best = 0, reason = null;
  for (let i = 1; i <= n - 1; i++) {
    const m = Number(steps[i - 1]?.marks) || 0;
    if (first[i - 1] > 0 && m > best) {
      best = m;
      reason = 'Part of the solution is right, but the final answer is not there yet.';
    }
  }

  if (lineSteps[work.length - 1] === n) {
    let chain = true, prev = 0;
    for (let i = 1; i <= n - 1; i++) {
      const at = first[i - 1];
      if (at === 0 || at <= prev || at >= work.length) { chain = false; break; }
      prev = at;
    }
    const shown = 'The final answer is right, but the working that leads to it is not all shown.';
    if (chain && full >= best) { best = full; reason = 'Correct, with the working shown.'; }
    else if (!chain && alone > best) { best = alone; reason = shown; }
    else if (!chain && alone >= best) { reason = shown; }
  }

  return {
    marks: best, of: full, correct: best >= full && full > 0,
    reason: reason || 'None of these lines is a step of the solution.',
    lineSteps,
  };
}

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

import { checkWork, latexEquivalent, isFinalForm, parseLine, equivalent, freshEngine,
         indefiniteIntegrand, antiderivativeTarget, derivativeSubjectOf,
         differentiate } from './mathCheck.js';
import { labelOf, labelProblem, labelsAgree, withoutLabel } from './mathLabel.js';
import { mathAnswersMatch } from './mathNormalize.js';

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

/**
 * Mark a worked item ALL OR NOTHING on its final answer.
 *
 * This is what an answer-only item wants, and it is deliberately not markWork()
 * with one milestone. markWork also validates the chain, so a student who
 * writes a bare `5` where the key says y' = 5 would be judged on whether `5`
 * follows from `y = 5x` — it does not, as a line of algebra — and lose a mark
 * to a penalty despite having given the right answer. With no working to
 * show, there is no chain to judge, so there should be none.
 *
 * The test is isFinalForm(), not plain equivalence, so the answer has to be
 * about the right thing AND written out: for "solve 2x + 4 = 10", the line
 * 2x = 6 is an equivalent equation but is not an answer, and 5(1)x^{1-1} is
 * the right number but is not a finished one.
 *
 * Any line the student wrote may carry the answer. They are given one field,
 * but stored work is a list and a paper answered before that was true must
 * still mark correctly.
 */
export function markAnswer(lines, rubric, opts = {}) {
  // Nothing the engine learned from the last answer carries into this one.
  freshEngine();
  const total = totalMarks(rubric);
  const milestones = milestonesOf(rubric);
  const key = milestones.length ? milestones[milestones.length - 1].latex : null;
  const work = (lines || []).map(l => String(l ?? '').trim()).filter(Boolean);

  if (work.length === 0) {
    return { marks: 0, total, correct: false, blank: true, answer: '',
             reason: 'Nothing was written.' };
  }
  const answer = work[work.length - 1];
  if (!key) {
    return { marks: 0, total, correct: false, blank: false, answer,
             reason: 'This question has no answer key, so it cannot be marked automatically.' };
  }

  // A problem that asks for an ANTIDERIVATIVE cannot be marked by comparing
  // the answer to the key, because the key carries a constant of integration
  // and the student's may be called anything or left off entirely — C, K and
  // nothing at all are all correct, while a numeric comparison reads C and K
  // as two unrelated unknowns that disagree. Such an answer is marked by
  // differentiating it instead: the constant differentiates away and the
  // question disappears with it.
  //
  // BOTH shapes count, and they must, because a student meets them as the same
  // exercise: y = \int f dx, and dy/dx = f. Handling only the integral meant a
  // differential equation answered y = x^2 + K scored zero while the identical
  // integral answered y = x^2 + K scored full.
  const given = String(opts.given ?? rubric?.given ?? '').trim();
  const variable = opts.variable || rubric?.variable || 'x';
  const target = given ? antiderivativeTarget(given) : null;

  // THE LABEL IS JUDGED ON ITS OWN (mathLabel.js, and sql/032 in the
  // database, which must agree), so the value is compared with the labels
  // off: isFinalForm's own subject check took f'(x) for f''(x) and g''(x)
  // for f''(x), and would overrule the stricter rule the database applies.
  const accepted = [key, ...(Array.isArray(rubric?.accept) ? rubric.accept : [])]
    .map(a => String(a ?? '').trim()).filter(Boolean);

  // Against EVERY accepted answer, not just the key — the database does, and
  // the engine cannot always see what the instructor can: 3y^2y' is
  // 3y^2 dy/dx, but to the engine y' and dy/dx are two unrelated things, so a
  // key-only check re-marked it wrong and saving overturned the database.
  //
  // The VALUE is compared with every label off, whether or not the key has
  // one — as the database does (sql/032: a key with no label judges none,
  // and the label is judged separately below when it has one). Handing the
  // engine the label as well made the answer mean whatever the engine had
  // last seen: k^{(4)}(s) = 0 read as "s times k to the fourth" on a fresh
  // engine and as a fourth derivative after the problem k(s) = … had been
  // parsed, so a right answer on "find the fourth derivative" was marked
  // wrong on the dashboard while the database had it right.
  const isRight = line => {
    if (!target) {
      return accepted.some(acc => {
        // Whatever the database would take, this takes — its own tidying,
        // not the engine's reading of it (mathNormalize.js).
        if (mathAnswersMatch(line, acc)) return true;
        const a = derivAsUnknown(withoutLabel(line)), b = derivAsUnknown(withoutLabel(acc));
        // Algebra only where it means something. An unworked limit, integral
        // or d/dx is the question, not an answer, unless the key is one
        // itself — "write the expression … do not simplify" wants the
        // limit written out, and its value is not what was asked. And a
        // derivative the engine cannot treat as an unknown it reads as a
        // constant, making 2y^2 dy/dx "equal" to 3y^2 dy/dx.
        if (UNWORKED.test(a) || UNWORKED.test(b) || HOLDS_DERIVATIVE.test(a) || HOLDS_DERIVATIVE.test(b)) return false;
        return isFinalForm(a, b);
      });
    }
    const p = parseLine(line);
    if (!p.valid) return false;
    // An answer still holding the integral, or still written as a derivative,
    // has not been evaluated — however equivalent to the question it is.
    if (indefiniteIntegrand(p.rhs)) return false;
    if (p.isEquation && derivativeSubjectOf(p.lhs)) return false;
    const d = differentiate(p.rhs, variable);
    return !!d && equivalent(d, target) === 'equal';
  };

  const valueRight = work.some(isRight);
  // Only once the value is right: a wrong value with a wrong label is wrong
  // for its value, and saying so is the more useful reason.
  const labelWrong = valueRight ? labelProblem(answer, accepted) : null;
  const correct = valueRight && !labelWrong;
  return {
    marks: correct ? total : 0,
    total, correct, blank: false, answer,
    reason: correct
      ? 'Correct answer.'
      : labelWrong
        || (equivalentToKey(work, key)
          ? 'Equal to the answer but not simplified, or not in the form asked for.'
          : 'Not the right answer.'),
    ...(labelWrong ? { labelWrong: true } : {}),
    // Kept so the instructor can see WHY a near miss was refused rather than
    // having to work it out from the number.
    nearMiss: !correct && !labelWrong && equivalentToKey(work, key),
    ...(opts.variable ? { variable: opts.variable } : {}),
  };
}

function equivalentToKey(work, key) {
  return work.some(line => latexEquivalent(line, key) === 'equal');
}

// The operation a question asks for, not yet carried out: a limit, an
// integral, or d/dx (d^2/dx^2…) applied to something.
const UNWORKED = /\\lim|\\int|\\frac\{(?:d|\\differentialD|\\mathrm\{d\})(?:\^\{?\d+\}?)?\}\{/;

/**
 * dy/dx and y' as unknowns of their own. In implicit differentiation that is
 * what they are, and it is the only way the engine can compare them: left
 * alone it reads dy/dx as a constant (y does not depend on x as far as it
 * knows), so d/dx of anything came out equal to 3y^2 dy/dx. Second
 * derivatives become a different unknown from first ones.
 */
export function derivAsUnknown(s) {
  const D = String.raw`(?:d|\\differentialD|\\mathrm\{d\})`;
  return String(s ?? '')
    .replace(new RegExp(String.raw`\\frac\{${D}\s*\^\{?2\}?\s*y\}\{${D}\s*x\s*\^\{?2\}?\}`, 'g'), ' R ')
    .replace(new RegExp(String.raw`\\frac\{${D}\s*y\}\{${D}\s*x\}`, 'g'), ' Q ')
    .replace(/d\s*y\s*\/\s*\(?\s*d\s*x\s*\)?/g, ' Q ')
    .replace(/y\s*(?:\^\{\\prime\\prime\}|'')/g, ' R ')
    .replace(/y\s*(?:\^\{\\prime\}|\^\\prime|')/g, ' Q ');
}

/**
 * Is `line` the same VALUE as `acc`, whatever its form — not simplified, a
 * negative exponent for a fraction, factors in another order? Labels off,
 * dy/dx and y' as unknowns, a clean engine, and never through an unworked
 * limit, integral or d/dx. Unlike markAnswer() it does not ask whether the
 * answer is written about as simply as the key: this is for an instructor
 * whose rule is that an unsimplified answer is right unless the question
 * asks for simplest form.
 */
export function sameValueAs(line, acc) {
  const a = derivAsUnknown(withoutLabel(line)), b = derivAsUnknown(withoutLabel(acc));
  if (UNWORKED.test(a) || UNWORKED.test(b) || HOLDS_DERIVATIVE.test(a) || HOLDS_DERIVATIVE.test(b)) return false;
  // Still an equation once any label is off means its left side is not a
  // label at all — m^4(v) = 0 is a power, not a fourth derivative — and an
  // equation is not the same thing as a value.
  if (a.includes('=') !== b.includes('=')) return false;
  freshEngine();
  try { return latexEquivalent(a, b) === 'equal'; } catch { return false; }
}

// A derivative written into an answer's value: y', \prime, \frac{dy}{dx},
// \frac{d}{dx}, dy/dx, dy/(dx), d^3y/(dx^3).
const HOLDS_DERIVATIVE =
  /'|\\prime|\\frac\{d[\^{}0-9]*[a-z]?\}\{d[a-z]|(^|[^a-z\\])d[\^{}0-9]*[a-z]\s*\/\s*\(?\s*d[a-z]/i;

/**
 * Is `form`, offered as another accepted answer, the same as `answer`?
 * 'equal', 'different' or 'unknown'. This is the question editor's warning
 * and marks nothing: it is advice to the instructor.
 *
 * The label and the value are judged apart, as the marker judges them. And
 * where either value holds a derivative the engine's opinion is worthless:
 * it reads dy/dx as a constant, so 2y^2 dy/dx came out EQUAL to 3y^2 dy/dx,
 * and it reads dy/(dx) as d times y over d times x, so 3y^2 dy/(dx) came out
 * DIFFERENT from 3y^2 \frac{dy}{dx}. Those are 'unknown' — no warning is
 * better than a wrong one, which invites deleting a right answer.
 */
export function acceptedFormVerdict(form, answer) {
  const lf = labelOf(form), la = labelOf(answer);
  if (lf && la && !labelsAgree(lf, la)) return 'different';
  const a = withoutLabel(form), b = withoutLabel(answer);
  if (HOLDS_DERIVATIVE.test(a) || HOLDS_DERIVATIVE.test(b)) return 'unknown';
  return latexEquivalent(a, b);
}

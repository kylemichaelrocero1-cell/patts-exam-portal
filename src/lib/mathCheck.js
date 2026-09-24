// Marking a worked solution — a student's chain of algebra, line by line.
//
// A worked_solution item (sql/024) is not picked or ticked, it is WORKED. The
// student types a stack of lines in a maths editor and each line is checked
// against the one above it, the way an instructor reads down a page:
//
//   y = 5x                 <- the problem, given
//   y' = 5(1)x^{1-1}       <- power rule applied
//   y' = 5                 <- simplified
//
// WHAT "CHECKED" MEANS. Two lines agree when they are mathematically the same
// thing, not when they are typed the same way. 5(1)x^{1-1} and 5 are the same
// number for every x, so the third line follows from the second. That test is
// the whole engine, and it is deliberately blind to form: a student who writes
// x^{-1} where the key says 1/x is right, and is marked right.
//
// HOW EQUIVALENCE IS DECIDED. Two independent tests, because neither alone is
// trustworthy:
//
//   symbolic — simplify(a - b) = 0. Decisive when it answers, but Compute
//     Engine returns undefined for anything it cannot reduce, which is often
//     (see the probes: e^{ln x} vs x came back undecided).
//   numeric  — evaluate both at a fixed spread of sample points and compare.
//     Nearly always answers, and a single disagreeing point is PROOF of
//     difference, so this is what makes a "wrong" verdict safe to show.
//
// The points straddle zero on purpose. Sampling only positives once made
// sqrt(x^2) and x look equal; they are not, and the negative points catch it.
// Points where either side is undefined (a hole, a log of a negative, a divide
// by zero) are skipped rather than counted as disagreement, so x^2-1 over x-1
// still matches x+1 despite the hole at 1.
//
// NOTHING HERE IS A SECURITY BOUNDARY. The mark this file computes in a
// student's browser is a hint shown while they work, never the mark of record.
// The mark that counts is computed from the stored lines in the INSTRUCTOR's
// browser, which holds the key legitimately, and written to results from
// there. See markWork() and src/lib/workedSolution.js.

// Compute Engine is about a megabyte, and most papers have no maths item at
// all, so it is never in the initial bundle. Everything below needs ready()
// to have been awaited once; the UI does that when a maths item first opens.
let engine = null;

export async function ready() {
  if (!engine) {
    const { ComputeEngine } = await import('@cortex-js/compute-engine');
    engine = new ComputeEngine();
  }
  return engine;
}

/** Is the engine loaded? Lets a caller render a spinner without awaiting. */
export function isReady() {
  return engine !== null;
}

/** For tests, which build their own engine rather than importing twice. */
export function useEngine(ce) {
  engine = ce;
}

// Sample points, fixed rather than random so a mark never changes between two
// runs on the same work — a student and their instructor must see the same
// verdict. Irrational-ish values, straddling zero, none of them at a common
// singularity (0, 1, -1) where too many expressions are undefined at once.
const POINTS = [0.7314, -1.2837, 2.4142, -0.4531, 3.3166, -2.7183, 1.1067, -3.6180];

// Symbols that are constants, not free variables, and must never be sampled.
const CONSTANTS = new Set(['e', 'i', 'pi', 'Pi', 'ExponentialE', 'ImaginaryUnit', 'Nothing']);

/**
 * Every free variable in an expression, as a sorted array. Walks the MathJSON
 * rather than the LaTeX, so \cdot, spacing and bracket style cannot affect it.
 */
export function freeVars(box) {
  const found = new Set();
  const walk = node => {
    if (typeof node === 'string') {
      if (/^[a-zA-Z][a-zA-Z0-9_]*$/.test(node)) found.add(node);
      return;
    }
    if (Array.isArray(node)) {
      // node[0] is the head — "Add", "Multiply", "Sin" — never a variable.
      node.slice(1).forEach(walk);
      return;
    }
    if (node && typeof node === 'object' && typeof node.sym === 'string') found.add(node.sym);
  };
  walk(box?.json);
  CONSTANTS.forEach(c => found.delete(c));
  return [...found].sort();
}

/**
 * One line of work, parsed.
 *
 * `isEquation` splits a line into the two sides of its `=`. That split is what
 * makes step checking possible at all: y' = 5 tells us both what is being
 * claimed (5) and what it is being claimed about (y'), and the left side is
 * how a derivative announces itself between one line and the next.
 */
export function parseLine(latex) {
  const src = String(latex ?? '').trim();
  if (!src) return { empty: true, valid: false, latex: src };

  let box;
  try { box = engine.parse(src); } catch { return { valid: false, latex: src, error: 'parse' }; }
  if (!box || box.isValid === false) return { valid: false, latex: src, error: 'syntax' };

  const json = box.json;
  if (Array.isArray(json) && json[0] === 'Equal' && json.length === 3) {
    return {
      valid: true, latex: src, isEquation: true,
      lhs: engine.box(json[1]), rhs: engine.box(json[2]), box,
    };
  }
  return { valid: true, latex: src, isEquation: false, lhs: null, rhs: box, box };
}

/** Evaluate a boxed expression at one substitution. Null when undefined there. */
function valueAt(box, sub) {
  let out;
  try { out = box.subs(sub).N(); } catch { return null; }
  const re = out?.re, im = out?.im ?? 0;
  if (typeof re !== 'number' || !Number.isFinite(re)) return null;
  // A complex result means the point is outside the real domain — sqrt of a
  // negative, say. Skipped, not counted against the student.
  if (Math.abs(im) > 1e-9) return null;
  return re;
}

/**
 * Do two expressions agree numerically? Returns true (agreed everywhere it
 * could be tested), false (disagreed somewhere — proof they differ), or null
 * (never got a usable pair of values, so no opinion).
 *
 * Variables are offset against each other between rounds so that x and y are
 * not handed the same value every time; f(x,y) = x + y and 2x would otherwise
 * look identical.
 */
export function numericAgree(a, b) {
  const vars = [...new Set([...freeVars(a), ...freeVars(b)])];
  let tested = 0;
  for (let round = 0; round < POINTS.length; round++) {
    const sub = {};
    vars.forEach((v, i) => { sub[v] = POINTS[(round + i * 3) % POINTS.length]; });
    const va = valueAt(a, sub);
    const vb = valueAt(b, sub);
    if (va === null || vb === null) continue;
    tested++;
    const tol = 1e-8 * Math.max(1, Math.abs(va), Math.abs(vb));
    if (Math.abs(va - vb) > tol) return { agree: false, tested };
  }
  return { agree: tested > 0 ? true : null, tested };
}

/**
 * Are two expressions the same thing?
 *
 *   'equal'     — they agree, symbolically or at every point tested
 *   'different' — they disagree at a point, which is proof
 *   'unknown'   — neither test could say (no real values anywhere)
 *
 * Numeric disagreement outranks a symbolic 'equal' because a counter-example
 * is a fact and a simplifier's opinion is not.
 */
export function equivalent(a, b) {
  if (!a || !b) return 'unknown';
  let ea, eb;
  try { ea = a.evaluate(); eb = b.evaluate(); } catch { ea = a; eb = b; }

  const num = numericAgree(ea, eb);
  if (num.agree === false) return 'different';

  let sym;
  try { sym = engine.box(['Subtract', ea, eb]).simplify().isEqual(0); } catch { sym = undefined; }
  if (sym === true) return 'equal';
  if (num.agree === true) return 'equal';
  if (sym === false) return 'different';
  return 'unknown';
}

/**
 * Are two written lines the same claim? Used to decide whether a student's
 * line reaches one of the instructor's milestones.
 *
 * Two equations about the SAME subject are compared on their right-hand sides
 * alone. That is not a shortcut, it is the only thing that works: y' = 5 and
 * y' = 5(1)x^{1-1} cannot be compared as whole equations, because sampling
 * y' means substituting a number into a derivative, which is meaningless and
 * yields no points to compare. Matching the subject first and then the value
 * sidesteps that entirely.
 */
export function latexEquivalent(a, b) {
  const pa = parseLine(a), pb = parseLine(b);
  if (!pa.valid || !pb.valid) return 'unknown';
  if (pa.isEquation && pb.isEquation) {
    if (sameSubject(pa.lhs, pb.lhs)) return equivalent(pa.rhs, pb.rhs);
    // Different subjects: the equations may still be rearrangements.
    return sameEquation(pa, pb) ? 'equal' : 'different';
  }
  // A bare expression is read as the value it carries, so `5` matches `y' = 5`.
  return equivalent(pa.rhs, pb.rhs);
}

/**
 * Do two left-hand sides name the same thing? Structural identity first,
 * because y' and dy/dx are not numbers and cannot be sampled; only then the
 * general test, which handles f(x) written two ways.
 */
export function sameSubject(a, b) {
  if (!a || !b) return false;
  if (JSON.stringify(normalizeSubject(a.json)) === JSON.stringify(normalizeSubject(b.json))) return true;
  return equivalent(a, b) === 'equal';
}

// y', dy/dx and (d/dx)y all mean the first derivative of y, but they parse to
// three different trees. Reduced to one shape so a student is never marked
// down for preferring Leibniz to Lagrange.
function normalizeSubject(json) {
  const d = derivativeJson(json);
  return d ? ['Prime', d] : json;
}

/**
 * Is one equation a rearrangement of another?
 *
 * Written as lhs - rhs = 0, two equations say the same thing when their
 * left-hand sides are the same up to a non-zero constant factor: 2x = 6 and
 * x = 3 become 2x - 6 and x - 3, a constant ratio of 2, so the step is sound.
 * A ratio that moves with x means the step changed the equation's meaning.
 *
 * This is also why x^2 = 4 does not licence x = 2: the ratio is not constant,
 * and it should not be — that step drops a root.
 */
export function sameEquation(pa, pb) {
  const da = engine.box(['Subtract', pa.lhs, pa.rhs]);
  const db = engine.box(['Subtract', pb.lhs, pb.rhs]);
  return constantRatio(da, db) !== null;
}

/** The constant k with a = k·b, or null when no single k fits every point. */
export function constantRatio(a, b) {
  const vars = [...new Set([...freeVars(a), ...freeVars(b)])];
  let ratio = null, tested = 0;
  for (let round = 0; round < POINTS.length; round++) {
    const sub = {};
    vars.forEach((v, i) => { sub[v] = POINTS[(round + i * 3) % POINTS.length]; });
    const va = valueAt(a, sub);
    const vb = valueAt(b, sub);
    if (va === null || vb === null) continue;
    // Where the divisor vanishes the ratio says nothing, but the other side
    // must vanish too — otherwise these are certainly not proportional.
    if (Math.abs(vb) < 1e-12) {
      if (Math.abs(va) > 1e-9) return null;
      continue;
    }
    const r = va / vb;
    tested++;
    if (ratio === null) ratio = r;
    else if (Math.abs(r - ratio) > 1e-7 * Math.max(1, Math.abs(ratio))) return null;
  }
  if (tested === 0 || ratio === null || Math.abs(ratio) < 1e-9) return null;
  return ratio;
}

// A left-hand side that announces a derivative. y' parses to ["Prime","y"];
// dy/dx and (d/dx)y both parse to a ["D", ...] wrapper. Recognising these is
// what lets the checker know that the line below is meant to be the
// derivative of the line above rather than equal to it.
function derivativeJson(j) {
  if (!Array.isArray(j)) return null;
  if (j[0] === 'Prime' && j.length >= 2) return j[1];
  if (j[0] === 'D' && j.length >= 2) {
    const inner = j[1];
    // \frac{dy}{dx} arrives as ["D",["Function",["Block","y"],"x"],"x"]
    if (Array.isArray(inner) && inner[0] === 'Function') {
      const body = inner[1];
      if (Array.isArray(body) && body[0] === 'Block') return body[1];
      return body;
    }
    return inner;
  }
  return null;
}

function derivativeOf(lhsBox) {
  const j = derivativeJson(lhsBox?.json);
  return j === null ? null : engine.box(j);
}

/** d/dv of an expression, evaluated. Null when the engine cannot take it. */
export function differentiate(box, variable = 'x') {
  try {
    const d = engine.box(['D', box, variable]).evaluate();
    return d && d.isValid !== false ? d : null;
  } catch { return null; }
}

/**
 * Does `cur` follow from `prev`?
 *
 * Verdicts:
 *   'ok'       — it follows, by whichever rule is named in `rule`
 *   'invalid'  — the line is not readable maths
 *   'broken'   — readable, but it does not follow: this is the one that
 *                costs marks, and it is only ever returned on PROOF
 *                (a sample point where the two disagree)
 *   'unsure'   — neither could be established; treated as not-wrong, because
 *                an engine that cannot decide must not penalise a student
 *
 * The rules, in the order they are tried:
 *   restate      — same line again, or the same equation rearranged
 *   simplify     — same left-hand side, right-hand side equivalent
 *   differentiate— left-hand side went from y to y', right-hand side is d/dx
 *   evaluate     — a bare expression equivalent to the one above
 */
export function checkStep(prev, cur, opts = {}) {
  const variable = opts.variable || 'x';
  const p = typeof prev === 'string' ? parseLine(prev) : prev;
  const c = typeof cur === 'string' ? parseLine(cur) : cur;

  if (!c || c.empty) return { status: 'empty' };
  if (!c.valid) return { status: 'invalid', message: 'This line is not readable as maths.' };
  // With nothing above it, a first line can only be judged on being readable.
  if (!p || p.empty || !p.valid) return { status: 'ok', rule: 'first' };

  // A derivative announced on the left: y -> y', or y -> dy/dx.
  if (c.isEquation && p.isEquation) {
    const wrt = derivativeOf(c.lhs);
    if (wrt && sameSubject(wrt, p.lhs)) {
      const d = differentiate(p.rhs, variable);
      if (!d) return { status: 'unsure', rule: 'differentiate' };
      const verdict = equivalent(d, c.rhs);
      if (verdict === 'equal') return { status: 'ok', rule: 'differentiate' };
      if (verdict === 'different') {
        return { status: 'broken', rule: 'differentiate',
          message: 'That is not the derivative of the line above.' };
      }
      return { status: 'unsure', rule: 'differentiate' };
    }

    // Same subject on the left: the right-hand side must not have changed value.
    if (sameSubject(c.lhs, p.lhs)) {
      const verdict = equivalent(p.rhs, c.rhs);
      if (verdict === 'equal') return { status: 'ok', rule: 'simplify' };
      if (verdict === 'different') {
        return { status: 'broken', rule: 'simplify',
          message: 'This line is not equal to the line above.' };
      }
      return { status: 'unsure', rule: 'simplify' };
    }

    // Neither: the equation as a whole may still have been rearranged validly.
    if (sameEquation(p, c)) return { status: 'ok', rule: 'restate' };
    return { status: 'broken', rule: 'restate',
      message: 'This line does not follow from the line above.' };
  }

  // Bare expressions, or a mix: compare the value each line carries.
  const verdict = equivalent(p.rhs, c.rhs);
  if (verdict === 'equal') return { status: 'ok', rule: 'evaluate' };
  if (verdict === 'different') {
    return { status: 'broken', rule: 'evaluate',
      message: 'This line is not equal to the line above.' };
  }
  return { status: 'unsure', rule: 'evaluate' };
}

/**
 * Check a whole stack of lines, each against the one above it.
 * Blank lines are dropped first, so a gap left mid-working is not an error.
 */
export function checkWork(lines, opts = {}) {
  const kept = (lines || []).map(l => String(l ?? '').trim()).filter(Boolean);
  const parsed = kept.map(parseLine);
  return parsed.map((line, i) => ({
    latex: kept[i],
    ...checkStep(i === 0 ? null : parsed[i - 1], line, opts),
  }));
}

/**
 * How big is this expression? A plain node count over the MathJSON tree.
 *
 * Needed because equivalence is blind to form, and a final answer is not.
 * 5(1)x^{1-1} and 5 are the same number, so no equivalence test will ever
 * separate them — but only one of them is an answer a student has finished
 * simplifying. Size is the crude, reliable way to tell: seven nodes against
 * one. It is never used to judge a step, only to decide whether working has
 * actually been carried through to the end.
 */
export function complexity(box) {
  let n = 0;
  const walk = node => {
    n++;
    if (Array.isArray(node)) node.slice(1).forEach(walk);
  };
  walk(box?.json);
  return n;
}

/**
 * Is `line` an acceptable FINAL answer for `key` — equal to it, and written
 * no less plainly? The slack lets a student say 2.5 where the key says 5/2,
 * or keep a unit, without letting 5(1)x^{1-1} pass as a finished answer.
 */
export function isFinalForm(line, key) {
  if (latexEquivalent(line, key) !== 'equal') return false;
  const pl = parseLine(line), pk = parseLine(key);
  if (!pl.valid || !pk.valid) return false;
  const a = complexity(pl.rhs), b = complexity(pk.rhs);
  return a <= b + 2;
}

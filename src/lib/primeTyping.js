// Primes as the maths keyboard should write them: all on one level.
//
// Pressing the prime button (or the ' key) with the caret INSIDE a
// superscript — after pressing the exponent button first, or after arrowing
// back into a prime already there — made each new prime an exponent of the
// last one: f^{\prime^{\prime}}, drawn as a prime with a tiny prime on top of
// it, where the student meant f''. Every route produced its own shape:
//
//   f^{\prime^{\prime}}        prime, left arrow, prime
//   f^{^{\prime}^{\prime}}     exponent button, then prime twice
//   f^{\prime}^{^{\prime}}     prime, exponent button, prime
//   f^{\prime^{}\prime}        with an empty box left between them
//   f^{\prime}^{\prime}        prime twice at the base (drawn fine, stored
//                              as two superscripts)
//
// canonicalPrimes() rewrites any run of superscripts that holds nothing but
// primes (and empty boxes) as ONE superscript, f^{\prime\prime}, which is
// what f'' is. A superscript with anything else in it — x^{2}, e^{-x} — is
// never touched.

const PRIME = /^\\prime(?![a-zA-Z])/;
const DOUBLE = /^\\doubleprime(?![a-zA-Z])/;

/** The index just past the group opening at s[i] === '{', or -1. */
function groupEnd(s, i) {
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === '{') depth++;
    else if (s[j] === '}') { depth--; if (depth === 0) return j + 1; }
  }
  return -1;
}

/** How many primes this text is made of, or null if it holds anything else. */
function primesIn(t) {
  let n = 0, i = 0;
  while (i < t.length) {
    const rest = t.slice(i);
    if (/^\s/.test(rest)) { i++; continue; }
    if (DOUBLE.test(rest)) { n += 2; i += 12; continue; }
    if (PRIME.test(rest)) { n += 1; i += 6; continue; }
    if (t[i] === "'") { n += 1; i++; continue; }
    if (t[i] === '{') {
      const e = groupEnd(t, i); if (e < 0) return null;
      const inner = primesIn(t.slice(i + 1, e - 1)); if (inner === null) return null;
      n += inner; i = e; continue;
    }
    if (t[i] === '^') {
      const u = unitAt(t, i); if (!u) return null;
      n += u.count; i = u.end; continue;
    }
    return null;
  }
  return n;
}

/** A superscript of primes only, starting at s[i] === '^': { count, end } or null. */
function unitAt(s, i) {
  const j = i + 1;
  if (s[j] === '{') {
    const e = groupEnd(s, j); if (e < 0) return null;
    const count = primesIn(s.slice(j + 1, e - 1));
    return count === null ? null : { count, end: e };
  }
  const rest = s.slice(j);
  if (DOUBLE.test(rest)) return { count: 2, end: j + 12 };
  if (PRIME.test(rest)) return { count: 1, end: j + 6 };
  return null;
}

/**
 * { latex, changedEnd }: the LaTeX with every run of prime superscripts
 * made one, and the index just past the last run that changed (-1 if none
 * did), which is where the caret belongs afterwards.
 */
export function canonicalPrimes(latex) {
  const s = String(latex ?? '');
  let out = '', i = 0, changedEnd = -1;
  while (i < s.length) {
    if (s[i] === '^') {
      // A run: consecutive prime superscripts, allowing an empty base {}
      // between them, which is how an editor may write a second one.
      let j = i, total = 0, units = 0;
      for (;;) {
        let k = j;
        if (s.startsWith('{}', k) && s[k + 2] === '^' && units > 0) k += 2;
        if (s[k] !== '^') break;
        const u = unitAt(s, k); if (!u) break;
        total += u.count; units++; j = u.end;
      }
      if (units > 0 && total > 0) {
        const canon = `^{${'\\prime'.repeat(total)}}`;
        out += canon;
        if (s.slice(i, j) !== canon) changedEnd = out.length;
        i = j;
        continue;
      }
    }
    out += s[i++];
  }
  return { latex: out, changedEnd };
}

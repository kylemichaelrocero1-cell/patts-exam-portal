// The LABEL on a typed maths answer — the f''(x) in f''(x) = 12x^2 - 12x.
//
// Marking used to strip the label from both sides and compare what was left,
// so f(x) = 12x^2 - 12x scored full marks on "find the second derivative":
// the value was right and the label, which is the whole point of the
// question, was never looked at. A label is now part of the answer:
//
//   * If the answer key has a label, the student's must say the same thing —
//     the same function and the same order of derivative, about the same
//     variable. f''(x), f'', d^2f/dx^2 and (d^2/dx^2)f(x) all agree. f(x),
//     f'(x) and g''(x) do not.
//   * A missing label is wrong too. "Find the second derivative" answered
//     12x^2 - 12x has not said what 12x^2 - 12x is.
//   * y is the generic dependent variable, so y'' and d^2y/dx^2 count for
//     f''(x). Only y: g''(x) is still wrong. (Instructor's call, 2026-09-27.)
//   * A key with NO label judges none. A limit answered 6 or L = 6 is marked
//     on the 6, exactly as before. Put the label in the key to make it count.
//
// This file and sql/032 are the same rule twice — the dashboard re-marks a
// script in the browser, and the database marks it on submit, and they must
// agree or saving a script from the dashboard would overturn the database's
// mark. sql/test/labels.test.mjs runs both over one list of cases.

// Tidied the way sql/032's math_label() tidies, CASE KEPT: F is not f.
function tidy(latex) {
  let t = String(latex ?? '');
  t = t.replace(/\\[,;:!]|\\quad|\\qquad|\\ /g, '');
  t = t.replace(/\\left|\\right/g, '');
  t = t.replace(/\\[dt]frac/g, '\\frac');
  t = t.replace(/\\(mathrm|operatorname)\{d\}|\\differentialD/g, 'd');
  t = t.replace(/\s+/g, '');
  // The editor writes ^{\prime}; a person writes '. Longest first.
  t = t.split('^{\\prime\\prime\\prime}').join("'''")
       .split('^{\\prime\\prime}').join("''")
       .split('^{\\prime}').join("'")
       .split('\\doubleprime').join("''")
       .split('^\\prime').join("'")
       .split('\\prime').join("'");
  t = t.split('^{}').join('');
  t = t.replace(/\{([A-Za-z0-9])\}/g, '$1').replace(/\{([A-Za-z0-9])\}/g, '$1');
  return t;
}

const ARG = '([A-Za-z]|-?[0-9]+(?:\\.[0-9]+)?)';
const SHAPES = [
  // f, f', f''(x), h''(2)
  { re: new RegExp(`^([A-Za-z])('*)(?:\\(${ARG}\\))?$`),
    read: m => ({ fn: m[1], order: m[2].length, at: m[3] || '' }) },
  // f^{(4)}(x)
  { re: new RegExp(`^([A-Za-z])\\^\\{?\\(([0-9]+)\\)\\}?(?:\\(${ARG}\\))?$`),
    read: m => ({ fn: m[1], order: Number(m[2]), at: m[3] || '' }) },
  // \frac{d^2y}{dx^2}
  { re: /^\\frac\{d(?:\^([0-9]+))?([A-Za-z])\}\{d([A-Za-z])(?:\^([0-9]+))?\}$/,
    read: m => (m[1] || '1') === (m[4] || '1')
      ? { fn: m[2], order: Number(m[1] || 1), at: m[3] } : null },
  // d^2y/dx^2, dy/(dx)
  { re: /^d(?:\^([0-9]+))?([A-Za-z])\/\(?d([A-Za-z])(?:\^([0-9]+))?\)?$/,
    read: m => (m[1] || '1') === (m[4] || '1')
      ? { fn: m[2], order: Number(m[1] || 1), at: m[3] } : null },
  // \frac{d^2}{dx^2}f(x)
  { re: /^\\frac\{d(?:\^([0-9]+))?\}\{d([A-Za-z])(?:\^([0-9]+))?\}([A-Za-z])(?:\(([A-Za-z])\))?$/,
    read: m => (m[1] || '1') === (m[3] || '1')
      ? { fn: m[4], order: Number(m[1] || 1), at: m[2] } : null },
];

/**
 * The label on an answer, as { fn, order, at }, or null when there is none —
 * no `=`, or a left-hand side that is not a label (2x = 6 is an equation).
 * `at` is the variable or value it is taken at: x in f''(x) and d^2y/dx^2,
 * 2 in h''(2), '' in y''.
 */
export function labelOf(latex) {
  const t = tidy(latex);
  const eq = t.indexOf('=');
  if (eq <= 0) return null;
  const lhs = t.slice(0, eq);
  for (const { re, read } of SHAPES) {
    const m = lhs.match(re);
    if (m) return read(m);
  }
  return null;
}

/** The label as a person would write it: f''(x), y''', f^(4)(x). */
export function showLabel(l) {
  if (!l) return '';
  const marks = l.order > 3 ? `^(${l.order})` : "'".repeat(l.order);
  return `${l.fn}${marks}${l.at ? `(${l.at})` : ''}`;
}

/**
 * Does the student's label say what the key's does? Same order, same
 * variable when both name one, and the same function — or y, standing in
 * for a function the key names. Not the other way round, and not for a key
 * like x = 3, where x is the unknown being solved for, not a function.
 */
export function labelsAgree(student, key) {
  if (!student || !key) return false;
  if (student.order !== key.order) return false;
  const keyIsAFunction = key.order > 0 || /^[A-Za-z]$/.test(key.at);
  const sameFn = student.fn === key.fn || (student.fn === 'y' && keyIsAFunction);
  if (!sameFn) return false;
  if (student.at && key.at && student.at !== key.at) return false;
  return true;
}

/**
 * Why the label on `answer` is not acceptable against these accepted
 * answers, or null when it is — including when no accepted answer carries a
 * label, since then there is nothing to judge. Call it only once the value
 * itself is known to be right: it says nothing about the value.
 */
export function labelProblem(answer, accepted) {
  const keyLabels = (accepted || []).map(labelOf).filter(Boolean);
  if (keyLabels.length === 0) return null;
  const want = showLabel(keyLabels[0]);
  const own = labelOf(answer);
  if (own && keyLabels.some(k => labelsAgree(own, k))) return null;
  if (!own && !tidy(answer).includes('=')) {
    return `Right value, but no label — the answer should begin ${want} =`;
  }
  return own
    ? `Right value, but the wrong label: ${showLabel(own)} where the question asks for ${want}.`
    : `Right value, but the left-hand side is not the notation asked for (${want}).`;
}

/** The answer with a recognised label taken off, for comparing the value alone. */
export function withoutLabel(latex) {
  if (!labelOf(latex)) return String(latex ?? '');
  const s = String(latex ?? '');
  return s.slice(s.indexOf('=') + 1);
}

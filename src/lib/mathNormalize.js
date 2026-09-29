// The database's way of comparing two typed answers, in JavaScript.
//
// The database marks by STRING after tidying both sides (sql/027, revised
// by 030-033, 036 and 037): normalize_math(), math_as_number() and
// math_answers_match(). The dashboard re-marks a script when it is opened,
// and saving overwrites the database's mark — so the dashboard has to be
// able to say "the database would take this" for itself. This file is that,
// step for step. sql/test/keyboard_leftovers.test.mjs runs both over one
// list of answers and fails on any difference.
//
// It is deliberately NOT algebra. x^{-1} and 1/x differ here, as they do in
// the database; the maths engine (mathCheck.js) is what sees them as equal.

// math_drop_spaces() (037): every kind of LaTeX space, empty ^{} and _{},
// and a superscript with no base wrapped round the whole answer.
export function dropSpaces(p) {
  return String(p ?? '')
    .replace(/\\[,;:!> ]|\\q?quad|\\(neg)?(thin|med|thick)space|\\enspace|\\hspace\*?\{[^}]*\}|~/g, '')
    .replace(/[\^_]\{\s*\}/g, '')
    .replace(/^\s*\^\{(.*)\}\s*$/s, '$1');
}

// math_primes() (036): every \prime as ', however many.
export function primes(p) {
  return String(p ?? '')
    .split('\\doubleprime').join("''").split('\\prime').join("'")
    .replace(/\^\{('+)\}/g, '$1')
    .replace(/\^(')/g, '$1');
}

// math_label_lhs_pattern() (032), on lower-cased, tidied text.
const LABEL_LHS = new RegExp('^('
  + "[a-z]'*(\\(([a-z]|-?[0-9]+(\\.[0-9]+)?)\\))?"
  + '|[a-z]\\^\\{?\\([0-9]+\\)\\}?(\\(([a-z]|-?[0-9]+(\\.[0-9]+)?)\\))?'
  + '|\\\\frac\\{d\\^?[0-9]*[a-z]\\}\\{d[a-z]\\^?[0-9]*\\}'
  + '|d(\\^[0-9]+)?[a-z]/\\(?d[a-z](\\^[0-9]+)?\\)?'
  + '|\\\\frac\\{d(\\^[0-9]+)?\\}\\{d[a-z](\\^[0-9]+)?\\}[a-z](\\([a-z]\\))?'
  + ')=');

const unwrap = t => t.replace(/\{([a-z0-9])\}/g, '$1');

/** normalize_math() as of sql/037. */
export function normalizeMath(p) {
  let t = dropSpaces(p);                                                   // s1
  t = t.replace(/\\left|\\right/g, '');                                    // s2
  t = t.replace(/\\[dt]frac/g, '\\frac')                                   // s3
    .replace(/\\(mathrm|operatorname)\{d\}|\\differentialD/g, 'd');
  t = t.replace(/\\cdot|\\times|\*/g, '');                                 // s4
  t = t.replace(/\s+/g, '');                                               // s5
  t = t.toLowerCase();                                                     // s6
  t = primes(t);                                                           // s7
  t = t.split('^{}').join('');                                             // s8
  t = unwrap(unwrap(t));                                                   // s9
  t = t.replace(/\\frac\{\(([^(){}]*)\)\}/g, '\\frac{$1}');                // s9n
  t = t.replace(/(\\frac(\{[^{}]*\}|[a-z0-9]))\{\(([^(){}]*)\)\}/g, '$1{$3}'); // s9d
  t = t.replace(/(^|[-=+({])\\frac\{-([0-9a-z.^']+)\}/g, '$1-\\frac{$2}'); // s9b
  t = unwrap(t);                                                           // s9c
  if (LABEL_LHS.test(t)) t = t.replace(/^[^=]*=/, '');                     // s10
  if (/^\((.*)\)$/s.test(t) && t.length > 2) t = t.slice(1, -1);           // s11
  t = t.split('+-').join('-').split('--').join('+');                       // s12
  return t;
}

/** math_as_number() as of sql/036: the answer as a number, or null. */
export function mathAsNumber(p) {
  let t = dropSpaces(p ?? '').replace(/\\left|\\right/g, '').replace(/\s+/g, '').toLowerCase();
  t = t.replace(/\\[dt]frac/g, '\\frac')
    .replace(/\\(mathrm|operatorname)\{d\}|\\differentialD/g, 'd');
  t = unwrap(unwrap(primes(t)));
  if (LABEL_LHS.test(t)) t = t.replace(/^[^=]*=/, '');
  if (/^-?[0-9]+(\.[0-9]+)?$/.test(t)) return Number(t);
  let sign = 1;
  if (t.startsWith('-')) { sign = -1; t = t.slice(1); }
  const m = t.match(/^\\frac(\{-?[0-9]+(?:\.[0-9]+)?\}|[0-9])(\{-?[0-9]+(?:\.[0-9]+)?\}|[0-9])$/);
  if (!m) return null;
  const num = Number(m[1].replace(/[{}]/g, '')), den = Number(m[2].replace(/[{}]/g, ''));
  if (den === 0) return null;
  return sign * (num / den);
}

/** math_answers_match(): would the database call these the same answer? */
export function mathAnswersMatch(a, b) {
  if (a == null || b == null) return false;
  if (!String(a).trim() || !String(b).trim()) return false;
  const na = mathAsNumber(a), nb = mathAsNumber(b);
  if (na !== null && nb !== null) return Math.abs(na - nb) <= 1e-12 * Math.max(1, Math.abs(na), Math.abs(nb));
  if ((na === null) !== (nb === null)) return false;
  return normalizeMath(a) === normalizeMath(b);
}

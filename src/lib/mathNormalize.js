// The database's way of comparing two typed answers, in JavaScript.
//
// The database marks by STRING after tidying both sides (sql/027, revised
// by 030-033 and 036-038): normalize_math(), math_as_number() and
// math_answers_match(). The dashboard re-marks a script when it is opened,
// and saving overwrites the database's mark — so the dashboard has to be
// able to say "the database would take this" for itself. This file is that,
// step for step. sql/test/keyboard_leftovers.test.mjs runs both over one
// list of answers and fails on any difference.
//
// It is deliberately NOT algebra. x^{-1} and 1/x differ here, as they do in
// the database; the maths engine (mathCheck.js) is what sees them as equal.

// math_drop_spaces() (038): every kind of LaTeX space, empty ^{} and _{},
// a superscript with no base wrapped round the whole answer, and any arrow
// (\rightarrow, \longrightarrow, an empty \overrightarrow{}) as \to.
export function dropSpaces(p) {
  return String(p ?? '')
    .replace(/\\[,;:!> ]|\\q?quad|\\(neg)?(thin|med|thick)space|\\enspace|\\hspace\*?\{[^}]*\}|~/g, '')
    .replace(/[\^_]\{\s*\}/g, '')
    .replace(/^\s*\^\{(.*)\}\s*$/s, '$1')
    .replace(/\\(long)?rightarrow(?![a-zA-Z])|\\overrightarrow\{\s*\}/g, '\\to');
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

// math_close() (050): the index of the bracket that closes the ( or { at
// i, or -1. Only the same kind is counted.
export function closeOf(s, i) {
  const o = s[i], c = o === '(' ? ')' : o === '{' ? '}' : null;
  if (!c) return -1;
  let d = 0;
  for (let k = i; k < s.length; k++) {
    if (s[k] === o) d++;
    else if (s[k] === c && --d === 0) return k;
  }
  return -1;
}

/** normalize_math() as of sql/050. */
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
  if (t.length > 2 && t[0] === '(' && closeOf(t, 0) === t.length - 1) t = t.slice(1, -1); // s11 (050)
  t = t.split('+-').join('-').split('--').join('+');                       // s12
  return t;
}

/** math_as_number() as of sql/038: the answer as a number, or null. */
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

// math_unbracket() (045): brackets that cannot change the meaning, removed
// so that 4x(\sin(x^2))(\cos(x^2)) and 4x\sin(x^2)\cos(x^2) are one answer.
// Run on normalised text, from both sides. A bracket stays if it holds a
// top-level + − or =, starts with a sign, is a function's argument, is
// raised, subscripted, primed or divided, or would run two digits together.
function unbracketOk(before, inside, after) {
  if (inside === '' || inside[0] === '-' || inside[0] === '+') return false;
  let d = 0;
  for (const c of inside) {
    if (c === '(' || c === '{') d++;
    else if (c === ')' || c === '}') d--;
    else if (d === 0 && (c === '+' || c === '-' || c === '=')) return false;
  }
  if (/\\[A-Za-z]+(\^(\{[^{}]*\}|.))?$/.test(before)) return false;
  if (['^', '_', '/', "'"].includes(before.slice(-1))) return false;
  if (['^', '_', '/', "'", '!'].includes(after.slice(0, 1))) return false;
  if (/[0-9]$/.test(before) && /^[0-9]/.test(inside)) return false;
  if (/[0-9]$/.test(inside) && /^[0-9]/.test(after)) return false;
  return true;
}

export function unbracket(p) {
  let s = String(p ?? '').split('\\lbrack').join('(').split('\\rbrack').join(')')
    .split('[').join('(').split(']').join(')');
  for (let guard = 0; guard < 200; guard++) {
    let changed = false;
    for (let i = 0; i < s.length && !changed; i++) {
      if (s[i] !== '(') continue;
      let d = 0, j = -1;
      for (let k = i; k < s.length; k++) {
        if (s[k] === '(') d++;
        else if (s[k] === ')' && --d === 0) { j = k; break; }
      }
      if (j > 0 && unbracketOk(s.slice(0, i), s.slice(i + 1, j), s.slice(j + 1))) {
        s = s.slice(0, i) + s.slice(i + 1, j) + s.slice(j + 1);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return s;
}

/** The value part of working_verdict() (045): equal once those brackets go. */
export function sameUnbracketed(a, b) {
  if (a == null || b == null || !String(a).trim() || !String(b).trim()) return false;
  return unbracket(normalizeMath(a)) === unbracket(normalizeMath(b));
}

// math_respell() (050): an answer as the maths keyboard should have spelt
// it. On phones a function name often goes in as plain letters (7cos(7x)),
// a line ends up in a \text{} box, the label lands inside a superscript, a
// full stop stands for a times sign. Each is the same answer, typed
// differently. Applied to the student's line AND to every accepted answer
// before a third look (working_verdict, 050); never to anything stored.
const FN_LETTERS = ['arcsin', 'arccos', 'arctan', 'arcsec', 'arccsc', 'arccot',
  'cosec', 'sin', 'cos', 'tan', 'sec', 'csc', 'cot'];
const FN_BARE = ['arcsin', 'arccos', 'arctan', 'arcsec', 'arccsc', 'arccot',
  'sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'ln', 'log'];
const isLetter = c => c !== undefined && /^[a-zA-Z]$/.test(c);
const isDigit = c => c !== undefined && /^[0-9]$/.test(c);

export function respell(p) {
  let s = String(p ?? '');
  // r1. \left( \right) are plain brackets; \left. \right. draw nothing.
  s = s.replace(/\\(left|right)\./g, '').replace(/\\(left|right)(?![a-zA-Z])/g, '');
  // r2. Text mode: \text{…}, \mathrm{…}, \operatorname{…} hold what they show.
  for (let k = 0; k < 3; k++) {
    s = s.replace(/\\(text|textrm|textit|mathrm|mathit|operatorname)\{([^{}]*)\}/g, '$2');
  }
  s = s.split('\\textasciicircum').join('^').split('\\textbraceleft').join('{')
    .split('\\textbraceright').join('}');
  // r2b. \ast (a star) is a times sign (058).
  s = s.replace(/\\ast(?![a-zA-Z])/g, '\\cdot ');
  // r3. A superscript with no base at the very start: the label typed raised.
  {
    const t = s.replace(/^\s+/, '');
    if (t.startsWith('^{')) {
      const j = closeOf(t, 1);
      if (j > 0) s = t.slice(2, j) + t.slice(j + 1);
    }
  }
  // r4. A script with no base just inside a brace: \frac{3}{_{\sqrt{…}}}.
  for (let g = 0; g < 50; g++) {
    const i = s.search(/\{[\^_]\{/);
    if (i < 0) break;
    const k = closeOf(s, i + 2);
    if (k < 0) break;
    s = s.slice(0, i + 1) + s.slice(i + 3, k) + s.slice(k + 1);
  }
  s = s.split('^{^').join('^{').split('\\placeholder{}').join('');
  // r5. A function name typed as letters, and \cosec, is the function.
  let out = '';
  for (let i = 0; i < s.length;) {
    if (s[i] === '\\') {
      let j = i + 1;
      while (isLetter(s[j])) j++;
      const cmd = s.slice(i, j);
      out += cmd === '\\cosec' ? '\\csc' : cmd;
      i = j;
      continue;
    }
    let name = null, len = 0;
    if (s.startsWith('arc\\', i)) {
      const f = ['sin', 'cos', 'tan', 'sec', 'csc', 'cot'].find(n => s.startsWith(n, i + 4) && !isLetter(s[i + 4 + n.length]));
      if (f) { name = 'arc' + f; len = 4 + f.length; }
    }
    if (!name) {
      const f = FN_LETTERS.find(n => s.startsWith(n, i));
      if (f) { name = f === 'cosec' ? 'csc' : f; len = f.length; }
    }
    if (name) {
      out += '\\' + name;
      i += len;
      if (isLetter(s[i])) out += ' ';
      continue;
    }
    out += s[i++];
  }
  s = out;
  // r6. A full stop between factors is a times sign; in a number it is a point.
  out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '.') { out += s[i]; continue; }
    const a = s[i - 1], b = s[i + 1];
    const decimal = isDigit(b) && (isDigit(a) || a === undefined || /^[=+\-({\s]$/.test(a));
    out += decimal ? '.' : '\\cdot ';
  }
  s = out;
  // r7. Times a negative: a\cdot-b\cdot c is a(-b)c.
  for (let g = 0; g < 50; g++) {
    const m = /\\(cdot|times)(?![a-zA-Z])\s*-/.exec(s);
    if (!m) break;
    const a = m.index + m[0].length - 1;          // the minus
    let k = a + 1, d = 0;
    for (; k < s.length; k++) {
      const c = s[k];
      if (c === '(' || c === '{' || c === '[') d++;
      else if (c === ')' || c === '}' || c === ']') { if (d === 0) break; d--; }
      else if (d === 0 && (c === '+' || c === '-' || c === '=')) break;
      else if (d === 0 && /^\\(cdot|times)(?![a-zA-Z])/.test(s.slice(k))) break;
    }
    s = s.slice(0, m.index) + ' (' + s.slice(a, k) + ')' + s.slice(k);
  }
  // r8. A function's argument without brackets: \cos 7x is \cos(7x),
  // \sin^2 x is \sin^2(x), \tan^{-1}3x^2 is \tan^{-1}(3x^2).
  out = '';
  for (let i = 0; i < s.length;) {
    if (s[i] !== '\\') { out += s[i++]; continue; }
    let j = i + 1;
    while (isLetter(s[j])) j++;
    const name = s.slice(i + 1, j);
    out += s.slice(i, j);
    i = j;
    if (!FN_BARE.includes(name)) continue;
    const pw = /^\^(\{[^{}]*\}|[^{\\])/.exec(s.slice(i));
    if (pw) { out += pw[0]; i += pw[0].length; }
    const sp = /^\s*/.exec(s.slice(i))[0];
    i += sp.length;
    const arg = /^[0-9]*[a-zA-Z](\^(\{[^{}]*\}|[0-9a-zA-Z]))?/.exec(s.slice(i))
      || /^[0-9]+(?![0-9a-zA-Z(\\])/.exec(s.slice(i));
    if (arg) { out += '(' + arg[0] + ')'; i += arg[0].length; }
    else out += sp;
  }
  s = out;
  // r9. A bracket that fills a whole {…}: \frac{(…)}{…}, \sqrt{(…)}.
  for (let g = 0; g < 50; g++) {
    let hit = false;
    for (let i = 0; i < s.length && !hit; i++) {
      if (s[i] !== '{') continue;
      let a = i + 1;
      while (s[a] === ' ') a++;
      if (s[a] !== '(') continue;
      const b = closeOf(s, a), e = closeOf(s, i);
      if (b < 0 || e < 0 || b > e || s.slice(b + 1, e).trim() !== '') continue;
      s = s.slice(0, a) + s.slice(a + 1, b) + s.slice(b + 1);
      hit = true;
    }
    if (!hit) break;
  }
  // r10. A bracket left open is closed at the end.
  const open = [...s].filter(c => c === '(').length - [...s].filter(c => c === ')').length;
  if (open > 0) s += ')'.repeat(open);
  return s;
}

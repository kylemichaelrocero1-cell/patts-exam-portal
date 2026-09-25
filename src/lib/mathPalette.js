// The symbol strip above a maths field, and the one DOM poke that inserts from
// it. Kept out of the component file so that file exports nothing but
// components — a mixed module defeats fast refresh, and a palette that is
// plain data has no business being in a React file anyway.
//
// `#0` in an insertion is where the current selection goes and `#?` is an
// empty slot the caret jumps to, which is MathLive's convention: pressing the
// fraction button with x+1 selected gives (x+1)/▢ with the caret below the
// line, rather than throwing the selection away.
export const MATH_PALETTE = [
  { label: '\\frac{a}{b}', insert: '\\frac{#0}{#?}', title: 'Fraction' },
  { label: 'x^{n}', insert: '^{#?}', title: 'Exponent' },
  { label: 'x_{n}', insert: '_{#?}', title: 'Subscript' },
  { label: '\\sqrt{x}', insert: '\\sqrt{#0}', title: 'Square root' },
  { label: '\\sqrt[n]{x}', insert: '\\sqrt[#?]{#0}', title: 'Nth root' },
  { label: "y'", insert: "'", title: 'Prime (derivative)' },
  { label: '\\frac{dy}{dx}', insert: '\\frac{d#?}{d#?}', title: 'Leibniz derivative' },
  { label: '\\int', insert: '\\int #0 \\,d#?', title: 'Integral' },
  { label: '\\lim', insert: '\\lim_{#?\\to#?}#0', title: 'Limit' },
  { label: '\\pi', insert: '\\pi', title: 'Pi' },
  { label: '\\theta', insert: '\\theta', title: 'Theta' },
  { label: '\\sin', insert: '\\sin(#0)', title: 'Sine' },
  { label: '\\cos', insert: '\\cos(#0)', title: 'Cosine' },
  { label: '\\tan', insert: '\\tan(#0)', title: 'Tangent' },
  { label: '\\ln', insert: '\\ln(#0)', title: 'Natural log' },
  { label: '\\log', insert: '\\log(#0)', title: 'Log' },
  { label: '\\le', insert: '\\le', title: 'Less than or equal' },
  { label: '\\ge', insert: '\\ge', title: 'Greater than or equal' },
  { label: '\\pm', insert: '\\pm', title: 'Plus or minus' },
  { label: '\\infty', insert: '\\infty', title: 'Infinity' },
];

// The field a symbol should go into. On a desktop that is whatever has focus,
// but on a phone the field can lose focus to the button being pressed before
// the handler runs, so the last focused field is remembered as a fallback.
let lastField = null;

/** Called by MathField when one of its fields takes focus. */
export function rememberField(field) {
  lastField = field;
}

/**
 * Insert LaTeX into the maths field the student is working in. False when
 * there is none, so a caller can stay quiet rather than guessing.
 */
export function insertIntoFocusedField(latex) {
  const active = document.activeElement;
  const target = (active && active.tagName === 'MATH-FIELD') ? active : lastField;
  // A remembered field that has since been removed from the page is no use.
  if (!target || typeof target.insert !== 'function' || !target.isConnected) return false;
  target.insert(latex, { focus: true });
  return true;
}


/**
 * Read the two arguments of a \frac starting at `i` (the index of the
 * backslash). Returns null if this is not a well-formed \frac.
 *
 * A brace matcher rather than a regular expression, because the numerator of
 * \frac{x^{2}}{y} contains braces of its own and a regex that stops at the
 * first closing brace cuts it in half.
 */
function readFrac(src, i) {
  if (!src.startsWith('\\frac', i)) return null;
  let j = i + 5;
  const arg = () => {
    while (src[j] === ' ') j++;
    if (src[j] !== '{') return null;
    let depth = 0, start = ++j;
    for (; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') { if (depth === 0) return src.slice(start, j++); depth--; }
    }
    return null;
  };
  const num = arg(); if (num === null) return null;
  const den = arg(); if (den === null) return null;
  return { num, den, end: j };
}

// Does this need brackets round it before a slash goes next to it? A sum or a
// difference does; 2x does not. Only the TOP level counts — the minus inside
// x^{-1} binds tighter than any slash could.
function needsBrackets(t) {
  let depth = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '{' || c === '(') depth++;
    else if (c === '}' || c === ')') depth--;
    else if (depth === 0 && (c === '+' || (c === '-' && i > 0))) return true;
  }
  return false;
}

/**
 * The same expression with \frac written as a slash: \frac{x}{y} becomes x/y,
 * and \frac{x+1}{y} becomes (x+1)/y.
 *
 * Both spellings are natural to type and neither is wrong, but they are
 * different STRINGS — and the database matches answers as strings, because it
 * has no algebra (sql/027). Rather than make normalisation guess where the
 * brackets belong, which cannot be done safely (1/(x+1) and 1/x+1 differ), the
 * other form is simply offered as an accepted answer.
 */
export function fracToSlash(latex) {
  const src = String(latex || '');
  let out = '', i = 0, changed = false;
  while (i < src.length) {
    const f = readFrac(src, i);
    if (f) {
      const num = fracToSlash(f.num), den = fracToSlash(f.den);
      out += `${needsBrackets(num) ? `(${num})` : num}/${needsBrackets(den) || /[*/]/.test(den) ? `(${den})` : den}`;
      i = f.end;
      changed = true;
    } else { out += src[i++]; }
  }
  return changed ? out : src;
}

/** Split on a character that appears at bracket depth zero, or [] if it does not. */
function topLevelSplit(t, ch) {
  let depth = 0;
  for (let i = 1; i < t.length; i++) {
    const c = t[i];
    if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') depth--;
    else if (depth === 0 && c === ch) {
      const a = t.slice(0, i).trim(), b = t.slice(i + 1).trim();
      // Only a clean two-term split; three terms are left alone.
      if (a && b && !topLevelSplit(b, ch).length) return [a, b];
      return [];
    }
  }
  return [];
}

/**
 * Plausible ways a student might write the same answer.
 *
 * These are STRING variants, generated from the answer itself, and they exist
 * because marking now happens in the database (sql/027), where there is no
 * algebra — only matching against a list of accepted forms. The maths engine
 * does understand algebra, so it is used HERE, once, when the question is
 * written, instead of on every paper that is ever marked.
 *
 * Only offered as suggestions. The instructor ticks what they will take,
 * because whether x^{-1} is an acceptable answer to "differentiate ln x" is a
 * teaching judgement and not a fact about arithmetic.
 */
export function suggestVariants(latex) {
  const src = String(latex || '').trim();
  if (!src) return [];
  const out = new Set();
  const add = v => { const t = String(v || '').trim(); if (t && t !== src) out.add(t); };

  // With and without a subject on the left. The database already treats these
  // as one answer, but showing both makes the rule visible.
  const eq = src.indexOf('=');
  const rhs = eq >= 0 ? src.slice(eq + 1).trim() : src;
  const lhs = eq >= 0 ? src.slice(0, eq).trim() : '';
  if (eq >= 0) add(rhs);
  if (lhs === "y'") { add(`\\frac{dy}{dx}=${rhs}`); add(`f'(x)=${rhs}`); }
  if (lhs === '\\frac{dy}{dx}') { add(`y'=${rhs}`); add(rhs); }

  // 1/x and x^{-1}; \frac{a}{b}x^n and a/b as a coefficient.
  const inv = rhs.match(/^\\frac\{1\}\{([a-z])\}$/i);
  if (inv) { add(`${inv[1]}^{-1}`); add(lhs ? `${lhs}=${inv[1]}^{-1}` : `${inv[1]}^{-1}`); }
  const pow = rhs.match(/^([a-z])\^\{-1\}$/i);
  if (pow) { add(`\\frac{1}{${pow[1]}}`); add(lhs ? `${lhs}=\\frac{1}{${pow[1]}}` : ''); }

  // The same answer with every \\frac written as a slash. Just as natural to
  // type, and a different STRING — which is what the database compares.
  const slashed = fracToSlash(rhs);
  if (slashed !== rhs) {
    add(slashed);
    if (lhs) add(`${lhs}=${slashed}`);
  }

  // A fraction of integers, and its decimal.
  const frac = rhs.match(/^\\frac\{(-?\d+)\}\{(-?\d+)\}$/);
  if (frac) {
    const v = Number(frac[1]) / Number(frac[2]);
    if (Number.isFinite(v)) add(lhs ? `${lhs}=${v}` : String(v));
  }

  // Terms the other way round, for a two-term sum. Split at the TOP level
  // only: the + inside \frac{1}{(w+1)^2} is part of a denominator, and
  // splitting there produced the string "1)^2}+\frac{1}{(w" — nonsense that
  // would have gone straight into an accept list.
  const parts = topLevelSplit(rhs, '+');
  if (parts.length === 2) {
    const swapped = `${parts[1]}+${parts[0]}`;
    add(swapped);
    if (lhs) add(`${lhs}=${swapped}`);
  }

  return [...out];
}

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

// Exponentials, the reciprocal trig functions and the hyperbolic ones — the
// names a phone's keyboard makes students spell out letter by letter. sech
// and csch go in as \operatorname{…}: there is no \sech command, and the
// marker reads every spelling of a hyperbolic name as one (sql/081). The
// inverses are written ^{-1}, as the papers give them. Titles differ from
// the calculus strip's, which already has sin, cos, tan, ln and log.
export const FUNCTION_PALETTE = [
  { label: 'e^{x}', insert: 'e^{#?}', title: 'e to a power' },
  { label: '\\log_{b}', insert: '\\log_{#?}(#0)', title: 'Log to a base' },
  { label: '\\sec', insert: '\\sec(#0)', title: 'Secant' },
  { label: '\\csc', insert: '\\csc(#0)', title: 'Cosecant' },
  { label: '\\cot', insert: '\\cot(#0)', title: 'Cotangent' },
  { label: '\\sinh', insert: '\\sinh(#0)', title: 'Hyperbolic sine' },
  { label: '\\cosh', insert: '\\cosh(#0)', title: 'Hyperbolic cosine' },
  { label: '\\tanh', insert: '\\tanh(#0)', title: 'Hyperbolic tangent' },
  { label: '\\operatorname{sech}', insert: '\\operatorname{sech}(#0)', title: 'Hyperbolic secant' },
  { label: '\\operatorname{csch}', insert: '\\operatorname{csch}(#0)', title: 'Hyperbolic cosecant' },
  { label: '\\coth', insert: '\\coth(#0)', title: 'Hyperbolic cotangent' },
  // wide: too long a label for a standard button.
  { label: '\\sinh^{-1}', insert: '\\sinh^{-1}(#0)', title: 'Inverse hyperbolic sine', wide: true },
  { label: '\\cosh^{-1}', insert: '\\cosh^{-1}(#0)', title: 'Inverse hyperbolic cosine', wide: true },
  { label: '\\tanh^{-1}', insert: '\\tanh^{-1}(#0)', title: 'Inverse hyperbolic tangent', wide: true },
];

// The same functions as a tab of the maths keyboard (MathField sets it).
// On a phone or tablet the keyboard covers the strip below the answer, so a
// student typing a hyperbolic answer had to close it, scroll down, tap a
// button and scroll back, or spell sinh out letter by letter on the abc tab.
// Keys write what the strips write.
// The names are for whoever reads this; the keys carry no tooltip, which on
// a phone pops up a bubble over the key being pressed.
const key = (latex, insert) => ({ latex, insert, class: 'small' });
const inverse = name => ({ label: `<span style="white-space:nowrap;font-size:72%">${name}<sup>−1</sup></span>`, insert: `\\${name}^{-1}(#0)`, class: 'small' });
export const FUNCTION_KEYBOARD = {
  label: 'f(x)',
  tooltip: 'Functions',
  id: 'patts-functions',
  rows: [
    [key('\\sin', '\\sin(#0)', 'Sine'), key('\\cos', '\\cos(#0)', 'Cosine'), key('\\tan', '\\tan(#0)', 'Tangent'),
      key('\\sec', '\\sec(#0)', 'Secant'), key('\\csc', '\\csc(#0)', 'Cosecant'), key('\\cot', '\\cot(#0)', 'Cotangent'),
      '[separator-5]', key('\\ln', '\\ln(#0)', 'Natural log')],
    [key('\\sinh', '\\sinh(#0)', 'Hyperbolic sine'), key('\\cosh', '\\cosh(#0)', 'Hyperbolic cosine'),
      key('\\tanh', '\\tanh(#0)', 'Hyperbolic tangent'), key('\\operatorname{sech}', '\\operatorname{sech}(#0)', 'Hyperbolic secant'),
      key('\\operatorname{csch}', '\\operatorname{csch}(#0)', 'Hyperbolic cosecant'), key('\\coth', '\\coth(#0)', 'Hyperbolic cotangent'),
      '[separator-5]', key('\\log', '\\log(#0)', 'Log')],
    // The inverses are labelled as text: three KaTeX labels this wide ran into each other.
    [inverse('sinh', 'Inverse hyperbolic sine'), inverse('cosh', 'Inverse hyperbolic cosine'),
      inverse('tanh', 'Inverse hyperbolic tangent'), key('e^{\\square}', 'e^{#?}', 'e to a power'),
      key('x^{\\square}', '^{#?}', 'Exponent'), key("y'", "'", 'Prime'), '[separator-5]', key('\\log_{\\square}', '\\log_{#?}(#0)', 'Log to a base')],
    // y and x, so y' = and f(x) = can be written without leaving the tab.
    [key('y', 'y', 'y'), key('x', 'x', 'x'), key('(', '(', 'Open bracket'), key(')', ')', 'Close bracket'),
      key('=', '=', 'Equals'), key('\\frac{\\square}{\\square}', '\\frac{#0}{#?}', 'Fraction'), '[backspace]', '[left]', '[right]'],
  ],
};

// The strip for propositional logic (MATH 115). Every insertion here is a
// spelling the item's accepted answers already carry: the database compares
// answers as strings, so a button that wrote \wedge where the key says \land
// would mark a right answer wrong. ~ is offered beside ¬ because the course
// writes negation as ~p.
export const LOGIC_PALETTE = [
  { label: '\\land', insert: '\\land ', title: 'And (conjunction)' },
  { label: '\\lor', insert: '\\lor ', title: 'Or (disjunction)' },
  { label: '\\sim', insert: '\\sim ', title: 'Not (negation), written ~' },
  { label: '\\neg', insert: '\\neg ', title: 'Not (negation), written ¬' },
  { label: '\\to', insert: '\\to ', title: 'If … then (conditional)' },
  { label: '\\leftrightarrow', insert: '\\leftrightarrow ', title: 'If and only if (biconditional)' },
  { label: '(\\,)', insert: '(#0)', title: 'Brackets' },
  { label: '[\\,]', insert: '[#0]', title: 'Square brackets' },
  // ≡ begins a line of a proof by logical equivalence (sql/073). Proofs are
  // read into trees, so it, t, c and [ ] need no matching accept list.
  { label: '\\equiv', insert: '\\equiv ', title: 'Is equivalent to (≡)' },
  { label: 'p', insert: 'p', title: 'p' },
  { label: 'q', insert: 'q', title: 'q' },
  { label: 'r', insert: 'r', title: 'r' },
  { label: 't', insert: 't', title: 'Tautology (t)' },
  { label: 'c', insert: 'c', title: 'Contradiction (c)' },
  { label: '\\mathrm{T}', insert: 'T', title: 'True' },
  { label: '\\mathrm{F}', insert: 'F', title: 'False' },
  { label: '=', insert: '=', title: 'Equals' },
];

export const PALETTES = {
  calculus: { name: 'Calculus', symbols: MATH_PALETTE },
  functions: { name: 'Functions', symbols: FUNCTION_PALETTE },
  logic: { name: 'Logic', symbols: LOGIC_PALETTE },
};

/**
 * Which strip a question should open on. All are always one tap away, so
 * this only has to be right most of the time: a question whose own wording
 * uses a connective (∧ ∨ ¬ ~ → ↔ ≡, as plain text or LaTeX) is a logic item,
 * and one whose wording or given function is hyperbolic opens on Functions.
 */
export function paletteFor(questionText, given = '') {
  const t = String(questionText || '');
  if (/[∧∨¬↔≡]|\\(land|lor|neg|lnot|wedge|vee|leftrightarrow|iff|equiv)(?![a-z])/i.test(t)) return 'logic';
  return /sinh|cosh|tanh|coth|sech|csch|hyperbolic/i.test(`${t} ${given || ''}`) ? 'functions' : 'calculus';
}

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

/**
 * Is this a single indivisible thing, so a slash beside it cannot mis-bind?
 * 2, x, x^2, \sqrt{x+1} and (w+1)^2 are; 2\sqrt{x+1} is not, because
 * a/2\sqrt{x+1} reads as (a/2)·\sqrt{x+1} and means something else.
 */
function isAtom(t) {
  const s = String(t).trim();
  // A base is ONE variable or ONE number. Not 3y — that is a product, and
  // a/3y^2 binds as (a/3)·y^2, so it has to be bracketed like any other.
  const base = '(?:[A-Za-z]|[0-9]+(?:\\.[0-9]+)?)';
  const power = '(?:\\^\\{?-?[A-Za-z0-9.]+\\}?)?';
  return new RegExp(`^${base}${power}$`).test(s)                    // x, 12, x^2, x^{-1}
    || /^\\[a-zA-Z]+\{[^{}]*\}$/.test(s)                           // \sqrt{x+1}
    || /^\([^()]*\)(\^\{?-?[A-Za-z0-9.]+\}?)?$/.test(s);          // (w+1), (w+1)^2
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
      // The DENOMINATOR is bracketed unless it is a single atom. 2\sqrt{x+1}
      // looks harmless and is not: a/2\sqrt{x+1} binds as (a/2)·\sqrt{x+1},
      // so writing it bare would generate an "accepted answer" that says
      // something different from the answer.
      const n2 = needsBrackets(num) ? `(${num})` : num;
      const d2 = isAtom(den) ? den : `(${den})`;
      out += `${n2}/${d2}`;
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

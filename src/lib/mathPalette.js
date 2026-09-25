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

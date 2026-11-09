// How the maths field reacts to a key, where MathLive's own choice surprised
// students. Two kinds of surprise, both reported by an instructor
// (2026-11-09) and reproduced with real keys in headless Chrome:
//
// 1. WHERE A KEY LANDS AFTER ^. MathLive leaves an exponent after ONE digit
//    on a letter (x^2t is x²·t), but never on a function name (sin^2x is
//    sin^(2x), cos^3(t) is cos^(3(t))). So the same habit gave two different
//    answers, and the second is never what a student means. Now:
//      * a power on a function name — sin², ln², tanh⁻¹ — ends at the next
//        letter or bracket: sin^2x is sin²x, cos^3(t) is cos³(t);
//      * on e or a number the exponent stays open after a digit, so e^2t is
//        e^(2t) and 3^2x is 3^(2x) — what students type for e^(2t), and why
//        e^4^{x} turned up in Assignment 2 (sql/097): e^4 jumped out, so they
//        pressed ^ again;
//      * on any base, a bracket opened after the exponent has something in
//        it, a bracket that closes one opened before the power, and =, all
//        end the exponent: e^{2t}(1+t), (e^{t}), y = e^{t}.
//    + and − are left alone on e and numbers: e^{2t+1} and e^{t}+1 are both
//    common, and only the student knows which they mean. After a plain
//    number on a letter (x²) they step out, as a laptop already did; the
//    maths keyboard's keys never did. → steps out, as always.
//
// 2. BACKSPACE AT THE START OF A DENOMINATOR took the fraction apart: the
//    numerator and the denominator ran together on one line (cos t/sin t
//    became cos t sin t), so deleting a power at the front of a denominator
//    went one press too far and "deleted the whole fraction". It now steps
//    back to the end of the numerator, as the left arrow does. An EMPTY
//    denominator still unwraps — that is how a stray / is undone.
//
// 3. WHAT / TAKES AS THE NUMERATOR. MathLive stops at a function name or a
//    differential d, so dy/dx came out as d·(y/dx) — the label a question
//    asks for was never there — and cos t/sin t as cos·(t/sin)·t. When the
//    run of maths just before / holds a function or a d, / now takes the
//    whole run: dy/dx, d²y/dx², (cos t)/(sin t). A run stops at +, −, =
//    and the like, so -cos t/sin t is −(cos t)/(sin t).
//    And a SPACE no longer throws the caret out of a fraction or a bracket
//    (1/sin t was (1/sin)·t, (1-cos t) closed before the t): there it does
//    nothing, which is all a space in maths does anyway. It still steps out
//    of an exponent or a subscript.
//
// 4. = INSIDE A FRACTION. After dy/dx the caret is still in the denominator,
//    so "= …" went under the fraction line with everything after it. An = at
//    the end of a numerator, denominator, root or bracket now steps out to the
//    main line first: an equals sign never belongs inside one.
//
// The rules are plain functions of a small description of the caret, so they
// are tested without a browser (src/lib/__tests__/mathTyping.test.mjs). The
// glue reads MathLive's model, which is not public API: if it is ever not
// there, every rule says "leave it to MathLive", which is how it was before.

const FUNCTION_NAMES = new Set([
  'sin', 'cos', 'tan', 'sec', 'csc', 'cot',
  'sinh', 'cosh', 'tanh', 'sech', 'csch', 'coth',
  'arcsin', 'arccos', 'arctan', 'arsinh', 'arcosh', 'artanh',
  'ln', 'log', 'exp',
]);

/**
 * What an exponent sits on: 'function' (sin, ln, sech…), 'e' (e or the
 * keyboard's ⅇ), 'number' (3^x), or 'other' (x, t, a bracket…).
 */
export function baseKind(base) {
  if (!base) return 'other';
  const cmd = String(base.command || '').replace(/^\\/, '');
  const val = String(base.value || '').trim();
  if (base.isOperator && (FUNCTION_NAMES.has(cmd) || FUNCTION_NAMES.has(val) || cmd === 'operatorname')) return 'function';
  if (val === 'e' || cmd === 'exponentialE' || val === 'ⅇ') return 'e';
  if (/^\d+$/.test(val)) return 'number';
  return 'other';
}

const bracketBalance = s => [...s].reduce((n, c) => n + (c === '(' ? 1 : c === ')' ? -1 : 0), 0);

/**
 * Before `ch` is typed with the caret at the END of an exponent whose text so
 * far is `sup`, on a base of kind `kind`:
 *   'exit'  step out of the exponent first, then type it;
 *   'stay'  type it, and keep the caret in the exponent (MathLive would leap);
 *   null    leave it to MathLive.
 */
export function exponentAction({ kind, sup, atEnd }, ch) {
  if (!atEnd || typeof ch !== 'string' || ch.length !== 1) return null;
  const s = String(sup || '').replace(/−/g, '-');
  if (s === '') {
    return (kind === 'e' || kind === 'number') && /\d/.test(ch) ? 'stay' : null;
  }
  if (ch === '=') return 'exit';
  if (ch === ')' && bracketBalance(s) <= 0) return 'exit';
  if (kind === 'function' && /^-?\d+$/.test(s) && /[a-zA-Z(\\]/.test(ch)) return 'exit';
  // x² then + : the maths keyboard's keys never leap out of an exponent, so
  // on a phone x^2+1 was x^(2+1) while a laptop gave x²+1. Now both give x²+1.
  if (kind === 'other' && /^\d+$/.test(s) && /[+-]/.test(ch)) return 'exit';
  if (ch === '(' && bracketBalance(s) === 0 && /[a-zA-Z0-9)]$/.test(s)) return 'exit';
  return null;
}

/**
 * Backspace with the caret at the very start of a denominator: 'numerator'
 * (step back to the end of the numerator) when the denominator holds
 * something, null otherwise (MathLive unwraps an empty one).
 */
export function backspaceAction({ inDenominatorStart, denominatorEmpty }) {
  return inDenominatorStart && !denominatorEmpty ? 'numerator' : null;
}

/**
 * Should / take the whole run of maths before the caret as the numerator,
 * rather than MathLive's choice? `run` is that run, left to right, as
 * [{ type, command }]. Yes when it holds a function name or a differential d.
 */
export function slashTakesRun(run) {
  if (!Array.isArray(run) || run.length < 2) return false;
  return run.some(a => a && (a.type === 'mop' || a.type === 'operator' || a.command === '\\differentialD'));
}

/**
 * Does a space typed here do nothing (true), rather than step out? It steps
 * out of an exponent or a subscript, as students expect; anywhere else —
 * a fraction, a bracket, a root — stepping out was never what was meant.
 */
export function spaceIsSwallowed({ place }) {
  return place !== 'superscript' && place !== 'subscript';
}

/** Should an = typed here step out to the main line first? */
export function equalsAction({ atRoot, atEnd }) {
  return !atRoot && atEnd ? 'exit' : null;
}

/** A short note on where the caret is, or '' on the main line. */
export function placeNote(place) {
  return {
    superscript: 'Typing the exponent — press → to step out',
    subscript: 'Typing the subscript — press → to step out',
    above: 'Typing the numerator — press ↓ for the denominator',
    below: 'Typing the denominator — press → to step out',
    root: 'Inside the root — press → to step out',
  }[place] || '';
}

// ── The glue: MathLive's model, read defensively ──────────────────────────

const textOf = atoms => (atoms || []).filter(a => a && a.type !== 'first')
  .map(a => (typeof a.value === 'string' ? a.value : '')).join('');

/** The caret's surroundings in a <math-field>, or null if they cannot be read. */
export function caretContext(field) {
  try {
    const model = field?._mathfield?.model;
    if (!model || !model.selectionIsCollapsed) return null;
    const atom = model.at(model.position);
    if (!atom) return null;
    const parent = atom.parent;
    const branch = atom.parentBranch;
    let base = null, supAtoms = null;
    if (branch === 'superscript' && parent) {
      supAtoms = parent.superscript;
      // A power on a letter or number is its own atom after the base; on an
      // operator it belongs to the operator.
      const b = parent.type === 'subsup' ? parent.leftSibling : parent;
      base = b ? { command: b.command, value: b.value,
        isOperator: b.type === 'mop' || b.type === 'operator' } : null;
    }
    const below = parent?.type === 'genfrac' ? parent.below : null;
    // The run of maths just before the caret, back to an operator, a
    // relation, a fraction or the start of its branch — what / could take.
    const run = [];
    for (let a = atom; a && a.type !== 'first'; a = a.leftSibling) {
      if (['mbin', 'mrel', 'mpunct', 'genfrac', 'mopen', 'mclose'].includes(a.type)) break;
      run.unshift(a);
    }
    return {
      atRoot: parent?.type === 'root',
      run: run.map(a => ({ type: a.type, command: a.command })),
      // Measured from the atom before the run: a differential d is a macro
      // that spans several offsets, so "one before it" lands inside it.
      runStart: run.length ? model.offsetOf(run[0].leftSibling) : model.position,
      position: model.position,
      branch,
      place: branch === 'body' && parent?.type === 'surd' ? 'root'
        : (branch === 'superscript' || branch === 'subscript' || (parent?.type === 'genfrac' && (branch === 'above' || branch === 'below'))) ? branch : '',
      kind: branch === 'superscript' ? baseKind(base) : null,
      sup: branch === 'superscript' ? textOf(supAtoms) : '',
      atEnd: !!atom.isLastSibling,
      inDenominatorStart: branch === 'below' && parent?.type === 'genfrac' && atom.type === 'first',
      denominatorEmpty: below ? textOf(below) === '' && below.filter(a => a.type !== 'first').length === 0 : true,
    };
  } catch {
    return null;
  }
}

/** Attach the rules to a field: once, when it is created. */
export function attachTypingRules(field) {
  let busy = false;
  field.addEventListener('beforeinput', e => {
    if (busy) return;
    const type = e.inputType || '';
    const ctx = caretContext(field);
    if (!ctx) return;
    if (type === 'deleteContentBackward' || e.data === 'deleteContentBackward') {
      if (backspaceAction(ctx) === 'numerator') {
        e.preventDefault();
        queueMicrotask(() => {
          busy = true;
          try { field.executeCommand('moveToPreviousChar'); } catch { /* leave the caret */ }
          busy = false;
        });
      }
      return;
    }
    if (type === 'insertText' && e.data === '=' && equalsAction(ctx) === 'exit') {
      e.preventDefault();
      queueMicrotask(() => {
        busy = true;
        try {
          for (let i = 0; i < 8; i++) {
            const c = caretContext(field);
            if (!c || c.atRoot) break;
            field.executeCommand('moveAfterParent');
          }
          field.executeCommand(['typedText', '=']);
        } catch { /* the key is lost, not the line */ }
        busy = false;
      });
      return;
    }
    if (type !== 'insertText' || ctx.branch !== 'superscript') return;
    // A bracket typed on a keyboard is handled on keydown below: by the time
    // MathLive asks here it has already started building the pair.
    const ch = e.data;
    const action = exponentAction(ctx, ch);
    if (action === 'exit') {
      e.preventDefault();
      queueMicrotask(() => {
        busy = true;
        try {
          field.executeCommand('moveAfterParent');
          field.executeCommand(['typedText', ch]);
        } catch { /* MathLive refused: the key is lost, not the line */ }
        busy = false;
      });
    } else if (action === 'stay') {
      // MathLive types the digit and then leaps out; step back in after it.
      queueMicrotask(() => {
        const after = caretContext(field);
        if (after && after.branch !== 'superscript') {
          busy = true;
          try { field.executeCommand('moveToPreviousChar'); } catch { /* stays out */ }
          busy = false;
        }
      });
    }
  });
  // / after a run holding a function or a d: dy/dx, (cos t)/(sin t).
  // A space inside a fraction: nothing.
  field.addEventListener('keydown', e => {
    if (busy || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === ' ') {
      const ctx = caretContext(field);
      if (ctx && spaceIsSwallowed(ctx)) { e.preventDefault(); e.stopImmediatePropagation(); }
      return;
    }
    if (e.key !== '/') return;
    const ctx = caretContext(field);
    if (!ctx || !slashTakesRun(ctx.run)) return;
    let numerator;
    try { numerator = field.getValue(ctx.runStart, ctx.position, 'latex'); } catch { return; }
    if (!numerator) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    busy = true;
    try {
      field._mathfield.model.setSelection(ctx.runStart, ctx.position);
      field.executeCommand('deleteBackward');
      field.executeCommand(['insert', `\\frac{${numerator}}{#?}`, { focus: true, mode: 'math', format: 'latex' }]);
    } catch { /* the key is lost, not the line */ }
    busy = false;
  }, true);
  // ( typed on a keyboard: decided before MathLive sees the key. (The maths
  // keyboard's own ( key arrives above as a plain "(".)
  field.addEventListener('keydown', e => {
    if (busy || e.key !== '(' || e.ctrlKey || e.metaKey || e.altKey) return;
    const ctx = caretContext(field);
    if (!ctx || ctx.branch !== 'superscript' || exponentAction(ctx, '(') !== 'exit') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    busy = true;
    try {
      field.executeCommand('moveAfterParent');
      field.executeCommand(['typedText', '(']);
    } catch { /* the key is lost, not the line */ }
    busy = false;
  }, true);
}

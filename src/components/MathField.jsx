import { useEffect, useLayoutEffect, useRef, useState } from 'react';
// KaTeX renders an expression TWICE — once as MathML for screen readers and
// once as styled HTML — and it is this stylesheet that hides the MathML copy.
// Without it every rendered expression appears doubled ("y = 5xy = 5x") and
// each palette button inflates to full width, which is exactly what happened
// on the exam board: LessonContent.jsx imported the CSS, but that is a
// different lazy chunk and the exam board never loads it.
import 'katex/dist/katex.min.css';
import { rememberField, FUNCTION_KEYBOARD } from '../lib/mathPalette.js';
import { displayLatex } from '../lib/mathDisplay.js';
import { canonicalPrimes } from '../lib/primeTyping.js';
import { keepInView } from '../lib/keepInView.js';

// A single line of maths, typed the way Google Docs or Symbolab let you type
// it: 1/2 opens a fraction, ^ raises an exponent, \sqrt builds a radical, and
// a palette of symbols covers what a keyboard cannot reach. MathLive does the
// editing; this component is the React wrapper around its <math-field>
// custom element and the LaTeX that comes out of it.
//
// LOADED ON DEMAND. MathLive is most of a megabyte and most papers have no
// maths item in them at all, so nothing is imported until a worked_solution
// item is actually rendered.
//
// REACT NEVER OWNS THE HOST'S CHILDREN. The <math-field> is created by hand
// and appended to a node React is told nothing about. The first version put
// the loading placeholder inside that same node and then called
// replaceChildren() on it — so React later tried to remove a span that was no
// longer there, threw, and left the student looking at the words "Type your
// answer…" with no field under them. Anything React renders is now a SIBLING
// of the host, never a child of it.
//
// WHY A REF AND NOT A VALUE PROP. <math-field> keeps its own cursor and
// selection. Writing `value` into it on every React render would drop the
// caret to the end mid-keystroke, so the element is written to only when the
// incoming value genuinely differs from what it already holds — which is
// never true for the keystroke the student just typed.

let loading = null;
let keyboardSet = false;
function loadMathlive() {
  // A rejected promise is deliberately NOT cached. Caching one meant a single
  // failed fetch of an 800KB chunk broke the maths editor for the rest of the
  // session, with every later attempt silently awaiting a promise that had
  // already given up.
  if (!loading) {
    loading = import('mathlive').catch(err => { loading = null; throw err; });
  }
  return loading;
}

/**
 * Put the caret just after the LaTeX `prefix` — the offset whose content up
 * to it serialises to exactly that. The end of the field if none does.
 */
function caretAfter(field, prefix) {
  const want = String(prefix).replace(/\s+/g, '');
  const last = field.lastOffset;
  for (let p = 0; p <= last; p++) {
    let got;
    try { got = field.getValue(0, p, 'latex'); } catch { continue; }
    if (String(got).replace(/\s+/g, '') === want) { field.position = p; return; }
  }
  field.position = last;
}

export default function MathField({
  value = '',
  onChange,
  onEnter,
  onBackspaceEmpty,
  placeholder = '',
  readOnly = false,
  focus = false,
  ariaLabel = 'Maths input',
}) {
  const hostRef = useRef(null);
  const fieldRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(null);

  // Latest callbacks, so the listeners below can be attached once and still
  // call through to the current render's handlers. Written in an effect rather
  // than in the render body: the listeners only ever read this at event time,
  // which is always after the effect has run.
  const handlers = useRef({ onChange, onEnter, onBackspaceEmpty });
  useEffect(() => {
    handlers.current = { onChange, onEnter, onBackspaceEmpty };
  }, [onChange, onEnter, onBackspaceEmpty]);

  useEffect(() => {
    let cancelled = false;
    loadMathlive().then(() => {
      if (cancelled || !hostRef.current) return;
      if (!customElements.get('math-field')) {
        throw new Error('mathlive loaded but <math-field> was never registered');
      }

      // The keyboard's own tabs, with a functions tab after the numbers:
      // set once, on the one keyboard every field on the page shares.
      if (!keyboardSet && window.mathVirtualKeyboard) {
        keyboardSet = true;
        try {
          window.mathVirtualKeyboard.layouts = ['numeric', FUNCTION_KEYBOARD, 'symbols', 'alphabetic', 'greek'];
        } catch { /* keep the default keyboard */ }
        // When the keyboard slides up, the field being typed in may now be
        // under it: brought just clear of it, and only then.
        window.mathVirtualKeyboard.addEventListener?.('geometrychange', () => {
          const active = document.activeElement;
          if (active?.tagName === 'MATH-FIELD') keepInView(active);
        });
      }

      const field = document.createElement('math-field');
      field.setAttribute('aria-label', ariaLabel);
      // The student is writing maths, not prose: no menu offering to export
      // MathML, and no autocorrect turning `sin` into text.
      try { field.menuItems = []; } catch { /* older build, no menu to hide */ }
      // 'auto', not 'manual'. MathLive raises its own keyboard when a field
      // is focused on a touch device AND knows not to dismiss it while its own
      // keys are being pressed. Driving it by hand from focusin/focusout — as
      // this did — dismissed it on the FIRST keypress, because pressing a key
      // on the virtual keyboard moves focus off the field and fired focusout.
      field.mathVirtualKeyboardPolicy = 'auto';
      field.smartMode = false;
      // MathLive scrolls the page on every keystroke, and on an iPhone that
      // made typing a fraction jolt the whole screen up and down
      // (lib/keepInView.js). The page now moves only when the field is
      // actually hidden. MathLive still scrolls the caret along inside it.
      field.onScrollIntoView = () => keepInView(field);
      field.value = canonicalPrimes(value || '').latex;
      if (readOnly) field.readOnly = true;

      // When Enter was last handled, so the line break MathLive announces for
      // that same press is not taken as a second one.
      let enterAt = -Infinity;

      field.addEventListener('input', e => {
        // The maths keyboard's return key does not press Enter: it runs
        // MathLive's commit, which announces a line break. On a phone that is
        // the only Enter there is, and it did nothing — a student could not
        // move on to the next line of a solution.
        if (e.inputType === 'insertLineBreak') {
          if (performance.now() - enterAt > 250) handlers.current.onEnter?.();
          return;
        }
        // Primes on one level, however they were typed (lib/primeTyping.js):
        // pressing prime with the caret inside a superscript stacked each new
        // prime on top of the last. Fixed as it happens, with the caret put
        // straight after the primes so typing carries on at the base.
        const fixed = canonicalPrimes(field.value);
        if (fixed.changedEnd >= 0) {
          field.value = fixed.latex;
          caretAfter(field, fixed.latex.slice(0, fixed.changedEnd));
        }
        handlers.current.onChange?.(field.value);
      });

      field.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          enterAt = performance.now();
          handlers.current.onEnter?.();
        }
      });
      // Backspace on an already-empty line removes the line itself, which
      // is how every list editor behaves. Looked at on the way IN (capture),
      // before MathLive has handled the key: Safari deletes the character
      // first, so by the time the key reached this field the line holding
      // one last character already read as empty, and that one press took
      // the character and the whole line.
      field.addEventListener('keydown', e => {
        if (e.key === 'Backspace' && field.value === '' && handlers.current.onBackspaceEmpty) {
          e.preventDefault();
          handlers.current.onBackspaceEmpty();
        }
      }, true);

      // Which field the symbol palette should insert into. Remembered on
      // focus rather than read from document.activeElement at press time,
      // because on a touch screen the field can lose focus to the button
      // before the handler runs and the symbol would go nowhere.
      field.addEventListener('focusin', () => {
        rememberField(field);
        // The maths keyboard slides up over the bottom third of a phone, and
        // a field near the fold ends up underneath it. Checked once the
        // keyboard has finished animating, and moved only if it is hidden:
        // this used to centre the field every time it took focus, and focus
        // comes back to it after every key the maths keyboard types.
        if (matchMedia('(pointer: coarse)').matches) {
          setTimeout(() => keepInView(field), 350);
        }
      });

      hostRef.current.appendChild(field);
      fieldRef.current = field;
      setReady(true);
    }).catch(err => {
      // Never leave a student staring at a box that will not arrive. The
      // reason is logged, and the plain-text fallback below lets them answer
      // regardless — a typed answer is worth more than a perfect editor.
      console.error('The maths editor could not be loaded:', err);
      if (!cancelled) setFailed(err?.message || 'unknown error');
    });
    return () => { cancelled = true; };
    // Built once. Value changes are pushed through the effect below.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const field = fieldRef.current;
    const want = canonicalPrimes(value || '').latex;
    if (field && field.value !== want) field.value = want;
  }, [value]);

  useEffect(() => {
    if (fieldRef.current) fieldRef.current.readOnly = !!readOnly;
  }, [readOnly]);

  // A line keeps its field when one above it is removed, so its name moves
  // up a number with it.
  useEffect(() => {
    fieldRef.current?.setAttribute('aria-label', ariaLabel);
  }, [ariaLabel, ready]);

  // Focus is driven by a prop rather than an autoFocus at creation time,
  // because a line added in the middle of the working does not create a new
  // field — React reuses the one already at that position.
  useEffect(() => {
    if (!focus || !ready || !fieldRef.current) return;
    // Never worth the screen: a caret that did not move is one tap to fix,
    // an error thrown here takes the whole paper down with it.
    try { fieldRef.current.focus(); } catch { /* the student taps the line */ }
  }, [focus, ready]);

  // A field holding the caret is let go of before React takes it off the
  // page. Safari removes it without telling MathLive, which still counts it
  // as the field in use; the next field to take the caret then asks that
  // removed one to let go, and MathLive throws. That was Backspace on an
  // empty line in Safari on a Mac: the line went, and with it the screen
  // ("This screen stopped working"). A layout effect, because its clean-up
  // runs before the element is removed; a plain effect's runs after.
  useLayoutEffect(() => () => {
    const field = fieldRef.current;
    if (!field) return;
    try {
      if (field.hasFocus?.() || field.matches(':focus-within')) field.blur();
    } catch { /* already gone */ }
  }, []);

  if (failed) {
    return (
      <div className="math-field-fallback">
        <input
          type="text"
          className="input"
          value={value || ''}
          onChange={e => onChange?.(e.target.value)}
          readOnly={readOnly}
          aria-label={ariaLabel}
          placeholder="Type your answer, e.g. y' = 3e^(2x)"
        />
        <p className="math-field-error">
          The maths keyboard could not load. Type your answer as plain text —
          use <code>^</code> for powers and <code>/</code> for division, with
          brackets: <code>e^(2x)</code>, <code>(x+1)/(x-1)</code>. Begin with the
          label the question asks for, such as <code>y' =</code>. It will still
          be marked.
        </p>
      </div>
    );
  }

  return (
    <div className="math-field-wrap">
      {/* React is told nothing about what goes in here. */}
      <div className="math-field-host" ref={hostRef} data-ready={ready ? 'yes' : 'no'} />
      {!ready && (
        <span className="math-field-placeholder">
          {placeholder || 'Loading the maths keyboard…'}
        </span>
      )}
    </div>
  );
}

/** Read-only rendering of stored LaTeX — for review screens and the dashboard. */
export function MathStatic({ latex, ariaLabel = 'Maths' }) {
  const ref = useRef(null);
  useEffect(() => {
    let cancelled = false;
    import('katex').then(({ default: katex }) => {
      if (cancelled || !ref.current) return;
      try {
        // displayLatex: the maths keyboard's own commands (\differentialD,
        // \placeholder…) as KaTeX can draw them, instead of their names in red.
        katex.render(displayLatex(latex), ref.current, {
          throwOnError: false, displayMode: false,
        });
      } catch {
        ref.current.textContent = String(latex || '');
      }
    }).catch(() => {
      // Better the raw LaTeX than an empty space where an expression should be.
      if (!cancelled && ref.current) ref.current.textContent = String(latex || '');
    });
    return () => { cancelled = true; };
  }, [latex]);
  return <span className="math-static" ref={ref} aria-label={ariaLabel} />;
}

import { useEffect, useRef, useState } from 'react';
// KaTeX renders an expression TWICE — once as MathML for screen readers and
// once as styled HTML — and it is this stylesheet that hides the MathML copy.
// Without it every rendered expression appears doubled ("y = 5xy = 5x") and
// each palette button inflates to full width, which is exactly what happened
// on the exam board: LessonContent.jsx imported the CSS, but that is a
// different lazy chunk and the exam board never loads it.
import 'katex/dist/katex.min.css';

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

      const field = document.createElement('math-field');
      field.setAttribute('aria-label', ariaLabel);
      // The student is writing maths, not prose: no menu offering to export
      // MathML, and no autocorrect turning `sin` into text.
      try { field.menuItems = []; } catch { /* older build, no menu to hide */ }
      field.mathVirtualKeyboardPolicy = 'manual';
      field.smartMode = false;
      field.value = value || '';
      if (readOnly) field.readOnly = true;

      field.addEventListener('input', () => {
        handlers.current.onChange?.(field.value);
      });

      field.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          handlers.current.onEnter?.();
          return;
        }
        // Backspace on an already-empty line removes the line itself, which
        // is how every list editor behaves.
        if (e.key === 'Backspace' && field.value === '') {
          e.preventDefault();
          handlers.current.onBackspaceEmpty?.();
        }
      });

      // Tapping the field on a tablet raises the maths keyboard; a physical
      // keyboard never needs it, so it is not shown on focus by default.
      field.addEventListener('focusin', () => {
        if (matchMedia('(pointer: coarse)').matches && !readOnly) {
          window.mathVirtualKeyboard?.show();
        }
      });
      field.addEventListener('focusout', () => {
        window.mathVirtualKeyboard?.hide();
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
    if (field && field.value !== (value || '')) field.value = value || '';
  }, [value]);

  useEffect(() => {
    if (fieldRef.current) fieldRef.current.readOnly = !!readOnly;
  }, [readOnly]);

  // Focus is driven by a prop rather than an autoFocus at creation time,
  // because a line added in the middle of the working does not create a new
  // field — React reuses the one already at that position.
  useEffect(() => {
    if (focus && ready && fieldRef.current) fieldRef.current.focus();
  }, [focus, ready]);

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
          placeholder="Type your answer, e.g. 5  or  x^2+C"
        />
        <p className="math-field-error">
          The maths keyboard could not load. Type your answer as plain text —
          use <code>^</code> for powers and <code>/</code> for division. It will
          still be marked.
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
        katex.render(String(latex || ''), ref.current, {
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

import { useCallback, useEffect, useMemo, useState } from 'react';
import MathField, { MathStatic } from './MathField.jsx';
import { MATH_PALETTE, insertIntoFocusedField } from '../lib/mathPalette.js';

// The student's answer to a worked_solution item: a stack of lines, each one
// meant to follow from the one above it, checked as they are written.
//
// WHAT THE STUDENT SEES. A tick beside a line that follows, a cross beside one
// that does not, and nothing beside a line the checker could not decide. The
// tick is about the STEP, not about the answer: it says "this line follows
// from the line above", which is exactly what a student can act on while
// working. It never says whether they have finished, and it never shows a
// mark — the mark is the instructor's, computed from the key they hold (see
// src/lib/workedSolution.js).
//
// That distinction is the whole design. Live feedback that revealed the
// answer would turn every maths item into a guessing game against the
// checker; live feedback on internal consistency just stops a student losing
// three marks to an arithmetic slip in line two they never noticed.
//
// CHECKING IS DEBOUNCED. Every keystroke would mean parsing and sampling
// eight points per line, which is wasted work while someone is mid-expression.
// Lines settle for a moment first.

const CHECK_DELAY_MS = 700;

// A counter, not a random id: the value only has to be unique within one
// mounted component, and a counter is reproducible when something goes wrong.
let keySeq = 0;
function nextKey() { return `ln-${++keySeq}`; }

/** Are these the same lines, in the same order? */
function sameLines(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

export default function WorkedSolution({
  question,
  value,
  onChange,
  readOnly = false,
  showPalette = true,
}) {
  const given = question?.work_given || '';
  const variable = question?.work_variable || 'x';

  const lines = useMemo(() => {
    const l = Array.isArray(value?.lines) ? value.lines : [];
    return l.length > 0 ? l : [''];
  }, [value]);

  // Results are kept WITH the lines they describe. That makes "these ticks are
  // out of date" a comparison rather than another piece of state to keep in
  // step, and it means a tick can never be shown against a line the student
  // has since edited.
  const [checked, setChecked] = useState({ forLines: null, results: [] });
  const [engineReady, setEngineReady] = useState(false);
  const [focusIndex, setFocusIndex] = useState(null);

  // Stable keys, so inserting a step in the MIDDLE of the working does not make
  // React re-use the field below it for the new blank line. Keyed by position,
  // every line after an insertion would shift by one and carry the wrong
  // caret, the wrong focus and — briefly — the wrong contents.
  const [keys, setKeys] = useState(() => lines.map(() => nextKey()));
  // Work restored from the server or another device arrives with a length these
  // keys were not built for; falling back to the position is correct there
  // precisely because nothing is being inserted.
  const keyAt = i => (keys.length === lines.length ? keys[i] : `pos-${i}`);

  const checks = useMemo(
    () => (sameLines(checked.forLines, lines) ? checked.results : []),
    [checked, lines]);
  const checking = !sameLines(checked.forLines, lines);

  // The engine is pulled in the first time a maths item is opened, not before.
  useEffect(() => {
    let cancelled = false;
    import('../lib/mathCheck.js')
      .then(m => m.ready())
      .then(() => { if (!cancelled) setEngineReady(true); })
      .catch(() => { /* checking simply stays off; the student can still write */ });
    return () => { cancelled = true; };
  }, []);

  // Re-check whenever the working settles. The given line is prepended so the
  // student's first step is checked against the problem rather than floating
  // free, which is what makes "that is not the derivative of the line above"
  // possible on line one.
  useEffect(() => {
    if (!engineReady) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      let results;
      try {
        const { checkWork } = await import('../lib/mathCheck.js');
        const all = given ? [given, ...lines] : lines;
        const out = checkWork(all, { variable });
        results = given ? out.slice(1) : out;
      } catch {
        // The engine failed to load or threw. The student keeps writing with
        // no ticks, which is strictly better than a blocked field.
        results = [];
      }
      // The lines are recorded alongside the verdicts so a result that arrives
      // after another keystroke is simply ignored as stale.
      if (!cancelled) setChecked({ forLines: lines, results });
    }, CHECK_DELAY_MS);
    return () => { cancelled = true; clearTimeout(t); };
  }, [lines, given, variable, engineReady]);

  const write = useCallback(next => {
    onChange?.({ ...(value || {}), lines: next });
  }, [onChange, value]);

  const setLine = (i, latex) => {
    const next = [...lines];
    next[i] = latex;
    write(next);
  };

  const addLineAfter = i => {
    const next = [...lines];
    next.splice(i + 1, 0, '');
    setKeys(k => {
      const n = k.length === lines.length ? [...k] : lines.map(() => nextKey());
      n.splice(i + 1, 0, nextKey());
      return n;
    });
    setFocusIndex(i + 1);
    write(next);
  };

  const removeLine = i => {
    if (lines.length === 1) {
      setKeys([nextKey()]);
      return write(['']);
    }
    const next = lines.filter((_, k) => k !== i);
    setKeys(k => (k.length === lines.length ? k.filter((_, j) => j !== i) : next.map(() => nextKey())));
    setFocusIndex(Math.max(0, i - 1));
    write(next);
  };

  // Blank lines are dropped before marking, so the count shown is the count
  // that will be read.
  const written = lines.filter(l => String(l).trim()).length;

  return (
    <div className="worked-solution">
      {given && (
        <div className="ws-given">
          <span className="ws-given-label">Given</span>
          <MathStatic latex={given} ariaLabel="The problem" />
        </div>
      )}

      <ol className="ws-lines">
        {lines.map((latex, i) => {
          const status = checks[i]?.status;
          return (
            <li key={keyAt(i)} className={`ws-line ws-${status || 'pending'}`}>
              <span className="ws-step-no">{i + 1}</span>
              <div className="ws-field">
                <MathField
                  value={latex}
                  onChange={v => setLine(i, v)}
                  onEnter={() => addLineAfter(i)}
                  onBackspaceEmpty={() => removeLine(i)}
                  readOnly={readOnly}
                  focus={focusIndex === i}
                  ariaLabel={`Step ${i + 1}`}
                  placeholder={i === 0 ? 'Write your first step…' : 'Next step…'}
                />
              </div>
              <StepMark status={status} message={checks[i]?.message} busy={checking} />
              {!readOnly && (
                <button
                  type="button"
                  className="ws-remove"
                  onClick={() => removeLine(i)}
                  aria-label={`Remove step ${i + 1}`}
                  title="Remove this step"
                >×</button>
              )}
            </li>
          );
        })}
      </ol>

      {!readOnly && (
        <div className="ws-actions">
          <button type="button" className="ws-add" onClick={() => addLineAfter(lines.length - 1)}>
            + Add step
          </button>
          <span className="ws-count">{written} line{written === 1 ? '' : 's'} of working</span>
        </div>
      )}

      {!readOnly && showPalette && (
        <div className="ws-palette" role="toolbar" aria-label="Maths symbols">
          {MATH_PALETTE.map(sym => (
            <button
              key={sym.label}
              type="button"
              className="ws-sym"
              title={sym.title}
              // The field loses focus the instant a button takes it, so the
              // press is intercepted before that happens and the caret stays
              // where the student left it.
              onMouseDown={e => { e.preventDefault(); insertIntoFocusedField(sym.insert); }}
            >
              <MathStatic latex={sym.label} ariaLabel={sym.title} />
            </button>
          ))}
        </div>
      )}

      <p className="ws-hint">
        A tick means the line follows from the one above it. It does not mean
        your answer is finished or correct — your instructor marks that.
      </p>
    </div>
  );
}

function StepMark({ status, message, busy }) {
  if (busy && !status) return <span className="ws-mark ws-mark-busy" aria-hidden="true">·</span>;
  if (status === 'ok') {
    return <span className="ws-mark ws-mark-ok" title="This step follows" aria-label="This step follows">✓</span>;
  }
  if (status === 'broken') {
    return <span className="ws-mark ws-mark-bad" title={message} aria-label={message}>✗</span>;
  }
  if (status === 'invalid') {
    return <span className="ws-mark ws-mark-bad" title={message || 'Not readable as maths'} aria-label="Not readable as maths">!</span>;
  }
  // 'unsure' and 'empty' deliberately show nothing: an engine that cannot
  // decide must not put a mark against a student's line.
  return <span className="ws-mark" aria-hidden="true" />;
}

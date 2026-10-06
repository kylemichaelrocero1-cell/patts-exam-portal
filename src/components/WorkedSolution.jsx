import { useCallback, useMemo, useState } from 'react';
import MathField, { MathStatic } from './MathField.jsx';
import { PALETTES, paletteFor, insertIntoFocusedField } from '../lib/mathPalette.js';

// The student's answer to a worked_solution item: ONE line of maths, typed the
// way Google Docs or Symbolab let you type it.
//
// This used to be a stack of lines, each checked against the one above as it
// was written. That is still what the marking engine can do, and the stored
// shape has not changed — work is `{ lines: [...] }` and always was, so a
// multi-line pad can come back without a migration. But a single answer is
// what a student actually needs first, and it buys two things worth having:
//
//   * NOTHING IS CHECKED IN THE STUDENT'S BROWSER any more, so Compute
//     Engine — 3.9MB of computer algebra — is never fetched here at all.
//     Only MathLive is, and only when a maths item is first opened. Marking
//     has always happened in the instructor's browser, so nothing is lost.
//   * There is no live tick to misread. A tick meant "this line follows from
//     the one above", which says nothing about whether the answer is right —
//     a distinction that takes a paragraph to explain and one glance to get
//     wrong under exam pressure.
//
// The item is marked all or nothing on this one line — unless it is a full
// solution (work_mode 'lines', sql/042), which takes several lines and is
// marked step by step in the database. Still nothing is checked here.

// Keys for the lines of a solution. Module-level so they are unique across
// every item on the paper and never read a ref during render.
let keyCounter = 0;
const nextKey = () => keyCounter++;

export default function WorkedSolution({
  question,
  value,
  onChange,
  readOnly = false,
  showPalette = true,
}) {
  const given = question?.work_given || '';
  const marks = Number(question?.marks) || 1;
  // Calculus or logic symbols. The question's own wording picks the one it
  // opens on; the other is always a tap away, so a guess that is wrong costs
  // the student one tap rather than an answer they cannot type.
  const [palette, setPalette] = useState(() => paletteFor(question?.question_text));
  const isLogic = palette === 'logic';

  // A full solution, marked line by line in the database (sql/042), takes
  // several lines; every other typed item takes one. The exam screen only
  // learns which from get_exam_questions().work_mode — never the rubric.
  const multi = question?.work_mode === 'lines';

  // The answer is the first line of the stored shape, so a paper answered
  // before this change still reads back correctly.
  const answer = useMemo(() => {
    const lines = Array.isArray(value?.lines) ? value.lines : [];
    return String(lines[0] ?? '');
  }, [value]);

  const write = useCallback(latex => {
    onChange?.({ ...(value || {}), lines: [latex] });
  }, [onChange, value]);

  // Several lines. Three to start with, so the shape of a worked solution is
  // visible before anything is typed; blank lines are dropped when it is
  // saved, so an unused one costs nothing.
  const rows = useMemo(() => {
    const l = Array.isArray(value?.lines) ? value.lines.map(String) : [];
    return l.length >= 3 ? l : [...l, ...Array(3 - l.length).fill('')];
  }, [value]);
  // Stable keys, so removing line 2 does not hand line 3's field line 2's
  // caret and contents for a render.
  const [keys, setKeys] = useState(() => rows.map(() => nextKey()));
  const keyAt = i => (keys.length === rows.length ? keys[i] : `pos-${i}`);
  const [focusIndex, setFocusIndex] = useState(null);
  const writeRows = next => onChange?.({ ...(value || {}), lines: next });
  const setRow = (i, latex) => { const next = [...rows]; next[i] = latex; writeRows(next); };
  const addRowAfter = i => {
    const next = [...rows]; next.splice(i + 1, 0, '');
    setKeys(k => { const n = k.length === rows.length ? [...k] : rows.map(() => nextKey());
                   n.splice(i + 1, 0, nextKey()); return n; });
    writeRows(next); setFocusIndex(i + 1);
  };
  const removeRow = i => {
    if (rows.length <= 1) { writeRows(['']); return; }
    setKeys(k => (k.length === rows.length ? k.filter((_, j) => j !== i) : rows.slice(1).map(() => nextKey())));
    writeRows(rows.filter((_, j) => j !== i)); setFocusIndex(Math.max(0, i - 1));
  };
  const written = rows.filter(l => l.trim()).length;

  return (
    <div className="worked-solution">
      {given && (
        <div className="ws-given">
          <span className="ws-given-label">Given</span>
          <MathStatic latex={given} ariaLabel="The problem" />
        </div>
      )}

      {multi ? (
        <>
          <span className="ws-answer-label">Your solution — one step on each line</span>
          <ol className="ws-lines">
            {rows.map((latex, i) => (
              <li key={keyAt(i)} className="ws-line ws-line-plain">
                <span className="ws-step-no" aria-hidden="true">{i + 1}</span>
                <div className="ws-field">
                  <MathField
                    value={latex}
                    onChange={v => setRow(i, v)}
                    onEnter={() => addRowAfter(i)}
                    onBackspaceEmpty={() => removeRow(i)}
                    readOnly={readOnly}
                    focus={focusIndex === i}
                    ariaLabel={`Line ${i + 1} of your solution`}
                    placeholder={i === 0 ? 'Start from the function…' : i === rows.length - 1 ? 'Your final answer…' : 'Next step…'}
                  />
                </div>
                {!readOnly && (
                  <button type="button" className="ws-remove" onClick={() => removeRow(i)}
                    aria-label={`Remove line ${i + 1}`} title="Remove this line">×</button>
                )}
              </li>
            ))}
          </ol>
          {!readOnly && (
            <div className="ws-actions">
              <button type="button" className="ws-add" onClick={() => addRowAfter(rows.length - 1)}>
                + Add a line
              </button>
              <span className="ws-count">{written} line{written === 1 ? '' : 's'} written</span>
            </div>
          )}
        </>
      ) : (
        <>
          <label className="ws-answer-label" htmlFor="ws-answer">
            Your answer
          </label>
          <div className="ws-answer">
            <MathField
              value={answer}
              onChange={write}
              readOnly={readOnly}
              ariaLabel="Your answer"
              placeholder="Type your answer…"
            />
          </div>
        </>
      )}

      {!readOnly && showPalette && (
        <>
          <div className="ws-palette-tabs" role="tablist" aria-label="Symbol set">
            {Object.entries(PALETTES).map(([id, p]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={palette === id}
                className={`ws-palette-tab${palette === id ? ' is-active' : ''}`}
                // Not pointerdown: switching tabs must not steal the caret,
                // and preventDefault on mousedown keeps focus in the field.
                onMouseDown={e => e.preventDefault()}
                onClick={() => setPalette(id)}
              >
                {p.name}
              </button>
            ))}
          </div>
          <div className="ws-palette" role="toolbar" aria-label={`${PALETTES[palette].name} symbols`}>
            {PALETTES[palette].symbols.map(sym => (
              <button
                key={sym.title}
                type="button"
                className="ws-sym"
                title={sym.title}
                aria-label={sym.title}
                // pointerdown, not mousedown: it covers touch and mouse with
                // ONE handler, so a phone cannot fire both and insert the symbol
                // twice. preventDefault stops the button taking focus, which is
                // what keeps the caret where the student left it.
                onPointerDown={e => { e.preventDefault(); insertIntoFocusedField(sym.insert); }}
              >
                <MathStatic latex={sym.label} ariaLabel={sym.title} />
              </button>
            ))}
          </div>
        </>
      )}

      {multi ? (
        <>
          <p className="ws-hint">
            Write the solution <strong>one step on each line</strong>, the way you would on paper:
            start from the function, then the derivative as the rule first gives it, then the
            simplified answer. Just write the maths — don't type "Step 1". Your <strong>last line is
            your final answer</strong>.
          </p>
          <p className="ws-hint">
            This question is worth <strong>{marks} point{marks === 1 ? '' : 's'}</strong>. Each step
            earns points, and full marks need the simplified final answer <em>with</em> the working
            that leads to it. Begin each derivative line with its notation, e.g. <code>y' =</code>.
          </p>
        </>
      ) : isLogic ? (
        <p className="ws-hint">
          This question is worth <strong>{marks} point{marks === 1 ? '' : 's'}</strong>.
          Use the buttons for <strong>∧ ∨ ~ → ↔</strong>, and capital <code>T</code> and{' '}
          <code>F</code> for true and false. From a keyboard you can also type{' '}
          <code>and</code>, <code>or</code> and <code>not</code>.
        </p>
      ) : (
        <>
          <p className="ws-hint">
            Give the simplified answer. This question is worth{' '}
            <strong>{marks} point{marks === 1 ? '' : 's'}</strong>, added to your final
            score in full for a correct answer. Type <code>/</code> for a fraction,
            <code>^</code> for a power, and <code>'</code> for a prime.
          </p>
          {/* sql/032 marks the label as part of the answer, so say so before
              anyone is marked down for it. The examples are first derivatives on
              purpose: which notation a higher derivative takes is what is being
              tested, and the hint must not answer it. */}
          <p className="ws-hint">
            <strong>Write the notation, not just the value.</strong> When the question asks
            for a derivative, begin with it — for example <code>f'(x) =</code> or{' '}
            <code>dy/dx =</code>. A missing label, or the wrong one, is marked wrong.
          </p>
        </>
      )}
    </div>
  );
}

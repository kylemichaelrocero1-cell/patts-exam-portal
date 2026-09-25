import { useCallback, useMemo } from 'react';
import MathField, { MathStatic } from './MathField.jsx';
import { MATH_PALETTE, insertIntoFocusedField } from '../lib/mathPalette.js';

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
// The item is marked all or nothing on this one line.

export default function WorkedSolution({
  question,
  value,
  onChange,
  readOnly = false,
  showPalette = true,
}) {
  const given = question?.work_given || '';
  const marks = Number(question?.marks) || 1;

  // The answer is the first line of the stored shape, so a paper answered
  // before this change still reads back correctly.
  const answer = useMemo(() => {
    const lines = Array.isArray(value?.lines) ? value.lines : [];
    return String(lines[0] ?? '');
  }, [value]);

  const write = useCallback(latex => {
    onChange?.({ ...(value || {}), lines: [latex] });
  }, [onChange, value]);

  return (
    <div className="worked-solution">
      {given && (
        <div className="ws-given">
          <span className="ws-given-label">Given</span>
          <MathStatic latex={given} ariaLabel="The problem" />
        </div>
      )}

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

      {!readOnly && showPalette && (
        <div className="ws-palette" role="toolbar" aria-label="Maths symbols">
          {MATH_PALETTE.map(sym => (
            <button
              key={sym.label}
              type="button"
              className="ws-sym"
              title={sym.title}
              aria-label={sym.title}
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
        Give the simplified answer. This question is worth {marks} mark{marks === 1 ? '' : 's'},
        awarded in full for the right answer. Type <code>/</code> for a fraction,
        <code>^</code> for a power, and <code>'</code> for a prime.
      </p>
    </div>
  );
}

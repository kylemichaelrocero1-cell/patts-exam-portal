import { useCallback, useMemo, useState } from 'react';
import MathField, { MathStatic } from './MathField.jsx';
import { PALETTES, paletteFor, insertIntoFocusedField } from '../lib/mathPalette.js';
import { LOGIC_LAWS, isLogicMode, joinLine, splitLine } from '../lib/logicProof.js';
import { quantityParts, partLine, splitPartLine } from '../lib/quantityAnswer.js';

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
// marked step by step in the database, or a proof by logical equivalence
// (work_mode 'proof', sql/073), whose every line also carries the law that
// gives it, picked from a list. A 'simplify' item is one such line. Still
// nothing is checked here.

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
  // Calculus, function or logic symbols. The question's own wording picks the
  // one it opens on; the others are always a tap away, so a guess that is
  // wrong costs the student one tap rather than an answer they cannot type.
  const mode = question?.work_mode;
  const [palette, setPalette] = useState(() => (isLogicMode(mode) ? 'logic' : paletteFor(question?.question_text, question?.work_given)));
  const isLogic = palette === 'logic';
  // A hyperbolic item: the hint says where the keyboard keeps sinh and the rest.
  const hyperbolic = paletteFor(question?.question_text, question?.work_given) === 'functions';

  // A full solution, marked line by line in the database (sql/042), takes
  // several lines; every other typed item takes one. The exam screen only
  // learns which from get_exam_questions().work_mode — never the rubric.
  const multi = mode === 'lines' || mode === 'proof';
  // A statement and its law on every line (sql/073): a proof takes several
  // lines, a simplification one.
  const proof = mode === 'proof';
  const simplify = mode === 'simplify';
  const withLaw = proof || simplify;
  // A word, not maths (sql/046): a plain text box, no maths keyboard and no
  // symbol strip. The keyboard turns "and" into ∧ as it is typed.
  const text = mode === 'text';
  // A problem answered as quantities (sql/105): a box per part, each a
  // number and its unit, typed as words — so no maths keyboard here either.
  const quantity = mode === 'quantity';

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
  // Which line to put the caret in. A counter rides along so that asking for
  // the same line twice still moves the caret (MathField refocuses when its
  // `focus` prop changes, and a plain index would not change).
  const [focusReq, setFocusReq] = useState({ i: null, n: 0 });
  const focusLine = i => setFocusReq(f => ({ i, n: f.n + 1 }));
  const writeRows = next => onChange?.({ ...(value || {}), lines: next });
  const setRow = (i, latex) => { const next = [...rows]; next[i] = latex; writeRows(next); };
  const addRowAfter = i => {
    const next = [...rows]; next.splice(i + 1, 0, '');
    setKeys(k => { const n = k.length === rows.length ? [...k] : rows.map(() => nextKey());
                   n.splice(i + 1, 0, nextKey()); return n; });
    writeRows(next); focusLine(i + 1);
  };
  // Enter: on to the next line — a new one only when the next is not empty.
  // The three blank lines a solution starts with are there to be filled, not
  // pushed down by a new blank line each time.
  const nextLine = i => {
    if (i + 1 < rows.length && !rows[i + 1].trim()) focusLine(i + 1);
    else addRowAfter(i);
  };
  const removeRow = i => {
    if (rows.length <= 1) { writeRows(['']); return; }
    // A key for every line there will be: three at least, so the blank line
    // padded back in gets a key of its own. Short by one, every line fell
    // back to a key by position and was rebuilt, caret and all.
    setKeys(k => {
      const kept = k.length === rows.length ? k.filter((_, j) => j !== i) : rows.slice(1).map(() => nextKey());
      while (kept.length < Math.max(3, rows.length - 1)) kept.push(nextKey());
      return kept;
    });
    writeRows(rows.filter((_, j) => j !== i)); focusLine(Math.max(0, i - 1));
  };
  const written = rows.filter(l => (withLaw ? splitLine(l).statement : l).trim()).length;

  // A line of a proof is stored as one string, the statement with its laws
  // after it (joinLine), so the field edits one half and the list the other.
  const setStatement = (i, latex) => setRow(i, joinLine(latex, splitLine(rows[i]).laws));
  const setLaw = (i, k, name) => {
    const laws = [...splitLine(rows[i]).laws];
    laws[k] = name;
    // Clearing the first law clears the second with it.
    const kept = laws[0] ? laws.filter(Boolean).slice(0, 2) : [];
    setRow(i, joinLine(splitLine(rows[i]).statement, kept));
  };
  // Lines whose second law list has been asked for. Most steps use one law,
  // so the second list stays a link until it is wanted.
  const [secondOpen, setSecondOpen] = useState(() => new Set());
  const lawPicker = (i, first) => {
    const laws = splitLine(rows[i]).laws;
    const rowKey = keyAt(i);
    const showSecond = !!laws[1] || secondOpen.has(rowKey);
    const options = LOGIC_LAWS.filter(l => first || l.key !== 'given');
    const label = l => (l.also ? `${l.name} (${l.also})` : l.name);
    return (
      <div className="ws-law">
        <select
          className="ws-law-select"
          value={laws[0] || ''}
          onChange={e => setLaw(i, 0, e.target.value)}
          disabled={readOnly}
          aria-label={`Law for line ${i + 1}`}
        >
          <option value="">Law…</option>
          {options.map(l => <option key={l.key} value={l.name}>{label(l)}</option>)}
        </select>
        {laws[0] && laws[0] !== 'Given' && !showSecond && !readOnly && (
          <button type="button" className="ws-law-more"
            onClick={() => setSecondOpen(o => new Set(o).add(rowKey))}>
            + second law
          </button>
        )}
        {laws[0] && laws[0] !== 'Given' && showSecond && (
          <select
            className="ws-law-select ws-law-second"
            value={laws[1] || ''}
            onChange={e => setLaw(i, 1, e.target.value)}
            disabled={readOnly}
            aria-label={`Second law for line ${i + 1}, if the step uses two`}
          >
            <option value="">No second law</option>
            {options.filter(l => l.key !== 'given' && l.name !== laws[0])
              .map(l => <option key={l.key} value={l.name}>{label(l)}</option>)}
          </select>
        )}
      </div>
    );
  };

  if (quantity) {
    const parts = quantityParts(given);
    const typed = {};
    for (const l of Array.isArray(value?.lines) ? value.lines : []) {
      const p = splitPartLine(l);
      if (p) typed[p.key] = p.text;
    }
    // Only the parts with something in them are stored, each with its
    // letter, so an emptied box leaves the item unanswered.
    const setPart = (key, t) => onChange?.({
      ...(value || {}),
      lines: parts.map(p => [p.key, p.key === key ? t : (typed[p.key] ?? '')])
        .filter(([, v]) => /\S/.test(v)).map(([k, v]) => partLine(k, v)),
    });
    return (
      <div className="worked-solution ws-qty">
        <p className="ws-hint" style={{ marginTop: 0 }}>
          Worth <strong>{marks} point{marks === 1 ? '' : 's'}</strong>. Type each answer as the number
          and its unit together, e.g. <em>2.67 m/s</em>, and round as the part says. Part of each
          answer's marks is for the value and part for the unit.
        </p>
        <p className="ws-count" style={{ margin: '6px 0 0' }}>
          {parts.filter(p => /\S/.test(typed[p.key] ?? '')).length} of {parts.length} parts answered
        </p>
        <ol className="ws-qty-parts">
          {parts.map((p, i) => (
            <li key={p.key} className="ws-qty-part">
              <label className="ws-qty-label" htmlFor={`ws-qty-${question?.id}-${p.key}`}>
                <span className="ws-qty-key">{p.key})</span> {p.label}
              </label>
              <input
                id={`ws-qty-${question?.id}-${p.key}`}
                className="input ws-text-answer"
                value={typed[p.key] ?? ''}
                onChange={e => setPart(p.key, e.target.value)}
                readOnly={readOnly}
                placeholder="Number and unit…"
                maxLength={80}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                enterKeyHint={i === parts.length - 1 ? 'done' : 'next'}
                onKeyDown={e => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  const boxes = e.currentTarget.closest('.ws-qty')?.querySelectorAll('input');
                  const next = boxes?.[i + 1];
                  if (next) next.focus(); else e.currentTarget.blur();
                }}
              />
            </li>
          ))}
        </ol>
      </div>
    );
  }

  if (text) {
    return (
      <div className="worked-solution">
        <label className="ws-answer-label" htmlFor={`ws-text-${question?.id}`}>
          Your answer
        </label>
        <input
          id={`ws-text-${question?.id}`}
          className="input ws-text-answer"
          type="text"
          value={answer}
          onChange={e => write(e.target.value)}
          readOnly={readOnly}
          placeholder="Type your answer…"
          maxLength={200}
          // A phone must not "correct" flaperon into something else,
          // nor capitalise it — capitals do not matter, but a changed word does.
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="done"
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
        />
        <p className="ws-hint">
          This question is worth <strong>{marks} point{marks === 1 ? '' : 's'}</strong>. Type the
          word or letter the question asks for. Capital letters and spaces do not matter.
        </p>
      </div>
    );
  }

  return (
    <div className="worked-solution">
      {given && (
        <div className="ws-given">
          <span className="ws-given-label">{proof ? 'Prove' : simplify ? 'Simplify' : 'Given'}</span>
          <MathStatic latex={given} ariaLabel="The problem" />
        </div>
      )}

      {multi ? (
        <>
          <span className="ws-answer-label">
            {proof ? 'Your proof — one statement and its law on each line' : 'Your solution — one step on each line'}
          </span>
          <ol className="ws-lines">
            {rows.map((latex, i) => (
              <li key={keyAt(i)} className="ws-line ws-line-plain">
                <span className="ws-step-no" aria-hidden="true">{i + 1}</span>
                <div className="ws-field">
                  <MathField
                    value={proof ? splitLine(latex).statement : latex}
                    onChange={v => (proof ? setStatement(i, v) : setRow(i, v))}
                    onEnter={() => nextLine(i)}
                    onBackspaceEmpty={() => removeRow(i)}
                    readOnly={readOnly}
                    focus={focusReq.i === i ? focusReq.n : 0}
                    ariaLabel={`Line ${i + 1} of your ${proof ? 'proof' : 'solution'}`}
                    placeholder={proof
                      ? (i === 0 ? 'Start from the left-hand side…' : i === rows.length - 1 ? '≡ the right-hand side…' : '≡ next statement…')
                      : (i === 0 ? 'Start from the function…' : i === rows.length - 1 ? 'Your final answer…' : 'Next step…')}
                  />
                  {proof && lawPicker(i, i === 0)}
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
              value={simplify ? splitLine(answer).statement : answer}
              onChange={v => (simplify ? write(joinLine(v, splitLine(answer).laws)) : write(v))}
              readOnly={readOnly}
              ariaLabel={simplify ? 'Your simplified result' : 'Your answer'}
              placeholder={simplify ? 'The simplified result…' : 'Type your answer…'}
            />
            {simplify && lawPicker(0, false)}
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
                className={`ws-sym${sym.wide ? ' ws-sym-wide' : ''}`}
                title={sym.title}
                aria-label={sym.title}
                // Inserted on click, which a phone fires once for a tap and
                // not at all for a swipe: on pointerdown, a thumb that landed
                // on the strip to scroll the page typed that symbol into the
                // last line used, out of sight. preventDefault on pointerdown
                // stops the button taking focus, which keeps the caret where
                // the student left it.
                onPointerDown={e => e.preventDefault()}
                onClick={() => insertIntoFocusedField(sym.insert)}
              >
                <MathStatic latex={sym.label} ariaLabel={sym.title} />
              </button>
            ))}
          </div>
        </>
      )}

      {proof ? (
        <>
          <p className="ws-hint">
            Write the proof <strong>one statement on each line</strong>, starting from the left-hand
            side, and <strong>pick the law</strong> that gives each line from the line above it. You
            may begin a line with <strong>≡</strong>. A step that uses two laws needs both picked.
            Your last line must be the statement you are proving it equivalent to.
          </p>
          <p className="ws-hint">
            This question is worth <strong>{marks} point{marks === 1 ? '' : 's'}</strong>. Any correct
            route counts. A missing or wrong law costs 1 point, and a line that does not follow from
            the one above it ends the work that counts. Use <code>t</code> for a tautology and{' '}
            <code>c</code> for a contradiction.
          </p>
        </>
      ) : simplify ? (
        <p className="ws-hint">
          Write the simplified result and pick the law used. This question is worth{' '}
          <strong>{marks} point{marks === 1 ? '' : 's'}</strong>{marks === 2 ? ': one for the result and one for the law' : ''}.
          Use <code>t</code> for a tautology and <code>c</code> for a contradiction.
        </p>
      ) : multi ? (
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
      ) : mode === 'logic' ? (
        <p className="ws-hint">
          This question is worth <strong>{marks} point{marks === 1 ? '' : 's'}</strong>.
          Use the buttons for <strong>∧ ∨ ~ → ↔</strong> and brackets. From a keyboard you can
          also type <code>and</code>, <code>or</code> and <code>not</code>.
        </p>
      ) : isLogic ? (
        <p className="ws-hint">
          This question is worth <strong>{marks} point{marks === 1 ? '' : 's'}</strong>.
          Use the buttons for <strong>∧ ∨ ~ → ↔</strong>, and capital <code>T</code> and{' '}
          <code>F</code> for true and false. From a keyboard you can also type{' '}
          <code>and</code>, <code>or</code> and <code>not</code>.
        </p>
      ) : null}
      {/* A single-answer item says nothing more here: the question itself says
          what to type and where to begin, and its points sit beside the item
          number, so a repeat of either below the keyboard only got in the way
          (and could contradict a question that allows an unsimplified answer). */}

      {hyperbolic && multi && !readOnly && (
        <p className="ws-hint">
          On a phone or tablet, <strong>sinh, cosh, tanh, sech, csch and coth</strong> are on the{' '}
          <strong>f(x)</strong> tab of the maths keyboard, as well as in the Functions buttons.
        </p>
      )}
    </div>
  );
}

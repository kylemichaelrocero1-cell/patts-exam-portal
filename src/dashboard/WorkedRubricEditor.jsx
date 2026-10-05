import { useEffect, useMemo, useState } from 'react';
import MathField, { MathStatic } from '../components/MathField.jsx';
import { MATH_PALETTE, LOGIC_PALETTE, insertIntoFocusedField, suggestVariants } from '../lib/mathPalette.js';

// Authoring a maths question: the problem, the answer, and the other ways you
// will accept that answer.
//
// This used to carry a whole rubric — a table of steps, marks against each,
// partial credit for getting halfway. None of that is read any more. Marking
// moved into the database (sql/027), where an item is all or nothing on its
// final answer, so a step table was an elaborate way to collect one number
// and one expression. The stored shape still has a `steps` array with a
// single entry in it, which is what the marker reads, so nothing needed a
// migration and multi-step rubrics could come back.
//
// WHAT THE ACCEPT LIST IS FOR. The database matches answers as STRINGS after
// normalising them, because it has no algebra. Normalisation covers the
// cosmetic differences — spacing, \left, \cdot, braces, a y'= on the front,
// and numbers compared as numbers. It cannot cover anything needing real
// algebra: x^{-1} and \frac{1}{x} are the same number and different strings.
// The suggestions come from the maths engine, which does understand algebra,
// so that work happens once here rather than on every paper marked.

export default function WorkedRubricEditor({ value, onChange, marks: marksProp }) {
  const marks = Number(marksProp) || Number(value?.marks) || 1;
  const steps = Array.isArray(value?.steps) && value.steps.length
    ? value.steps : [{ latex: '', marks, label: 'Final answer' }];
  const answer = steps[steps.length - 1].latex || '';
  // Memoised because it is a dependency of the suggestion list below, and a
  // fresh [] on every render would recompute the suggestions on every render.
  const accept = useMemo(
    () => (Array.isArray(value?.accept) ? value.accept : []),
    [value?.accept]);

  const set = patch => onChange?.({ ...(value || {}), ...patch });
  const setAnswer = latex => set({ steps: [{ latex, marks, label: 'Final answer' }] });

  const suggestions = useMemo(
    () => suggestVariants(answer).filter(v => !accept.includes(v)),
    [answer, accept]);

  return (
    <div className="wr">
      <div className="wr-row">
        <label className="wr-field">
          <span className="wr-label">The problem, as the student sees it</span>
          <MathField value={value?.given || ''} onChange={v => set({ given: v })}
                     ariaLabel="The problem" />
        </label>
        <label className="wr-field wr-narrow">
          <span className="wr-label">With respect to</span>
          <input className="input" value={value?.variable || 'x'}
                 onChange={e => set({ variable: e.target.value.trim().slice(0, 3) })}
                 placeholder="x" />
        </label>
      </div>

      <label className="wr-field">
        <span className="wr-label">The answer &mdash; worth all {marks} point{marks === 1 ? '' : 's'}</span>
        <MathField value={answer} onChange={setAnswer} ariaLabel="The answer" />
      </label>

      <div className="wr-palette" role="toolbar" aria-label="Maths symbols">
        {/* Both sets: the instructor writes calculus keys and logic keys
            from the same editor. Keyed by title — 'p' and '=' could clash. */}
        {[...MATH_PALETTE, ...LOGIC_PALETTE].map(sym => (
          <button key={sym.title} type="button" className="wr-sym" title={sym.title}
                  aria-label={sym.title}
                  onPointerDown={e => { e.preventDefault(); insertIntoFocusedField(sym.insert); }}>
            <MathStatic latex={sym.label} ariaLabel={sym.title} />
          </button>
        ))}
      </div>

      <AcceptedAnswers answer={answer} accept={accept} suggestions={suggestions}
                       onChange={a => set({ accept: a })} />
    </div>
  );
}

/**
 * The other spellings this item will take, and a check that each really is
 * the same answer.
 *
 * The check matters more than it looks: an accepted form that is NOT
 * equivalent hands out full marks for a wrong answer, silently, to everyone
 * who writes it. The engine is asked about each one, and anything it can
 * settle as different is called out.
 */
function AcceptedAnswers({ answer, accept, suggestions, onChange }) {
  const [verdicts, setVerdicts] = useState({});
  // A form the suggestions will never think of — 3y^2y' where the answer says
  // 3y^2 dy/dx is one: the engine does not know y' and dy/dx are the same.
  const [draft, setDraft] = useState('');
  const addDraft = () => {
    const v = draft.trim();
    if (v && v !== answer.trim() && !accept.includes(v)) onChange([...accept, v]);
    setDraft('');
  };

  useEffect(() => {
    let cancelled = false;
    if (!answer || accept.length === 0) { return undefined; }
    const t = setTimeout(async () => {
      try {
        const { ready } = await import('../lib/mathCheck.js');
        await ready();
        const { acceptedFormVerdict } = await import('../lib/workedSolution.js');
        const out = {};
        for (const v of accept) {
          try { out[v] = acceptedFormVerdict(v, answer); } catch { out[v] = 'unknown'; }
        }
        if (!cancelled) setVerdicts(out);
      } catch { /* the engine is optional here; the list still works */ }
    }, 500);
    return () => { cancelled = true; clearTimeout(t); };
  }, [answer, accept]);

  const wrong = accept.filter(v => verdicts[v] === 'different');

  return (
    <div className="wr-accept">
      <div className="wr-label">Also accept</div>
      <p className="wr-note">
        Spacing, <code>\left</code>, <code>\cdot</code>, braces, a <code>y&apos;=</code> on
        the front, and numbers like <code>0.5</code> against <code>\frac{'{1}{2}'}</code> are
        matched already. Add only what needs real algebra &mdash; <code>x^{'{-1}'}</code> where
        the answer says <code>1/x</code> &mdash; or another notation, like <code>y&apos;</code> where
        it says <code>dy/dx</code>. Type it below and press Enter.
      </p>

      {accept.length > 0 && (
        <div className="wr-chips">
          {accept.map((v, i) => (
            <span key={i} className={`wr-chip ${verdicts[v] === 'different' ? 'bad' : ''}`}>
              <MathStatic latex={v} />
              <button type="button" title="Stop accepting this"
                      onClick={() => onChange(accept.filter((_, k) => k !== i))}>&times;</button>
            </span>
          ))}
        </div>
      )}

      <div className="wr-accept-add">
        <MathField value={draft} onChange={setDraft} onEnter={addDraft}
                   ariaLabel="Another answer to accept" />
        <button type="button" className="btn ghost sm" style={{ width: 'auto' }}
                onClick={addDraft} disabled={!draft.trim()}>
          + Accept this too
        </button>
      </div>

      {suggestions.length > 0 && (
        <div className="wr-chips">
          <span className="wr-note" style={{ margin: 0 }}>Suggestions:</span>
          {suggestions.map(v => (
            <button key={v} type="button" className="wr-chip add"
                    onClick={() => onChange([...accept, v])}>
              + <MathStatic latex={v} />
            </button>
          ))}
        </div>
      )}

      {wrong.length > 0 && (
        <p className="wr-warn">
          <strong>{wrong.length} accepted answer{wrong.length === 1 ? ' does' : 's do'} not
          match the answer.</strong> Anything left here is marked correct, so a
          student writing it would get all the points. Remove it unless you mean it.
        </p>
      )}
      {!answer && <p className="wr-warn">This question has no answer yet, so nothing can be marked.</p>}
    </div>
  );
}

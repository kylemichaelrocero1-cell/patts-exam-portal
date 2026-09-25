import { useEffect, useMemo, useState } from 'react';
import MathField, { MathStatic } from '../components/MathField.jsx';
import { MATH_PALETTE, insertIntoFocusedField, suggestVariants } from '../lib/mathPalette.js';

// Authoring a worked item: the problem, the variable, what the item is worth,
// and the instructor's own working with marks against each line.
//
// The instructor writes the solution the same way a student will — in a maths
// field, not as a string of LaTeX — because a rubric typed in a different
// notation from the one the checker reads is a rubric that silently fails to
// match anybody's work.
//
// THE LAST LINE IS THE ANSWER, and it is marked differently from the ones
// above it: a student's line has to be equivalent to it AND written out, not
// merely equal. That is why 5(1)x^{1-1} earns the power-rule mark but not the
// mark for finishing. It is stated on screen because an instructor who does
// not know it will write a rubric that behaves surprisingly.

// `marks` comes from the parent, not from here. Every question type can carry
// points now (sql/025), so the field that sets them belongs beside the question
// type where it applies to all of them — two inputs for the same number would
// eventually disagree.
export default function WorkedRubricEditor({ value, onChange, marks: marksProp }) {
  const marks = Number(marksProp) || Number(value?.marks) || 3;
  const steps = Array.isArray(value?.steps) && value.steps.length
    ? value.steps
    : [{ latex: '', marks: 1, label: '' }];

  const set = patch => onChange?.({ ...(value || {}), ...patch });
  const setStep = (i, patch) => {
    const next = steps.map((s, k) => (k === i ? { ...s, ...patch } : s));
    set({ steps: next });
  };

  const allocated = steps.reduce((t, s) => t + (Number(s.marks) || 0), 0);

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10, marginBottom: 14 }}>
        <label style={{ display: 'block' }}>
          <span style={LABEL}>The problem, as the student sees it</span>
          <MathField
            value={value?.given || ''}
            onChange={v => set({ given: v })}
            ariaLabel="The problem"
          />
        </label>
        <label style={{ display: 'block' }}>
          <span style={LABEL}>With respect to</span>
          <input
            className="input"
            value={value?.variable || 'x'}
            onChange={e => set({ variable: e.target.value.trim().slice(0, 3) })}
            placeholder="x"
          />
        </label>
      </div>

      <div style={{ ...NOTE, marginBottom: 12 }}>
        Write your own working below, one line per step. A student earns a
        step&rsquo;s marks by writing <strong>anything equivalent to it</strong> —
        5&middot;1&middot;x<sup>0</sup> counts as 5(1)x<sup>1&minus;1</sup>. The
        <strong> last line is the answer</strong>, and it must be written out to
        earn its marks, so working that stops half-simplified gets partial
        credit rather than full. A student who reaches your final line with
        every step sound gets the full {marks} mark{marks === 1 ? '' : 's'},
        even by a shorter route than yours.
      </div>

      <div className="ws-rubric-head">
        <span>Step</span><span>Marks</span><span>Label (optional)</span><span />
      </div>

      {steps.map((step, i) => (
        <div className="ws-rubric-step" key={i}>
          <MathField
            value={step.latex || ''}
            onChange={v => setStep(i, { latex: v })}
            ariaLabel={`Expected step ${i + 1}`}
          />
          <input
            className="input"
            type="number" min={0} max={100} step="0.5"
            value={step.marks ?? ''}
            onChange={e => setStep(i, { marks: e.target.value === '' ? '' : Number(e.target.value) })}
          />
          <input
            className="input"
            value={step.label || ''}
            onChange={e => setStep(i, { label: e.target.value })}
            placeholder={i === steps.length - 1 ? 'Final answer' : 'e.g. Power rule applied'}
          />
          <button
            type="button" className="btn ghost sm"
            style={{ width: 'auto' }}
            disabled={steps.length <= 1}
            title={steps.length <= 1 ? 'A worked item needs at least one step' : 'Remove this step'}
            onClick={() => set({ steps: steps.filter((_, k) => k !== i) })}
          >×</button>
        </div>
      ))}

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginTop: 10 }}>
        <button
          type="button" className="btn ghost sm" style={{ width: 'auto' }}
          onClick={() => set({ steps: [...steps, { latex: '', marks: 1, label: '' }] })}
        >+ Add step</button>
        <span style={{ fontSize: 12, color: allocated === marks ? 'var(--ink-4)' : 'var(--warn)' }}>
          {allocated} of {marks} mark{marks === 1 ? '' : 's'} allocated across steps
          {allocated !== marks && ' — partial credit uses these numbers, so they should add up'}
        </span>
      </div>

      <div className="ws-palette" style={{ marginLeft: 0 }}>
        {MATH_PALETTE.map(sym => (
          <button
            key={sym.label} type="button" className="ws-sym" title={sym.title}
            onPointerDown={e => { e.preventDefault(); insertIntoFocusedField(sym.insert); }}
          >{sym.title}</button>
        ))}
      </div>

      <AcceptedAnswers
        answer={steps.length ? steps[steps.length - 1].latex : ''}
        accept={Array.isArray(value?.accept) ? value.accept : []}
        onChange={accept => set({ accept })}
      />

      <RubricSelfCheck rubric={{ ...value, marks, steps }} />
    </div>
  );
}

/**
 * Runs the instructor's own rubric through the marker before the item is saved.
 *
 * Worth the screen space it takes: a rubric whose own working does not score
 * full marks is broken, and the only alternative to catching it here is a
 * student finding it mid-exam. The usual cause is a step that does not follow
 * from the one above — a sign error, or a line typed out of order.
 */
function RubricSelfCheck({ rubric }) {
  const [result, setResult] = useState(null);
  const steps = (rubric?.steps || []).map(s => String(s?.latex || '').trim());
  const key = JSON.stringify([rubric?.given, rubric?.variable, rubric?.marks, steps]);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      // An empty rubric has nothing to check; clearing here rather than in the
      // effect body keeps every write to `result` inside the timer.
      if (steps.filter(Boolean).length === 0) { if (!cancelled) setResult(null); return; }
      try {
        const { ready } = await import('../lib/mathCheck.js');
        await ready();
        const { markWork } = await import('../lib/workedSolution.js');
        const lines = rubric.given ? [rubric.given, ...steps] : steps;
        const out = markWork(lines.filter(Boolean), rubric);
        if (!cancelled) setResult(out);
      } catch {
        if (!cancelled) setResult(null);
      }
    }, 600);
    return () => { cancelled = true; clearTimeout(t); };
    // `key` is the whole rubric, flattened, so this re-runs on any edit to it.
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!result) return null;
  const perfect = result.marks === result.total;
  const bad = (result.steps || []).filter(s => s.status === 'broken' || s.status === 'invalid');

  return (
    <div style={{
      marginTop: 14, padding: '11px 14px', fontSize: 13, lineHeight: 1.5,
      borderRadius: 'var(--r-sm)',
      background: perfect ? 'var(--ok-bg)' : 'var(--warn-bg)',
      border: `1px solid ${perfect ? 'var(--ok-bd)' : 'var(--warn-bd)'}`,
      color: perfect ? 'var(--ok)' : 'var(--warn)',
    }}>
      {perfect ? (
        <>Checked: your own working scores {result.marks} of {result.total}. The rubric is sound.</>
      ) : (
        <>
          <strong>Your own working only scores {result.marks} of {result.total}.</strong>{' '}
          {bad.length > 0
            ? `Step ${(result.steps || []).findIndex(s => s.status === 'broken' || s.status === 'invalid') + 1} does not follow from the line above it — check for a sign or a typo.`
            : 'Check that the marks on the steps add up, and that your last line is the finished answer.'}
        </>
      )}
    </div>
  );
}

const LABEL = {
  display: 'block', marginBottom: 5,
  fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase',
  color: 'var(--ink-4)',
};
const NOTE = {
  padding: '11px 14px', fontSize: 12.5, lineHeight: 1.6,
  background: 'var(--info-bg)', border: '1px solid var(--info-bd)',
  borderRadius: 'var(--r-sm)', color: 'var(--ink-2)',
};

/**
 * The other ways this answer may be written.
 *
 * Marking happens in the database (sql/027), and the database has no algebra —
 * it matches what a student wrote against a list. Normalisation already covers
 * spelling: spaces, \left, \cdot, braces, a subject on the left, and numbers
 * compared as numbers. This list is for everything that needs actual algebra,
 * where x^{-1} and 1/x are the same number and different strings.
 *
 * The suggestions come from the same engine that used to do the marking. It
 * runs once here, when the question is written, rather than on every paper —
 * and the instructor ticks what they will take, because whether to accept an
 * unsimplified form is a teaching decision, not an arithmetic one.
 */
function AcceptedAnswers({ answer, accept, onChange }) {
  const suggestions = useMemo(
    () => suggestVariants(answer).filter(v => !accept.includes(v)),
    [answer, accept]);

  if (!answer) return null;
  return (
    <div style={{ marginTop: 16, padding: '13px 15px', background: 'var(--surface-2)',
                  border: '1px solid var(--line)', borderRadius: 'var(--r-sm)' }}>
      <span style={LABEL}>Also accept</span>
      <p style={{ margin: '0 0 10px', fontSize: 12.5, lineHeight: 1.6, color: 'var(--ink-3)' }}>
        Spacing, <code>\left</code>, <code>\cdot</code>, braces, a <code>y&rsquo;=</code> on the
        front and numbers like <code>0.5</code> against <code>\frac{'{1}{2}'}</code> are matched
        already. Add anything that needs real algebra — <code>x^{'{-1}'}</code> where the answer
        says <code>1/x</code>.
      </p>

      {accept.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          {accept.map((v, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
                                   padding: '4px 8px', background: 'var(--ok-bg)',
                                   border: '1px solid var(--ok-bd)', borderRadius: 999, fontSize: 13 }}>
              <MathStatic latex={v} />
              <button type="button" onClick={() => onChange(accept.filter((_, k) => k !== i))}
                      title="Stop accepting this"
                      style={{ width: 16, height: 16, padding: 0, background: 'none',
                               border: 'none', color: 'var(--ink-4)', fontSize: 15, lineHeight: 1 }}>×</button>
            </span>
          ))}
        </div>
      )}

      {suggestions.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>Suggestions:</span>
          {suggestions.map(v => (
            <button key={v} type="button" className="btn ghost sm"
                    style={{ width: 'auto', padding: '4px 10px' }}
                    onClick={() => onChange([...accept, v])}>
              + <MathStatic latex={v} />
            </button>
          ))}
        </div>
      )}
      {accept.length === 0 && suggestions.length === 0 && (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-4)' }}>
          Nothing else to suggest for this answer.
        </p>
      )}
    </div>
  );
}

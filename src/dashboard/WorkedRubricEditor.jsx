import { useEffect, useState } from 'react';
import MathField from '../components/MathField.jsx';
import { MATH_PALETTE, insertIntoFocusedField } from '../lib/mathPalette.js';

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

export default function WorkedRubricEditor({ value, onChange }) {
  const marks = Number(value?.marks) || 3;
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
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10, marginBottom: 14 }}>
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
        <label style={{ display: 'block' }}>
          <span style={LABEL}>Worth (marks)</span>
          <input
            className="input"
            type="number" min={1} max={100}
            value={marks}
            onChange={e => set({ marks: Number(e.target.value) })}
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
            onMouseDown={e => { e.preventDefault(); insertIntoFocusedField(sym.insert); }}
          >{sym.title}</button>
        ))}
      </div>

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

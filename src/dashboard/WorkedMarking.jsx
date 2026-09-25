import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { MathStatic } from '../components/MathField.jsx';
import { linesOf } from '../lib/workedShape.js';

// Marking a student's worked solutions, in the instructor's browser.
//
// WHY HERE AND NOT ON THE SERVER. Deciding that 5(1)x^{1-1} is 5 needs a
// computer algebra system, and Postgres has none that can be installed on a
// managed Supabase instance. So the arithmetic runs in JavaScript — and it
// runs HERE, in the dashboard, for a reason that matters: this browser already
// holds the answer key legitimately, and a student's browser must never
// compute the mark it is graded on. The student's side gets step ticks and no
// rubric at all (see components/WorkedSolution.jsx).
//
// The WRITE is still guarded in Postgres: record_work_marks() (sql/024) is
// granted to `authenticated` only and re-checks that this instructor owns the
// paper, so the fact that a browser did the sums does not make the marks
// something any browser can set.
//
// AN INSTRUCTOR CAN OVERRIDE. Every mark is editable before it is saved. The
// checker is good at algebra and has no opinion at all about a student who
// wrote something true by a route it cannot follow, so the last word is the
// instructor's and the reason is shown beside the number.

export default function WorkedMarking({
  assessmentId, studentId, studentName, questions, storedAnswers, attemptNo, onSaved,
}) {
  const worked = (questions || []).filter(
    q => (q.question_type || 'multiple_choice') === 'worked_solution');

  const [marked, setMarked] = useState(null);
  const [overrides, setOverrides] = useState({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(null);

  // Mark everything once, when the script is opened.
  useEffect(() => {
    let cancelled = false;
    if (worked.length === 0) return;
    (async () => {
      try {
        const { ready } = await import('../lib/mathCheck.js');
        await ready();
        const { markAnswer, totalMarks: rubricTotal } = await import('../lib/workedSolution.js');
        const out = {};
        for (const q of worked) {
          const lines = linesOf(storedAnswers?.[q.id]);
          const rubric = {
            ...(q.work_rubric || {}),
            marks: Number(q.marks) || rubricTotal(q.work_rubric),
            variable: q.work_variable || 'x',
          };
          // All or nothing on the answer. The student is given one field and no
          // working to show, so there is no chain to judge and none is judged —
          // markWork() would dock a right answer for not following from the
          // problem as a line of algebra.
          out[q.id] = {
            ...markAnswer(lines, rubric, {
              given: q.work_given, variable: q.work_variable || 'x',
            }),
            lines,
          };
        }
        if (!cancelled) setMarked(out);
      } catch (e) {
        if (!cancelled) setFailed(e?.message || 'The checker could not be loaded.');
      }
    })();
    return () => { cancelled = true; };
    // Re-marks when the script being looked at changes, not on every render.
  }, [studentId, assessmentId]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useCallback(async () => {
    setBusy(true); setFailed(null);
    const items = {};
    Object.entries(marked || {}).forEach(([qId, r]) => {
      const override = overrides[qId];
      const final = override === '' || override === undefined ? r.marks : Number(override);
      items[qId] = {
        marks: Math.max(0, Math.min(r.total, Number.isFinite(final) ? final : r.marks)),
        total: r.total,
        reason: override === '' || override === undefined
          ? r.reason
          : `Marked by instructor. Checker said: ${r.reason}`,
        lines: r.lines,
      };
    });
    const { error } = await supabase.rpc('record_work_marks', {
      p_student_id: studentId,
      p_assessment_id: assessmentId,
      p_items: items,
      p_attempt_no: attemptNo ?? null,
    });
    setBusy(false);
    if (error) { setFailed(error.message); return; }
    setSaved(true);
    onSaved?.(items);
  }, [marked, overrides, studentId, assessmentId, attemptNo, onSaved]);

  if (worked.length === 0) return null;

  // The running total has to follow the overrides, so it is summed over the
  // ENTRIES — a mark keyed by question id — rather than over the values, which
  // carry no id to look an override up by.
  const awarded = Object.entries(marked || {}).reduce((t, [qId, r]) => {
    const o = overrides[qId];
    const useOverride = o !== undefined && o !== '' && Number.isFinite(Number(o));
    return t + (useOverride ? Number(o) : r.marks);
  }, 0);
  const totalAvailable = Object.values(marked || {}).reduce((t, r) => t + r.total, 0);

  return (
    <div style={{ marginTop: 22 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <h4 style={{ margin: 0, fontSize: 15 }}>Worked solutions</h4>
        {marked
          ? <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>
              {awarded} of {totalAvailable} marks
            </span>
          : <span className="ws-pending">Marking…</span>}
      </div>

      {failed && (
        <div style={{ padding: '10px 13px', marginBottom: 12, fontSize: 13, borderRadius: 'var(--r-sm)',
          background: 'var(--danger-bg)', border: '1px solid var(--danger-bd)', color: 'var(--danger)' }}>
          {failed}
        </div>
      )}

      {worked.map(q => {
        const r = marked?.[q.id];
        const lines = r?.lines ?? linesOf(storedAnswers?.[q.id]);
        return (
          <div key={q.id} className="ws-marked" style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
              Q{q.question_number}. {q.question_text}
            </div>
            {q.work_given && (
              <div className="ws-given" style={{ marginBottom: 10 }}>
                <span className="ws-given-label">Given</span>
                <MathStatic latex={q.work_given} />
              </div>
            )}

            {lines.length === 0 ? (
              <p style={{ fontSize: 13, fontStyle: 'italic', color: 'var(--ink-4)', margin: 0 }}>
                Nothing was written.
              </p>
            ) : (
              <div className={`ws-answer-shown ${r ? (r.correct ? 'ws-ok' : 'ws-broken') : ''}`}>
                <span className="ws-given-label">Answered</span>
                <span style={{ fontSize: 19 }}><MathStatic latex={lines[lines.length - 1]} /></span>
                {r && (
                  <span className={`ws-mark ${r.correct ? 'ws-mark-ok' : 'ws-mark-bad'}`}>
                    {r.correct ? '✓' : '✗'}
                  </span>
                )}
              </div>
            )}

            {r && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span className="ws-marked-score" style={{ fontSize: 20 }}>
                    <input
                      className="input"
                      type="number" min={0} max={r.total} step="0.5"
                      value={overrides[q.id] ?? r.marks}
                      onChange={e => setOverrides(o => ({ ...o, [q.id]: e.target.value }))}
                      style={{ width: 78, textAlign: 'right', fontSize: 17, padding: '5px 8px' }}
                      aria-label={`Marks for question ${q.question_number}`}
                    />
                    <span style={{ fontSize: 15, color: 'var(--ink-4)' }}>/ {r.total}</span>
                  </span>
                  {(overrides[q.id] ?? String(r.marks)) !== String(r.marks) && (
                    <button type="button" className="btn ghost sm" style={{ width: 'auto' }}
                            onClick={() => setOverrides(o => ({ ...o, [q.id]: String(r.marks) }))}>
                      Back to {r.marks}
                    </button>
                  )}
                </div>
                <div className="ws-marked-reason">
                  {r.reason}
                  {/* A near miss is the case most worth an instructor's eye:
                      the maths is right and the presentation is not, which is
                      a judgement call the checker should not make alone. */}
                  {r.nearMiss && (
                    <strong style={{ display: 'block', marginTop: 4, color: 'var(--warn)' }}>
                      Worth a look — this is equal to the answer, just not in the form asked for.
                    </strong>
                  )}
                </div>
              </>
            )}
          </div>
        );
      })}

      <button className="btn sm" style={{ width: 'auto' }} onClick={save}
              disabled={!marked || busy}>
        {busy ? 'Saving…' : saved ? 'Marks saved' : `Save marks for ${studentName || 'this student'}`}
      </button>
      {saved && (
        <span style={{ marginLeft: 12, fontSize: 12.5, color: 'var(--ok)' }}>
          Saved. The student&rsquo;s total now includes these marks.
        </span>
      )}
    </div>
  );
}

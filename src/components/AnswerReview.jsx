import { lazy, Suspense } from 'react';
import { letterFor } from '../lib/choices';
import { indexSet } from '../lib/answers';

// Rendering LaTeX pulls in KaTeX, which a paper of plain multiple choice has
// no use for. Split, so only a review containing maths fetches it.
const MathStatic = lazy(() => import('./MathField.jsx')
  .then(m => ({ default: m.MathStatic })));

// The marked paper as the student sees it: one card per question, their answer
// against the key.
//
// Lifted out of ExamBoard because there are now two ways in and they must not
// drift apart — the screen straight after submitting, and the Summary tab,
// which is the only route back once that screen is gone.
//
// Rows come from get_answer_review(), the single server-side route to a
// correct answer. A row carries `correct` (one index) for a single-answer item
// and `correct_set` (an array) for a multi-answer one (sql/018), and `chosen`
// follows the same shape, so both sides are read as sets here.
//
// Every colour here is inked for a LIGHT surface on purpose: ExamBoard renders
// this under its navy hero band, and the first version inherited the band's
// white-on-navy and came out white on white.

export default function AnswerReview({ rows }) {
  const right = rows.filter(r => r.is_correct).length;
  // A worked item's answer is a string of maths, not a set of indices, so
  // "blank" means an empty string rather than an empty set.
  const isWorked = (r) => r.question_type === 'worked_solution';
  const isBlank = (r) => (isWorked(r)
    ? !String(r.chosen || '').trim()
    : indexSet(r.chosen) === null);
  const blank = rows.filter(isBlank).length;
  // Some marks but not all — a step of a full solution, say. Not "wrong".
  const partly = rows.filter(r => !r.is_correct && !isBlank(r) && Number(r.earned) > 0).length;
  const marksEarned = rows.reduce((t, r) => t + (Number(r.earned) || 0), 0);
  const marksTotal = rows.reduce((t, r) => t + (Number(r.marks) || 0), 0);
  const weighted = rows.some(r => Number(r.marks) > 1);

  return (
    <div style={{ marginBottom: 34, textAlign: 'left' }}>
      <div className="card" style={{ padding: '14px 18px', marginBottom: 14, display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--ink-1)' }}>Answer review</h2>
        <span style={{ fontSize: 13, color: 'var(--ok)', fontWeight: 700 }}>{right} correct</span>
        {partly > 0 && <span style={{ fontSize: 13, color: 'var(--warn)', fontWeight: 700 }}>{partly} part marks</span>}
        <span style={{ fontSize: 13, color: 'var(--bad)', fontWeight: 700 }}>{rows.length - right - blank - partly} wrong</span>
        {blank > 0 && <span style={{ fontSize: 13, color: 'var(--ink-4)', fontWeight: 700 }}>{blank} blank</span>}
        {weighted && marksTotal > 0 && (
          <span style={{ fontSize: 13, color: 'var(--ink-2)', fontWeight: 700, marginLeft: 'auto' }}>
            {marksEarned} / {marksTotal} marks
          </span>
        )}
      </div>

      {rows.some(r => r.key_hidden) && (
        <p style={{ margin: '0 2px 14px', fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.55 }}>
          Your instructor has kept the answers back for the questions you did not get fully
          right, so you can work them out yourself on your next attempt.
        </p>
      )}

      {rows.map((r, i) => {
        const unanswered = isBlank(r);

        // A worked item has no choices to lay out — just what the student
        // wrote against the answer.
        if (isWorked(r)) {
          return (
            <div key={r.question_id || i} className="card" style={{
              padding: '16px 18px', marginBottom: 12,
              borderLeft: `4px solid ${r.is_correct ? 'var(--ok)' : unanswered ? 'var(--ink-4)' : Number(r.earned) > 0 ? 'var(--warn)' : 'var(--bad)'}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
                <span className="ar-question-text" style={{ color: 'var(--ink-1)', fontSize: 14, lineHeight: 1.55, fontWeight: 500, flex: '1 1 0', minWidth: 0 }}>
                  <strong>{r.question_number}.</strong> {r.question_text}
                </span>
                <span style={{ marginLeft: 'auto', fontSize: 12.5, fontWeight: 700,
                               color: r.is_correct ? 'var(--ok)' : Number(r.earned) > 0 ? 'var(--warn)' : 'var(--bad)' }}>
                  {Number(r.earned) || 0} / {Number(r.marks) || 1}
                </span>
              </div>
              <Suspense fallback={null}>
                {r.work_given && (
                  <div className="ws-given" style={{ marginBottom: 10 }}>
                    <span className="ws-given-label">Given</span>
                    <MathStatic latex={r.work_given} />
                  </div>
                )}
                {r.work_mode === 'lines' ? (
                  // A full solution: every line, and whether it was a step of
                  // the solution. Which step, and the steps themselves, stay
                  // with the server.
                  unanswered ? (
                    <div className="ws-answer-shown ws-broken">
                      <span className="ws-given-label">You wrote</span>
                      <em style={{ color: 'var(--ink-4)', fontSize: 13 }}>nothing</em>
                    </div>
                  ) : (
                    <ol className="ws-lines" style={{ marginBottom: 8 }}>
                      {(r.lines || []).filter(l => String(l).trim()).map((l, k) => {
                        const counted = Array.isArray(r.line_steps) && r.line_steps[k] !== null
                          && r.line_steps[k] !== undefined;
                        return (
                          <li key={k} className={`ws-answer-shown ${counted ? 'ws-ok' : 'ws-broken'}`}
                            style={{ marginBottom: 0 }}>
                            <span className="ws-step-no">{k + 1}</span>
                            <span style={{ fontSize: 18 }}><MathStatic latex={l} /></span>
                            <span className={`ws-mark ${counted ? 'ws-mark-ok' : 'ws-mark-bad'}`}
                              title={counted ? 'A step of the solution' : 'Not a step of the solution'}>
                              {counted ? '✓' : '✗'}
                            </span>
                          </li>
                        );
                      })}
                    </ol>
                  )
                ) : (
                  <div className={`ws-answer-shown ${r.is_correct ? 'ws-ok' : 'ws-broken'}`}>
                    <span className="ws-given-label">You wrote</span>
                    {unanswered
                      ? <em style={{ color: 'var(--ink-4)', fontSize: 13 }}>nothing</em>
                      : <span style={{ fontSize: 18 }}><MathStatic latex={r.chosen} /></span>}
                    <span className={`ws-mark ${r.is_correct ? 'ws-mark-ok' : 'ws-mark-bad'}`}>
                      {r.is_correct ? '✓' : '✗'}
                    </span>
                  </div>
                )}
                {!unanswered && !r.is_correct && r.reason && (
                  <div className="ws-marked-reason" style={{ marginTop: 0, marginBottom: 8 }}>{r.reason}</div>
                )}
                {/* The answer, where the paper allows it. With the key kept
                    back (review_shows_key off) the server sends it only for
                    an item already answered right, so it cannot leak here. */}
                {!r.is_correct && Array.isArray(r.solution) && r.solution.length > 0 ? (
                  <div className="ws-answer-shown ws-ok" style={{ marginTop: 8, display: 'block' }}>
                    <span className="ws-given-label">Worked solution</span>
                    {r.solution.map((l, k) => (
                      <div key={k} style={{ fontSize: 17, marginTop: 4 }}><MathStatic latex={l} /></div>
                    ))}
                  </div>
                ) : r.correct_latex && !(r.is_correct && r.work_mode === 'lines') ? (
                  <div className="ws-answer-shown ws-ok" style={{ marginTop: 8 }}>
                    <span className="ws-given-label">Answer</span>
                    <span style={{ fontSize: 18 }}><MathStatic latex={r.correct_latex} /></span>
                  </div>
                ) : r.key_hidden && (
                  <div style={{ fontSize: 12.5, color: 'var(--ink-4)', fontStyle: 'italic', marginTop: 4 }}>
                    The answer is kept back — try this one again.
                  </div>
                )}
              </Suspense>
            </div>
          );
        }

        const keySet = indexSet(r.correct_set) ?? indexSet(r.correct) ?? [];
        const mineSet = indexSet(r.chosen) ?? [];
        // question_type is authoritative; the array checks are the fallback
        // for a row fetched before sql/018 taught the function to send it.
        const multi = r.question_type === 'multi_select'
          || Array.isArray(r.correct_set) || Array.isArray(r.chosen);
        return (
          <div key={r.question_id || i} className="card" style={{
            padding: '16px 18px', marginBottom: 12,
            borderLeft: `4px solid ${r.is_correct ? 'var(--ok)' : unanswered ? 'var(--ink-4)' : 'var(--bad)'}`,
          }}>
            <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start', marginBottom: 12 }}>
              <span style={{
                flexShrink: 0, width: 22, height: 22, borderRadius: '50%',
                display: 'grid', placeItems: 'center', marginTop: 1,
                background: r.is_correct ? 'var(--ok-bg)' : unanswered ? 'var(--surface-2)' : 'var(--bad-bg)',
                color: r.is_correct ? 'var(--ok)' : unanswered ? 'var(--ink-4)' : 'var(--bad)',
                fontWeight: 800, fontSize: 12,
              }}>
                {r.is_correct ? '✓' : unanswered ? '–' : '✕'}
              </span>
              <span className="ar-question-text" style={{ color: 'var(--ink-1)', fontSize: 14.5, lineHeight: 1.6, fontWeight: 500 }}>
                <strong style={{ marginRight: 6 }}>{r.question_number ?? i + 1}.</strong>
                {r.question_text}
              </span>
            </div>

            <div style={{ display: 'grid', gap: 5 }}>
              {(r.choices || []).map((choice, ci) => {
                const isKey = keySet.includes(ci);
                const isMine = mineSet.includes(ci);
                return (
                  <div key={ci} style={{
                    fontSize: 13.5, padding: '7px 11px', borderRadius: 'var(--r-sm)',
                    display: 'flex', gap: 8, alignItems: 'flex-start',
                    // Neutral choices stay readable ink, not washed out.
                    color: isKey ? 'var(--ok)' : isMine ? 'var(--bad)' : 'var(--ink-2)',
                    background: isKey ? 'var(--ok-bg)' : isMine ? 'var(--bad-bg)' : 'var(--surface-2)',
                    border: `1px solid ${isKey ? 'var(--ok-bd)' : isMine ? 'var(--bad-bd)' : 'var(--line)'}`,
                    fontWeight: isKey || isMine ? 600 : 400,
                  }}>
                    <strong style={{ flexShrink: 0 }}>{letterFor(ci)}.</strong>
                    <span style={{ flex: 1 }}>{choice}</span>
                    {isKey && <span style={{ flexShrink: 0, fontSize: 11.5, fontWeight: 700 }}>CORRECT{isMine && multi ? ' — YOU TICKED THIS' : ''}</span>}
                    {isMine && !isKey && <span style={{ flexShrink: 0, fontSize: 11.5, fontWeight: 700 }}>YOUR ANSWER</span>}
                  </div>
                );
              })}
            </div>

            {unanswered && (
              <div style={{ fontSize: 12.5, color: 'var(--ink-4)', marginTop: 9, fontStyle: 'italic' }}>
                You left this blank.
              </div>
            )}

            {/* Why a paper can be marked wrong with three of four boxes right:
                a multi-answer item is all or nothing. Said here rather than
                left for the student to work out from the colours. */}
            {r.key_hidden && (
              <div style={{ fontSize: 12.5, color: 'var(--ink-4)', marginTop: 9, fontStyle: 'italic' }}>
                The correct answer is kept back — try this one again.
              </div>
            )}

            {multi && !unanswered && !r.is_correct && !r.key_hidden && (
              <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 9 }}>
                This question needed every correct answer ticked and nothing
                else — {keySet.map(letterFor).join(', ')}. You ticked{' '}
                {mineSet.length ? mineSet.map(letterFor).join(', ') : 'nothing'}.
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

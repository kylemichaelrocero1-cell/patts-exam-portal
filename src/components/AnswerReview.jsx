import { letterFor } from '../lib/choices';
import { indexSet } from '../lib/answers';

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
  const isBlank = (r) => indexSet(r.chosen) === null;
  const blank = rows.filter(isBlank).length;

  return (
    <div style={{ marginBottom: 34, textAlign: 'left' }}>
      <div className="card" style={{ padding: '14px 18px', marginBottom: 14, display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--ink-1)' }}>Answer review</h2>
        <span style={{ fontSize: 13, color: 'var(--ok)', fontWeight: 700 }}>{right} correct</span>
        <span style={{ fontSize: 13, color: 'var(--bad)', fontWeight: 700 }}>{rows.length - right - blank} wrong</span>
        {blank > 0 && <span style={{ fontSize: 13, color: 'var(--ink-4)', fontWeight: 700 }}>{blank} blank</span>}
      </div>

      {rows.map((r, i) => {
        const unanswered = isBlank(r);
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
              <span style={{ color: 'var(--ink-1)', fontSize: 14.5, lineHeight: 1.6, fontWeight: 500 }}>
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
            {multi && !unanswered && !r.is_correct && (
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

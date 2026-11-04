// What a student sees the moment a paper is handed in: the percentage on the
// paper's grade base, the raw score under it, then whether they passed. On
// 50-base, 50/100 reads 75%, 50/100, Passed.
//
// A paper with worked items the server could not mark has no percentage yet,
// so it shows what is known and says the rest is coming.
import { gradeOf, gradeVerdict } from '../lib/workedShape.js';

export default function ExamResult({ score, total, workPending = 0, base = 0, attemptNo = 1 }) {
  const pending = workPending > 0;
  // A student back on a paper already filed arrives with no score to show.
  if (!pending && !(total > 0)) return null;

  const grade = pending ? { pct: null, passed: null } : gradeOf(score, total, base);
  const tone = grade.pct === null ? 'var(--ink-2)'
    : grade.pct >= 75 ? 'var(--ok)' : grade.pct >= 50 ? 'var(--warn)' : 'var(--bad)';

  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 700 }}>
        Your score{attemptNo > 1 ? ` · attempt ${attemptNo}` : ''}
      </div>
      {grade.pct !== null && (
        <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 44, color: tone, lineHeight: 1.1, marginTop: 6 }}>
          {grade.pct}%
        </div>
      )}
      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 18, color: 'var(--ink-2)', marginTop: 4 }}>
        {pending ? '—' : score}
        <span style={{ color: 'var(--ink-4)' }}>/{pending ? workPending + total : total}</span>
      </div>
      {grade.passed !== null && (
        <div style={{ fontSize: 15, fontWeight: 700, color: grade.passed ? 'var(--ok)' : 'var(--bad)', marginTop: 6 }}>
          {gradeVerdict({ passed: grade.passed, base }, { showBase: true })}
        </div>
      )}
      {pending && (
        <div style={{ fontSize: 12.5, color: 'var(--warn)', fontWeight: 600, marginTop: 4 }}>
          Your instructor will mark this
        </div>
      )}
    </div>
  );
}

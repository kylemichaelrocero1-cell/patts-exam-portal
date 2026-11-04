import { useState, useEffect } from 'react';
import Icon from './components/Icon';
import AnswerReviewOverlay from './components/AnswerReviewOverlay';
import {
  availabilityState, formatWindow, closingNote,
} from './lib/assessments';
import { paperNoun } from './lib/paperNoun.js';
import { lessonVisibleTo } from './lib/lessonMarkdown';
import { isPaperFinished } from './lib/retakes';
import { useAnswerReview } from './lib/useAnswerReview';
import { combinedScore, gradeOf, gradeVerdict, withGradeBases } from './lib/workedShape.js';
import { homeReads } from './lib/studentHome';

// A student's landing page: what needs doing, what has been done, how they did.
// Everything here is derived from data the other tabs already load — this is a
// different view of it, not a new source of truth.

const card = { padding: '16px 18px' };

function Stat({ label, value, tone, icon, chip }) {
  return (
    <div className="stat-cell">
      <span className={`chip chip-${chip}`}><Icon name={icon} size={18} /></span>
      <div>
        <div className="stat-cell-label">{label}</div>
        <div className="stat-cell-value" style={tone ? { color: tone } : undefined}>{value}</div>
      </div>
    </div>
  );
}

export default function StudentSummary({ student, selectedSection, onGoToTab }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const { review, busy: reviewBusy, open: openReview, close: closeReview } = useAnswerReview(student.id);
  // The table opens on the most recent handful; a student who wants the whole
  // semester asks for it. Nothing is dropped, only folded.
  const [showAllResults, setShowAllResults] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // The copy the home tabs share (src/lib/studentHome.js): coming back
        // here from Exams or Lessons does not ask the database again.
        const [openRes, resultsRes, lessonsRes, progressRes, attemptsRes] = await Promise.all([
          homeReads.openAssessments(),
          homeReads.results(student.id),
          homeReads.lessons(),
          homeReads.lessonProgress(student.id),
          // Practice retakes are not in results, so without this a student who
          // had sat five mock exams saw "0 submitted" and an empty list.
          homeReads.attempts(student.id),
        ]);
        if (cancelled) return;
        if (openRes.error) throw openRes.error;

        const mine = (openRes.data || []).filter(a =>
          (a.target_section || '').split(',').map(s => s.trim()).includes(selectedSection)
        );
        const graded = resultsRes.data || [];
        const rawAttempts = attemptsRes.data || [];

        // Show the most recent attempt per mock exam in the list, but keep the
        // full history so the count and the per-exam totals stay honest.
        const latestPerAssessment = new Map();
        rawAttempts.forEach(a => {
          const prev = latestPerAssessment.get(a.assessment_id);
          if (!prev || a.attempt_no > prev.attempt_no) latestPerAssessment.set(a.assessment_id, a);
        });

        const results = [
          ...graded.map(r => ({ ...r, attempts: 1, is_practice: false })),
          ...[...latestPerAssessment.values()].map(a => ({
            exam_id: a.assessment_id,
            score: a.score,
            total_items: a.total_items,
            points_earned: a.points_earned,
            points_total: a.points_total,
            // Without these a practice paper made entirely of worked items
            // reported 0 of 0: its picked-item score IS zero out of zero, and
            // everything it is actually worth lives in the worked columns.
            work_marks: a.work_marks,
            work_total: a.work_total,
            submitted_at: a.submitted_at,
            attempts: rawAttempts.filter(x => x.assessment_id === a.assessment_id).length,
            is_practice: true,
          })),
        ];
        // Practice never counts as "done" — a retakeable paper stays open.
        // Nor does a graded sitting once the instructor switches retakes on:
        // isPaperFinished reads the switch as it is now, so re-opening a paper
        // for revision puts it back on the to-do list instead of leaving the
        // students who already sat it with nowhere to click.
        const doneIds = new Set(graded.map(r => r.exam_id));

        // Titles and the answer-review switch have to come from the papers
        // BEHIND the results, not from `mine`: `mine` is open papers only, and
        // an instructor almost always CLOSES an exam before letting the class
        // look at it. Reading from `mine` alone is why a finished paper showed
        // up here as a bare "Assessment" with no way back into it.
        // Through the shared copy, so the exam lists asking the same thing
        // for their "Ready to review" do not read it again.
        const behindRes = await homeReads.papers(results.map(r => r.exam_id));
        if (cancelled) return;
        if (behindRes.error) throw behindRes.error;
        const behind = behindRes.data || [];

        // Lessons tables may not exist on an un-migrated database; treat a
        // failure as "no lessons" rather than breaking the whole summary.
        const lessons = (lessonsRes.data || []).filter(l => lessonVisibleTo(l, selectedSection));
        const completed = new Set((progressRes.data || []).filter(p => p.completed_at).map(p => p.lesson_id));

        setData({
          todo: mine.filter(a => !isPaperFinished(a, doneIds.has(a.id)) && availabilityState(a) === 'open'),
          upcoming: mine.filter(a => availabilityState(a) === 'scheduled'),
          results: withGradeBases(results, behind).sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at)),
          titles: Object.fromEntries([
            ...mine.map(a => [a.id, a.title]),
            ...behind.map(a => [a.id, a.title]),
          ]),
          // Whose answers the instructor has opened up. The server enforces
          // this too — get_answer_review() refuses on a paper with
          // show_answers off — so this only decides whether to offer the
          // button, never whether the key may be handed over.
          reviewable: new Set(behind.filter(a => a.show_answers).map(a => a.id)),
          lessons, completed,
        });
      } catch (err) {
        console.error('Summary failed to load:', err);
        if (!cancelled) setError('Could not load your summary. Check your connection and try again.');
      }
    })();
    return () => { cancelled = true; };
  }, [student.id, selectedSection]);

  if (error) {
    return <div className="card" style={{ ...card, maxWidth: 860, margin: '0 auto' }}>{error}</div>;
  }
  if (!data) {
    return <div style={{ textAlign: 'center', color: 'var(--ink-3)', padding: 40 }}>Loading your summary…</div>;
  }

  const { todo, upcoming, results, titles, reviewable, lessons, completed } = data;

  // Only graded work counts toward an average; a 0/0 row would drag it to zero.
  // A paper whose worked items are still awaiting an instructor is left out
  // too — combinedScore() returns a null percentage for exactly that case, and
  // averaging a half-marked paper would show a student a figure that changes
  // by itself later.
  const graded = results
    .map(r => ({ row: r, m: combinedScore(r) }))
    .filter(({ m }) => m.total > 0 && m.pct !== null);
  const avg = graded.length
    ? gradeOf(graded.reduce((a, { m }) => a + m.pct, 0) / graded.length, 100).pct
    : null;

  // A student's own record of their own work is permanent. Closing a paper or
  // putting it in the archive is an instructor's housekeeping — it takes the
  // paper out of the Exams tab, where only takeable papers belong, and it must
  // never take away the score. Nothing here filters on is_open or archived_at,
  // and `behind` deliberately reads the papers underneath the results rather
  // than the open ones, so a title survives its paper being put away.
  const RECENT = 8;
  const shown = showAllResults ? results : results.slice(0, RECENT);
  // The Answers column earns its width only if something in view is actually
  // reviewable — otherwise it is a row of dashes on a phone.
  const anyReviewable = shown.some(r => reviewable.has(r.exam_id));

  return (
    <div className="home-wrap">
      <div className="stat-strip stat-strip-4">
        <Stat label="To do" value={todo.length} icon="clock" chip="gold" tone={todo.length ? 'var(--gold-700)' : undefined} />
        <Stat label="Submitted" value={results.length} icon="check-circle" chip="navy" />
        <Stat label="Average" value={avg === null ? '–' : `${avg}%`} icon="trend-up"
          chip={avg === null ? 'navy' : avg >= 75 ? 'ok' : 'bad'}
          tone={avg === null ? undefined : avg >= 75 ? 'var(--ok)' : 'var(--bad)'} />
        <Stat label="Lessons" value={lessons.length ? `${completed.size}/${lessons.length}` : '–'} icon="book" chip="blue" />
      </div>

      <div className="home-grid">
      <div>
      {/* To do */}
      <h2 className="home-heading">
        To do
      </h2>
      {todo.length === 0 && upcoming.length === 0 ? (
        <div className="card" style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--ink-3)', fontSize: 13.5 }}>
          <Icon name="check-circle" size={18} color="var(--ok)" />
          All caught up
        </div>
      ) : (
        // minmax(0, 1fr): a grid column is otherwise as wide as its longest
        // unbreakable line, and a long paper title pushed the card — and the
        // whole page — off the side of a phone.
        <div className="row-list">
          {[...todo, ...upcoming].map(a => {
            const scheduled = availabilityState(a) === 'scheduled';
            const closing = scheduled ? null : closingNote(a);
            return (
              <button
                key={a.id}
                className="row-list-item"
                onClick={() => onGoToTab(a.kind === 'seatwork' ? 'seatwork' : 'exams')}
              >
                <span className={`chip chip-${a.kind === 'seatwork' ? 'navy' : 'gold'}`}>
                  <Icon name={a.kind === 'seatwork' ? 'clipboard-check' : 'exam'} size={17} />
                </span>
                {/* The title wraps rather than cuts: papers in a series differ
                    at the end of the title. */}
                <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <span style={{ fontWeight: 600, fontSize: 13.5, lineHeight: 1.35, overflowWrap: 'anywhere' }}>
                    {a.title || 'Untitled'}
                  </span>
                  <span style={{ fontSize: 12.5, fontWeight: 500, color: scheduled ? 'var(--ink-4)' : closing?.soon ? 'var(--warn)' : 'var(--ok)' }}>
                    {paperNoun(a)} · {scheduled ? formatWindow(a) : closing ? `Open, ${closing.label}` : 'Open now'}
                  </span>
                </span>
                <Icon name="chevron-right" size={15} color="var(--ink-4)" />
              </button>
            );
          })}
        </div>
      )}

      </div>

      {/* Recent scores */}
      {results.length > 0 && (
        <div>
          <h2 className="home-heading">Scores</h2>
          <div className="card" style={{ overflow: 'hidden' }}>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Paper</th>
                    <th className="home-score-head">Score</th>
                    <th className="hide-narrow" style={{ textAlign: 'right' }}>Date</th>
                    {anyReviewable && <th aria-label="Review answers" />}
                  </tr>
                </thead>
                <tbody>
                  {shown.map(r => {
                    // Worked items are marked by an instructor after the fact
                    // (sql/024), so a paper can be genuinely half-marked here.
                    const m = combinedScore(r);
                    const pct = m.pct;
                    return (
                      <tr key={`${r.exam_id}-${r.is_practice ? 'p' : 'g'}`}>
                        <td style={{ fontWeight: 600 }}>
                          {titles[r.exam_id] || 'Assessment'}
                          {r.is_practice && r.attempts > 1 && (
                            <span style={{ marginLeft: 7, fontSize: 11.5, color: 'var(--ink-4)', fontWeight: 500 }}>
                              attempt {r.attempts}
                            </span>
                          )}
                        </td>
                        <td className="home-score">
                          {/* The percentage on the paper's base, coloured by
                              the verdict, then the raw score. */}
                          {pct !== null && (
                            <strong title={gradeVerdict(m, { showBase: true })} style={{ color: m.passed ? 'var(--ok)' : 'var(--bad)' }}>{pct}%</strong>
                          )}
                          <span>{m.score}/{m.total}</span>
                          {pct !== null && (
                            <em style={{ color: m.passed ? 'var(--ok)' : 'var(--bad)' }}>{gradeVerdict(m)}</em>
                          )}
                          {m.pending > 0 && (
                            <em style={{ color: 'var(--warn)' }}>{m.pending} to mark</em>
                          )}
                        </td>
                        <td className="hide-narrow" style={{ textAlign: 'right', color: 'var(--ink-4)', fontSize: 12.5 }}>
                          {r.submitted_at ? new Date(r.submitted_at).toLocaleDateString() : '—'}
                        </td>
                        {anyReviewable && (
                          <td style={{ textAlign: 'right' }}>
                            {reviewable.has(r.exam_id) ? (
                              <button
                                className="btn ghost sm"
                                style={{ width: 'auto' }}
                                aria-label={`Review ${titles[r.exam_id] || 'Assessment'}`}
                                title="Review answers"
                                disabled={reviewBusy === r.exam_id}
                                onClick={() => openReview(r.exam_id, titles[r.exam_id] || 'Assessment')}
                              >
                                <Icon name="eye" size={14} />
                                {reviewBusy === r.exam_id ? '…' : ''}
                              </button>
                            ) : (
                              <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>—</span>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {results.length > RECENT && (
              <button
                className="btn ghost sm"
                onClick={() => setShowAllResults(v => !v)}
                style={{ width: '100%', borderRadius: 0, borderLeft: 0, borderRight: 0, borderBottom: 0, borderTop: '1px solid var(--line)' }}
              >
                {showAllResults
                  ? 'Show less'
                  : `Show all ${results.length}`}
              </button>
            )}
          </div>
        </div>
      )}
      </div>

      <AnswerReviewOverlay review={review} onClose={closeReview} />
    </div>
  );
}

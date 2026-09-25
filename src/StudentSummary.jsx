import { useState, useEffect } from 'react';
import Icon from './components/Icon';
import AnswerReview from './components/AnswerReview';
import { supabase } from './supabase';
import {
  selectAssessments, availabilityState, formatWindow, KIND_LABEL,
} from './lib/assessments';
import { lessonVisibleTo } from './lib/lessonMarkdown';
import { isPaperFinished } from './lib/retakes';
import { fetchAnswerReview } from './lib/answerReview';
import { combinedScore } from './lib/workedShape.js';

// A student's landing page: what needs doing, what has been done, how they did.
// Everything here is derived from data the other tabs already load — this is a
// different view of it, not a new source of truth.

const card = { padding: '16px 18px' };

function Stat({ label, value, sub, tone = 'var(--navy)' }) {
  return (
    <div className="card" style={{ ...card, flex: '1 1 150px', minWidth: 140 }}>
      <div style={{ fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 700 }}>
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, fontFamily: 'var(--font-mono)', color: tone, marginTop: 4, lineHeight: 1.1 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11.5, color: 'var(--ink-4)', marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

export default function StudentSummary({ student, selectedSection, onGoToTab }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  // The marked paper, once the student asks for it: { title, rows }.
  const [review, setReview] = useState(null);
  const [reviewBusy, setReviewBusy] = useState(null);   // exam_id being fetched
  // The table opens on the most recent handful; a student who wants the whole
  // semester asks for it. Nothing is dropped, only folded.
  const [showAllResults, setShowAllResults] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [assessments, resultsRes, lessonsRes, progressRes, attemptsRes] = await Promise.all([
          selectAssessments(q => q.eq('is_open', true)),
          supabase.from('results')
            .select('exam_id, score, total_items, points_earned, points_total, work_marks, work_total, submitted_at')
            .eq('student_id', student.id),
          supabase.from('lessons')
            .select('id, title, target_section, is_published')
            .eq('is_published', true),
          supabase.from('lesson_progress')
            .select('lesson_id, completed_at')
            .eq('student_id', student.id),
          // Practice retakes are not in results, so without this a student who
          // had sat five mock exams saw "0 submitted" and an empty list.
          supabase.from('review_attempts')
            .select('assessment_id, attempt_no, score, total_items, points_earned, points_total, work_marks, work_total, submitted_at')
            .eq('student_id', student.id),
        ]);
        if (cancelled) return;

        const mine = assessments.filter(a =>
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
        const resultIds = [...new Set(results.map(r => r.exam_id).filter(Boolean))];
        const behind = resultIds.length
          ? await selectAssessments(q => q.in('id', resultIds))
          : [];
        if (cancelled) return;

        // Lessons tables may not exist on an un-migrated database; treat a
        // failure as "no lessons" rather than breaking the whole summary.
        const lessons = (lessonsRes.data || []).filter(l => lessonVisibleTo(l, selectedSection));
        const completed = new Set((progressRes.data || []).filter(p => p.completed_at).map(p => p.lesson_id));

        setData({
          todo: mine.filter(a => !isPaperFinished(a, doneIds.has(a.id)) && availabilityState(a) === 'open'),
          upcoming: mine.filter(a => availabilityState(a) === 'scheduled'),
          results: results.slice().sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at)),
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

  // The only route to a correct answer, and it is the server's decision:
  // get_answer_review() refuses unless the paper has show_answers on AND this
  // student has already submitted it. So a stale page that still shows the
  // button after the instructor closes review again fails here, not silently.
  const openReview = async (examId, title) => {
    setReviewBusy(examId);
    const { data: rows, error: rpcError } = await fetchAnswerReview(student.id, examId);
    setReviewBusy(null);
    if (rpcError) {
      alert(/not available/i.test(rpcError.message)
        ? 'Your instructor has not opened the answers for this one.'
        : /session has expired/i.test(rpcError.message)
          ? 'Your session has expired. Please log in again.'
          : 'Could not load the answers. Please try again.');
      return;
    }
    setReview({ title, rows: rows || [] });
  };

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
    ? Math.round(graded.reduce((a, { m }) => a + m.pct, 0) / graded.length)
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
    <div style={{ maxWidth: 860, margin: '0 auto' }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 25, letterSpacing: '-0.02em', margin: '0 0 4px' }}>
        Hello, {(student.full_name || '').split(' ')[0] || 'there'}
      </h1>
      <p style={{ color: 'var(--ink-3)', fontSize: 13.5, margin: '0 0 20px' }}>{selectedSection}</p>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 22 }}>
        <Stat label="To do" value={todo.length}
          sub={todo.length ? 'open now' : 'nothing due'}
          tone={todo.length ? 'var(--gold-700)' : 'var(--ink-3)'} />
        <Stat label="Submitted" value={results.length} sub="all time" />
        <Stat label="Average" value={avg === null ? '–' : `${avg}%`}
          sub={graded.length ? `${graded.length} graded` : 'no scores yet'}
          tone={avg === null ? 'var(--ink-3)' : avg >= 75 ? 'var(--ok)' : 'var(--navy)'} />
        <Stat label="Lessons" value={lessons.length ? `${completed.size}/${lessons.length}` : '–'}
          sub={lessons.length ? 'completed' : 'none posted'} />
      </div>

      {/* To do */}
      <h2 style={{ fontSize: 11.5, letterSpacing: '.09em', textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 700, margin: '0 0 10px' }}>
        Needs your attention
      </h2>
      {todo.length === 0 && upcoming.length === 0 ? (
        <div className="card" style={{ ...card, textAlign: 'center', padding: '30px 18px', marginBottom: 24 }}>
          <Icon name="check-circle" size={26} color="var(--ok)" />
          <p style={{ margin: '10px 0 0', color: 'var(--ink-3)', fontSize: 13.5 }}>
            You&apos;re all caught up.
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8, marginBottom: 24 }}>
          {[...todo, ...upcoming].map(a => {
            const scheduled = availabilityState(a) === 'scheduled';
            return (
              <button
                key={a.id}
                className="card"
                onClick={() => onGoToTab(a.kind === 'seatwork' ? 'seatwork' : 'exams')}
                style={{ ...card, display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', cursor: 'pointer', width: '100%', border: '1px solid var(--line)', background: 'var(--surface)' }}
              >
                <span style={{
                  fontSize: 10.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase',
                  padding: '3px 8px', borderRadius: 'var(--r-full)', flexShrink: 0,
                  background: a.kind === 'seatwork' ? 'var(--navy-tint)' : 'var(--gold-pale)',
                  color: a.kind === 'seatwork' ? 'var(--navy)' : 'var(--gold-700)',
                }}>
                  {KIND_LABEL[a.kind] || 'Exam'}
                </span>
                {/* The colour is explicit because this whole card is a
                    <button>, and the global button rule paints text white for
                    the navy buttons everywhere else — so the paper's name was
                    being drawn in white on a white card and the row looked
                    like an unnamed EXAM. */}
                <span style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 14, color: 'var(--ink-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {a.title || 'Untitled'}
                </span>
                <span style={{ fontSize: 12, color: scheduled ? 'var(--ink-4)' : 'var(--ok)', fontWeight: 600, flexShrink: 0 }}>
                  {scheduled ? formatWindow(a) : 'Open now'}
                </span>
                <Icon name="chevron-right" size={15} color="var(--ink-4)" />
              </button>
            );
          })}
        </div>
      )}

      {/* Recent scores */}
      {results.length > 0 && (
        <>
          <h2 style={{ fontSize: 11.5, letterSpacing: '.09em', textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 700, margin: '0 0 4px' }}>
            {showAllResults ? `All results (${results.length})` : 'Recent results'}
          </h2>
          <p style={{ fontSize: 12, color: 'var(--ink-4)', margin: '0 0 10px' }}>
            Your scores stay here after a paper is closed or archived.
          </p>
          <div className="card" style={{ overflow: 'hidden', marginBottom: 30 }}>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Assessment</th>
                    <th style={{ textAlign: 'right' }}>Score</th>
                    <th style={{ textAlign: 'right' }}>Submitted</th>
                    {anyReviewable && <th style={{ textAlign: 'right' }}>Answers</th>}
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
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: pct === null ? 'var(--ink-4)' : pct >= 75 ? 'var(--ok)' : 'var(--ink-1)' }}>
                          {m.score}/{m.total}{pct !== null ? ` · ${pct}%` : ''}
                          {m.pending > 0 && (
                            <span style={{ display: 'block', marginTop: 2, fontSize: 11, fontWeight: 600, color: 'var(--warn)', fontFamily: 'var(--font-sans)' }}>
                              {m.pending} mark{m.pending === 1 ? '' : 's'} awaiting marking
                            </span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right', color: 'var(--ink-4)', fontSize: 12.5 }}>
                          {r.submitted_at ? new Date(r.submitted_at).toLocaleDateString() : '—'}
                        </td>
                        {anyReviewable && (
                          <td style={{ textAlign: 'right' }}>
                            {reviewable.has(r.exam_id) ? (
                              <button
                                className="btn ghost sm"
                                style={{ width: 'auto' }}
                                disabled={reviewBusy === r.exam_id}
                                onClick={() => openReview(r.exam_id, titles[r.exam_id] || 'Assessment')}
                              >
                                <Icon name="eye" size={13} />
                                {reviewBusy === r.exam_id ? 'Loading…' : 'Review'}
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
                  ? 'Show recent only'
                  : `Show all ${results.length} results`}
              </button>
            )}
          </div>
        </>
      )}

      {/* The marked paper. An overlay rather than an inline expansion: fifty
          questions unrolled inside the summary would bury everything under it,
          and a click on the backdrop puts the student straight back.
          It scrolls itself — alignItems must stay flex-start or a long review
          centres and the first questions go off the top, out of reach. */}
      {review && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(6,24,41,.88)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', zIndex: 1200, padding: 20, overflowY: 'auto' }}
          onClick={e => { if (e.target === e.currentTarget) setReview(null); }}
        >
          <div style={{ width: '100%', maxWidth: 820 }}>
            <div className="card" style={{ padding: '14px 18px', marginBottom: 14, display: 'flex', gap: 12, alignItems: 'center', position: 'sticky', top: 0, zIndex: 1 }}>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {review.title}
              </h2>
              <button className="btn ghost sm" style={{ width: 'auto', flexShrink: 0 }} onClick={() => setReview(null)}>
                Close
              </button>
            </div>
            {review.rows.length === 0 ? (
              <div className="card" style={{ ...card, color: 'var(--ink-3)', fontSize: 13.5 }}>
                There is nothing to review on this paper — it has no multiple-choice questions.
              </div>
            ) : (
              <AnswerReview rows={review.rows} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

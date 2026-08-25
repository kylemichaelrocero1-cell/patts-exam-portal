import { useState, useEffect } from 'react';
import Icon from './components/Icon';
import { supabase } from './supabase';
import {
  selectAssessments, availabilityState, formatWindow, KIND_LABEL,
} from './lib/assessments';
import { lessonVisibleTo } from './lib/lessonMarkdown';

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [assessments, resultsRes, lessonsRes, progressRes, attemptsRes] = await Promise.all([
          selectAssessments(q => q.eq('is_open', true)),
          supabase.from('results')
            .select('exam_id, score, total_items, submitted_at')
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
            .select('assessment_id, attempt_no, score, total_items, submitted_at')
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
            submitted_at: a.submitted_at,
            attempts: rawAttempts.filter(x => x.assessment_id === a.assessment_id).length,
            is_practice: true,
          })),
        ];
        // Practice never counts as "done" — a retakeable paper stays open.
        const doneIds = new Set(graded.map(r => r.exam_id));

        // Lessons tables may not exist on an un-migrated database; treat a
        // failure as "no lessons" rather than breaking the whole summary.
        const lessons = (lessonsRes.data || []).filter(l => lessonVisibleTo(l, selectedSection));
        const completed = new Set((progressRes.data || []).filter(p => p.completed_at).map(p => p.lesson_id));

        setData({
          todo: mine.filter(a => !doneIds.has(a.id) && availabilityState(a) === 'open'),
          upcoming: mine.filter(a => availabilityState(a) === 'scheduled'),
          results: results.slice().sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at)),
          titles: Object.fromEntries(mine.map(a => [a.id, a.title])),
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

  const { todo, upcoming, results, titles, lessons, completed } = data;

  // Only graded work counts toward an average; a 0/0 row would drag it to zero.
  const graded = results.filter(r => r.total_items > 0);
  const avg = graded.length
    ? Math.round(graded.reduce((a, r) => a + (r.score / r.total_items) * 100, 0) / graded.length)
    : null;

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
                <span style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {a.title}
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
          <h2 style={{ fontSize: 11.5, letterSpacing: '.09em', textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 700, margin: '0 0 10px' }}>
            Recent results
          </h2>
          <div className="card" style={{ overflow: 'hidden', marginBottom: 30 }}>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr><th>Assessment</th><th style={{ textAlign: 'right' }}>Score</th><th style={{ textAlign: 'right' }}>Submitted</th></tr>
                </thead>
                <tbody>
                  {results.slice(0, 8).map(r => {
                    const pct = r.total_items > 0 ? Math.round((r.score / r.total_items) * 100) : null;
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
                          {r.score}/{r.total_items}{pct !== null ? ` · ${pct}%` : ''}
                        </td>
                        <td style={{ textAlign: 'right', color: 'var(--ink-4)', fontSize: 12.5 }}>
                          {r.submitted_at ? new Date(r.submitted_at).toLocaleDateString() : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

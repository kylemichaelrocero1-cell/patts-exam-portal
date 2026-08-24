import { useState, useEffect } from 'react';
import Icon from './components/Icon';
import LessonContent from './components/LessonContent';
import { supabase } from './supabase';
import { lessonVisibleTo } from './lib/lessonMarkdown';

export default function StudentLessons({ student, selectedSection }) {
  const [lessons, setLessons] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [progress, setProgress] = useState({}); // lesson_id -> {viewed_at, completed_at}
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [open, setOpen] = useState(null); // the lesson being read

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // RLS already limits anon to published lessons; the client-side section
        // filter is about relevance, not access.
        const [lRes, sRes, pRes] = await Promise.all([
          supabase.from('lessons')
            .select('id, subject_id, title, content_md, target_section, is_published, published_at')
            .eq('is_published', true)
            .order('sort_order', { ascending: true }),
          supabase.from('lesson_subjects').select('id, title, sort_order'),
          supabase.from('lesson_progress')
            .select('lesson_id, viewed_at, completed_at')
            .eq('student_id', student.id),
        ]);
        if (lRes.error) throw lRes.error;
        if (cancelled) return;

        setLessons((lRes.data || []).filter(l => lessonVisibleTo(l, selectedSection)));
        setSubjects(sRes.data || []);
        const map = {};
        (pRes.data || []).forEach(p => { map[p.lesson_id] = p; });
        setProgress(map);
      } catch (err) {
        console.error('Failed to load lessons:', err);
        if (!cancelled) {
          setLoadError(
            /schema cache|does not exist|not find the table/i.test(err?.message || '')
              ? 'Lessons are not set up yet. Please check back later.'
              : 'Could not load lessons. Check your connection and try again.'
          );
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [student.id, selectedSection]);

  // Record that the student opened this lesson. Best-effort: a failure here
  // must never stop them reading, so it is not awaited into the UI path.
  const openLesson = (lesson) => {
    setOpen(lesson);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (progress[lesson.id]) return;
    const row = { student_id: student.id, lesson_id: lesson.id, viewed_at: new Date().toISOString() };
    setProgress(prev => ({ ...prev, [lesson.id]: row }));
    supabase.from('lesson_progress')
      .upsert([row], { onConflict: 'student_id,lesson_id' })
      .then(({ error }) => { if (error) console.error('progress save failed:', error.message); });
  };

  const markComplete = async (lesson) => {
    const done = !progress[lesson.id]?.completed_at;
    const row = {
      student_id: student.id,
      lesson_id: lesson.id,
      viewed_at: progress[lesson.id]?.viewed_at || new Date().toISOString(),
      completed_at: done ? new Date().toISOString() : null,
    };
    setProgress(prev => ({ ...prev, [lesson.id]: row }));
    const { error } = await supabase.from('lesson_progress')
      .upsert([row], { onConflict: 'student_id,lesson_id' });
    if (error) console.error('progress save failed:', error.message);
  };

  if (isLoading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)' }}>Loading lessons…</div>;
  }

  // ── Reading view ───────────────────────────────────────────────────
  if (open) {
    const done = !!progress[open.id]?.completed_at;
    return (
      <div style={{ maxWidth: 780, margin: '0 auto' }}>
        <button className="btn ghost sm" style={{ width: 'auto', marginBottom: 18 }} onClick={() => setOpen(null)}>
          <Icon name="arrow-left" size={14} /> All lessons
        </button>

        <div className="card" style={{ padding: '28px 30px' }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 27, letterSpacing: '-0.02em', margin: '0 0 6px' }}>
            {open.title}
          </h1>
          {open.published_at && (
            <p style={{ color: 'var(--ink-4)', fontSize: 12.5, margin: '0 0 22px' }}>
              Posted {new Date(open.published_at).toLocaleDateString()}
            </p>
          )}
          <LessonContent markdown={open.content_md} />
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', margin: '22px 0 40px' }}>
          <button
            className={done ? 'btn ghost' : 'btn'}
            style={{ width: 'auto' }}
            onClick={() => markComplete(open)}
          >
            <Icon name={done ? 'check-circle' : 'check'} size={15} />
            {done ? 'Marked as done — undo' : 'Mark as done'}
          </button>
        </div>
      </div>
    );
  }

  // ── List view ──────────────────────────────────────────────────────
  const bySubject = new Map();
  lessons.forEach(l => {
    const key = l.subject_id || '__none__';
    if (!bySubject.has(key)) bySubject.set(key, []);
    bySubject.get(key).push(l);
  });
  const subjectTitle = (key) =>
    key === '__none__' ? 'General' : (subjects.find(s => s.id === key)?.title || 'Lessons');

  const doneCount = lessons.filter(l => progress[l.id]?.completed_at).length;

  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 25, letterSpacing: '-0.02em', margin: 0 }}>
          Lessons
        </h1>
        <p style={{ color: 'var(--ink-3)', fontSize: 13.5, margin: '4px 0 0' }}>
          {lessons.length === 0
            ? 'Nothing posted for your section yet.'
            : `${lessons.length} lesson${lessons.length !== 1 ? 's' : ''} for ${selectedSection} · ${doneCount} done`}
        </p>
      </div>

      {loadError && (
        <div className="card" style={{ padding: '14px 18px', marginBottom: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
          <Icon name="alert" size={16} color="var(--warn)" />
          <span style={{ fontSize: 13.5, color: 'var(--ink-2)' }}>{loadError}</span>
        </div>
      )}

      {lessons.length === 0 && !loadError && (
        <div className="card" style={{ padding: '44px 24px', textAlign: 'center' }}>
          <Icon name="book" size={30} color="var(--ink-4)" />
          <p style={{ color: 'var(--ink-3)', margin: '12px 0 0', fontSize: 14 }}>
            Your instructor hasn&apos;t posted any lessons yet.
          </p>
        </div>
      )}

      {[...bySubject.entries()].map(([key, group]) => (
        <div key={key} style={{ marginBottom: 26 }}>
          <h2 style={{
            fontSize: 11.5, letterSpacing: '.09em', textTransform: 'uppercase',
            color: 'var(--ink-4)', fontWeight: 700, margin: '0 0 10px',
          }}>
            {subjectTitle(key)}
          </h2>

          <div style={{ display: 'grid', gap: 10 }}>
            {group.map(l => {
              const p = progress[l.id];
              return (
                <button
                  key={l.id}
                  className="card"
                  onClick={() => openLesson(l)}
                  style={{
                    padding: '16px 18px', textAlign: 'left', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 14, width: '100%',
                    border: '1px solid var(--line)', background: 'var(--surface)',
                  }}
                >
                  <div style={{
                    width: 34, height: 34, borderRadius: 'var(--r-md)', flexShrink: 0,
                    display: 'grid', placeItems: 'center',
                    background: p?.completed_at ? 'var(--ok-bg)' : 'var(--navy-tint)',
                    color: p?.completed_at ? 'var(--ok)' : 'var(--navy)',
                  }}>
                    <Icon name={p?.completed_at ? 'check' : 'book'} size={16} />
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14.5, color: 'var(--ink-1)' }}>{l.title}</div>
                    <div style={{ fontSize: 12.5, color: 'var(--ink-4)', marginTop: 2 }}>
                      {p?.completed_at ? 'Completed' : p ? 'Opened' : 'Not started'}
                    </div>
                  </div>

                  <Icon name="chevron-right" size={16} color="var(--ink-4)" />
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

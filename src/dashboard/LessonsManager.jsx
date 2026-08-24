import { useState, useEffect } from 'react';
import Icon from '../components/Icon';
import LessonContent from '../components/LessonContent';
import { supabase } from '../supabase';

// PostgREST caps responses at 1000 rows; page rather than silently truncate.
// Same reason as fetchAllRows() in AdminDashboard.jsx — see that comment.
const PAGE_SIZE = 500;
async function fetchAllRows(buildQuery) {
  const all = [];
  for (;;) {
    const { data, error } = await buildQuery()
      .order('id', { ascending: true })
      .range(all.length, all.length + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return all;
}

const EMPTY = {
  title: '', content_md: '', target_section: '', subject_id: '', is_published: false,
};

export default function LessonsManager({ instructorId, instructorSections = [] }) {
  const [lessons, setLessons] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [editing, setEditing] = useState(null); // null | {id?, ...fields}
  const [isSaving, setIsSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [filter, setFilter] = useState('all'); // all | published | draft

  // Pure IO — no setState — so both the mount effect and the manual reload
  // can share it without the effect calling a state-setting function.
  const fetchAll = async () => {
    const [ls, ss] = await Promise.all([
      fetchAllRows(() => supabase.from('lessons')
        .select('id, subject_id, title, content_md, target_section, instructor_id, is_published, published_at, created_at, updated_at')),
      fetchAllRows(() => supabase.from('lesson_subjects')
        .select('id, title, target_section, instructor_id, sort_order')),
    ]);
    return { ls, ss };
  };

  // The lessons tables only exist after sql/001_assessments_and_lessons.sql has
  // been run. Say that plainly rather than rendering an empty list, which reads
  // as "you have no lessons" and sends people hunting for the wrong problem.
  const describeError = (err) =>
    /schema cache|does not exist|not find the table/i.test(err?.message || '')
      ? 'The lessons tables do not exist yet. Run sql/001_assessments_and_lessons.sql in the Supabase SQL editor, then reload.'
      : (err?.message || 'Could not load lessons.');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { ls, ss } = await fetchAll();
        if (cancelled) return;
        setLessons(ls); setSubjects(ss); setLoadError('');
      } catch (err) {
        console.error('Failed to load lessons:', err);
        if (!cancelled) setLoadError(describeError(err));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const reload = async () => {
    try {
      const { ls, ss } = await fetchAll();
      setLessons(ls); setSubjects(ss); setLoadError('');
    } catch (err) {
      console.error('Failed to reload lessons:', err);
      setLoadError(describeError(err));
    }
  };

  const save = async () => {
    if (!editing?.title?.trim()) return alert('Give the lesson a title.');
    setIsSaving(true);
    const row = {
      title: editing.title.trim(),
      content_md: editing.content_md || '',
      target_section: (editing.target_section || '').trim(),
      subject_id: editing.subject_id || null,
      is_published: !!editing.is_published,
      // Stamp published_at the first time it goes live, and leave it alone after.
      published_at: editing.is_published ? (editing.published_at || new Date().toISOString()) : null,
    };

    let error;
    if (editing.id) {
      ({ error } = await supabase.from('lessons').update(row).eq('id', editing.id));
    } else {
      ({ error } = await supabase.from('lessons').insert([{ ...row, instructor_id: instructorId }]));
    }
    setIsSaving(false);
    if (error) return alert('Save failed: ' + error.message);
    setEditing(null);
    setShowPreview(false);
    reload();
  };

  const togglePublish = async (lesson) => {
    const next = !lesson.is_published;
    const { error } = await supabase.from('lessons').update({
      is_published: next,
      published_at: next ? (lesson.published_at || new Date().toISOString()) : null,
    }).eq('id', lesson.id);
    if (error) return alert('Could not change publish state: ' + error.message);
    setLessons(prev => prev.map(l => l.id === lesson.id ? { ...l, is_published: next } : l));
  };

  const remove = async (lesson) => {
    if (!window.confirm(`Delete "${lesson.title}" permanently?\n\nStudents will lose access and their read progress for this lesson is removed too.`)) return;
    const { error } = await supabase.from('lessons').delete().eq('id', lesson.id);
    if (error) return alert('Delete failed: ' + error.message);
    setLessons(prev => prev.filter(l => l.id !== lesson.id));
  };

  const visible = lessons.filter(l =>
    filter === 'all' ? true : filter === 'published' ? l.is_published : !l.is_published
  );

  const subjectName = (id) => subjects.find(s => s.id === id)?.title || '—';

  if (isLoading) {
    return <div style={{ padding: 24, color: 'var(--ink-3)' }}>Loading lessons…</div>;
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 26, letterSpacing: '-0.02em' }}>Lessons</h1>
          <p style={{ color: 'var(--ink-3)', margin: '4px 0 0', fontSize: 13.5 }}>
            Post reading material for your sections. Students see published lessons only.
          </p>
        </div>
        <button className="btn sm" style={{ width: 'auto' }} onClick={() => { setEditing({ ...EMPTY }); setShowPreview(false); }}>
          <Icon name="plus" size={14} /> New lesson
        </button>
      </div>

      {loadError && (
        <div style={{ background: 'var(--warn-bg)', border: '1.5px solid var(--warn-bd)', borderRadius: 'var(--r-lg)', padding: '12px 16px', marginBottom: 16, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <Icon name="alert" size={16} color="#B8860B" />
          <span style={{ fontSize: 13.5, color: '#7B5800' }}>{loadError}</span>
        </div>
      )}

      {/* Filters */}
      <div className="card" style={{ padding: '12px 16px', marginBottom: 16, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {[['all', 'All'], ['published', 'Published'], ['draft', 'Drafts']].map(([id, label]) => (
          <button
            key={id}
            className={`btn sm ${filter === id ? '' : 'ghost'}`}
            style={{ width: 'auto' }}
            onClick={() => setFilter(id)}
          >
            {label}
          </button>
        ))}
        <span className="px-pill brand" style={{ marginLeft: 'auto' }}>
          {visible.length} lesson{visible.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* List */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="table-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>Lesson</th><th>Subject</th><th>Sections</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr><td colSpan="5" style={{ padding: 24, textAlign: 'center', color: 'var(--ink-4)' }}>
                  {loadError ? 'Nothing to show.' : 'No lessons yet — create one to get started.'}
                </td></tr>
              ) : visible.map(l => (
                <tr key={l.id}>
                  <td style={{ fontWeight: 600 }}>{l.title}</td>
                  <td style={{ color: 'var(--ink-2)' }}>{subjectName(l.subject_id)}</td>
                  <td>
                    {(l.target_section || '').trim()
                      ? (l.target_section || '').split(',').map(s => s.trim()).filter(Boolean)
                          .map(s => <span key={s} className="px-pill brand" style={{ marginRight: 4 }}>{s}</span>)
                      : <span style={{ color: 'var(--ink-4)', fontSize: 12.5 }}>All sections</span>}
                  </td>
                  <td>
                    <span className="px-pill" style={{
                      background: l.is_published ? 'var(--ok-bg)' : 'var(--surface-2)',
                      color: l.is_published ? 'var(--ok)' : 'var(--ink-3)',
                      border: `1px solid ${l.is_published ? 'var(--ok-bd)' : 'var(--line)'}`,
                    }}>
                      {l.is_published ? 'Published' : 'Draft'}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="btn ghost sm" style={{ width: 'auto', marginRight: 6 }}
                      onClick={() => togglePublish(l)}>
                      <Icon name={l.is_published ? 'eye-off' : 'check-circle'} size={14} />
                      {l.is_published ? 'Unpublish' : 'Publish'}
                    </button>
                    <button className="btn ghost sm" style={{ width: 'auto', marginRight: 6 }}
                      onClick={() => { setEditing({ ...l }); setShowPreview(false); }}>
                      <Icon name="pencil" size={14} /> Edit
                    </button>
                    <button className="btn ghost sm" style={{ width: 'auto' }} onClick={() => remove(l)}>
                      <Icon name="trash" size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Editor */}
      {editing && (
        // Matches the inline overlay pattern used by the other dashboard modals
        // (AdminDashboard.jsx:3307) — there is no .modal class in this codebase.
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(6,24,41,.88)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, padding: 20 }}
          onClick={e => { if (e.target === e.currentTarget) setEditing(null); }}
        >
          <div className="card" style={{ maxWidth: 900, width: '95vw', maxHeight: '92vh', overflowY: 'auto', padding: 22 }}>
            <h3 style={{ marginTop: 0 }}>{editing.id ? 'Edit lesson' : 'New lesson'}</h3>

            <label className="label">Title</label>
            <input className="input" value={editing.title}
              onChange={e => setEditing({ ...editing, title: e.target.value })}
              placeholder="e.g. Bernoulli's Principle" />

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 240px' }}>
                <label className="label">Subject (optional)</label>
                <select className="input" value={editing.subject_id || ''}
                  onChange={e => setEditing({ ...editing, subject_id: e.target.value })}>
                  <option value="">— none —</option>
                  {subjects.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
                </select>
              </div>
              <div style={{ flex: '1 1 240px' }}>
                <label className="label">Sections — comma separated, blank = everyone</label>
                <input className="input" value={editing.target_section || ''}
                  onChange={e => setEditing({ ...editing, target_section: e.target.value })}
                  placeholder={instructorSections.slice(0, 2).join(', ') || 'AENG 426, AENG 223L'} />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
              <label className="label" style={{ margin: 0 }}>Content — markdown</label>
              <button className="btn ghost sm" style={{ width: 'auto' }} onClick={() => setShowPreview(p => !p)}>
                <Icon name={showPreview ? 'edit' : 'eye'} size={14} /> {showPreview ? 'Write' : 'Preview'}
              </button>
            </div>

            {showPreview ? (
              <div className="card" style={{ padding: 16, minHeight: 260, maxHeight: '45vh', overflowY: 'auto' }}>
                <LessonContent markdown={editing.content_md} />
              </div>
            ) : (
              <textarea
                className="input"
                style={{ minHeight: 260, fontFamily: 'var(--font-mono)', fontSize: 13, lineHeight: 1.55, resize: 'vertical' }}
                value={editing.content_md || ''}
                onChange={e => setEditing({ ...editing, content_md: e.target.value })}
                placeholder={'# Heading\n\nText with **bold**, a formula $E = mc^2$, and a list:\n\n- point one\n- point two\n\nPaste a YouTube link on its own line to embed it.'}
              />
            )}

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 13.5 }}>
              <input type="checkbox" checked={!!editing.is_published}
                onChange={e => setEditing({ ...editing, is_published: e.target.checked })} />
              Published — visible to students in the targeted sections
            </label>

            <div style={{ display: 'flex', gap: 8, marginTop: 18, justifyContent: 'flex-end' }}>
              <button className="btn ghost" style={{ width: 'auto' }} onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn" style={{ width: 'auto' }} onClick={save} disabled={isSaving}>
                {isSaving ? 'Saving…' : 'Save lesson'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

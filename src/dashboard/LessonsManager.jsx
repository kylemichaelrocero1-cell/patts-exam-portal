import { useState, useEffect } from 'react';
import Icon from '../components/Icon';
import LessonContent from '../components/LessonContent';
import { supabase } from '../supabase';
import {
  LESSON_BUCKET, LESSON_COLUMNS_INSTRUCTOR, makeLessonReader, isMissingColumnError,
  validateLessonFile, lessonFilePath, storagePathFromUrl, formatFileSize,
  MAX_LESSON_FILE_BYTES,
} from '../lib/lessonMaterial';

// One reader per module, so the "has this database been migrated" probe
// happens once per session rather than once per reload of the list.
const lessonReader = makeLessonReader((table) => supabase.from(table));

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
  material_type: 'typed', file_url: null, file_name: null, file_size: null,
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

  // False on a database where sql/006 has not been run: the PDF option is
  // offered but disabled, rather than failing at save time with a Postgres
  // error nobody can act on.
  const [materialReady, setMaterialReady] = useState(true);
  const [pendingFile, setPendingFile] = useState(null); // chosen, not yet uploaded
  const [isUploading, setIsUploading] = useState(false);

  // Pure IO — no setState — so both the mount effect and the manual reload
  // can share it without the effect calling a state-setting function.
  const fetchAll = async () => {
    // Lessons go through the reader (material columns, falling back to the
    // pre-migration set) so paging has to be done around it rather than with
    // fetchAllRows, which builds the query itself.
    const pageLessons = async () => {
      const all = [];
      for (;;) {
        const rows = await lessonReader.select(LESSON_COLUMNS_INSTRUCTOR, q =>
          q.order('id', { ascending: true }).range(all.length, all.length + PAGE_SIZE - 1));
        all.push(...rows);
        if (rows.length < PAGE_SIZE) break;
      }
      return all;
    };
    const [ls, ss] = await Promise.all([
      pageLessons(),
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
        setMaterialReady(lessonReader.hasMaterial !== false);
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
      setMaterialReady(lessonReader.hasMaterial !== false);
    } catch (err) {
      console.error('Failed to reload lessons:', err);
      setLoadError(describeError(err));
    }
  };

  // Best-effort: an orphaned file costs a little storage, a failed delete must
  // never block the save the instructor actually asked for.
  const removeStoredFile = async (url) => {
    const path = storagePathFromUrl(url);
    if (!path) return;
    try { await supabase.storage.from(LESSON_BUCKET).remove([path]); } catch { /* ignore */ }
  };

  const chooseFile = (file) => {
    if (!file) return;
    const problem = validateLessonFile(file);
    if (problem) return alert(problem);
    setPendingFile(file);
  };

  const save = async () => {
    if (!editing?.title?.trim()) return alert('Give the lesson a title.');
    const isPdf = editing.material_type === 'pdf';
    if (isPdf && !pendingFile && !editing.file_url) {
      return alert('Choose the PDF to post, or switch back to a typed lesson.');
    }
    setIsSaving(true);

    let fileUrl = editing.file_url || null;
    let fileName = editing.file_name || null;
    let fileSize = editing.file_size ?? null;

    // Upload first: if this fails there is nothing to undo, whereas saving the
    // row first would leave a lesson pointing at a file that never arrived.
    if (isPdf && pendingFile) {
      setIsUploading(true);
      const seed = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const path = `${instructorId || 'shared'}/${lessonFilePath(pendingFile.name, seed)}`;
      const { error: upErr } = await supabase.storage.from(LESSON_BUCKET)
        .upload(path, pendingFile, { upsert: false, contentType: 'application/pdf' });
      setIsUploading(false);
      if (upErr) {
        setIsSaving(false);
        return alert(
          /bucket|not found/i.test(upErr.message || '')
            ? 'The lesson-files bucket does not exist yet. Run sql/006_lesson_pdf_material.sql in the Supabase SQL editor, then try again.'
            : 'Could not upload the PDF: ' + upErr.message);
      }
      fileUrl = supabase.storage.from(LESSON_BUCKET).getPublicUrl(path).data.publicUrl;
      fileName = pendingFile.name;
      fileSize = pendingFile.size;
    }

    const row = {
      title: editing.title.trim(),
      content_md: editing.content_md || '',
      target_section: (editing.target_section || '').trim(),
      subject_id: editing.subject_id || null,
      is_published: !!editing.is_published,
      // Stamp published_at the first time it goes live, and leave it alone after.
      published_at: editing.is_published ? (editing.published_at || new Date().toISOString()) : null,
    };
    // A pre-migration database has none of these columns; sending them would
    // fail the whole save on a typed lesson that never needed them.
    if (materialReady) {
      row.material_type = isPdf ? 'pdf' : 'typed';
      row.file_url = isPdf ? fileUrl : null;
      row.file_name = isPdf ? fileName : null;
      row.file_size = isPdf ? fileSize : null;
    }

    let error;
    if (editing.id) {
      ({ error } = await supabase.from('lessons').update(row).eq('id', editing.id));
    } else {
      ({ error } = await supabase.from('lessons').insert([{ ...row, instructor_id: instructorId }]));
    }
    setIsSaving(false);
    if (error) {
      // Don't leave the upload behind for a row that was never written.
      if (isPdf && pendingFile && fileUrl) await removeStoredFile(fileUrl);
      if (isMissingColumnError(error)) {
        setMaterialReady(false);
        return alert('Posting material as a PDF needs sql/006_lesson_pdf_material.sql to be run in the Supabase SQL editor first. The typed lesson still saves normally.');
      }
      return alert('Save failed: ' + error.message);
    }

    // The file the lesson no longer points at: replaced, or dropped when the
    // instructor switched back to a typed lesson.
    const stale = editing.file_url && editing.file_url !== fileUrl ? editing.file_url
                : (!isPdf ? editing.file_url : null);
    if (stale) await removeStoredFile(stale);

    setEditing(null);
    setPendingFile(null);
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
    if (lesson.file_url) await removeStoredFile(lesson.file_url);
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
            Post reading material for your sections — typed, or as a PDF handout. Students see published lessons only.
          </p>
        </div>
        <button className="btn sm" style={{ width: 'auto' }} onClick={() => { setEditing({ ...EMPTY }); setPendingFile(null); setShowPreview(false); }}>
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
                  <td style={{ fontWeight: 600 }}>
                    {l.title}
                    {l.material_type === 'pdf' && (
                      <span className="px-pill" style={{ marginLeft: 8, fontWeight: 600 }}>
                        <Icon name="file-text" size={10} style={{ marginRight: 3 }} /> PDF
                      </span>
                    )}
                  </td>
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
                      onClick={() => { setEditing({ ...l }); setPendingFile(null); setShowPreview(false); }}>
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

            <label className="label" style={{ marginTop: 14 }}>How is this posted?</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                className={`btn sm ${editing.material_type === 'pdf' ? 'ghost' : ''}`}
                style={{ width: 'auto' }}
                onClick={() => setEditing({ ...editing, material_type: 'typed' })}
              >
                <Icon name="edit" size={14} /> Typed lesson
              </button>
              <button
                className={`btn sm ${editing.material_type === 'pdf' ? '' : 'ghost'}`}
                style={{ width: 'auto', opacity: materialReady ? 1 : 0.5 }}
                disabled={!materialReady}
                onClick={() => setEditing({ ...editing, material_type: 'pdf' })}
              >
                <Icon name="file-text" size={14} /> PDF file
              </button>
              {!materialReady && (
                <span style={{ fontSize: 12.5, color: 'var(--ink-4)', alignSelf: 'center' }}>
                  Run sql/006_lesson_pdf_material.sql in Supabase to enable PDF posting.
                </span>
              )}
            </div>

            {editing.material_type === 'pdf' && (
              <div className="card" style={{ padding: 14, marginTop: 10, background: 'var(--surface-2)' }}>
                {(pendingFile || editing.file_url) ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <Icon name="file-text" size={18} color="var(--navy)" />
                    <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13.5, overflowWrap: 'anywhere' }}>
                        {pendingFile ? pendingFile.name : editing.file_name || 'Posted PDF'}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--ink-4)' }}>
                        {formatFileSize(pendingFile ? pendingFile.size : editing.file_size)}
                        {pendingFile ? ' · uploads when you save' : ''}
                      </div>
                    </div>
                    {!pendingFile && editing.file_url && (
                      <a className="btn ghost sm" style={{ width: 'auto' }}
                        href={editing.file_url} target="_blank" rel="noopener noreferrer">
                        <Icon name="external" size={13} /> View
                      </a>
                    )}
                    <label className="btn ghost sm" style={{ width: 'auto', cursor: 'pointer', margin: 0 }}>
                      <Icon name="upload" size={13} /> {pendingFile ? 'Choose another' : 'Replace'}
                      <input type="file" accept="application/pdf,.pdf" style={{ display: 'none' }}
                        onChange={e => { chooseFile(e.target.files?.[0]); e.target.value = ''; }} />
                    </label>
                    {pendingFile && (
                      <button className="btn ghost sm" style={{ width: 'auto' }} onClick={() => setPendingFile(null)}>
                        <Icon name="x" size={13} /> Cancel
                      </button>
                    )}
                  </div>
                ) : (
                  <label style={{ display: 'block', cursor: 'pointer', textAlign: 'center', padding: '18px 12px' }}>
                    <Icon name="upload" size={22} color="var(--ink-4)" />
                    <div style={{ fontWeight: 600, fontSize: 13.5, marginTop: 8 }}>Choose a PDF</div>
                    <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 2 }}>
                      Up to {formatFileSize(MAX_LESSON_FILE_BYTES)} · students can read it in the portal or download it
                    </div>
                    <input type="file" accept="application/pdf,.pdf" style={{ display: 'none' }}
                      onChange={e => { chooseFile(e.target.files?.[0]); e.target.value = ''; }} />
                  </label>
                )}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
              <label className="label" style={{ margin: 0 }}>
                {editing.material_type === 'pdf' ? 'Notes — markdown, optional, shown above the PDF' : 'Content — markdown'}
              </label>
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
                placeholder={editing.material_type === 'pdf'
                  ? 'Optional — what to read, what to focus on, when it is due.'
                  : '# Heading\n\nText with **bold**, a formula $E = mc^2$, and a list:\n\n- point one\n- point two\n\nPaste a YouTube link on its own line to embed it.'}
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
                {isUploading ? 'Uploading PDF…' : isSaving ? 'Saving…' : 'Save lesson'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

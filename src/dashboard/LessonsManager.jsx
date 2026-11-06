import { useState, useEffect } from 'react';
import Icon from '../components/Icon';
import LessonContent from '../components/LessonContent';
import InteractiveLesson from '../components/InteractiveLesson';
import SectionPicker from '../components/SectionPicker';
import { supabase } from '../supabase';
import {
  LESSON_BUCKET, LESSON_COLUMNS_INSTRUCTOR, makeLessonReader, isMissingColumnError,
  FILE_MATERIALS, needsInteractiveMigration, lessonFilePath, storagePathFromUrl, formatFileSize,
} from '../lib/lessonMaterial';
import { isMissingFunctionError } from '../lib/assessmentsCore';

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

export default function LessonsManager({ instructorId, instructorSections = [], onTrashed }) {
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
  const [showFilePreview, setShowFilePreview] = useState(false);

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
    const problem = FILE_MATERIALS[editing.material_type].validate(file);
    if (problem) return alert(problem);
    setPendingFile(file);
    setShowFilePreview(false);
  };

  // Switching kind drops a chosen file: a PDF cannot post as a page. A file
  // already saved comes back with `keptFile` if they switch back.
  const setMaterial = (kind) => {
    if (kind === editing.material_type) return;
    setEditing({ ...editing, material_type: kind });
    setPendingFile(null);
    setShowFilePreview(false);
  };

  // The saved file, while it still suits the kind selected. Saved as a PDF and
  // switched to interactive, the old file is not what the lesson will show.
  const savedLesson = editing?.id ? lessons.find(l => l.id === editing.id) : null;
  const keptFile = savedLesson?.file_url && savedLesson.material_type === editing?.material_type
    ? savedLesson : null;

  const save = async () => {
    if (!editing?.title?.trim()) return alert('Give the lesson a title.');
    const fileMaterial = FILE_MATERIALS[editing.material_type] || null;
    const isInteractive = editing.material_type === 'interactive';
    if (fileMaterial && !pendingFile && !keptFile) {
      return alert(`Choose the ${fileMaterial.label} to post, or switch back to a typed lesson.`);
    }
    setIsSaving(true);

    let fileUrl = keptFile?.file_url || null;
    let fileName = keptFile?.file_name || null;
    let fileSize = keptFile?.file_size ?? null;

    // Upload first: if this fails there is nothing to undo, whereas saving the
    // row first would leave a lesson pointing at a file that never arrived.
    if (fileMaterial && pendingFile) {
      setIsUploading(true);
      const seed = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const path = `${instructorId || 'shared'}/${lessonFilePath(pendingFile.name, seed, fileMaterial.extension)}`;
      const { error: upErr } = await supabase.storage.from(LESSON_BUCKET)
        .upload(path, pendingFile, { upsert: false, contentType: fileMaterial.contentType });
      setIsUploading(false);
      if (upErr) {
        setIsSaving(false);
        if (isInteractive && needsInteractiveMigration(upErr)) {
          return alert('Interactive lessons need sql/147_interactive_lessons.sql to be run in the Supabase SQL editor first. Nothing was saved.');
        }
        return alert(
          /bucket|not found/i.test(upErr.message || '')
            ? 'The lesson-files bucket does not exist yet. Run sql/006_lesson_pdf_material.sql in the Supabase SQL editor, then try again.'
            : `Could not upload the ${fileMaterial.label}: ` + upErr.message);
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
      row.material_type = fileMaterial ? editing.material_type : 'typed';
      row.file_url = fileMaterial ? fileUrl : null;
      row.file_name = fileMaterial ? fileName : null;
      row.file_size = fileMaterial ? fileSize : null;
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
      if (fileMaterial && pendingFile && fileUrl) await removeStoredFile(fileUrl);
      if (isInteractive && needsInteractiveMigration(error)) {
        return alert('Interactive lessons need sql/147_interactive_lessons.sql to be run in the Supabase SQL editor first. Nothing was saved.');
      }
      if (isMissingColumnError(error)) {
        setMaterialReady(false);
        return alert('Posting material as a PDF needs sql/006_lesson_pdf_material.sql to be run in the Supabase SQL editor first. The typed lesson still saves normally.');
      }
      return alert('Save failed: ' + error.message);
    }

    // The file the lesson no longer points at: replaced, or dropped when the
    // instructor switched back to a typed lesson.
    const stale = savedLesson?.file_url && savedLesson.file_url !== (fileMaterial ? fileUrl : null)
      ? savedLesson.file_url : null;
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
    if (!window.confirm(`Move "${lesson.title}" to the Trash?\n\nStudents lose access now. You can restore it from the Trash for 30 days, with its file and their read progress; after that it is deleted for good.`)) return;
    // The stored file stays: Restore brings the lesson back with it (sql/139).
    const { data, error } = await supabase.rpc('trash_lesson', { p_lesson: lesson.id });
    if (error) {
      console.error('Could not move lesson to the Trash:', error);
      return alert(isMissingFunctionError(error)
        ? 'Deleting lessons needs a database update (sql/139) that has not been run yet. Nothing was changed.'
        : 'Could not delete this lesson. Nothing was changed — please try again.');
    }
    if (data === 'not_yours') return alert('Only the instructor who owns this lesson can delete it.');
    setLessons(prev => prev.filter(l => l.id !== lesson.id));
    onTrashed?.();
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
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
        <button className="btn sm" style={{ width: 'auto' }} onClick={() => { setEditing({ ...EMPTY }); setPendingFile(null); setShowPreview(false); setShowFilePreview(false); }}>
          <Icon name="plus" size={14} /> New lesson
        </button>
      </div>

      {loadError && (
        <div style={{ background: 'var(--warn-bg)', border: '1.5px solid var(--warn-bd)', borderRadius: 'var(--r-lg)', padding: '12px 16px', marginBottom: 16, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <Icon name="alert" size={16} color="var(--warn)" />
          <span style={{ fontSize: 13.5, color: 'var(--warn)' }}>{loadError}</span>
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
                    {l.material_type === 'interactive' && (
                      <span className="px-pill" style={{ marginLeft: 8, fontWeight: 600 }}>
                        <Icon name="sliders" size={10} style={{ marginRight: 3 }} /> Interactive
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
                      onClick={() => { setEditing({ ...l }); setPendingFile(null); setShowPreview(false); setShowFilePreview(false); }}>
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
                <label className="label">Sections — none = everyone</label>
                <SectionPicker
                  value={editing.target_section || ''}
                  onChange={next => setEditing({ ...editing, target_section: next })}
                  options={instructorSections}
                  placeholder="Everyone"
                />
              </div>
            </div>

            <label className="label" style={{ marginTop: 14 }}>How is this posted?</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                className={`btn sm ${editing.material_type === 'typed' ? '' : 'ghost'}`}
                style={{ width: 'auto' }}
                onClick={() => setMaterial('typed')}
              >
                <Icon name="edit" size={14} /> Typed lesson
              </button>
              <button
                className={`btn sm ${editing.material_type === 'pdf' ? '' : 'ghost'}`}
                style={{ width: 'auto', opacity: materialReady ? 1 : 0.5 }}
                disabled={!materialReady}
                onClick={() => setMaterial('pdf')}
              >
                <Icon name="file-text" size={14} /> PDF file
              </button>
              <button
                className={`btn sm ${editing.material_type === 'interactive' ? '' : 'ghost'}`}
                style={{ width: 'auto', opacity: materialReady ? 1 : 0.5 }}
                disabled={!materialReady}
                onClick={() => setMaterial('interactive')}
              >
                <Icon name="sliders" size={14} /> Interactive
              </button>
              {!materialReady && (
                <span style={{ fontSize: 12.5, color: 'var(--ink-4)', alignSelf: 'center' }}>
                  Run sql/006_lesson_pdf_material.sql in Supabase to enable PDF posting.
                </span>
              )}
            </div>

            {FILE_MATERIALS[editing.material_type] && (() => {
              const material = FILE_MATERIALS[editing.material_type];
              const isPage = editing.material_type === 'interactive';
              const picker = (
                <input type="file" accept={material.accept} style={{ display: 'none' }}
                  onChange={e => { chooseFile(e.target.files?.[0]); e.target.value = ''; }} />
              );
              return (
                <div className="card" style={{ padding: 14, marginTop: 10, background: 'var(--surface-2)' }}>
                  {(pendingFile || keptFile) ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <Icon name={isPage ? 'sliders' : 'file-text'} size={18} color="var(--navy)" />
                      <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13.5, overflowWrap: 'anywhere' }}>
                          {pendingFile ? pendingFile.name : keptFile.file_name || `Posted ${material.label}`}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--ink-4)' }}>
                          {formatFileSize(pendingFile ? pendingFile.size : keptFile.file_size)}
                          {pendingFile ? ' · uploads when you save' : ''}
                        </div>
                      </div>
                      {isPage && (
                        <button className="btn ghost sm" style={{ width: 'auto' }} onClick={() => setShowFilePreview(p => !p)}>
                          <Icon name={showFilePreview ? 'eye-off' : 'eye'} size={13} /> {showFilePreview ? 'Hide' : 'Try it'}
                        </button>
                      )}
                      {!isPage && !pendingFile && keptFile && (
                        <a className="btn ghost sm" style={{ width: 'auto' }}
                          href={keptFile.file_url} target="_blank" rel="noopener noreferrer">
                          <Icon name="external" size={13} /> View
                        </a>
                      )}
                      <label className="btn ghost sm" style={{ width: 'auto', cursor: 'pointer', margin: 0 }}>
                        <Icon name="upload" size={13} /> {pendingFile ? 'Choose another' : 'Replace'}
                        {picker}
                      </label>
                      {pendingFile && (
                        <button className="btn ghost sm" style={{ width: 'auto' }} onClick={() => { setPendingFile(null); setShowFilePreview(false); }}>
                          <Icon name="x" size={13} /> Cancel
                        </button>
                      )}
                    </div>
                  ) : (
                    <label style={{ display: 'block', cursor: 'pointer', textAlign: 'center', padding: '18px 12px' }}>
                      <Icon name="upload" size={22} color="var(--ink-4)" />
                      <div style={{ fontWeight: 600, fontSize: 13.5, marginTop: 8 }}>Choose a {material.label}</div>
                      <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 2 }}>
                        Up to {formatFileSize(material.maxBytes)}
                        {isPage ? ' · one self-contained page' : ' · students can read it in the portal or download it'}
                      </div>
                      {picker}
                    </label>
                  )}
                  {isPage && showFilePreview && (pendingFile || keptFile) && (
                    <div style={{ marginTop: 12, background: 'var(--surface)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
                      <InteractiveLesson
                        key={pendingFile ? pendingFile.name + pendingFile.size : keptFile.file_url}
                        file={pendingFile || undefined}
                        url={pendingFile ? undefined : keptFile.file_url}
                        title={editing.title || 'Lesson preview'}
                      />
                    </div>
                  )}
                </div>
              );
            })()}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
              <label className="label" style={{ margin: 0 }}>
                {editing.material_type === 'pdf' ? 'Notes — markdown, optional, shown above the PDF'
                  : editing.material_type === 'interactive' ? 'Notes — markdown, optional, shown above the page. A YouTube link embeds the video.'
                  : 'Content — markdown'}
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
                placeholder={editing.material_type !== 'typed'
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

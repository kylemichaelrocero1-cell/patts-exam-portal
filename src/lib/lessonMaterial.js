// ── Lesson material: typed markdown or an uploaded PDF ──────────────────
// A lesson is posted one of two ways. `typed` is the original markdown body.
// `pdf` is a file in the `lesson-files` bucket — the handout an instructor
// already has (AELP readings, printed modules) and should not have to retype.
// content_md stays available on a PDF lesson as optional notes above the file.
//
// No supabase import here on purpose, same reason as assessmentsCore.js:
// src/supabase.js reads import.meta.env, which only exists under Vite, so
// anything importing it cannot be unit-tested in Node.

export const LESSON_BUCKET = 'lesson-files';

// The material columns are added by sql/006_lesson_pdf_material.sql. Until
// that has been run by hand in the Supabase SQL editor, selecting them fails
// and takes the whole Lessons page with it — so every read asks for them and
// falls back to the base columns, exactly as the assessments reader does.
export const MATERIAL_COLUMNS = 'material_type, file_url, file_name, file_size';

export const LESSON_COLUMNS_INSTRUCTOR =
  'id, subject_id, title, content_md, target_section, instructor_id, ' +
  'is_published, published_at, created_at, updated_at';

export const LESSON_COLUMNS_STUDENT =
  'id, subject_id, title, content_md, target_section, is_published, published_at';

export const withMaterial = (columns) => `${columns}, ${MATERIAL_COLUMNS}`;

/**
 * True when the database simply has not been migrated yet. 42703 is the
 * SELECT case ("column lessons.material_type does not exist"); PGRST204 is the
 * INSERT/UPDATE case, where PostgREST reports it against its schema cache.
 */
export function isMissingColumnError(error) {
  if (!error) return false;
  if (error.code === '42703' || error.code === 'PGRST204') return true;
  const msg = error.message || '';
  return /(material_type|file_url|file_name|file_size)/.test(msg) &&
         /does not exist|schema cache/i.test(msg);
}

/** Everything downstream may assume these four fields exist. */
export function normalizeLessonRow(row) {
  return {
    ...row,
    material_type: row?.material_type === 'pdf' ? 'pdf' : 'typed',
    file_url: row?.file_url ?? null,
    file_name: row?.file_name ?? null,
    file_size: row?.file_size ?? null,
  };
}

/** A lesson only reads as a PDF when there is actually a file behind it. */
export function isPdfLesson(row) {
  return row?.material_type === 'pdf' && !!row?.file_url;
}

// ── Upload rules ────────────────────────────────────────────────────────
// 20MB is well inside Supabase's 50MB per-file default and about as much as a
// student on mobile data will tolerate. The same limit is set on the bucket in
// sql/006, so this check is a courtesy, not the enforcement.
export const MAX_LESSON_FILE_BYTES = 20 * 1024 * 1024;

export function formatFileSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Returns an error message for the instructor, or null when the file is fine. */
export function validateLessonFile(file) {
  if (!file) return 'Choose a PDF to upload.';
  const looksPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
  if (!looksPdf) return 'Only PDF files can be posted as material. Save the document as PDF and try again.';
  if (file.size > MAX_LESSON_FILE_BYTES) {
    return `That file is ${formatFileSize(file.size)} — the limit is ${formatFileSize(MAX_LESSON_FILE_BYTES)}. ` +
           'Split it or export it at a lower quality.';
  }
  return null;
}

/**
 * Storage key for an upload. The original name is kept (students see it as the
 * download name) but stripped of anything that could confuse a URL or a path,
 * and prefixed with a unique segment so two "Module 1.pdf" never collide.
 */
export function lessonFilePath(fileName, uniqueSeed) {
  const base = String(fileName || 'material.pdf').split(/[\\/]/).pop();
  const safe = base
    .replace(/\.pdf$/i, '')
    .replace(/[^A-Za-z0-9._ -]+/g, '-')
    .replace(/[\s-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 60) || 'material';
  return `${uniqueSeed}-${safe}.pdf`;
}

/**
 * The storage key behind a public URL, so a replaced or deleted file can be
 * removed instead of orphaned. Returns null for anything not in our bucket —
 * never guess, or a bad parse turns into a delete of the wrong object.
 */
export function storagePathFromUrl(url, bucket = LESSON_BUCKET) {
  if (!url) return null;
  const marker = `/${bucket}/`;
  const idx = String(url).indexOf(marker);
  if (idx === -1) return null;
  const path = String(url).slice(idx + marker.length).split('?')[0];
  if (!path) return null;
  try { return decodeURIComponent(path); } catch { return path; }
}

/**
 * Builds the lessons reader. `from` is supabase.from, injected so this is
 * testable in Node. The probe result is remembered, so a database without the
 * material columns costs one failed request per session, not one per read.
 */
export function makeLessonReader(from) {
  const api = {
    // null = not probed, true = migrated, false = pre-migration database
    hasMaterial: null,

    available() { return api.hasMaterial === true; },
    _reset(v = null) { api.hasMaterial = v; },

    async select(baseColumns, apply = (q) => q) {
      if (api.hasMaterial !== false) {
        const { data, error } = await apply(from('lessons').select(withMaterial(baseColumns)));
        if (!error) { api.hasMaterial = true; return (data || []).map(normalizeLessonRow); }
        if (!isMissingColumnError(error)) throw error;
        api.hasMaterial = false;
      }
      const { data, error } = await apply(from('lessons').select(baseColumns));
      if (error) throw error;
      return (data || []).map(normalizeLessonRow);
    },
  };
  return api;
}

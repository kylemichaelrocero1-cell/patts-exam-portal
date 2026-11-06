// ── Lesson material: typed markdown, an uploaded PDF, or an interactive page ─
// `typed` is the original markdown body. `pdf` is a file in the `lesson-files`
// bucket — the handout an instructor already has (AELP readings, printed
// modules) and should not have to retype. `interactive` is one self-contained
// .html file in the same bucket: graphs a student can move (sql/147).
// content_md stays available on both as optional notes above the file, which
// is also where a YouTube link goes.
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
    material_type: row?.material_type === 'pdf' || row?.material_type === 'interactive'
      ? row.material_type : 'typed',
    file_url: row?.file_url ?? null,
    file_name: row?.file_name ?? null,
    file_size: row?.file_size ?? null,
  };
}

/** A lesson only reads as a PDF when there is actually a file behind it. */
export function isPdfLesson(row) {
  return row?.material_type === 'pdf' && !!row?.file_url;
}

/** Same rule: an interactive lesson needs a file behind it. */
export function isInteractiveLesson(row) {
  return row?.material_type === 'interactive' && !!row?.file_url;
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

// An interactive page is code and text, so anything near this size is not one
// file of graphs. The bucket's own 20MB limit is the enforcement.
export const MAX_INTERACTIVE_FILE_BYTES = 5 * 1024 * 1024;

/** Returns an error message for the instructor, or null when the file is fine. */
export function validateInteractiveFile(file) {
  if (!file) return 'Choose the .html file to upload.';
  const looksHtml = file.type === 'text/html' || /\.html?$/i.test(file.name || '');
  if (!looksHtml) return 'Only an .html file can be posted as an interactive lesson.';
  if (file.size > MAX_INTERACTIVE_FILE_BYTES) {
    return `That file is ${formatFileSize(file.size)} — the limit is ${formatFileSize(MAX_INTERACTIVE_FILE_BYTES)}.`;
  }
  return null;
}

// What differs between the two kinds of uploaded material.
export const FILE_MATERIALS = {
  pdf: {
    label: 'PDF', extension: 'pdf', contentType: 'application/pdf', accept: 'application/pdf,.pdf',
    validate: validateLessonFile, maxBytes: MAX_LESSON_FILE_BYTES,
  },
  interactive: {
    label: 'HTML file', extension: 'html', contentType: 'text/html', accept: 'text/html,.html,.htm',
    validate: validateInteractiveFile, maxBytes: MAX_INTERACTIVE_FILE_BYTES,
  },
};

/**
 * True when saving or uploading an interactive lesson was refused because
 * sql/147 has not been run: the constraint on the row, or the bucket's type
 * list on the file. A permission error is neither, and must stay an error.
 */
export function needsInteractiveMigration(error) {
  if (!error) return false;
  if (error.code === '23514' && /material_type/.test(error.message || '')) return true;
  return /mime type/i.test(error.message || '');
}

/**
 * Storage key for an upload. The original name is kept (students see it as the
 * download name) but stripped of anything that could confuse a URL or a path,
 * and prefixed with a unique segment so two "Module 1.pdf" never collide.
 */
export function lessonFilePath(fileName, uniqueSeed, extension = 'pdf') {
  const base = String(fileName || `material.${extension}`).split(/[\\/]/).pop();
  const safe = base
    .replace(/\.(pdf|html?)$/i, '')
    .replace(/[^A-Za-z0-9._ -]+/g, '-')
    .replace(/[\s-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 60) || 'material';
  return `${uniqueSeed}-${safe}.${extension}`;
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

// ── Showing an interactive page ─────────────────────────────────────────
// An uploaded page runs in an iframe sandboxed to `allow-scripts` and nothing
// else, so it has an origin of its own: no reach into the portal, its storage or
// the student's session, no forms, no pop-ups, no leaving the frame. Do not add
// allow-same-origin: with srcdoc it would give the page the portal's own origin.
//
// The policy below adds that it cannot talk to the network either. Fonts are the
// one exception, from the host the portal already uses.
export const INTERACTIVE_SANDBOX = 'allow-scripts';

export const INTERACTIVE_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com data:',
  'img-src data: blob:',
  'media-src data: blob:',
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

// The page has no scrollbar of its own: the portal grows the frame to fit, so
// the student scrolls one page. This reports the height it needs.
const HEIGHT_REPORTER = `(function(){var last=0;function send(){var d=document.documentElement,b=document.body;if(!b)return;
var h=Math.ceil(Math.max(d.getBoundingClientRect().height,b.getBoundingClientRect().height,b.scrollHeight));
if(h!==last){last=h;parent.postMessage({type:'lesson-height',height:h},'*');}}
addEventListener('DOMContentLoaded',function(){send();if(window.ResizeObserver){var r=new ResizeObserver(send);r.observe(document.documentElement);r.observe(document.body);}});
addEventListener('load',send);})();`;

/**
 * The document handed to the sandboxed frame. Our lines go first so the policy
 * covers everything after it; the parser merges the file's own <html>, <head>
 * and doctype into what is already open, whatever order the file has them in.
 */
export function buildLessonDocument(html) {
  return `<!doctype html><meta charset="utf-8">`
    + `<meta http-equiv="Content-Security-Policy" content="${INTERACTIVE_CSP}">`
    + `<script>${HEIGHT_REPORTER}</script>\n${html ?? ''}`;
}

export const MAX_FRAME_HEIGHT = 30000;

/**
 * Reads a message from the frame. The page's code is not ours, so nothing in a
 * message is trusted: only the two known shapes, only finite numbers in range.
 * The caller must also check that the message came from its own frame.
 */
export function readLessonMessage(data) {
  if (!data || typeof data !== 'object') return null;
  if (data.type === 'lesson-height' && Number.isFinite(data.height)) {
    return { type: 'height', value: Math.min(MAX_FRAME_HEIGHT, Math.max(120, Math.ceil(data.height))) };
  }
  if (data.type === 'lesson-scroll' && Number.isFinite(data.top)) {
    return { type: 'scroll', value: Math.min(MAX_FRAME_HEIGHT, Math.max(0, data.top)) };
  }
  return null;
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

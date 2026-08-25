import { supabase } from '../supabase';
import { makeAssessmentReader, isMissingTableError } from './assessmentsCore';

// Thin wiring layer: the logic and the fallback live in assessmentsCore.js so
// they can be unit-tested in Node (src/supabase.js reads import.meta.env and
// only loads under Vite). One reader per session, so the "does assessments
// exist" probe happens at most once.
const reader = makeAssessmentReader((table) => supabase.from(table));

export const selectAssessments = (apply, opts) => reader.select(apply, opts);

// Instructor-side column sets: same as the student ones plus exam_password.
export const INSTRUCTOR_COLUMNS = {
  assessmentColumns:
    'id, kind, title, description, target_section, instructor_id, is_open, ' +
    'opens_at, closes_at, duration_minutes, has_password, exam_password, created_at, ' +
    'allow_retakes, show_answers, score_policy',
  examColumns:
    'id, title, description, target_section, instructor_id, is_open, ' +
    'duration_minutes, has_password, exam_password, created_at',
};
export const assessmentsTableAvailable = () => reader.available();

export {
  isAvailableNow,
  availabilityState,
  formatWindow,
  isMissingTableError,
  KIND_LABEL,
} from './assessmentsCore';

export const ASSESSMENT_STUDENT_COLUMNS =
  'id, title, duration_minutes, target_section, has_password, is_open, allow_retakes, show_answers';

// ── Writes ──────────────────────────────────────────────────────────────
// Mock exams are created straight into `assessments` and have no row in
// `exams`. An UPDATE aimed at `exams` therefore matches nothing, and
// PostgREST reports that as success — which is why toggling one Open
// appeared to work and silently reverted on refresh.
//
// So: write to `assessments` first, because that is what the app reads, and
// mirror to `exams` only to stop the legacy row drifting while it still
// exists. Zero rows updated is treated as an error rather than a success.

// Columns that exist on the legacy table. Anything newer (allow_retakes,
// show_answers, score_policy, opens_at, closes_at) must not be sent there.
const LEGACY_COLUMNS = new Set([
  'title', 'description', 'target_section', 'instructor_id',
  'is_open', 'duration_minutes', 'exam_password', 'has_password',
]);

export async function updateAssessment(id, patch) {
  const { data, error } = await supabase
    .from('assessments').update(patch).eq('id', id).select('id');
  if (error) throw error;

  if (!data || data.length === 0) {
    // Pre-migration database: assessments does not exist or lacks the row.
    const legacy = Object.fromEntries(
      Object.entries(patch).filter(([k]) => LEGACY_COLUMNS.has(k)));
    if (Object.keys(legacy).length === 0) {
      throw new Error('Nothing was updated. Run the pending SQL migrations.');
    }
    const r = await supabase.from('exams').update(legacy).eq('id', id).select('id');
    if (r.error) throw r.error;
    if (!r.data || r.data.length === 0) {
      throw new Error('Nothing was updated — this assessment may have been deleted.');
    }
    return;
  }

  // Best-effort mirror. A mock exam has no legacy row, so 0 rows here is
  // expected and not an error.
  const legacy = Object.fromEntries(
    Object.entries(patch).filter(([k]) => LEGACY_COLUMNS.has(k)));
  if (Object.keys(legacy).length > 0) {
    await supabase.from('exams').update(legacy).eq('id', id);
  }
}

export async function deleteAssessment(id) {
  const { error } = await supabase.from('assessments').delete().eq('id', id);
  if (error) throw error;
  // Deleting the legacy row would re-fire the sync trigger's DELETE branch,
  // which is harmless now the assessment is already gone.
  await supabase.from('exams').delete().eq('id', id);
}

/** Read one assessment, falling back to the legacy table. */
export async function fetchAssessmentById(id, columns = ASSESSMENT_STUDENT_COLUMNS) {
  const { data, error } = await supabase
    .from('assessments').select(columns).eq('id', id).maybeSingle();
  if (!error && data) return data;
  if (error && !isMissingTableError(error)) throw error;
  const legacy = columns.split(',').map(c => c.trim())
    .filter(c => LEGACY_COLUMNS.has(c) || c === 'id').join(', ');
  const r = await supabase.from('exams').select(legacy).eq('id', id).maybeSingle();
  if (r.error) throw r.error;
  return r.data ? { ...r.data, kind: 'exam', allow_retakes: false, show_answers: false } : null;
}


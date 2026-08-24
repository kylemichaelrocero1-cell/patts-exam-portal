import { supabase } from '../supabase';
import { makeAssessmentReader } from './assessmentsCore';

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
    'opens_at, closes_at, duration_minutes, has_password, exam_password, created_at',
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

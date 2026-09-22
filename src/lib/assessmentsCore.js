// ── Transitional data access (pure core) ────────────────────────────────
// No supabase import here on purpose: src/supabase.js reads import.meta.env,
// which only exists under Vite, so anything importing it cannot be unit-tested
// in Node. The client is injected instead — see assessments.js for the wiring.
//
// Phase 1 created `assessments` (exams + seatworks + scheduling), but the
// migration is applied by hand in the Supabase SQL editor, so at any moment the
// deployed app may be talking to a database that has it or one that does not.
//
// Rather than couple a deploy to a manual DDL step — on a live system, mid
// semester, where the wrong order means students cannot sit an exam — every
// read tries `assessments` and falls back to `exams`, normalised to the same
// shape. Before the migration, behaviour is exactly what it is today:
// everything is kind 'exam' with no schedule.
//
// REMOVE THE FALLBACK once the migration has run and `exams` is renamed away
// (see the PHASE-OUT block in sql/001_assessments_and_lessons.sql).

export const ASSESSMENT_COLUMNS =
  'id, kind, title, description, target_section, instructor_id, is_open, ' +
  'opens_at, closes_at, duration_minutes, has_password, created_at, archived_at, ' +
  'shuffle_questions, shuffle_choices, ' +
  // score_policy is deliberately absent: it governs what the instructor sees
  // and anon is not granted it (see sql/002b).
  'allow_retakes, show_answers';

// exams has no kind/opens_at/closes_at — anon is granted exactly these.
export const EXAM_COLUMNS =
  'id, title, description, target_section, instructor_id, is_open, ' +
  'duration_minutes, has_password, created_at';

export function isMissingTableError(error) {
  return /schema cache|does not exist|not find the table/i.test(error?.message || '');
}

/**
 * "This database has not had that migration yet" — as opposed to "the
 * function ran and said no".
 *
 * The distinction matters more than it looks. get_exam_questions() and
 * unlock_assessment() (sql/020) are the gate; when they refuse, the caller
 * must show the refusal, NOT quietly fall back to the old unguarded path —
 * that would hand back the very hole 020 closes. Only a function that is not
 * there at all earns the fallback, and only until 021 has run.
 *
 * PostgREST reports a missing routine as PGRST202; Postgres itself as 42883.
 */
export function isMissingFunctionError(error) {
  if (!error) return false;
  if (error.code === 'PGRST202' || error.code === '42883') return true;
  return /not find the function|function .* does not exist|schema cache/i
    .test(error.message || '');
}

export function normaliseExamRow(row) {
  return {
    ...row,
    kind: 'exam',          // everything in the old table is an exam by definition
    opens_at: null,        // no scheduling existed before assessments
    closes_at: null,
    allow_retakes: false,  // and no retakes or answer reveal
    show_answers: false,
    archived_at: null,     // and nothing there can be archived
    shuffle_questions: true,  // the old table has no switches; both default on
    shuffle_choices: true,
  };
}

/**
 * Builds the reader. `from` is supabase.from (injected so this is testable).
 * The probe result is remembered on the returned object, so a database without
 * `assessments` costs one failed request per session, not one per read.
 */
export function makeAssessmentReader(from) {
  const api = {
    // null = not probed, true = assessments exists, false = fall back to exams
    hasAssessments: null,

    available() { return api.hasAssessments === true; },
    _reset(v = null) { api.hasAssessments = v; },

    // Columns are overridable because the two callers need different ones:
    // instructors additionally read exam_password, which anon is deliberately
    // not granted. Passing the student column list by default means a mistake
    // here fails closed rather than leaking the password to every student.
    async select(apply = (q) => q, {
      assessmentColumns = ASSESSMENT_COLUMNS,
      examColumns = EXAM_COLUMNS,
    } = {}) {
      if (api.hasAssessments !== false) {
        const { data, error } = await apply(from('assessments').select(assessmentColumns));
        if (!error) { api.hasAssessments = true; return data || []; }
        if (!isMissingTableError(error)) throw error;
        api.hasAssessments = false;
      }
      const { data, error } = await apply(from('exams').select(examColumns));
      if (error) throw error;
      return (data || []).map(normaliseExamRow);
    },
  };
  return api;
}

// ── Availability ────────────────────────────────────────────────────────
// Mirrors public.assessment_is_available() in the migration. Both must agree:
// the server decides what a student may fetch, this decides what they are
// shown, and disagreement means a student sees a locked exam or misses an open
// one. Change them together — the test cross-checks against the real function.

export function isAvailableNow(a, now = new Date()) {
  // Archived beats everything: a put-away paper is unavailable however its
  // is_open happens to be set. Archiving closes it too, so this is the second
  // of two locks rather than the only one.
  if (a?.archived_at) return false;
  if (!a?.is_open) return false;
  const t = now.getTime();
  if (a.opens_at && t < new Date(a.opens_at).getTime()) return false;
  if (a.closes_at && t >= new Date(a.closes_at).getTime()) return false;
  return true;
}

/** Why an assessment is not takeable — drives the student-facing label. */
export function availabilityState(a, now = new Date()) {
  if (a?.archived_at) return 'archived';
  if (!a?.is_open) return 'closed';
  const t = now.getTime();
  if (a.opens_at && t < new Date(a.opens_at).getTime()) return 'scheduled';
  if (a.closes_at && t >= new Date(a.closes_at).getTime()) return 'expired';
  return 'open';
}

export function formatWindow(a) {
  const fmt = (iso) => new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
  if (a.opens_at && a.closes_at) return `${fmt(a.opens_at)} — ${fmt(a.closes_at)}`;
  if (a.opens_at) return `Opens ${fmt(a.opens_at)}`;
  if (a.closes_at) return `Closes ${fmt(a.closes_at)}`;
  return '';
}

export const KIND_LABEL = { exam: 'Exam', seatwork: 'Seatwork' };

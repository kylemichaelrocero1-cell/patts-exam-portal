-- =====================================================================
-- 107 — a paper may have no sets: students see one Start button instead
--       of Set A and Set B
--
-- Run in the Supabase SQL editor (runs as postgres). Idempotent. Run it
-- BEFORE the frontend that comes with it: the student and instructor
-- screens select uses_sets, and PostgREST refuses a select that names a
-- missing column — the whole exam list would fail.
--
-- A set is only a label. Questions and choices are shuffled per student
-- whichever set is picked, and nothing on the server reads it; it is
-- written on the sitting (live_sessions.exam_set) and shown on the exam
-- header. Where an instructor does not use sets, asking a student to choose
-- one only invites "which one do I press?". assessments.uses_sets (default
-- true, so every paper stays as it is) turns the choice off: the student
-- sees one Start button and the sitting carries no set.
-- =====================================================================

BEGIN;

ALTER TABLE public.assessments
  ADD COLUMN IF NOT EXISTS uses_sets boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN public.assessments.uses_sets IS
  'true: students choose Set A or Set B (a label only). false: one Start button, no set.';

-- Students read it to draw the right button; instructors read and switch it.
GRANT SELECT (uses_sets) ON public.assessments TO anon, authenticated;
GRANT UPDATE (uses_sets) ON public.assessments TO authenticated;

COMMIT;

-- =====================================================================
-- VERIFY — one row, every column true.
-- =====================================================================
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'assessments'
             AND column_name = 'uses_sets' AND column_default = 'true'
             AND is_nullable = 'NO')                                        AS column_ready,
  has_column_privilege('anon', 'public.assessments', 'uses_sets', 'SELECT') AS students_can_read_it,
  NOT has_column_privilege('anon', 'public.assessments', 'uses_sets', 'UPDATE') AS students_cannot_change_it,
  has_column_privilege('authenticated', 'public.assessments', 'uses_sets', 'UPDATE') AS instructors_can_switch_it;

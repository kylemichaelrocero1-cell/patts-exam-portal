-- =====================================================================
-- 015 — archiving an exam or quiz
--
-- Run in the Supabase SQL editor (runs as postgres). Idempotent.
-- Safe to run before the code that uses it is deployed: it is additive and
-- every existing row starts unarchived, which is today's behaviour exactly.
--
-- WHY
-- The dashboard lists every assessment an instructor owns, forever. After a
-- year of mock exams, finals, re-exams and quizzes that is dozens of rows,
-- and the ones that matter this week are buried among papers that were last
-- sat in 2025. Deleting is not the answer — `deleteExam` removes the
-- questions and the results with it, and a finished paper's scores are the
-- record of a semester.
--
-- So: archive. One nullable timestamp. NULL means active; a value means put
-- away, and records when.
--
-- WHAT ARCHIVING MEANS
--   * the instructor's list hides it by default, behind a "Show archived"
--     toggle. Nothing is deleted: questions, results and class review all
--     still work, and restoring is one click.
--   * students never see it. Archiving also closes the paper (the client
--     sets is_open = false in the same write), and on top of that an
--     archived assessment is treated as unavailable even if something were
--     to re-open it — see assessment_is_available below, and the matching
--     isAvailableNow() in src/lib/assessmentsCore.js.
--
-- WHY BOTH THE CLOSE AND THE AVAILABILITY RULE
-- Belt and braces, deliberately. Closing is what keeps it out of the
-- student's query, which filters on is_open. The availability rule is what
-- makes "archived" mean unavailable regardless of how is_open got set —
-- by an older build, a direct SQL edit, or a future bug.
--
-- ---------------------------------------------------------------------
-- REHEARSE IT FIRST (recommended)
--   1. Change  COMMIT;  near the bottom to  ROLLBACK;
--   2. Run the whole file and read the VERIFY output.
--   3. Change it back and run again for real.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 0. Sanity
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='assessments') THEN
    RAISE EXCEPTION 'public.assessments not found — run sql/001 first.';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1. The column
-- ---------------------------------------------------------------------
ALTER TABLE public.assessments
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

COMMENT ON COLUMN public.assessments.archived_at IS
  'NULL = active. Set = put away: hidden from the instructor list by default and never available to students. Nothing is deleted; clearing it restores the paper.';

-- Partial, because the common read is "the active ones" and archived rows
-- are the minority that never needs indexing.
CREATE INDEX IF NOT EXISTS assessments_active_idx
  ON public.assessments (instructor_id) WHERE archived_at IS NULL;

-- ---------------------------------------------------------------------
-- 2. Students must be able to see that it is archived
-- ---------------------------------------------------------------------
-- The student column list in assessmentsCore.js reads archived_at so the
-- client can apply the same availability rule the server does. anon is an
-- explicit allow-list (sql/001), so a new column is invisible until named.
GRANT SELECT (archived_at) ON public.assessments TO anon;

-- ---------------------------------------------------------------------
-- 3. Availability
-- ---------------------------------------------------------------------
-- The existing three-argument form is left exactly as it is: sql/test
-- pins it, and nothing in the app calls either version at runtime — they
-- exist so the server's definition of "available" is written down next to
-- the client's. This adds a four-argument form rather than changing that
-- signature, so both keep working.
CREATE OR REPLACE FUNCTION public.assessment_is_available(
  p_is_open boolean, p_opens_at timestamptz, p_closes_at timestamptz,
  p_archived_at timestamptz
) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT p_archived_at IS NULL
     AND p_is_open
     AND (p_opens_at  IS NULL OR now() >= p_opens_at)
     AND (p_closes_at IS NULL OR now() <  p_closes_at);
$$;

COMMENT ON FUNCTION public.assessment_is_available(boolean, timestamptz, timestamptz, timestamptz) IS
  'An assessment is available only when it is not archived, is_open, and now() is inside [opens_at, closes_at). Mirrored by isAvailableNow() in src/lib/assessmentsCore.js — change them together.';

COMMIT;

-- =====================================================================
-- VERIFY
-- =====================================================================

-- 1. The column exists and nothing is archived yet.
SELECT count(*) FILTER (WHERE archived_at IS NULL) AS active,
       count(*) FILTER (WHERE archived_at IS NOT NULL) AS archived,
       count(*) AS total
FROM public.assessments;
-- archived must be 0 immediately after this runs.

-- 2. anon can read it.
SELECT string_agg(column_name, ', ' ORDER BY column_name) AS anon_readable
FROM information_schema.column_privileges
WHERE grantee='anon' AND table_name='assessments' AND privilege_type='SELECT';
-- archived_at MUST appear. exam_password and score_policy MUST NOT.

-- 3. The rule itself.
SELECT assessment_is_available(true,  NULL, NULL, NULL)  AS open_not_archived,   -- t
       assessment_is_available(true,  NULL, NULL, now()) AS open_but_archived,   -- f
       assessment_is_available(false, NULL, NULL, NULL)  AS closed_not_archived, -- f
       assessment_is_available(true,  NULL, NULL)        AS three_arg_still_works; -- t

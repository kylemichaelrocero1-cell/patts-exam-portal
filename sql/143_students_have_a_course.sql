-- =====================================================================
-- 143 — a student has a course, and the course decides the grade base
--
-- Run in the Supabase SQL editor (runs as postgres). Idempotent. Needs 095.
-- Run it BEFORE the frontend that comes with it: sign-in and the dashboard
-- select users.course, and PostgREST refuses a select that names a missing
-- column. It only adds a column, so it is safe while papers are being sat.
--
-- Students in one section can be on different courses, and the percentage
-- they see follows the course (src/lib/courses.js, gradeBaseFor()):
--
--   BSAE and PRE-ENG'G   0-base on exams, 50-base on everything else
--   every other course   50-base on everything
--   no course set yet    whatever base the paper is set to (sql/138)
--
-- Display only, like 138: the score, points and marks on a result never move.
-- The list below is mirrored by COURSES in src/lib/courses.js, and
-- npm run test:student-course checks that the two agree.
-- =====================================================================

BEGIN;

DO $$
BEGIN
  IF NOT has_column_privilege('authenticated', 'public.users', 'section', 'UPDATE') THEN
    RAISE EXCEPTION 'Run sql/095 first. Nothing was changed.';
  END IF;
END $$;

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS course text;

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_course_chk;
ALTER TABLE public.users ADD CONSTRAINT users_course_chk CHECK (course IS NULL OR course IN (
  'BSAE', 'PRE-ENG''G', 'BSAMT', 'BSAvTech', 'BSAirTrans', 'BSIE', 'BSTM', 'BSABA', 'ATC'));

COMMENT ON COLUMN public.users.course IS
  'The student''s course. BSAE and PRE-ENG''G: 0-base on exams, 50-base otherwise. Others: 50-base. NULL: the paper''s grade_base.';

-- A student reads their own course to work out their percentage. Instructors
-- set it. The public key has no write on it: its grant on users is by column.
GRANT SELECT (course) ON public.users TO anon, authenticated;
GRANT INSERT (course), UPDATE (course) ON public.users TO authenticated;

COMMIT;

-- =====================================================================
-- VERIFY — every column should read true
-- =====================================================================
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
            AND table_name = 'users' AND column_name = 'course')           AS column_exists,
  has_column_privilege('anon', 'public.users', 'course', 'SELECT')         AS students_read_it,
  NOT has_column_privilege('anon', 'public.users', 'course', 'UPDATE')     AS students_cannot_change_it,
  NOT has_column_privilege('anon', 'public.users', 'course', 'INSERT')     AS students_cannot_insert_it,
  has_column_privilege('authenticated', 'public.users', 'course', 'UPDATE') AS instructors_set_it;

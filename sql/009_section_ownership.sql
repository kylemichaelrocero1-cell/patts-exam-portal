-- =====================================================================
-- 009 — Section ownership: a section outlives its exams
--
-- Run in the Supabase SQL editor (runs as postgres). Idempotent.
--
-- WHY
-- The dashboard used to work out an instructor's sections by reading the
-- target_section of their exams. A section therefore existed only for as
-- long as an exam pointed at it: a student added to a section with no exam
-- never appeared, and deleting the last exam of a section took its whole
-- roster out of the dashboard — while the students stayed in the database,
-- still able to log in, with no instructor able to reach them.
--
-- AdminDashboard now records the link explicitly, as a section_instructors
-- row where instructor_id = added_by = the instructor ("I teach this
-- section"), written whenever they target a section with an exam or put a
-- student in one. No schema change is needed for that — this file exists
-- only for the RLS consequence below.
--
-- WHAT THIS FIXES
-- Three UPDATE policies treat ANY section_instructors row for auth.uid()
-- as co-instructor access. Self-claim rows would therefore hand every
-- instructor write access to other people's exams and lessons that happen
-- to target a section they also teach. Adding `si.added_by <> si.instructor_id`
-- keeps the co-instructor grants (rows written by a colleague) and ignores
-- the ownership markers.
--
-- Until this runs, the dashboard change is still correct — the widening is
-- only reachable by hand-written API calls, not through the UI — but run it.
-- =====================================================================

BEGIN;

-- ---- exams -----------------------------------------------------------
-- Also carries the comma-list match from fix_rls_section_match_and_stray_comma.sql,
-- so this is correct whether or not that file was ever run.
DROP POLICY IF EXISTS exams_auth_update ON public.exams;

CREATE POLICY exams_auth_update ON public.exams
  FOR UPDATE TO authenticated
  USING (
    instructor_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.exam_shares s
      WHERE s.exam_id = exams.id
        AND s.shared_with = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.section_instructors si
      WHERE si.instructor_id = auth.uid()
        AND si.added_by <> si.instructor_id   -- granted by a colleague, not self-claimed
        AND si.section_name <> ''
        AND si.section_name = ANY (
          SELECT btrim(x)
          FROM unnest(string_to_array(coalesce(exams.target_section, ''), ',')) AS t(x)
        )
    )
  )
  WITH CHECK (true);

-- ---- assessments / lessons -------------------------------------------
-- Both arrive with sql/001_assessments_and_lessons.sql. Guarded so this
-- file also runs cleanly on a database that has not had 001 applied yet.
DO $$
BEGIN
  IF to_regclass('public.assessments') IS NOT NULL THEN
    DROP POLICY IF EXISTS assessments_auth_update ON public.assessments;
    CREATE POLICY assessments_auth_update ON public.assessments
      FOR UPDATE TO authenticated
      USING (
        instructor_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.exam_shares s
          WHERE s.exam_id = assessments.id AND s.shared_with = auth.uid()
        )
        OR EXISTS (
          SELECT 1 FROM public.section_instructors si
          WHERE si.instructor_id = auth.uid()
            AND si.added_by <> si.instructor_id
            AND si.section_name <> ''
            AND si.section_name = ANY (
              SELECT btrim(x)
              FROM unnest(string_to_array(coalesce(assessments.target_section,''), ',')) AS t(x)
            )
        )
      )
      WITH CHECK (true);
  END IF;

  IF to_regclass('public.lessons') IS NOT NULL THEN
    DROP POLICY IF EXISTS lessons_auth_update ON public.lessons;
    CREATE POLICY lessons_auth_update ON public.lessons
      FOR UPDATE TO authenticated
      USING (
        instructor_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.section_instructors si
          WHERE si.instructor_id = auth.uid()
            AND si.added_by <> si.instructor_id
            AND si.section_name <> ''
            AND si.section_name = ANY (
              SELECT btrim(x)
              FROM unnest(string_to_array(coalesce(lessons.target_section,''), ',')) AS t(x)
            )
        )
      )
      WITH CHECK (true);
  END IF;
END $$;

-- ---- backfill --------------------------------------------------------
-- Claim, for every instructor, each section their existing exams target, so
-- no roster is left depending on an exam even before that instructor next
-- opens the dashboard. The client does the same on load; this makes it true
-- for everyone at once.
INSERT INTO public.section_instructors (section_name, instructor_id, added_by)
SELECT DISTINCT btrim(t.x), e.instructor_id, e.instructor_id
FROM public.exams e,
     unnest(string_to_array(coalesce(e.target_section, ''), ',')) AS t(x)
WHERE e.instructor_id IS NOT NULL
  AND btrim(t.x) <> ''
ON CONFLICT ON CONSTRAINT section_instructors_unique_key DO NOTHING;

DO $$
BEGIN
  IF to_regclass('public.assessments') IS NOT NULL THEN
    INSERT INTO public.section_instructors (section_name, instructor_id, added_by)
    SELECT DISTINCT btrim(t.x), a.instructor_id, a.instructor_id
    FROM public.assessments a,
         unnest(string_to_array(coalesce(a.target_section, ''), ',')) AS t(x)
    WHERE a.instructor_id IS NOT NULL
      AND btrim(t.x) <> ''
    ON CONFLICT ON CONSTRAINT section_instructors_unique_key DO NOTHING;
  END IF;
END $$;

COMMIT;

-- =====================================================================
-- VERIFY
-- =====================================================================

-- Sections now on record per instructor (self-claims only):
SELECT i.full_name, i.email, count(*) AS sections
FROM public.section_instructors si
JOIN public.instructors i ON i.id = si.instructor_id
WHERE si.added_by = si.instructor_id
GROUP BY i.full_name, i.email
ORDER BY i.full_name;

-- Students no instructor can see — should be 0 rows once every section in
-- use has been claimed. Anything listed here is a roster that was already
-- orphaned before this change; assign the section to an instructor by hand.
SELECT u.section, count(*) AS students
FROM public.users u
WHERE coalesce(u.section, '') <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM public.section_instructors si,
         unnest(string_to_array(u.section, ',')) AS t(x)
    WHERE si.section_name = btrim(t.x)
  )
GROUP BY u.section
ORDER BY students DESC;

-- The three policies carry the added_by guard:
SELECT polrelid::regclass AS tbl, polname
FROM pg_policy
WHERE polname IN ('exams_auth_update', 'assessments_auth_update', 'lessons_auth_update')
  AND pg_get_expr(polqual, polrelid) LIKE '%added_by%';
-- expected: one row per table that exists in this database

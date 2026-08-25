-- =====================================================================
-- TWO FIXES — run in the Supabase SQL editor (runs as postgres).
-- Both are idempotent and safe to re-run. Generated 2026-08-24.
--
--   1. exams_auth_update RLS: co-instructors cannot update multi-section
--      exams. LATENT today (section_instructors is empty) but it will
--      bite the moment a co-instructor is added to a section.
--
--   2. "Mathematics - Diagnostic Examination" has a stray leading comma
--      in target_section. Cosmetic — every code path filters empties —
--      but it puts a blank entry in the section list.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. RLS: match a co-instructor's section against the comma LIST
-- ---------------------------------------------------------------------
-- The old policy compared the whole string:
--
--     si.section_name = exams.target_section
--
-- target_section is a comma-separated list ("AENG 426, AENG 212L-1"), so
-- that equality only ever holds for a single-section exam. A co-instructor
-- on "AENG 426" could SEE a multi-section exam (the dashboard splits the
-- list client-side, AdminDashboard.jsx:1198) but every UPDATE would fail
-- the policy — silently, since PostgREST reports an RLS block as 0 rows
-- affected rather than an error.
--
-- Split the list and compare each entry, exactly like the client does.
-- btrim + exact compare, so "AENG 223L" never matches "AENG 223L-3".

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
        AND si.section_name <> ''
        AND si.section_name = ANY (
          SELECT btrim(x)
          FROM unnest(string_to_array(coalesce(exams.target_section, ''), ',')) AS t(x)
        )
    )
  )
  WITH CHECK (true);

-- ---------------------------------------------------------------------
-- 2. Strip empty entries from target_section
-- ---------------------------------------------------------------------
-- Rebuilds the list from its non-empty, trimmed parts. Touches only rows
-- that actually contain a blank entry, so re-running changes nothing.

UPDATE public.exams e
SET target_section = sub.cleaned
FROM (
  SELECT id,
         (
           SELECT string_agg(btrim(x), ', ' ORDER BY ord)
           FROM unnest(string_to_array(coalesce(target_section, ''), ','))
                WITH ORDINALITY AS u(x, ord)
           WHERE btrim(x) <> ''
         ) AS cleaned
  FROM public.exams
) AS sub
WHERE e.id = sub.id
  AND sub.cleaned IS NOT NULL
  AND e.target_section IS DISTINCT FROM sub.cleaned;

COMMIT;

-- =====================================================================
-- VERIFY
-- =====================================================================

-- No exam should have a blank entry in its section list:
SELECT id, title, target_section
FROM public.exams
WHERE EXISTS (
  SELECT 1 FROM unnest(string_to_array(coalesce(target_section, ''), ',')) AS t(x)
  WHERE btrim(t.x) = ''
);
-- expected: 0 rows

-- The math diagnostic should no longer start with a comma:
SELECT title, target_section
FROM public.exams
WHERE title = 'Mathematics - Diagnostic Examination';

-- The policy is in place:
SELECT polname, pg_get_expr(polqual, polrelid) AS using_expr
FROM pg_policy
WHERE polrelid = 'public.exams'::regclass
  AND polname = 'exams_auth_update';

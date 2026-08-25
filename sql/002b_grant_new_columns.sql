-- =====================================================================
-- PHASE 5a fix — let students read the two switches
-- Run in the Supabase SQL editor. Idempotent. Run this after 002.
--
-- 002 added allow_retakes / show_answers / score_policy but did not extend
-- the anon column grant on assessments, which is an explicit allow-list
-- (see 001). Anon therefore gets "permission denied for table assessments"
-- the moment the student app asks for either switch — which it must, to
-- know whether to offer a retake or an answer review.
--
-- score_policy is deliberately NOT granted: it decides what the instructor
-- is shown and is no business of the student client.
-- =====================================================================

BEGIN;

GRANT SELECT (allow_retakes, show_answers) ON public.assessments TO anon;

COMMIT;

-- =====================================================================
-- VERIFY — allow_retakes and show_answers must appear, score_policy must not.
-- =====================================================================
SELECT string_agg(column_name, ', ' ORDER BY column_name) AS anon_readable
FROM information_schema.column_privileges
WHERE grantee = 'anon'
  AND table_name = 'assessments'
  AND privilege_type = 'SELECT';

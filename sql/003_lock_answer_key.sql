-- =====================================================================
-- PHASE 5b — stop shipping the answer key to the browser
--
-- ⚠ RUN THIS ONLY AFTER the app that uses submit_exam() /
--   submit_review_attempt() is deployed and confirmed working.
--
-- Until then the live build marks papers client-side: ExamBoard.jsx
-- fetches every correct_answer to score. Revoking early would break
-- submission for every student mid-exam.
--
-- WHAT IT FIXES
--   `GRANT SELECT ON public.questions TO anon` covers every column,
--   including correct_answer. The anon key ships inside the public JS
--   bundle, so today any student can read the full key for any paper
--   before sitting it, straight from the API.
--
--   After this, anon can read a question and its choices but not the
--   answer. Marking happens in submit_exam() / submit_review_attempt(),
--   which are SECURITY DEFINER and therefore still see the column, and
--   correct answers reach a student only through get_attempt_review()
--   for an attempt they have already submitted on a review paper.
-- =====================================================================

BEGIN;

REVOKE SELECT ON public.questions FROM anon;

GRANT SELECT (
  id, exam_id, assessment_id, question_number, question_text,
  question_type, category, choice_a, choice_b, choice_c, choice_d,
  image_url, created_at
) ON public.questions TO anon;

-- Instructors are authenticated and must keep full access to author papers.
GRANT ALL ON public.questions TO authenticated;

COMMIT;

-- =====================================================================
-- VERIFY — as anon, the first must succeed and the second must fail.
-- =====================================================================
-- SET ROLE anon;
--   SELECT id, question_text FROM public.questions LIMIT 1;   -- ok
--   SELECT correct_answer   FROM public.questions LIMIT 1;    -- permission denied
-- RESET ROLE;

SELECT 'anon column grants on questions' AS check,
       string_agg(column_name, ', ' ORDER BY column_name) AS readable
FROM information_schema.column_privileges
WHERE grantee = 'anon' AND table_name = 'questions' AND privilege_type = 'SELECT';
-- correct_answer must NOT appear in that list.

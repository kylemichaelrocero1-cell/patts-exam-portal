-- =====================================================================
-- 021 — take the question bank away from anon
--
-- ⚠ RUN THIS ONLY AFTER 020 HAS RUN and the build that calls
--   get_exam_questions() is deployed and confirmed working — ideally on a
--   day with no exam scheduled, and with one paper sat end to end first.
--
--   Until then ExamBoard reads `questions` directly. Revoking early means
--   no student can load any paper at all. This is the same staging 003
--   used for the answer key, for the same reason.
--
-- WHAT IT FIXES
--   CREATE POLICY questions_anon_select ON public.questions
--     FOR SELECT TO anon USING (true);
--
--   USING (true), and the anon key is in the public JS bundle. Every
--   question of every paper — closed, scheduled, archived, another
--   instructor's, password-protected — is one API call away from anybody
--   who opens the site. 003 withheld the answer key; the paper itself has
--   been readable all along, which is why the password gate in front of
--   the Start button never protected anything.
--
--   After this, a student reaches a paper only through
--   get_exam_questions(): proved by their session token, in the paper's
--   section, while it is open, and past its password.
--
-- INSTRUCTORS ARE UNAFFECTED. They are `authenticated`, keep full access,
-- and every dashboard read of `questions` keeps working.
--
-- TO UNDO, if a class is stuck and you need them writing again now:
--   GRANT SELECT (id, exam_id, assessment_id, question_number, question_text,
--     question_type, category, choices, choice_a, choice_b, choice_c,
--     choice_d, choice_e, image_url, created_at)
--   ON public.questions TO anon;
--   CREATE POLICY questions_anon_select ON public.questions
--     FOR SELECT TO anon USING (true);
-- =====================================================================

BEGIN;

-- Both forms: 003 replaced the table-wide grant with a column list, and a
-- column grant is a separate entry that a table-level REVOKE need not reach.
REVOKE SELECT ON public.questions FROM anon;
REVOKE SELECT (
  id, exam_id, assessment_id, question_number, question_text,
  question_type, category, choices, choice_a, choice_b, choice_c,
  choice_d, choice_e, image_url, created_at, correct_answer
) ON public.questions FROM anon;

-- The policy is moot once the grant is gone, but leaving a USING (true)
-- policy lying about invites someone to re-grant and not notice.
DROP POLICY IF EXISTS questions_anon_select ON public.questions;

-- Unchanged, spelled out so a re-read of this file shows the whole picture.
GRANT ALL ON public.questions TO authenticated;

COMMIT;

-- =====================================================================
-- VERIFY
-- =====================================================================

-- 1. anon has no column left on questions. Both must return no rows.
SELECT grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_name = 'questions' AND grantee = 'anon';

SELECT grantee, column_name FROM information_schema.column_privileges
WHERE table_name = 'questions' AND grantee = 'anon';

-- 2. As anon, the direct read must now fail and the function must work.
-- SET ROLE anon;
--   SELECT id FROM public.questions LIMIT 1;                  -- permission denied
--   SELECT count(*) FROM public.get_exam_questions(
--     '<paper id>', '<student id>', '<their session_token>');  -- the paper
-- RESET ROLE;

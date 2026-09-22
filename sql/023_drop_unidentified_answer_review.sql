-- =====================================================================
-- 023 — remove the answer review that never asked who was calling
--
-- ⚠ RUN THIS ONLY AFTER 022 HAS RUN and the build that passes
--   p_session_token is deployed and confirmed working.
--
--   Until then a browser still running the previous build calls the
--   three-argument form. Dropping it early turns every Review button into
--   an error. That is a smaller harm than stranding a class mid-exam, but
--   there is no reason to take it.
--
-- WHAT IT FIXES
--   get_answer_review(p_student_id, p_assessment_id, p_attempt_no)
--
--   takes the student id on trust. On a paper opened for review, anyone
--   can pass a classmate's id and get that classmate's answers plus the
--   correct answer to every item. 022 added the form that proves the
--   caller; while the old one is still callable, that proof is optional,
--   and an optional proof is no proof.
--
-- TO UNDO, if the Review button is broken for a class that needs it now:
--   re-run sql/018_multi_select_items.sql, which recreates the
--   three-argument form as it was.
-- =====================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='get_answer_review' AND p.pronargs = 4
  ) THEN
    RAISE EXCEPTION 'Run sql/022_answer_review_needs_identity.sql first.';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.get_answer_review(uuid, uuid, integer);

COMMIT;

-- =====================================================================
-- VERIFY
-- =====================================================================

-- Exactly one row, with four arguments, the last of them p_session_token.
SELECT p.pronargs AS arguments, pg_get_function_arguments(p.oid) AS signature
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'get_answer_review';

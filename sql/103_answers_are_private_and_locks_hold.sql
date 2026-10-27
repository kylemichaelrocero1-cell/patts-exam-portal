-- =====================================================================
-- 103 — the public key reads no submitted answers, and a sitting's lock
--       and flags hold against it
--
-- Run in the Supabase SQL editor (runs as postgres). Idempotent. Needs 095.
-- No frontend change is needed first: no student screen reads these
-- columns (a student's own scores, and their answer review, come through
-- columns that stay readable and through get_answer_review()).
--
-- 1. results and review_attempts: the anon role keeps SELECT on every
--    column except answers_json and violation_logs. Built from the live
--    column list, so a column added later stays readable unless it is one
--    of those two. The dashboard (authenticated) and every SECURITY
--    DEFINER function (submit_assessment, get_answer_review, the markers)
--    are untouched.
-- 2. live_sessions: a trigger on what anon may change in a sitting —
--      * a locked sitting stays locked (an instructor unlocks it), unless
--        its paper is on file, when it may show as finished;
--      * a graded paper on file is not reopened;
--      * the violation count never goes down, and no logged flag is taken
--        out or rewritten (a duration may be added to the end of one);
--      * the student and paper a sitting belongs to do not change;
--    except where a practice paper's finished sitting starts a new attempt,
--    which begins clean. Instructors and the definer functions are exempt.
-- =====================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'can_manage_paper') THEN
    RAISE EXCEPTION 'Run sql/095 first.';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1. Submitted answers are not readable with the public key
-- ---------------------------------------------------------------------
DO $$
DECLARE t text; cols text;
BEGIN
  FOREACH t IN ARRAY ARRAY['results', 'review_attempts'] LOOP
    SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO cols
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = t
      AND column_name NOT IN ('answers_json', 'violation_logs');
    EXECUTE format('REVOKE SELECT ON public.%I FROM anon', t);
    EXECUTE format('GRANT SELECT (%s) ON public.%I TO anon', cols, t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 2. A sitting's lock and flags hold against the public key
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.live_session_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE v_retakes boolean; v_filed boolean; v_paper uuid; v_new jsonb; i int; o text; n text; v_kept boolean := true;
BEGIN
  -- Only the public key is held to this: instructors and the definer
  -- functions (which run as their owner) change sittings as they always did.
  IF current_user <> 'anon' THEN RETURN NEW; END IF;

  NEW.student_id := OLD.student_id;
  NEW.exam_id := OLD.exam_id;
  NEW.assessment_id := OLD.assessment_id;

  v_paper := coalesce(OLD.assessment_id, OLD.exam_id);
  SELECT allow_retakes INTO v_retakes FROM public.assessments WHERE id = v_paper;
  -- Is this sitting's paper on file? (A graded paper's result.)
  v_filed := EXISTS (SELECT 1 FROM public.results r
                     WHERE r.student_id = OLD.student_id AND coalesce(r.assessment_id, r.exam_id) = v_paper);

  -- A practice paper's finished sitting starting a new attempt begins clean.
  IF OLD.status = 'finished' AND NEW.status = 'active' AND coalesce(v_retakes, false) THEN
    RETURN NEW;
  END IF;
  -- A graded paper already on file is not reopened.
  IF OLD.status = 'finished' AND NEW.status IS DISTINCT FROM 'finished' AND v_filed THEN
    NEW.status := 'finished';
  END IF;
  -- A locked sitting stays locked — unless its paper has been filed (the
  -- clock ran out while it was locked), when it may show as finished.
  IF OLD.status = 'locked' AND NEW.status IS DISTINCT FROM 'locked'
     AND NOT (NEW.status = 'finished' AND v_filed) THEN
    NEW.status := 'locked';
  END IF;
  NEW.violation_count := greatest(coalesce(OLD.violation_count, 0), coalesce(NEW.violation_count, 0));

  -- Every flag already logged stays, word for word; one may only grow (a
  -- duration added to its end), and new ones may follow.
  IF jsonb_typeof(OLD.violation_log) = 'array' AND jsonb_array_length(OLD.violation_log) > 0 THEN
    v_new := CASE WHEN jsonb_typeof(NEW.violation_log) = 'array' THEN NEW.violation_log ELSE '[]'::jsonb END;
    IF jsonb_array_length(v_new) < jsonb_array_length(OLD.violation_log) THEN
      v_kept := false;
    ELSE
      FOR i IN 0 .. jsonb_array_length(OLD.violation_log) - 1 LOOP
        o := OLD.violation_log ->> i;
        n := v_new ->> i;
        IF n IS NULL OR left(n, length(o)) <> o THEN v_kept := false; EXIT; END IF;
      END LOOP;
    END IF;
    IF NOT v_kept THEN NEW.violation_log := OLD.violation_log; END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS live_session_guard ON public.live_sessions;
CREATE TRIGGER live_session_guard
  BEFORE UPDATE ON public.live_sessions
  FOR EACH ROW EXECUTE FUNCTION public.live_session_guard();

COMMIT;

-- =====================================================================
-- VERIFY — one row, every column true.
-- =====================================================================
SELECT
  NOT has_column_privilege('anon', 'public.results', 'answers_json', 'SELECT') AS result_answers_private,
  NOT has_column_privilege('anon', 'public.review_attempts', 'answers_json', 'SELECT') AS attempt_answers_private,
  has_column_privilege('anon', 'public.results', 'work_marks', 'SELECT')
    AND has_column_privilege('anon', 'public.results', 'score', 'SELECT')
    AND has_column_privilege('anon', 'public.review_attempts', 'attempt_no', 'SELECT') AS scores_still_readable,
  has_column_privilege('authenticated', 'public.results', 'answers_json', 'SELECT') AS dashboard_still_reads_answers,
  EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'live_session_guard' AND NOT tgisinternal) AS sitting_guard_on;

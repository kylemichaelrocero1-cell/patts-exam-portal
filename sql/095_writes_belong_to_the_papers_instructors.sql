-- =====================================================================
-- 095 — a paper's questions, results and sittings can only be changed by
--       the instructors of that paper; a sat paper is archived before it
--       can be deleted; internal functions are not callable from outside
--
-- Run in the Supabase SQL editor (runs as postgres). Idempotent.
-- Needs 094 (can_manage_paper). Deploy the frontend that comes with it
-- FIRST: the old dashboard deleted a paper's results itself before deleting
-- the paper, which would leave nothing for rule 3 to see. The new one
-- deletes only the paper and lets the foreign keys take the rest, so it
-- works before and after this runs.
--
-- 094 stopped one instructor's dashboard from deleting another's students.
-- The same reach existed for everything a paper owns: any signed-in
-- instructor could edit or delete any paper's questions, rewrite any
-- result, or change any sitting, because the dashboard alone kept each
-- instructor to their own papers. And a paper with a whole class's results
-- went with one confirm click. This file makes Postgres keep both rules.
--
--   1. Writes are scoped by paper. INSERT/UPDATE/DELETE on questions,
--      results, live_sessions and review_attempts by an instructor must
--      pass can_manage_paper(): the owner, a share, or a colleague-granted
--      co-instructor — the same people the dashboard shows the paper to.
--      RESTRICTIVE, so the permissive policies already there still apply
--      and nothing the dashboard does today is refused.
--   2. Instructors write only users.section (and session_token, for a
--      student logging in on a device an instructor is signed in to).
--      Names, emails and student IDs change in the SQL editor.
--   3. A paper with results or attempts cannot be deleted until it is
--      archived. Archiving keeps everything and hides it from students;
--      deleting it afterwards is a second, deliberate step.
--   4. Functions only ever called from inside other functions — the
--      scorer, the token check — are not callable by anyone else. A
--      REVOKE ... FROM anon alone never took: every role inherits EXECUTE
--      from PUBLIC.
--   5. TRUNCATE (which RLS does not see) is revoked from both API roles.
--   6. A result row is filed only by submit_assessment(), never inserted
--      straight from a browser.
--
-- The SQL editor and SECURITY DEFINER functions run as postgres, so the
-- content loaders, submit_assessment and the marking functions are not
-- held to any of this.
-- =====================================================================

BEGIN;

-- ---- 1. writes scoped by paper ----------------------------------------
DROP POLICY IF EXISTS questions_write_by_paper_ins ON public.questions;
DROP POLICY IF EXISTS questions_write_by_paper_upd ON public.questions;
DROP POLICY IF EXISTS questions_write_by_paper_del ON public.questions;
CREATE POLICY questions_write_by_paper_ins ON public.questions AS RESTRICTIVE
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_paper(coalesce(assessment_id, exam_id)));
CREATE POLICY questions_write_by_paper_upd ON public.questions AS RESTRICTIVE
  FOR UPDATE TO authenticated
  USING (public.can_manage_paper(coalesce(assessment_id, exam_id)))
  WITH CHECK (public.can_manage_paper(coalesce(assessment_id, exam_id)));
CREATE POLICY questions_write_by_paper_del ON public.questions AS RESTRICTIVE
  FOR DELETE TO authenticated
  USING (public.can_manage_paper(coalesce(assessment_id, exam_id)));

DROP POLICY IF EXISTS results_write_by_paper_ins ON public.results;
DROP POLICY IF EXISTS results_write_by_paper_upd ON public.results;
CREATE POLICY results_write_by_paper_ins ON public.results AS RESTRICTIVE
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_paper(coalesce(assessment_id, exam_id)));
CREATE POLICY results_write_by_paper_upd ON public.results AS RESTRICTIVE
  FOR UPDATE TO authenticated
  USING (public.can_manage_paper(coalesce(assessment_id, exam_id)))
  WITH CHECK (public.can_manage_paper(coalesce(assessment_id, exam_id)));
-- (results DELETE: 094's results_delete_by_paper)

DROP POLICY IF EXISTS live_sessions_write_by_paper_ins ON public.live_sessions;
DROP POLICY IF EXISTS live_sessions_write_by_paper_upd ON public.live_sessions;
CREATE POLICY live_sessions_write_by_paper_ins ON public.live_sessions AS RESTRICTIVE
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_paper(coalesce(assessment_id, exam_id)));
CREATE POLICY live_sessions_write_by_paper_upd ON public.live_sessions AS RESTRICTIVE
  FOR UPDATE TO authenticated
  USING (public.can_manage_paper(coalesce(assessment_id, exam_id)))
  WITH CHECK (public.can_manage_paper(coalesce(assessment_id, exam_id)));
-- (live_sessions DELETE: 094's live_sessions_delete_by_paper)

DROP POLICY IF EXISTS review_attempts_write_by_paper_ins ON public.review_attempts;
DROP POLICY IF EXISTS review_attempts_write_by_paper_upd ON public.review_attempts;
DROP POLICY IF EXISTS review_attempts_write_by_paper_del ON public.review_attempts;
CREATE POLICY review_attempts_write_by_paper_ins ON public.review_attempts AS RESTRICTIVE
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_paper(assessment_id));
CREATE POLICY review_attempts_write_by_paper_upd ON public.review_attempts AS RESTRICTIVE
  FOR UPDATE TO authenticated
  USING (public.can_manage_paper(assessment_id))
  WITH CHECK (public.can_manage_paper(assessment_id));
CREATE POLICY review_attempts_write_by_paper_del ON public.review_attempts AS RESTRICTIVE
  FOR DELETE TO authenticated
  USING (public.can_manage_paper(assessment_id));

-- ---- 2. instructors write only a student's sections -------------------
REVOKE UPDATE ON public.users FROM authenticated;
GRANT UPDATE (section, session_token) ON public.users TO authenticated;

-- ---- 3. a sat paper is archived before it can be deleted --------------
-- Not SECURITY DEFINER: current_user must be the caller's role. The count
-- reads results through the caller's own RLS, which lets instructors read
-- every result, so a sat paper is always seen as sat.
CREATE OR REPLACE FUNCTION public.sat_paper_is_archived_first()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_archived boolean := false;
  v_sat      bigint;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN OLD;
  END IF;
  IF TG_TABLE_NAME = 'assessments' THEN
    v_archived := OLD.archived_at IS NOT NULL;
  ELSE
    SELECT a.archived_at IS NOT NULL INTO v_archived
      FROM public.assessments a WHERE a.id = OLD.id;
    v_archived := coalesce(v_archived, false);
  END IF;
  IF v_archived THEN
    RETURN OLD;
  END IF;
  SELECT (SELECT count(*) FROM public.results r
           WHERE coalesce(r.assessment_id, r.exam_id) = OLD.id)
       + (SELECT count(*) FROM public.review_attempts ra
           WHERE ra.assessment_id = OLD.id)
    INTO v_sat;
  IF v_sat > 0 THEN
    RAISE EXCEPTION 'This paper has % result(s). Archive it first; a paper can be deleted only once it is archived.', v_sat
      USING ERRCODE = '42501', HINT = 'archive_before_delete';
  END IF;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS sat_paper_is_archived_first ON public.assessments;
CREATE TRIGGER sat_paper_is_archived_first
  BEFORE DELETE ON public.assessments
  FOR EACH ROW EXECUTE FUNCTION public.sat_paper_is_archived_first();

DROP TRIGGER IF EXISTS sat_paper_is_archived_first ON public.exams;
CREATE TRIGGER sat_paper_is_archived_first
  BEFORE DELETE ON public.exams
  FOR EACH ROW EXECUTE FUNCTION public.sat_paper_is_archived_first();

-- ---- 4. internal functions stay internal ------------------------------
-- Every overload, by name, so a signature change in a later file cannot
-- leave one behind.
DO $$
DECLARE f regprocedure;
BEGIN
  -- Called only from inside SECURITY DEFINER functions.
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname IN ('score_answers', 'student_from_token')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
  -- Instructor tools: signed-in only.
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public'
              AND p.proname IN ('record_work_marks', 'duplicate_assessment', 'duplicate_exam', 'transfer_exams')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.sat_paper_is_archived_first() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.users_section_keeps_others() FROM PUBLIC, anon, authenticated;

-- ---- 5. no TRUNCATE from the API roles ---------------------------------
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

-- ---- 6. a result is filed only by submit_assessment -------------------
-- The exam screen has filed through submit_assessment() (SECURITY DEFINER)
-- since 002; nothing on the student side inserts a result row itself.
REVOKE INSERT ON public.results FROM anon;
DROP POLICY IF EXISTS results_anon_insert ON public.results;

COMMIT;

-- ---- VERIFY (read-only; every column should be true) -----------------
SELECT
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND permissive = 'RESTRICTIVE'
     AND policyname LIKE '%write_by_paper%') = 10                              AS writes_scoped_by_paper,
  NOT has_column_privilege('authenticated', 'public.users', 'student_code', 'UPDATE')
  AND has_column_privilege('authenticated', 'public.users', 'section', 'UPDATE') AS instructors_write_only_sections,
  EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'sat_paper_is_archived_first'
            AND tgrelid = 'public.assessments'::regclass)                       AS archive_before_delete_on,
  NOT has_function_privilege('anon', 'public.score_answers(uuid,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.score_answers(uuid,jsonb)', 'EXECUTE')
                                                                                AS scorer_not_callable,
  NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants
               WHERE table_schema = 'public' AND privilege_type = 'TRUNCATE'
                 AND grantee IN ('anon', 'authenticated'))                     AS no_api_truncate,
  NOT has_table_privilege('anon', 'public.results', 'INSERT')                  AS results_filed_only_by_submit;

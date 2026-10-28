-- =====================================================================
-- 115 — a paper can wait for the instructor to let each student in
--
-- Run in the Supabase SQL editor (runs as postgres). Idempotent. Needs 094
-- (can_manage_paper) and 107. Run it BEFORE the frontend that comes with
-- it: the student and instructor screens select requires_admission, and
-- PostgREST refuses a select that names a missing column — the exam list
-- would fail.
--
-- An instructor taking attendance wants a password that has been passed
-- around to be worth nothing on its own. With assessments.requires_admission
-- on, a student who opens the paper — after the password — is put on the
-- instructor's live monitor as "waiting", and gets the paper only once the
-- instructor allows that entry. Every opening is a new entry: a reload, a
-- second login or another device asks again, so the instructor decides each
-- time. Off (the default), nothing changes.
--
--   1. assessments.requires_admission (students read it, instructors switch
--      it) and admission_since, stamped when it is switched on.
--   2. exam_admissions: one row per entry — waiting, admitted, denied, or
--      withdrawn when the same student asks again from another tab. Read
--      only by the paper's instructors (RLS); written only by the functions
--      below. On the realtime publication so the monitor updates live.
--   3. request_admission(): what the student's waiting screen calls. Asks,
--      or reports where the ask stands. The browser names its entry with a
--      random id that only it holds.
--   4. decide_admission(): Allow / Not allowed on the monitor.
--   5. get_exam_questions() hands the paper over only to an admitted entry
--      (as well as everything it checked before). Now VOLATILE: it marks
--      the admission used. An admission not used within 15 minutes lapses.
--   6. A paper that needs admission is filed (results, practice attempts)
--      only for a student who was let in — or whose sitting began before the
--      switch was turned on, so turning it on mid-sitting strands nobody. The
--      paper's instructors (force submit) are not held to it.
-- =====================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'can_manage_paper') THEN
    RAISE EXCEPTION 'Run sql/094 first (can_manage_paper). Nothing was changed.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                   AND table_name = 'assessments' AND column_name = 'uses_sets') THEN
    RAISE EXCEPTION 'Run sql/107 first. Nothing was changed.';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1. The switch
-- ---------------------------------------------------------------------
ALTER TABLE public.assessments
  ADD COLUMN IF NOT EXISTS requires_admission boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS admission_since timestamptz;
COMMENT ON COLUMN public.assessments.requires_admission IS
  'true: each student waits on the live monitor until the instructor lets that entry in.';
COMMENT ON COLUMN public.assessments.admission_since IS
  'When requires_admission was last switched on. Set by trigger.';

GRANT SELECT (requires_admission) ON public.assessments TO anon, authenticated;
GRANT UPDATE (requires_admission) ON public.assessments TO authenticated;

CREATE OR REPLACE FUNCTION public.stamp_admission_since()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.requires_admission AND (TG_OP = 'INSERT' OR NOT coalesce(OLD.requires_admission, false)) THEN
    NEW.admission_since := now();
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.admission_since := OLD.admission_since;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS assessments_admission_since ON public.assessments;
CREATE TRIGGER assessments_admission_since
  BEFORE INSERT OR UPDATE ON public.assessments
  FOR EACH ROW EXECUTE FUNCTION public.stamp_admission_since();

-- ---------------------------------------------------------------------
-- 2. One row per entry
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.exam_admissions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL REFERENCES public.assessments(id) ON DELETE CASCADE,
  student_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  student_name  text,
  entry         uuid NOT NULL,
  status        text NOT NULL DEFAULT 'waiting'
                CHECK (status IN ('waiting', 'admitted', 'denied', 'withdrawn')),
  requested_at  timestamptz NOT NULL DEFAULT now(),
  seen_at       timestamptz NOT NULL DEFAULT now(),
  decided_at    timestamptz,
  decided_by    uuid,
  used_at       timestamptz,
  UNIQUE (assessment_id, student_id, entry)
);
CREATE INDEX IF NOT EXISTS exam_admissions_waiting
  ON public.exam_admissions (assessment_id) WHERE status = 'waiting';
COMMENT ON TABLE public.exam_admissions IS
  'Each time a student opens a paper that needs admission: waiting, then admitted or denied by its instructor.';

ALTER TABLE public.exam_admissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.exam_admissions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.exam_admissions TO authenticated;
DROP POLICY IF EXISTS exam_admissions_read_by_paper ON public.exam_admissions;
CREATE POLICY exam_admissions_read_by_paper ON public.exam_admissions
  FOR SELECT TO authenticated
  USING (public.can_manage_paper(assessment_id));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                     WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
                       AND tablename = 'exam_admissions') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.exam_admissions;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 3. The student asks (and asks again, every few seconds, while waiting)
-- ---------------------------------------------------------------------
-- Returns 'not_required', 'waiting', 'admitted', 'denied' or 'withdrawn'
-- for THIS entry. Checks what get_exam_questions() checks before it, so
-- nobody reaches the monitor without the password.
CREATE OR REPLACE FUNCTION public.request_admission(
  p_assessment_id uuid,
  p_student_id    uuid,
  p_session_token text,
  p_entry         uuid
) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_student  uuid;
  v_paper    public.assessments%ROWTYPE;
  v_sections text;
  v_name     text;
  v_sitting  boolean;
  v_row      public.exam_admissions%ROWTYPE;
BEGIN
  v_student := public.student_from_token(p_student_id, p_session_token);
  IF v_student IS NULL THEN
    RAISE EXCEPTION 'Your session has expired. Please log in again.' USING ERRCODE = '28000';
  END IF;
  IF p_entry IS NULL THEN
    RAISE EXCEPTION 'Missing entry.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_paper FROM public.assessments a WHERE a.id = p_assessment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That assessment no longer exists.' USING ERRCODE = '42704';
  END IF;
  IF NOT coalesce(v_paper.requires_admission, false) THEN
    RETURN 'not_required';
  END IF;

  SELECT u.section, u.full_name INTO v_sections, v_name FROM public.users u WHERE u.id = v_student;
  IF NOT public.sections_overlap(v_sections, v_paper.target_section) THEN
    RAISE EXCEPTION 'This assessment is not for your section.' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.live_sessions ls
    WHERE ls.student_id = v_student AND ls.exam_id = p_assessment_id
      AND ls.status IS DISTINCT FROM 'finished'
  ) INTO v_sitting;

  IF NOT v_sitting AND NOT public.assessment_is_available(
       v_paper.is_open, v_paper.opens_at, v_paper.closes_at, v_paper.archived_at) THEN
    RAISE EXCEPTION 'This assessment is not open.' USING ERRCODE = '42501';
  END IF;

  IF coalesce(v_paper.has_password, false) AND NOT v_sitting AND NOT EXISTS (
       SELECT 1 FROM public.exam_unlocks x
       WHERE x.assessment_id = p_assessment_id AND x.student_id = v_student) THEN
    RAISE EXCEPTION 'Enter the exam password first.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.exam_admissions x
  WHERE x.assessment_id = p_assessment_id AND x.student_id = v_student AND x.entry = p_entry;

  IF FOUND THEN
    -- Still here: keeps the name on the monitor. At most every 15 s, so a
    -- room of students waiting is not a stream of writes.
    IF v_row.status = 'waiting' AND v_row.seen_at < now() - interval '15 seconds' THEN
      UPDATE public.exam_admissions SET seen_at = now() WHERE id = v_row.id;
    END IF;
    IF v_row.status = 'admitted' AND v_row.used_at IS NULL
       AND v_row.decided_at < now() - interval '15 minutes' THEN
      RETURN 'expired';
    END IF;
    RETURN v_row.status;
  END IF;

  -- A new entry. Any other entry of theirs still waiting on this paper is
  -- withdrawn, so the monitor shows each student once.
  UPDATE public.exam_admissions
     SET status = 'withdrawn', decided_at = now()
   WHERE assessment_id = p_assessment_id AND student_id = v_student AND status = 'waiting';

  INSERT INTO public.exam_admissions (assessment_id, student_id, student_name, entry)
  VALUES (p_assessment_id, v_student, v_name, p_entry);
  RETURN 'waiting';
END $$;
REVOKE ALL ON FUNCTION public.request_admission(uuid, uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_admission(uuid, uuid, text, uuid) TO anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. The instructor decides
-- ---------------------------------------------------------------------
-- Returns the entry's status after the call. A decision already made, or an
-- entry withdrawn, is left as it is and reported.
CREATE OR REPLACE FUNCTION public.decide_admission(p_request_id uuid, p_allow boolean)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_row public.exam_admissions%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000'; END IF;
  SELECT * INTO v_row FROM public.exam_admissions WHERE id = p_request_id;
  IF NOT FOUND OR NOT public.can_manage_paper(v_row.assessment_id) THEN
    RAISE EXCEPTION 'That request is not on one of your papers.' USING ERRCODE = '42501';
  END IF;
  IF v_row.status <> 'waiting' THEN
    RETURN v_row.status;
  END IF;
  UPDATE public.exam_admissions
     SET status = CASE WHEN p_allow THEN 'admitted' ELSE 'denied' END,
         decided_at = now(), decided_by = auth.uid()
   WHERE id = p_request_id;
  RETURN CASE WHEN p_allow THEN 'admitted' ELSE 'denied' END;
END $$;
REVOKE ALL ON FUNCTION public.decide_admission(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_admission(uuid, boolean) TO authenticated;

-- ---------------------------------------------------------------------
-- 5. The paper goes only to an admitted entry
-- ---------------------------------------------------------------------
-- 042's body, with p_entry and the admission check added. The old
-- three-argument function goes: p_entry has a default, so a call that names
-- only the first three still finds this one.
DROP FUNCTION IF EXISTS public.get_exam_questions(uuid, uuid, text);
CREATE OR REPLACE FUNCTION public.get_exam_questions(
  p_assessment_id uuid,
  p_student_id    uuid,
  p_session_token text,
  p_entry         uuid DEFAULT NULL
) RETURNS TABLE (
  id              uuid,
  exam_id         uuid,
  assessment_id   uuid,
  question_number integer,
  question_text   text,
  question_type   text,
  category        text,
  choices         jsonb,
  choice_a        text,
  choice_b        text,
  choice_c        text,
  choice_d        text,
  choice_e        text,
  image_url       text,
  created_at      timestamptz,
  marks           integer,
  work_given      text,
  work_variable   text,
  work_mode       text
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_student  uuid;
  v_paper    public.assessments%ROWTYPE;
  v_sections text;
  v_sitting  boolean;
BEGIN
  v_student := public.student_from_token(p_student_id, p_session_token);
  IF v_student IS NULL THEN
    RAISE EXCEPTION 'Your session has expired. Please log in again.'
      USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_paper FROM public.assessments a WHERE a.id = p_assessment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That assessment no longer exists.' USING ERRCODE = '42704';
  END IF;

  SELECT u.section INTO v_sections FROM public.users u WHERE u.id = v_student;
  IF NOT public.sections_overlap(v_sections, v_paper.target_section) THEN
    RAISE EXCEPTION 'This assessment is not for your section.' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.live_sessions ls
    WHERE ls.student_id = v_student
      AND ls.exam_id = p_assessment_id
      AND ls.status IS DISTINCT FROM 'finished'
  ) INTO v_sitting;

  IF NOT v_sitting AND NOT public.assessment_is_available(
       v_paper.is_open, v_paper.opens_at, v_paper.closes_at, v_paper.archived_at) THEN
    RAISE EXCEPTION 'This assessment is not open.' USING ERRCODE = '42501';
  END IF;

  IF coalesce(v_paper.has_password, false) AND NOT v_sitting THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.exam_unlocks x
      WHERE x.assessment_id = p_assessment_id AND x.student_id = v_student
    ) THEN
      RAISE EXCEPTION 'Enter the exam password first.' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Every entry, mid-sitting or not: the instructor lets each one in.
  IF coalesce(v_paper.requires_admission, false) THEN
    UPDATE public.exam_admissions x
       SET used_at = coalesce(x.used_at, now())
     WHERE x.assessment_id = p_assessment_id AND x.student_id = v_student
       AND x.entry = p_entry AND x.status = 'admitted'
       AND (x.used_at IS NOT NULL OR x.decided_at > now() - interval '15 minutes');
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Your instructor has not let you in yet.' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN QUERY
  SELECT q.id, q.exam_id, q.assessment_id, q.question_number, q.question_text,
         coalesce(q.question_type, 'multiple_choice'), q.category, q.choices,
         q.choice_a, q.choice_b, q.choice_c, q.choice_d, q.choice_e,
         q.image_url, q.created_at,
         coalesce(q.marks, 1), q.work_given, coalesce(q.work_variable, 'x'),
         q.work_rubric ->> 'mode'
  FROM public.questions q
  WHERE q.exam_id = p_assessment_id OR q.assessment_id = p_assessment_id
  ORDER BY q.question_number NULLS LAST, q.id;
END $$;
REVOKE ALL ON FUNCTION public.get_exam_questions(uuid, uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_exam_questions(uuid, uuid, text, uuid) TO anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. Filed only for a student who was let in
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.filed_after_admission()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  -- Read through jsonb: review_attempts has no exam_id column, and naming a
  -- field a row does not have is an error in plpgsql (sql/118).
  v_paper uuid := coalesce((to_jsonb(NEW) ->> 'assessment_id')::uuid, (to_jsonb(NEW) ->> 'exam_id')::uuid);
  v_on    boolean;
  v_since timestamptz;
BEGIN
  SELECT a.requires_admission, a.admission_since INTO v_on, v_since
    FROM public.assessments a WHERE a.id = v_paper;
  IF NOT coalesce(v_on, false) THEN RETURN NEW; END IF;
  -- The paper's instructors (force submit, scored uploads).
  IF auth.uid() IS NOT NULL AND public.can_manage_paper(v_paper) THEN RETURN NEW; END IF;
  -- Let in at least once.
  IF EXISTS (SELECT 1 FROM public.exam_admissions x
             WHERE x.assessment_id = v_paper AND x.student_id = NEW.student_id
               AND x.used_at IS NOT NULL) THEN
    RETURN NEW;
  END IF;
  -- Sitting since before the switch went on.
  IF EXISTS (SELECT 1 FROM public.live_sessions ls
             WHERE ls.exam_id = v_paper AND ls.student_id = NEW.student_id
               AND ls.created_at < coalesce(v_since, 'infinity'::timestamptz)) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Your instructor has not let you in to this paper.' USING ERRCODE = '42501';
END $$;
REVOKE ALL ON FUNCTION public.filed_after_admission() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS results_filed_after_admission ON public.results;
CREATE TRIGGER results_filed_after_admission
  BEFORE INSERT ON public.results
  FOR EACH ROW EXECUTE FUNCTION public.filed_after_admission();
DROP TRIGGER IF EXISTS review_attempts_filed_after_admission ON public.review_attempts;
CREATE TRIGGER review_attempts_filed_after_admission
  BEFORE INSERT ON public.review_attempts
  FOR EACH ROW EXECUTE FUNCTION public.filed_after_admission();

COMMIT;

-- =====================================================================
-- VERIFY — one row, every column true.
-- =====================================================================
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'assessments'
             AND column_name = 'requires_admission' AND column_default = 'false'
             AND is_nullable = 'NO')                                                   AS switch_ready,
  NOT EXISTS (SELECT 1 FROM public.assessments WHERE requires_admission)               AS every_paper_still_off,
  has_column_privilege('anon', 'public.assessments', 'requires_admission', 'SELECT')   AS students_can_read_it,
  NOT has_column_privilege('anon', 'public.assessments', 'requires_admission', 'UPDATE') AS students_cannot_switch_it,
  has_column_privilege('authenticated', 'public.assessments', 'requires_admission', 'UPDATE') AS instructors_can_switch_it,
  NOT has_table_privilege('anon', 'public.exam_admissions', 'SELECT')
    AND NOT has_table_privilege('anon', 'public.exam_admissions', 'INSERT')
    AND NOT has_table_privilege('authenticated', 'public.exam_admissions', 'INSERT')
    AND NOT has_table_privilege('authenticated', 'public.exam_admissions', 'UPDATE')    AS requests_written_only_by_functions,
  has_table_privilege('authenticated', 'public.exam_admissions', 'SELECT')             AS instructors_can_read_requests,
  has_function_privilege('anon', 'public.request_admission(uuid,uuid,text,uuid)', 'EXECUTE') AS students_can_ask,
  NOT has_function_privilege('anon', 'public.decide_admission(uuid,boolean)', 'EXECUTE')     AS students_cannot_decide,
  has_function_privilege('anon', 'public.get_exam_questions(uuid,uuid,text,uuid)', 'EXECUTE')
    AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public' AND p.proname = 'get_exam_questions' AND p.pronargs = 3) AS gate_takes_the_entry,
  EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'results_filed_after_admission')
    AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'review_attempts_filed_after_admission') AS filing_checks_admission,
  EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime'
           AND schemaname = 'public' AND tablename = 'exam_admissions')                AS monitor_updates_live;

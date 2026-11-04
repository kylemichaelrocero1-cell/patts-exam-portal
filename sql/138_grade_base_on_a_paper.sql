-- =====================================================================
-- 138 — a paper's percentage can be on 0-base or 50-base
--
-- Run in the Supabase SQL editor (runs as postgres). Idempotent. Needs 130
-- (duplicate_paper). Run it BEFORE the frontend that comes with it: the
-- student and instructor screens select grade_base, and PostgREST refuses a
-- select that names a missing column — the exam list would fail.
--
--   0-base  (the default): score / total × 100.     30/60 is 50%.
--   50-base:               50 + score / total × 50. 30/60 is 75%.
--
-- The pass mark is 75 either way. Only the percentage changes: the score,
-- points and marks stored on a result are never touched, so switching a
-- paper's base restates its percentages and can be switched back. Every
-- existing paper stays on 0-base.
--
--   1. assessments.grade_base (students read it, instructors set it).
--   2. A copy of a paper keeps its base: duplicate_paper() and
--      duplicate_assessment() list the columns they copy.
-- =====================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                   AND table_name = 'questions' AND column_name = 'accepted_answers') THEN
    RAISE EXCEPTION 'Run sql/130 first. Nothing was changed.';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1. The setting
-- ---------------------------------------------------------------------
ALTER TABLE public.assessments
  ADD COLUMN IF NOT EXISTS grade_base smallint NOT NULL DEFAULT 0
    CONSTRAINT assessments_grade_base_chk CHECK (grade_base IN (0, 50));
COMMENT ON COLUMN public.assessments.grade_base IS
  '0: percentage = score / total × 100. 50: percentage = 50 + score / total × 50. Pass mark 75 either way.';

GRANT SELECT (grade_base) ON public.assessments TO anon, authenticated;
GRANT INSERT (grade_base), UPDATE (grade_base) ON public.assessments TO authenticated;

-- ---------------------------------------------------------------------
-- 2. A copy keeps its base (the rest of each function is as it was)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.duplicate_paper(
  p_source_id            uuid,
  p_new_title            text,
  p_target_section       text,
  p_target_instructor_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me    uuid := auth.uid();
  v_owner uuid := coalesce(p_target_instructor_id, auth.uid());
  v_new   uuid;
BEGIN
  IF v_me IS NULL OR NOT EXISTS (SELECT 1 FROM public.instructors i WHERE i.id = v_me) THEN
    RAISE EXCEPTION 'Only a signed-in instructor can duplicate a paper.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.assessments a
     WHERE a.id = p_source_id
       AND (a.instructor_id = v_me
            OR EXISTS (SELECT 1 FROM public.exam_shares s
                        WHERE s.exam_id = a.id AND s.shared_with = v_me))
  ) THEN
    RAISE EXCEPTION 'You can duplicate only a paper you own or one shared with you.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.instructors i WHERE i.id = v_owner) THEN
    RAISE EXCEPTION 'The instructor to give the copy to was not found.' USING ERRCODE = '22023';
  END IF;
  IF btrim(coalesce(p_new_title, '')) = '' OR btrim(coalesce(p_target_section, '')) = '' THEN
    RAISE EXCEPTION 'The copy needs a title and a section.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.assessments
    (kind, title, description, target_section, instructor_id, is_open,
     opens_at, closes_at, duration_minutes, exam_password, has_password,
     allow_retakes, show_answers, score_policy, review_shows_key,
     shuffle_choices, shuffle_questions, uses_sets, grade_base)
  SELECT a.kind, btrim(p_new_title), a.description, btrim(p_target_section), v_owner, false,
         NULL, NULL, a.duration_minutes, a.exam_password, a.has_password,
         a.allow_retakes, a.show_answers, a.score_policy, a.review_shows_key,
         a.shuffle_choices, a.shuffle_questions, a.uses_sets, a.grade_base
    FROM public.assessments a
   WHERE a.id = p_source_id
  RETURNING id INTO v_new;

  INSERT INTO public.questions
    (exam_id, assessment_id, question_number, question_text, question_type,
     category, choices, correct_answer, correct_answers, image_url,
     marks, work_given, work_variable, work_rubric, set_label, accepted_answers)
  SELECT v_new, v_new, q.question_number, q.question_text, q.question_type,
         q.category, q.choices, q.correct_answer, q.correct_answers, q.image_url,
         q.marks, q.work_given, q.work_variable, q.work_rubric, q.set_label, q.accepted_answers
    FROM public.questions q
   WHERE q.exam_id = p_source_id OR q.assessment_id = p_source_id;

  RETURN v_new;
END $$;

CREATE OR REPLACE FUNCTION public.duplicate_assessment(
  p_source_id      uuid,
  p_new_title      text,
  p_target_section text,
  p_allow_retakes  boolean DEFAULT true,
  p_show_answers   boolean DEFAULT true,
  p_score_policy   text    DEFAULT 'latest'
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE new_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.assessments a
    WHERE a.id = p_source_id
      AND (a.instructor_id = auth.uid()
           OR EXISTS (SELECT 1 FROM public.exam_shares s
                      WHERE s.exam_id = a.id AND s.shared_with = auth.uid()))
  ) THEN
    RAISE EXCEPTION 'You do not have access to this assessment';
  END IF;

  INSERT INTO public.assessments
    (kind, title, description, target_section, instructor_id, is_open,
     duration_minutes, exam_password, has_password,
     allow_retakes, show_answers, score_policy, shuffle_choices, shuffle_questions, grade_base)
  SELECT a.kind, p_new_title, a.description, p_target_section, auth.uid(), false,
         a.duration_minutes, a.exam_password, a.has_password,
         p_allow_retakes, p_show_answers, p_score_policy,
         a.shuffle_choices, a.shuffle_questions, a.grade_base
  FROM public.assessments a WHERE a.id = p_source_id
  RETURNING id INTO new_id;

  INSERT INTO public.questions
    (exam_id, assessment_id, question_number, question_text, question_type,
     category, choices, correct_answer, correct_answers, image_url,
     marks, work_given, work_variable, work_rubric)
  SELECT new_id, new_id, q.question_number, q.question_text, q.question_type,
         q.category, q.choices, q.correct_answer, q.correct_answers, q.image_url,
         coalesce(q.marks, 1), q.work_given, q.work_variable, q.work_rubric
  FROM public.questions q WHERE q.exam_id = p_source_id;

  RETURN new_id;
END $$;

COMMIT;

-- =====================================================================
-- VERIFY — one row, every column true.
-- =====================================================================
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'assessments'
             AND column_name = 'grade_base' AND is_nullable = 'NO')                 AS column_ready,
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assessments_grade_base_chk') AS only_0_or_50,
  has_column_privilege('anon', 'public.assessments', 'grade_base', 'SELECT')        AS students_can_read_it,
  NOT has_column_privilege('anon', 'public.assessments', 'grade_base', 'UPDATE')    AS students_cannot_change_it,
  has_column_privilege('authenticated', 'public.assessments', 'grade_base', 'UPDATE') AS instructors_can_set_it,
  pg_get_functiondef('public.duplicate_paper(uuid,text,text,uuid)'::regprocedure) LIKE '%a.grade_base%'
  AND pg_get_functiondef('public.duplicate_assessment(uuid,text,text,boolean,boolean,text)'::regprocedure)
      LIKE '%a.grade_base%'                                                         AS copies_keep_their_base;

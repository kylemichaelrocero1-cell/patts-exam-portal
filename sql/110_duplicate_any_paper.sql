-- =====================================================================
-- 110 — Duplicate works on every paper, and the copy is the whole paper
--
-- Run in the Supabase SQL editor (runs as postgres). Idempotent. Run it
-- before the dashboard that comes with it; that dashboard calls
-- duplicate_paper() and says plainly if it is missing.
--
-- The dashboard's Duplicate button called duplicate_exam() from
-- supabase_setup.sql, which looks for the paper in the legacy `exams`
-- table. A paper created straight into `assessments` — a mock exam, a
-- seatwork, and every paper loaded from the SQL editor — has no row there,
-- so Duplicate said "You do not have access to this exam". And where it did
-- find a paper, it copied four choice columns and nothing else: points,
-- typed-answer keys, multi-answer keys and the paper's settings were lost.
-- duplicate_assessment() (024) copies items properly but cannot give the
-- copy to another instructor, which the Duplicate dialog offers.
--
-- duplicate_paper() reads the paper from `assessments`; the caller must own
-- it or have it shared with them. It copies the paper's settings and every
-- item column as it is, makes the copy CLOSED and unscheduled, and gives it
-- to the caller or to another instructor. The source is untouched.
-- =====================================================================

BEGIN;

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
     shuffle_choices, shuffle_questions, uses_sets)
  SELECT a.kind, btrim(p_new_title), a.description, btrim(p_target_section), v_owner, false,
         NULL, NULL, a.duration_minutes, a.exam_password, a.has_password,
         a.allow_retakes, a.show_answers, a.score_policy, a.review_shows_key,
         a.shuffle_choices, a.shuffle_questions, a.uses_sets
    FROM public.assessments a
   WHERE a.id = p_source_id
  RETURNING id INTO v_new;

  INSERT INTO public.questions
    (exam_id, assessment_id, question_number, question_text, question_type,
     category, choices, correct_answer, correct_answers, image_url,
     marks, work_given, work_variable, work_rubric)
  SELECT v_new, v_new, q.question_number, q.question_text, q.question_type,
         q.category, q.choices, q.correct_answer, q.correct_answers, q.image_url,
         q.marks, q.work_given, q.work_variable, q.work_rubric
    FROM public.questions q
   WHERE q.exam_id = p_source_id OR q.assessment_id = p_source_id;

  RETURN v_new;
END $$;

REVOKE ALL ON FUNCTION public.duplicate_paper(uuid, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.duplicate_paper(uuid, text, text, uuid) TO authenticated;

COMMIT;

-- =====================================================================
-- VERIFY — one row, every column true.
-- =====================================================================
SELECT
  EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'duplicate_paper')                  AS function_ready,
  has_function_privilege('authenticated', 'public.duplicate_paper(uuid,text,text,uuid)', 'EXECUTE') AS instructors_can_call_it,
  NOT has_function_privilege('anon', 'public.duplicate_paper(uuid,text,text,uuid)', 'EXECUTE')     AS students_cannot;

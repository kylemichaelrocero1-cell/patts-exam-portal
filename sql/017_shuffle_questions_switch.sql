-- =====================================================================
-- 017 — a switch for question order, to match the one for choices
--
-- Run in the Supabase SQL editor (runs as postgres). Idempotent.
-- Safe to run before the code that uses it is deployed: additive, and the
-- default is today's behaviour.
--
-- WHY
-- 012 added assessments.shuffle_choices so a paper whose options are ordered
-- by design could opt out. Question order had no such switch — ExamBoard
-- shuffled every paper for every student, always, with no way to say
-- otherwise. That is right for most papers and wrong for some: a paper built
-- to run in order, a diagnostic whose sections are meant to be met in
-- sequence, or a printed form the portal has to match question for question.
--
-- shuffle_questions defaults to TRUE, so every paper that exists today keeps
-- shuffling exactly as it does now and nothing changes until somebody turns
-- it off deliberately.
--
-- WHAT "OFF" MEANS
-- Questions are shown in question_number order — the order they were written
-- in, and the order the proofreading sheets and the printed forms use. Note
-- that ExamBoard previously fetched in `id` order before shuffling, which for
-- a uuid primary key is arbitrary; that only ever mattered as a shuffle seed,
-- but once the shuffle can be switched off the base order has to be the
-- meaningful one. The client now sorts by question_number in both cases.
--
-- The two switches are independent. A paper can shuffle questions but not
-- choices, or the reverse, or neither.
--
-- ---------------------------------------------------------------------
-- REHEARSE IT FIRST (recommended)
--   1. Change  COMMIT;  near the bottom to  ROLLBACK;
--   2. Run the whole file and read the VERIFY output.
--   3. Change it back and run again for real.
-- =====================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='assessments'
                   AND column_name='shuffle_choices') THEN
    RAISE EXCEPTION 'assessments.shuffle_choices not found — run sql/012 first.';
  END IF;
END $$;

ALTER TABLE public.assessments
  ADD COLUMN IF NOT EXISTS shuffle_questions boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.assessments.shuffle_questions IS
  'When false the questions are shown in question_number order rather than shuffled per student. Independent of shuffle_choices.';

-- The student column list reads it, and anon is an explicit allow-list.
GRANT SELECT (shuffle_questions) ON public.assessments TO anon;

-- Copying a paper must carry both switches, or a duplicate silently reverts
-- to shuffling. 016 defined this function most recently; this is that body
-- with shuffle_questions added.
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
     allow_retakes, show_answers, score_policy, shuffle_choices, shuffle_questions)
  SELECT a.kind, p_new_title, a.description, p_target_section, auth.uid(), false,
         a.duration_minutes, a.exam_password, a.has_password,
         p_allow_retakes, p_show_answers, p_score_policy,
         a.shuffle_choices, a.shuffle_questions
  FROM public.assessments a WHERE a.id = p_source_id
  RETURNING id INTO new_id;

  -- choice_a..choice_e are left to the trigger in 016 rather than copied.
  INSERT INTO public.questions
    (exam_id, assessment_id, question_number, question_text, question_type,
     category, choices, correct_answer, image_url)
  SELECT new_id, new_id, q.question_number, q.question_text, q.question_type,
         q.category, q.choices, q.correct_answer, q.image_url
  FROM public.questions q WHERE q.exam_id = p_source_id;

  RETURN new_id;
END $$;

GRANT EXECUTE ON FUNCTION public.duplicate_assessment(uuid,text,text,boolean,boolean,text) TO authenticated;

COMMIT;

-- =====================================================================
-- VERIFY
-- =====================================================================

-- 1. The column exists, NOT NULL, defaulting true.
SELECT column_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name='assessments'
  AND column_name IN ('shuffle_questions','shuffle_choices')
ORDER BY column_name;

-- 2. Nothing changed behaviour: every paper still shuffles both.
SELECT count(*)                                        AS papers,
       count(*) FILTER (WHERE shuffle_questions)       AS shuffling_questions,
       count(*) FILTER (WHERE shuffle_choices)         AS shuffling_choices
FROM public.assessments;
-- All three numbers should be equal immediately after this runs.

-- 3. anon can read both switches, and still not the password.
SELECT string_agg(column_name, ', ' ORDER BY column_name) AS anon_readable
FROM information_schema.column_privileges
WHERE grantee='anon' AND table_name='assessments' AND privilege_type='SELECT';
-- shuffle_questions and shuffle_choices MUST appear; exam_password MUST NOT.

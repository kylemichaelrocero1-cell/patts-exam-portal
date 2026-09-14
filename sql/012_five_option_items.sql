-- =====================================================================
-- 012 — a fifth choice, and a per-paper switch for choice shuffling
--
-- Run in the Supabase SQL editor (runs as postgres). Idempotent.
-- Safe to run before the code that uses it is deployed: every change is
-- additive and every default preserves today's behaviour exactly.
--
-- WHY
-- `questions` has held choice_a..choice_d since the first schema, with
-- CHECK (correct_answer BETWEEN 0 AND 3). Every paper brought to the
-- portal since has had to be bent to fit it:
--   * the MATH 115 / MATH 117 scantron quizzes print EIGHT choices across
--     two answer lines, and were cut to four to load;
--   * ESCI 316's decision-making quiz has five options on 20 of its 30
--     items;
-- and the instructor's own note on the first of those was that four
-- options make a paper too easy — a blind guess is 1-in-4 rather than
-- 1-in-5 or 1-in-8. This adds the fifth.
--
-- It does NOT go all the way to eight. Five is what the material in hand
-- actually needs, and each extra column widens the answer-key grant, the
-- review payload and the editor. Going further later is the same three
-- steps as this file.
--
-- SEPARATELY, the MATH 117 prelim pool asks that option order be left
-- alone: "options are ordered by design (numeric ascending)". ExamBoard
-- shuffles the four choices for every student on every paper with no way
-- to turn it off, so this adds `assessments.shuffle_choices`, defaulting
-- to true — every existing paper keeps shuffling exactly as it does now.
--
-- WHAT THIS TOUCHES, AND WHY EACH ONE IS NEEDED
--   1. questions.choice_e                 — the column itself
--   2. questions_correct_chk              — 0..3 would reject a key of E
--   3. the anon column grant on questions — 003 revoked blanket SELECT and
--      re-granted an explicit allow-list, so a new column is invisible to
--      students until it is named there
--   4. get_answer_review()                — builds `choices` as a literal
--      4-element array; a 5-option item would review with its last option
--      missing
--   5. duplicate_assessment()             — lists choice_a..d explicitly,
--      so copying a 5-option paper would silently drop the fifth option
--   6. assessments.shuffle_choices        — the switch, plus its grant
--
-- NOT touched, deliberately:
--   * score_answers() compares the submitted index against correct_answer
--     and never enumerates the columns, so it marks 0..4 with no change.
--   * Every existing row keeps choice_e NULL, and the client renders only
--     the choices that are present, so 4-option papers are unaffected.
--
-- ---------------------------------------------------------------------
-- REHEARSE IT FIRST (recommended)
--   1. Change  COMMIT;  near the bottom to  ROLLBACK;
--   2. Run the whole file and read the VERIFY output.
--   3. Change it back and run again for real.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 0. Sanity
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='questions') THEN
    RAISE EXCEPTION 'public.questions not found — wrong database?';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1. The fifth choice
-- ---------------------------------------------------------------------
ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS choice_e text;

COMMENT ON COLUMN public.questions.choice_e IS
  'Optional fifth choice. NULL on a four-choice item; the client renders only the choices that are present.';

-- ---------------------------------------------------------------------
-- 2. Let the key point at it
-- ---------------------------------------------------------------------
-- correct_answer is a 0-based index into choice_a..choice_e, so E is 4.
ALTER TABLE public.questions DROP CONSTRAINT IF EXISTS questions_correct_chk;
ALTER TABLE public.questions ADD CONSTRAINT questions_correct_chk
  CHECK (correct_answer IS NULL OR correct_answer BETWEEN 0 AND 4);

-- A key of 4 with no fifth choice to point at is always a mistake, and it
-- would mark every student wrong in a way nothing else would catch.
ALTER TABLE public.questions DROP CONSTRAINT IF EXISTS questions_key_has_choice_chk;
ALTER TABLE public.questions ADD CONSTRAINT questions_key_has_choice_chk
  CHECK (correct_answer IS DISTINCT FROM 4 OR choice_e IS NOT NULL);

-- ---------------------------------------------------------------------
-- 3. Students must be able to read it
-- ---------------------------------------------------------------------
-- 003 revoked blanket SELECT and re-granted an explicit allow-list, so a
-- new column is unreadable to anon until it is named. correct_answer
-- stays off this list, which is the whole point of 003.
GRANT SELECT (
  id, exam_id, assessment_id, question_number, question_text,
  question_type, category, choice_a, choice_b, choice_c, choice_d, choice_e,
  image_url, created_at
) ON public.questions TO anon;

GRANT ALL ON public.questions TO authenticated;

-- ---------------------------------------------------------------------
-- 4. Answer review has to show five choices when there are five
-- ---------------------------------------------------------------------
-- The CASE keeps the array positional: index 0..3 still mean A..D on a
-- four-option item, so `correct` and `chosen` line up exactly as before.
CREATE OR REPLACE FUNCTION public.get_answer_review(
  p_student_id    uuid,
  p_assessment_id uuid,
  p_attempt_no    integer DEFAULT NULL   -- null = most recent
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE reveal boolean; ans jsonb;
BEGIN
  SELECT show_answers INTO reveal FROM public.assessments WHERE id = p_assessment_id;
  IF NOT coalesce(reveal, false) THEN
    RAISE EXCEPTION 'Answers are not available for this assessment';
  END IF;

  SELECT ra.answers_json INTO ans
  FROM public.review_attempts ra
  WHERE ra.student_id = p_student_id AND ra.assessment_id = p_assessment_id
    AND (p_attempt_no IS NULL OR ra.attempt_no = p_attempt_no)
  ORDER BY ra.attempt_no DESC LIMIT 1;

  IF ans IS NULL THEN
    SELECT r.answers_json INTO ans FROM public.results r
    WHERE r.student_id = p_student_id AND r.assessment_id = p_assessment_id;
  END IF;

  IF ans IS NULL THEN
    RAISE EXCEPTION 'Submit this assessment before viewing the answers';
  END IF;

  RETURN (
    SELECT coalesce(jsonb_agg(x ORDER BY (x->>'question_number')::int NULLS LAST), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
        'question_id', q.id, 'question_number', q.question_number,
        'question_text', q.question_text,
        'choices', CASE WHEN q.choice_e IS NULL
                     THEN jsonb_build_array(q.choice_a,q.choice_b,q.choice_c,q.choice_d)
                     ELSE jsonb_build_array(q.choice_a,q.choice_b,q.choice_c,q.choice_d,q.choice_e)
                   END,
        'correct', q.correct_answer,
        'chosen', (ans -> q.id::text ->> 'chosen')::int,
        'is_correct', coalesce((ans -> q.id::text ->> 'is_correct')::boolean, false)
      ) AS x
      FROM public.questions q
      WHERE q.exam_id = p_assessment_id
        AND coalesce(q.question_type,'multiple_choice') <> 'essay'
    ) s
  );
END $$;

GRANT EXECUTE ON FUNCTION public.get_answer_review(uuid,uuid,integer) TO anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. Per-paper choice shuffling
-- ---------------------------------------------------------------------
-- Default true, so every paper that exists today keeps shuffling exactly
-- as it does now. Set it false on a paper whose options are ordered by
-- design — ascending numeric answers, or a "none of these" that has to
-- stay last.
ALTER TABLE public.assessments
  ADD COLUMN IF NOT EXISTS shuffle_choices boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.assessments.shuffle_choices IS
  'When false the four/five choices are shown in their stored order. Question order is still randomised.';

GRANT SELECT (shuffle_choices) ON public.assessments TO anon;

-- ---------------------------------------------------------------------
-- 6. Copying a paper must carry the fifth choice and the switch
-- ---------------------------------------------------------------------
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

  -- Created closed. Open it deliberately once the copy looks right.
  INSERT INTO public.assessments
    (kind, title, description, target_section, instructor_id, is_open,
     duration_minutes, exam_password, has_password,
     allow_retakes, show_answers, score_policy, shuffle_choices)
  SELECT a.kind, p_new_title, a.description, p_target_section, auth.uid(), false,
         a.duration_minutes, a.exam_password, a.has_password,
         p_allow_retakes, p_show_answers, p_score_policy, a.shuffle_choices
  FROM public.assessments a WHERE a.id = p_source_id
  RETURNING id INTO new_id;

  INSERT INTO public.questions
    (exam_id, assessment_id, question_number, question_text, question_type,
     category, choice_a, choice_b, choice_c, choice_d, choice_e,
     correct_answer, image_url)
  SELECT new_id, new_id, q.question_number, q.question_text, q.question_type,
         q.category, q.choice_a, q.choice_b, q.choice_c, q.choice_d, q.choice_e,
         q.correct_answer, q.image_url
  FROM public.questions q WHERE q.exam_id = p_source_id;

  RETURN new_id;
END $$;

GRANT EXECUTE ON FUNCTION public.duplicate_assessment(uuid,text,text,boolean,boolean,text) TO authenticated;

COMMIT;

-- =====================================================================
-- VERIFY
-- =====================================================================

-- 1. The column and the switch exist.
SELECT 'choice_e'        AS thing, count(*) AS found FROM information_schema.columns
 WHERE table_schema='public' AND table_name='questions'   AND column_name='choice_e'
UNION ALL
SELECT 'shuffle_choices', count(*) FROM information_schema.columns
 WHERE table_schema='public' AND table_name='assessments' AND column_name='shuffle_choices';
-- Both must be 1.

-- 2. Nothing that exists today changed behaviour.
SELECT count(*) FILTER (WHERE choice_e IS NOT NULL) AS items_with_a_fifth_choice,
       count(*) FILTER (WHERE correct_answer = 4)   AS items_keyed_to_E
FROM public.questions;
-- Both must be 0 immediately after this runs.

SELECT count(*) FILTER (WHERE shuffle_choices) AS papers_still_shuffling,
       count(*)                                AS papers_total
FROM public.assessments;
-- The two numbers must be equal: nothing opted out yet.

-- 3. anon can read the new choice but still not the key.
SELECT string_agg(column_name, ', ' ORDER BY column_name) AS anon_readable
FROM information_schema.column_privileges
WHERE grantee='anon' AND table_name='questions' AND privilege_type='SELECT';
-- choice_e MUST appear. correct_answer MUST NOT.

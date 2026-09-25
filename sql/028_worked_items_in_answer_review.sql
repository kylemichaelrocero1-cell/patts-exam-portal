-- =====================================================================
-- 028 — a student can review a worked paper
--
-- Run in the Supabase SQL editor (runs as postgres). Idempotent.
--
-- THE BUG
-- get_answer_review() has excluded worked items since 024, on the reasoning
-- that a worked item has no `correct` index to reveal and its marking was the
-- instructor's, not the database's. Both halves of that stopped being true in
-- 027: the database marks these itself and knows exactly what each one
-- earned. What was left was a review screen that returned zero items for a
-- paper made entirely of them — a student pressed "review answers" and saw
-- nothing at all.
--
-- WHAT A STUDENT NOW GETS BACK, per worked item:
--   the question and the problem it started from,
--   what they answered,
--   whether it was accepted and how many marks it earned,
--   and the answer itself.
--
-- RELEASING THE ANSWER IS NOT A NEW DECISION. get_answer_review() already
-- refuses unless the instructor has turned show_answers on AND this student
-- has submitted — the same gate multiple-choice keys have had since 002. A
-- paper with answers off still reveals nothing, and a paper being sat reveals
-- nothing. Only the ANSWER is released, never the accept list or the marks
-- the instructor put on individual steps.
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_answer_review(
  p_student_id    uuid,
  p_assessment_id uuid,
  p_attempt_no    integer DEFAULT NULL
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
      -- Picked items, exactly as before.
      SELECT jsonb_build_object(
        'question_id', q.id, 'question_number', q.question_number,
        'question_text', q.question_text,
        'question_type', coalesce(q.question_type,'multiple_choice'),
        'choices', q.choices,
        'correct', q.correct_answer,
        'marks', coalesce(q.marks, 1),
        'correct_set', CASE
          WHEN coalesce(q.question_type,'multiple_choice') = 'multi_select'
          THEN coalesce(to_jsonb(public.answer_index_set(q.correct_answers)), '[]'::jsonb)
        END,
        'chosen', ans -> q.id::text -> 'chosen',
        'is_correct', coalesce((ans -> q.id::text ->> 'is_correct')::boolean, false)
      ) AS x
      FROM public.questions q
      WHERE q.exam_id = p_assessment_id
        AND coalesce(q.question_type,'multiple_choice') NOT IN ('essay','worked_solution')

      UNION ALL

      -- Worked items. `chosen` carries what the student wrote — the LAST line,
      -- which is the one that was marked — so a reader never has to guess
      -- which of several lines the verdict refers to.
      SELECT jsonb_build_object(
        'question_id', q.id, 'question_number', q.question_number,
        'question_text', q.question_text,
        'question_type', 'worked_solution',
        'work_given', q.work_given,
        'marks', coalesce(q.marks, 1),
        'earned', coalesce((ans -> q.id::text ->> 'marks')::numeric, 0),
        'chosen', (
          SELECT t FROM jsonb_array_elements_text(
                   CASE WHEN jsonb_typeof(ans -> q.id::text -> 'lines') = 'array'
                        THEN ans -> q.id::text -> 'lines' ELSE '[]'::jsonb END)
                 WITH ORDINALITY AS e(t, ord)
           WHERE btrim(t) <> '' ORDER BY ord DESC LIMIT 1),
        -- The answer only. The accept list stays private: it is the
        -- instructor's marking policy, not part of the answer.
        'correct_latex', q.work_rubric -> 'steps' -> -1 ->> 'latex',
        'is_correct', coalesce((ans -> q.id::text ->> 'correct')::boolean, false)
      ) AS x
      FROM public.questions q
      WHERE q.exam_id = p_assessment_id
        AND coalesce(q.question_type,'multiple_choice') = 'worked_solution'
    ) s
  );
END $$;

GRANT EXECUTE ON FUNCTION public.get_answer_review(uuid,uuid,integer) TO anon, authenticated;

COMMIT;

-- =====================================================================
-- VERIFY
-- =====================================================================
-- Substitute a student and a worked paper they have submitted.
-- SELECT jsonb_array_length(public.get_answer_review('<student>','<paper>',NULL));
-- Should now equal the number of items on the paper, not 0.

SELECT count(*) FILTER (WHERE question_type = 'worked_solution') AS worked_items
FROM public.questions;

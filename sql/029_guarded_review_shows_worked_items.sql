-- =====================================================================
-- 029 — the review a student actually calls shows worked items too
--
-- Run in the Supabase SQL editor (runs as postgres). Idempotent.
--
-- 028 taught get_answer_review() to return worked items with the problem,
-- the student's answer, what it earned and the answer itself. It taught the
-- WRONG ONE.
--
-- There are two: the three-argument form from 002, and the four-argument
-- form added by 022, which additionally proves the caller with their session
-- token so that passing a classmate's id no longer hands over a classmate's
-- paper. The client calls the four-argument one — correctly, and deliberately
-- (src/lib/answerReview.js falls back to the three-argument form only when
-- the guarded one is ABSENT, never when it refuses).
--
-- So a student reviewing a maths paper got thirty cards with a question
-- number, a mark of 0/1 and no problem, no answer of theirs and no answer of
-- ours — because the row shape it was handed still predates worked items.
--
-- This brings the guarded form to the same body. A lesson worth leaving
-- written down: an overload is a second copy, and updating one of two copies
-- is how a fix lands everywhere except where it is used.
-- =====================================================================

BEGIN;

DO $$
BEGIN
  -- Counted, not string-matched: how an argument list is rendered varies
  -- between servers, and a sanity check that fails on formatting is worse
  -- than none.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='get_answer_review' AND p.pronargs = 4
  ) THEN
    RAISE EXCEPTION 'The 4-argument get_answer_review() is missing — run sql/022 first.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.get_answer_review(
  p_student_id    uuid,
  p_assessment_id uuid,
  p_attempt_no    integer,
  p_session_token text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_student uuid;
  reveal    boolean;
  ans       jsonb;
BEGIN
  v_student := public.student_from_token(p_student_id, p_session_token);
  IF v_student IS NULL THEN
    RAISE EXCEPTION 'Your session has expired. Please log in again.'
      USING ERRCODE = '28000';
  END IF;

  SELECT show_answers INTO reveal FROM public.assessments WHERE id = p_assessment_id;
  IF NOT coalesce(reveal, false) THEN
    RAISE EXCEPTION 'Answers are not available for this assessment';
  END IF;

  -- v_student, not p_student_id, from here down: the proved id is the only
  -- one this function will look anything up by. That is the whole point of
  -- this form and it is unchanged.
  SELECT ra.answers_json INTO ans
  FROM public.review_attempts ra
  WHERE ra.student_id = v_student AND ra.assessment_id = p_assessment_id
    AND (p_attempt_no IS NULL OR ra.attempt_no = p_attempt_no)
  ORDER BY ra.attempt_no DESC LIMIT 1;

  IF ans IS NULL THEN
    SELECT r.answers_json INTO ans FROM public.results r
    WHERE r.student_id = v_student AND r.assessment_id = p_assessment_id;
  END IF;

  IF ans IS NULL THEN
    RAISE EXCEPTION 'Submit this assessment before viewing the answers';
  END IF;

  RETURN (
    SELECT coalesce(jsonb_agg(x ORDER BY (x->>'question_number')::int NULLS LAST), '[]'::jsonb)
    FROM (
      -- Picked items.
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

      -- Worked items: the problem, what they wrote, what it earned, and the
      -- answer. The accept list is NOT released — it is marking policy.
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
        'correct_latex', q.work_rubric -> 'steps' -> -1 ->> 'latex',
        'is_correct', coalesce((ans -> q.id::text ->> 'correct')::boolean, false)
      ) AS x
      FROM public.questions q
      WHERE q.exam_id = p_assessment_id
        AND coalesce(q.question_type,'multiple_choice') = 'worked_solution'
    ) s
  );
END $$;

GRANT EXECUTE ON FUNCTION public.get_answer_review(uuid,uuid,integer,text) TO anon, authenticated;

COMMIT;

-- =====================================================================
-- VERIFY
-- =====================================================================

-- Both forms exist, and both now carry the worked fields.
SELECT pg_get_function_identity_arguments(p.oid) AS arguments,
       prosrc LIKE '%correct_latex%' AS shows_worked_answers
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname='public' AND p.proname='get_answer_review'
ORDER BY 1;
-- Two rows. shows_worked_answers must be true on BOTH.

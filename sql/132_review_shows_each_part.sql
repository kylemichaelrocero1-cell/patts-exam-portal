-- =====================================================================
-- 132 — Answer review shows each part of a value-and-unit problem
--
-- Run once in the Supabase SQL editor. Safe to run twice.
--
-- A value-and-unit problem (sql/105) is filed with every part's result —
-- value right?, unit right?, its marks out of its points — but answer
-- review sent only the item's total and a sentence ("Value wrong: c, d").
-- get_answer_review() now sends the parts too, so the review can show a
-- student each part's score. Nothing of the key goes with them. Otherwise
-- this is 130's function unchanged.
-- =====================================================================

BEGIN;

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
  show_key  boolean;
  ans       jsonb;
  v_set     text;
BEGIN
  v_student := public.student_from_token(p_student_id, p_session_token);
  IF v_student IS NULL THEN
    RAISE EXCEPTION 'Your session has expired. Please log in again.'
      USING ERRCODE = '28000';
  END IF;

  SELECT show_answers, review_shows_key INTO reveal, show_key
  FROM public.assessments WHERE id = p_assessment_id;
  IF NOT coalesce(reveal, false) THEN
    RAISE EXCEPTION 'Answers are not available for this assessment';
  END IF;
  show_key := coalesce(show_key, true);

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

  -- Only the set this student sat (116), and the items in every set.
  SELECT c.set_label INTO v_set FROM public.paper_set_choices c
   WHERE c.assessment_id = p_assessment_id AND c.student_id = v_student;

  RETURN (
    SELECT coalesce(jsonb_agg(x ORDER BY (x->>'question_number')::int NULLS LAST), '[]'::jsonb)
    FROM (
      -- Picked items. The key goes only where it may: always on a paper
      -- that shows it, otherwise only on an item already answered right
      -- (where it is the student's own answer back).
      SELECT jsonb_build_object(
        'question_id', q.id, 'question_number', q.question_number,
        'question_text', q.question_text,
        'question_type', coalesce(q.question_type,'multiple_choice'),
        'choices', q.choices,
        'correct', CASE WHEN show_key OR ok THEN to_jsonb(q.correct_answer) END,
        'marks', coalesce(q.marks, 1),
        'correct_set', CASE
          WHEN coalesce(q.question_type,'multiple_choice') = 'multi_select' AND (show_key OR ok)
          THEN coalesce(to_jsonb(public.answer_index_set(q.correct_answers)), '[]'::jsonb)
        END,
        -- Other choices that also count on a one-answer item (130).
        'also_correct', CASE
          WHEN coalesce(q.question_type,'multiple_choice') = 'multiple_choice' AND q.accepted_answers IS NOT NULL AND (show_key OR ok)
          THEN to_jsonb(public.answer_index_set(q.accepted_answers))
        END,
        'chosen', ans -> q.id::text -> 'chosen',
        'is_correct', ok,
        'key_hidden', NOT (show_key OR ok)
      ) AS x
      FROM public.questions q
      CROSS JOIN LATERAL (SELECT coalesce((ans -> q.id::text ->> 'is_correct')::boolean, false) AS ok) k
      WHERE q.exam_id = p_assessment_id
        AND coalesce(q.question_type,'multiple_choice') NOT IN ('essay','worked_solution')
        AND public.question_in_set(q.set_label, v_set)

      UNION ALL

      -- Worked items: the problem, every line written, which step each line
      -- was, what it earned, and — where allowed — the answer. The accept
      -- lists and the intermediate steps of the rubric are NOT released.
      SELECT jsonb_build_object(
        'question_id', q.id, 'question_number', q.question_number,
        'question_text', q.question_text,
        'question_type', 'worked_solution',
        'work_given', q.work_given,
        'work_mode', q.work_rubric ->> 'mode',
        'marks', coalesce(q.marks, 1),
        'earned', coalesce((ans -> q.id::text ->> 'marks')::numeric, 0),
        'chosen', (
          SELECT t FROM jsonb_array_elements_text(
                   CASE WHEN jsonb_typeof(ans -> q.id::text -> 'lines') = 'array'
                        THEN ans -> q.id::text -> 'lines' ELSE '[]'::jsonb END)
                 WITH ORDINALITY AS e(t, ord)
           WHERE btrim(t) <> '' ORDER BY ord DESC LIMIT 1),
        'lines', CASE WHEN jsonb_typeof(ans -> q.id::text -> 'lines') = 'array'
                      THEN ans -> q.id::text -> 'lines' ELSE '[]'::jsonb END,
        'line_steps', ans -> q.id::text -> 'line_steps',
        'reason', ans -> q.id::text ->> 'reason',
        -- Each part of a value-and-unit problem as it was marked (sql/105):
        -- value right?, unit right?, its marks out of its points. No key.
        'parts', CASE WHEN q.work_rubric ->> 'mode' = 'quantity'
                         AND jsonb_typeof(ans -> q.id::text -> 'parts') = 'array'
                      THEN ans -> q.id::text -> 'parts' END,
        'correct_latex', CASE WHEN show_key OR ok THEN q.work_rubric -> 'steps' -> -1 ->> 'latex' END,
        -- The worked solution, step by step, for a line-by-line item — only
        -- on a paper that shows its key.
        'solution', CASE WHEN show_key AND q.work_rubric ->> 'mode' = 'lines'
                         THEN (SELECT jsonb_agg(s ->> 'latex' ORDER BY o)
                                 FROM jsonb_array_elements(q.work_rubric -> 'steps') WITH ORDINALITY AS z(s, o)) END,
        'is_correct', ok,
        'key_hidden', NOT (show_key OR ok)
      ) AS x
      FROM public.questions q
      CROSS JOIN LATERAL (SELECT coalesce((ans -> q.id::text ->> 'correct')::boolean, false) AS ok) k
      WHERE q.exam_id = p_assessment_id
        AND coalesce(q.question_type,'multiple_choice') = 'worked_solution'
        AND public.question_in_set(q.set_label, v_set)
    ) s
  );
END $$;

COMMIT;

-- =====================================================================
-- VERIFY — one row, true.
-- =====================================================================
SELECT position('''parts''' in pg_get_functiondef('public.get_answer_review(uuid, uuid, integer, text)'::regprocedure)) > 0 AS review_sends_parts;

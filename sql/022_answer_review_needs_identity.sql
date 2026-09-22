-- =====================================================================
-- 022 — the answer review must know who is asking
--
-- Run in the Supabase SQL editor (runs as postgres). Idempotent.
-- ADDITIVE ONLY: the old three-argument form stays until 023, so this is
-- safe to run before the code that uses it is deployed.
--
-- REQUIRES sql/020 (student_from_token).
--
-- WHAT IS WRONG TODAY
--     get_answer_review(p_student_id, p_assessment_id, p_attempt_no)
--
-- p_student_id is simply whatever the caller typed. The function checks
-- that the paper has show_answers on and that a submission exists for that
-- student — never that the caller IS that student. Student ids are uuids
-- and not secret; they travel in the results a browser already fetches.
--
-- So on any paper the instructor has opened for review, anyone can pass a
-- classmate's id and read that classmate's answers — and, in the same
-- response, the correct answer to every item on the paper. That last part
-- is the sharper end of it: a paper opened for review hands its key to
-- anybody who asks, without their ever having sat it.
--
-- Same shape as the exam-password hole: a check that reads like a lock but
-- never establishes identity.
--
-- THE FIX
-- A four-argument form that proves the caller with users.session_token,
-- exactly as get_exam_questions() does, then runs the existing logic
-- unchanged. Nothing else about the review moves.
--
-- ON INSTRUCTORS
-- No instructor code path calls this — the dashboard reads `questions`
-- directly as `authenticated`, key included. So there is deliberately no
-- auth.uid() bypass here: adding an untested branch to widen access, for a
-- caller that does not exist, is how holes get made. If an instructor-side
-- caller is ever added it will fail loudly with the message below rather
-- than quietly letting anything through.
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
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname='public' AND p.proname='student_from_token') THEN
    RAISE EXCEPTION 'Run sql/020_exam_content_behind_the_gate.sql first.';
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
  -- one this function will look anything up by.
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
      SELECT jsonb_build_object(
        'question_id', q.id, 'question_number', q.question_number,
        'question_text', q.question_text,
        'question_type', coalesce(q.question_type,'multiple_choice'),
        'choices', q.choices,
        'correct', q.correct_answer,
        'correct_set', CASE
          WHEN coalesce(q.question_type,'multiple_choice') = 'multi_select'
          THEN coalesce(to_jsonb(public.answer_index_set(q.correct_answers)), '[]'::jsonb)
        END,
        'chosen', ans -> q.id::text -> 'chosen',
        'is_correct', coalesce((ans -> q.id::text ->> 'is_correct')::boolean, false)
      ) AS x
      FROM public.questions q
      WHERE q.exam_id = p_assessment_id
        AND coalesce(q.question_type,'multiple_choice') <> 'essay'
    ) s
  );
END $$;

GRANT EXECUTE ON FUNCTION public.get_answer_review(uuid,uuid,integer,text) TO anon, authenticated;

COMMIT;

-- =====================================================================
-- VERIFY
-- =====================================================================

-- 1. Both forms exist right now — that is what makes this safe to run
--    ahead of the deploy. 023 removes the three-argument one.
SELECT p.pronargs AS arguments, pg_get_function_arguments(p.oid) AS signature
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'get_answer_review'
ORDER BY p.pronargs;

-- 2. End to end, on a paper with show_answers on that the student has sat:
-- SELECT public.get_answer_review('<student id>', '<paper id>', NULL, '<their token>');
--   -> the marked paper
-- SELECT public.get_answer_review('<student id>', '<paper id>', NULL, 'wrong-token');
--   -> "Your session has expired. Please log in again."

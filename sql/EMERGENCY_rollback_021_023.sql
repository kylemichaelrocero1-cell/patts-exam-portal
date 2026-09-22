-- =====================================================================
-- EMERGENCY ROLLBACK — undoes 021 and 023 ONLY
--
-- Paste this whole file into the Supabase SQL editor if students cannot
-- load exams because 021/023 ran before the new build was deployed.
-- It restores service in seconds and needs no deploy.
--
-- It does NOT touch 019, 020 or 022. The password fix stays, and the new
-- gated functions stay in place unused — so once the new build is live you
-- can simply run 021 and 023 again and be where you meant to be.
--
-- WHAT IT PUTS BACK (and these are holes — this is a stopgap, not a fix):
--   * anon can read the question bank again
--   * get_answer_review() can be called without proving who is asking
-- =====================================================================

BEGIN;

-- ---- undo 021: anon reads questions again --------------------------
-- The column list is 003's, plus the columns added since. correct_answer
-- stays out: 003 withheld the answer key and that is not being undone.
GRANT SELECT (
  id, exam_id, assessment_id, question_number, question_text,
  question_type, category, choices, choice_a, choice_b, choice_c,
  choice_d, choice_e, image_url, created_at
) ON public.questions TO anon;

DROP POLICY IF EXISTS questions_anon_select ON public.questions;
CREATE POLICY questions_anon_select ON public.questions
  FOR SELECT TO anon USING (true);

-- ---- undo 023: the three-argument answer review ---------------------
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


GRANT EXECUTE ON FUNCTION public.get_answer_review(uuid,uuid,integer) TO anon, authenticated;

COMMIT;

-- =====================================================================
-- VERIFY — students should be able to sit exams again immediately.
-- =====================================================================

-- 1. anon can read questions again (rows expected, correct_answer absent).
SELECT string_agg(column_name, ', ' ORDER BY column_name) AS anon_readable
FROM information_schema.column_privileges
WHERE grantee='anon' AND table_name='questions' AND privilege_type='SELECT';

-- 2. Both answer-review forms are callable again.
SELECT p.pronargs AS arguments, pg_get_function_arguments(p.oid) AS signature
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname='public' AND p.proname='get_answer_review'
ORDER BY p.pronargs;

-- 3. 019/020/022 are untouched and still in force.
SELECT public.verify_exam_password('00000000-0000-0000-0000-000000000000','x')
       AS unknown_paper_still_false;

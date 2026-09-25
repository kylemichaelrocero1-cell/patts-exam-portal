-- =====================================================================
-- 026 — a student's working is actually saved, and can be scored
--
-- Run in the Supabase SQL editor (runs as postgres). Idempotent.
--
-- THE BUG THIS FIXES
-- Worked answers never reached the result row. ExamBoard patched them in
-- after submit_assessment() with a plain
--     supabase.from('results').update({ answers_json, work_total })
-- but `results` has RLS with an anon SELECT policy and an anon INSERT policy
-- and NO anon UPDATE policy — so the update matched zero rows, which is not an
-- error, and the call reported success. The same line had been silently losing
-- ESSAY answers the same way for as long as it has existed.
--
-- The damage was invisible from both ends: the student typed ten answers and
-- saw 0/0; the instructor opened the script and saw "Nothing was written"; and
-- the working itself was sitting in live_sessions.work_answers_json the whole
-- time, because anon CAN write that table.
--
-- The lesson is the one this schema already applies everywhere else: a student's
-- browser does not write to results, it calls a SECURITY DEFINER function that
-- writes on its behalf after checking who is asking.
--
-- WHAT THIS ADDS
--   save_worked_answers()  the student's browser hands over its working; the
--                          function proves the session, finds the row that
--                          submit_assessment() just wrote — results, or
--                          review_attempts for a retakeable paper — and merges
--                          the working into it. Also records work_total, the
--                          marks available, which is what lets a screen say
--                          "8 marks awaiting marking" rather than nothing.
--
--   get_worked_keys()      the answers to the worked items, for a paper whose
--                          instructor has turned answers on AND only once this
--                          student has submitted. Same rule get_answer_review()
--                          has applied to multiple-choice keys since 002. This
--                          is what lets a practice paper show a score the
--                          moment it is handed in, marked in the browser,
--                          because Postgres has no computer algebra and cannot
--                          mark these itself.
--
-- WHAT IS NOT CHANGED
--   * A score computed in a browser from these keys is NOT the mark of record
--     and is never written back. record_work_marks() (024) is still
--     instructor-only, and the instructor's marking still overwrites anything
--     a student's device worked out.
--   * No key is released for a paper with show_answers off, or to a student
--     who has not submitted. A paper being sat leaks nothing.
--
-- REHEARSE IT FIRST
--   1. Change  COMMIT;  near the bottom to  ROLLBACK;
--   2. Run the whole file and read the VERIFY output.
-- =====================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='questions'
                   AND column_name='work_rubric') THEN
    RAISE EXCEPTION 'questions.work_rubric not found — run sql/024 first.';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1. Saving the working
-- ---------------------------------------------------------------------
-- p_work is { "<question_id>": { "lines": ["y'=5"] } } — exactly the shape the
-- exam board holds while the paper is being sat.
CREATE OR REPLACE FUNCTION public.save_worked_answers(
  p_student_id    uuid,
  p_assessment_id uuid,
  p_session_token text,
  p_work          jsonb
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_student uuid;
  v_retakes boolean;
  v_total   numeric;
  v_patch   jsonb;
  v_rows    int := 0;
  v_attempt int;
BEGIN
  v_student := public.student_from_token(p_student_id, p_session_token);
  IF v_student IS NULL THEN
    RAISE EXCEPTION 'Your session has expired. Please log in again.'
      USING ERRCODE = '28000';
  END IF;

  SELECT allow_retakes INTO v_retakes
  FROM public.assessments WHERE id = p_assessment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown assessment'; END IF;

  -- What the worked items on this paper are worth. A property of the PAPER,
  -- so it is recorded even when the student left every one of them blank —
  -- without it a screen cannot tell "no worked items" from "not marked yet".
  SELECT coalesce(sum(coalesce(q.marks, 1)), 0) INTO v_total
  FROM public.questions q
  WHERE q.exam_id = p_assessment_id
    AND coalesce(q.question_type,'multiple_choice') = 'worked_solution';

  -- Only lines with something in them, and only for items that really are
  -- worked ones on this paper — a client cannot invent entries.
  SELECT jsonb_object_agg(k, jsonb_build_object(
           'type', 'worked',
           'lines', lines,
           'marks', NULL))
    INTO v_patch
  FROM (
    SELECT e.key AS k,
           (SELECT jsonb_agg(t) FROM jsonb_array_elements_text(e.value -> 'lines') AS t
             WHERE btrim(t) <> '') AS lines
    FROM jsonb_each(coalesce(p_work, '{}'::jsonb)) AS e
    WHERE EXISTS (
      SELECT 1 FROM public.questions q
      WHERE q.id::text = e.key
        AND q.exam_id = p_assessment_id
        AND coalesce(q.question_type,'multiple_choice') = 'worked_solution')
  ) s
  WHERE lines IS NOT NULL;

  IF v_retakes THEN
    SELECT max(attempt_no) INTO v_attempt FROM public.review_attempts
    WHERE student_id = v_student AND assessment_id = p_assessment_id;

    UPDATE public.review_attempts ra
       SET answers_json = coalesce(ra.answers_json,'{}'::jsonb) || coalesce(v_patch,'{}'::jsonb),
           work_total   = v_total
     WHERE ra.student_id = v_student AND ra.assessment_id = p_assessment_id
       AND ra.attempt_no = v_attempt;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  ELSE
    UPDATE public.results r
       SET answers_json = coalesce(r.answers_json,'{}'::jsonb) || coalesce(v_patch,'{}'::jsonb),
           work_total   = v_total
     WHERE r.student_id = v_student AND r.assessment_id = p_assessment_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'saved', v_rows, 'work_total', v_total,
    'items', (SELECT count(*) FROM jsonb_object_keys(coalesce(v_patch,'{}'::jsonb))));
END $$;

REVOKE ALL ON FUNCTION public.save_worked_answers(uuid,uuid,text,jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.save_worked_answers(uuid,uuid,text,jsonb) TO anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. The answers, once the paper is handed in
-- ---------------------------------------------------------------------
-- Released under exactly the rule get_answer_review() has used since 002: the
-- instructor has turned answers on, AND this student has already submitted.
-- Nothing is released while a paper is being sat.
CREATE OR REPLACE FUNCTION public.get_worked_keys(
  p_student_id    uuid,
  p_assessment_id uuid,
  p_session_token text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_student uuid; v_reveal boolean; v_submitted boolean;
BEGIN
  v_student := public.student_from_token(p_student_id, p_session_token);
  IF v_student IS NULL THEN
    RAISE EXCEPTION 'Your session has expired. Please log in again.'
      USING ERRCODE = '28000';
  END IF;

  SELECT show_answers INTO v_reveal FROM public.assessments WHERE id = p_assessment_id;
  IF NOT coalesce(v_reveal, false) THEN
    RAISE EXCEPTION 'Answers are not available for this assessment' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.results r
     WHERE r.student_id = v_student AND r.assessment_id = p_assessment_id
    UNION ALL
    SELECT 1 FROM public.review_attempts ra
     WHERE ra.student_id = v_student AND ra.assessment_id = p_assessment_id
  ) INTO v_submitted;
  IF NOT v_submitted THEN
    RAISE EXCEPTION 'Submit this assessment before viewing the answers' USING ERRCODE = '42501';
  END IF;

  RETURN (
    SELECT coalesce(jsonb_agg(x ORDER BY (x->>'question_number')::int NULLS LAST), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
        'question_id',   q.id,
        'question_number', q.question_number,
        'marks',         coalesce(q.marks, 1),
        'work_given',    q.work_given,
        'work_variable', coalesce(q.work_variable, 'x'),
        -- The ANSWER only — the last step of the rubric. The instructor's
        -- intermediate working and the marks they put on it are not released.
        'answer',        q.work_rubric -> 'steps' -> -1 ->> 'latex'
      ) AS x
      FROM public.questions q
      WHERE q.exam_id = p_assessment_id
        AND coalesce(q.question_type,'multiple_choice') = 'worked_solution'
    ) s
  );
END $$;

REVOKE ALL ON FUNCTION public.get_worked_keys(uuid,uuid,text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_worked_keys(uuid,uuid,text) TO anon, authenticated;

COMMIT;

-- =====================================================================
-- VERIFY
-- =====================================================================

-- 1. Both functions exist and anon may call them.
SELECT routine_name, grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_name IN ('save_worked_answers','get_worked_keys')
ORDER BY routine_name, grantee;

-- 2. The rubric itself is still not readable off the table.
SELECT string_agg(column_name, ', ' ORDER BY column_name) AS anon_readable
FROM information_schema.column_privileges
WHERE grantee='anon' AND table_name='questions' AND privilege_type='SELECT';
-- work_rubric must NOT appear.

-- 3. Nobody's stored result was touched by this migration.
SELECT count(*) AS attempts, count(work_total) AS with_work_total
FROM public.review_attempts;

-- =====================================================================
-- 042 — a full solution marked line by line, and a review that can keep
--       the key back
--
-- Run in the Supabase SQL editor (runs as postgres). Idempotent.
-- Needs 027-039. Run it BEFORE deploying the build that goes with it, and
-- before loading any paper that uses either feature.
--
-- 1. WORKING MARKED LINE BY LINE
--    Until now a typed item was marked on its last line, all or nothing
--    (027). A rubric may now say "mode": "lines": the student writes the
--    solution over several lines, without numbering them, and each step of
--    the rubric is looked for among those lines. Each step has its own
--    accepted forms and its own marks:
--
--      {"mode":"lines",
--       "steps":[{"latex":"y=\\sin^2(x^2)",         "marks":0},
--                {"latex":"y'=2\\sin(x^2)\\cos(x^2)(2x)", "marks":3, "accept":[…]},
--                {"latex":"y'=4x\\sin(x^2)\\cos(x^2)",    "marks":5, "accept":[…],
--                 "alone":3}]}
--
--    The item earns the BEST of:
--      * any step before the last, found on any line → that step's marks;
--      * the last step, on the LAST line, with every earlier step found on
--        earlier lines in order → its marks (the item's full marks);
--      * the last step on the last line without that working → "alone".
--    Nothing is ever taken away. Every line is checked with the same
--    worked_answer_verdict() as before, so spacing, labels, \left( and the
--    rest are judged exactly as on every other typed item.
--
--    mark_working() does the marking and is pure, so it can be tested on
--    its own; src/lib/stepMarking.js is its JS twin and the dashboard uses
--    it. sql/test/working_line_by_line.test.mjs compares the two.
--
--    get_exam_questions() now also returns work_mode, so the exam screen
--    knows to offer several lines. Nothing else of the rubric is sent.
--
-- 2. REVIEW WITHOUT THE KEY FOR WHAT WAS MISSED
--    assessments.review_shows_key (default true: nothing changes for any
--    existing paper). Off, a student reviewing their attempt still sees
--    every answer of theirs marked right or wrong, but the correct answer
--    is withheld — BY THE DATABASE — for every item they did not get fully
--    right. With unlimited retakes this stops "fail on purpose, copy the
--    key, resubmit". get_worked_keys() refuses outright on such a paper.
--
-- REHEARSE IT FIRST
--   1. Change  COMMIT;  near the bottom to  ROLLBACK;
--   2. Run the whole file and read the VERIFY output.
-- =====================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname='public' AND p.proname='worked_answer_verdict') THEN
    RAISE EXCEPTION 'worked_answer_verdict() is missing — run sql/032 first.';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1. The switch
-- ---------------------------------------------------------------------
ALTER TABLE public.assessments
  ADD COLUMN IF NOT EXISTS review_shows_key boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN public.assessments.review_shows_key IS
  'With show_answers on: true shows the correct answer to every item; false withholds it for items the student did not get fully right.';
GRANT SELECT (review_shows_key), UPDATE (review_shows_key) ON public.assessments TO authenticated;

-- ---------------------------------------------------------------------
-- 2. Marking a solution line by line
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.step_accepted(p_step jsonb)
RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT array_agg(v ORDER BY ord)
  FROM (
    SELECT p_step ->> 'latex' AS v, 0::bigint AS ord
    UNION ALL
    SELECT e.v, e.ord
    FROM jsonb_array_elements_text(
           CASE WHEN jsonb_typeof(p_step -> 'accept') = 'array'
                THEN p_step -> 'accept' ELSE '[]'::jsonb END)
         WITH ORDINALITY AS e(v, ord)
  ) s
  WHERE v IS NOT NULL AND btrim(v) <> '';
$$;

-- p_lines: the student's lines, blanks already dropped, in order.
-- Returns {marks, of, correct, reason, line_steps}: line_steps[i] is the
-- 1-based step line i matched, or null. The reason never quotes the key.
CREATE OR REPLACE FUNCTION public.mark_working(p_lines jsonb, p_rubric jsonb)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
  v_steps jsonb := CASE WHEN jsonb_typeof(p_rubric -> 'steps') = 'array'
                        THEN p_rubric -> 'steps' ELSE '[]'::jsonb END;
  v_lines text[];
  n_steps int; n_lines int;
  v_last int;                 -- the last step, 1-based
  v_full numeric; v_alone numeric;
  v_line_steps jsonb := '[]'::jsonb;
  v_first int[];              -- first line each step matched (1-based), 0 = none
  v_best numeric := 0; v_reason text := NULL;
  v_chain boolean; v_prev int;
  i int; j int; v_hit int;
BEGIN
  SELECT coalesce(array_agg(t ORDER BY ord), ARRAY[]::text[]) INTO v_lines
  FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(p_lines) = 'array'
                                      THEN p_lines ELSE '[]'::jsonb END)
       WITH ORDINALITY AS e(t, ord)
  WHERE btrim(t) <> '';

  n_steps := jsonb_array_length(v_steps);
  n_lines := coalesce(array_length(v_lines, 1), 0);
  v_last  := n_steps;
  v_full  := coalesce((v_steps -> (n_steps - 1) ->> 'marks')::numeric, 0);
  v_alone := coalesce((v_steps -> (n_steps - 1) ->> 'alone')::numeric, 0);
  v_first := array_fill(0, ARRAY[greatest(n_steps, 1)]);

  IF n_steps = 0 THEN
    RETURN jsonb_build_object('marks', 0, 'of', 0, 'correct', false,
      'reason', 'This question has no answer key.', 'line_steps', '[]'::jsonb);
  END IF;
  IF n_lines = 0 THEN
    RETURN jsonb_build_object('marks', 0, 'of', v_full, 'correct', false,
      'reason', 'Nothing was written.', 'line_steps', '[]'::jsonb);
  END IF;

  -- Which step each line is. A line counts once, for the latest step it
  -- matches, so a line written for step 3 is never read as step 2.
  FOR j IN 1 .. n_lines LOOP
    v_hit := NULL;
    FOR i IN REVERSE n_steps .. 1 LOOP
      IF public.worked_answer_verdict(v_lines[j],
           coalesce(public.step_accepted(v_steps -> (i - 1)), ARRAY[]::text[])) IS NULL THEN
        v_hit := i; EXIT;
      END IF;
    END LOOP;
    -- jsonb_build_array, not to_jsonb: to_jsonb(NULL) is SQL NULL, and
    -- appending that wipes out the whole list.
    v_line_steps := v_line_steps || jsonb_build_array(v_hit);
    IF v_hit IS NOT NULL AND v_first[v_hit] = 0 THEN v_first[v_hit] := j; END IF;
  END LOOP;

  -- Any step before the last, wherever it was written.
  FOR i IN 1 .. n_steps - 1 LOOP
    IF v_first[i] > 0 AND coalesce((v_steps -> (i - 1) ->> 'marks')::numeric, 0) > v_best THEN
      v_best := (v_steps -> (i - 1) ->> 'marks')::numeric;
      v_reason := 'Part of the solution is right, but the final answer is not there yet.';
    END IF;
  END LOOP;

  -- The last step: only as the last line, which is the student's answer.
  IF (v_line_steps ->> (n_lines - 1)) IS NOT NULL
     AND (v_line_steps ->> (n_lines - 1))::int = v_last THEN
    v_chain := true; v_prev := 0;
    FOR i IN 1 .. n_steps - 1 LOOP
      IF v_first[i] = 0 OR v_first[i] <= v_prev OR v_first[i] >= n_lines THEN
        v_chain := false; EXIT;
      END IF;
      v_prev := v_first[i];
    END LOOP;
    IF v_chain AND v_full >= v_best THEN
      v_best := v_full; v_reason := 'Correct, with the working shown.';
    ELSIF NOT v_chain AND v_alone > v_best THEN
      v_best := v_alone;
      v_reason := 'The final answer is right, but the working that leads to it is not all shown.';
    ELSIF NOT v_chain AND v_alone >= v_best THEN
      v_reason := 'The final answer is right, but the working that leads to it is not all shown.';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'marks', v_best, 'of', v_full, 'correct', v_best >= v_full AND v_full > 0,
    'reason', coalesce(v_reason, 'None of these lines is a step of the solution.'),
    'line_steps', v_line_steps);
END $$;

-- ---------------------------------------------------------------------
-- 3. score_worked_answers() — 032's body, with the line-by-line branch
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.score_worked_answers(
  p_student_id    uuid,
  p_assessment_id uuid,
  p_attempt_no    integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_retakes boolean; v_answers jsonb; v_attempt integer;
  v_earned numeric := 0; v_total numeric := 0; v_patch jsonb := '{}'::jsonb;
  r record; v_ok boolean; v_line text; v_reason text; v_lines jsonb; v_m jsonb;
BEGIN
  SELECT allow_retakes INTO v_retakes FROM public.assessments WHERE id = p_assessment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown assessment'; END IF;

  IF v_retakes THEN
    SELECT coalesce(p_attempt_no, max(attempt_no)) INTO v_attempt
    FROM public.review_attempts
    WHERE student_id = p_student_id AND assessment_id = p_assessment_id;
    SELECT answers_json INTO v_answers FROM public.review_attempts
    WHERE student_id = p_student_id AND assessment_id = p_assessment_id
      AND attempt_no = v_attempt;
  ELSE
    SELECT answers_json INTO v_answers FROM public.results
    WHERE student_id = p_student_id AND assessment_id = p_assessment_id;
  END IF;
  IF v_answers IS NULL THEN v_answers := '{}'::jsonb; END IF;

  FOR r IN
    SELECT q.id, coalesce(q.marks,1)::numeric AS marks, q.work_rubric,
           public.accepted_answers(q.work_rubric) AS accepted
    FROM public.questions q
    WHERE q.exam_id = p_assessment_id
      AND coalesce(q.question_type,'multiple_choice') = 'worked_solution'
  LOOP
    v_total := v_total + r.marks;
    v_lines := CASE WHEN jsonb_typeof(v_answers -> r.id::text -> 'lines') = 'array'
                    THEN v_answers -> r.id::text -> 'lines' ELSE '[]'::jsonb END;

    IF r.work_rubric ->> 'mode' = 'lines' THEN
      v_m := public.mark_working(v_lines, r.work_rubric);
      -- Never more than the item is worth, whatever the rubric says.
      v_m := jsonb_set(v_m, '{marks}', to_jsonb(least((v_m ->> 'marks')::numeric, r.marks)));
      v_earned := v_earned + (v_m ->> 'marks')::numeric;
      v_patch := v_patch || jsonb_build_object(r.id::text, jsonb_build_object(
        'type','worked', 'lines', v_lines,
        'marks', (v_m ->> 'marks')::numeric, 'of', r.marks,
        'correct', (v_m ->> 'marks')::numeric >= r.marks,
        'reason', v_m ->> 'reason', 'line_steps', v_m -> 'line_steps'));
      CONTINUE;
    END IF;

    v_line := NULL;
    -- THE LAST LINE ONLY — see 027. One answer is one answer.
    SELECT t INTO v_line
    FROM jsonb_array_elements_text(v_lines) WITH ORDINALITY AS e(t, ord)
    WHERE btrim(t) <> ''
    ORDER BY ord DESC LIMIT 1;

    v_reason := public.worked_answer_verdict(v_line, coalesce(r.accepted, ARRAY[]::text[]));
    v_ok := v_line IS NOT NULL AND v_reason IS NULL;

    IF v_ok THEN v_earned := v_earned + r.marks; END IF;
    v_patch := v_patch || jsonb_build_object(r.id::text, jsonb_build_object(
      'type','worked',
      'lines', v_lines,
      'marks', CASE WHEN v_ok THEN r.marks ELSE 0 END,
      'of', r.marks,
      'correct', v_ok,
      'reason', CASE WHEN v_ok THEN 'Correct answer.' ELSE v_reason END));
  END LOOP;

  IF v_retakes THEN
    UPDATE public.review_attempts
       SET answers_json = coalesce(answers_json,'{}'::jsonb) || v_patch,
           work_marks = v_earned, work_total = v_total, work_marked_at = now()
     WHERE student_id = p_student_id AND assessment_id = p_assessment_id
       AND attempt_no = v_attempt;
  ELSE
    UPDATE public.results
       SET answers_json = coalesce(answers_json,'{}'::jsonb) || v_patch,
           work_marks = v_earned, work_total = v_total, work_marked_at = now()
     WHERE student_id = p_student_id AND assessment_id = p_assessment_id;
  END IF;

  RETURN jsonb_build_object('work_marks', v_earned, 'work_total', v_total,
                            'attempt_no', v_attempt);
END $$;

REVOKE ALL ON FUNCTION public.score_worked_answers(uuid,uuid,integer) FROM public;
REVOKE ALL ON FUNCTION public.score_worked_answers(uuid,uuid,integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.score_worked_answers(uuid,uuid,integer) TO authenticated;

-- ---------------------------------------------------------------------
-- 4. The review: every line, which step each was, and the key only when
--    the paper allows it
-- ---------------------------------------------------------------------
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
        'chosen', ans -> q.id::text -> 'chosen',
        'is_correct', ok,
        'key_hidden', NOT (show_key OR ok)
      ) AS x
      FROM public.questions q
      CROSS JOIN LATERAL (SELECT coalesce((ans -> q.id::text ->> 'is_correct')::boolean, false) AS ok) k
      WHERE q.exam_id = p_assessment_id
        AND coalesce(q.question_type,'multiple_choice') NOT IN ('essay','worked_solution')

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
    ) s
  );
END $$;

GRANT EXECUTE ON FUNCTION public.get_answer_review(uuid,uuid,integer,text) TO anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. get_worked_keys() releases nothing on a paper that keeps its key
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_worked_keys(
  p_student_id    uuid,
  p_assessment_id uuid,
  p_session_token text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_student uuid; v_reveal boolean; v_key boolean; v_submitted boolean;
BEGIN
  v_student := public.student_from_token(p_student_id, p_session_token);
  IF v_student IS NULL THEN
    RAISE EXCEPTION 'Your session has expired. Please log in again.'
      USING ERRCODE = '28000';
  END IF;

  SELECT show_answers, review_shows_key INTO v_reveal, v_key
  FROM public.assessments WHERE id = p_assessment_id;
  IF NOT coalesce(v_reveal, false) OR NOT coalesce(v_key, true) THEN
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

-- ---------------------------------------------------------------------
-- 6. get_exam_questions() says which items take several lines
-- ---------------------------------------------------------------------
-- A new output column changes the function's type, so it is dropped and
-- recreated. Its body is 024's, unchanged apart from work_mode. The old
-- build ignores the extra column; the new build reads a missing one as
-- "one line", so either order of deploy is safe for this part.
DROP FUNCTION IF EXISTS public.get_exam_questions(uuid, uuid, text);
CREATE FUNCTION public.get_exam_questions(
  p_assessment_id uuid,
  p_student_id    uuid,
  p_session_token text
) RETURNS TABLE (
  id              uuid,
  exam_id         uuid,
  assessment_id   uuid,
  question_number integer,
  question_text   text,
  question_type   text,
  category        text,
  choices         jsonb,
  choice_a        text,
  choice_b        text,
  choice_c        text,
  choice_d        text,
  choice_e        text,
  image_url       text,
  created_at      timestamptz,
  marks           integer,
  work_given      text,
  work_variable   text,
  work_mode       text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_student  uuid;
  v_paper    public.assessments%ROWTYPE;
  v_sections text;
  v_sitting  boolean;
BEGIN
  v_student := public.student_from_token(p_student_id, p_session_token);
  IF v_student IS NULL THEN
    RAISE EXCEPTION 'Your session has expired. Please log in again.'
      USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_paper FROM public.assessments a WHERE a.id = p_assessment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That assessment no longer exists.' USING ERRCODE = '42704';
  END IF;

  SELECT u.section INTO v_sections FROM public.users u WHERE u.id = v_student;
  IF NOT public.sections_overlap(v_sections, v_paper.target_section) THEN
    RAISE EXCEPTION 'This assessment is not for your section.' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.live_sessions ls
    WHERE ls.student_id = v_student
      AND ls.exam_id = p_assessment_id
      AND ls.status IS DISTINCT FROM 'finished'
  ) INTO v_sitting;

  IF NOT v_sitting AND NOT public.assessment_is_available(
       v_paper.is_open, v_paper.opens_at, v_paper.closes_at, v_paper.archived_at) THEN
    RAISE EXCEPTION 'This assessment is not open.' USING ERRCODE = '42501';
  END IF;

  IF coalesce(v_paper.has_password, false) AND NOT v_sitting THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.exam_unlocks x
      WHERE x.assessment_id = p_assessment_id AND x.student_id = v_student
    ) THEN
      RAISE EXCEPTION 'Enter the exam password first.' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN QUERY
  SELECT q.id, q.exam_id, q.assessment_id, q.question_number, q.question_text,
         coalesce(q.question_type, 'multiple_choice'), q.category, q.choices,
         q.choice_a, q.choice_b, q.choice_c, q.choice_d, q.choice_e,
         q.image_url, q.created_at,
         coalesce(q.marks, 1), q.work_given, coalesce(q.work_variable, 'x'),
         q.work_rubric ->> 'mode'
  FROM public.questions q
  WHERE q.exam_id = p_assessment_id OR q.assessment_id = p_assessment_id
  ORDER BY q.question_number NULLS LAST, q.id;
END $$;

GRANT EXECUTE ON FUNCTION public.get_exam_questions(uuid, uuid, text) TO anon, authenticated;

COMMIT;

-- =====================================================================
-- VERIFY — one row, every column true.
-- =====================================================================
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='assessments'
            AND column_name='review_shows_key') AS has_review_shows_key,
  (public.mark_working('["y=x^2","y''=2x"]'::jsonb,
     '{"mode":"lines","steps":[{"latex":"y=x^2","marks":0},{"latex":"y''=2x","marks":2,"alone":1}]}'::jsonb)
     ->> 'marks')::numeric = 2 AS full_working_full_marks,
  (public.mark_working('["y''=2x"]'::jsonb,
     '{"mode":"lines","steps":[{"latex":"y=x^2","marks":0},{"latex":"y''=2x","marks":2,"alone":1}]}'::jsonb)
     ->> 'marks')::numeric = 1 AS answer_alone_part_marks,
  (SELECT prosrc LIKE '%key_hidden%' FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='get_answer_review' AND p.pronargs = 4) AS review_can_hide_key,
  EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname='public' AND p.proname='get_exam_questions'
            AND pg_get_function_result(p.oid) LIKE '%work_mode%') AS questions_carry_work_mode;

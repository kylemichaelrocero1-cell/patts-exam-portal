-- =====================================================================
-- 045 — brackets that change nothing do not make a right answer wrong
--
-- Run in the Supabase SQL editor (runs as postgres). Idempotent.
-- Needs 042 and 043.
--
-- A student wrote, on MATH 117 Assignment 1 Part B,
--     y' = 2\sin(x^2)(\cos(x^2))(2x)
--     y' = 4x(\sin(x^2))(\cos(x^2))
-- — right, both lines — and scored 0, because the database compares answers
-- as STRINGS and a bracket round a factor is a different string. Listing
-- every bracketing of every answer cannot keep up: any factor may or may not
-- be bracketed.
--
-- math_unbracket() removes the brackets that cannot change the meaning, from
-- the student's line and from every accepted answer alike, before they are
-- compared once more. A bracket goes only when ALL of these hold:
--   * there is no top-level + or − (or =) inside it, and it does not start
--     with a sign — (−sin x), (x+1) stay;
--   * it is not a function's argument — the (x^2) of \sin(x^2), \sin^2(x),
--     \sin^{-1}(3x) stay;
--   * it is not raised, subscripted, primed or divided — (\sin x)^2,
--     1/(2x), (2x)/3 stay;
--   * removing it does not run two digits together — (2)(3) can become
--     2(3), never 23.
--   [ ] and \lbrack \rbrack are read as ( ) first.
-- Labels are judged exactly as before. This only ever makes MORE answers
-- right; nothing that was right becomes wrong.
--
-- working_verdict() = worked_answer_verdict() plus that second look. Both
-- markers use it: score_worked_answers() for one-line items and
-- mark_working() for full solutions. JS twins: unbracket() in
-- src/lib/mathNormalize.js, used by stepMarking.js and markAnswer().
--
-- RE-MARKS every attempt already submitted on a paper with a full-solution
-- item (MATH 117 Assignment 1), RAISE-ONLY: if any attempt would go down the
-- whole file rolls back. Attempts with a mark typed by an instructor are
-- skipped. Other papers are not re-marked; they mark this way from now on.
-- =====================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname='public' AND p.proname='mark_working' AND p.prosrc LIKE '%partial%') THEN
    RAISE EXCEPTION 'Run sql/042 and sql/043 first.';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1. Brackets that change nothing
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.math_unbracket_ok(p_before text, p_inside text, p_after text)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE d int := 0; c text; k int;
BEGIN
  IF p_inside = '' OR left(p_inside, 1) IN ('-', '+') THEN RETURN false; END IF;
  FOR k IN 1 .. length(p_inside) LOOP
    c := substr(p_inside, k, 1);
    IF c IN ('(', '{') THEN d := d + 1;
    ELSIF c IN (')', '}') THEN d := d - 1;
    ELSIF d = 0 AND c IN ('+', '-', '=') THEN RETURN false;
    END IF;
  END LOOP;
  -- A function's argument: \sin(…), \sin^2(…), \sin^{-1}(…).
  IF p_before ~ '\\[A-Za-z]+(\^(\{[^{}]*\}|.))?$' THEN RETURN false; END IF;
  IF right(p_before, 1) IN ('^', '_', '/', '''') THEN RETURN false; END IF;
  IF left(p_after, 1) IN ('^', '_', '/', '''', '!') THEN RETURN false; END IF;
  IF right(p_before, 1) ~ '[0-9]' AND left(p_inside, 1) ~ '[0-9]' THEN RETURN false; END IF;
  IF right(p_inside, 1) ~ '[0-9]' AND left(p_after, 1) ~ '[0-9]' THEN RETURN false; END IF;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.math_unbracket(p text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE s text; n int; i int; j int; k int; d int; c text; changed boolean; guard int := 0;
BEGIN
  s := coalesce(p, '');
  s := replace(replace(s, '\lbrack', '('), '\rbrack', ')');
  s := replace(replace(s, '[', '('), ']', ')');
  LOOP
    guard := guard + 1;
    EXIT WHEN guard > 200;
    changed := false;
    n := length(s);
    FOR i IN 1 .. n LOOP
      IF substr(s, i, 1) = '(' THEN
        d := 0; j := 0;
        FOR k IN i .. n LOOP
          c := substr(s, k, 1);
          IF c = '(' THEN d := d + 1;
          ELSIF c = ')' THEN d := d - 1; IF d = 0 THEN j := k; EXIT; END IF;
          END IF;
        END LOOP;
        IF j > 0 AND public.math_unbracket_ok(substr(s, 1, i - 1), substr(s, i + 1, j - i - 1), substr(s, j + 1)) THEN
          s := substr(s, 1, i - 1) || substr(s, i + 1, j - i - 1) || substr(s, j + 1);
          changed := true;
          EXIT;
        END IF;
      END IF;
    END LOOP;
    EXIT WHEN NOT changed;
  END LOOP;
  RETURN s;
END $$;

-- ---------------------------------------------------------------------
-- 2. The verdict, with a second look past those brackets
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.working_verdict(p_answer text, p_accepted text[])
RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE v text; u text; key_labels text[]; own text; want text;
BEGIN
  v := public.worked_answer_verdict(p_answer, p_accepted);
  IF v IS NULL OR v <> 'Not an accepted answer.' THEN RETURN v; END IF;
  IF p_answer IS NULL OR btrim(p_answer) = '' THEN RETURN v; END IF;
  u := public.math_unbracket(public.normalize_math(p_answer));
  IF NOT EXISTS (SELECT 1 FROM unnest(coalesce(p_accepted, ARRAY[]::text[])) AS acc
                 WHERE btrim(acc) <> '' AND public.math_unbracket(public.normalize_math(acc)) = u) THEN
    RETURN v;
  END IF;
  -- The value is right; the label is judged exactly as worked_answer_verdict() does.
  SELECT array_agg(l ORDER BY ord) INTO key_labels
  FROM (SELECT public.math_label(acc) AS l, ord
        FROM unnest(p_accepted) WITH ORDINALITY AS a(acc, ord)) s
  WHERE l IS NOT NULL;
  IF key_labels IS NULL THEN RETURN NULL; END IF;
  own := public.math_label(p_answer);
  IF own IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(key_labels) AS k
                                 WHERE public.math_labels_agree(own, k)) THEN
    RETURN NULL;
  END IF;
  want := public.math_label_shown(key_labels[1]);
  IF own IS NULL AND position('=' in p_answer) = 0 THEN
    RETURN 'Right value, but no label — the answer should begin ' || want || ' =';
  ELSIF own IS NOT NULL THEN
    RETURN 'Right value, but the wrong label: ' || public.math_label_shown(own)
        || ' where the question asks for ' || want || '.';
  END IF;
  RETURN 'Right value, but the left-hand side is not the notation asked for (' || want || ').';
END $$;

-- ---------------------------------------------------------------------
-- 3. Both markers use it (bodies otherwise those of 043 and 042)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_working(p_lines jsonb, p_rubric jsonb)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
  v_steps jsonb := CASE WHEN jsonb_typeof(p_rubric -> 'steps') = 'array'
                        THEN p_rubric -> 'steps' ELSE '[]'::jsonb END;
  v_lines text[];
  n_steps int; n_lines int;
  v_last int;                 -- the last step, 1-based
  v_full numeric; v_alone numeric; v_partial numeric; v_some boolean;
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
  -- The final answer with SOME of the working before it. Absent, it is worth
  -- what the answer alone is, which is exactly 042's behaviour.
  v_partial := coalesce((v_steps -> (n_steps - 1) ->> 'partial')::numeric, v_alone);
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
      IF public.working_verdict(v_lines[j],
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
    -- Some earlier step written on a line before the answer, even if not all.
    v_some := false;
    FOR i IN 1 .. n_steps - 1 LOOP
      IF v_first[i] > 0 AND v_first[i] < n_lines THEN v_some := true; END IF;
    END LOOP;
    IF v_chain AND v_full >= v_best THEN
      v_best := v_full; v_reason := 'Correct, with the working shown.';
    ELSIF NOT v_chain AND v_some AND v_partial >= v_best AND v_partial > v_alone THEN
      v_best := v_partial;
      v_reason := 'The final answer is right, but a step of the working is missing.';
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

    v_reason := public.working_verdict(v_line, coalesce(r.accepted, ARRAY[]::text[]));
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
-- 4. Re-mark what is already submitted on full-solution papers, raise-only
-- ---------------------------------------------------------------------
DO $$
DECLARE r record; v_new numeric; n_done int := 0; n_up int := 0; n_skip int := 0;
BEGIN
  FOR r IN
    SELECT ra.student_id, ra.assessment_id, ra.attempt_no, coalesce(ra.work_marks, 0) AS old, ra.answers_json
    FROM public.review_attempts ra
    JOIN public.assessments a ON a.id = ra.assessment_id AND a.allow_retakes
    WHERE EXISTS (SELECT 1 FROM public.questions q WHERE q.exam_id = ra.assessment_id
                  AND q.work_rubric ->> 'mode' = 'lines')
  LOOP
    IF EXISTS (SELECT 1 FROM jsonb_each(coalesce(r.answers_json, '{}'::jsonb)) e
               WHERE jsonb_typeof(e.value) = 'object' AND e.value ->> 'reason' LIKE 'Marked by instructor%') THEN
      n_skip := n_skip + 1; CONTINUE;
    END IF;
    v_new := (public.score_worked_answers(r.student_id, r.assessment_id, r.attempt_no) ->> 'work_marks')::numeric;
    IF v_new < r.old THEN
      RAISE EXCEPTION 'An attempt would go DOWN from % to % (student %, attempt %). Nothing was changed.',
        r.old, v_new, r.student_id, r.attempt_no;
    END IF;
    n_done := n_done + 1;
    IF v_new > r.old THEN n_up := n_up + 1; END IF;
  END LOOP;
  RAISE NOTICE '% attempts re-marked, % of them went up, % skipped (marked by hand).', n_done, n_up, n_skip;
END $$;

COMMIT;

-- =====================================================================
-- VERIFY — one row, every column true.
-- =====================================================================
SELECT
  public.math_unbracket('2\sin(x^2)(\cos(x^2))(2x)') = public.math_unbracket('2\sin(x^2)\cos(x^2)(2x)') AS factor_brackets_go,
  public.math_unbracket('(\sin(x))^2') = '(\sin(x))^2' AND public.math_unbracket('1/(2x)') = '1/(2x)'
    AND public.math_unbracket('x^3(-\sin(x))') = 'x^3(-\sin(x))' AND public.math_unbracket('(2)(3)') NOT LIKE '%23%' AS meaningful_brackets_stay,
  public.working_verdict('y''=4x(\sin(x^2))(\cos(x^2))', ARRAY['y''=4x\sin(x^2)\cos(x^2)']) IS NULL AS bracketed_answer_right,
  public.working_verdict('4x(\sin(x^2))(\cos(x^2))', ARRAY['y''=4x\sin(x^2)\cos(x^2)']) IS NOT NULL AS label_still_judged;

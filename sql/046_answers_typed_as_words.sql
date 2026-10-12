-- =====================================================================
-- 046 — an answer typed as a word, not as maths
--
-- Run in the Supabase SQL editor (runs as postgres). Idempotent.
-- Needs 042 and 045. Run it BEFORE loading any paper with a text item.
-- The build that goes with it may ship before or after: until this runs,
-- no paper holds a text item, so nothing on screen changes.
--
-- WHY
-- Every typed answer goes through the maths keyboard, which is the wrong
-- tool for a one-word answer: it turns some words into symbols while the
-- student types ("and" becomes ∧, a word containing "in" gains ∈), sets
-- every letter in maths italics, and the database then compares LaTeX
-- strings in which "Rudder" and "rudder" differ. A concepts item — "the
-- control surface that rolls the aircraft is the ______" — needs a plain
-- text box and a comparison that ignores capitals and spaces.
--
-- WHAT THIS ADDS
--   A typed item whose rubric says "mode": "text":
--
--     {"mode":"text","steps":[{"latex":"aileron","marks":1}],
--      "accept":["another accepted word"]}
--
--   Same shape as a one-line maths item — the answer is the last step, the
--   accept list sits beside it — so accepted_answers(), the review and the
--   key read it unchanged. get_exam_questions() already sends work_mode
--   (042), which is how the exam screen knows to offer a text box instead of
--   the maths keyboard. Nothing else of the rubric is sent.
--
--   text_answer_key() is what both sides are reduced to before comparing:
--   lower case, every space removed, and any full stop, comma, quote or
--   bracket at either END dropped ("Aileron." counts for aileron; "the
--   aileron" does not: only the ends are trimmed, never a word). JS twin:
--   src/lib/textAnswer.js; sql/test/text_answers.test.mjs compares them.
--
-- WHAT IS NOT TOUCHED
--   Maths items and full solutions are marked exactly as before: the only
--   change to score_worked_answers() is one branch taken when the rubric
--   says "text".
--
-- REHEARSE IT FIRST
--   1. Change  COMMIT;  near the bottom to  ROLLBACK;
--   2. Run the whole file and read the VERIFY output.
-- =====================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname='public' AND p.proname='working_verdict') THEN
    RAISE EXCEPTION 'working_verdict() is missing — run sql/045 first.';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1. What a typed word is compared as
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.text_answer_key(p_answer text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT regexp_replace(
           regexp_replace(lower(coalesce(p_answer, '')), '[[:space:]]+', '', 'g'),
           '^[.,;:!?"''()\[\]“”‘’]+|[.,;:!?"''()\[\]“”‘’]+$', '', 'g');
$$;

-- NULL when the answer is one of the accepted ones, otherwise the reason.
-- The reason never quotes the key.
CREATE OR REPLACE FUNCTION public.text_answer_verdict(p_answer text, p_accepted text[])
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN public.text_answer_key(p_answer) = '' THEN 'Nothing was written.'
    WHEN EXISTS (SELECT 1 FROM unnest(coalesce(p_accepted, ARRAY[]::text[])) AS acc
                 WHERE public.text_answer_key(acc) <> ''
                   AND public.text_answer_key(acc) = public.text_answer_key(p_answer))
      THEN NULL
    ELSE 'Not the right answer.'
  END;
$$;

-- ---------------------------------------------------------------------
-- 2. The marker takes the text branch (body otherwise that of 045)
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

    IF r.work_rubric ->> 'mode' = 'text' THEN
      v_reason := public.text_answer_verdict(v_line, coalesce(r.accepted, ARRAY[]::text[]));
    ELSE
      v_reason := public.working_verdict(v_line, coalesce(r.accepted, ARRAY[]::text[]));
    END IF;
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

COMMIT;

-- =====================================================================
-- VERIFY — one row, every column true.
-- =====================================================================
SELECT
  public.text_answer_verdict('  Rudder ', ARRAY['rudder']) IS NULL AS capitals_and_spaces_ignored,
  public.text_answer_verdict('Trim tab.', ARRAY['trimtab']) IS NULL AS inner_space_and_full_stop_ignored,
  public.text_answer_verdict('flaperon', ARRAY['aileron','flaperon']) IS NULL AS accept_list_read,
  public.text_answer_verdict('elevator', ARRAY['aileron']) IS NOT NULL AS wrong_word_wrong,
  public.text_answer_verdict('', ARRAY['aileron']) IS NOT NULL AS blank_wrong,
  (SELECT prosrc LIKE '%text_answer_verdict%' FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='score_worked_answers') AS marker_takes_text_branch;

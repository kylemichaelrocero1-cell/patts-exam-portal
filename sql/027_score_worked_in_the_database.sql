-- =====================================================================
-- 027 — worked answers are marked in the DATABASE
--
-- Run in the Supabase SQL editor (runs as postgres). Idempotent.
--
-- WHY THIS EXISTS
-- Until now a worked item's score was worked out in a browser: the student's
-- own, for the number shown after submitting, and the instructor's, for the
-- mark of record. The first of those is not a score at all — it is a number a
-- determined student can change — and the second means no score exists until
-- somebody opens the script.
--
-- The obstacle was always that deciding "is 5(1)x^{1-1} the same as 5" needs a
-- computer algebra system, and there is none available inside this database.
--
-- WHAT CHANGED IS THE QUESTION BEING ASKED. Instead of "are these two
-- expressions mathematically equal", which needs algebra, this asks "is what
-- the student wrote one of the forms the instructor accepts", which needs only
-- careful string handling. The instructor lists the variations they will take
-- — y'=5, 5, dy/dx=5 — and the database matches against that list after
-- normalising both sides. That is a smaller promise, and unlike the old one it
-- can be kept on the server.
--
--   work_rubric.accept   an array of acceptable answers. Absent, the last
--                        step's latex is the only accepted answer, so every
--                        paper written before this keeps working.
--
-- WHAT NORMALISATION HANDLES, so the accept list does not have to:
--   spacing of every kind, \left and \right, \cdot and \times, \dfrac,
--   braces around a single token ({5} and 5, x^{2} and x^2), a subject on the
--   left (y'=5 and 5 and dy/dx=5 are one answer), redundant outer brackets,
--   and +- collapsing to -. Numbers are compared as NUMBERS, so 2 and 2.0
--   and even \frac{1}{2} and 0.5 agree.
--
-- WHAT IT DOES NOT HANDLE, and what the accept list is for: anything needing
-- actual algebra. x^{-1} and \frac{1}{x} are the same number and different
-- strings, so if you will take both, list both. The editor offers to fill the
-- list in for you from the maths engine, which does understand algebra — the
-- algebra happens once, when the question is written, instead of every time a
-- paper is marked.
--
-- WHAT THIS DOES NOT CHANGE
--   * An instructor can still override any mark. record_work_marks() (024)
--     writes over whatever this computed, and is still instructor-only.
--   * The rubric is still never readable by a student.
--
-- REHEARSE IT FIRST
--   1. Change  COMMIT;  near the bottom to  ROLLBACK;
--   2. Run the whole file and read the VERIFY output.
-- =====================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.routines
                 WHERE routine_schema='public' AND routine_name='save_worked_answers') THEN
    RAISE EXCEPTION 'save_worked_answers() not found — run sql/026 first.';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1. Putting an answer in a canonical form
-- ---------------------------------------------------------------------
-- Deliberately conservative: every rule here turns two spellings of the SAME
-- thing into one string, and none of them changes what an expression means.
-- Anything requiring algebra is left to the accept list.
CREATE OR REPLACE FUNCTION public.normalize_math(p text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  WITH s0 AS (SELECT coalesce(p, '') AS t),
  -- LaTeX spacing commands, which carry no meaning at all.
  s1 AS (SELECT regexp_replace(t, '\\[,;:!]|\\quad|\\qquad|\\ ', '', 'g') AS t FROM s0),
  -- \left( and \right) are decoration around ordinary brackets.
  s2 AS (SELECT regexp_replace(t, '\\left|\\right', '', 'g') AS t FROM s1),
  -- One spelling of a fraction.
  s3 AS (SELECT regexp_replace(t, '\\[dt]frac', '\frac', 'g') AS t FROM s2),
  -- One spelling of multiplication, then drop it: a\cdot b and ab are the
  -- same product. (Two bare NUMBERS multiplied would concatenate, which is
  -- why a final answer like 2\cdot 3 should be written 6.)
  s4 AS (SELECT regexp_replace(t, '\\cdot|\\times|\*', '', 'g') AS t FROM s3),
  -- All whitespace.
  s5 AS (SELECT regexp_replace(t, '\s+', '', 'g') AS t FROM s4),
  -- Case: \Sin and \sin, X and x.
  s6 AS (SELECT lower(t) AS t FROM s5),
  -- Braces that wrap a single token: {5} -> 5, x^{2} -> x^2. Twice, for
  -- nesting like {{x}}.
  s7 AS (SELECT regexp_replace(regexp_replace(t, '\{([a-z0-9])\}', '\1', 'g'),
                               '\{([a-z0-9])\}', '\1', 'g') AS t FROM s6),
  -- A subject on the left is a label, not part of the answer: y'=5, 5 and
  -- dy/dx=5 are one answer. Only a BARE subject is stripped — 2x=6 keeps its
  -- left side, which is what stops it passing as x=3.
  s8 AS (SELECT CASE
           WHEN t ~ '^(y''|y|f''\(x\)|f\(x\)|\\frac\{dy\}\{dx\}|dy/dx|x|v|s|t)='
           THEN regexp_replace(t, '^[^=]*=', '')
           ELSE t END AS t FROM s7),
  -- Brackets around the whole thing.
  s9 AS (SELECT CASE WHEN t ~ '^\((.*)\)$' AND length(t) > 2
                     THEN substring(t from 2 for length(t) - 2)
                     ELSE t END AS t FROM s8),
  s10 AS (SELECT replace(replace(t, '+-', '-'), '--', '+') AS t FROM s9)
  SELECT t FROM s10;
$$;

COMMENT ON FUNCTION public.normalize_math(text) IS
  'One canonical spelling of a LaTeX answer. Only ever collapses two ways of writing the SAME thing; never performs algebra.';

-- A number, if this is one. \frac{1}{2} counts; x+1 does not.
--
-- This does NOT use normalize_math(), and cannot: that function strips braces
-- around a single token, which is right for comparing strings (x^{2} and x^2)
-- but turns \frac{1}{2} into \frac12 and destroys the structure a fraction
-- has to be read from. So it does its own, lighter tidying — everything that
-- carries no meaning, and nothing that moves a brace.
CREATE OR REPLACE FUNCTION public.math_as_number(p text)
RETURNS numeric
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE t text; parts text[]; num numeric; den numeric; sign numeric := 1;
BEGIN
  t := lower(regexp_replace(
         regexp_replace(
           regexp_replace(coalesce(p,''), '\\[,;:!]|\\quad|\\qquad|\\ ', '', 'g'),
           '\\left|\\right', '', 'g'),
         '\s+', '', 'g'));
  t := regexp_replace(t, '\\[dt]frac', '\frac', 'g');
  -- A subject on the left is a label: y'=5 is the number 5.
  IF t ~ '^(y''|y|f''\(x\)|f\(x\)|\\frac\{dy\}\{dx\}|dy/dx|x|v|s|t)=' THEN
    t := regexp_replace(t, '^[^=]*=', '');
  END IF;

  IF t ~ '^-?[0-9]+(\.[0-9]+)?$' THEN RETURN t::numeric; END IF;

  IF t ~ '^-' THEN sign := -1; t := substring(t from 2); END IF;
  -- \frac{a}{b} with braces, or \fracab where both are single digits, which
  -- is the shape normalize_math() would have produced.
  parts := regexp_match(t, '^\\frac\{(-?[0-9]+)\}\{(-?[0-9]+)\}$');
  IF parts IS NULL THEN
    parts := regexp_match(t, '^\\frac([0-9])([0-9])$');
  END IF;
  IF parts IS NOT NULL THEN
    num := parts[1]::numeric; den := parts[2]::numeric;
    IF den = 0 THEN RETURN NULL; END IF;
    RETURN sign * (num / den);
  END IF;
  RETURN NULL;
EXCEPTION WHEN others THEN RETURN NULL;
END $$;

-- Do these two answers say the same thing?
CREATE OR REPLACE FUNCTION public.math_answers_match(a text, b text)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE na numeric; nb numeric;
BEGIN
  IF a IS NULL OR b IS NULL THEN RETURN false; END IF;
  IF btrim(a) = '' OR btrim(b) = '' THEN RETURN false; END IF;

  -- Numbers first, so 2, 2.0 and \frac{4}{2} are one answer.
  na := public.math_as_number(a);
  nb := public.math_as_number(b);
  IF na IS NOT NULL AND nb IS NOT NULL THEN RETURN na = nb; END IF;
  -- A number can never equal something that is not one.
  IF (na IS NULL) <> (nb IS NULL) THEN RETURN false; END IF;

  RETURN public.normalize_math(a) = public.normalize_math(b);
END $$;

-- Every answer an item will take: the accept list, plus the last rubric step,
-- which is the answer itself and is always acceptable.
CREATE OR REPLACE FUNCTION public.accepted_answers(p_rubric jsonb)
RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT array_remove(array_agg(DISTINCT v), NULL)
  FROM (
    SELECT p_rubric -> 'steps' -> -1 ->> 'latex' AS v
    UNION
    SELECT jsonb_array_elements_text(
             CASE WHEN jsonb_typeof(p_rubric -> 'accept') = 'array'
                  THEN p_rubric -> 'accept' ELSE '[]'::jsonb END)
  ) s
  WHERE v IS NOT NULL AND btrim(v) <> '';
$$;

-- ---------------------------------------------------------------------
-- 2. Marking, on the server
-- ---------------------------------------------------------------------
-- All or nothing per item: an answer matching any accepted form takes the
-- item's marks, anything else takes none. Writes work_marks, which is the
-- mark of RECORD from now on, and returns it.
CREATE OR REPLACE FUNCTION public.score_worked_answers(
  p_student_id    uuid,
  p_assessment_id uuid,
  p_attempt_no    integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_retakes boolean; v_answers jsonb; v_attempt integer;
  v_earned numeric := 0; v_total numeric := 0; v_patch jsonb := '{}'::jsonb;
  r record; v_given text; v_ok boolean; v_line text;
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
    SELECT q.id, coalesce(q.marks,1)::numeric AS marks,
           public.accepted_answers(q.work_rubric) AS accepted
    FROM public.questions q
    WHERE q.exam_id = p_assessment_id
      AND coalesce(q.question_type,'multiple_choice') = 'worked_solution'
  LOOP
    v_total := v_total + r.marks;
    v_ok := false;
    -- THE LAST LINE ONLY, and this matters now that the mark is real.
    --
    -- The stored shape is a list, because working used to be typed line by
    -- line and the answer was the last of them. Marking every line meant a
    -- student could send a list of twenty candidate answers and be right by
    -- exhaustion — impossible through the one answer field on screen, and
    -- trivial for anyone willing to shape the request themselves. One answer
    -- is one answer, and for step-by-step working the last line is still the
    -- answer, so nothing legitimate is lost.
    SELECT t INTO v_line
    FROM jsonb_array_elements_text(
           CASE WHEN jsonb_typeof(v_answers -> r.id::text -> 'lines') = 'array'
                THEN v_answers -> r.id::text -> 'lines' ELSE '[]'::jsonb END)
         WITH ORDINALITY AS e(t, ord)
    WHERE btrim(t) <> ''
    ORDER BY ord DESC LIMIT 1;

    IF v_line IS NOT NULL
       AND EXISTS (SELECT 1 FROM unnest(coalesce(r.accepted, ARRAY[]::text[])) AS acc
                   WHERE public.math_answers_match(v_line, acc)) THEN
      v_ok := true;
    END IF;
    v_line := NULL;

    IF v_ok THEN v_earned := v_earned + r.marks; END IF;
    v_patch := v_patch || jsonb_build_object(r.id::text, jsonb_build_object(
      'type','worked',
      'lines', coalesce(v_answers -> r.id::text -> 'lines', '[]'::jsonb),
      'marks', CASE WHEN v_ok THEN r.marks ELSE 0 END,
      'of', r.marks,
      'correct', v_ok,
      'reason', CASE WHEN v_ok THEN 'Correct answer.' ELSE 'Not an accepted answer.' END));
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

-- NOT granted to anon. It takes a student id and proves nothing about who is
-- asking, so a student able to call it directly could re-score ANY student's
-- paper — harmless when it merely recomputes the same number, and not harmless
-- at all when it overwrites a mark an instructor set by hand. Students reach
-- it only through save_worked_answers(), which proves the session first and,
-- being SECURITY DEFINER, may call this regardless of the caller's own rights.
REVOKE ALL ON FUNCTION public.score_worked_answers(uuid,uuid,integer) FROM public;
REVOKE ALL ON FUNCTION public.score_worked_answers(uuid,uuid,integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.score_worked_answers(uuid,uuid,integer) TO authenticated;

-- ---------------------------------------------------------------------
-- 3. Saving now scores, in the same call
-- ---------------------------------------------------------------------
-- 026 defined save_worked_answers(); this is that body with the marking
-- folded in, so a student's browser makes ONE call and the score exists in
-- the database before the call returns. The browser is told the number but
-- never decides it.
CREATE OR REPLACE FUNCTION public.save_worked_answers(
  p_student_id    uuid,
  p_assessment_id uuid,
  p_session_token text,
  p_work          jsonb
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_student uuid; v_retakes boolean; v_patch jsonb; v_rows int := 0;
  v_attempt int; v_scored jsonb;
BEGIN
  v_student := public.student_from_token(p_student_id, p_session_token);
  IF v_student IS NULL THEN
    RAISE EXCEPTION 'Your session has expired. Please log in again.'
      USING ERRCODE = '28000';
  END IF;

  SELECT allow_retakes INTO v_retakes FROM public.assessments WHERE id = p_assessment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown assessment'; END IF;

  SELECT jsonb_object_agg(k, jsonb_build_object('type','worked','lines',lines,'marks',NULL))
    INTO v_patch
  FROM (
    SELECT e.key AS k,
           (SELECT jsonb_agg(t) FROM jsonb_array_elements_text(e.value -> 'lines') AS t
             WHERE btrim(t) <> '') AS lines
    FROM jsonb_each(coalesce(p_work, '{}'::jsonb)) AS e
    WHERE EXISTS (SELECT 1 FROM public.questions q
                  WHERE q.id::text = e.key AND q.exam_id = p_assessment_id
                    AND coalesce(q.question_type,'multiple_choice') = 'worked_solution')
  ) s
  WHERE lines IS NOT NULL;

  IF v_retakes THEN
    SELECT max(attempt_no) INTO v_attempt FROM public.review_attempts
    WHERE student_id = v_student AND assessment_id = p_assessment_id;
    UPDATE public.review_attempts ra
       SET answers_json = coalesce(ra.answers_json,'{}'::jsonb) || coalesce(v_patch,'{}'::jsonb)
     WHERE ra.student_id = v_student AND ra.assessment_id = p_assessment_id
       AND ra.attempt_no = v_attempt;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  ELSE
    UPDATE public.results r
       SET answers_json = coalesce(r.answers_json,'{}'::jsonb) || coalesce(v_patch,'{}'::jsonb)
     WHERE r.student_id = v_student AND r.assessment_id = p_assessment_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  END IF;

  -- Marked here, on the server, from the rubric the student cannot read.
  v_scored := public.score_worked_answers(v_student, p_assessment_id, v_attempt);

  RETURN jsonb_build_object(
    'saved', v_rows,
    'items', (SELECT count(*) FROM jsonb_object_keys(coalesce(v_patch,'{}'::jsonb))),
    'work_marks', v_scored -> 'work_marks',
    'work_total', v_scored -> 'work_total');
END $$;

REVOKE ALL ON FUNCTION public.save_worked_answers(uuid,uuid,text,jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.save_worked_answers(uuid,uuid,text,jsonb) TO anon, authenticated;

COMMIT;

-- =====================================================================
-- VERIFY
-- =====================================================================

-- 1. Normalisation collapses spellings without changing meaning.
SELECT public.normalize_math('y'' = 5')                AS should_be_5,
       public.normalize_math('\frac{dy}{dx}=5')        AS also_5,
       public.normalize_math('2 \cdot x')              AS should_be_2x,
       public.normalize_math('\left( x+1 \right)')     AS should_be_x_plus_1,
       public.normalize_math('x^{2}')                  AS should_be_x_caret_2;

-- 2. Numbers compare as numbers; different things stay different.
SELECT public.math_answers_match('2', '2.0')            AS t1,
       public.math_answers_match('\frac{1}{2}', '0.5')  AS t2,
       public.math_answers_match('y''=5', '5')          AS t3,
       public.math_answers_match('2x=6', 'x=3')         AS f1,
       public.math_answers_match('x^{-1}', '\frac{1}{x}') AS needs_accept_list;
-- t1..t3 true; f1 false; needs_accept_list FALSE — that one needs algebra,
-- which is exactly what the accept list is for.

-- 3. Nothing was rescored by this migration.
SELECT count(*) AS attempts, count(work_marks) AS already_marked FROM public.review_attempts;

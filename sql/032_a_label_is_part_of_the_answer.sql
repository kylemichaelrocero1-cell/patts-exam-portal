-- =====================================================================
-- 032 — A label is part of the answer: f(x) is not f''(x)
--
-- Run in the Supabase SQL editor (runs as postgres). Idempotent.
--
-- normalize_math() strips a label from the front of an answer so that
-- y' = 5 and 5 compare equal — and then nothing ever looked at the label
-- again. "Find the second derivative" of f(x) = x^4 - 2x^3 + x was answered
--
--     f(x) = 12x^2 - 12x
--
-- and marked CORRECT against f''(x) = 12x^2 - 12x. The value is right; the
-- label says it is the function itself, which is the very thing the question
-- tests. From this migration on:
--
--   * If ANY accepted answer for an item has a label, the student's answer
--     must have one that says the same thing: the same function, the same
--     order of derivative, about the same variable. f''(x), f'', d^2f/dx^2
--     and (d^2/dx^2)f(x) agree; f(x), f'(x), g''(x) and f''(t) do not.
--   * No label at all is wrong too, on such an item.
--   * y stands in for the function: y'' and d^2y/dx^2 count for f''(x). Only
--     y, and not for a key like x = 3 where x is the unknown, not a function.
--   * An item whose accepted answers carry NO label judges none — limits
--     marked on the number, exactly as before. Label the key to change that.
--   * Letter case now counts in the label: F''(x) is not f''(x).
--
-- ALSO FIXED: 030 and 031 turned the editor's ^{\prime\prime} into ONE prime
-- and ^{\prime\prime\prime} into two. In SQL '''''' is two quote characters,
-- not three. It never cost a mark, because the label was thrown away before
-- anything compared it — but now that the label is read, it would have made
-- every second derivative typed in the editor a first derivative.
--
-- The VALUE is still compared exactly as before (math_answers_match, labels
-- stripped); the label is judged separately, against every label the
-- accepted answers carry, so an accept list may mix labelled and bare forms.
--
-- ALREADY-MARKED WORK IS NOT RE-MARKED. Only answers saved from now on use
-- this rule (instructor's decision). An instructor who opens a script in the
-- dashboard and saves it re-marks it with the same rule — src/lib/mathLabel.js
-- is this file's twin, and sql/test/labels.test.mjs checks they agree.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Which left-hand sides are labels
-- ---------------------------------------------------------------------
-- Written against LOWER-CASED, tidied text, because normalize_math() has
-- already lower-cased by the time it strips a label. Broader than 031's: a
-- label may be taken at a number (h''(2)), written f^{(4)}(x), d^2y/dx^2 with
-- a slash, dy/(dx), or as an operator, \frac{d^2}{dx^2}f(x). Whatever
-- math_label() below recognises, this must strip, or the value of a correctly
-- labelled answer would be compared with its label still on.
CREATE OR REPLACE FUNCTION public.math_label_lhs_pattern()
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT '^('
    || '[a-z]''*(\(([a-z]|-?[0-9]+(\.[0-9]+)?)\))?'
    || '|[a-z]\^\{?\([0-9]+\)\}?(\(([a-z]|-?[0-9]+(\.[0-9]+)?)\))?'
    || '|\\frac\{d\^?[0-9]*[a-z]\}\{d[a-z]\^?[0-9]*\}'
    || '|d(\^[0-9]+)?[a-z]/\(?d[a-z](\^[0-9]+)?\)?'
    || '|\\frac\{d(\^[0-9]+)?\}\{d[a-z](\^[0-9]+)?\}[a-z](\([a-z]\))?'
    || ')=';
$$;

-- 031's normalize_math, with its label step using the pattern above and
-- \mathrm{d} read as d. Every other step is unchanged.
CREATE OR REPLACE FUNCTION public.normalize_math(p text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  WITH s0 AS (SELECT coalesce(p, '') AS t),
  s1 AS (SELECT regexp_replace(t, '\\[,;:!]|\\quad|\\qquad|\\ ', '', 'g') AS t FROM s0),
  s2 AS (SELECT regexp_replace(t, '\\left|\\right', '', 'g') AS t FROM s1),
  s3 AS (SELECT regexp_replace(regexp_replace(t, '\\[dt]frac', '\frac', 'g'),
                               '\\(mathrm|operatorname)\{d\}|\\differentialD', 'd', 'g') AS t FROM s2),
  s4 AS (SELECT regexp_replace(t, '\\cdot|\\times|\*', '', 'g') AS t FROM s3),
  s5 AS (SELECT regexp_replace(t, '\s+', '', 'g') AS t FROM s4),
  s6 AS (SELECT lower(t) AS t FROM s5),
  s7 AS (SELECT replace(replace(replace(replace(replace(replace(t,
           '^{\prime\prime\prime}', ''''''''),
           '^{\prime\prime}',       ''''''),
           '^{\prime}',             ''''),
           '\doubleprime',          ''''''),
           '^\prime',               ''''),
           '\prime',                '''') AS t FROM s6),
  s8 AS (SELECT replace(t, '^{}', '') AS t FROM s7),
  s9 AS (SELECT regexp_replace(regexp_replace(t, '\{([a-z0-9])\}', '\1', 'g'),
                               '\{([a-z0-9])\}', '\1', 'g') AS t FROM s8),
  s10 AS (SELECT CASE WHEN t ~ public.math_label_lhs_pattern()
                      THEN regexp_replace(t, '^[^=]*=', '')
                      ELSE t END AS t FROM s9),
  s11 AS (SELECT CASE WHEN t ~ '^\((.*)\)$' AND length(t) > 2
                      THEN substring(t from 2 for length(t) - 2)
                      ELSE t END AS t FROM s10),
  s12 AS (SELECT replace(replace(t, '+-', '-'), '--', '+') AS t FROM s11)
  SELECT t FROM s12;
$$;

-- math_as_number strips a label too and must agree.
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
  t := regexp_replace(t, '\\(mathrm|operatorname)\{d\}|\\differentialD', 'd', 'g');
  t := replace(replace(replace(replace(t,
         '^{\prime\prime\prime}', ''''''''), '^{\prime\prime}', ''''''),
         '^{\prime}', ''''), '^\prime', '''');
  t := regexp_replace(regexp_replace(t, '\{([a-z0-9])\}', '\1', 'g'), '\{([a-z0-9])\}', '\1', 'g');
  IF t ~ public.math_label_lhs_pattern() THEN
    t := regexp_replace(t, '^[^=]*=', '');
  END IF;
  IF t ~ '^-?[0-9]+(\.[0-9]+)?$' THEN RETURN t::numeric; END IF;
  IF t ~ '^-' THEN sign := -1; t := substring(t from 2); END IF;
  parts := regexp_match(t, '^\\frac\{(-?[0-9]+)\}\{(-?[0-9]+)\}$');
  IF parts IS NULL THEN parts := regexp_match(t, '^\\frac([0-9])([0-9])$'); END IF;
  IF parts IS NOT NULL THEN
    num := parts[1]::numeric; den := parts[2]::numeric;
    IF den = 0 THEN RETURN NULL; END IF;
    RETURN sign * (num / den);
  END IF;
  RETURN NULL;
EXCEPTION WHEN others THEN RETURN NULL;
END $$;

-- ---------------------------------------------------------------------
-- 2. What a label says
-- ---------------------------------------------------------------------
-- 'fn|order|at' — f''(x) is 'f|2|x', d^2y/dx^2 is 'y|2|x', y'' is 'y|2|',
-- h''(2) is 'h|2|2' — or NULL when there is no label. CASE IS KEPT.
-- Mirrors labelOf() in src/lib/mathLabel.js.
CREATE OR REPLACE FUNCTION public.math_label(p text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE t text; lhs text; m text[];
  arg constant text := '([A-Za-z]|-?[0-9]+(?:\.[0-9]+)?)';
BEGIN
  t := coalesce(p, '');
  t := regexp_replace(t, '\\[,;:!]|\\quad|\\qquad|\\ ', '', 'g');
  t := regexp_replace(t, '\\left|\\right', '', 'g');
  t := regexp_replace(t, '\\[dt]frac', '\frac', 'g');
  t := regexp_replace(t, '\\(mathrm|operatorname)\{d\}|\\differentialD', 'd', 'g');
  t := regexp_replace(t, '\s+', '', 'g');
  t := replace(replace(replace(replace(replace(replace(t,
         '^{\prime\prime\prime}', ''''''''),
         '^{\prime\prime}',       ''''''),
         '^{\prime}',             ''''),
         '\doubleprime',          ''''''),
         '^\prime',               ''''),
         '\prime',                '''');
  t := replace(t, '^{}', '');
  t := regexp_replace(regexp_replace(t, '\{([A-Za-z0-9])\}', '\1', 'g'), '\{([A-Za-z0-9])\}', '\1', 'g');

  IF position('=' in t) <= 1 THEN RETURN NULL; END IF;
  lhs := split_part(t, '=', 1);

  m := regexp_match(lhs, '^([A-Za-z])(''*)(?:\(' || arg || '\))?$');
  IF m IS NOT NULL THEN
    RETURN m[1] || '|' || length(m[2]) || '|' || coalesce(m[3], '');
  END IF;

  m := regexp_match(lhs, '^([A-Za-z])\^\{?\(([0-9]+)\)\}?(?:\(' || arg || '\))?$');
  IF m IS NOT NULL THEN
    RETURN m[1] || '|' || m[2]::int || '|' || coalesce(m[3], '');
  END IF;

  m := regexp_match(lhs, '^\\frac\{d(?:\^([0-9]+))?([A-Za-z])\}\{d([A-Za-z])(?:\^([0-9]+))?\}$');
  IF m IS NOT NULL THEN
    IF coalesce(m[1], '1') <> coalesce(m[4], '1') THEN RETURN NULL; END IF;
    RETURN m[2] || '|' || coalesce(m[1], '1')::int || '|' || m[3];
  END IF;

  m := regexp_match(lhs, '^d(?:\^([0-9]+))?([A-Za-z])/\(?d([A-Za-z])(?:\^([0-9]+))?\)?$');
  IF m IS NOT NULL THEN
    IF coalesce(m[1], '1') <> coalesce(m[4], '1') THEN RETURN NULL; END IF;
    RETURN m[2] || '|' || coalesce(m[1], '1')::int || '|' || m[3];
  END IF;

  m := regexp_match(lhs, '^\\frac\{d(?:\^([0-9]+))?\}\{d([A-Za-z])(?:\^([0-9]+))?\}([A-Za-z])(?:\(([A-Za-z])\))?$');
  IF m IS NOT NULL THEN
    IF coalesce(m[1], '1') <> coalesce(m[3], '1') THEN RETURN NULL; END IF;
    RETURN m[4] || '|' || coalesce(m[1], '1')::int || '|' || m[2];
  END IF;

  RETURN NULL;
END $$;

-- Does a student's label say what a key's does? Mirrors labelsAgree().
CREATE OR REPLACE FUNCTION public.math_labels_agree(s text, k text)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE s_fn text; s_ord text; s_at text; k_fn text; k_ord text; k_at text;
  key_is_a_function boolean;
BEGIN
  IF s IS NULL OR k IS NULL THEN RETURN false; END IF;
  s_fn := split_part(s, '|', 1); s_ord := split_part(s, '|', 2); s_at := split_part(s, '|', 3);
  k_fn := split_part(k, '|', 1); k_ord := split_part(k, '|', 2); k_at := split_part(k, '|', 3);
  IF s_ord <> k_ord THEN RETURN false; END IF;
  -- y stands in for a FUNCTION the key names — not for x in x = 3.
  key_is_a_function := k_ord::int > 0 OR k_at ~ '^[A-Za-z]$';
  IF NOT (s_fn = k_fn OR (s_fn = 'y' AND key_is_a_function)) THEN RETURN false; END IF;
  IF s_at <> '' AND k_at <> '' AND s_at <> k_at THEN RETURN false; END IF;
  RETURN true;
END $$;

-- The label as a person writes it, for the reason shown to an instructor.
CREATE OR REPLACE FUNCTION public.math_label_shown(l text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN l IS NULL THEN '' ELSE
    split_part(l, '|', 1)
    || CASE WHEN split_part(l, '|', 2)::int > 3 THEN '^(' || split_part(l, '|', 2) || ')'
            ELSE repeat('''', split_part(l, '|', 2)::int) END
    || CASE WHEN split_part(l, '|', 3) <> '' THEN '(' || split_part(l, '|', 3) || ')' ELSE '' END
  END;
$$;

-- ---------------------------------------------------------------------
-- 3. The verdict on one answer
-- ---------------------------------------------------------------------
-- NULL when the answer earns the item; otherwise the reason it does not.
-- The value first (unchanged: any accepted answer, labels stripped), then
-- the label, against every label the accepted answers carry.
CREATE OR REPLACE FUNCTION public.worked_answer_verdict(p_answer text, p_accepted text[])
RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE key_labels text[]; own text; want text;
BEGIN
  IF p_answer IS NULL OR btrim(p_answer) = '' THEN RETURN 'Not an accepted answer.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM unnest(coalesce(p_accepted, ARRAY[]::text[])) AS acc
                 WHERE public.math_answers_match(p_answer, acc)) THEN
    RETURN 'Not an accepted answer.';
  END IF;

  SELECT array_agg(l ORDER BY ord) INTO key_labels
  FROM (SELECT public.math_label(acc) AS l, ord
        FROM unnest(p_accepted) WITH ORDINALITY AS a(acc, ord)) s
  WHERE l IS NOT NULL;
  IF key_labels IS NULL THEN RETURN NULL; END IF;   -- the key names no label

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

-- accepted_answers() puts the model answer FIRST, so the label a reason
-- quotes is the one the instructor wrote as the answer. 027's version
-- aggregated DISTINCT values, which sorts them and loses that order.
CREATE OR REPLACE FUNCTION public.accepted_answers(p_rubric jsonb)
RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT array_agg(v ORDER BY first_seen)
  FROM (
    SELECT v, min(ord) AS first_seen
    FROM (
      SELECT p_rubric -> 'steps' -> -1 ->> 'latex' AS v, 0::bigint AS ord
      UNION ALL
      SELECT e.v, e.ord
      FROM jsonb_array_elements_text(
             CASE WHEN jsonb_typeof(p_rubric -> 'accept') = 'array'
                  THEN p_rubric -> 'accept' ELSE '[]'::jsonb END)
           WITH ORDINALITY AS e(v, ord)
    ) s
    WHERE v IS NOT NULL AND btrim(v) <> ''
    GROUP BY v
  ) d;
$$;

-- ---------------------------------------------------------------------
-- 4. Marking, with the verdict
-- ---------------------------------------------------------------------
-- 027's score_worked_answers(), unchanged except that an item is right when
-- worked_answer_verdict() finds nothing wrong, and the reason it records is
-- that verdict's.
CREATE OR REPLACE FUNCTION public.score_worked_answers(
  p_student_id    uuid,
  p_assessment_id uuid,
  p_attempt_no    integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_retakes boolean; v_answers jsonb; v_attempt integer;
  v_earned numeric := 0; v_total numeric := 0; v_patch jsonb := '{}'::jsonb;
  r record; v_ok boolean; v_line text; v_reason text;
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
    v_line := NULL;
    -- THE LAST LINE ONLY — see 027. One answer is one answer.
    SELECT t INTO v_line
    FROM jsonb_array_elements_text(
           CASE WHEN jsonb_typeof(v_answers -> r.id::text -> 'lines') = 'array'
                THEN v_answers -> r.id::text -> 'lines' ELSE '[]'::jsonb END)
         WITH ORDINALITY AS e(t, ord)
    WHERE btrim(t) <> ''
    ORDER BY ord DESC LIMIT 1;

    v_reason := public.worked_answer_verdict(v_line, coalesce(r.accepted, ARRAY[]::text[]));
    v_ok := v_line IS NOT NULL AND v_reason IS NULL;

    IF v_ok THEN v_earned := v_earned + r.marks; END IF;
    v_patch := v_patch || jsonb_build_object(r.id::text, jsonb_build_object(
      'type','worked',
      'lines', coalesce(v_answers -> r.id::text -> 'lines', '[]'::jsonb),
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

-- Same grants as 027: a student reaches this only through
-- save_worked_answers(), which proves the session first.
REVOKE ALL ON FUNCTION public.score_worked_answers(uuid,uuid,integer) FROM public;
REVOKE ALL ON FUNCTION public.score_worked_answers(uuid,uuid,integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.score_worked_answers(uuid,uuid,integer) TO authenticated;

COMMIT;

-- =====================================================================
-- VERIFY — the item that started this, MATH 117 Q27.
-- =====================================================================
SELECT public.worked_answer_verdict('f(x)=12x^2-12x',               ARRAY['f''''(x)=12x^2-12x']) AS f_of_x_is_wrong,
       public.worked_answer_verdict('12x^2-12x',                    ARRAY['f''''(x)=12x^2-12x']) AS bare_is_wrong,
       public.worked_answer_verdict('f^{\prime}(x)=12x^2-12x',      ARRAY['f''''(x)=12x^2-12x']) AS first_derivative_is_wrong,
       public.worked_answer_verdict('f^{\prime\prime}(x)=12x^2-12x', ARRAY['f''''(x)=12x^2-12x']) AS right_is_null,
       public.worked_answer_verdict('y^{\prime\prime}=12x^2-12x',    ARRAY['f''''(x)=12x^2-12x']) AS y_is_null;
-- The first three carry a reason; the last two are NULL (correct).

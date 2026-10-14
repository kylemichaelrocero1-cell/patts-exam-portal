-- =====================================================================
-- 061 — a minus in a bracket of its own is the same answer
--
-- Run in the Supabase SQL editor (runs as postgres). Idempotent.
-- Needs 045 (and 058). Marks nothing already stored: run sql/062 after it
-- to re-mark what was submitted.
--
-- A student wrote, for y = 5 csc(2x),
--     y' = 5(-\csc(2x))(\cot(2x))(2)
-- and the key has 5(-\csc(2x)\cot(2x))(2). The same derivative — and
-- marked "not a step", because 045 never removes a bracket that starts
-- with a minus (rightly: (-x)^2 is not -x^2), so the minus had to sit in
-- exactly the key's bracket.
--
-- math_unbracket_signs() is math_unbracket() that also removes a bracket
-- holding a minus and one factor — 5(-a)(b) is -5ab — moving the minus to
-- the front of its term
-- (2-3(-a) is 2+3a; -(-a) is a). Only where 045 would remove the bracket
-- if the minus were not there: never a function's argument (\sin(-x)),
-- never a bare function name ((-\sin)(x^2) is loose notation, not a step),
-- never a bracket that is raised, subscripted, primed or divided by
-- ((-x)^2, 1/(-2x)), never one holding a sum. Both sides — the student's
-- line and every accepted answer — go through it alike.
--
-- It is a FALLBACK. working_verdict() = working_verdict_strict() (058's,
-- unchanged) and, failing that, the comparison with signs taken out. And
-- mark_working() matches each line to a step strictly first, trying the
-- sign rule only for a line that matches no step: on a full solution the
-- unsimplified step x^3(-\sin x) and the simplified -x^3\sin x would
-- otherwise be the same line, and a right solution would lose a mark.
--
-- JS twin: unbracket(…, {signs}) / signOut() in src/lib/mathNormalize.js,
-- answerVerdict() and markWorking() in src/lib/stepMarking.js;
-- sql/test/keyboard_spellings.test.mjs checks they agree.
-- =====================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname='public' AND p.proname='math_unbracket_ok') THEN
    RAISE EXCEPTION 'Run sql/045 first.';
  END IF;
END $$;

-- The text before a bracket, with the sign of the term it sits in flipped.
CREATE OR REPLACE FUNCTION public.math_sign_out(p_before text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE d int := 0; k int; c text; prev text;
BEGIN
  k := length(p_before);
  WHILE k >= 1 LOOP
    c := substr(p_before, k, 1);
    IF c IN (')', '}') THEN d := d + 1;
    ELSIF c IN ('(', '{') THEN
      EXIT WHEN d = 0;
      d := d - 1;
    ELSIF d = 0 AND c IN ('+', '-', '=') THEN EXIT;
    END IF;
    k := k - 1;
  END LOOP;
  c := CASE WHEN k >= 1 THEN substr(p_before, k, 1) ELSE '' END;
  IF c = '+' THEN
    RETURN substr(p_before, 1, k - 1) || '-' || substr(p_before, k + 1);
  ELSIF c = '-' THEN
    prev := CASE WHEN k > 1 THEN substr(p_before, k - 1, 1) ELSE '' END;
    RETURN substr(p_before, 1, k - 1)
        || CASE WHEN k = 1 OR prev IN ('=', '(', '{') THEN '' ELSE '+' END
        || substr(p_before, k + 1);
  END IF;
  RETURN substr(p_before, 1, greatest(k, 0)) || '-' || substr(p_before, greatest(k, 0) + 1);
END $$;

CREATE OR REPLACE FUNCTION public.math_unbracket_signs(p text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE s text; n int; i int; j int; k int; d int; c text; changed boolean; guard int := 0;
        v_before text; v_inside text; v_after text;
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
        CONTINUE WHEN j = 0;
        v_before := substr(s, 1, i - 1);
        v_inside := substr(s, i + 1, j - i - 1);
        v_after  := substr(s, j + 1);
        IF public.math_unbracket_ok(v_before, v_inside, v_after) THEN
          s := v_before || v_inside || v_after;
          changed := true;
          EXIT;
        ELSIF length(v_inside) > 1 AND left(v_inside, 1) = '-'
              AND public.math_unbracket_ok(v_before, substr(v_inside, 2), v_after)
              AND v_inside !~ '\\[A-Za-z]+(\^(\{[^{}]*\}|.))?$' THEN
          -- A factor holding a minus: 5(-a)(b) is -5ab. Never a function
          -- with no argument of its own: (-\sin)(x^2) is not -\sin(x^2).
          s := public.math_sign_out(v_before) || substr(v_inside, 2) || v_after;
          changed := true;
          EXIT;
        END IF;
      END IF;
    END LOOP;
    EXIT WHEN NOT changed;
  END LOOP;
  RETURN s;
END $$;

-- 058's working_verdict(), unchanged, under the name of what it is.
CREATE OR REPLACE FUNCTION public.working_verdict_strict(p_answer text, p_accepted text[])
RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE v text; v2 text; r text;
BEGIN
  v := public.working_verdict_as_written(p_answer, p_accepted);
  IF v IS NULL OR p_answer IS NULL OR btrim(p_answer) = '' THEN RETURN v; END IF;
  r := public.math_respell(p_answer);
  -- Respelling changed nothing the comparison reads: no third look.
  IF public.math_unbracket(public.normalize_math(r)) = public.math_unbracket(public.normalize_math(p_answer)) THEN
    RETURN v;
  END IF;
  v2 := public.working_verdict_as_written(r, p_accepted);
  IF v2 IS NULL THEN RETURN NULL; END IF;
  IF v = 'Not an accepted answer.' THEN RETURN v2; END IF;
  RETURN v;
END $$;

-- The label part of working_verdict_as_written() (050), on its own: NULL
-- when the line's label is acceptable for these accepted answers.
CREATE OR REPLACE FUNCTION public.math_label_verdict(p_answer text, p_accepted text[])
RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE key_labels text[]; own text; want text;
BEGIN
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

-- The sign comparison alone: NULL when the line (as written, or respelt)
-- equals an accepted answer once a minus is taken out of a bracket, with an
-- acceptable label. Only a line holding a bracket that opens with a minus
-- is looked at — on any other the rule cannot change the student's side,
-- and skipping it keeps marking fast.
CREATE OR REPLACE FUNCTION public.working_verdict_by_signs(p_answer text, p_accepted text[])
RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE l text; nl text;
BEGIN
  IF p_answer IS NULL OR btrim(p_answer) = '' THEN RETURN 'Not an accepted answer.'; END IF;
  FOREACH l IN ARRAY ARRAY[p_answer, public.math_respell(p_answer)] LOOP
    nl := public.normalize_math(l);
    CONTINUE WHEN nl !~ '[(\[]-|\\lbrack-';
    IF EXISTS (SELECT 1 FROM unnest(coalesce(p_accepted, ARRAY[]::text[])) AS acc
               WHERE btrim(acc) <> ''
                 AND public.math_unbracket_signs(public.normalize_math(acc)) = public.math_unbracket_signs(nl)) THEN
      RETURN public.math_label_verdict(l, p_accepted);
    END IF;
  END LOOP;
  RETURN 'Not an accepted answer.';
END $$;

-- Right strictly, or with a minus taken out of a bracket.
CREATE OR REPLACE FUNCTION public.working_verdict(p_answer text, p_accepted text[])
RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE v text;
BEGIN
  v := public.working_verdict_strict(p_answer, p_accepted);
  IF v IS DISTINCT FROM 'Not an accepted answer.' OR p_answer IS NULL OR btrim(p_answer) = '' THEN
    RETURN v;
  END IF;
  RETURN public.working_verdict_by_signs(p_answer, p_accepted);
END $$;

-- 045's mark_working(), matching each line strictly first.
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
    -- Strictly first (061): only a line that matches no step as written may
    -- match one with a minus taken out of a bracket — otherwise x^3(-\sin x),
    -- the unsimplified step, would read as -x^3\sin x, the simplified one.
    FOR i IN REVERSE n_steps .. 1 LOOP
      IF public.working_verdict_strict(v_lines[j],
           coalesce(public.step_accepted(v_steps -> (i - 1)), ARRAY[]::text[])) IS NULL THEN
        v_hit := i; EXIT;
      END IF;
    END LOOP;
    IF v_hit IS NULL THEN
      FOR i IN REVERSE n_steps .. 1 LOOP
        IF public.working_verdict_by_signs(v_lines[j],
             coalesce(public.step_accepted(v_steps -> (i - 1)), ARRAY[]::text[])) IS NULL THEN
          v_hit := i; EXIT;
        END IF;
      END LOOP;
    END IF;
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

-- When this went live, for sql/062's re-mark in batches. Set once.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'remark_061_since') THEN
    EXECUTE format('CREATE FUNCTION public.remark_061_since() RETURNS timestamptz '
                   'LANGUAGE sql IMMUTABLE AS $f$ SELECT %L::timestamptz $f$', now());
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.remark_061_since() FROM public, anon, authenticated;

COMMIT;

-- =====================================================================
-- VERIFY — one row, every column true.
-- =====================================================================
SELECT
  public.working_verdict('y^{\prime}=7\left(-\csc\left(3x\right)\right)\left(\cot\left(3x\right)\right)\left(3\right)',
                         ARRAY['y''=7(-\csc(3x)\cot(3x))(3)']) IS NULL AS minus_in_its_own_bracket,
  public.working_verdict('y''=x^4(-\cos(x))', ARRAY['y''=x^4-\cos(x)']) IS NOT NULL AS a_product_is_not_a_difference,
  public.math_unbracket_signs('(-x)^2') = '(-x)^2' AND public.math_unbracket_signs('\sin(-x)') = '\sin(-x)'
    AND public.math_unbracket_signs('1/(-2x)') = '1/(-2x)' AS meaningful_brackets_stay,
  public.math_unbracket_signs('2-3(-a)') = '2+3a' AND public.math_unbracket_signs('-(-a)') = 'a' AS signs_combine,
  (public.mark_working('["y=x^4\\cos(x)", "y''=(4x^3)(\\cos(x))+(x^4)(-\\sin(x))", "y''=4x^3\\cos(x)-x^4\\sin(x)"]'::jsonb,
     '{"mode":"lines","steps":[{"latex":"y=x^4\\cos(x)","marks":1},{"latex":"y''=4x^3\\cos(x)+x^4(-\\sin(x))","marks":3},{"latex":"y''=4x^3\\cos(x)-x^4\\sin(x)","marks":5,"alone":3,"partial":4}]}'::jsonb)
     ->> 'marks')::numeric = 5 AS full_solution_keeps_its_steps;

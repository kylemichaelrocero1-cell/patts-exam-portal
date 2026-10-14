-- =====================================================================
-- 066 — 3·4 is three times four, and a 0 term from the product rule
--       changes nothing
--
-- Run in the Supabase SQL editor (runs as postgres). Idempotent.
-- Needs 061. Marks nothing already stored: run sql/067 after it to
-- re-mark what was submitted.
--
-- 1. A times sign between two numbers. normalize_math() has always dropped
--    \cdot, \times and * (s4), so 3\cdot5\sin(5x) read as 35\sin(5x):
--    thirty-five. Between two numbers the sign now leaves a bracket behind
--    — 3\cdot5 reads 3(5), the way the keys already write it — and
--    35\sin(5x) no longer passes for it. Everywhere else, unchanged.
--
-- 2. Students apply the product rule to the constant as well, leaving a
--    term that is zero:
--        y' = (0)(\cos(5x)) + 3(-\sin(5x))(5)
--        y' = 3(-5\sin(5x)) + \cos(5x)\cdot0
--    The same step as 3(-\sin(5x))(5). math_tidy_terms() drops a term with
--    a factor of 0 — 0 at its front, (0) as a factor, or 0 at its end —
--    never a function's argument (\cos(0) is 1), never a 0 raised, divided
--    by or in a decimal (0.5). It also reads (5)3 as 5(3).
--    The tidy is applied to the student's line only, and only after the
--    strict comparison and the sign comparison (061) have both failed: it
--    sits in working_verdict_by_signs(), which working_verdict() and
--    mark_working() (061) already try last. mark_working() is unchanged.
--
-- JS twin: normalizeMath() and tidyTerms() in src/lib/mathNormalize.js,
-- answerVerdictBySigns() in src/lib/stepMarking.js;
-- sql/test/keyboard_spellings.test.mjs checks they agree.
-- =====================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname='public' AND p.proname='math_unbracket_signs') THEN
    RAISE EXCEPTION 'Run sql/061 first.';
  END IF;
END $$;

-- 1. A times sign between two numbers ---------------------------------
-- 050's normalize_math(), with s4 changed.
CREATE OR REPLACE FUNCTION public.normalize_math(p text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  WITH s0 AS (SELECT coalesce(p, '') AS t),
  s1 AS (SELECT public.math_drop_spaces(t) AS t FROM s0),
  s2 AS (SELECT regexp_replace(t, '\\left|\\right', '', 'g') AS t FROM s1),
  s3 AS (SELECT regexp_replace(regexp_replace(t, '\\[dt]frac', '\frac', 'g'),
                               '\\(mathrm|operatorname)\{d\}|\\differentialD', 'd', 'g') AS t FROM s2),
  -- 066: between two numbers a times sign leaves a bracket: 3\cdot5 is 3(5).
  s4n AS (SELECT regexp_replace(t, '(?<=[0-9])\s*(\\cdot|\\times|\*)\s*([0-9]+(\.[0-9]+)?)', '(\2)', 'g') AS t FROM s3),
  s4 AS (SELECT regexp_replace(t, '\\cdot|\\times|\*', '', 'g') AS t FROM s4n),
  s5 AS (SELECT regexp_replace(t, '\s+', '', 'g') AS t FROM s4),
  s6 AS (SELECT lower(t) AS t FROM s5),
  s7 AS (SELECT public.math_primes(t) AS t FROM s6),
  s8 AS (SELECT replace(t, '^{}', '') AS t FROM s7),
  s9 AS (SELECT regexp_replace(regexp_replace(t, '\{([a-z0-9])\}', '\1', 'g'),
                               '\{([a-z0-9])\}', '\1', 'g') AS t FROM s8),
  s9n AS (SELECT regexp_replace(t, '\\frac\{\(([^(){}]*)\)\}', '\\frac{\1}', 'g') AS t FROM s9),
  s9d AS (SELECT regexp_replace(t, '(\\frac(\{[^{}]*\}|[a-z0-9]))\{\(([^(){}]*)\)\}', '\1{\3}', 'g') AS t FROM s9n),
  s9b AS (SELECT regexp_replace(t, '(^|[-=+({])\\frac\{-([0-9a-z.^'']+)\}',
                                '\1-\\frac{\2}', 'g') AS t FROM s9d),
  s9c AS (SELECT regexp_replace(t, '\{([a-z0-9])\}', '\1', 'g') AS t FROM s9b),
  s10 AS (SELECT CASE WHEN t ~ public.math_label_lhs_pattern()
                      THEN regexp_replace(t, '^[^=]*=', '')
                      ELSE t END AS t FROM s9c),
  -- 050: only when the first bracket is closed by the last one.
  s11 AS (SELECT CASE WHEN length(t) > 2 AND left(t, 1) = '('
                           AND public.math_close(t, 1) = length(t)
                      THEN substring(t from 2 for length(t) - 2)
                      ELSE t END AS t FROM s10),
  s12 AS (SELECT replace(replace(t, '+-', '-'), '--', '+') AS t FROM s11)
  SELECT t FROM s12;
$$;

-- 2. Terms that are zero ------------------------------------------------
-- Is this term (no sign in front) a product with a factor of 0?
CREATE OR REPLACE FUNCTION public.math_term_is_zero(p_body text)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE d int := 0; k int; c text; pre text;
BEGIN
  IF p_body ~ '^0([^0-9.!^]|$)' THEN RETURN true; END IF;                 -- 0\cos(5x), 0(…)
  IF p_body ~ '[)}]0$' THEN RETURN true; END IF;                           -- \cos(5x)0, from \cdot0
  FOR k IN 1 .. length(p_body) LOOP                                        -- (0) as a factor
    c := substr(p_body, k, 1);
    IF c = '(' AND d = 0 AND substr(p_body, k, 3) = '(0)'
       AND substr(p_body, k + 3, 1) NOT IN ('!', '^') THEN
      pre := substr(p_body, 1, k - 1);
      IF pre !~ '\\[A-Za-z]+(\^(\{[^{}]*\}|.))?$' AND right(pre, 1) NOT IN ('^', '_', '/', '''') THEN
        RETURN true;
      END IF;
    END IF;
    IF c IN ('(', '{') THEN d := d + 1; ELSIF c IN (')', '}') THEN d := d - 1; END IF;
  END LOOP;
  RETURN false;
END $$;

-- A normalised line with its zero terms dropped and (5)3 read as 5(3) —
-- or the line unchanged, exactly, when neither applies.
CREATE OR REPLACE FUNCTION public.math_tidy_terms(p text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE s text; s2 text; n int; k int; c text; d int := 0; start int := 1;
        terms text[] := ARRAY[]::text[]; t text; out text := ''; dropped boolean := false;
BEGIN
  s := coalesce(p, '');
  -- Fast way out: nothing here either rule could touch.
  IF s !~ '0|\)[0-9]' OR position('=' in s) > 0 THEN RETURN p; END IF;
  s := replace(replace(s, '\lbrack', '('), '\rbrack', ')');
  s := replace(replace(s, '[', '('), ']', ')');
  s2 := regexp_replace(s, '(^|[-+(){])\(([0-9]+(\.[0-9]+)?)\)([0-9]+(\.[0-9]+)?)', '\1\2(\4)', 'g');
  n := length(s2);
  FOR k IN 1 .. n LOOP
    c := substr(s2, k, 1);
    IF c IN ('(', '{') THEN d := d + 1;
    ELSIF c IN (')', '}') THEN d := d - 1;
    ELSIF d = 0 AND c IN ('+', '-') AND k > start AND substr(s2, k - 1, 1) NOT IN ('^', '_') THEN
      terms := terms || substr(s2, start, k - start);
      start := k;
    END IF;
  END LOOP;
  terms := terms || substr(s2, start);
  FOREACH t IN ARRAY terms LOOP
    IF public.math_term_is_zero(CASE WHEN left(t, 1) IN ('+', '-') THEN substr(t, 2) ELSE t END) THEN
      dropped := true;
    ELSE
      out := out || t;
    END IF;
  END LOOP;
  IF NOT dropped THEN
    RETURN CASE WHEN s2 = s THEN p ELSE s2 END;
  END IF;
  IF out = '' THEN RETURN '0'; END IF;
  IF left(out, 1) = '+' THEN out := substr(out, 2); END IF;
  RETURN out;
END $$;

-- 061's sign comparison, which now also compares the student's line with
-- its zero terms dropped. Looked at only for a line holding a bracket that
-- opens with a minus, or one the tidy changes.
CREATE OR REPLACE FUNCTION public.working_verdict_by_signs(p_answer text, p_accepted text[])
RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE l text; nl text; tl text;
BEGIN
  IF p_answer IS NULL OR btrim(p_answer) = '' THEN RETURN 'Not an accepted answer.'; END IF;
  FOREACH l IN ARRAY ARRAY[p_answer, public.math_respell(p_answer)] LOOP
    nl := public.normalize_math(l);
    tl := public.math_tidy_terms(nl);
    CONTINUE WHEN tl = nl AND nl !~ '[(\[]-|\\lbrack-';
    tl := public.math_unbracket_signs(tl);
    IF EXISTS (SELECT 1 FROM unnest(coalesce(p_accepted, ARRAY[]::text[])) AS acc
               WHERE btrim(acc) <> ''
                 AND public.math_unbracket_signs(public.normalize_math(acc)) = tl) THEN
      RETURN public.math_label_verdict(l, p_accepted);
    END IF;
  END LOOP;
  RETURN 'Not an accepted answer.';
END $$;

-- When this went live, for sql/067's re-mark in batches. Set once.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'remark_066_since') THEN
    EXECUTE format('CREATE FUNCTION public.remark_066_since() RETURNS timestamptz '
                   'LANGUAGE sql IMMUTABLE AS $f$ SELECT %L::timestamptz $f$', now());
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.remark_066_since() FROM public, anon, authenticated;

COMMIT;

-- =====================================================================
-- VERIFY — one row, every column true.
-- =====================================================================
SELECT
  public.normalize_math('y''=3\cdot5\sin(5x)') = public.normalize_math('y''=3(5)\sin(5x)')
    AND public.normalize_math('3\cdot5') <> public.normalize_math('35')
    AND public.normalize_math('a\cdot b') = 'ab' AS times_between_numbers,
  public.working_verdict('y^{\prime}=\left(0\right)\left(\cos\left(5x\right)\right)+3\left(-\sin\left(5x\right)\right)\left(5\right)',
                         ARRAY['y''=3(-\sin(5x))(5)']) IS NULL
    AND public.working_verdict('y''=3\cdot5(-\sin(5x))+\cos(5x)\cdot0', ARRAY['y''=3(5)(-\sin(5x))']) IS NULL
    AND public.working_verdict('y''=0\sin(2x)+7\cdot2\sec^2(2x)', ARRAY['y''=7(2)\sec^2(2x)']) IS NULL AS a_zero_term_is_dropped,
  public.working_verdict('y''=(0)\tan(3x)+(5)3\sec^2(3x)', ARRAY['y''=5(3)\sec^2(3x)']) IS NULL AS bracketed_number_times_number,
  public.working_verdict('y''=\cos(0)+7x', ARRAY['y''=7x']) IS NOT NULL
    AND public.working_verdict('y''=0.5x+7x', ARRAY['y''=7x']) IS NOT NULL
    AND public.working_verdict('y''=x^0+7x', ARRAY['y''=7x']) IS NOT NULL
    AND public.working_verdict('y''=35\sin(5x)', ARRAY['y''=3\cdot5\sin(5x)']) IS NOT NULL AS what_is_not_zero_stays,
  public.working_verdict('y^{\prime}=7\left(-\csc\left(3x\right)\right)\left(\cot\left(3x\right)\right)\left(3\right)',
                         ARRAY['y''=7(-\csc(3x)\cot(3x))(3)']) IS NULL AS minus_in_its_own_bracket_still,
  (public.mark_working('["y=3\\cos(5x)", "y''=(0)(\\cos(5x))+(3)(-5\\sin(5x))", "y''=-15\\sin(5x)"]'::jsonb,
     '{"mode":"lines","steps":[{"latex":"y=3\\cos(5x)","marks":1},{"latex":"y''=3(-\\sin(5x))(5)","marks":3,"accept":["y''=3(-5\\sin(5x))"]},{"latex":"y''=-15\\sin(5x)","marks":5,"alone":3,"partial":4}]}'::jsonb)
     ->> 'marks')::numeric = 5 AS full_solution_with_a_zero_term;

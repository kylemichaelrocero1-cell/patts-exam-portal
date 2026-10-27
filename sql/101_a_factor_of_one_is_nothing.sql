-- =====================================================================
-- 101 — a factor of one, (1), is nothing
--
-- Run in the Supabase SQL editor (runs as postgres). Idempotent.
-- Needs 097. Deploy the frontend FIRST (the dashboard's twin of this rule).
-- Marks nothing already stored: run sql/102 after it, until it says 0.
--
-- The rule written out in full leaves a factor of one: d/dx ln x is
-- (1/x)(1), so a student's working line for y = x^(2x) read
--     y' = x^{2x}(\frac{2x}{x}(1) + \ln x(2))
-- and was "not a step" — the marker compares strings, and read the (1) as
-- a 1 standing in the line. Every answer on file with a (1) in it was
-- below full marks.
--
-- math_unbracket() and math_unbracket_signs() — both sides, the line and
-- every accepted answer — now drop a (1) that is a factor
-- (math_unit_factor). Never a function's argument (\ln(1), \log_3(1)),
-- never raised, subscripted, primed or divided, never a term standing
-- alone (x+(1), \frac{(1)}{x}), never between two digits (2(1)3 is not
-- 23). A line equal to an accepted answer before is equal after.
--
-- Not \cdot 1 after anything but a number: a key may write the rule's ×1
-- that way to tell its working line from its answer.
--
-- JS twin: unitFactor() in src/lib/mathNormalize.js;
-- sql/test/unit_factor.test.mjs checks they agree.
-- =====================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'math_regroup') THEN
    RAISE EXCEPTION 'Run sql/097 first.';
  END IF;
END $$;

-- Is a (1) between these a factor of one, to drop?
CREATE OR REPLACE FUNCTION public.math_unit_factor(p_before text, p_after text)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE v_prev text := right(p_before, 1); v_next text := left(p_after, 1);
BEGIN
  IF p_before ~ '\\[A-Za-z]+(\^(\{[^{}]*\}|.))?$' OR p_before ~ '\\[A-Za-z]+_(\{[^{}]*\}|.)$' THEN RETURN false; END IF;
  IF v_prev IN ('^', '_', '/', '''') OR v_next IN ('^', '_', '/', '''', '!') THEN RETURN false; END IF;
  IF v_prev IN ('', '+', '-', '=', '(', '{') AND v_next IN ('', '+', '-', '=', ')', '}') THEN RETURN false; END IF;
  IF v_prev ~ '[0-9.]' AND v_next ~ '[0-9.]' THEN RETURN false; END IF;
  RETURN true;
END $$;

-- 097's math_unbracket(), with a factor of one dropped first.
CREATE OR REPLACE FUNCTION public.math_unbracket(p text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE s text; n int; i int; j int; k int; d int; c text; changed boolean; guard int := 0;
        v_before text; v_inside text; v_after text; v_rg text;
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
        -- 101: a factor of one, (1), is nothing.
        IF v_inside = '1' AND public.math_unit_factor(v_before, v_after) THEN
          s := v_before || v_after;
          changed := true;
          EXIT;
        END IF;
        IF public.math_unbracket_ok(v_before, v_inside, v_after) THEN
          s := v_before || v_inside || v_after;
          changed := true;
          EXIT;
        END IF;
        v_rg := public.math_regroup(v_before, v_inside, v_after);
        IF v_rg IS NOT NULL THEN
          s := v_rg;
          changed := true;
          EXIT;
        END IF;
      END IF;
    END LOOP;
    EXIT WHEN NOT changed;
  END LOOP;
  RETURN s;
END $$;

-- 097's math_unbracket_signs(), the same.
CREATE OR REPLACE FUNCTION public.math_unbracket_signs(p text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE s text; n int; i int; j int; k int; d int; c text; changed boolean; guard int := 0;
        v_before text; v_inside text; v_after text; v_rg text;
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
        -- 101: a factor of one, (1), is nothing.
        IF v_inside = '1' AND public.math_unit_factor(v_before, v_after) THEN
          s := v_before || v_after;
          changed := true;
          EXIT;
        END IF;
        IF public.math_unbracket_ok(v_before, v_inside, v_after) THEN
          s := v_before || v_inside || v_after;
          changed := true;
          EXIT;
        END IF;
        v_rg := public.math_regroup(v_before, v_inside, v_after);
        IF v_rg IS NOT NULL THEN
          s := v_rg;
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


-- When this rule went live, for sql/102's re-mark. Set once.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'remark_101_since') THEN
    EXECUTE format('CREATE FUNCTION public.remark_101_since() RETURNS timestamptz '
                   'LANGUAGE sql IMMUTABLE AS $f$ SELECT %L::timestamptz $f$', now());
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.remark_101_since() FROM public, anon, authenticated;

COMMIT;

-- =====================================================================
-- VERIFY — one row. Every true/false column true; the last counts the
-- submitted sittings with a (1) in their answers (run sql/102 if not 0).
-- =====================================================================
SELECT
  public.working_verdict('y^{\prime}=x^{3x}\left(\frac{3x}{x}\left(1\right)+\ln x\left(3\right)\right)',
    ARRAY['y''=x^{3x}(\frac{3x}{x}+\ln(x)\cdot3)']) IS NULL AS factor_of_one_dropped,
  public.working_verdict('y^{\prime}=7\left(1\right)\cos\left(7x\right)', ARRAY['y''=7\cos(7x)']) IS NULL AS after_a_number,
  public.math_unbracket('\ln(1)') = '\ln(1)' AND public.math_unbracket('\log_3(1)') = '\log_3(1)' AS function_argument_kept,
  public.math_unbracket('2(1)3') = '2(1)3' AS digits_kept_apart,
  public.math_unbracket('x+(1)') = 'x+1' AS a_term_is_a_term,
  public.working_verdict('y^{\prime}=7\left(1\right)\cos\left(5x\right)', ARRAY['y''=7\cos(7x)']) IS NOT NULL AS wrong_stays_wrong,
  (SELECT count(*) FROM public.review_attempts ra WHERE ra.answers_json::text ~ '\\+left\(1\\+right\)|[^a-z]\(1\)')
  + (SELECT count(*) FROM public.results r WHERE r.answers_json::text ~ '\\+left\(1\\+right\)|[^a-z]\(1\)') AS sittings_with_a_factor_of_one;

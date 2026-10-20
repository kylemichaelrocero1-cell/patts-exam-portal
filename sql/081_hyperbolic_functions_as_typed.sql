-- =====================================================================
-- 081 — sinh, cosh, tanh, sech, csch and coth are read as typed
--
-- Run in the Supabase SQL editor (runs as postgres). Idempotent.
-- Needs 071.
--
-- The marker knew the trigonometric functions but not the hyperbolic
-- ones, so a right answer could be marked wrong for how it was typed:
--
--   * On a phone, function names go in as plain letters, and the marker
--     reads letters as the function they spell (058) — but it read cosh as
--     cos followed by h, i.e. \cos(h), and sech as \sec(h).
--   * The maths field writes sech as \operatorname{\mathrm{sech}}, csch as
--     cs\operatorname{\mathrm{ch}}, and arcsinh as arc\sinh; a key typed
--     in the question editor or a loader may say \operatorname{sech} or
--     \mathrm{sech}. Each is one function, but they are different strings.
--   * \cosh 3x was not read as \cosh(3x), as \cos 3x is.
--
-- 1. normalize_math() reads every spelling of a hyperbolic name, on both
--    sides, as one command (math_hyperbolic_names): \sech, \csch, and
--    \arsinh for arcsinh / arsinh / arc\sinh. \sinh^{-1} stays as written,
--    as \sin^{-1} and \arcsin do: a paper lists both if it takes both.
-- 2. math_respell() — the student's line, read the way a phone spells it —
--    takes a second argument: whether the item's accepted answers hold a
--    hyperbolic function. Only then are sinh, cosh, … read as the hyperbolic
--    functions, and their bare arguments bracketed. On every other item the
--    letters sinh may be sin h (the sin(x+h) of a limit) and are read
--    exactly as before. math_respell(text) is the old reading, unchanged.
-- 3. working_verdict_strict() and working_verdict_by_signs() pass that
--    argument. Nothing else in the marking changes.
--
-- JS twin: hyperbolicNames(), respell(p, { hyperbolic }) and
-- hasHyperbolic() in src/lib/mathNormalize.js, used by src/lib/
-- stepMarking.js; sql/test/hyperbolic.test.mjs checks they agree.
--
-- Marks nothing already stored. If the VERIFY row counts any submitted
-- sittings with a hyperbolic function in them, run sql/082 to re-mark them
-- (raise-only).
-- =====================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'math_respell'
                   AND p.prosrc LIKE '%exponentialE%') THEN
    RAISE EXCEPTION 'Run sql/071 first.';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1. One spelling for each hyperbolic name, on both sides
-- ---------------------------------------------------------------------
-- On lower-cased text with no spaces (normalize_math's s6).
CREATE OR REPLACE FUNCTION public.math_hyperbolic_names(p text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE t text := p;
BEGIN
  -- Most lines hold no hyperbolic name, and most that do hold no wrapper:
  -- each rewrite is tried only when what it rewrites can be there.
  IF t IS NULL OR t !~ '(sinh|cosh|tanh|coth|sech|csch|\{ch\})' THEN RETURN t; END IF;
  IF strpos(t, '{ch}') > 0 THEN
    t := regexp_replace(t, 'cs\\(?:operatorname|mathrm)\{(?:\\mathrm\{ch\}|ch)\}', '\\csch', 'g');
  END IF;
  IF strpos(t, '{') > 0 THEN
    FOR g IN 1 .. 2 LOOP
      t := regexp_replace(t, '\\(?:operatorname|mathrm|mathit|text|textrm)\{\\?((?:arc?)?(?:sinh|cosh|tanh|coth|sech|csch))\}', '\\\1', 'g');
    END LOOP;
  END IF;
  IF strpos(t, 'ar') > 0 THEN
    t := regexp_replace(t, '(?:\\arc|arc\\|\\ar)(sinh|cosh|tanh|coth|sech|csch)', '\\ar\1', 'g');
  END IF;
  RETURN t;
END $$;

-- 066's normalize_math(), with s6h added.
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
  -- 081: a hyperbolic function however it is spelt is one command.
  s6h AS (SELECT public.math_hyperbolic_names(t) AS t FROM s6),
  s7 AS (SELECT public.math_primes(t) AS t FROM s6h),
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

-- ---------------------------------------------------------------------
-- 2. The student's line, read with the hyperbolic names when the key has one
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.math_has_hyperbolic(p_accepted text[])
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce(array_to_string(p_accepted, ' ') ~* '(sinh|cosh|tanh|coth|sech|csch|\{ch\})', false);
$$;

-- 071's math_respell(), with the hyperbolic names when p_hyperbolic.
CREATE OR REPLACE FUNCTION public.math_respell(p text, p_hyperbolic boolean)
RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
  s text := coalesce(p, '');
  out text; t text; c text; a text; b text; nm text; rest text; sp text;
  m text[]; fns text[] := ARRAY['arcsin','arccos','arctan','arcsec','arccsc','arccot',
                                'cosec','sin','cos','tan','sec','csc','cot'];
  arcs text[] := ARRAY['sin','cos','tan','sec','csc','cot'];
  bare text[] := ARRAY['arcsin','arccos','arctan','arcsec','arccsc','arccot',
                       'sin','cos','tan','sec','csc','cot','ln','log'];
  -- 081: the hyperbolic names, the inverse spellings first (arcsinh is not
  -- arcsin followed by h). Used only when p_hyperbolic.
  hyps text[] := ARRAY['sinh','cosh','tanh','coth','sech','csch'];
  hyp_letters text[] := ARRAY['arcsinh','arsinh','arccosh','arcosh','arctanh','artanh',
                              'arccoth','arcoth','arcsech','arsech','arccsch','arcsch',
                              'sinh','cosh','tanh','coth','sech','csch'];
  hyp_bare text[] := ARRAY['arsinh','arcosh','artanh','arcoth','arsech','arcsch',
                           'sinh','cosh','tanh','coth','sech','csch'];
  i int; j int; k int; d int; e int; g int; n int; hit boolean; f text;
BEGIN
  IF p_hyperbolic THEN
    fns := hyp_letters || fns;
    arcs := hyps || arcs;
    bare := hyp_bare || bare;
  END IF;

  -- r1. \left( \right) are plain brackets; \left. \right. draw nothing.
  s := regexp_replace(s, '\\(left|right)\.', '', 'g');
  s := regexp_replace(s, '\\(left|right)(?![a-zA-Z])', '', 'g');

  -- r2. Text mode holds what it shows.
  FOR g IN 1 .. 3 LOOP
    s := regexp_replace(s, '\\(text|textrm|textit|mathrm|mathit|operatorname)\{([^{}]*)\}', '\2', 'g');
  END LOOP;
  s := replace(replace(replace(s, '\textasciicircum', '^'), '\textbraceleft', '{'), '\textbraceright', '}');
  -- r2b. \ast (a star) is a times sign (058).
  s := regexp_replace(s, '\\ast(?![a-zA-Z])', '\\cdot ', 'g');
  -- r2c. The keyboard's e is e (071): \exponentialE is the letter, and
  --      \exp(u) is e^{u}.
  s := regexp_replace(s, '\\exponentialE(?![a-zA-Z])', 'e', 'g');
  s := regexp_replace(s, '\\exp\s+\(', '\\exp(', 'g');
  FOR g IN 1 .. 50 LOOP
    i := strpos(s, '\exp(');
    EXIT WHEN i = 0;
    k := public.math_close(s, i + 4);
    EXIT WHEN k = 0;
    s := substr(s, 1, i - 1) || 'e^{' || substr(s, i + 5, k - i - 5) || '}' || substr(s, k + 1);
  END LOOP;

  -- r3. A superscript with no base at the very start: the label typed raised.
  t := regexp_replace(s, '^\s+', '');
  IF left(t, 2) = '^{' THEN
    j := public.math_close(t, 2);
    IF j > 0 THEN s := substr(t, 3, j - 3) || substr(t, j + 1); END IF;
  END IF;

  -- r4. A script with no base just inside a brace.
  FOR g IN 1 .. 50 LOOP
    i := (SELECT min(x) FROM unnest(ARRAY[strpos(s, '{^{'), strpos(s, '{_{')]) x WHERE x > 0);
    EXIT WHEN i IS NULL;
    k := public.math_close(s, i + 2);
    EXIT WHEN k = 0;
    s := substr(s, 1, i) || substr(s, i + 3, k - i - 3) || substr(s, k + 1);
  END LOOP;
  s := replace(replace(s, '^{^', '^{'), '\placeholder{}', '');

  -- r5. A function name typed as letters, and \cosec, is the function;
  --     with p_hyperbolic (081), sinh is \sinh and arcsinh, arsinh and
  --     arc\sinh are \arsinh.
  out := ''; i := 1; n := length(s);
  WHILE i <= n LOOP
    IF substr(s, i, 1) = '\' THEN
      j := i + 1;
      WHILE j <= n AND substr(s, j, 1) ~ '^[a-zA-Z]$' LOOP j := j + 1; END LOOP;
      out := out || CASE WHEN substr(s, i, j - i) = '\cosec' THEN '\csc' ELSE substr(s, i, j - i) END;
      i := j;
      CONTINUE;
    END IF;
    nm := NULL; k := 0;
    IF substr(s, i, 4) = 'arc\' THEN
      FOREACH f IN ARRAY arcs LOOP
        IF substr(s, i + 4, length(f)) = f AND substr(s, i + 4 + length(f), 1) !~ '^[a-zA-Z]$' THEN
          nm := CASE WHEN f = ANY (hyps) THEN 'ar' ELSE 'arc' END || f; k := 4 + length(f); EXIT;
        END IF;
      END LOOP;
    END IF;
    -- Every name begins a, c, s or t: any other letter need not be tried
    -- against the list (081, for speed; what it reads is unchanged).
    IF nm IS NULL AND substr(s, i, 1) IN ('a', 'c', 's', 't') THEN
      FOREACH f IN ARRAY fns LOOP
        IF substr(s, i, length(f)) = f THEN
          nm := CASE WHEN f = 'cosec' THEN 'csc'
                     WHEN f = ANY (hyp_letters) AND left(f, 3) = 'arc' THEN 'ar' || substr(f, 4)
                     ELSE f END;
          k := length(f); EXIT;
        END IF;
      END LOOP;
    END IF;
    IF nm IS NOT NULL THEN
      out := out || '\' || nm;
      i := i + k;
      IF substr(s, i, 1) ~ '^[a-zA-Z]$' THEN out := out || ' '; END IF;
      CONTINUE;
    END IF;
    out := out || substr(s, i, 1);
    i := i + 1;
  END LOOP;
  s := out;

  -- r6. A full stop between factors is a times sign; in a number it is a point.
  out := '';
  FOR i IN 1 .. length(s) LOOP
    c := substr(s, i, 1);
    IF c <> '.' THEN out := out || c; CONTINUE; END IF;
    a := CASE WHEN i > 1 THEN substr(s, i - 1, 1) END;
    b := substr(s, i + 1, 1);
    IF b ~ '^[0-9]$' AND (a IS NULL OR a ~ '^[0-9]$' OR a ~ '^[=+({\s-]$') THEN
      out := out || '.';
    ELSE
      out := out || '\cdot ';
    END IF;
  END LOOP;
  s := out;

  -- r7. Times a negative: a\cdot-b\cdot c is a(-b)c.
  FOR g IN 1 .. 50 LOOP
    i := 0; a := NULL;
    FOR k IN 1 .. length(s) LOOP
      IF (substr(s, k, 5) = '\cdot' AND substr(s, k + 5, 1) !~ '^[a-zA-Z]$')
         OR (substr(s, k, 6) = '\times' AND substr(s, k + 6, 1) !~ '^[a-zA-Z]$') THEN
        j := k + CASE WHEN substr(s, k, 5) = '\cdot' THEN 5 ELSE 6 END;
        WHILE substr(s, j, 1) ~ '^\s$' LOOP j := j + 1; END LOOP;
        IF substr(s, j, 1) = '-' THEN i := k; e := j; EXIT; END IF;
      END IF;
    END LOOP;
    EXIT WHEN i = 0;
    -- e is the minus; the factor runs to the next top-level + - = \cdot \times or closing bracket.
    k := e + 1; d := 0;
    WHILE k <= length(s) LOOP
      c := substr(s, k, 1);
      IF c IN ('(', '{', '[') THEN d := d + 1;
      ELSIF c IN (')', '}', ']') THEN
        EXIT WHEN d = 0;
        d := d - 1;
      ELSIF d = 0 AND c IN ('+', '-', '=') THEN EXIT;
      ELSIF d = 0 AND ((substr(s, k, 5) = '\cdot' AND substr(s, k + 5, 1) !~ '^[a-zA-Z]$')
                    OR (substr(s, k, 6) = '\times' AND substr(s, k + 6, 1) !~ '^[a-zA-Z]$')) THEN EXIT;
      END IF;
      k := k + 1;
    END LOOP;
    s := substr(s, 1, i - 1) || ' (' || substr(s, e, k - e) || ')' || substr(s, k);
  END LOOP;

  -- r8. A function's argument without brackets: \cos 7x is \cos(7x).
  out := ''; i := 1; n := length(s);
  WHILE i <= n LOOP
    IF substr(s, i, 1) <> '\' THEN out := out || substr(s, i, 1); i := i + 1; CONTINUE; END IF;
    j := i + 1;
    WHILE j <= n AND substr(s, j, 1) ~ '^[a-zA-Z]$' LOOP j := j + 1; END LOOP;
    nm := substr(s, i + 1, j - i - 1);
    out := out || substr(s, i, j - i);
    i := j;
    CONTINUE WHEN NOT (nm = ANY (bare));
    rest := substr(s, i);
    m := regexp_match(rest, '^(\^(?:\{[^{}]*\}|[^{\\]))');
    IF m IS NOT NULL THEN out := out || m[1]; i := i + length(m[1]); END IF;
    rest := substr(s, i);
    sp := (regexp_match(rest, '^(\s*)'))[1];
    i := i + length(sp);
    rest := substr(s, i);
    m := regexp_match(rest, '^([0-9]*[a-zA-Z](?:\^(?:\{[^{}]*\}|[0-9a-zA-Z]))?)');
    IF m IS NULL THEN m := regexp_match(rest, '^([0-9]+)(?![0-9a-zA-Z(\\])'); END IF;
    IF m IS NOT NULL THEN
      out := out || '(' || m[1] || ')'; i := i + length(m[1]);
    ELSE
      out := out || sp;
    END IF;
  END LOOP;
  s := out;

  -- r9. A bracket that fills a whole {…}: \frac{(…)}{…}, \sqrt{(…)}.
  FOR g IN 1 .. 50 LOOP
    hit := false;
    FOR i IN 1 .. length(s) LOOP
      CONTINUE WHEN substr(s, i, 1) <> '{';
      a := NULL; k := i + 1;
      WHILE substr(s, k, 1) = ' ' LOOP k := k + 1; END LOOP;
      CONTINUE WHEN substr(s, k, 1) <> '(';
      j := public.math_close(s, k);
      e := public.math_close(s, i);
      CONTINUE WHEN j = 0 OR e = 0 OR j > e OR btrim(substr(s, j + 1, e - j - 1)) <> '';
      s := substr(s, 1, k - 1) || substr(s, k + 1, j - k - 1) || substr(s, j + 1);
      hit := true;
      EXIT;
    END LOOP;
    EXIT WHEN NOT hit;
  END LOOP;

  -- r10. A bracket left open is closed at the end.
  d := length(s) - length(replace(s, '(', '')) - (length(s) - length(replace(s, ')', '')));
  IF d > 0 THEN s := s || repeat(')', d); END IF;
  RETURN s;
END $$;

-- The old reading, for anything that calls it with one argument.
CREATE OR REPLACE FUNCTION public.math_respell(p text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT public.math_respell(p, false);
$$;

-- ---------------------------------------------------------------------
-- 3. The verdicts pass it on
-- ---------------------------------------------------------------------
-- 061's working_verdict_strict().
CREATE OR REPLACE FUNCTION public.working_verdict_strict(p_answer text, p_accepted text[])
RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE v text; v2 text; r text;
BEGIN
  v := public.working_verdict_as_written(p_answer, p_accepted);
  IF v IS NULL OR p_answer IS NULL OR btrim(p_answer) = '' THEN RETURN v; END IF;
  r := public.math_respell(p_answer, public.math_has_hyperbolic(p_accepted));
  -- Respelling changed nothing the comparison reads: no third look.
  IF public.math_unbracket(public.normalize_math(r)) = public.math_unbracket(public.normalize_math(p_answer)) THEN
    RETURN v;
  END IF;
  v2 := public.working_verdict_as_written(r, p_accepted);
  IF v2 IS NULL THEN RETURN NULL; END IF;
  IF v = 'Not an accepted answer.' THEN RETURN v2; END IF;
  RETURN v;
END $$;

-- 066's working_verdict_by_signs().
CREATE OR REPLACE FUNCTION public.working_verdict_by_signs(p_answer text, p_accepted text[])
RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE l text; nl text; tl text;
BEGIN
  IF p_answer IS NULL OR btrim(p_answer) = '' THEN RETURN 'Not an accepted answer.'; END IF;
  FOREACH l IN ARRAY ARRAY[p_answer, public.math_respell(p_answer, public.math_has_hyperbolic(p_accepted))] LOOP
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

-- When these rules went live, for sql/082's re-mark. Set once: running 081
-- again does not move it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'remark_081_since') THEN
    EXECUTE format('CREATE FUNCTION public.remark_081_since() RETURNS timestamptz '
                   'LANGUAGE sql IMMUTABLE AS $f$ SELECT %L::timestamptz $f$', now());
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.remark_081_since() FROM public, anon, authenticated;

COMMIT;

-- =====================================================================
-- VERIFY — one row. Every true/false column true; the last is how many
-- submitted sittings have a hyperbolic function in them (if it is not 0,
-- run sql/082).
-- =====================================================================
SELECT
  public.working_verdict('y^{\prime}=6cosh\left(3x\right)', ARRAY['y''=6\cosh(3x)']) IS NULL AS letters_are_cosh,
  public.working_verdict('y^{\prime}=8\operatorname{\mathrm{sech}}^2\left(2x\right)', ARRAY['y''=8\operatorname{sech}^2(2x)']) IS NULL AS field_sech_is_sech,
  public.working_verdict('y^{\prime}=8sech^22x', ARRAY['y''=8\operatorname{sech}^2(2x)']) IS NULL AS letters_sech_unbracketed,
  public.working_verdict('y^{\prime}=6\cosh 3x', ARRAY['y''=6\cosh(3x)']) IS NULL AS bare_argument,
  public.working_verdict('y=arc\sinh\left(x^2\right)', ARRAY['y=\operatorname{arsinh}(x^2)']) IS NULL AS arc_sinh_is_arsinh,
  public.working_verdict('y^{\prime}=6cos\left(3x\right)', ARRAY['y''=6\cosh(3x)']) IS NOT NULL
    AND public.working_verdict('y^{\prime}=8sec^2\left(2x\right)', ARRAY['y''=8\operatorname{sech}^2(2x)']) IS NOT NULL AS trig_is_not_hyperbolic,
  public.working_verdict('y^{\prime}=\frac{sinh}{h}', ARRAY['y''=\frac{\sin(h)}{h}']) IS NULL AS other_papers_unchanged,
  (SELECT count(*) FROM public.review_attempts ra
    WHERE ra.answers_json::text ~* '(sinh|cosh|tanh|coth|sech|csch|\{ch\})')
  + (SELECT count(*) FROM public.results r
    WHERE r.answers_json::text ~* '(sinh|cosh|tanh|coth|sech|csch|\{ch\})') AS sittings_with_hyperbolic;

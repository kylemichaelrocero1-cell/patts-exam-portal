-- =====================================================================
-- 097 — answers typed without the maths keyboard, a power typed in two
--       goes, and a product's brackets placed another way
--
-- Run in the Supabase SQL editor (runs as postgres). Idempotent.
-- Needs 081. Deploy the frontend FIRST (the dashboard's twin of these
-- rules): an older dashboard re-marking a script would not credit them.
--
-- Right answers that the marker refused for how they were written:
--
--   * When the maths keyboard cannot load, the paper shows a plain text
--     box that says "use ^ for powers and / for division. It will still be
--     marked." It was not: e^(2x) and (2x)/(x^2+1) were never read as
--     e^{2x} and \frac{2x}{x^2+1}.
--   * A power typed in two goes — the field leaves the power and ^ is
--     pressed again — is stored as e^4^{x}. On screen it is e^{4x}.
--   * \log_{_2}: a subscript inside the subscript.
--   * ln and log typed as letters, which the plain-text box can only do
--     (the trigonometric names already were read; papers listed ln twice).
--   * A function name nested four text boxes deep
--     (\operatorname{\mathrm{4\operatorname{\mathrm{sech}}}}): only three
--     were opened.
--   * The same product with its brackets placed another way:
--     3(2^{3x}\ln 2) against 3\cdot2^{3x}\cdot\ln 2, (x)^2 against x^2.
--     045 keeps a bracket whose removal would run two digits together, so
--     each placement read differently.
--
-- 1. math_respell(), the student's line read the way it was meant (a
--    fallback, used only when the line is not right as written), reads the
--    first five. Nothing else is read differently: 3^{x}^{2} (x² or 2x?)
--    and 4e^4x (the x is not in the power) stay as they are.
-- 2. math_unbracket() and math_unbracket_signs() — both sides, the line and
--    every accepted answer — write a bracket they must keep one way
--    (math_regroup): a single number or letter raised loses its bracket
--    unless digits would run together (3(2)^{x} stays), and a bracket kept
--    only for its digits brackets just the number instead, so
--    3(2^{3x}\ln 2) reads as 3\cdot2^{3x}\cdot\ln 2 already does. A
--    function's argument is never touched: \sin(x)^2 is as before, and so
--    is \ln3(2x) — the 3 could be inside the log.
--
-- Both only make more answers right: a line equal to an accepted answer
-- before is equal after.
--
-- JS twin: respell(), unbracket() and regroup() in src/lib/mathNormalize.js,
-- used by src/lib/stepMarking.js; sql/test/plain_and_regrouped.test.mjs
-- checks they agree.
--
-- Marks nothing already stored. remark_097_since() records when these
-- rules went live, for a re-mark of the papers that need one.
-- =====================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'math_hyperbolic_names') THEN
    RAISE EXCEPTION 'Run sql/081 first.';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1. A bracket placed another way
-- ---------------------------------------------------------------------
-- The index of the ( that the ) at p_i closes, or 0.
CREATE OR REPLACE FUNCTION public.math_open(p text, p_i int)
RETURNS int
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE d int := 0; k int;
BEGIN
  FOR k IN REVERSE p_i .. 1 LOOP
    IF substr(p, k, 1) = ')' THEN d := d + 1;
    ELSIF substr(p, k, 1) = '(' THEN
      d := d - 1;
      IF d = 0 THEN RETURN k; END IF;
    END IF;
  END LOOP;
  RETURN 0;
END $$;

-- A bracket math_unbracket_ok() keeps, written the one way the same
-- product is written without it — or NULL.
CREATE OR REPLACE FUNCTION public.math_regroup(p_before text, p_inside text, p_after text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE v_lead boolean; v_trail boolean; v_mid text; v_num text; v_at int; d int := 0; c text; k int;
BEGIN
  -- After a function's bare number, \ln3(2x): the 2x could be in the log
  -- (053's call), so it is not read as \ln 3\cdot 2x.
  IF p_before ~ '\\[A-Za-z]+(\^(\{[^{}]*\}|.))?[0-9.]+$' THEN RETURN NULL; END IF;
  -- A single number or letter raised: (x)^2 is x^2, (5)^{x} is 5^{x}.
  IF left(p_after, 1) = '^' AND p_inside ~ '^([0-9]+(\.[0-9]+)?|[a-z])$' THEN
    IF p_before ~ '\\[A-Za-z]+(\^(\{[^{}]*\}|.))?$' THEN RETURN NULL; END IF;
    IF right(p_before, 1) IN ('^', '_', '/', '''') THEN RETURN NULL; END IF;
    IF right(p_before, 1) ~ '[0-9.]' AND left(p_inside, 1) ~ '[0-9]' THEN RETURN NULL; END IF;
    RETURN p_before || p_inside || p_after;
  END IF;
  -- Kept only because two digits would run together: bracket the number.
  v_lead := right(p_before, 1) ~ '[0-9]' AND left(p_inside, 1) ~ '[0-9]';
  v_trail := right(p_inside, 1) ~ '[0-9]' AND left(p_after, 1) ~ '[0-9]';
  IF NOT (v_lead OR v_trail) THEN RETURN NULL; END IF;
  IF p_inside ~ '^[0-9]+(\.[0-9]+)?$' THEN RETURN NULL; END IF;
  -- Otherwise removable (math_unbracket_ok without its digit rule).
  IF left(p_inside, 1) IN ('-', '+') THEN RETURN NULL; END IF;
  FOR k IN 1 .. length(p_inside) LOOP
    c := substr(p_inside, k, 1);
    IF c IN ('(', '{') THEN d := d + 1;
    ELSIF c IN (')', '}') THEN d := d - 1;
    ELSIF d = 0 AND c IN ('+', '-', '=') THEN RETURN NULL;
    END IF;
  END LOOP;
  IF p_before ~ '\\[A-Za-z]+(\^(\{[^{}]*\}|.))?$' THEN RETURN NULL; END IF;
  IF right(p_before, 1) IN ('^', '_', '/', '''') THEN RETURN NULL; END IF;
  IF left(p_after, 1) IN ('^', '_', '/', '''', '!') THEN RETURN NULL; END IF;
  v_mid := p_inside;
  IF v_lead THEN
    v_num := (regexp_match(v_mid, '^([0-9]+(?:\.[0-9]+)?)'))[1];
    v_mid := '(' || v_num || ')' || substr(v_mid, length(v_num) + 1);
  END IF;
  IF v_trail THEN
    v_num := (regexp_match(v_mid, '([0-9]+(?:\.[0-9]+)?)$'))[1];
    v_at := length(v_mid) - length(v_num);
    -- A power's or a subscript's digit is not a factor: (x^2)3 stays.
    IF substr(v_mid, v_at, 1) IN ('^', '_') THEN RETURN NULL; END IF;
    v_mid := substr(v_mid, 1, v_at) || '(' || v_num || ')';
  END IF;
  RETURN p_before || v_mid || p_after;
END $$;

-- 045's math_unbracket(), with math_regroup() for a bracket it keeps.
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

-- 061's math_unbracket_signs(), the same.
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

-- ---------------------------------------------------------------------
-- 2. The student's line, read the way it was meant (081's, plus r1b, r1c,
--    r2 to any depth, r4b, r4c, and ln and log in r5)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.math_respell(p text, p_hyperbolic boolean)
RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
  s text := coalesce(p, '');
  out text; t text; c text; a text; b text; nm text; rest text; sp text;
  m text[]; fns text[] := ARRAY['arcsin','arccos','arctan','arcsec','arccsc','arccot',
                                'cosec','sin','cos','tan','sec','csc','cot','ln','log'];
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
  ia int; ib int; ic int; io int; ip int; den text; m2 text[]; t2 text;
BEGIN
  IF p_hyperbolic THEN
    fns := hyp_letters || fns;
    arcs := hyps || arcs;
    bare := hyp_bare || bare;
  END IF;

  -- r1. \left( \right) are plain brackets; \left. \right. draw nothing.
  s := regexp_replace(s, '\\(left|right)\.', '', 'g');
  s := regexp_replace(s, '\\(left|right)(?![a-zA-Z])', '', 'g');

  -- r1b (097). The plain-text box, shown when the maths keyboard cannot
  --     load, asks for ^ and /: a power in round brackets, e^(2x), is e^{2x}…
  FOR g IN 1 .. 50 LOOP
    i := strpos(s, '^(');
    EXIT WHEN i = 0;
    k := public.math_close(s, i + 1);
    EXIT WHEN k = 0;
    s := substr(s, 1, i - 1) || '^{' || substr(s, i + 2, k - i - 2) || '}' || substr(s, k + 1);
  END LOOP;

  -- r1c (097). …and a bracket divided by something is a fraction:
  --     (2x)/(x^2+1) is \frac{2x}{x^2+1}, (1-ln x)/x^2 is \frac{1-ln x}{x^2}.
  --     Never a function's argument: ln(x)/x and \sin^{2}(x)/x stay.
  FOR g IN 1 .. 50 LOOP
    hit := false;
    FOR k IN 1 .. length(s) LOOP
      CONTINUE WHEN substr(s, k, 1) <> '/';
      ia := k - 1;
      WHILE ia >= 1 AND substr(s, ia, 1) = ' ' LOOP ia := ia - 1; END LOOP;
      CONTINUE WHEN ia < 1 OR substr(s, ia, 1) <> ')';
      io := public.math_open(s, ia);
      CONTINUE WHEN io = 0;
      ip := io - 1;
      WHILE ip >= 1 AND substr(s, ip, 1) = ' ' LOOP ip := ip - 1; END LOOP;
      CONTINUE WHEN ip >= 1 AND substr(s, ip, 1) ~ '[a-zA-Z^_}\\]';
      ib := k + 1;
      WHILE ib <= length(s) AND substr(s, ib, 1) = ' ' LOOP ib := ib + 1; END LOOP;
      IF substr(s, ib, 1) = '(' THEN
        ic := public.math_close(s, ib);
        CONTINUE WHEN ic = 0;
        den := substr(s, ib + 1, ic - ib - 1);
        e := ic + 1;
      ELSE
        m2 := regexp_match(substr(s, ib),
          '^((?:[0-9]+(?:\.[0-9]+)?[a-zA-Z]?|[a-zA-Z])(?:\^(?:\{[^{}]*\}|[0-9a-zA-Z]))?)');
        CONTINUE WHEN m2 IS NULL;
        den := m2[1];
        e := ib + length(den);
      END IF;
      s := substr(s, 1, io - 1) || '\frac{' || substr(s, io + 1, ia - io - 1) || '}{' || den || '}' || substr(s, e);
      hit := true;
      EXIT;
    END LOOP;
    EXIT WHEN NOT hit;
  END LOOP;

  -- r2. Text mode holds what it shows — as deep as it is nested (097; it
  --     stopped at three).
  FOR g IN 1 .. 10 LOOP
    t2 := regexp_replace(s, '\\(text|textrm|textit|mathrm|mathit|operatorname)\{([^{}]*)\}', '\2', 'g');
    EXIT WHEN t2 = s;
    s := t2;
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
  -- r4b (097). The same before one character: \log_{_2} is \log_{2}.
  s := regexp_replace(s, '\{[\^_](?![{}\\])', '{', 'g');
  -- r4c (097). A power typed in two goes — the field left the power and ^
  --     was pressed again: e^4^{x} is e^{4x}. Only a number then letters:
  --     3^{x}^{2} could be 3^{x^2} or 3^{2x}, and stays as it is.
  s := regexp_replace(s, '\^\{([0-9]+)\}\^\{(?=[a-zA-Z\\])', '^{\1', 'g');
  s := regexp_replace(s, '\^([0-9])\^\{(?=[a-zA-Z\\])', '^{\1', 'g');

  -- r5. A function name typed as letters, and \cosec, is the function
  --     (ln and log too, since 097: the plain-text box has no \ln key);
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
    -- Every name begins a, c, l, s or t: any other letter need not be tried
    -- against the list (081, for speed; what it reads is unchanged).
    IF nm IS NULL AND substr(s, i, 1) IN ('a', 'c', 'l', 's', 't') THEN
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

-- When these rules went live, for a re-mark. Set once: running 097 again
-- does not move it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'remark_097_since') THEN
    EXECUTE format('CREATE FUNCTION public.remark_097_since() RETURNS timestamptz '
                   'LANGUAGE sql IMMUTABLE AS $f$ SELECT %L::timestamptz $f$', now());
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.remark_097_since() FROM public, anon, authenticated;

COMMIT;

-- =====================================================================
-- VERIFY — one row. Every true/false column true. The last counts the
-- submitted sittings, on any paper, with a plain-text power, a power typed
-- in two goes or \log_{_…} in them (the regrouped brackets cannot be
-- counted this way).
-- =====================================================================
SELECT
  public.working_verdict('5e^(2x)', ARRAY['5e^{2x}']) IS NULL AS plain_text_power,
  public.working_verdict('(3x)/(x^2 + 7)', ARRAY['\frac{3x}{x^2+7}']) IS NULL AS plain_text_fraction,
  public.working_verdict('y^{\prime}=5e^3^{x}', ARRAY['y''=5e^{3x}']) IS NULL AS power_typed_twice,
  public.working_verdict('y=\log_{_3}\left(x^2+5\right)', ARRAY['y=\log_3(x^2+5)']) IS NULL AS log_base_typed_low,
  public.working_verdict('y^{\prime}=5\left(3^{2x}\ln(3)\right)', ARRAY['y''=5\cdot3^{2x}\cdot\ln(3)']) IS NULL AS product_bracketed_another_way,
  public.working_verdict('\frac{1}{4+\left(x\right)^2}', ARRAY['\frac{1}{4+x^2}']) IS NULL AS letter_in_brackets_raised,
  public.working_verdict('y^{\prime}=5e^3x', ARRAY['y''=5e^{3x}']) IS NOT NULL
    AND public.working_verdict('y=3^{x}^{2}', ARRAY['y=3^{x^2}']) IS NOT NULL
    AND public.working_verdict('y^{\prime}=\ln3\left(2x\right)', ARRAY['y''=\ln(3)\cdot2x']) IS NOT NULL
    AND public.working_verdict('y^{\prime}=5\left(3^{2x}\ln(3)\right)', ARRAY['y''=5\cdot3^{2x}']) IS NOT NULL AS wrong_stays_wrong,
  (SELECT count(*) FROM public.review_attempts ra
    WHERE ra.answers_json::text ~ '\^\(|\^[0-9]\^\{|_\{_')
  + (SELECT count(*) FROM public.results r
    WHERE r.answers_json::text ~ '\^\(|\^[0-9]\^\{|_\{_') AS sittings_typed_these_ways;

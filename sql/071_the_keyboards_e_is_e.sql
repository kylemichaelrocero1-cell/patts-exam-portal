-- =====================================================================
-- 071 — the maths keyboard's e is e
--
-- Run in the Supabase SQL editor (runs as postgres). Idempotent.
-- Needs 066.
--
-- On a phone the maths keyboard has its own e key, and it writes
-- \exponentialE, not the letter e; its exp key writes \exp(…). A paper's
-- accepted answers are written with the letter e, so a student who used
-- the key — or used it for one e and typed the letter for the next — was
-- marked wrong for a right answer.
--
-- math_respell(), which reads the student's line the way a phone spells it
-- (058), now also reads \exponentialE as e and \exp(u) as e^{u}. Only the
-- student's line is respelt, and only after it fails as written, so
-- marking is no slower for anyone who typed the letter.
-- JS twin: respell() in src/lib/mathNormalize.js;
-- sql/test/keyboard_spellings.test.mjs checks they agree.
--
-- Marks nothing already stored. If the VERIFY row shows any sittings
-- holding the e key, run sql/072 to re-mark them (raise-only).
-- =====================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname='public' AND p.proname='math_tidy_terms') THEN
    RAISE EXCEPTION 'Run sql/066 first.';
  END IF;
END $$;

-- math_respell(): 058's, with r2c added.
CREATE OR REPLACE FUNCTION public.math_respell(p text)
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
  i int; j int; k int; d int; e int; g int; n int; hit boolean; f text;
BEGIN
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

  -- r5. A function name typed as letters, and \cosec, is the function.
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
          nm := 'arc' || f; k := 4 + length(f); EXIT;
        END IF;
      END LOOP;
    END IF;
    IF nm IS NULL THEN
      FOREACH f IN ARRAY fns LOOP
        IF substr(s, i, length(f)) = f THEN
          nm := CASE WHEN f = 'cosec' THEN 'csc' ELSE f END; k := length(f); EXIT;
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

-- When these rules went live, for sql/072's re-mark. Set once: running 071
-- again does not move it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'remark_071_since') THEN
    EXECUTE format('CREATE FUNCTION public.remark_071_since() RETURNS timestamptz '
                   'LANGUAGE sql IMMUTABLE AS $f$ SELECT %L::timestamptz $f$', now());
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.remark_071_since() FROM public, anon, authenticated;

COMMIT;

-- =====================================================================
-- VERIFY — one row. Every true/false column true; the last is how many
-- submitted sittings hold the e key (if it is not 0, run sql/072).
-- =====================================================================
SELECT
  public.working_verdict('y^{\prime}=5\exponentialE^{5x}', ARRAY['y''=5e^{5x}']) IS NULL AS e_key_is_e,
  public.working_verdict('y^{\prime}=2xe^{5x}+5x^2\exponentialE^{5x}', ARRAY['y''=2xe^{5x}+5x^2e^{5x}']) IS NULL AS mixed_e_is_e,
  public.working_verdict('y^{\prime}=5\exp\left(5x\right)', ARRAY['y''=5e^{5x}']) IS NULL AS exp_is_e_to_the,
  public.working_verdict('y^{\prime}=5\exponentialE^{4x}', ARRAY['y''=5e^{5x}']) IS NOT NULL AS wrong_stays_wrong,
  public.math_respell('\sec x+\exponentialE') = '\sec(x)+e' AS commands_untouched,
  (SELECT count(*) FROM public.review_attempts ra
    WHERE ra.answers_json::text ~ '(exponentialE|\\exp[^a-zA-Z])')
  + (SELECT count(*) FROM public.results r
    WHERE r.answers_json::text ~ '(exponentialE|\\exp[^a-zA-Z])') AS sittings_with_the_e_key;

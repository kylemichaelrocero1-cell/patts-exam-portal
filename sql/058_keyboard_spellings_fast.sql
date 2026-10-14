-- =====================================================================
-- 058 — the keyboard's spellings count again, without slowing submit
--
-- Run in the Supabase SQL editor (runs as postgres). Idempotent.
-- Needs 050 (and 053/054 run before it).
--
-- 050 compared a line typed the way a phone spells it (7cos(7x), \text{},
-- a raised label, cosec, full stops…) after respelling it AND every
-- accepted answer — up to ~90 per step, for every line. 053 switched that
-- off because submitting got slow. On today's quiz that cost marks: a
-- student who wrote every step right, but with function names in letters,
-- scored 0.
--
-- Now only the student's line is respelt; the accepted answers are
-- compared as they are (they are written properly already). One respell
-- per line instead of a hundred. Also new: \ast (a star) is a times sign.
-- JS twin: respell() and answerVerdict() (stepMarking.js);
-- sql/test/keyboard_spellings.test.mjs checks they agree.
--
-- Marks nothing already stored: run sql/059 afterwards, as many times as
-- it asks, to re-mark what was submitted (raise-only). Run in one go the
-- re-mark took longer than the SQL editor waits, and the whole file
-- rolled back.
-- =====================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname='public' AND p.proname='working_verdict_as_written') THEN
    RAISE EXCEPTION 'Run sql/050 first.';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1. math_respell(): 050's, with \ast read as a times sign
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- 2. The verdict: as written, then with the student's line respelt
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.working_verdict(p_answer text, p_accepted text[])
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

-- ---------------------------------------------------------------------
-- 3. When these rules went live, for sql/059's re-mark in batches
-- ---------------------------------------------------------------------
-- The re-mark is too long for one run of the SQL editor (it timed out),
-- so 059 re-marks in batches everything last marked BEFORE this moment.
-- Set once: running 058 again does not move it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'remark_058_since') THEN
    EXECUTE format('CREATE FUNCTION public.remark_058_since() RETURNS timestamptz '
                   'LANGUAGE sql IMMUTABLE AS $f$ SELECT %L::timestamptz $f$', now());
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.remark_058_since() FROM public, anon, authenticated;

COMMIT;

-- =====================================================================
-- VERIFY — one row, every column true.
-- =====================================================================
SELECT
  public.working_verdict('y^{\prime}=7sin\left(7x\right)', ARRAY['y''=7\sin(7x)']) IS NULL AS letters_are_the_function,
  public.working_verdict('y^{\prime}=7\cos(7x)\ast7', ARRAY['y''=7\cos(7x)\cdot7']) IS NULL AS star_is_times,
  public.working_verdict('y^{\prime}=7sin\left(5x\right)', ARRAY['y''=7\sin(7x)']) IS NOT NULL AS wrong_stays_wrong,
  (SELECT p.prosrc LIKE '%math_respell(p_answer)%' AND p.prosrc NOT LIKE '%unnest%'
   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'working_verdict') AS one_respell_per_line;

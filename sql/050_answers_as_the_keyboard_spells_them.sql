-- =====================================================================
-- 050 — an answer typed the way the keyboard spells it is the same answer
--
-- Run in the Supabase SQL editor (runs as postgres). Idempotent.
-- Needs 042, 043 and 045.
--
-- On a paper of trig derivatives, right answers were marked wrong because
-- of how they were TYPED, not what they said. The commonest by far: on a
-- phone the function name goes in as plain letters,
--     y' = 7cos(7x)          (c·o·s, not \cos)
-- and the database compares answers as strings. Also seen, all right:
--     \text{y'=7cos(7x)}          the whole line in a text box
--     ^{y'}=7\cos(7x)             the label typed inside a superscript
--     \operatorname{cosec}7x      cosec, and a name wrapped in \operatorname
--     2\cos(x^3).\sin(x^3).3x^2   a full stop for a times sign
--     3\sin^2(4x)\cdot-\cos(4x)   times a negative with no bracket
--     \frac{\sin x}{1+\cos^2(x)}  \sin x and \cos(x) mixed in one answer
--     \sqrt{(1-16x^2)}            a bracket filling a whole root or numerator
--     \frac{4}{_{\sqrt{…}}}       a subscript with nothing under it
--     (\csc(x)(\csc^2(x))         a bracket left open at the end
--
-- 1. math_respell() rewrites a line the way the keyboard should have spelt
--    it, and working_verdict() takes a THIRD look (after 045's brackets):
--    the student's line and every accepted answer, respelt, compared again.
--    The label is judged exactly as before, on the respelt line. Nothing
--    stored is changed. A function's argument written without brackets
--    (\cos 7x) is read as the next number-and-letter (7x), with its power.
--
-- 2. normalize_math() step s11 stripped an answer's first and last bracket
--    whenever it began with ( and ended with ), even when they were not a
--    pair: (3x)\sin(x^3+2) became 3x)\sin(x^3+2 and could never be right.
--    Now only a bracket that closes at the very end is stripped.
--
-- Both only ever make MORE answers right. JS twins: respell() and the s11
-- step of normalizeMath() in src/lib/mathNormalize.js, used by
-- stepMarking.js and markAnswer(); sql/test/keyboard_spellings.test.mjs
-- checks the two agree.
--
-- RE-MARKS every attempt already submitted on a paper with a full-solution
-- item (as 045 did), RAISE-ONLY: if any attempt would go down, the whole
-- file rolls back. Attempts with a mark typed by an instructor are skipped.
-- =====================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname='public' AND p.proname='math_unbracket') THEN
    RAISE EXCEPTION 'Run sql/045 first.';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1. Where a bracket closes
-- ---------------------------------------------------------------------
-- The 1-based position of the ) or } that closes the ( or { at p_i, or 0.
CREATE OR REPLACE FUNCTION public.math_close(p text, p_i int)
RETURNS int
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE o text := substr(p, p_i, 1); c text; d int := 0; k int;
BEGIN
  IF o = '(' THEN c := ')'; ELSIF o = '{' THEN c := '}'; ELSE RETURN 0; END IF;
  FOR k IN p_i .. length(p) LOOP
    IF substr(p, k, 1) = o THEN d := d + 1;
    ELSIF substr(p, k, 1) = c THEN
      d := d - 1;
      IF d = 0 THEN RETURN k; END IF;
    END IF;
  END LOOP;
  RETURN 0;
END $$;

-- ---------------------------------------------------------------------
-- 2. normalize_math(): 036's, with s11 stripping only a real outer pair
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_math(p text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  WITH s0 AS (SELECT coalesce(p, '') AS t),
  s1 AS (SELECT public.math_drop_spaces(t) AS t FROM s0),
  s2 AS (SELECT regexp_replace(t, '\\left|\\right', '', 'g') AS t FROM s1),
  s3 AS (SELECT regexp_replace(regexp_replace(t, '\\[dt]frac', '\frac', 'g'),
                               '\\(mathrm|operatorname)\{d\}|\\differentialD', 'd', 'g') AS t FROM s2),
  s4 AS (SELECT regexp_replace(t, '\\cdot|\\times|\*', '', 'g') AS t FROM s3),
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

-- ---------------------------------------------------------------------
-- 3. An answer as the keyboard should have spelt it
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
-- 4. The verdict: as written (045), then respelt
-- ---------------------------------------------------------------------
-- 045's working_verdict(), unchanged, under the name of what it does.
CREATE OR REPLACE FUNCTION public.working_verdict_as_written(p_answer text, p_accepted text[])
RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE v text; u text; key_labels text[]; own text; want text;
BEGIN
  v := public.worked_answer_verdict(p_answer, p_accepted);
  IF v IS NULL OR v <> 'Not an accepted answer.' THEN RETURN v; END IF;
  IF p_answer IS NULL OR btrim(p_answer) = '' THEN RETURN v; END IF;
  u := public.math_unbracket(public.normalize_math(p_answer));
  IF NOT EXISTS (SELECT 1 FROM unnest(coalesce(p_accepted, ARRAY[]::text[])) AS acc
                 WHERE btrim(acc) <> '' AND public.math_unbracket(public.normalize_math(acc)) = u) THEN
    RETURN v;
  END IF;
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

-- Right as written, or right once the line and the key are both respelt.
-- Both markers (score_worked_answers, mark_working) call this.
CREATE OR REPLACE FUNCTION public.working_verdict(p_answer text, p_accepted text[])
RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE v text; v2 text; r text;
BEGIN
  v := public.working_verdict_as_written(p_answer, p_accepted);
  IF v IS NULL OR p_answer IS NULL OR btrim(p_answer) = '' THEN RETURN v; END IF;
  r := public.math_respell(p_answer);
  -- Respelling changed nothing the comparison reads: no third look (and no
  -- respelling every accepted answer, which is the expensive part).
  IF public.math_unbracket(public.normalize_math(r)) = public.math_unbracket(public.normalize_math(p_answer)) THEN
    RETURN v;
  END IF;
  v2 := public.working_verdict_as_written(r,
          ARRAY(SELECT public.math_respell(acc)
                FROM unnest(coalesce(p_accepted, ARRAY[]::text[])) WITH ORDINALITY AS a(acc, ord)
                ORDER BY ord));
  IF v2 IS NULL THEN RETURN NULL; END IF;
  -- Not even the value matched as written: say what the respelt line lacks.
  IF v = 'Not an accepted answer.' THEN RETURN v2; END IF;
  RETURN v;
END $$;

-- ---------------------------------------------------------------------
-- 5. Re-mark what is already submitted on full-solution papers, raise-only
-- ---------------------------------------------------------------------
DO $$
DECLARE r record; v_new numeric; n_done int := 0; n_up int := 0; n_skip int := 0;
BEGIN
  FOR r IN
    SELECT ra.student_id, ra.assessment_id, ra.attempt_no, coalesce(ra.work_marks, 0) AS old, ra.answers_json
    FROM public.review_attempts ra
    JOIN public.assessments a ON a.id = ra.assessment_id AND a.allow_retakes
    WHERE EXISTS (SELECT 1 FROM public.questions q WHERE q.exam_id = ra.assessment_id
                  AND q.work_rubric ->> 'mode' = 'lines')
  LOOP
    IF EXISTS (SELECT 1 FROM jsonb_each(coalesce(r.answers_json, '{}'::jsonb)) e
               WHERE jsonb_typeof(e.value) = 'object' AND e.value ->> 'reason' LIKE 'Marked by instructor%') THEN
      n_skip := n_skip + 1; CONTINUE;
    END IF;
    v_new := (public.score_worked_answers(r.student_id, r.assessment_id, r.attempt_no) ->> 'work_marks')::numeric;
    IF v_new < r.old THEN
      RAISE EXCEPTION 'An attempt would go DOWN from % to % (student %, attempt %). Nothing was changed.',
        r.old, v_new, r.student_id, r.attempt_no;
    END IF;
    n_done := n_done + 1;
    IF v_new > r.old THEN n_up := n_up + 1; END IF;
  END LOOP;
  RAISE NOTICE '% attempts re-marked, % of them went up, % skipped (marked by hand).', n_done, n_up, n_skip;
END $$;

COMMIT;

-- =====================================================================
-- VERIFY — one row, every column true.
-- =====================================================================
SELECT
  public.working_verdict('y^{\prime}=7sin\left(7x\right)', ARRAY['y''=7\sin(7x)']) IS NULL AS letters_are_the_function,
  public.working_verdict('\text{y''=7sin(7x)}', ARRAY['y''=7\sin(7x)']) IS NULL AS text_box_read,
  public.working_verdict('y^{\prime}=\frac{\sin x}{1+\cos^2\left(x\right)}', ARRAY['y''=\frac{\sin(x)}{1+\cos^2(x)}']) IS NULL AS bare_argument_read,
  public.working_verdict('g^{\prime}\left(x\right)=\left(3x\right)\sin\left(x^3\right)', ARRAY['g''(x)=3x\sin(x^3)']) IS NULL AS outer_brackets_fixed,
  public.working_verdict('y^{\prime}=7sin\left(5x\right)', ARRAY['y''=7\sin(7x)']) IS NOT NULL AS wrong_stays_wrong,
  public.working_verdict('7sin\left(7x\right)', ARRAY['y''=7\sin(7x)']) LIKE 'Right value, but no label%' AS label_still_judged,
  (SELECT count(*) = 0 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'working_verdict' AND p.prosrc NOT LIKE '%math_respell%') AS third_look_live;

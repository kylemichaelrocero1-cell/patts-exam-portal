-- =====================================================================
-- 036 — Four primes, brackets round a numerator, and more kinds of space
--
-- Run in the Supabase SQL editor (runs as postgres). Idempotent.
-- NEEDS 032 and 033. Changes how answers are COMPARED; marks nothing by
-- itself — answers already submitted keep their mark until re-credited.
--
-- Found on a real paper, where right answers were marked wrong:
--
-- 1. PRIMES WERE COUNTED FROM A LIST: ', '' and ''' only. The maths
--    keyboard writes a fourth derivative as k^{\prime\prime\prime\prime},
--    which matched none of them, so k''''(s) = 0 on a "find the fourth
--    derivative" question was compared with its label still on and
--    marked wrong. Now every \prime becomes ' and ^{''''} is unwrapped,
--    for any number of primes, in all three places that read them.
--
-- 2. BRACKETS ROUND A WHOLE NUMERATOR OR DENOMINATOR. q'(w) =
--    \frac{(4-w^2)}{(w^2+4)^2} is the same answer as without the brackets
--    and was marked wrong. They are now dropped when they span the whole
--    numerator (or denominator) with no bracket inside. (x+1)^2 over
--    something keeps its brackets: they do not span the whole of it.
--
-- 3. MORE KINDS OF SPACE: ~, \thinspace, \medspace, \thickspace,
--    \enspace, their negative forms, \> and \hspace{…} join \, \; \: \!
--    \quad and \qquad as things that are not part of an answer.
--
-- The dashboard's copy of the label rule (src/lib/mathLabel.js) reads
-- primes the same way; sql/test/primes_and_brackets.test.mjs checks the
-- two agree.
-- =====================================================================

BEGIN;

-- Every kind of space LaTeX has, removed. One place, used by all three.
CREATE OR REPLACE FUNCTION public.math_drop_spaces(p text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT regexp_replace(coalesce(p, ''),
    '\\[,;:!> ]|\\q?quad|\\(neg)?(thin|med|thick)space|\\enspace|\\hspace\*?\{[^}]*\}|~',
    '', 'g');
$$;

-- Primes as ', however many and however written: \prime, ^{\prime…},
-- ^\prime, \doubleprime. Case is left alone (math_label needs it).
CREATE OR REPLACE FUNCTION public.math_primes(p text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT regexp_replace(
           regexp_replace(
             replace(replace(coalesce(p, ''), '\doubleprime', ''''''), '\prime', ''''),
             '\^\{(''+)\}', '\1', 'g'),
           '\^('')', '\1', 'g');
$$;

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
  -- 036: brackets round a WHOLE numerator or denominator say nothing a
  -- fraction bar does not already say. \frac{(4-w^2)}{…} is \frac{4-w^2}{…}.
  -- Only when the brackets span the whole of it with none inside: (a)(b)
  -- over c is left alone.
  s9n AS (SELECT regexp_replace(t, '\\frac\{\(([^(){}]*)\)\}', '\\frac{\1}', 'g') AS t FROM s9),
  s9d AS (SELECT regexp_replace(t, '(\\frac(\{[^{}]*\}|[a-z0-9]))\{\(([^(){}]*)\)\}', '\1{\3}', 'g') AS t FROM s9n),
  s9b AS (SELECT regexp_replace(t, '(^|[-=+({])\\frac\{-([0-9a-z.^'']+)\}',
                                '\1-\\frac{\2}', 'g') AS t FROM s9d),
  s9c AS (SELECT regexp_replace(t, '\{([a-z0-9])\}', '\1', 'g') AS t FROM s9b),
  s10 AS (SELECT CASE WHEN t ~ public.math_label_lhs_pattern()
                      THEN regexp_replace(t, '^[^=]*=', '')
                      ELSE t END AS t FROM s9c),
  s11 AS (SELECT CASE WHEN t ~ '^\((.*)\)$' AND length(t) > 2
                      THEN substring(t from 2 for length(t) - 2)
                      ELSE t END AS t FROM s10),
  s12 AS (SELECT replace(replace(t, '+-', '-'), '--', '+') AS t FROM s11)
  SELECT t FROM s12;
$$;

CREATE OR REPLACE FUNCTION public.math_as_number(p text)
RETURNS numeric
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE t text; parts text[]; num numeric; den numeric; sign numeric := 1;
BEGIN
  t := lower(regexp_replace(
         regexp_replace(
           public.math_drop_spaces(coalesce(p,'')),
           '\\left|\\right', '', 'g'),
         '\s+', '', 'g'));
  t := regexp_replace(t, '\\[dt]frac', '\frac', 'g');
  t := regexp_replace(t, '\\(mathrm|operatorname)\{d\}|\\differentialD', 'd', 'g');
  t := public.math_primes(t);
  t := regexp_replace(regexp_replace(t, '\{([a-z0-9])\}', '\1', 'g'), '\{([a-z0-9])\}', '\1', 'g');
  IF t ~ public.math_label_lhs_pattern() THEN
    t := regexp_replace(t, '^[^=]*=', '');
  END IF;
  IF t ~ '^-?[0-9]+(\.[0-9]+)?$' THEN RETURN t::numeric; END IF;
  IF t ~ '^-' THEN sign := -1; t := substring(t from 2); END IF;
  parts := regexp_match(t, '^\\frac(\{-?[0-9]+(?:\.[0-9]+)?\}|[0-9])(\{-?[0-9]+(?:\.[0-9]+)?\}|[0-9])$');
  IF parts IS NOT NULL THEN
    num := btrim(parts[1], '{}')::numeric; den := btrim(parts[2], '{}')::numeric;
    IF den = 0 THEN RETURN NULL; END IF;
    RETURN sign * (num / den);
  END IF;
  RETURN NULL;
EXCEPTION WHEN others THEN RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.math_label(p text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE t text; lhs text; m text[];
  arg constant text := '([A-Za-z]|-?[0-9]+(?:\.[0-9]+)?)';
BEGIN
  t := coalesce(p, '');
  t := public.math_drop_spaces(t);
  t := regexp_replace(t, '\\left|\\right', '', 'g');
  t := regexp_replace(t, '\\[dt]frac', '\frac', 'g');
  t := regexp_replace(t, '\\(mathrm|operatorname)\{d\}|\\differentialD', 'd', 'g');
  t := regexp_replace(t, '\s+', '', 'g');
  t := public.math_primes(t);
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

COMMIT;

-- =====================================================================
-- VERIFY
-- =====================================================================
SELECT public.worked_answer_verdict('k^{\prime\prime\prime\prime}\left(s\right)=0', ARRAY['0']) AS fourth_derivative,
       public.worked_answer_verdict('q^{\prime}\left(w\right)=\frac{\left(4-w^2\right)}{\left(w^2+4\right)^2}',
                                    ARRAY['q''(w)=\frac{4-w^2}{(w^2+4)^2}']) AS brackets_on_top,
       public.math_label('f^{\prime\prime\prime\prime}(x)=0') AS four_primes_label,
       public.worked_answer_verdict('f^{\prime\prime}(x)=6x^2-2x', ARRAY['f''''(x)=6x^2-2x']) AS second_still_second,
       public.worked_answer_verdict('f^{\prime}(x)=6x^2-2x', ARRAY['f''''(x)=6x^2-2x']) AS first_still_wrong;
-- NULL, NULL, f|4|x, NULL, and a reason (wrong label) — NULL means correct.
